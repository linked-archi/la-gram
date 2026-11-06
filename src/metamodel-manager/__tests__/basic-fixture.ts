/**
 * The Basic asset set as inline Turtle, one string per document. It mirrors the
 * IRIs, labels and descriptors of the files under
 * `linked-archi-meta/modelingLanguages/basic/`, without their prose:
 *
 * - a manifest naming the ontology, the taxonomy, exactly one `arch:notationSet`
 *   (the rectangle set) and the presentation-context scheme;
 * - an ontology with three element classes under `arch:Element` (`basic:Node`,
 *   `basic:SpecialNode`, `basic:GroupNode`) and two relationship classes under
 *   `arch:QualifiedRelationship` (`basic:Association`, `basic:Aggregation`),
 *   each with its unqualified and its qualified property;
 * - a taxonomy whose one axis concept, `basictax:BasicConcepts`, wraps the
 *   groups `basictax:Elements` and `basictax:Relationships`, which list the
 *   classes. The wrapper is what lets Basic's elements reach a palette shared
 *   with another language: `taxonomy.ts` builds an axis for a flat taxonomy only
 *   when no other one exists;
 * - two notation sets, the rectangle set (the default) and the bubble set, each
 *   with four descriptors: `arch:Element` (a 120 × 60 rectangle, or an 80 × 80
 *   circle), `arch:QualifiedRelationship` (solid line, open arrowhead at the
 *   target), `basic:Association` (solid line, no decoration at either end) and
 *   `basic:Aggregation` (solid line, hollow diamond at the source, nothing at
 *   the target). No relationship descriptor states a colour, and no element
 *   class has a descriptor or an `arch:prefVisNotation` of its own;
 * - two presentation contexts: `ModellerContext` uses the rectangle set,
 *   `WorkshopContext` the bubble set, which nothing else names.
 *
 * Shared by the loader, palette, resolver and canvas tests. {@link basicAssetSource}
 * serves the documents by IRI and falls back to the bundle for the core
 * ontologies and the bundled languages, so nothing touches the network.
 */

import {
  BundledAssetSource,
  ChainedAssetSource,
  UploadedAssetSource,
} from '../asset-sources.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';

export const BASIC = 'https://meta.linked.archi/basic#';
export const BASIC_METAMODEL = 'https://meta.linked.archi/basic/metamodel#Basic';
export const BASIC_MANIFEST_DOC = 'https://meta.linked.archi/basic/metamodel#';
export const BASIC_ONTOLOGY_DOC = 'https://meta.linked.archi/basic';
export const BASIC_TAXONOMY_DOC = 'https://meta.linked.archi/basic/tax#';
export const BASIC_NOTATION_DOC = 'https://meta.linked.archi/basic/notation#';
export const BASIC_BUBBLE_DOC = 'https://meta.linked.archi/basic/notation-bubble#';
export const BASIC_CONTEXTS_DOC = 'https://meta.linked.archi/basic/presentation-contexts#';

export const RECTANGLE_SET = `${BASIC_NOTATION_DOC}BasicRectangleNotation`;
export const BUBBLE_SET = `${BASIC_BUBBLE_DOC}BasicBubbleNotation`;
/** Names the rectangle set, the manifest's default, again. */
export const MODELLER_CONTEXT = `${BASIC_CONTEXTS_DOC}ModellerContext`;
/** Names the bubble set: the only reference to it. */
export const WORKSHOP_CONTEXT = `${BASIC_CONTEXTS_DOC}WorkshopContext`;

export const ARCH_ELEMENT = `${NAMESPACES.arch}Element`;
export const ARCH_QUALIFIED_RELATIONSHIP = `${NAMESPACES.arch}QualifiedRelationship`;

/** The rectangle set's `arch:Element` style, as `buildVisualNotations` reads it. */
export const RECTANGLE_ELEMENT_STYLE = {
  shapeType: 'Rectangle',
  fillColor: '#E8F0EA',
  lineColor: '#424242',
  fontColor: '#212121',
  renderingMode: 'ShapeOnly',
  defaultWidth: 120,
  defaultHeight: 60,
} as const;

/** The bubble set's `arch:Element` style. */
export const BUBBLE_ELEMENT_STYLE = {
  shapeType: 'Circle',
  fillColor: '#E8F0EA',
  lineColor: '#424242',
  fontColor: '#212121',
  renderingMode: 'ShapeOnly',
  defaultWidth: 80,
  defaultHeight: 80,
} as const;

/** `arch:QualifiedRelationship` in both sets: what a relationship class without a descriptor of its own takes. */
export const GENERIC_RELATIONSHIP_STYLE = {
  lineStyle: 'SolidLine',
  sourceDecor: 'NoDecoration',
  targetDecor: 'OpenArrowhead',
} as const;

/** `basic:Association` in both sets: undirected, so no decoration at either end. */
export const ASSOCIATION_STYLE = {
  lineStyle: 'SolidLine',
  sourceDecor: 'NoDecoration',
  targetDecor: 'NoDecoration',
} as const;

/** `basic:Aggregation` in both sets: the hollow diamond sits at the source, the whole. */
export const AGGREGATION_STYLE = {
  lineStyle: 'SolidLine',
  sourceDecor: 'HollowDiamond',
  targetDecor: 'NoDecoration',
} as const;

const PREFIXES = `
  @prefix owl:            <${NAMESPACES.owl}> .
  @prefix rdf:            <${NAMESPACES.rdf}> .
  @prefix rdfs:           <${NAMESPACES.rdfs}> .
  @prefix xsd:            <${NAMESPACES.xsd}> .
  @prefix skos:           <${NAMESPACES.skos}> .
  @prefix arch:           <${NAMESPACES.arch}> .
  @prefix arch-vis:       <${NAMESPACES['arch-vis']}> .
  @prefix basic:          <${BASIC}> .
  @prefix basicmm:        <${BASIC_MANIFEST_DOC}> .
  @prefix basictax:       <${BASIC_TAXONOMY_DOC}> .
  @prefix basicnot:       <${BASIC_NOTATION_DOC}> .
  @prefix basicnotbubble: <${BASIC_BUBBLE_DOC}> .
  @prefix basicpc:        <${BASIC_CONTEXTS_DOC}> .
`;

export const BASIC_MANIFEST_TTL = `${PREFIXES}
  <${BASIC_MANIFEST_DOC}> rdf:type owl:Ontology ;
    owl:imports <https://meta.linked.archi/core#> .

  basicmm:BasicFramework rdf:type arch:Framework ; skos:prefLabel "Basic"@en .

  basicmm:Basic
    rdf:type arch:Metamodel ;
    skos:prefLabel "Basic Metamodel"@en ;
    arch:basedOnFramework basicmm:BasicFramework ;
    owl:versionInfo "0.1.0" ;
    arch:modelConcepts <${BASIC_ONTOLOGY_DOC}> ;
    arch:conceptClassification <${BASIC_TAXONOMY_DOC}> ;
    arch:notationSet basicnot:BasicRectangleNotation ;
    arch:presentationContextScheme <${BASIC_CONTEXTS_DOC}> .
`;

export const BASIC_ONTOLOGY_TTL = `${PREFIXES}
  <${BASIC_ONTOLOGY_DOC}> rdf:type owl:Ontology ;
    owl:imports <https://meta.linked.archi/core#> .

  basic:Node rdf:type owl:Class ; rdfs:subClassOf arch:Element ; skos:prefLabel "Node"@en .
  basic:SpecialNode rdf:type owl:Class ; rdfs:subClassOf arch:Element ; skos:prefLabel "SpecialNode"@en .
  basic:GroupNode rdf:type owl:Class ; rdfs:subClassOf arch:Element ; skos:prefLabel "GroupNode"@en .

  basic:association rdf:type owl:ObjectProperty ;
    skos:prefLabel "Association"@en ;
    arch:domainIncludes basic:Node ;
    arch:rangeIncludes basic:SpecialNode, basic:Node .

  basic:Association rdf:type owl:Class ;
    rdfs:subClassOf arch:QualifiedRelationship ;
    arch:unqualifiedForm basic:association ;
    skos:prefLabel "Association"@en .

  basic:qualifiedAssociation rdf:type owl:ObjectProperty ;
    rdfs:range basic:Association ;
    arch:unqualifiedForm basic:association ;
    arch:domainIncludes basic:Node ;
    skos:prefLabel "qualified Association"@en .

  basic:aggregation rdf:type owl:ObjectProperty ;
    skos:prefLabel "Aggregation"@en ;
    arch:domainIncludes basic:GroupNode ;
    arch:rangeIncludes basic:Node, basic:SpecialNode .

  basic:Aggregation rdf:type owl:Class ;
    rdfs:subClassOf arch:QualifiedRelationship ;
    arch:unqualifiedForm basic:aggregation ;
    skos:prefLabel "Aggregation"@en .

  basic:qualifiedAggregation rdf:type owl:ObjectProperty ;
    rdfs:range basic:Aggregation ;
    arch:unqualifiedForm basic:aggregation ;
    arch:domainIncludes basic:GroupNode ;
    skos:prefLabel "qualified Aggregation"@en .
`;

/** One axis, Basic Concepts, over two groups that list every Basic class. */
export const BASIC_TAXONOMY_TTL = `${PREFIXES}
  <${BASIC_TAXONOMY_DOC}> rdf:type skos:ConceptScheme ;
    skos:prefLabel "Basic Concept Scheme"@en ;
    skos:hasTopConcept basictax:BasicConcepts .

  basictax:BasicConcepts rdf:type skos:Concept ;
    skos:prefLabel "Basic Concepts"@en ;
    skos:topConceptOf <${BASIC_TAXONOMY_DOC}> ;
    skos:inScheme <${BASIC_TAXONOMY_DOC}> ;
    skos:narrower basictax:Elements, basictax:Relationships .

  basictax:Elements rdf:type skos:Concept ;
    skos:prefLabel "Elements"@en ;
    skos:broader basictax:BasicConcepts ;
    skos:inScheme <${BASIC_TAXONOMY_DOC}> ;
    skos:narrower basic:Node, basic:SpecialNode, basic:GroupNode .

  basictax:Relationships rdf:type skos:Concept ;
    skos:prefLabel "Relationships"@en ;
    skos:broader basictax:BasicConcepts ;
    skos:inScheme <${BASIC_TAXONOMY_DOC}> ;
    skos:narrower basic:Association, basic:Aggregation .

  basic:Node skos:inScheme <${BASIC_TAXONOMY_DOC}> ; skos:broader basictax:Elements .
  basic:SpecialNode skos:inScheme <${BASIC_TAXONOMY_DOC}> ; skos:broader basictax:Elements .
  basic:GroupNode skos:inScheme <${BASIC_TAXONOMY_DOC}> ; skos:broader basictax:Elements .
  basic:Association skos:inScheme <${BASIC_TAXONOMY_DOC}> ; skos:broader basictax:Relationships .
  basic:Aggregation skos:inScheme <${BASIC_TAXONOMY_DOC}> ; skos:broader basictax:Relationships .
`;

type ElementStyle = typeof RECTANGLE_ELEMENT_STYLE | typeof BUBBLE_ELEMENT_STYLE;
type LineLook = typeof GENERIC_RELATIONSHIP_STYLE | typeof ASSOCIATION_STYLE | typeof AGGREGATION_STYLE;

/**
 * One Basic notation document: the set and its four descriptors. The two sets
 * differ only in element geometry and in where their images are published.
 */
function notationDocument(doc: {
  documentIri: string;
  prefix: string;
  setName: string;
  setLabel: string;
  iconBase: string;
  element: ElementStyle;
}): string {
  const { prefix: p, element } = doc;
  const relationship = (name: string, label: string, concept: string, image: string, line: LineLook): string => `
  ${p}:${name} rdf:type arch-vis:VisualNotation ;
    skos:prefLabel "${label}"@en ;
    arch-vis:notationFor ${concept} ;
    arch-vis:inNotationSet ${p}:${doc.setName} ;
    arch:prefVisNotation <${doc.iconBase}${image}.svg> ;
    arch:altVisNotation <${doc.iconBase}glyphs/${image}.svg> ;
    arch-vis:lineStyle arch-vis:${line.lineStyle} ;
    arch-vis:sourceDecor arch-vis:${line.sourceDecor} ;
    arch-vis:targetDecor arch-vis:${line.targetDecor} .
`;
  return `${PREFIXES}
  <${doc.documentIri}> rdf:type owl:Ontology ;
    owl:imports <https://meta.linked.archi/core#>, <https://meta.linked.archi/core-vis#> .

  ${p}:${doc.setName} rdf:type arch-vis:NotationSet ;
    skos:prefLabel "${doc.setLabel}"@en .

  ${p}:ElementNotation rdf:type arch-vis:VisualNotation ;
    skos:prefLabel "Element notation"@en ;
    arch-vis:notationFor arch:Element ;
    arch-vis:inNotationSet ${p}:${doc.setName} ;
    arch:prefVisNotation <${doc.iconBase}element.svg> ;
    arch:altVisNotation <${doc.iconBase}glyphs/element.svg> ;
    arch-vis:defaultStyle ${p}:ElementStyle .

  ${p}:ElementStyle rdf:type arch-vis:Style ;
    skos:prefLabel "Element style"@en ;
    arch-vis:shapeType arch-vis:${element.shapeType} ;
    arch-vis:renderingMode arch-vis:${element.renderingMode} ;
    arch-vis:fillColor "${element.fillColor}" ;
    arch-vis:lineColor "${element.lineColor}" ;
    arch-vis:fontColor "${element.fontColor}" ;
    arch-vis:defaultWidth "${element.defaultWidth.toFixed(1)}"^^xsd:double ;
    arch-vis:defaultHeight "${element.defaultHeight.toFixed(1)}"^^xsd:double .
${relationship('QualifiedRelationshipNotation', 'Relationship notation', 'arch:QualifiedRelationship', 'relationship', GENERIC_RELATIONSHIP_STYLE)}
${relationship('AssociationNotation', 'Association notation', 'basic:Association', 'association', ASSOCIATION_STYLE)}
${relationship('AggregationNotation', 'Aggregation notation', 'basic:Aggregation', 'aggregation', AGGREGATION_STYLE)}`;
}

/** The default set: rectangles. */
export const BASIC_NOTATION_TTL = notationDocument({
  documentIri: BASIC_NOTATION_DOC,
  prefix: 'basicnot',
  setName: 'BasicRectangleNotation',
  setLabel: 'Basic Rectangle Notation',
  iconBase: 'https://meta.linked.archi/basic/icons/',
  element: RECTANGLE_ELEMENT_STYLE,
});

/** The alternative set: the same descriptors, circles instead of rectangles. */
export const BASIC_BUBBLE_TTL = notationDocument({
  documentIri: BASIC_BUBBLE_DOC,
  prefix: 'basicnotbubble',
  setName: 'BasicBubbleNotation',
  setLabel: 'Basic Bubble Notation',
  iconBase: 'https://meta.linked.archi/basic/notation-bubble/icons/',
  element: BUBBLE_ELEMENT_STYLE,
});

/** Two audiences: the Modeller names the default set again, the Workshop participant the bubble set. */
export const BASIC_CONTEXTS_TTL = `${PREFIXES}
  <${BASIC_CONTEXTS_DOC}> rdf:type skos:ConceptScheme ;
    skos:prefLabel "Basic Presentation Contexts"@en ;
    skos:hasTopConcept basicpc:ModellerContext, basicpc:WorkshopContext .

  basicpc:ModellerContext rdf:type skos:Concept ;
    skos:topConceptOf <${BASIC_CONTEXTS_DOC}> ;
    skos:inScheme <${BASIC_CONTEXTS_DOC}> ;
    skos:prefLabel "Modeller"@en ;
    arch:usesNotationSet basicnot:BasicRectangleNotation .

  basicpc:WorkshopContext rdf:type skos:Concept ;
    skos:topConceptOf <${BASIC_CONTEXTS_DOC}> ;
    skos:inScheme <${BASIC_CONTEXTS_DOC}> ;
    skos:prefLabel "Workshop participant"@en ;
    arch:usesNotationSet basicnotbubble:BasicBubbleNotation .
`;

/** Document IRI → Turtle, for every document the fixture defines. */
export const BASIC_DOCUMENTS: Readonly<Record<string, string>> = {
  [BASIC_MANIFEST_DOC]: BASIC_MANIFEST_TTL,
  [BASIC_ONTOLOGY_DOC]: BASIC_ONTOLOGY_TTL,
  [BASIC_TAXONOMY_DOC]: BASIC_TAXONOMY_TTL,
  [BASIC_NOTATION_DOC]: BASIC_NOTATION_TTL,
  [BASIC_BUBBLE_DOC]: BASIC_BUBBLE_TTL,
  [BASIC_CONTEXTS_DOC]: BASIC_CONTEXTS_TTL,
};

/**
 * A source serving the fixture documents, then the bundle (the core ontologies
 * the documents import, and the bundled languages). Pass `overrides` to replace
 * or add documents.
 */
export function basicAssetSource(overrides: Readonly<Record<string, string>> = {}): ChainedAssetSource {
  const uploaded = new UploadedAssetSource();
  for (const [documentIri, text] of Object.entries({ ...BASIC_DOCUMENTS, ...overrides })) {
    uploaded.add(documentIri, text);
  }
  return new ChainedAssetSource([uploaded, new BundledAssetSource()]);
}
