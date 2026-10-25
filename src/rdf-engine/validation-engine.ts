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
 * outside it (a view's viewpoint). How: the relationship shapes the tables cover
 * by lookup in the tables (`relationship-validity.ts`), the rest by SHACL.
 */
import { DataFactory, Store as N3Store, termToId } from 'n3';
import type { Quad } from '@rdfjs/types';
import { RdfShaclValidator } from './shacl-validator.js';
import type { ValidationReport, ValidationResult } from './interfaces.js';
import { NAMESPACES } from './namespaces.js';
import { decodeQuads, type EncodedQuad } from './term-codec.js';
import { NO_TABLE_PERMISSIONS, TablePermissions, type PlainTablePermissions } from '../model-manager/direct-permissions.js';
import { checkRelationshipsByTables, noTableShapes, splitTableShapes, type TableShapes } from '../model-manager/relationship-validity.js';
import type { TypeClosure } from '../model-manager/model-queries.js';

const RDF_TYPE = NAMESPACES.rdf + 'type';
const RDFS_SUBCLASS_OF = NAMESPACES.rdfs + 'subClassOf';
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
}

/** A result as plain data: IRIs as strings. */
export interface PlainResult {
  focusNode: string;
  resultPath: string;
  sourceShape: string;
  message: string;
  severity: ValidationResult['severity'];
  sourceConstraintComponent?: string;
}

/** A report as plain data. */
export interface PlainReport {
  conforms: boolean;
  results: PlainResult[];
  /** How long it took, in ms: SHACL, the tables. */
  timing: { shacl: number; tables: number };
}

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
  private ready = false;

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
    this.split = splitTableShapes(decodeQuads(setup.shapes), this.tables, formOf, (c) => closure(c).includes(QUALIFIED_RELATIONSHIP));
    this.ready = true;
  }

  /** Replace the model with these quads (default graph). */
  load(quads: readonly EncodedQuad[]): void {
    this.data = new N3Store();
    this.extras.clear();
    this.alsoModel.clear();
    this.references.clear();
    this.data.addQuads(decodeQuads(quads) as never);
    this.addExtras();
  }

  /** Apply a change to the model. */
  apply(added: readonly EncodedQuad[], removed: readonly EncodedQuad[]): void {
    for (const q of decodeQuads(removed)) {
      const k = extraKey(q);
      if (k !== undefined && this.extras.has(k)) this.alsoModel.delete(k);
      else this.data.removeQuad(q as never);
      this.refer(q, -1);
    }
    for (const q of decodeQuads(added)) {
      const k = extraKey(q);
      if (k !== undefined && this.extras.has(k)) this.alsoModel.add(k);
      else this.data.addQuad(q as never);
      this.refer(q, 1);
    }
  }

  /** How many quads the model has. */
  get size(): number {
    return this.data.size - this.extras.size + this.alsoModel.size;
  }

  /** Validate the model as it is now. */
  validate(): PlainReport {
    if (!this.ready || this.size === 0) return { conforms: true, results: [], timing: { shacl: 0, tables: 0 } };
    const t0 = now();
    const shacl = this.split.kept.length > 0 ? this.validator.validateStore(this.data, this.split.kept) : { conforms: true, results: [] };
    const t1 = now();
    const byTables = checkRelationshipsByTables(this.data as unknown as Iterable<Quad>, this.split, this.tables, this.closure);
    const t2 = now();
    const results = [...shacl.results, ...byTables].map(plain);
    return {
      conforms: shacl.conforms && !byTables.some((r) => r.severity === 'Violation'),
      results,
      timing: { shacl: Math.round(t1 - t0), tables: Math.round(t2 - t1) },
    };
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
    else this.data.addQuad(q as never);
  }

  private removeExtra(q: Quad): void {
    const k = extraKey(q) as string;
    if (!this.extras.delete(k)) return;
    if (this.alsoModel.delete(k)) return; // the model holds it
    this.data.removeQuad(q as never);
  }
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
    })),
  };
}
