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
 * {model}/graph/model      the arch:Model resource and its conformance
 * {model}/graph/semantic   elements, relationships, views, membership
 * {model}/graph/views      arch-vis geometry only — droppable on its own
 * ```
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
import type { NamedNode, Quad } from '@rdfjs/types';
import * as oxigraph from 'oxigraph';
import type { PrefixMap, RdfStore } from '../rdf-engine/interfaces.js';
import { NAMESPACES, PREFIXES } from '../rdf-engine/namespaces.js';
import { detectFormat, parseRdf, type AssetFormat } from '../metamodel-manager/asset-sources.js';
import { modelQuads } from '../model-manager/model-queries.js';
import { IRI, nn } from '../model-manager/vocabulary.js';

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
  /** Extra prefixes on top of the derived ones. */
  prefixes?: PrefixMap;
}

/** The DD-15 partition of a model. */
export interface ModelPartition {
  model: Quad[];
  semantic: Quad[];
  views: Quad[];
}

/** Graph IRIs of the partition for a model. */
export function partitionGraphs(modelIri: string): { model: string; semantic: string; views: string } {
  const base = modelIri.replace(/[/#]+$/, '');
  return { model: `${base}/graph/model`, semantic: `${base}/graph/semantic`, views: `${base}/graph/views` };
}

/**
 * Split model quads into the three DD-15 graphs.
 *
 * Geometry is every `arch-vis:` diagram element (by type) plus the list cells
 * of their point lists (typed nothing, found by walking from `arch-vis:points`).
 * The line falls around geometry, not around views: an `arch:View` is a model
 * concept and stays in the semantic graph.
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

  const partition: ModelPartition = { model: [], semantic: [], views: [] };
  for (const q of quads) {
    if (geometry.has(q.subject.value)) partition.views.push(q);
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
   * a hard-coded table), and `m:` for the model's own namespace.
   */
  collectPrefixes(modelIri?: string, extra?: PrefixMap): PrefixMap {
    const prefixes: PrefixMap = { ...PREFIXES };
    const prefixOf = new Map<string, string>();
    const uriOf = new Map<string, string>();
    for (const q of this.store.getQuads(null, nn(NAMESPACES.vann + 'preferredNamespacePrefix'))) {
      prefixOf.set(q.subject.value, q.object.value);
    }
    for (const q of this.store.getQuads(null, nn(NAMESPACES.vann + 'preferredNamespaceUri'))) {
      uriOf.set(q.subject.value, q.object.value);
    }
    for (const [subject, prefix] of prefixOf) {
      const uri = uriOf.get(subject);
      if (uri && /^[A-Za-z][\w-]*$/.test(prefix) && !(prefix in prefixes)) prefixes[prefix] = uri;
    }
    if (modelIri) prefixes.m = `${modelIri.replace(/[/#]+$/, '')}/`;
    return { ...prefixes, ...extra };
  }

  /** Serialize the model. */
  serialize(modelIri: string | undefined, options: SerializeOptions = {}): string {
    const format = formatInfo(options.format ?? 'turtle');
    const partition = partitionModel(this.modelQuads(), modelIri);
    if (options.profile === 'no-geometry') partition.views = [];

    if (!format.graphs || !modelIri) {
      return this.write([...partition.model, ...partition.semantic, ...partition.views], format, modelIri, options.prefixes);
    }
    const graphs = partitionGraphs(modelIri);
    const regraph = (quads: Quad[], graph: string) =>
      quads.map((q) => DataFactory.quad(q.subject as never, q.predicate as never, q.object as never, DataFactory.namedNode(graph)) as unknown as Quad);
    return this.write(
      [
        ...regraph(partition.model, graphs.model),
        ...regraph(partition.semantic, graphs.semantic),
        ...regraph(partition.views, graphs.views),
      ],
      format,
      modelIri,
      options.prefixes,
    );
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
      const prefixes = usedPrefixes(this.collectPrefixes(modelIri, extra), sorted);
      const writer = new N3Writer({ prefixes, format: format.id === 'trig' ? 'application/trig' : 'text/turtle' });
      for (const q of sorted) writer.addQuad(q as never);
      let output = '';
      writer.end((_err: Error | null, result: string) => {
        output = result ?? '';
      });
      return output;
    }
    // The rest through Oxigraph's serializers, which cover JSON-LD and RDF/XML.
    const scratch = new oxigraph.Store();
    const nquads = new N3Writer({ format: 'application/n-quads' });
    for (const q of sorted) nquads.addQuad(q as never);
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

/** Parse any supported model format into quads. */
export function parseModelText(text: string, format: AssetFormat): Quad[] {
  if (format === 'application/ld+json' || format === 'application/rdf+xml') return parseRdf(text, format);
  return new N3Parser({ format }).parse(text) as unknown as Quad[];
}

/** Keep only prefixes some IRI in the output actually uses. */
function usedPrefixes(prefixes: PrefixMap, quads: Quad[]): PrefixMap {
  const iris = new Set<string>();
  for (const q of quads) {
    for (const term of [q.subject, q.predicate, q.object, q.graph]) {
      if (term.termType === 'NamedNode') iris.add(term.value);
      if (term.termType === 'Literal') {
        const datatype = (term as { datatype?: NamedNode }).datatype?.value;
        if (datatype) iris.add(datatype);
      }
    }
  }
  const used: PrefixMap = {};
  for (const [prefix, uri] of Object.entries(prefixes)) {
    for (const iri of iris) {
      if (iri.startsWith(uri) && iri.length > uri.length) {
        used[prefix] = uri;
        break;
      }
    }
  }
  return used;
}

/** Graph, then subject, then predicate, then object — deterministic output (Req 9.12). */
function compareQuads(a: Quad, b: Quad): number {
  return (
    cmp(a.graph.value, b.graph.value) ||
    cmp(a.subject.value, b.subject.value) ||
    cmp(a.predicate.value, b.predicate.value) ||
    cmp(a.object.value, b.object.value)
  );
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
