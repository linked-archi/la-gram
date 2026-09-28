/**
 * What the loaded metamodels say about a type — the property panel's
 * "About ‹type›" tab.
 *
 * From the **ontology**: the type's definition (`skos:definition`), its
 * guidance (`skos:scopeNote`: when to use it, how to name it, what it is not),
 * other names (`skos:altLabel`), what changed (`skos:changeNote`), the classes
 * it specializes (`rdfs:subClassOf`, transitively), whether it is abstract,
 * where it is defined (`rdfs:seeAlso`, `dcterms:source`) — and, per kind of
 * type, the facts that help a modeller: a relationship's typical ends
 * (`arch:domainIncludes`, `arch:rangeIncludes`) and unqualified form; a
 * viewpoint's concepts, stakeholders and purposes.
 *
 * From the **taxonomy**: where the type is classified — for each SKOS concept
 * that holds it (`skos:narrower`, or the type's `skos:broader`), the path from
 * the top concept (the axis: "Element by Domain", "Element by Aspect") down to
 * that group, the group's own definition, guidance and changes, and the other
 * types in the group.
 *
 * Everything is read structurally from whatever metamodels are loaded, so it
 * works for any notation that publishes these properties; what a metamodel
 * does not say is simply absent.
 */

import type { Quad, Term } from '@rdfjs/types';
import type { RdfStore } from '../rdf-engine/interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { humanize, localName } from '../model-manager/vocabulary.js';

/** A type, concept or resource the guide mentions. */
export interface GuideRef {
  iri: string;
  label: string;
  definition?: string;
}

/** Where a taxonomy classifies the type. */
export interface GuideClassification {
  /** The top concept: the axis ("Element by Domain"). */
  axis: GuideRef;
  /** The concepts from under the axis down to the group, the group last. */
  path: GuideRef[];
  /** The concept that holds the type, with its guidance. */
  group: GuideRef & { notes: string[]; changes: string[] };
  /** The other types in the group. */
  members: GuideRef[];
}

/** A fact about the type with the resources it names ("Typically from: …"). */
export interface GuideFact {
  label: string;
  values: GuideRef[];
}

/** What the metamodels say about one type. */
export interface TypeGuide {
  iri: string;
  label: string;
  altLabels: string[];
  definition?: string;
  /** Guidance, one paragraph each. */
  notes: string[];
  changes: string[];
  abstract: boolean;
  /** Where it is defined: web pages, not resources of the loaded metamodels. */
  sources: string[];
  /** The classes it specializes, nearest first. */
  superclasses: GuideRef[];
  classifications: GuideClassification[];
  facts: GuideFact[];
}

const SKOS = NAMESPACES.skos;
const ARCH = NAMESPACES.arch;
const P = {
  type: NAMESPACES.rdf + 'type',
  label: NAMESPACES.rdfs + 'label',
  comment: NAMESPACES.rdfs + 'comment',
  subClassOf: NAMESPACES.rdfs + 'subClassOf',
  seeAlso: NAMESPACES.rdfs + 'seeAlso',
  source: NAMESPACES.dcterms + 'source',
  prefLabel: SKOS + 'prefLabel',
  altLabel: SKOS + 'altLabel',
  definition: SKOS + 'definition',
  scopeNote: SKOS + 'scopeNote',
  changeNote: SKOS + 'changeNote',
  broader: SKOS + 'broader',
  narrower: SKOS + 'narrower',
  concept: SKOS + 'Concept',
  isAbstract: ARCH + 'isAbstractClass',
};

/** Facts worth showing, by predicate, in this order. */
const FACTS: ReadonlyArray<[string, string]> = [
  [ARCH + 'domainIncludes', 'Typically from'],
  [ARCH + 'rangeIncludes', 'Typically to'],
  [ARCH + 'unqualifiedForm', 'Unqualified form'],
  [ARCH + 'includesConcept', 'Shows'],
  [ARCH + 'targetsStakeholder', 'For'],
  [ARCH + 'viewpointHasPurpose', 'Purpose'],
];

/**
 * Paragraphs of a text. The metamodels hard-wrap their texts, so a line break
 * starts a paragraph only after the end of a sentence; within one, it is a space.
 */
export function paragraphs(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    let current = '';
    for (const line of value.split('\n').map((l) => l.trim())) {
      if (!line) {
        if (current) out.push(current);
        current = '';
        continue;
      }
      current = current ? `${current} ${line}` : line;
      if (/[.!?:;]["”’)]?$/.test(line)) {
        out.push(current);
        current = '';
      }
    }
    if (current) out.push(current);
  }
  return out.map((p) => prose(p)!).filter(Boolean);
}

/** One line of prose: whitespace collapsed, Markdown links reduced to their text. */
function prose(value: string | undefined): string | undefined {
  return value?.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim() || undefined;
}

/** Superclasses not worth listing: every class is one. */
const TOO_GENERAL = new Set([NAMESPACES.owl + 'Thing', NAMESPACES.rdfs + 'Resource', NAMESPACES.rdfs + 'Class']);

/**
 * The guide to `typeIri` from what the store holds (all graphs: the metamodels
 * are named graphs). `undefined` when the store says nothing about it.
 *
 * @param language Preferred language of texts; untagged texts come next, then any.
 */
export function readTypeGuide(store: Pick<RdfStore, 'getQuads'>, typeIri: string, language = 'en'): TypeGuide | undefined {
  const node = (iri: string) => ({ termType: 'NamedNode', value: iri }) as never;
  const quads = (subject: string | null, predicate: string, object: string | null = null): Quad[] =>
    store.getQuads(subject ? node(subject) : null, node(predicate), object ? node(object) : null);
  const iris = (terms: Term[]) => [...new Set(terms.filter((t) => t.termType === 'NamedNode').map((t) => t.value))];
  const objects = (subject: string, predicate: string) => iris(quads(subject, predicate).map((q) => q.object));
  const subjects = (predicate: string, object: string) => iris(quads(null, predicate, object).map((q) => q.subject));

  /** Texts of a property: the preferred language's, else untagged, else any — once each. */
  const texts = (subject: string, predicate: string): string[] => {
    const literals = quads(subject, predicate)
      .map((q) => q.object)
      .filter((o): o is Extract<Term, { termType: 'Literal' }> => o.termType === 'Literal');
    const pick =
      [language, ''].map((lang) => literals.filter((l) => l.language === lang)).find((l) => l.length > 0) ?? literals;
    return [...new Set(pick.map((l) => l.value.trim()).filter(Boolean))];
  };
  const text = (subject: string, predicate: string) => texts(subject, predicate)[0];
  const labelOf = (iri: string) => {
    const label = text(iri, P.prefLabel) ?? text(iri, P.label) ?? localName(iri);
    // A label that is an identifier ("BusinessDomainElement") reads better spaced.
    return /\s/.test(label) ? label : humanize(label);
  };
  const ref = (iri: string, withDefinition = true): GuideRef => {
    const definition = withDefinition ? prose(text(iri, P.definition) ?? text(iri, P.comment)) : undefined;
    return { iri, label: labelOf(iri), ...(definition ? { definition } : {}) };
  };
  const isConcept = (iri: string) => quads(iri, P.type, P.concept).length > 0;

  const known = quads(typeIri, P.type).length > 0 || texts(typeIri, P.prefLabel).length > 0 || texts(typeIri, P.label).length > 0;
  if (!known) return undefined;

  // Ontology: the classes it specializes, nearest first.
  const superclasses: GuideRef[] = [];
  const seen = new Set([typeIri]);
  let level = [typeIri];
  while (level.length > 0) {
    const next: string[] = [];
    for (const cls of level) {
      for (const parent of objects(cls, P.subClassOf)) {
        if (seen.has(parent) || TOO_GENERAL.has(parent)) continue;
        seen.add(parent);
        superclasses.push(ref(parent));
        next.push(parent);
      }
    }
    level = next;
  }

  // Taxonomy: every concept that holds the type, from its axis down.
  const holders = [...new Set([...subjects(P.narrower, typeIri), ...objects(typeIri, P.broader)])].filter(isConcept);
  const broaderOf = (concept: string) => [...new Set([...objects(concept, P.broader), ...subjects(P.narrower, concept)])].filter(isConcept);
  const classifications: GuideClassification[] = holders.map((group) => {
    const path = [group];
    for (let up = broaderOf(group)[0]; up && !path.includes(up); up = broaderOf(up)[0]) path.unshift(up);
    const axis = path[0]!;
    const members = [...new Set([...objects(group, P.narrower), ...subjects(P.broader, group)])]
      .filter((m) => m !== typeIri && !isConcept(m))
      .map((m) => ref(m, false))
      .sort((a, b) => a.label.localeCompare(b.label));
    return {
      axis: ref(axis),
      path: path.slice(1).map((c) => ref(c)),
      group: { ...ref(group), notes: paragraphs(texts(group, P.scopeNote)), changes: texts(group, P.changeNote).map((c) => prose(c)!) },
      members,
    };
  });

  // Where it is defined: web pages, not resources of the loaded metamodels.
  const sources = iris([...quads(typeIri, P.seeAlso), ...quads(typeIri, P.source)].map((q) => q.object)).filter(
    (iri) => /^https?:/.test(iri) && quads(iri, P.type).length === 0,
  );

  const facts: GuideFact[] = FACTS.map(([predicate, label]) => ({
    label,
    values: objects(typeIri, predicate).map((iri) => ref(iri, false)).sort((a, b) => a.label.localeCompare(b.label)),
  })).filter((f) => f.values.length > 0);

  const definition = prose(text(typeIri, P.definition) ?? text(typeIri, P.comment));
  return {
    iri: typeIri,
    label: labelOf(typeIri),
    altLabels: texts(typeIri, P.altLabel),
    ...(definition ? { definition } : {}),
    notes: paragraphs(texts(typeIri, P.scopeNote)),
    changes: texts(typeIri, P.changeNote).map((c) => prose(c)!),
    abstract: quads(typeIri, P.isAbstract).some((q) => q.object.value === 'true'),
    sources,
    superclasses,
    classifications,
    facts,
  };
}
