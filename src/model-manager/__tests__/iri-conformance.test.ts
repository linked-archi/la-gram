/**
 * A model's IRIs against the Linked.Archi layout (DD-41, the guide's *Conformance check*): a model named in it has
 * nothing to report; la-gram's names from before it and the converters' are legacy; what is in neither is reported
 * by what is wrong with it; and the namespace itself is checked (`.agents/tasks/iri-layout/requirements.md`, R18).
 */
import { describe, it, expect } from 'vitest';
import { DataFactory, Parser } from 'n3';
import type { Quad } from '@rdfjs/types';
import { layoutReport, type LayoutReport } from '../iri-conformance.js';
import { layoutNotes } from '../../cli/check.js';

const NS = 'https://example.org/archimate/2d441909-2be6-4dfe-aaa5-c7ee59edbc4c/';
const VANN = 'http://purl.org/vocab/vann/';

interface Names {
  ns: string;
  element: (id: string) => string;
  relationship: string;
  view: string;
  node: (id: string) => string;
  link: string;
  part: (owner: string, part: string) => string;
  cell: (i: number) => string;
  point: (i: number) => string;
}

/** Two elements related, drawn in a view: a styled node, a line with a moved name and two bends. */
function model(n: Names, declared = true): Quad[] {
  return new Parser({ format: 'text/turtle' }).parse(`
    @prefix arch: <https://meta.linked.archi/core#>.
    @prefix arch-vis: <https://meta.linked.archi/core-vis#>.
    @prefix am4: <https://meta.linked.archi/archimate4/onto#>.
    @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>.
    @prefix skos: <http://www.w3.org/2004/02/skos/core#>.
    @prefix vann: <${VANN}>.
    <${n.ns}model> a arch:Model ${declared ? `; vann:preferredNamespacePrefix "m"; vann:preferredNamespaceUri "${n.ns}"` : ''}.
    <${n.element('a')}> a am4:ApplicationComponent; skos:prefLabel "A"@en; arch:inModel <${n.ns}model>; am4:serves <${n.element('b')}>.
    <${n.element('b')}> a am4:ApplicationComponent; skos:prefLabel "B"@en; arch:inModel <${n.ns}model>.
    <${n.relationship}> a am4:Serving; arch:source <${n.element('a')}>; arch:target <${n.element('b')}>;
      rdf:reifies <<( <${n.element('a')}> am4:serves <${n.element('b')}> )>>.
    <${n.view}> a arch:View, arch:Diagram; arch:inModel <${n.ns}model>.
    <${n.node('a')}> a arch-vis:ArchNode; arch-vis:view <${n.view}>; arch-vis:archElement <${n.element('a')}>;
      arch-vis:style <${n.part(n.node('a'), 'style')}>.
    <${n.part(n.node('a'), 'style')}> a arch-vis:Style; arch-vis:fillColor "#ffffff".
    <${n.node('b')}> a arch-vis:ArchNode; arch-vis:view <${n.view}>; arch-vis:archElement <${n.element('b')}>.
    <${n.link}> a arch-vis:Link; arch-vis:view <${n.view}>; arch-vis:archRelationship <${n.relationship}>;
      arch-vis:source <${n.node('a')}>; arch-vis:target <${n.node('b')}>; arch-vis:points <${n.cell(0)}>;
      arch-vis:label <${n.part(n.link, 'label')}>.
    <${n.cell(0)}> rdf:first <${n.point(0)}>; rdf:rest <${n.cell(1)}>.
    <${n.cell(1)}> rdf:first <${n.point(1)}>; rdf:rest rdf:nil.
    <${n.point(0)}> a arch-vis:Point.
    <${n.point(1)}> a arch-vis:Point.
    <${n.part(n.link, 'label')}> a arch-vis:LabelNode; arch-vis:view <${n.view}>.
  `) as unknown as Quad[];
}

const dd41 = ((): Names => {
  const view = `${NS}view/v1`;
  const link = `${view}#link/l1`;
  return {
    ns: NS, view, link, relationship: `${NS}relationship/r1`,
    element: (id) => `${NS}element/${id}`, node: (id) => `${view}#node/${id}`,
    part: (owner, part) => `${owner}/${part}`, cell: (i) => `${link}/points/${i}`, point: (i) => `${link}/point/${i}`,
  };
})();
const laGramBefore = ((): Names => {
  const link = `${NS}link-l1`;
  return {
    ns: NS, view: `${NS}view-v1`, link, relationship: `${NS}relationship-r1`,
    element: (id) => `${NS}element-${id}`, node: (id) => `${NS}node-${id}`,
    part: (owner, part) => `${owner}-${part}`, cell: (i) => `${link}-points-${i}`, point: (i) => `${link}-p${i}`,
  };
})();
const convertedBefore = ((): Names => {
  const view = `${NS}view/v1`;
  const link = `${view}/connection/c1`;
  return {
    ns: NS, view, link, relationship: `${NS}relationship/r1`,
    element: (id) => `${NS}element/${id}`, node: (id) => `${view}/node/${id}`,
    part: (owner, part) => `${owner}/${part}`, cell: (i) => `${link}/points/${i}`, point: (i) => `${link}/point/${i}`,
  };
})();

const local = (iris: readonly string[], ns = NS) => iris.map((iri) => (iri.startsWith(ns) ? iri.slice(ns.length) : iri));
const none = { characters: [], hashes: [], shape: [], part: [], outside: [], legacy: [] };
const nn = (iri: string) => DataFactory.namedNode(iri);
const quad = (s: string, p: string, o: string) => DataFactory.quad(nn(s), nn(p), nn(o)) as unknown as Quad;
const TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const VIS = 'https://meta.linked.archi/core-vis#';

describe('a model’s IRIs against the layout (DD-41)', () => {
  it('named in it, as la-gram names a model now: nothing to report', () => {
    expect(layoutReport(model(dd41))).toEqual({ model: `${NS}model`, namespace: NS, declared: true, iris: none });
    expect(layoutNotes(layoutReport(model(dd41)))).toEqual([]);
  });

  it('as la-gram named one before it: every name legacy, none outside', () => {
    const { iris } = layoutReport(model(laGramBefore))!;
    expect(local(iris.legacy)).toEqual([
      'element-a', 'element-b',
      'link-l1', 'link-l1-label', 'link-l1-p0', 'link-l1-p1', 'link-l1-points-0', 'link-l1-points-1',
      'node-a', 'node-a-style', 'node-b',
      'relationship-r1', 'view-v1',
    ]);
    expect({ ...iris, legacy: [] }).toEqual(none);
  });

  it('as meta’s derivation rules named one before it: the derivation, its activity and the association are legacy', () => {
    const sha1 = '11fbc7f19f5dde599bb4af7c59942ea8eeb82883';
    const PROV = 'http://www.w3.org/ns/prov#';
    const quads = [
      ...model(dd41),
      quad(`${NS}derivation-${sha1}`, `${PROV}wasGeneratedBy`, `${NS}derivation-activity-${sha1}`),
      quad(`${NS}derivation-activity-${sha1}`, `${PROV}qualifiedAssociation`, `${NS}derivation-activity-${sha1}-association`),
    ];
    const { iris } = layoutReport(quads)!;
    expect(local(iris.legacy)).toEqual([`derivation-${sha1}`, `derivation-activity-${sha1}`, `derivation-activity-${sha1}-association`]);
    expect({ ...iris, legacy: [] }).toEqual(none);
  });

  it('as a converter named one before it: the shapes nested under their view are legacy, their parts under them are not', () => {
    const { iris } = layoutReport(model(convertedBefore))!;
    expect(local(iris.legacy)).toEqual(['view/v1/connection/c1', 'view/v1/node/a', 'view/v1/node/b']);
    expect({ ...iris, legacy: [] }).toEqual(none);
  });

  it('names in neither, by what is wrong with them', () => {
    const view = `${NS}view/v1`;
    const quads = [
      ...model(dd41),
      // An element named by hand; a shape named in another view; one not node/… or link/…; a line named as a node.
      quad(`${NS}card-payment`, TYPE, 'https://meta.linked.archi/archimate4/onto#Service'),
      quad(`${NS}view/v2#node/n1`, `${VIS}view`, view),
      quad(`${view}#box/n2`, `${VIS}view`, view),
      quad(`${view}#node/l2`, TYPE, `${VIS}Link`),
      quad(`${view}#node/l2`, `${VIS}view`, view),
      // A style not under its node; one named as la-gram named a style before.
      quad(`${view}#node/n3`, `${VIS}view`, view),
      quad(`${view}#node/n3`, `${VIS}style`, `${NS}element/style-1`),
      quad(`${view}#node/n4`, `${VIS}view`, view),
      quad(`${view}#node/n4`, `${VIS}style`, `${view}#node/n4-style`),
      // Two #; a space.
      quad(`${NS}element/a`, 'https://example.org/vocab#sameAs', `${view}#node/a#again`),
      quad(`${NS}element/a b`, TYPE, 'https://meta.linked.archi/archimate4/onto#Service'),
    ];
    const { iris } = layoutReport(quads)!;
    expect(local(iris.outside)).toEqual(['card-payment']);
    expect(local(iris.shape)).toEqual(['view/v1#box/n2', 'view/v1#node/l2', 'view/v2#node/n1']);
    expect(local(iris.part)).toEqual(['element/style-1']);
    expect(local(iris.legacy)).toEqual(['view/v1#node/n4-style']);
    expect(local(iris.hashes)).toEqual(['view/v1#node/a#again']);
    expect(local(iris.characters)).toEqual(['element/a b']);
  });

  it('a view that is not view/…, a compound identity, a documentation section by its file, a derivation and its parts: in it', () => {
    const quads = [
      ...model(dd41),
      quad(`${NS}element/Process_1#link/Flow_1`, `${VIS}view`, `${NS}element/Process_1`),
      quad(`${NS}element/Process_1#link/Flow_1`, TYPE, `${VIS}Link`),
      quad(`${NS}element/component/default/payments`, TYPE, 'https://example.org/backstage#Component'),
      quad(`${NS}documentation/5/README.md`, TYPE, 'https://example.org/c4#Section'),
      quad(`${NS}graph/views`, TYPE, 'https://example.org/vocab#Graph'),
      // A derivation of meta's ArchiMate rules, its activity and the association under it.
      quad(`${NS}relationship/11fbc7f19f5dde599bb4`, 'http://www.w3.org/ns/prov#wasGeneratedBy', `${NS}relationship/11fbc7f19f5dde599bb4/activity`),
      quad(`${NS}relationship/11fbc7f19f5dde599bb4/activity`, 'http://www.w3.org/ns/prov#qualifiedAssociation', `${NS}relationship/11fbc7f19f5dde599bb4/activity/association`),
    ];
    expect(layoutReport(quads)!.iris).toEqual(none);
  });

  it('the namespace: not stated, read from the model’s IRI; one that breaks the rule, said how', () => {
    const report = (quads: Quad[]) => layoutReport(quads)!;
    const undeclared = report(model(dd41, false));
    expect([undeclared.declared, undeclared.namespace, undeclared.namespaceProblem]).toEqual([false, NS, undefined]);

    const hashed = report([
      quad('https://acme.com/ea#model', TYPE, 'https://meta.linked.archi/core#Model'),
      DataFactory.quad(nn('https://acme.com/ea#model'), nn(`${VANN}preferredNamespaceUri`), DataFactory.literal('https://acme.com/ea#')) as unknown as Quad,
      quad(`https://acme.com/ea#node-0d8f2c64-7b1e-4a93-b5d0-3e9c1a7f6b28`, `${VIS}view`, 'https://acme.com/ea#view-1'),
    ]);
    expect(hashed.namespaceProblem).toBe('holds a # or a ?');
    expect(local(hashed.iris.legacy, 'https://acme.com/ea#')).toEqual(['node-0d8f2c64-7b1e-4a93-b5d0-3e9c1a7f6b28', 'view-1']);

    const urn = report([quad('urn:la-gram:archimate/1234', TYPE, 'https://meta.linked.archi/core#Model')]);
    expect([urn.namespace, urn.namespaceProblem, urn.iris.outside]).toEqual(['urn:la-gram:archimate/1234/', 'is not an https: or http: IRI', ['urn:la-gram:archimate/1234']]);

    const slashless = report([
      quad(`${NS}model`, TYPE, 'https://meta.linked.archi/core#Model'),
      DataFactory.quad(nn(`${NS}model`), nn(`${VANN}preferredNamespaceUri`), DataFactory.literal(NS.slice(0, -1))) as unknown as Quad,
    ]);
    expect([slashless.namespace, slashless.namespaceProblem]).toEqual([NS, 'does not end in /']);
    expect(layoutReport([quad(`${NS}a`, TYPE, `${NS}b`)])).toBeUndefined();
  });

  it('`la-gram-git check` says it in notes: the namespace, then each kind counted, a few named, relative to the namespace', () => {
    const report: LayoutReport = {
      model: `${NS}model`, namespace: NS, declared: false, namespaceProblem: 'holds a # or a ?',
      iris: { ...none, outside: ['a', 'b', 'c', 'd', 'e'].map((x) => `${NS}${x}`), legacy: [`${NS}element-1`] },
    };
    expect(layoutNotes(report)).toEqual([
      'IRI layout (DD-41), advisory:',
      `  the model does not state its namespace (vann:preferredNamespaceUri), read as ${NS}`,
      `  its namespace ${NS} holds a # or a ?`,
      '  5 outside it, not model, graph/… or {kind}/{id}: a, b, c, … and 2 more',
      '  1 named before it (legacy): element-1',
    ]);
  });
});
