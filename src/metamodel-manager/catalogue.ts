/**
 * The metamodels published on `meta.linked.archi`.
 *
 * The site has no machine-readable catalogue endpoint yet (`/catalog` and `/`
 * answer 404 to `Accept: text/turtle`), so the list ships with the tool,
 * generated from the `arch:Metamodel` manifests in the `linked-archi-meta`
 * repository. Every entry is an `arch:Metamodel` subject IRI that dereferences
 * with `Accept: text/turtle` — the loader fetches the rest from it.
 *
 * The two bundled ArchiMate versions and the core metamodel load offline;
 * every other entry needs the network. The core metamodel (the core ontology's
 * generic element and relationship) is la-gram's own manifest, bundled, until
 * meta.linked.archi publishes one. A metamodel not in this list loads just the same through
 * "Load by IRI" or an upload.
 */

/** What a catalogue entry describes. */
export type CatalogueKind = 'core' | 'language' | 'framework' | 'extension';

/** One published metamodel. */
export interface CatalogueEntry {
  /** The `arch:Metamodel` subject IRI. */
  iri: string;
  label: string;
  kind: CatalogueKind;
}

/** Every published metamodel: the core, modelling languages, then frameworks, then extensions. */
export const METAMODEL_CATALOGUE: readonly CatalogueEntry[] = [
  // Bundled; its manifest is la-gram's own until meta.linked.archi publishes one.
  { iri: 'https://meta.linked.archi/core/metamodel#Core', label: 'Linked.Archi Core — generic element and relationship', kind: 'core' },
  { iri: 'https://meta.linked.archi/archimate3/metamodel#ArchiMate3.2', label: 'ArchiMate 3.2', kind: 'language' },
  { iri: 'https://meta.linked.archi/archimate4/metamodel#ArchiMate4', label: 'ArchiMate 4.0', kind: 'language' },
  { iri: 'https://meta.linked.archi/backstage/metamodel#BackstageCatalog', label: 'Backstage Catalog', kind: 'language' },
  { iri: 'https://meta.linked.archi/bmc/metamodel#BusinessModelCanvas', label: 'Business Model Canvas', kind: 'language' },
  { iri: 'https://meta.linked.archi/bpmn-lite/metamodel#BPMNLite', label: 'BPMN Lite', kind: 'language' },
  { iri: 'https://meta.linked.archi/bpmn/metamodel#BPMN2', label: 'BPMN 2.0.2', kind: 'language' },
  { iri: 'https://meta.linked.archi/c4/metamodel#C4Model', label: 'C4 Model', kind: 'language' },
  { iri: 'https://meta.linked.archi/edgy/metamodel#EDGY23', label: 'EDGY 23', kind: 'language' },
  { iri: 'https://meta.linked.archi/leanix/metamodel#LeanIXv4', label: 'LeanIX Meta Model v4', kind: 'language' },
  { iri: 'https://meta.linked.archi/leanix/v3/metamodel#LeanIXv3', label: 'LeanIX Meta Model v3', kind: 'language' },
  { iri: 'https://meta.linked.archi/uml/metamodel#UML2', label: 'UML 2.5.1', kind: 'language' },
  { iri: 'https://meta.linked.archi/4plus1/metamodel#FourPlusOneMetamodel', label: '4+1 View Model', kind: 'framework' },
  { iri: 'https://meta.linked.archi/time-framework/metamodel#TIME', label: 'TIME', kind: 'framework' },
  { iri: 'https://meta.linked.archi/admit/metamodel#ADMIT', label: 'ADMIT', kind: 'framework' },
  { iri: 'https://meta.linked.archi/atam/metamodel#ATAM', label: 'ATAM', kind: 'framework' },
  { iri: 'https://meta.linked.archi/dodaf/metamodel#DoDAF2', label: 'DoDAF 2.02', kind: 'framework' },
  { iri: 'https://meta.linked.archi/eaonapage/metamodel#EAOnAPage', label: 'EA on a Page', kind: 'framework' },
  { iri: 'https://meta.linked.archi/tech-radar/metamodel#TechRadar', label: 'Technology Radar', kind: 'framework' },
  { iri: 'https://meta.linked.archi/togaf/metamodel#TOGAF10', label: 'TOGAF', kind: 'framework' },
  { iri: 'https://meta.linked.archi/uaf/metamodel#UAF1', label: 'UAF 1.2', kind: 'framework' },
  { iri: 'https://meta.linked.archi/zachman/metamodel#ZachmanMetamodel', label: 'Zachman Framework', kind: 'framework' },
  { iri: 'https://meta.linked.archi/ai-governance/metamodel#AIEthicsAndGovernance', label: 'AI Ethics & Governance', kind: 'extension' },
  { iri: 'https://meta.linked.archi/ea-service/metamodel#EAAsAService', label: 'EA-as-a-Service', kind: 'extension' },
  { iri: 'https://meta.linked.archi/financial-architecture/metamodel#FinancialArchitecture', label: 'Financial Architecture', kind: 'extension' },
  { iri: 'https://meta.linked.archi/ml-systems/metamodel#MLEnabledSystems', label: 'ML-Enabled Systems', kind: 'extension' },
];

/** Section titles for {@link CatalogueKind}. */
export const CATALOGUE_KIND_LABELS: Record<CatalogueKind, string> = {
  core: 'Core',
  language: 'Modelling languages',
  framework: 'Frameworks',
  extension: 'Extensions',
};
