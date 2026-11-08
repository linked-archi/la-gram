/**
 * Validation of the model, the same wherever it runs (Task 22): in a Web Worker
 * in the browser and the desktop app (`validation.worker.ts`), on the calling
 * thread in Node and the tests (`validation-service.ts`).
 *
 * It keeps its own copy of the model, given whole once ({@link load}) and then
 * kept up to date by the store's changes ({@link apply}) — so a validation does
 * not copy the model out of the store on the UI thread, and does not copy its
 * own either: SHACL and the tables read the engine's store as it is — and what
 * validation needs of the metamodels ({@link setup}): the shapes, the class
 * hierarchy, the types of resources outside the model, and the relationship
 * tables.
 *
 * What it validates is what `App.validationDataGraph` describes: the model, the
 * `rdfs:subClassOf` axioms, and the types of resources the model refers to from
 * outside it (a view's viewpoint) — what is found of such a resource itself is
 * left out of the report: only its types are there to validate. How: the relationship shapes the tables cover
 * by lookup in the tables (`relationship-validity.ts`), the rest by SHACL; the
 * shapes' SPARQL-based constraints (`sh:sparql`), which the SHACL library cannot
 * run, with Oxigraph (`sparql-constraints.ts`) on a copy of the same data and
 * the metamodels' statements they read; and the references to what the model
 * does not have (`missing-references.ts`).
 *
 * The Oxigraph copy is made only when the shapes have SPARQL-based
 * constraints, and only where Oxigraph is ready (its WebAssembly loaded in the
 * worker): about 0.7 KB a quad (78 MB at 100 000 triples, measured in Node).
 */
import { DataFactory, Store as N3Store, termToId } from 'n3';
import * as oxigraph from 'oxigraph';
import type { Quad, Term } from '@rdfjs/types';
import { RdfShaclValidator } from './shacl-validator.js';
import { isOxigraphReady, toOxQuad } from './rdf-store.js';
import { SparqlRunner, sparqlConstraintsOf } from './sparql-constraints.js';
import { missingReferences } from '../model-manager/missing-references.js';
import { shapesReach, type ShapesReach } from './shape-reach.js';
import type { ValidationReport, ValidationResult } from './interfaces.js';
import { NAMESPACES } from './namespaces.js';
import { decodeQuads, type EncodedQuad } from './term-codec.js';
import { NO_TABLE_PERMISSIONS, TablePermissions, type PlainTablePermissions } from '../model-manager/direct-permissions.js';
import { checkRelationshipsByTables, noTableShapes, splitTableShapes, type TableShapes } from '../model-manager/relationship-validity.js';
import type { TypeClosure } from '../model-manager/model-queries.js';

const RDF_TYPE = NAMESPACES.rdf + 'type';
const RDFS_SUBCLASS_OF = NAMESPACES.rdfs + 'subClassOf';
const PREF_LABEL = NAMESPACES.skos + 'prefLabel';
const QUALIFIED_RELATIONSHIP = NAMESPACES.arch + 'QualifiedRelationship';

/** What validation needs of the loaded metamodels. */
export interface EngineSetup {
  /** The whole shapes graph; the engine splits off what the tables check. */
  shapes: EncodedQuad[];
  /** Every `rdfs:subClassOf` axiom. */
  hierarchy: EncodedQuad[];
  /** `rdf:type` statements about resources outside the model (in the metamodel graphs). */
  outsideTypes: EncodedQuad[];
  /** Relationship class → its `arch:unqualifiedForm`. */
  unqualifiedForms: Array<[string, string]>;
  /** What the relationship tables permit (`permittedBy`); `null` when none are loaded. */
  tables: PlainTablePermissions | null;
  /**
   * The metamodels' statements the SPARQL-based constraints read, besides types
   * and the class hierarchy (a viewpoint's `arch:includesConcept`).
   */
  sparqlContext?: EncodedQuad[];
}

/** A result as plain data: IRIs as strings. */
export interface PlainResult {
  focusNode: string;
  resultPath: string;
  sourceShape: string;
  message: string;
  severity: ValidationResult['severity'];
  sourceConstraintComponent?: string;
  /** The named shape an inline source shape is written in. */
  withinShape?: string;
}

/** A report as plain data. */
export interface PlainReport {
  conforms: boolean;
  results: PlainResult[];
  /**
   * How long it took, in ms: SHACL, the tables, the SPARQL-based constraints,
   * the references; and how many nodes were validated again — `all`, or after
   * an edit only those it can change.
   */
  timing: { shacl: number; tables: number; sparql?: number; references?: number; nodes: number | 'all' };
}

/** After this many validations of what edits changed, the whole model is validated again. */
const FULL_EVERY = 100;
/** When an edit can change the findings of more nodes than one in this many of the model's quads, the whole model is validated. */
const FULL_SHARE = 20;
/** …but not fewer than this many nodes. */
const FULL_FLOOR = 256;

/** The graph the SPARQL-based constraints' metamodel statements are kept in, in the Oxigraph copy. */
const CONTEXT_GRAPH = 'urn:la-gram:sparql-context';
/** Hops around what changed whose nodes the SPARQL-based constraints validate again — both ways. */
const SPARQL_HOPS = 1;

/** The class hierarchy as a closure function, from `rdfs:subClassOf` axioms. */
export function closureOf(hierarchy: readonly Quad[]): TypeClosure {
  const parents = new Map<string, string[]>();
  for (const q of hierarchy) {
    if (q.subject.termType !== 'NamedNode' || q.object.termType !== 'NamedNode') continue;
    const list = parents.get(q.subject.value);
    if (list) list.push(q.object.value);
    else parents.set(q.subject.value, [q.object.value]);
  }
  const cache = new Map<string, string[]>();
  return (type: string) => {
    const cached = cache.get(type);
    if (cached) return cached;
    const seen = new Set<string>([type]);
    const stack = [...(parents.get(type) ?? [])];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      if (seen.has(current)) continue;
      seen.add(current);
      stack.push(...(parents.get(current) ?? []));
    }
    const closure = [...seen];
    cache.set(type, closure);
    return closure;
  };
}

/** Validates a model it keeps a copy of. */
export class ValidationEngine {
  /**
   * What is validated, in one store, so that a validation copies nothing: the
   * model, and its extras — the class hierarchy and the types of the outside
   * resources the model refers to. A quad both the model and the extras hold
   * stays until neither does.
   */
  private data = new N3Store();
  /** The extras, by key. */
  private readonly extras = new Map<string, Quad>();
  /** The extras the model holds too. */
  private readonly alsoModel = new Set<string>();
  /** An outside resource's types, from the metamodel graphs. */
  private outsideTypes = new Map<string, Quad[]>();
  /** How many of the model's quads refer to each outside resource with types. */
  private readonly references = new Map<string, number>();
  private readonly validator = new RdfShaclValidator();
  private hierarchy: Quad[] = [];
  private split: TableShapes = noTableShapes([]);
  private tables: TablePermissions = NO_TABLE_PERMISSIONS;
  private closure: TypeClosure = (t) => [t];
  private reach: ShapesReach = { hops: 0, inverse: false, recursive: false, valuesAsFocus: false };
  private ready = false;
  /** The same data in Oxigraph, with the metamodels' statements the SPARQL-based constraints read; none without such constraints. */
  private sparqlData?: oxigraph.Store;
  private sparqlRunner?: SparqlRunner;
  private sparqlContext: Quad[] = [];

  /** The findings of the last validation, by focus node: SHACL's, the tables', the SPARQL-based constraints', the references'. */
  private findings: {
    shacl: Map<string, ValidationResult[]>;
    tables: Map<string, ValidationResult[]>;
    sparql: Map<string, ValidationResult[]>;
    references: Map<string, ValidationResult[]>;
  } | null = null;
  /** What changed since: the subjects and objects of the triples added and removed — or so much that the whole model is validated. */
  private changed = { subjects: new Map<string, Term>(), objects: new Map<string, Term>(), all: true };
  /** Validations of what edits changed since the whole model was last validated. */
  private sinceWhole = 0;

  /**
   * @param options.sparql Whether to run the SPARQL-based constraints (on by default).
   */
  constructor(private readonly options: { sparql?: boolean } = {}) {}

  /** Why SPARQL-based constraints could not be run, by shape; what Oxigraph refused. */
  get sparqlFailures(): ReadonlyMap<string, string> {
    return this.sparqlRunner?.failures ?? new Map();
  }

  /** Take what validation needs of the metamodels; splits the shapes. */
  setup(setup: EngineSetup): void {
    for (const q of [...this.extras.values()]) this.removeExtra(q);
    this.references.clear();
    this.hierarchy = decodeQuads(setup.hierarchy).map(inDefaultGraph);
    this.outsideTypes = new Map();
    for (const q of decodeQuads(setup.outsideTypes).map(inDefaultGraph)) {
      const list = this.outsideTypes.get(q.subject.value);
      if (list) list.push(q);
      else this.outsideTypes.set(q.subject.value, [q]);
    }
    this.addExtras();
    this.closure = closureOf(this.hierarchy);
    this.tables = setup.tables ? TablePermissions.fromPlain(setup.tables) : NO_TABLE_PERMISSIONS;
    const formOf = new Map(setup.unqualifiedForms);
    const closure = this.closure;
    const shapes = decodeQuads(setup.shapes);
    this.split = splitTableShapes(shapes, this.tables, formOf, (c) => closure(c).includes(QUALIFIED_RELATIONSHIP));
    this.reach = shapesReach(this.split.kept);
    const constraints = this.options.sparql === false ? [] : sparqlConstraintsOf(shapes).constraints;
    this.sparqlContext = decodeQuads(setup.sparqlContext ?? []);
    this.sparqlRunner = undefined;
    if (constraints.length > 0 && isOxigraphReady()) {
      this.sparqlRunner = new SparqlRunner(
        constraints,
        { select: (query) => (this.sparqlData?.query(query, { use_default_graph_as_union: true }) ?? []) as Array<Map<string, Term>> },
        (iri) => this.nameOf(iri),
      );
    }
    this.rebuildSparqlData();
    this.ready = true;
    this.changed.all = true;
  }

  /** Replace the model with these quads (default graph). */
  load(quads: readonly EncodedQuad[]): void {
    this.data = new N3Store();
    this.extras.clear();
    this.alsoModel.clear();
    this.references.clear();
    this.data.addQuads(decodeQuads(quads) as never);
    this.addExtras();
    this.rebuildSparqlData();
    this.changed.all = true;
  }

  /** Apply a change to the model. */
  apply(added: readonly EncodedQuad[], removed: readonly EncodedQuad[]): void {
    for (const q of decodeQuads(removed)) {
      const k = extraKey(q);
      if (k !== undefined && this.extras.has(k)) this.alsoModel.delete(k);
      else this.drop(q);
      this.refer(q, -1);
      this.touch(q);
    }
    for (const q of decodeQuads(added)) {
      const k = extraKey(q);
      if (k !== undefined && this.extras.has(k)) this.alsoModel.add(k);
      else this.put(q);
      this.refer(q, 1);
      this.touch(q);
    }
  }

  /** How many quads the model has. */
  get size(): number {
    return this.data.size - this.extras.size + this.alsoModel.size;
  }

  /**
   * Validate the model as it is now: the whole of it after it was loaded, the
   * metamodels changed, or now and then; else only the nodes whose findings
   * what changed can change — the subjects of the changed triples and the
   * nodes up to the shapes' reach before them, and the objects (a target of
   * `sh:targetObjectsOf`) — their findings replacing theirs of the last time.
   */
  validate(): PlainReport {
    if (!this.ready || this.size === 0) {
      this.findings = { shacl: new Map(), tables: new Map(), sparql: new Map(), references: new Map() };
      this.clearChanged();
      return { conforms: true, results: [], timing: { shacl: 0, tables: 0, nodes: 0 } };
    }
    const nodes = this.findings && !this.changed.all ? this.affected() : undefined;
    // The SPARQL-based constraints reach as their queries do, not as the shapes say: around what changed, both ways.
    const sparqlNodes = nodes && this.sparqlRunner ? this.around(SPARQL_HOPS) : undefined;
    const timing = nodes ? this.validateNodes(nodes, sparqlNodes) : this.validateWhole();
    this.clearChanged();
    return this.report(timing);
  }

  private validateWhole(): PlainReport['timing'] {
    const t0 = now();
    const options = { recursionGuard: this.reach.recursive };
    const shacl = this.split.kept.length > 0 ? this.validator.validateStore(this.data, this.split.kept, options).results : [];
    const t1 = now();
    const byTables = checkRelationshipsByTables(this.data as unknown as Iterable<Quad>, this.split, this.tables, this.closure);
    const t2 = now();
    const sparql = this.sparqlRunner?.run() ?? [];
    const t3 = now();
    const references = missingReferences(this.data as never);
    const t4 = now();
    this.findings = { shacl: byFocus(shacl), tables: byFocus(byTables), sparql: byFocus(sparql), references: byFocus(references) };
    this.sinceWhole = 0;
    return { shacl: Math.round(t1 - t0), tables: Math.round(t2 - t1), sparql: Math.round(t3 - t2), references: Math.round(t4 - t3), nodes: 'all' };
  }

  private validateNodes(nodes: Map<string, Term>, sparqlNodes?: Map<string, Term>): PlainReport['timing'] {
    const findings = this.findings as NonNullable<ValidationEngine['findings']>;
    const focus = [...nodes.values()];
    const t0 = now();
    const options = { recursionGuard: this.reach.recursive };
    const shacl = this.split.kept.length > 0 ? this.validator.validateNodes(this.data, this.split.kept, focus, options).results : [];
    const t1 = now();
    const byTables = checkRelationshipsByTables(this.triplesOf(focus), this.split, this.tables, this.closure);
    const t2 = now();
    // Too many nodes around what changed: the SPARQL-based constraints run on the whole model.
    const sparql = this.sparqlRunner ? (sparqlNodes ? this.sparqlRunner.run([...sparqlNodes.values()]) : this.sparqlRunner.run()) : [];
    const t3 = now();
    const references = missingReferences(this.data as never, focus);
    const t4 = now();
    for (const key of nodes.keys()) {
      findings.shacl.delete(key);
      findings.tables.delete(key);
      findings.references.delete(key);
    }
    if (sparqlNodes) for (const key of sparqlNodes.keys()) findings.sparql.delete(key);
    else findings.sparql.clear();
    for (const [key, results] of byFocus(shacl)) findings.shacl.set(key, results);
    for (const [key, results] of byFocus(byTables)) findings.tables.set(key, results);
    for (const [key, results] of byFocus(sparql)) findings.sparql.set(key, results);
    for (const [key, results] of byFocus(references)) findings.references.set(key, results);
    this.sinceWhole++;
    return { shacl: Math.round(t1 - t0), tables: Math.round(t2 - t1), sparql: Math.round(t3 - t2), references: Math.round(t4 - t3), nodes: nodes.size };
  }

  /** The report from the findings kept — none about a resource the model only refers to. */
  private report(timing: PlainReport['timing']): PlainReport {
    const findings = this.findings as NonNullable<ValidationEngine['findings']>;
    const keep = (r: ValidationResult) => !this.outsideOnly(r.focusNode.value);
    const shacl = [...findings.shacl.values()].flat().filter(keep);
    const others = [...findings.tables.values(), ...findings.sparql.values(), ...findings.references.values()].flat().filter(keep);
    return {
      // As SHACL reports it: conforming with no result at all; the rest with no violation.
      conforms: shacl.length === 0 && !others.some((r) => r.severity === 'Violation'),
      results: [...shacl, ...others].map(plain),
      timing,
    };
  }

  /**
   * The nodes whose findings what changed can change, by key — or `undefined`
   * when the whole model is to be validated: the class hierarchy changed, the
   * shapes reach without bound or report one node's findings as another's, it
   * is time to, or the nodes are too many.
   */
  private affected(): Map<string, Term> | undefined {
    if (this.sinceWhole >= FULL_EVERY || !Number.isFinite(this.reach.hops) || this.reach.valuesAsFocus) return undefined;
    const nodes = new Map<string, Term>(this.changed.subjects);
    for (const [key, term] of this.changed.objects) nodes.set(key, term);
    // The table check reads a relationship's ends: one hop at least.
    const hops = Math.max(1, this.reach.hops);
    const limit = Math.max(FULL_FLOOR, this.size / FULL_SHARE);
    let frontier = this.reach.inverse ? [...nodes.values()] : [...this.changed.subjects.values()];
    for (let hop = 0; hop < hops && frontier.length > 0; hop++) {
      const next: Term[] = [];
      const add = (term: Term) => {
        if (term.termType !== 'NamedNode' && term.termType !== 'BlankNode') return;
        const key = keyOf(term);
        if (nodes.has(key)) return;
        nodes.set(key, term);
        next.push(term);
      };
      for (const node of frontier) {
        for (const q of this.data.getQuads(null, null, node as never, null)) add(q.subject as unknown as Term);
        if (this.reach.inverse) for (const q of this.data.getQuads(node as never, null, null, null)) add(q.object as unknown as Term);
        if (nodes.size > limit) return undefined;
      }
      frontier = next;
    }
    return nodes;
  }

  /**
   * The nodes within `hops` of what changed, both ways — or `undefined` when
   * they are too many and the whole model is to be validated.
   */
  private around(hops: number): Map<string, Term> | undefined {
    const nodes = new Map<string, Term>(this.changed.subjects);
    for (const [key, term] of this.changed.objects) nodes.set(key, term);
    const limit = Math.max(FULL_FLOOR, this.size / FULL_SHARE);
    let frontier = [...nodes.values()];
    for (let hop = 0; hop < hops && frontier.length > 0; hop++) {
      const next: Term[] = [];
      const add = (term: Term) => {
        if (term.termType !== 'NamedNode' && term.termType !== 'BlankNode') return;
        const key = keyOf(term);
        if (nodes.has(key)) return;
        nodes.set(key, term);
        next.push(term);
      };
      for (const node of frontier) {
        for (const q of this.data.getQuads(null, null, node as never, null)) add(q.subject as unknown as Term);
        for (const q of this.data.getQuads(node as never, null, null, null)) add(q.object as unknown as Term);
        if (nodes.size > limit) return undefined;
      }
      frontier = next;
    }
    return nodes;
  }

  /** What the table check reads of these nodes: their triples, and the types of what they point to. */
  private triplesOf(nodes: readonly Term[]): Quad[] {
    const quads: Quad[] = [];
    const typed = new Set<string>();
    const type = DataFactory.namedNode(RDF_TYPE);
    for (const node of nodes) {
      for (const q of this.data.getQuads(node as never, null, null, null) as unknown as Quad[]) {
        quads.push(q);
        const o = q.object;
        if ((o.termType === 'NamedNode' || o.termType === 'BlankNode') && !typed.has(keyOf(o))) {
          typed.add(keyOf(o));
          quads.push(...(this.data.getQuads(o as never, type, null, null) as unknown as Quad[]));
        }
      }
    }
    return quads;
  }

  /** Note a changed triple: its subject, and its object when a node; a change to the class hierarchy changes everything. */
  private touch(q: Quad): void {
    if (this.changed.all) return;
    if (q.predicate.value === RDFS_SUBCLASS_OF) {
      this.changed.all = true;
      return;
    }
    this.changed.subjects.set(keyOf(q.subject), q.subject);
    const o = q.object;
    if (o.termType === 'NamedNode' || o.termType === 'BlankNode') this.changed.objects.set(keyOf(o), o);
  }

  private clearChanged(): void {
    this.changed = { subjects: new Map(), objects: new Map(), all: false };
  }

  /** The extras for the model the store holds (and nothing else): the hierarchy, the types of what it refers to. */
  private addExtras(): void {
    for (const q of this.hierarchy) this.addExtra(q);
    const type = DataFactory.namedNode(RDF_TYPE);
    for (const [iri, types] of this.outsideTypes) {
      const object = DataFactory.namedNode(iri);
      const n = this.data.countQuads(null, null, object, null) - this.data.countQuads(null, type, object, null);
      if (n <= 0) continue;
      this.references.set(iri, n);
      for (const q of types) this.addExtra(q);
    }
  }

  /** A model quad added (+1) or removed (−1): the outside resource it refers to gains or loses a reference — and its types with the first or the last. */
  private refer(q: Quad, delta: 1 | -1): void {
    if (q.predicate.value === RDF_TYPE || q.object.termType !== 'NamedNode') return;
    const types = this.outsideTypes.get(q.object.value);
    if (!types) return;
    const before = this.references.get(q.object.value) ?? 0;
    const after = before + delta;
    if (after > 0) this.references.set(q.object.value, after);
    else this.references.delete(q.object.value);
    if (before === 0 && after > 0) for (const t of types) this.addExtra(t);
    if (before > 0 && after <= 0) for (const t of types) this.removeExtra(t);
  }

  private addExtra(q: Quad): void {
    const k = extraKey(q) as string;
    if (this.extras.has(k)) return;
    this.extras.set(k, q);
    if (this.data.has(q as never)) this.alsoModel.add(k);
    else this.put(q);
    this.touch(q);
  }

  private removeExtra(q: Quad): void {
    const k = extraKey(q) as string;
    if (!this.extras.delete(k)) return;
    this.touch(q);
    if (this.alsoModel.delete(k)) return; // the model holds it
    this.drop(q);
  }

  /**
   * Whether a node is a resource the model only refers to: outside it, its types
   * among the extras, nothing else said of it in the data. What the shapes find
   * of it is not the model's to fix — and not true either: only its types are
   * validated, not the rest of what its metamodel says (a catalogue's viewpoint
   * found to declare no concepts).
   */
  private outsideOnly(iri: string): boolean {
    if (!this.references.has(iri)) return false;
    for (const q of this.data.getQuads(DataFactory.namedNode(iri), null, null, null)) {
      const k = extraKey(q as unknown as Quad);
      if (k === undefined || !this.extras.has(k) || this.alsoModel.has(k)) return false;
    }
    return true;
  }

  /** A node's name in the model (`skos:prefLabel`, English first), for the SPARQL-based constraints' messages. */
  private nameOf(iri: string): string | undefined {
    const names = this.data.getQuads(DataFactory.namedNode(iri), DataFactory.namedNode(PREF_LABEL), null, null);
    const pick = names.find((q) => (q.object as { language?: string }).language === 'en') ?? names[0];
    return pick?.object.value;
  }

  /** A quad into the data — and its Oxigraph copy. */
  private put(q: Quad): void {
    this.data.addQuad(q as never);
    this.sparqlData?.add(toOxQuad(q));
  }

  /** A quad out of the data — and its Oxigraph copy. */
  private drop(q: Quad): void {
    this.data.removeQuad(q as never);
    this.sparqlData?.delete(toOxQuad(q));
  }

  /** The Oxigraph copy made again from the data and the context — or none, without SPARQL-based constraints to run. */
  private rebuildSparqlData(): void {
    if (!this.sparqlRunner) {
      this.sparqlData = undefined;
      return;
    }
    const store = new oxigraph.Store();
    for (const q of this.data) store.add(toOxQuad(q as unknown as Quad));
    const context = oxigraph.namedNode(CONTEXT_GRAPH);
    for (const q of this.sparqlContext) {
      const ox = toOxQuad(q);
      store.add(oxigraph.quad(ox.subject, ox.predicate, ox.object, context));
    }
    this.sparqlData = store;
  }
}

/** A node's key: its value — as a result's focus node carries it. */
function keyOf(term: Term): string {
  return term.value;
}

/** Results by their focus node's key. */
function byFocus(results: readonly ValidationResult[]): Map<string, ValidationResult[]> {
  const map = new Map<string, ValidationResult[]>();
  for (const r of results) {
    const list = map.get(r.focusNode.value);
    if (list) list.push(r);
    else map.set(r.focusNode.value, [r]);
  }
  return map;
}

/** The quad in the default graph, where the engine keeps everything. */
function inDefaultGraph(q: Quad): Quad {
  return q.graph.termType === 'DefaultGraph' ? q : (DataFactory.quad(q.subject as never, q.predicate as never, q.object as never) as unknown as Quad);
}

/** A key for a quad that can be an extra — `rdfs:subClassOf` or `rdf:type` — else `undefined`. */
function extraKey(q: Quad): string | undefined {
  const p = q.predicate.value;
  if (p !== RDF_TYPE && p !== RDFS_SUBCLASS_OF) return undefined;
  return `${termToId(q.subject as never)} ${p} ${termToId(q.object as never)}`;
}

function plain(r: ValidationResult): PlainResult {
  return {
    focusNode: r.focusNode.value,
    resultPath: r.resultPath.value,
    sourceShape: r.sourceShape.value,
    message: r.message,
    severity: r.severity,
    ...(r.sourceConstraintComponent ? { sourceConstraintComponent: r.sourceConstraintComponent.value } : {}),
    ...(r.withinShape ? { withinShape: r.withinShape.value } : {}),
  };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** The report back from plain data, its IRIs as terms. */
export function fromPlainReport(report: Pick<PlainReport, 'conforms' | 'results'>, namedNode: (iri: string) => unknown): ValidationReport {
  return {
    conforms: report.conforms,
    results: report.results.map((r) => ({
      focusNode: namedNode(r.focusNode) as ValidationResult['focusNode'],
      resultPath: namedNode(r.resultPath) as ValidationResult['resultPath'],
      sourceShape: namedNode(r.sourceShape) as ValidationResult['sourceShape'],
      message: r.message,
      severity: r.severity,
      ...(r.sourceConstraintComponent ? { sourceConstraintComponent: namedNode(r.sourceConstraintComponent) as ValidationResult['focusNode'] } : {}),
      ...(r.withinShape ? { withinShape: namedNode(r.withinShape) as ValidationResult['focusNode'] } : {}),
    })),
  };
}
