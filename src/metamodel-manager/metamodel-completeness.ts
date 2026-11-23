/**
 * What a loaded metamodel leaves out of the palette, or leaves the palette to guess (Req 2.24): a metamodel that
 * defines nothing to draw, one that names no classification, one whose classification names part of its element
 * types. The palette says so, and *Show loaded assets…* lists the types.
 *
 * A type is a metamodel's when one of the documents it takes its types from declares it — its ontology, or one
 * that ontology imports ({@link typeSources}); the core documents are nobody's.
 */

import { DataFactory, type Store } from 'n3';
import type { MetamodelCompleteness, MetamodelFinding, RelationshipTypeInfo } from './interfaces.js';
import type { SemanticClass } from './taxonomy.js';

const { namedNode } = DataFactory;

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const RDFS_SUBCLASS = 'http://www.w3.org/2000/01/rdf-schema#subClassOf';
const OWL_CLASS = 'http://www.w3.org/2002/07/owl#Class';
const SKOS_CONCEPT = 'http://www.w3.org/2004/02/skos/core#Concept';
const CORE = 'https://meta.linked.archi/core';
const ARCH_CONCEPT_CLASSIFICATION = 'https://meta.linked.archi/core#conceptClassification';

/** A loaded metamodel, as the completeness check needs it. */
export interface CheckedMetamodel {
  /** The `arch:Metamodel` subject. */
  iri: string;
  label: string;
  /** The graphs of the documents it loaded, or found loaded. */
  documents: readonly string[];
  /**
   * Those its manifest names as its concepts (`arch:modelConcepts`). With them, only they and what they import
   * give the metamodel its types ({@link typeSources}); without, every document does.
   */
  conceptDocuments?: readonly string[];
}

const OWL_IMPORTS = 'http://www.w3.org/2002/07/owl#imports';

/**
 * The documents a metamodel takes its types from: those its manifest names as its concepts, and what they import,
 * and so on. A document only its shapes, mappings or viewpoints import — another version's ontology, which the
 * shapes of both cover — is loaded, for validation, and gives it no types.
 */
export function typeSources(graph: Store, metamodel: CheckedMetamodel): Set<string> {
  if (!metamodel.conceptDocuments) return new Set(metamodel.documents);
  const loaded = new Set(metamodel.documents);
  const sources = new Set<string>();
  const queue = metamodel.conceptDocuments.filter((d) => loaded.has(d));
  while (queue.length > 0) {
    const document = queue.pop() as string;
    if (sources.has(document)) continue;
    sources.add(document);
    for (const q of graph.getQuads(null, namedNode(OWL_IMPORTS), null, namedNode(document))) {
      const hash = q.object.value.indexOf('#');
      const imported = [q.object.value, hash === -1 ? `${q.object.value}#` : q.object.value.slice(0, hash + 1)].find((d) => loaded.has(d));
      if (imported) queue.push(imported);
    }
  }
  return sources;
}

/**
 * The loaded documents that give no metamodel its types ({@link typeSources}): a class only they declare is not
 * offered. The core's are left out: its classes are never offered anyway.
 */
export function documentsWithoutTypes(graph: Store, metamodels: readonly CheckedMetamodel[]): Set<string> {
  const sources = new Set(metamodels.flatMap((m) => [...typeSources(graph, m)]));
  return new Set(metamodels.flatMap((m) => m.documents).filter((d) => !sources.has(d) && !d.startsWith(CORE)));
}

/** Whether a class is declared in a document other than `excluded` ones — or in none of the store's graphs known. */
export function declaredOutside(graph: Store, iri: string, excluded: ReadonlySet<string>): boolean {
  if (excluded.size === 0) return true;
  const graphs = [RDF_TYPE, RDFS_SUBCLASS].flatMap((p) => graph.getQuads(namedNode(iri), namedNode(p), null, null).map((q) => q.graph.value));
  return graphs.length === 0 || graphs.some((g) => !excluded.has(g));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Each metamodel's findings; a metamodel with none is left out.
 *
 * @param classes The palette's element classes ({@link SemanticClass.unclassified} set by `buildClasses`).
 * @param relationships The palette's relationship types, each with the category its taxonomy gives it.
 * @param groupedByName The palette groups by a guess from the names: no scheme classifies any class.
 */
export function metamodelCompleteness(
  graph: Store,
  metamodels: readonly CheckedMetamodel[],
  classes: readonly SemanticClass[],
  relationships: readonly RelationshipTypeInfo[],
  groupedByName: boolean,
): MetamodelCompleteness[] {
  const result: MetamodelCompleteness[] = [];
  const relationshipsClassified = relationships.some((rel) => rel.category !== undefined);
  for (const metamodel of metamodels) {
    const documents = new Set(metamodel.documents.filter((d) => !d.startsWith(CORE)));
    const sources = new Set([...typeSources(graph, metamodel)].filter((d) => !d.startsWith(CORE)));
    const declaredHere = (iri: string): boolean =>
      [RDF_TYPE, RDFS_SUBCLASS].some((p) =>
        graph.getQuads(namedNode(iri), namedNode(p), null, null).some((q) => sources.has(q.graph.value)),
      );
    const count = (type: string): number => {
      const subjects = new Set<string>();
      for (const d of type === OWL_CLASS ? sources : documents) {
        for (const q of graph.getQuads(null, namedNode(RDF_TYPE), namedNode(type), namedNode(d))) subjects.add(q.subject.value);
      }
      return subjects.size;
    };
    const elements = classes.filter((cls) => declaredHere(cls.iri));
    const own = relationships.filter((rel) => declaredHere(rel.iri));
    const findings: MetamodelFinding[] = [];

    if (elements.length === 0 && own.length === 0) {
      const owlClasses = count(OWL_CLASS);
      const concepts = count(SKOS_CONCEPT);
      findings.push({
        kind: 'nothing-to-draw',
        message:
          owlClasses === 0
            ? `it defines no element or relationship types: its documents hold ${concepts > 0 ? `${plural(concepts, 'concept')} and ` : ''}no classes, so nothing of it can be drawn`
            : `it defines no element or relationship types: none of its ${plural(owlClasses, 'class', 'classes')} is a subclass of arch:Element or arch:QualifiedRelationship, so nothing of it can be drawn`,
      });
    }

    const unclassified = elements.filter((cls) => cls.unclassified);
    const namesClassification =
      graph.getQuads(namedNode(metamodel.iri), namedNode(ARCH_CONCEPT_CLASSIFICATION), null, null).length > 0;
    if (elements.length > 0 && !namesClassification) {
      findings.push({
        kind: 'no-classification',
        message: `it names no classification (arch:conceptClassification): its ${plural(elements.length, 'element type')} ${elements.length === 1 ? 'is' : 'are'} ${groupedByName ? 'grouped by a guess from their names' : 'listed under “Other”'}`,
        types: elements.map((cls) => cls.label).sort((a, b) => a.localeCompare(b)),
      });
    } else if (elements.length > 0 && groupedByName) {
      findings.push({
        kind: 'unclassified-elements',
        message: `its classification names none of its ${plural(elements.length, 'element type')}: ${elements.length === 1 ? 'it is' : 'they are'} grouped by a guess from ${elements.length === 1 ? 'its name' : 'their names'}`,
        types: elements.map((cls) => cls.label).sort((a, b) => a.localeCompare(b)),
      });
    } else if (unclassified.length > 0) {
      findings.push({
        kind: 'unclassified-elements',
        message: `its classification names ${elements.length - unclassified.length} of its ${plural(elements.length, 'element type')}: the other ${unclassified.length} ${unclassified.length === 1 ? 'is' : 'are'} listed under “Other”`,
        types: unclassified.map((cls) => cls.label).sort((a, b) => a.localeCompare(b)),
      });
    }

    // A relationship type no dimension lists, where dimensions list others: it has no category.
    const uncategorised = relationshipsClassified ? own.filter((rel) => rel.category === undefined) : [];
    if (uncategorised.length > 0) {
      findings.push({
        kind: 'unclassified-relationships',
        message: `${uncategorised.length} of its ${plural(own.length, 'relationship type')} ${uncategorised.length === 1 ? 'is' : 'are'} in no category, and listed under “Other”`,
        types: uncategorised.map((rel) => rel.label).sort((a, b) => a.localeCompare(b)),
      });
    }

    if (findings.length > 0) result.push({ metamodelIri: metamodel.iri, label: metamodel.label, findings });
  }
  return result;
}
