/**
 * Which properties to offer when adding one to a concept, and how to read
 * what the modeller types instead.
 *
 * Offering every property the loaded vocabularies declare is too much, and
 * mostly wrong: the core-vis ontology alone brings the diagram geometry
 * (`bounds-x`, `point-y`) and the notation styling (`fillColor`), the core
 * ontology brings the metamodel-authoring annotations (`unqualifiedForm`) and
 * the deliverable-template machinery. The vocabularies say where each property
 * applies (`rdfs:domain`), so the catalog uses that:
 *
 * | group           | what                                                        |
 * |-----------------|-------------------------------------------------------------|
 * | `type`          | properties whose domain — or a SHACL shape — covers the concept's type |
 * |                 | (a link by `rdfs:domain` or `arch:domainIncludes` more particular than `arch:Element`) |
 * | `model`         | properties the model already uses (custom ones included)    |
 * | `documentation` | SKOS / Dublin Core / PROV documentation properties          |
 * | `more`          | the rest that may apply: no declared domain                 |
 *
 * A link — an object property — that a loaded relationship class draws is not
 * offered: its `arch:unqualifiedForm`, the inverse a vocabulary declares of one
 * (`ap:taskOfActivity`, of the drawn `ap:hasTask`), and a qualified predicate,
 * which leads to a relationship resource. Those are made on the canvas, where a
 * link is a line with a resource behind it, not a value typed here. Nor is a link
 * whose range is a kind of model concept (`ad:relatedDecision`, to a decision):
 * a link to another concept is listed on the Analysis tab, beside the
 * relationships, and the Properties tab keeps the data properties and the links
 * to anything else — reference data, a document, an address. Nor is a link
 * whose domain is any element (`arch:Element`, `arch:ModelConcept`, `owl:Thing`):
 * core's are metamodel authoring and notation (`arch:templateResource`,
 * `arch:prefVisNotation`), and the rest can be typed.
 *
 * A property whose domain is some other class is not offered — it does not
 * apply — nor is one its vocabulary deprecates (`owl:deprecated true`, as
 * ArchiMate's `accessType`, replaced by the kinds of access); both can still be
 * typed. Anything can be typed: a plain name becomes a
 * property in the model's namespace (`owner` → `m:owner`), a CURIE with a known
 * prefix is expanded, and a full IRI is taken as it is ({@link resolve}).
 */

import type { NamedNode } from '@rdfjs/types';
import type { PrefixMap, RdfStore } from '../rdf-engine/interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import type { TypeClosure } from './model-queries.js';
import { modelQuads } from './model-queries.js';
import { IRI, T, humanize, localName, nn, sentenceCase } from './vocabulary.js';

/** Where a suggestion is listed. */
export type PropertyGroup = 'type' | 'model' | 'documentation' | 'more';

/** A property offered for adding. */
export interface PropertySuggestion {
  iri: string;
  /** What the modeller reads: the vocabulary's label, or the local name in words. */
  label: string;
  /** The IRI as a prefixed name when a prefix covers it, else the IRI. */
  curie: string;
  group: PropertyGroup;
  /** The group's heading (`For Business Actor`, `Used in this model`, …). */
  groupLabel: string;
  /** The vocabulary's definition, when it has one. */
  description?: string;
}

/** What {@link PropertyCatalog.resolve} makes of typed text. */
export interface ResolvedProperty {
  iri: string;
  curie: string;
  label: string;
}

/**
 * Documentation properties, offered for anything. Not `skos:definition` — the
 * panel always lists it under the name — nor `dcterms:description`, which says
 * the same again.
 */
export const DOCUMENTATION_PROPERTIES = [
  NAMESPACES.skos + 'altLabel',
  NAMESPACES.skos + 'note',
  NAMESPACES.skos + 'scopeNote',
  NAMESPACES.skos + 'example',
  NAMESPACES.dcterms + 'source',
  NAMESPACES.dcterms + 'creator',
  NAMESPACES.dcterms + 'created',
  NAMESPACES.rdfs + 'comment',
  NAMESPACES.rdfs + 'seeAlso',
  NAMESPACES.prov + 'wasDerivedFrom',
];

/**
 * Never offered: what the tool writes itself (type, membership, the ends of a
 * relationship, conformance, the model's namespace), the name and the
 * definition (always listed in the panel), and the annotations that describe
 * classes, not model concepts.
 */
const NOT_OFFERED = new Set([
  IRI.rdfType,
  IRI.prefLabel,
  IRI.definition,
  IRI.inModel,
  IRI.inView,
  IRI.source,
  IRI.target,
  IRI.modelConformsToMetamodel,
  IRI.viewConformsToViewpoint,
  IRI.dctermsModified,
  IRI.unqualifiedForm,
  NAMESPACES.arch + 'domainIncludes',
  NAMESPACES.arch + 'rangeIncludes',
  NAMESPACES.arch + 'isAbstractClass',
  NAMESPACES.vann + 'preferredNamespacePrefix',
  NAMESPACES.vann + 'preferredNamespaceUri',
]);

/** Documentation properties whose values are things — another concept, a page — rather than text. */
const LINKING_PROPERTIES = new Set([
  NAMESPACES.rdfs + 'seeAlso',
  NAMESPACES.prov + 'wasDerivedFrom',
  NAMESPACES.dcterms + 'source',
  NAMESPACES.dcterms + 'relation',
  NAMESPACES.dcterms + 'references',
]);

/** Ranges that are text, not things. */
const LITERAL_RANGES = new Set([
  NAMESPACES.rdfs + 'Literal',
  NAMESPACES.rdf + 'langString',
  NAMESPACES.rdf + 'HTML',
  NAMESPACES.rdf + 'PlainLiteral',
]);

/** Namespaces whose properties are never offered: diagram geometry and notation. */
const NOT_OFFERED_NAMESPACES = [NAMESPACES['arch-vis'], NAMESPACES.sh, NAMESPACES.owl];

const GROUP_ORDER: PropertyGroup[] = ['type', 'model', 'documentation', 'more'];

/** What the catalog reads from its surroundings, current at each call. */
export interface PropertyCatalogContext {
  /** Superclasses (and the class itself) of a class. */
  closure: () => TypeClosure;
  /** Prefixes for CURIEs, the model's own included. */
  prefixes: () => PrefixMap;
  /** Where a typed plain name is minted: the model's namespace. */
  modelNamespace: () => string;
}

/** The catalog of properties for the add-property picker. */
export class PropertyCatalog {
  constructor(
    private readonly store: RdfStore,
    private readonly context: PropertyCatalogContext,
  ) {}

  /** The properties to offer for a concept, grouped and sorted (see the module doc). */
  suggest(subjectIri: string): PropertySuggestion[] {
    const store = this.store;
    const prefixes = this.context.prefixes();
    const types = store
      .getQuads(nn(subjectIri), T.rdfType)
      .filter((q) => q.graph.termType === 'DefaultGraph')
      .map((q) => q.object.value);
    const closure = this.context.closure();
    const applicable = new Set(types.flatMap((t) => closure(t)));
    const typeLabel = types[0] ? this.labelOf(types[0]) : 'this concept';

    const groupOf = new Map<string, PropertyGroup>();
    const deprecated = (iri: string) =>
      store.getQuads(nn(iri), nn(NAMESPACES.owl + 'deprecated')).some((q) => q.object.value === 'true');
    const offer = (iri: string, group: PropertyGroup) => {
      if (!offerable(iri) || deprecated(iri)) return;
      const current = groupOf.get(iri);
      if (!current || GROUP_ORDER.indexOf(group) < GROUP_ORDER.indexOf(current)) groupOf.set(iri, group);
    };

    // Declared in a vocabulary: by domain.
    const objectProperties = new Set(
      store.getQuads(null, T.rdfType, nn(NAMESPACES.owl + 'ObjectProperty')).map((q) => q.subject.value),
    );
    // Links: by domain too, except what a relationship class draws (see the module doc).
    const drawn = new Set<string>();
    for (const q of store.getQuads(null, T.unqualifiedForm, null)) {
      drawn.add(q.object.value);
      // The qualified predicate names the form too: it leads to the resource.
      if (objectProperties.has(q.subject.value)) drawn.add(q.subject.value);
    }
    for (const q of store.getQuads(null, nn(NAMESPACES.owl + 'inverseOf'), null)) {
      if (drawn.has(q.object.value)) drawn.add(q.subject.value);
      else if (drawn.has(q.subject.value)) drawn.add(q.object.value);
    }
    const anyElement = new Set([IRI.Element, IRI.ModelConcept, NAMESPACES.owl + 'Thing']);
    const conceptClasses = new Set([IRI.Element, IRI.ModelConcept, IRI.QualifiedRelationship]);
    const toConcepts = (iri: string): boolean => {
      const ranges = [
        ...store.getQuads(nn(iri), nn(NAMESPACES.rdfs + 'range')),
        ...store.getQuads(nn(iri), nn(NAMESPACES.arch + 'rangeIncludes')),
      ].map((r) => r.object.value);
      return ranges.length > 0 && ranges.every((r) => closure(r).some((c) => conceptClasses.has(c)));
    };
    for (const iri of objectProperties) {
      if (drawn.has(iri) || toConcepts(iri)) continue;
      const domains = [
        ...store.getQuads(nn(iri), nn(NAMESPACES.rdfs + 'domain')),
        ...store.getQuads(nn(iri), nn(NAMESPACES.arch + 'domainIncludes')),
      ].map((d) => d.object.value);
      if (domains.some((d) => applicable.has(d) && !anyElement.has(d))) offer(iri, 'type');
    }

    for (const kind of ['DatatypeProperty', 'AnnotationProperty']) {
      for (const q of store.getQuads(null, T.rdfType, nn(NAMESPACES.owl + kind))) {
        if (q.subject.termType !== 'NamedNode' || q.graph.termType === 'DefaultGraph') continue;
        const domains = store.getQuads(q.subject as NamedNode, nn(NAMESPACES.rdfs + 'domain')).map((d) => d.object.value);
        if (domains.length === 0) offer(q.subject.value, 'more');
        else if (domains.some((d) => applicable.has(d))) offer(q.subject.value, 'type');
      }
    }

    // Constrained by a shape for the type: the shape says it belongs here.
    for (const q of store.getQuads(null, nn(NAMESPACES.sh + 'targetClass'))) {
      if (!applicable.has(q.object.value)) continue;
      for (const link of store.getQuads(q.subject as NamedNode, nn(NAMESPACES.sh + 'property'))) {
        // A shape that lists the values (`sh:in`) makes even a link an attribute —
        // Backstage's bs:lifecycleState takes one of three named states.
        const listed = store.getQuads(link.object as NamedNode, nn(NAMESPACES.sh + 'in')).length > 0;
        for (const path of store.getQuads(link.object as NamedNode, nn(NAMESPACES.sh + 'path'))) {
          // A shape on a relationship predicate constrains a relationship, drawn on the canvas.
          if (path.object.termType === 'NamedNode' && (listed || !objectProperties.has(path.object.value))) {
            offer(path.object.value, 'type');
          }
        }
      }
    }

    // Used in this model: literal-valued properties, and anything in the model's
    // namespace — on its concepts, not on the model resource (the tool's metadata).
    const namespace = this.context.modelNamespace();
    const quads = modelQuads(store);
    const models = new Set(
      quads.filter((q) => q.predicate.value === IRI.rdfType && q.object.value === IRI.Model).map((q) => q.subject.value),
    );
    for (const q of quads) {
      if (models.has(q.subject.value)) continue;
      const p = q.predicate.value;
      if (q.object.termType === 'Literal' || p.startsWith(namespace)) offer(p, 'model');
    }

    for (const iri of DOCUMENTATION_PROPERTIES) offer(iri, 'documentation');

    const heading: Record<PropertyGroup, string> = {
      type: `For ${typeLabel}`,
      model: 'Used in this model',
      documentation: 'Documentation',
      more: 'More',
    };
    return [...groupOf]
      .map(([iri, group]) => {
        const description = this.descriptionOf(iri);
        return {
          iri,
          label: this.labelOf(iri),
          curie: curieOf(iri, prefixes),
          group,
          groupLabel: heading[group],
          ...(description ? { description } : {}),
        };
      })
      .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.label.localeCompare(b.label));
  }

  /**
   * A property from typed text: a CURIE with a known prefix (`dcterms:source`,
   * `m:owner`), an absolute IRI, or a plain name, which becomes a property in
   * the model's namespace (`cost center` → `m:costCenter`). `undefined` when
   * the text is none of these.
   */
  resolve(text: string): ResolvedProperty | undefined {
    const input = text.trim();
    const plainName = /^[A-Za-z][\w -]*$/.test(input);
    if (!input || (!plainName && /[\s<>"{}|\\^`]/.test(input))) return undefined;
    const prefixes = this.context.prefixes();
    let iri: string | undefined;
    const curie = /^([A-Za-z][\w.-]*)?:([\w.-]*)$/.exec(input);
    if (curie && (curie[1] ?? '') in prefixes && curie[2]) iri = prefixes[curie[1] ?? ''] + curie[2];
    else if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+$/.test(input) || /^urn:\S+:\S+$/i.test(input)) iri = input;
    else if (plainName) iri = this.context.modelNamespace() + camelCase(input);
    if (!iri) return undefined;
    return { iri, curie: curieOf(iri, prefixes), label: this.labelOf(iri) };
  }

  /**
   * Whether a property's values are resources rather than text: one of the
   * documentation properties that point at things ({@link LINKING_PROPERTIES}),
   * an object property, or one whose range is a class rather than a datatype.
   */
  takesLinks(iri: string): boolean {
    if (LINKING_PROPERTIES.has(iri)) return true;
    const subject = nn(iri);
    if (this.store.getQuads(subject, T.rdfType, nn(NAMESPACES.owl + 'ObjectProperty')).length > 0) return true;
    return this.store
      .getQuads(subject, nn(NAMESPACES.rdfs + 'range'))
      .some((q) => q.object.termType === 'NamedNode' && !LITERAL_RANGES.has(q.object.value) && !q.object.value.startsWith(NAMESPACES.xsd));
  }

  /** The vocabulary's label for a property, else its local name in words. */
  labelOf(iri: string): string {
    const subject = nn(iri);
    for (const predicate of [T.rdfsLabel, T.prefLabel]) {
      const labels = this.store.getQuads(subject, predicate).map((q) => q.object as { value: string; language?: string });
      const label = labels.find((l) => l.language === 'en') ?? labels.find((l) => !l.language) ?? labels[0];
      // A label that is just the local name again (`decorSymbol`) reads no better than the name.
      if (label && label.value !== localName(iri)) return label.value;
    }
    return sentenceCase(humanize(localName(iri)));
  }

  private descriptionOf(iri: string): string | undefined {
    const subject = nn(iri);
    for (const predicate of [T.definition, nn(NAMESPACES.rdfs + 'comment')]) {
      const text = this.store.getQuads(subject, predicate)[0]?.object.value.trim();
      if (text) return text;
    }
    return undefined;
  }
}

/** Whether a property may be offered at all. */
function offerable(iri: string): boolean {
  return !NOT_OFFERED.has(iri) && !NOT_OFFERED_NAMESPACES.some((ns) => iri.startsWith(ns));
}

/** `cost center` → `costCenter`; a single word is kept as typed. */
function camelCase(words: string): string {
  const parts = words.trim().split(/\s+/);
  return parts[0] + parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

/** The IRI as `prefix:local` when a prefix covers it with a local name Turtle can write. */
export function curieOf(iri: string, prefixes: PrefixMap): string {
  let best: string | undefined;
  let bestLength = 0;
  for (const [prefix, namespace] of Object.entries(prefixes)) {
    if (!iri.startsWith(namespace) || namespace.length <= bestLength) continue;
    const local = iri.slice(namespace.length);
    if (/^[\w-]*$/.test(local)) {
      best = `${prefix}:${local}`;
      bestLength = namespace.length;
    }
  }
  return best ?? iri;
}
