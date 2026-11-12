/**
 * Copy and paste, store-side (`clipboard.ts`; the copy-paste task's R1–R14).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DataFactory, Parser } from 'n3';
import type { NamedNode } from '@rdfjs/types';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { ObservableRdfStore } from '../../rdf-engine/observable-store.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';
import { OxigraphElementManager } from '../element-manager.js';
import { OxigraphRelationshipManager } from '../relationship-manager.js';
import { OxigraphViewManager } from '../view-manager.js';
import { applyFolderChange, moveToFolder, newFolder } from '../folders.js';
import { snapshotOf } from '../version-history.js';
import { IRI, T, langLiteral, nn, triple } from '../vocabulary.js';
import {
  copyConcepts,
  copyFromView,
  fragmentTurtle,
  pasteFragment,
  readFragment,
  writeFragment,
  type ClipboardFragment,
  type PasteDeps,
} from '../clipboard.js';

const MODEL = 'https://model.example.com/m/model';
const OTHER_MODEL = 'https://model.example.com/n/model';
const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const COMPONENT = `${AM4}ApplicationComponent`;
const SERVING = `${AM4}Serving`;
const SERVES = `${AM4}serves`;
const ASSOCIATION = `${AM4}Association`;
const ASSOCIATED = `${AM4}associatedWith`;
const IDENTIFIER = NAMESPACES.dcterms + 'identifier';
const box = (x: number, y: number) => ({ x, y, width: 120, height: 55 });

let store: ObservableRdfStore;
let deps: PasteDeps & { elements: OxigraphElementManager; relationships: OxigraphRelationshipManager; views: OxigraphViewManager };
let a: string, b: string, c: string, r1: string, r2: string, v1: string, v2: string;

const objects = (s: string, p: string) => store.getQuads(nn(s), nn(p), null).map((q) => q.object.value);
const source = (viewIri: string, modelIri = MODEL) => ({ modelIri, viewIri, metamodelIris: [], version: 'test' });
const nodeOf = (view: string, element: string) => deps.views.getNodes(view).find((n) => n.elementIri === element)!.nodeIri;
const modelElements = () => store.getQuads(null, T.inModel, nn(MODEL)).map((q) => q.subject.value).filter((s) => !s.includes('/view-'));

beforeEach(() => {
  store = new ObservableRdfStore(new OxigraphRdfStore());
  deps = {
    store,
    elements: new OxigraphElementManager(store),
    relationships: new OxigraphRelationshipManager(store),
    views: new OxigraphViewManager(store),
  };
  [a, b, c] = ['A', 'B', 'C'].map((label) => deps.elements.createElement(COMPONENT, MODEL, { label }).value);
  store.addQuads([
    triple(nn(a), T.prefLabel, langLiteral('A-fr', 'fr')),
    triple(nn(a), T.definition, langLiteral('What A is')),
    triple(nn(a), nn(IDENTIFIER), DataFactory.literal('APP-1') as unknown as NamedNode),
  ]);
  const relate = (s: string, t: string) =>
    deps.relationships.createQualifiedRelationship({ typeIri: SERVING, predicateIri: SERVES, sourceIri: s, targetIri: t, modelIri: MODEL }).iri;
  r1 = relate(a, b);
  r2 = relate(b, c);
  v1 = deps.views.createView('Diagram', undefined, { modelIri: MODEL }).value;
  v2 = deps.views.createView('Diagram', undefined, { modelIri: MODEL }).value;
  deps.views.addElementToView(v1, a, box(100, 100));
  deps.views.addElementToView(v1, b, box(300, 100));
  deps.views.addElementToView(v1, c, box(500, 100));
  deps.views.addRelationshipToView(v1, r1, [{ x: 220, y: 127 }, { x: 260, y: 140 }, { x: 300, y: 127 }]);
  deps.views.addRelationshipToView(v1, r2);
  deps.views.setLinkLabel!(v1, r1, { x: 230, y: 90, width: 60, height: 13 });
});

describe('the copy (R1, R3)', () => {
  it('holds the selected placements, the links between them and the concepts they draw — not a relationship with one end left', () => {
    const copy = copyFromView(store, deps.views, source(v1), [nodeOf(v1, a), nodeOf(v1, b)]);
    expect(new Set(copy.concepts)).toEqual(new Set([a, b, r1]));
    expect(copy.nodes).toHaveLength(2);
    expect(copy.links).toHaveLength(1);
    expect(copy.concepts).not.toContain(r2);
  });

  it("holds a concept's properties, its folder and a relationship's triple — not what places it", () => {
    const folder = newFolder(store, MODEL, 'Applications');
    applyFolderChange(store, folder.change);
    applyFolderChange(store, moveToFolder(store, a, folder.iri, MODEL));
    const copy = copyFromView(store, deps.views, source(v1), [nodeOf(v1, a), nodeOf(v1, b)]);
    const has = (s: string, p: string, o?: string) => copy.quads.some((q) => q.subject.value === s && q.predicate.value === p && (!o || q.object.value === o));
    expect(has(a, IDENTIFIER)).toBe(true);
    expect(has(a, IRI.dctermsIsPartOf, folder.iri)).toBe(true);
    expect(has(a, SERVES, b)).toBe(true);
    expect(has(a, IRI.inView)).toBe(false);
    expect(has(a, IRI.inModel)).toBe(false);
    expect(has(r1, IRI.reifies)).toBe(true);
  });

  it('takes what is nested in a copied placement with it', () => {
    const group = deps.views.addFigure!(v1, { kind: 'group', text: 'Front end', bounds: { x: 80, y: 80, width: 400, height: 200 } });
    deps.views.setNodeParent!(v1, nodeOf(v1, a), group);
    const copy = copyFromView(store, deps.views, source(v1), [group]);
    expect(copy.nodes).toContain(nodeOf(v1, a));
    expect(copy.concepts).toEqual([a]);
  });

  it('is written in la-gram\'s format and read back the same, and is valid Turtle as text (R4)', () => {
    const copy = copyFromView(store, deps.views, source(v1), [nodeOf(v1, a), nodeOf(v1, b)]);
    const back = readFragment(writeFragment(copy))!;
    expect(back.source).toEqual(copy.source);
    expect(back.concepts).toEqual(copy.concepts);
    expect(snapshotOf(back.quads)).toEqual(snapshotOf(copy.quads));
    expect(readFragment('{"format":"something else"}')).toBeUndefined();
    expect(readFragment('not JSON')).toBeUndefined();
    const turtle = fragmentTurtle(copy, { am4: AM4, skos: NAMESPACES.skos, m: 'https://model.example.com/m/' });
    expect(() => new Parser({ format: 'text/turtle' }).parse(turtle)).not.toThrow();
    expect(turtle).toContain('am4:ApplicationComponent');
  });
});

describe('pasting (R5–R10)', () => {
  let copy: ClipboardFragment;
  beforeEach(() => {
    copy = copyFromView(store, deps.views, source(v1), [nodeOf(v1, a), nodeOf(v1, b)]);
  });

  it('into another view of the same model: the same concepts placed again, no new concept (R5)', () => {
    const concepts = modelElements().length;
    const result = pasteFragment(deps, copy, { modelIri: MODEL, viewIri: v2 });
    expect(result.mode).toBe('references');
    expect(modelElements()).toHaveLength(concepts);
    expect(new Set(deps.views.getNodes(v2).map((n) => n.elementIri))).toEqual(new Set([a, b]));
    expect(deps.views.getLinks(v2).map((l) => l.relationshipIri)).toEqual([r1]);
    expect(result).toMatchObject({ elementsPlaced: 2, relationshipsPlaced: 1, elementsCopied: 0, relationshipsCopied: 0 });
  });

  it('into the same view: copies with their names and definitions only, nothing pointing at the originals (R5, R7)', () => {
    const result = pasteFragment(deps, copy, { modelIri: MODEL, viewIri: v1 });
    expect(result.mode).toBe('copies');
    expect(result).toMatchObject({ elementsCopied: 2, relationshipsCopied: 1, elementsPlaced: 2, relationshipsPlaced: 1, propertiesLeftOut: 1 });
    const a2 = result.copied.get(a)!;
    const b2 = result.copied.get(b)!;
    const r12 = result.copied.get(r1)!;
    expect(a2.startsWith('https://model.example.com/m/')).toBe(true);
    expect(objects(a2, IRI.rdfType)).toContain(COMPONENT);
    expect(new Set(objects(a2, IRI.prefLabel))).toEqual(new Set(['A', 'A-fr']));
    expect(objects(a2, IRI.definition)).toEqual(['What A is']);
    expect(objects(a2, IDENTIFIER)).toEqual([]);
    expect(objects(r12, IRI.source)).toEqual([a2]);
    expect(objects(r12, IRI.target)).toEqual([b2]);
    expect(objects(a2, SERVES)).toEqual([b2]);
    const pointsAtOriginals = store.getQuads(null, null, null).filter(
      (q) => [a2, b2, r12].includes(q.subject.value) && [a, b, r1].includes(q.object.value),
    );
    expect(pointsAtOriginals).toEqual([]);
    expect(new Set(deps.views.getNodes(v1).filter((n) => result.nodes.includes(n.nodeIri)).map((n) => n.elementIri))).toEqual(new Set([a2, b2]));
  });

  it('a copy in the same model is filed in the original\'s folder (R7)', () => {
    const folder = newFolder(store, MODEL, 'Applications');
    applyFolderChange(store, folder.change);
    applyFolderChange(store, moveToFolder(store, a, folder.iri, MODEL));
    const fresh = copyFromView(store, deps.views, source(v1), [nodeOf(v1, a)]);
    const result = pasteFragment(deps, fresh, { modelIri: MODEL, viewIri: v1 }, { mode: 'copies' });
    expect(objects(result.copied.get(a)!, IRI.dctermsIsPartOf)).toEqual([folder.iri]);
  });

  it('forced: copies into another view, references into the same one (R6)', () => {
    expect(pasteFragment(deps, copy, { modelIri: MODEL, viewIri: v2 }, { mode: 'copies' }).elementsCopied).toBe(2);
    const again = pasteFragment(deps, copy, { modelIri: MODEL, viewIri: v1 }, { mode: 'references' });
    expect(again).toMatchObject({ mode: 'references', elementsCopied: 0, elementsPlaced: 2 });
    expect(deps.views.getNodes(v1).filter((n) => n.elementIri === a)).toHaveLength(2);
  });

  it('at the pointer: the top-left there, routes and moved names moved with it (R10)', () => {
    const result = pasteFragment(deps, copy, { modelIri: MODEL, viewIri: v2 }, { at: { x: 600, y: 400 } });
    const nodes = deps.views.getNodes(v2);
    expect(Math.min(...nodes.map((n) => n.bounds.x))).toBe(600);
    expect(Math.min(...nodes.map((n) => n.bounds.y))).toBe(400);
    const link = deps.views.getLinks(v2).find((l) => result.links.includes(l.linkIri))!;
    expect(link.waypoints[1]).toEqual({ x: 760, y: 440 });
    expect(link.label).toMatchObject({ x: 730, y: 390 });
  });

  it('otherwise by the offset given (R10)', () => {
    pasteFragment(deps, copy, { modelIri: MODEL, viewIri: v2 }, { offset: { x: 20, y: 20 } });
    expect(deps.views.getNode(v2, a)!.bounds).toMatchObject({ x: 120, y: 120 });
  });

  it('a reference no longer in the model is pasted as a copy, and said so (R8)', () => {
    deps.relationships.deleteRelationship(r1);
    deps.elements.deleteElement(b);
    const result = pasteFragment(deps, copy, { modelIri: MODEL, viewIri: v2 });
    expect(result.mode).toBe('references');
    expect(result.copied.has(a)).toBe(false);
    expect(result.copied.has(b)).toBe(true);
    expect(result.copied.has(r1)).toBe(true);
    expect(objects(result.copied.get(r1)!, IRI.source)).toEqual([a]);
    expect(result.notes.map((n) => n.reason)).toEqual(['no-longer-in-model', 'no-longer-in-model']);
  });

  it('is undone exactly: the store as it was (R13)', () => {
    const before = snapshotOf(store.getQuads());
    const { added, removed } = store.record(() => pasteFragment(deps, copy, { modelIri: MODEL, viewIri: v1 }));
    expect(added.length).toBeGreaterThan(0);
    store.applyDiff({ added, removed }, true);
    expect(snapshotOf(store.getQuads())).toEqual(before);
  });
});

describe('links on links, connectors and figures', () => {
  it('a relationship ending on a copied relationship goes with it, and ends on its copy', () => {
    const assoc = deps.relationships.createQualifiedRelationship({ typeIri: ASSOCIATION, predicateIri: ASSOCIATED, sourceIri: c, targetIri: r1, modelIri: MODEL }).iri;
    const r1Link = deps.views.getLinks(v1).find((l) => l.relationshipIri === r1)!.linkIri;
    deps.views.addRelationshipToView(v1, assoc, undefined, { sourceNodeIri: nodeOf(v1, c), targetNodeIri: r1Link });
    const copy = copyFromView(store, deps.views, source(v1), [nodeOf(v1, a), nodeOf(v1, b), nodeOf(v1, c)]);
    expect(copy.concepts).toContain(assoc);
    const result = pasteFragment(deps, copy, { modelIri: MODEL, viewIri: v1 }, { mode: 'copies' });
    expect(objects(result.copied.get(assoc)!, IRI.target)).toEqual([result.copied.get(r1)]);
    const pastedLinks = deps.views.getLinks(v1).filter((l) => result.links.includes(l.linkIri));
    expect(pastedLinks).toHaveLength(3);
    const r1Copy = pastedLinks.find((l) => l.relationshipIri === result.copied.get(r1))!;
    expect(pastedLinks.find((l) => l.relationshipIri === result.copied.get(assoc))!.targetNodeIri).toBe(r1Copy.linkIri);
  });

  it('a connector between copied figures, with its text', () => {
    const n1 = deps.views.addFigure!(v1, { kind: 'note', text: 'One', bounds: box(100, 400) });
    const n2 = deps.views.addFigure!(v1, { kind: 'note', text: 'Two', bounds: box(300, 400) });
    const connector = deps.views.addConnector!(v1, { sourceNodeIri: n1, targetNodeIri: n2 })!;
    deps.views.setConnectorText!(v1, connector, 'leads to');
    const copy = copyFromView(store, deps.views, source(v1), [n1, n2]);
    expect(copy.concepts).toEqual([]);
    const result = pasteFragment(deps, copy, { modelIri: MODEL, viewIri: v2 });
    const pasted = deps.views.getLinks(v2);
    expect(pasted).toHaveLength(1);
    expect(pasted[0]).toMatchObject({ connector: true, text: 'leads to' });
    expect(deps.views.getNodes(v2).map((n) => n.figure?.text).sort()).toEqual(['One', 'Two']);
    expect(result.nodes).toHaveLength(2);
  });
});

describe('into another model (R9)', () => {
  let otherView: string;
  beforeEach(() => {
    otherView = deps.views.createView('Diagram', undefined, { modelIri: OTHER_MODEL }).value;
  });

  it('always copies, in its namespace; references asked for are copies, said so', () => {
    const copy = copyFromView(store, deps.views, source(v1), [nodeOf(v1, a), nodeOf(v1, b)]);
    const result = pasteFragment(deps, copy, { modelIri: OTHER_MODEL, viewIri: otherView }, { mode: 'references' });
    expect(result).toMatchObject({ mode: 'copies', referencesImpossible: true, elementsCopied: 2, relationshipsCopied: 1 });
    expect(result.copied.get(a)!.startsWith('https://model.example.com/n/')).toBe(true);
    expect(objects(result.copied.get(a)!, IRI.inModel)).toEqual([OTHER_MODEL]);
  });

  it('an element of a type no metamodel defines: kept, or left out with what ends on it, as chosen', () => {
    const metamodel = nn('https://meta.linked.archi/archimate4/onto');
    store.addQuads([DataFactory.quad(nn(COMPONENT), T.rdfType, nn(NAMESPACES.owl + 'Class'), metamodel) as never]);
    const thing = deps.elements.createElement('https://model.example.com/vocabulary#Thing', MODEL, { label: 'Thing' }).value;
    deps.views.addElementToView(v1, thing, box(100, 300));
    const r3 = deps.relationships.createQualifiedRelationship({ typeIri: SERVING, predicateIri: SERVES, sourceIri: a, targetIri: thing, modelIri: MODEL }).iri;
    deps.views.addRelationshipToView(v1, r3);
    const copy = copyFromView(store, deps.views, source(v1), [nodeOf(v1, a), nodeOf(v1, thing)]);

    const kept = pasteFragment(deps, copy, { modelIri: OTHER_MODEL, viewIri: otherView });
    expect(kept.elementsCopied).toBe(2);

    const skipped = pasteFragment(deps, copy, { modelIri: OTHER_MODEL, viewIri: otherView }, { unknownTypes: 'skip' });
    expect(skipped.elementsCopied).toBe(1);
    expect(skipped.notes).toEqual([
      { iri: thing, reason: 'unknown-type' },
      { iri: r3, reason: 'end-left-out' },
    ]);
  });
});

describe('into another model, a relationship its rules do not permit (R9)', () => {
  it('is left out, and listed', () => {
    const otherView = deps.views.createView('Diagram', undefined, { modelIri: OTHER_MODEL }).value;
    const metamodel = nn('https://meta.linked.archi/archimate4/onto');
    const q = (s: string, p: string, o: string) => DataFactory.quad(nn(s), nn(p), nn(o), metamodel) as never;
    store.addQuads([
      q(COMPONENT, IRI.rdfType, NAMESPACES.owl + 'Class'),
      q(COMPONENT, NAMESPACES.rdfs + 'subClassOf', IRI.Element),
      q(SERVING, IRI.rdfType, NAMESPACES.owl + 'Class'),
      q(SERVING, NAMESPACES.rdfs + 'subClassOf', IRI.QualifiedRelationship),
      q(SERVING, IRI.unqualifiedForm, SERVES),
      // Serving only from a service, here: never between two components.
      q(SERVING, NAMESPACES.arch + 'domainIncludes', `${AM4}ApplicationService`),
    ]);
    expect(deps.relationships.getValidRelationships(COMPONENT, COMPONENT).map((r) => r.iri)).not.toContain(SERVING);
    const copy = copyFromView(store, deps.views, source(v1), [nodeOf(v1, a), nodeOf(v1, b)]);
    const result = pasteFragment(deps, copy, { modelIri: OTHER_MODEL, viewIri: otherView });
    expect(result).toMatchObject({ elementsCopied: 2, relationshipsCopied: 0, relationshipsPlaced: 0 });
    expect(result.notes).toEqual([{ iri: r1, reason: 'not-permitted' }]);
    expect(deps.views.getLinks(otherView)).toEqual([]);
  });
});

describe('from the model tree (R14)', () => {
  it('copies the concepts chosen and the relationships between them; pasted in rows of six, with those relationships', () => {
    const copy = copyConcepts(store, { modelIri: MODEL, metamodelIris: [] }, [a, b]);
    expect(new Set(copy.concepts)).toEqual(new Set([a, b, r1]));
    expect(copy.nodes).toEqual([]);
    const result = pasteFragment(deps, copy, { modelIri: MODEL, viewIri: v2 }, { at: { x: 50, y: 60 }, sizeOf: () => ({ width: 100, height: 40 }) });
    expect(result.mode).toBe('references');
    const nodes = deps.views.getNodes(v2);
    expect(nodes.map((n) => n.bounds).sort((p, q) => p.x - q.x)).toEqual([
      { x: 50, y: 60, width: 100, height: 40 },
      { x: 220, y: 60, width: 100, height: 40 },
    ]);
    expect(deps.views.getLinks(v2).map((l) => l.relationshipIri)).toEqual([r1]);
  });
});
