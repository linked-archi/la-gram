/**
 * The Linked.Archi IRI layout (DD-41) in la-gram: what it mints — resources `{ns}{kind}/{uuid}`, shapes in their
 * view's IRI, parts under their owner with `/` — and what it reads and edits in place: its own names from before
 * the layout (`-style`, `-points-{i}`, `-p{i}`, `-label`, `-name-…`, `-picture`) and the converters' (`/style`,
 * `/points/{i}`, `/point/{i}`). A tool never renames a part (`.agents/tasks/iri-layout/requirements.md`, R11–R16).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DataFactory, Parser } from 'n3';
import type { NamedNode, Quad } from '@rdfjs/types';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { ObservableRdfStore } from '../../rdf-engine/observable-store.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';
import { OxigraphElementManager } from '../element-manager.js';
import { OxigraphRelationshipManager } from '../relationship-manager.js';
import { OxigraphViewManager } from '../view-manager.js';
import { copyFromView, pasteFragment, type PasteDeps } from '../clipboard.js';
import { ModelIO } from '../../import-export/model-io.js';
import { contextNameChange } from '../context-names.js';
import { pictureChange } from '../element-pictures.js';
import { IRI, T, langLiteral, nn, quadKey, triple } from '../vocabulary.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const CONTEXT = 'https://model.example.com/contexts#Developer';

let store: ObservableRdfStore;
let deps: PasteDeps & { elements: OxigraphElementManager; relationships: OxigraphRelationshipManager; views: OxigraphViewManager };

beforeEach(() => {
  store = new ObservableRdfStore(new OxigraphRdfStore());
  deps = {
    store,
    elements: new OxigraphElementManager(store),
    relationships: new OxigraphRelationshipManager(store),
    views: new OxigraphViewManager(store),
  };
});

const load = (turtle: string) => store.addQuads(new Parser({ format: 'text/turtle' }).parse(turtle) as unknown as Quad[]);
const objects = (s: string, p: string) => store.getQuads(nn(s), nn(p), null).map((q) => q.object.value);
const subjects = () => new Set(store.getQuads(null, null, null).map((q) => q.subject.value));
/** What a change removed and added, as statements — watched on the store. */
function changeOf(run: () => void): { removed: string[]; added: string[] } {
  const before = new Set(store.getQuads(null, null, null).map(quadKey));
  run();
  const after = new Set(store.getQuads(null, null, null).map(quadKey));
  return { removed: [...before].filter((k) => !after.has(k)), added: [...after].filter((k) => !before.has(k)) };
}
const subjectOf = (key: string) => key.split('\u0000')[0];

/** A model with one view: two placements, one with a style, and a line with two bends and a moved name. */
function model(names: { ns: string; view: string; node: (id: string) => string; link: string; part: (owner: string, part: string) => string; cell: (i: number) => string; point: (i: number) => string }) {
  const { ns, view, node, link, part, cell, point } = names;
  load(`
    @prefix arch: <https://meta.linked.archi/core#>.
    @prefix arch-vis: <https://meta.linked.archi/core-vis#>.
    @prefix am4: <${AM4}>.
    @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>.
    @prefix skos: <http://www.w3.org/2004/02/skos/core#>.
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#>.
    <${ns}model> a arch:Model.
    <${ns}a> a am4:ApplicationComponent; skos:prefLabel "A"@en; arch:inModel <${ns}model>; arch:inView <${view}>; am4:serves <${ns}b>.
    <${ns}b> a am4:ApplicationComponent; skos:prefLabel "B"@en; arch:inModel <${ns}model>; arch:inView <${view}>.
    <${ns}r> a am4:Serving; arch:source <${ns}a>; arch:target <${ns}b>; arch:inModel <${ns}model>; arch:inView <${view}>.
    <${view}> a arch:View, arch:Diagram; arch:inModel <${ns}model>.
    <${node('a')}> a arch-vis:ArchNode; arch-vis:view <${view}>; arch-vis:archElement <${ns}a>;
      arch-vis:bounds-x "0"^^xsd:double; arch-vis:bounds-y "0"^^xsd:double; arch-vis:bounds-w "120"^^xsd:double; arch-vis:bounds-h "55"^^xsd:double;
      arch-vis:style <${part(node('a'), 'style')}>.
    <${part(node('a'), 'style')}> a arch-vis:Style; arch-vis:fillColor "#ffffff".
    <${node('b')}> a arch-vis:ArchNode; arch-vis:view <${view}>; arch-vis:archElement <${ns}b>;
      arch-vis:bounds-x "300"^^xsd:double; arch-vis:bounds-y "0"^^xsd:double; arch-vis:bounds-w "120"^^xsd:double; arch-vis:bounds-h "55"^^xsd:double.
    <${link}> a arch-vis:Link; arch-vis:view <${view}>; arch-vis:archRelationship <${ns}r>;
      arch-vis:source <${node('a')}>; arch-vis:target <${node('b')}>; arch-vis:points <${cell(0)}>; arch-vis:label <${part(link, 'label')}>.
    <${cell(0)}> rdf:first <${point(0)}>; rdf:rest <${cell(1)}>.
    <${cell(1)}> rdf:first <${point(1)}>; rdf:rest rdf:nil.
    <${point(0)}> a arch-vis:Point; arch-vis:point-x "200"^^xsd:double; arch-vis:point-y "27"^^xsd:double.
    <${point(1)}> a arch-vis:Point; arch-vis:point-x "250"^^xsd:double; arch-vis:point-y "27"^^xsd:double.
    <${part(link, 'label')}> a arch-vis:LabelNode; arch-vis:view <${view}>;
      arch-vis:bounds-x "220"^^xsd:double; arch-vis:bounds-y "5"^^xsd:double; arch-vis:bounds-w "60"^^xsd:double; arch-vis:bounds-h "13"^^xsd:double.
  `);
  return { ...names, r: `${ns}r`, a: `${ns}a` };
}

/** la-gram's names before DD-41. */
const legacyNames = (() => {
  const ns = 'https://model.example.com/legacy/';
  const link = `${ns}link-r`;
  return {
    ns,
    view: `${ns}view-1`,
    node: (id: string) => `${ns}node-${id}`,
    link,
    part: (owner: string, part: string) => `${owner}-${part}`,
    cell: (i: number) => `${link}-points-${i}`,
    point: (i: number) => `${link}-p${i}`,
  };
})();

/** The converters' names before DD-41: shapes nested under the view, parts under them with `/`. */
const converterNames = (() => {
  const ns = 'https://model.example.com/converted/';
  const view = `${ns}view/v1`;
  const link = `${view}/connection/c1`;
  return {
    ns,
    view,
    node: (id: string) => `${view}/node/${id}`,
    link,
    part: (owner: string, part: string) => `${owner}/${part}`,
    cell: (i: number) => `${link}/points/${i}`,
    point: (i: number) => `${link}/point/${i}`,
  };
})();

describe.each([
  ['a model la-gram saved before DD-41', legacyNames],
  ['a converted model', converterNames],
])('%s, edited, keeps its names (R15)', (_, names) => {
  it('a new colour is written on the placement’s own style, in place, and nothing is left behind', () => {
    const m = model(names);
    const style = m.part(m.node('a'), 'style');
    const change = changeOf(() => deps.views.setAppearance(m.view, m.node('a'), { fillColor: '#ff0000' }));
    expect(objects(m.node('a'), IRI.visStyle)).toEqual([style]);
    expect(objects(style, T.fillColor.value)).toEqual(['#ff0000']);
    // Only the value changed: one statement out, one in, on the style.
    expect(change.removed.map(subjectOf)).toEqual([style]);
    expect(change.added.map(subjectOf)).toEqual([style]);
  });

  it('removing the placement removes its own style with it', () => {
    const m = model(names);
    const style = m.part(m.node('a'), 'style');
    deps.views.removeElementFromView(m.view, m.node('a'));
    expect(subjects().has(style)).toBe(false);
  });

  it('moving a bend changes only its coordinates; one added is named in the route’s pattern', () => {
    const m = model(names);
    const moved = changeOf(() => deps.views.updateLinkWaypoints(m.view, m.r, [{ x: 200, y: 27 }, { x: 260, y: 40 }]));
    expect(moved.removed.map(subjectOf)).toEqual([m.point(1), m.point(1)]);
    expect(moved.added.map(subjectOf)).toEqual([m.point(1), m.point(1)]);
    expect(deps.views.getLinks(m.view)[0]!.waypoints).toEqual([{ x: 200, y: 27 }, { x: 260, y: 40 }]);

    deps.views.updateLinkWaypoints(m.view, m.r, [{ x: 200, y: 27 }, { x: 260, y: 40 }, { x: 290, y: 40 }]);
    expect(objects(m.cell(1), IRI.rdfRest)).toEqual([m.cell(2)]);
    expect(objects(m.cell(2), IRI.rdfFirst)).toEqual([m.point(2)]);
    expect(objects(m.cell(2), IRI.rdfRest)).toEqual([IRI.rdfNil]);

    deps.views.updateLinkWaypoints(m.view, m.r, [{ x: 200, y: 27 }]);
    expect(subjects().has(m.cell(1))).toBe(false);
    expect(subjects().has(m.point(2))).toBe(false);
    expect(objects(m.cell(0), IRI.rdfRest)).toEqual([IRI.rdfNil]);
  });

  it('a line’s name moved again keeps its label’s name', () => {
    const m = model(names);
    deps.views.setLinkLabel!(m.view, m.r, { x: 10, y: 10, width: 60, height: 13 });
    expect(objects(m.link, IRI.visLabel)).toEqual([m.part(m.link, 'label')]);
    expect(deps.views.getLinks(m.view)[0]!.label).toEqual({ x: 10, y: 10, width: 60, height: 13 });
  });

  it('saved and opened again, has every IRI it had', () => {
    const m = model(names);
    const iris = () => new Set(store.getQuads(null, null, null).flatMap((q) => [q.subject, q.object].filter((t) => t.termType === 'NamedNode').map((t) => t.value)));
    const before = iris();
    const io = new ModelIO(store);
    for (const format of ['turtle', 'trig'] as const) {
      io.load(io.serialize(`${m.ns}model`, { format }), format === 'turtle' ? 'model.ttl' : 'model.trig');
      expect(iris()).toEqual(before);
    }
  });

  it('copied and pasted, a line keeps its bends', () => {
    const m = model(names);
    const copy = copyFromView(store, deps.views, { modelIri: `${m.ns}model`, viewIri: m.view, metamodelIris: [] }, [m.node('a'), m.node('b')]);
    const target = deps.views.createView('Diagram', undefined, { modelIri: `${m.ns}model` }).value;
    pasteFragment(deps, copy, { modelIri: `${m.ns}model`, viewIri: target });
    const [line] = deps.views.getLinks(target);
    expect(line!.waypoints).toHaveLength(2);
  });
});

describe('a name and a picture for a presentation context, as la-gram named them before DD-41', () => {
  it('keep their names when they change, and the change is only what differs', () => {
    const element = 'https://model.example.com/legacy/element-a';
    const label = `${element}-name-0a1b2c3d`;
    const picture = `${element}-picture`;
    store.addQuads([
      triple(nn(element), T.skosxlAltLabel, nn(label)),
      triple(nn(label), T.rdfType, T.skosxlLabel),
      triple(nn(label), T.skosxlLiteralForm, langLiteral('Old')),
      triple(nn(label), T.inPresentationContext, nn(CONTEXT)),
      triple(nn(element), T.altLabel, langLiteral('Old')),
      triple(nn(element), T.prefVisNotation, nn(picture)),
      triple(nn(picture), T.rdfType, T.ImageObject),
      triple(nn(picture), T.contentUrl, DataFactory.literal('https://model.example.com/a.svg', nn(NAMESPACES.xsd + 'anyURI')) as unknown as NamedNode),
    ]);

    const name = contextNameChange(store, element, CONTEXT, 'New');
    expect(name.add.map((q) => q.subject.value)).not.toContain(`${element}/name/0a1b2c3d`);
    expect(name.remove.some((q) => q.predicate.value === IRI.rdfType)).toBe(false);
    store.removeQuads(name.remove);
    store.addQuads(name.add);
    expect(objects(element, T.skosxlAltLabel.value)).toEqual([label]);
    expect(objects(label, T.skosxlLiteralForm.value)).toEqual(['New']);

    const image = pictureChange(store, element, undefined, 'https://model.example.com/b.svg');
    store.removeQuads(image.remove);
    store.addQuads(image.add);
    expect(objects(element, T.prefVisNotation.value)).toEqual([picture]);
    expect(objects(picture, T.contentUrl.value)).toEqual(['https://model.example.com/b.svg']);
  });
});

describe('what la-gram mints (R11, R12)', () => {
  const NS = 'https://model.example.com/new/';
  const MODEL = `${NS}model`;

  it('names a placement, its look, its route, its name and its label in the view’s IRI', () => {
    store.addQuads([triple(nn(MODEL), T.rdfType, T.Model)]);
    const a = deps.elements.createElement(`${AM4}ApplicationComponent`, MODEL, { label: 'A' }).value;
    const b = deps.elements.createElement(`${AM4}ApplicationComponent`, MODEL, { label: 'B' }).value;
    expect(a).toMatch(new RegExp(`^${NS}element/${UUID}$`));
    const r = deps.relationships.createQualifiedRelationship({ typeIri: `${AM4}Serving`, predicateIri: `${AM4}serves`, sourceIri: a, targetIri: b, modelIri: MODEL }).iri;
    expect(r).toMatch(new RegExp(`^${NS}relationship/${UUID}$`));
    const view = deps.views.createView('Diagram', undefined, { modelIri: MODEL }).value;
    expect(view).toMatch(new RegExp(`^${NS}view/${UUID}$`));

    const node = deps.views.addElementToView(view, a, { x: 0, y: 0, width: 120, height: 55 });
    deps.views.addElementToView(view, b, { x: 300, y: 0, width: 120, height: 55 });
    expect(node).toMatch(new RegExp(`^${view}#node/${UUID}$`));
    const link = deps.views.addRelationshipToView(view, r, [{ x: 200, y: 27 }, { x: 250, y: 27 }])!;
    expect(link).toMatch(new RegExp(`^${view}#link/${UUID}$`));
    expect(objects(link, IRI.points)).toEqual([`${link}/points/0`]);
    expect(objects(`${link}/points/0`, IRI.rdfFirst)).toEqual([`${link}/point/0`]);
    expect(objects(`${link}/points/0`, IRI.rdfRest)).toEqual([`${link}/points/1`]);

    deps.views.setAppearance(view, node, { fillColor: '#ff0000' });
    expect(objects(node, IRI.visStyle)).toEqual([`${node}/style`]);
    deps.views.setAppearance(view, node, { fillColor: '#00ff00' }, CONTEXT);
    expect(objects(node, IRI.visStyle).find((s) => s !== `${node}/style`)).toMatch(new RegExp(`^${node}/style/[0-9a-f]{8}$`));
    deps.views.setLabelExpression(view, node, undefined, '{name}');
    expect(objects(`${node}/style`, IRI.labelExpression)).toEqual([`${node}/label-expression`]);
    deps.views.setLinkLabel!(view, r, { x: 10, y: 10, width: 60, height: 13 });
    expect(objects(link, IRI.visLabel)).toEqual([`${link}/label`]);

    // Every IRI has at most one `#`, and a shape's parts stay in its fragment.
    const all = [...subjects()];
    expect(all.filter((s) => s.split('#').length > 2)).toEqual([]);
    expect(all.filter((s) => s.startsWith(`${view}#`)).every((s) => /#(?:node|link)\//.test(s))).toBe(true);
  });

  it('mints a relationship drawn with no model named in its source’s model’s namespace', () => {
    store.addQuads([triple(nn(MODEL), T.rdfType, T.Model)]);
    const a = deps.elements.createElement(`${AM4}ApplicationComponent`, MODEL, { label: 'A' }).value;
    const b = deps.elements.createElement(`${AM4}ApplicationComponent`, MODEL, { label: 'B' }).value;
    const r = deps.relationships.createRelationship(`${AM4}serves`, a, b, true)!.value;
    expect(r).toMatch(new RegExp(`^${NS}relationship/${UUID}$`));
  });

  it('mints a shape flat in a view whose IRI already holds a #, as before the layout', () => {
    const ns = 'https://model.example.com/hash#';
    store.addQuads([triple(nn(`${ns}model`), T.rdfType, T.Model)]);
    const a = deps.elements.createElement(`${AM4}ApplicationComponent`, `${ns}model`, { label: 'A' }).value;
    const view = deps.views.createView('Diagram', undefined, { modelIri: `${ns}model`, iri: `${ns}view-1` }).value;
    const node = deps.views.addElementToView(view, a, { x: 0, y: 0, width: 120, height: 55 });
    expect(node).toMatch(new RegExp(`^https://model\\.example\\.com/hash#node-${UUID}$`));
  });

  it('writes a route another tool wrote with blank nodes anew, under its own names', () => {
    const view = 'https://model.example.com/other/view/v1';
    const link = `${view}#link/l1`;
    load(`
      @prefix arch: <https://meta.linked.archi/core#>.
      @prefix arch-vis: <https://meta.linked.archi/core-vis#>.
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#>.
      <${view}> a arch:View, arch:Diagram.
      <${view}#node/a> a arch-vis:ContainerNode; arch-vis:view <${view}>.
      <${view}#node/b> a arch-vis:ContainerNode; arch-vis:view <${view}>.
      <${link}> a arch-vis:Link; arch-vis:view <${view}>; arch-vis:source <${view}#node/a>; arch-vis:target <${view}#node/b>;
        arch-vis:points ([ a arch-vis:Point; arch-vis:point-x "1"^^xsd:double; arch-vis:point-y "2"^^xsd:double ]).
    `);
    deps.views.updateLinkWaypoints(view, link, [{ x: 5, y: 6 }]);
    expect(objects(link, IRI.points)).toEqual([`${link}/points/0`]);
    expect(store.getQuads(null, null, null).some((q) => q.subject.termType === 'BlankNode')).toBe(false);
  });
});
