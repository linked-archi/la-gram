/**
 * The metamodels the Metamodels menu offers: meta.linked.archi's catalogue.
 *
 * meta.linked.archi publishes a DCAT catalogue of its semantic assets at
 * {@link CATALOGUE_IRI} (Turtle by content negotiation, or `/catalog.ttl`). A
 * metamodel manifest's dataset names its `arch:Metamodel` with
 * `foaf:primaryTopic`, with that metamodel's `skos:prefLabel`, and carries the
 * section of the site's index it is listed in as its `dcat:theme` — a concept
 * whose `skos:notation` is `languages`, `frameworks`, `extensions` or `core`.
 * Those four sections are what the menu lists, by section and label; a
 * metamodel in any other (the examples) is not offered, and any metamodel at
 * all still loads through "Load by IRI" or an upload.
 *
 * The catalogue is read like any published document: a copy ships in
 * `assets/catalog.ttl` (refreshed by `npm run sync-assets`), so the menu is
 * complete offline, and `App.loadCatalogue` replaces it with the published one
 * when it arrives — a metamodel meta.linked.archi publishes appears without a
 * new la-gram. Every metamodel offered is meta.linked.archi's: for elements and
 * relationships no loaded language has, Basic is the generic language (its
 * Connection relates any two elements).
 */

import type { Quad } from '@rdfjs/types';
import { parseRdf, type AssetSource } from './asset-sources.js';
import { CATALOGUE_IRI } from './bundled-assets.js';

export { CATALOGUE_IRI };

/** What a catalogue entry describes. */
export type CatalogueKind = 'core' | 'language' | 'framework' | 'extension';

/** One published metamodel. */
export interface CatalogueEntry {
  /** The `arch:Metamodel` subject IRI. */
  iri: string;
  label: string;
  kind: CatalogueKind;
}

/** Section titles for {@link CatalogueKind}. */
export const CATALOGUE_KIND_LABELS: Record<CatalogueKind, string> = {
  core: 'Core',
  language: 'Modelling languages',
  framework: 'Frameworks',
  extension: 'Extensions',
};

/** The catalogue sections (theme notations) the menu lists, and the kind each is. */
const KIND_BY_THEME: Record<string, CatalogueKind> = {
  core: 'core',
  languages: 'language',
  frameworks: 'framework',
  extensions: 'extension',
};

const KIND_ORDER: readonly CatalogueKind[] = ['core', 'language', 'framework', 'extension'];

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const DCAT = 'http://www.w3.org/ns/dcat#';
const DCTERMS_CONFORMS_TO = 'http://purl.org/dc/terms/conformsTo';
const FOAF_PRIMARY_TOPIC = 'http://xmlns.com/foaf/0.1/primaryTopic';
const SKOS = 'http://www.w3.org/2004/02/skos/core#';
const ARCH_METAMODEL = 'https://meta.linked.archi/core#Metamodel';

/**
 * The metamodels a catalogue offers, by section and label. A label loses the " Metamodel" every manifest's label ends in
 * ("ArchiMate 4.0 Metamodel" → "ArchiMate 4.0"): the menu is all metamodels.
 */
export function readCatalogue(quads: readonly Quad[]): CatalogueEntry[] {
  const values = new Map<string, Map<string, string[]>>();
  const labels = new Map<string, string>();
  for (const q of quads) {
    const s = q.subject.value;
    const p = q.predicate.value;
    if (p === SKOS + 'prefLabel') {
      // English first, then an untagged label.
      const lang = q.object.termType === 'Literal' ? q.object.language : '';
      if (lang === 'en' || (lang === '' && !labels.has(s))) labels.set(s, q.object.value);
      continue;
    }
    const byPredicate = values.get(s) ?? new Map<string, string[]>();
    byPredicate.set(p, [...(byPredicate.get(p) ?? []), q.object.value]);
    values.set(s, byPredicate);
  }
  const get = (s: string, p: string) => values.get(s)?.get(p) ?? [];

  const entries = new Map<string, CatalogueEntry>();
  for (const [dataset, byPredicate] of values) {
    if (!(byPredicate.get(RDF_TYPE) ?? []).includes(DCAT + 'Dataset')) continue;
    if (!(byPredicate.get(DCTERMS_CONFORMS_TO) ?? []).includes(ARCH_METAMODEL)) continue;
    const kind = (byPredicate.get(DCAT + 'theme') ?? [])
      .map((theme) => KIND_BY_THEME[get(theme, SKOS + 'notation')[0] ?? theme.slice(theme.lastIndexOf('#') + 1)])
      .find((k): k is CatalogueKind => k !== undefined);
    if (!kind) continue;
    for (const iri of byPredicate.get(FOAF_PRIMARY_TOPIC) ?? []) {
      if (entries.has(iri)) continue;
      const label = (labels.get(iri) ?? iri.slice(iri.lastIndexOf('#') + 1)).replace(/\s+Metamodel$/i, '');
      entries.set(iri, { iri, label, kind });
    }
  }
  return [...entries.values()].sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }),
  );
}

/** The metamodels of the catalogue `source` has, or `null` when it has none. */
export async function loadCatalogue(source: AssetSource): Promise<CatalogueEntry[] | null> {
  const doc = await source.fetch(CATALOGUE_IRI);
  if (!doc) return null;
  return readCatalogue(parseRdf(doc.text, doc.format, CATALOGUE_IRI));
}
