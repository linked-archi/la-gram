/**
 * Reading and writing a model — only the model, never the metamodel.
 *
 * ## At rest vs. at runtime
 *
 * At runtime the model is the store's default graph (see
 * `model-manager/model-queries.ts`). At rest it follows the published layout
 * (DD-15 in the Linked.Archi design decisions) when the format can carry graphs:
 *
 * ```
 * {ns}graph/model      the arch:Model resource and its conformance
 * {ns}graph/semantic   elements, relationships, views, membership
 * {ns}graph/views      arch-vis geometry only — droppable on its own
 * {ns}graph/provenance how it came to be: a converter's run, la-gram's editing activities (DD-27)
 * ```
 *
 * `{ns}` is the model's namespace, `{base}{notation}/{modelId}/`, so the graph
 * IRIs are exactly DD-15's. The same namespace is written as the `m:` prefix
 * (or whatever prefix the model declares), with a prefix per kind and per view
 * derived from it, and what no prefix fits relative to `@base` (DD-41,
 * `rdf-engine/turtle-writer.ts`): the Turtle reads `m:element-…`, `me:…` and
 * `mv…:node-…` rather than full IRIs.
 *
 * TriG, N-Quads and JSON-LD get that partition. Turtle, N-Triples and RDF/XML
 * cannot name graphs, so they get the union; `arch:inModel` on every concept is
 * what keeps membership recoverable there, which is why the model layer always
 * writes it.
 *
 * ## Profiles
 *
 * `no-geometry` drops the views graph — the diagrams survive as `arch:View`
 * resources with `arch:inView` membership, only the coordinates go. That is the
 * profile to hand to a pipeline that reasons over the architecture and has no
 * use for layout.
 *
 * ## Loading
 *
 * Every quad of a loaded file goes into the default graph, whatever graph it
 * came in: a model is edited as one graph, and re-partitioned on save.
 */

import { Writer as N3Writer, DataFactory, Parser as N3Parser } from 'n3';
import type { Quad } from '@rdfjs/types';
import * as oxigraph from 'oxigraph';
import type { PrefixMap, RdfStore } from '../rdf-engine/interfaces.js';
import { NAMESPACES, PREFIXES } from '../rdf-engine/namespaces.js';
import { detectFormat, parseRdf, type AssetFormat } from '../metamodel-manager/asset-sources.js';
import { modelQuads } from '../model-manager/model-queries.js';
import { readModelNamespace } from '../model-manager/model-namespace.js';
import { ensureNamespace } from '../rdf-engine/iri.js';
import { KIND_PREFIXES, writeTurtle } from '../rdf-engine/turtle-writer.js';
import { IRI, nn } from '../model-manager/vocabulary.js';
import { isProvenanceStatement, provenanceSubjects } from '../model-manager/provenance.js';

/** File formats a model can be saved in. */
export type ModelFormat = 'turtle' | 'trig' | 'n-triples' | 'n-quads' | 'json-ld' | 'rdf-xml';

/** Descriptor of a {@link ModelFormat}. */
export interface ModelFormatInfo {
  id: ModelFormat;
  label: string;
  mediaType: AssetFormat;
  extension: string;
  /** Whether the format carries named graphs (and so the DD-15 partition). */
  graphs: boolean;
}

/** Every supported format, Turtle first (the default). */
export const MODEL_FORMATS: readonly ModelFormatInfo[] = [
  { id: 'turtle', label: 'Turtle', mediaType: 'text/turtle', extension: 'ttl', graphs: false },
  { id: 'trig', label: 'TriG (graph per layer)', mediaType: 'application/trig', extension: 'trig', graphs: true },
  { id: 'json-ld', label: 'JSON-LD', mediaType: 'application/ld+json', extension: 'jsonld', graphs: true },
  { id: 'n-quads', label: 'N-Quads', mediaType: 'application/n-quads', extension: 'nq', graphs: true },
  { id: 'n-triples', label: 'N-Triples', mediaType: 'application/n-triples', extension: 'nt', graphs: false },
  { id: 'rdf-xml', label: 'RDF/XML', mediaType: 'application/rdf+xml', extension: 'rdf', graphs: false },
];

/** Look a format up by id. */
export function formatInfo(id: ModelFormat): ModelFormatInfo {
  return MODEL_FORMATS.find((f) => f.id === id) ?? MODEL_FORMATS[0];
}

/** Which subset of the model to write. */
export type SerializationProfile = 'full' | 'no-geometry';

/** Options for {@link ModelIO.serialize}. */
export interface SerializeOptions {
  format?: ModelFormat;
  profile?: SerializationProfile;
  /** Whether to write the provenance (`{ns}graph/provenance`): yes unless `false` — the RDF panel's switch. */
  provenance?: boolean;
  /** Extra prefixes on top of the derived ones. */
  prefixes?: PrefixMap;
  /**
   * Only these statements — a view's, a concept's (`model-manager/rdf-scope.ts`)
   * — written as the whole model would be: the same prefixes, order and graphs.
   */
  quads?: Quad[];
}

/** The DD-15 partition of a model. */
export interface ModelPartition {
  model: Quad[];
  semantic: Quad[];
  views: Quad[];
  provenance: Quad[];
}

/** Graph IRIs of the partition, in a model's namespace. */
export function partitionGraphs(namespace: string): { model: string; semantic: string; views: string; provenance: string } {
  const ns = ensureNamespace(namespace);
  return {
    model: `${ns}graph/model`,
    semantic: `${ns}graph/semantic`,
    views: `${ns}graph/views`,
    provenance: `${ns}graph/provenance`,
  };
}

/**
 * Split model quads into the three DD-15 graphs.
 *
 * Geometry is every `arch-vis:` diagram element (by type) plus the list cells
 * of their point lists (typed nothing, found by walking from `arch-vis:points`).
 * The line falls around geometry, not around views: an `arch:View` is a model
 * concept and stays in the semantic graph.
 *
 * Provenance is every PROV statement and every statement about a resource a PROV
 * class types — an activity, an agent, a source entity, a bundle (DD-27): a
 * converter's run, la-gram's editing activities, a derivation's activity. A
 * concept's `dcterms:created` and `dcterms:modified` describe it, and stay with it.
 */
export function partitionModel(quads: Quad[], modelIri: string | undefined): ModelPartition {
  const geometry = new Set<string>();
  const visTypes = new Set<string>();
  for (const q of quads) {
    if (q.predicate.value === IRI.rdfType && q.object.value.startsWith(NAMESPACES['arch-vis'])) {
      geometry.add(q.subject.value);
      visTypes.add(q.subject.value);
    }
  }
  // Point-list cells: reachable from a diagram element's arch-vis:points.
  const rest = new Map<string, string>();
  for (const q of quads) if (q.predicate.value === IRI.rdfRest) rest.set(q.subject.value, q.object.value);
  for (const q of quads) {
    if (q.predicate.value !== IRI.points || !visTypes.has(q.subject.value)) continue;
    let cell: string | undefined = q.object.value;
    while (cell && cell !== IRI.rdfNil && !geometry.has(cell)) {
      geometry.add(cell);
      cell = rest.get(cell);
    }
  }

  const provenance = provenanceSubjects(quads);
  const partition: ModelPartition = { model: [], semantic: [], views: [], provenance: [] };
  for (const q of quads) {
    if (geometry.has(q.subject.value)) partition.views.push(q);
    else if (isProvenanceStatement(q, provenance)) partition.provenance.push(q);
    else if (modelIri && q.subject.value === modelIri) partition.model.push(q);
    else partition.semantic.push(q);
  }
  return partition;
}

/** Result of {@link ModelIO.load}. */
export interface ModelLoadResult {
  quadCount: number;
  format: AssetFormat;
}

/** Saves and opens models against the store's default graph. */
export class ModelIO {
  constructor(private readonly store: RdfStore) {}

  /** The model's quads, as they are in the store (the default graph). */
  modelQuads(): Quad[] {
    return modelQuads(this.store);
  }

  /**
   * Prefixes for writing: the standard ones, every `vann:preferredNamespace…`
   * pair a loaded vocabulary declares (so `am4:`, `bpmn:`, `c4:` appear without
   * a hard-coded table), and `m:` (or the prefix the model declares) for the
   * model's own namespace — which wins over any other binding of that prefix.
   */
  collectPrefixes(modelIri?: string, extra?: PrefixMap): PrefixMap {
    const prefixes: PrefixMap = { ...PREFIXES };
    const prefixOf = new Map<string, string>();
    const uriOf = new Map<string, string>();
    // Vocabularies only (named graphs): the model's own pair is handled below.
    for (const q of this.store.getQuads(null, nn(NAMESPACES.vann + 'preferredNamespacePrefix'))) {
      if (q.graph.termType !== 'DefaultGraph') prefixOf.set(q.subject.value, q.object.value);
    }
    for (const q of this.store.getQuads(null, nn(NAMESPACES.vann + 'preferredNamespaceUri'))) {
      if (q.graph.termType !== 'DefaultGraph') uriOf.set(q.subject.value, q.object.value);
    }
    // In order of the prefix (then its namespace, for one declared twice), not of the store: the store
    // returns the declarations in the order the metamodels were loaded, which is the order their files
    // happened to arrive in — so the same model was written with its prefixes in another order on
    // another machine, and `la-gram-git check` failed there a file written here (Req 9.12).
    const declared = [...prefixOf]
      .map(([subject, prefix]) => [prefix, uriOf.get(subject)] as const)
      .filter((pair): pair is readonly [string, string] => !!pair[1] && /^[A-Za-z][\w-]*$/.test(pair[0]))
      .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0));
    for (const [prefix, uri] of declared) if (!(prefix in prefixes)) prefixes[prefix] = uri;
    if (modelIri) {
      const own = readModelNamespace(this.store, modelIri);
      // One prefix per namespace: drop another name bound to the same IRI.
      for (const [name, uri] of Object.entries(prefixes)) if (uri === own.namespace) delete prefixes[name];
      prefixes[own.prefix] = own.namespace;
      // A prefix per kind (DD-41) — `me:` for `{ns}element/` — so that the SPARQL tab, the history and the
      // graph show the model's IRIs short as a saved file does; not one a vocabulary holds for something else.
      const bound = new Set(Object.values(prefixes));
      for (const [suffix, segment] of KIND_PREFIXES) {
        const label = own.prefix + suffix;
        const uri = own.namespace + segment;
        if (!(label in prefixes) && !bound.has(uri)) prefixes[label] = uri;
      }
    }
    return { ...prefixes, ...extra };
  }

  /** Serialize the model. */
  serialize(modelIri: string | undefined, options: SerializeOptions = {}): string {
    const format = formatInfo(options.format ?? 'turtle');
    const partition = partitionModel(options.quads ?? this.modelQuads(), modelIri);
    if (options.profile === 'no-geometry') partition.views = [];
    if (options.provenance === false) partition.provenance = [];

    if (!format.graphs || !modelIri) {
      return this.write(
        [...partition.model, ...partition.semantic, ...partition.views, ...partition.provenance],
        format,
        modelIri,
        options.prefixes,
      );
    }
    const graphs = partitionGraphs(readModelNamespace(this.store, modelIri).namespace);
    const regraph = (quads: Quad[], graph: string) =>
      quads.map((q) => DataFactory.quad(q.subject as never, q.predicate as never, q.object as never, DataFactory.namedNode(graph)) as unknown as Quad);
    return this.write(
      [
        ...regraph(partition.model, graphs.model),
        ...regraph(partition.semantic, graphs.semantic),
        ...regraph(partition.views, graphs.views),
        ...regraph(partition.provenance, graphs.provenance),
      ],
      format,
      modelIri,
      options.prefixes,
    );
  }

  /**
   * Write any set of quads — a query's result — in a model format, with the
   * same prefixes and ordering a saved model gets.
   */
  serializeQuads(quads: Quad[], modelIri: string | undefined, format: ModelFormat = 'turtle'): string {
    return this.write(quads, formatInfo(format), modelIri);
  }

  /**
   * Parse a file and make it the model: the current model data is replaced,
   * every quad lands in the default graph.
   *
   * @param nameOrMediaType A file name or media type to pick the parser.
   */
  load(text: string, nameOrMediaType?: string): ModelLoadResult {
    const format = nameOrMediaType?.includes('/')
      ? detectFormat(nameOrMediaType)
      : detectFormat(null, nameOrMediaType);
    const quads = parseModelText(text, format);
    const current = this.modelQuads();
    if (current.length > 0) this.store.removeQuads(current);
    const flat = quads.map(
      (q) => DataFactory.quad(q.subject as never, q.predicate as never, q.object as never) as unknown as Quad,
    );
    this.store.addQuads(flat);
    return { quadCount: flat.length, format };
  }

  private write(quads: Quad[], format: ModelFormatInfo, modelIri: string | undefined, extra?: PrefixMap): string {
    const sorted = [...quads].sort(compareQuads);
    if (format.id === 'turtle' || format.id === 'trig') {
      // The model's IRIs written short as DD-41 says — a prefix per kind and per view, then relative to
      // `@base` — and every other prefix only where an IRI uses it.
      const own = modelIri ? readModelNamespace(this.store, modelIri) : undefined;
      return writeTurtle(sorted, {
        prefixes: this.collectPrefixes(modelIri, extra),
        onlyUsed: true,
        ...(own ? { model: { namespace: own.namespace, prefix: own.prefix } } : {}),
        format: format.id === 'trig' ? 'application/trig' : 'text/turtle',
      });
    }
    // The rest through Oxigraph's serializers, which cover JSON-LD and RDF/XML.
    // JSON-LD has no RDF 1.2 triple terms: the `rdf:reifies` a qualified
    // relationship carries is left out of it — it follows from the relationship's
    // ends and class, and loading the model puts it back (`ModelSession.adopt`).
    const expressible = format.id === 'json-ld' ? sorted.filter((q) => q.object.termType !== 'Quad') : sorted;
    const scratch = new oxigraph.Store();
    const nquads = new N3Writer({ format: 'application/n-quads' });
    for (const q of expressible) nquads.addQuad(q as never);
    let text = '';
    nquads.end((_err: Error | null, result: string) => {
      text = result ?? '';
    });
    scratch.load(text, { format: 'application/n-quads' });
    return scratch.dump({
      format: format.mediaType,
      ...(format.graphs ? {} : { from_graph_name: oxigraph.defaultGraph() }),
    });
  }
}

/** The format a path's extension names (`models/shop.ttl` → Turtle), or `undefined`. */
export function formatOfPath(path: string): ModelFormat | undefined {
  const extension = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase();
  return extension ? MODEL_FORMATS.find((f) => f.extension === extension)?.id : undefined;
}

/** Parse any supported model format into quads. */
export function parseModelText(text: string, format: AssetFormat): Quad[] {
  if (format === 'application/ld+json' || format === 'application/rdf+xml') return parseRdf(text, format);
  return new N3Parser({ format }).parse(text) as unknown as Quad[];
}

/** Graph, then subject, then `rdf:type` before other predicates, then object — deterministic output (Req 9.12). */
function compareQuads(a: Quad, b: Quad): number {
  return (
    cmp(a.graph.value, b.graph.value) ||
    cmp(a.subject.value, b.subject.value) ||
    // `a …` leads each subject's statements, as Turtle is written by hand.
    Number(b.predicate.value === IRI.rdfType) - Number(a.predicate.value === IRI.rdfType) ||
    cmp(a.predicate.value, b.predicate.value) ||
    cmp(a.object.value, b.object.value)
  );
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
