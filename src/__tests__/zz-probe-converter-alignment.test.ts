// @vitest-environment jsdom
// Throwaway probe (to be deleted): what la-gram does with linked-archi-converters 1.3.0 output today.
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Parser } from 'n3';
import type { NamedNode, Quad, Term } from '@rdfjs/types';
import { createApp } from '../app.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { modelQuads } from '../model-manager/model-queries.js';
import { applyFolderChange, moveToFolder } from '../model-manager/folders.js';
import { copyFromView, readFragment, writeFragment } from '../model-manager/clipboard.js';
import { OxigraphRdfStore } from '../rdf-engine/rdf-store.js';
import { ObservableRdfStore } from '../rdf-engine/observable-store.js';
import { OxigraphViewManager } from '../model-manager/view-manager.js';
import { nn } from '../model-manager/vocabulary.js';

const DIR = '/tmp/lg-align';
const VIS = NAMESPACES['arch-vis'];
const SCHEMA = 'https://schema.org/';
const RDF = NAMESPACES.rdf;

function k(t: Term): string {
  switch (t.termType) {
    case 'NamedNode': return `<${t.value}>`;
    case 'BlankNode': return `_:${t.value}`;
    case 'Literal': { const l = t as unknown as { language: string; datatype: { value: string } }; return `"${t.value}"${l.language ? '@' + l.language : '^^' + l.datatype.value}`; }
    case 'Quad': { const q = t as unknown as Quad; return `<<( ${k(q.subject)} ${k(q.predicate)} ${k(q.object)} )>>`; }
    default: return '';
  }
}
const tripleKey = (q: Quad) => `${k(q.subject)} ${k(q.predicate)} ${k(q.object)}`;
const graphName = (q: Quad) => (q.graph.termType === 'DefaultGraph' ? '(default)' : q.graph.value.replace(/^.*\/graph\//, 'graph/'));
const short = (s: string) => s.replace(/^https?:\/\/[^ ]*?([#/])([^#/ >]+)>?$/, '$2');
function tally<T>(xs: T[], f: (x: T) => string, top = 12): string {
  const m = new Map<string, number>();
  for (const x of xs) m.set(f(x), (m.get(f(x)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, top).map(([s, n]) => `${n}× ${s}`).join('\n      ');
}

async function openAndSave(file: string, assetMode: 'offline' | 'remote-first' = 'offline') {
  const text = readFileSync(`${DIR}/${file}`, 'utf8');
  const original = new Parser({ format: 'application/trig' }).parse(text) as unknown as Quad[];
  const app = await createApp({ assetMode, validationDelayMs: 1e9 });
  const opened = await app.openModel(text, file);
  const saved = app.saveModel('trig').text;
  const after = new Parser({ format: 'application/trig' }).parse(saved) as unknown as Quad[];
  return { app, opened, original, after };
}

function compareGraphs(label: string, original: Quad[], after: Quad[]) {
  const before = new Map<string, string>();
  for (const q of original) before.set(tripleKey(q), graphName(q));
  const now = new Map<string, string>();
  for (const q of after) now.set(tripleKey(q), graphName(q));
  const byQuad = new Map<string, Quad>();
  for (const q of original) byQuad.set(tripleKey(q), q);
  for (const q of after) byQuad.set(tripleKey(q), q);
  const moved: Array<[string, string, Quad]> = [];
  const dropped: Quad[] = [];
  for (const [key, g] of before) {
    const h = now.get(key);
    if (h === undefined) dropped.push(byQuad.get(key)!);
    else if (h !== g) moved.push([g, h, byQuad.get(key)!]);
  }
  const added = [...now.keys()].filter((key) => !before.has(key)).map((key) => byQuad.get(key)!);
  console.log(`\n=== ${label}: ${original.length} quads in, ${after.length} out`);
  console.log(`  graphs in:  ${tally(original, graphName)}`);
  console.log(`  graphs out: ${tally(after, graphName)}`);
  console.log(`  moved graph (${moved.length}):\n      ${tally(moved, ([g, h, q]) => `${g} → ${h}  ${short(k(q.predicate))}`)}`);
  console.log(`  dropped by la-gram (${dropped.length}):\n      ${tally(dropped, (q) => `${graphName(q)}  ${short(k(q.predicate))}`)}`);
  console.log(`  added by la-gram (${added.length}):\n      ${tally(added, (q) => `${graphName(q)}  ${short(k(q.predicate))}`)}`);
  // The same subject and predicate, another object: how the value was rewritten.
  for (const p of ['schema.org/position', 'core-vis#bounds-x', 'core-vis#point-x']) {
    const d = dropped.find((q) => q.predicate.value.endsWith(p));
    const a = d && added.find((q) => q.subject.value === d.subject.value && q.predicate.value === d.predicate.value);
    if (d) console.log(`  ${p}: ${k(d.object)} → ${a ? k(a.object) : '(none)'}`);
  }
  const rewritten = added.filter((q) => q.predicate.value.endsWith('arch-vis') || q.predicate.value.includes('#inModel') || q.predicate.value.includes('hasQualifiedRelationship'));
  for (const q of rewritten.slice(0, 3)) console.log(`  e.g. added ${tripleKey(q).replace(/https?:\/\/[^ >]*\/(element|relationship|view|folder)\//g, '…/$1/')}`);
  return { moved, dropped, added };
}

describe('probe: converter 1.3.0 output in la-gram', () => {
  it('A ArchiMate (ArchiSurance): open, save as TriG, folders, styles, routes', async () => {
    const { app, opened, original, after } = await openAndSave('archisurance.trig');
    const store = app.components.store;
    const model = modelQuads(store);
    const blanks = model.filter((q) => q.subject.termType === 'BlankNode' || q.object.termType === 'BlankNode').length;
    console.log(`\nA open: missingMetamodels=${JSON.stringify(opened.missingMetamodels)} model=${opened.modelIri} views=${app.components.viewManager.getViews().length} blankNodeQuads=${blanks}`);
    compareGraphs('ArchiSurance TriG → la-gram TriG', original, after);

    // Folder move: does the target folder list the member, and is the old entry gone?
    const isPartOf = NAMESPACES.dcterms + 'isPartOf';
    const folders = [...new Set(store.getQuads(null, nn(SCHEMA + 'itemListElement'), null).map((q) => q.subject.value))];
    const entryOf = (folder: string, member: string) =>
      store.getQuads(nn(folder), nn(SCHEMA + 'itemListElement'), null).map((q) => q.object as NamedNode)
        .filter((e) => store.getQuads(e, nn(SCHEMA + 'item'), nn(member)).length > 0);
    const from = folders.find((f) => store.getQuads(nn(f), nn(SCHEMA + 'itemListElement'), null).length > 2)!;
    const member = store.getQuads(nn(from), nn(SCHEMA + 'itemListElement'), null)
      .map((q) => store.getQuads(q.object as NamedNode, nn(SCHEMA + 'item'), null)[0]!.object.value)
      .find((m) => store.getQuads(nn(m), nn(RDF + 'type'), nn(NAMESPACES.arch + 'Folder')).length === 0)!;
    const to = folders.find((f) => f !== from && store.getQuads(nn(f), nn(RDF + 'type'), nn(NAMESPACES.arch + 'Folder')).length > 0)!;
    applyFolderChange(store, moveToFolder(store, member, to, opened.modelIri!));
    console.log(`\nA folder move ${short('<' + member + '>')}: old entry left=${entryOf(from, member).length} new entry=${entryOf(to, member).length} isPartOf new=${store.getQuads(nn(member), nn(isPartOf), nn(to)).length}`);

    // P1: a converted style changed in the Appearance tab.
    const views = app.components.viewManager;
    const styled = store.getQuads(null, nn(VIS + 'style'), null).find((q) => q.object.value.endsWith('/style') && store.getQuads(q.subject, nn(RDF + 'type'), nn(VIS + 'ArchNode')).length > 0)!;
    const node = styled.subject.value;
    const viewOf = store.getQuads(nn(node), nn(VIS + 'view'), null)[0]!.object.value;
    views.setAppearance!(viewOf, node, { lineColor: '#7a0019' });
    const old = styled.object.value;
    console.log(`A P1 style: now ${store.getQuads(nn(node), nn(VIS + 'style'), null).map((q) => q.object.value.replace(node, '{node}'))}; converter style left: ${store.getQuads(nn(old), null, null).length} quads, referred to by ${store.getQuads(null, null, nn(old)).length}`);

    // P3: a converted routed line copied and pasted.
    const routed = views.getLinks(viewOf).find((l) => l.waypoints.length > 0) ??
      views.getViews().flatMap((v) => views.getLinks(v.iri).map((l) => ({ ...l, view: v.iri }))).find((l) => l.waypoints.length > 0)!;
    const routedView = (routed as { view?: string }).view ?? viewOf;
    const copy = readFragment(writeFragment(copyFromView(store, views, { modelIri: opened.modelIri!, viewIri: routedView, metamodelIris: [], version: 't' }, [routed.sourceNodeIri, routed.targetNodeIri])))!;
    const scratch = new ObservableRdfStore(new OxigraphRdfStore());
    scratch.addQuads(copy.quads);
    const pasted = new OxigraphViewManager(scratch).getLinks(routedView).find((l) => l.linkIri === routed.linkIri);
    console.log(`A P3 copy of a routed line: ${routed.waypoints.length} bends in the view, ${pasted?.waypoints.length ?? 'no link'} in the copy`);
  }, 240_000);

  it('B BPMN: open, save as TriG — where do the route points go? (its metamodel fetched)', async () => {
    const { opened, original, after } = await openAndSave('bpmn.trig', 'remote-first');
    console.log(`\nB open: missingMetamodels=${JSON.stringify(opened.missingMetamodels)} model=${opened.modelIri}`);
    compareGraphs('BPMN TriG → la-gram TriG', original, after);
    const pointsOut = after.filter((q) => q.predicate.value === VIS + 'point-x');
    console.log(`  route point-x in the saved file, by graph: ${tally(pointsOut, graphName)}`);
  }, 240_000);

  it('C Backstage, two models in one file: what la-gram opens and what it saves', async () => {
    const { app, opened, original, after } = await openAndSave('backstage.trig', 'remote-first');
    console.log(`\nC open: missingMetamodels=${JSON.stringify(opened.missingMetamodels)} model=${opened.modelIri} autoPlaced=${(opened as { autoPlaced?: number }).autoPlaced}`);
    compareGraphs('Backstage TriG → la-gram TriG', original, after);
    const inModel = NAMESPACES.arch + 'inModel';
    const memberOf = (qs: Quad[]) => tally(qs.filter((q) => q.predicate.value === inModel), (q) => q.object.value.replace(/^.*\/backstage\//, ''));
    console.log(`  members in: ${memberOf(original)} | out: ${memberOf(after)}`);
    const savedGraphs = tally(after.filter((q) => q.predicate.value === inModel), (q) => `${q.object.value.replace(/^.*\/backstage\//, '')} in ${q.graph.value.replace(/^.*\/backstage\//, '')}`);
    console.log(`  where each model's members were saved: ${savedGraphs}`);
    console.log(`  la-gram's model tree lists: ${app.components.viewManager.getViews().length} views`);
    const graphsOut = new Set(after.map((q) => q.graph.value));
    const bundles = after.filter((q) => q.predicate.value === RDF + 'type' && q.object.value === NAMESPACES.prov + 'Bundle').map((q) => q.subject.value);
    console.log(`  bundles described: ${bundles.length}; of them, graphs that exist in the saved file: ${bundles.filter((b) => graphsOut.has(b)).length}`);
    console.log(`  bundles naming no graph of the file: ${bundles.filter((b) => !graphsOut.has(b)).map((b) => b.replace(/^.*\/graph\//, 'graph/'))}`);
  }, 240_000);

  it('D the same Exchange file through la-gram\'s importer and through the converter', async () => {
    const xml = readFileSync('linked.archi/tools/converters/linked-archi-converters/playground/archimate/payment-platform.xml', 'utf8');
    const app = await createApp({ assetMode: 'offline', validationDelayMs: 1e9 });
    const report = await app.importArchiMate(xml, 'payment-platform.xml');
    const store = app.components.store;
    const mine = modelQuads(store);
    const conv = new Parser({ format: 'application/trig' }).parse(readFileSync(`${DIR}/payment.trig`, 'utf8')) as unknown as Quad[];
    const subjects = (qs: Quad[], type: string) => new Set(qs.filter((q) => q.predicate.value === RDF + 'type' && q.object.value === type).map((q) => q.subject.value));
    const members = (qs: Quad[]) => new Set(qs.filter((q) => q.predicate.value === NAMESPACES.arch + 'inModel').map((q) => q.subject.value));
    // An Exchange id from either tool's IRI: la-gram `{ns}element-{id}`, the converter `{ns}element/{id}`.
    const idOf = (iri: string) => /\/(element|relationship|view)[-/]([^/]+)$/.exec(iri)?.slice(1).join(':') ?? '';
    const lg = new Map([...members(mine)].map((iri) => [idOf(iri), iri]));
    const cv = new Map([...members(conv)].map((iri) => [idOf(iri), iri]));
    const sameId = [...cv.keys()].filter((id) => id && lg.has(id));
    const sameIri = [...cv.values()].filter((iri) => members(mine).has(iri));
    const { modelIri: _m, viewIri: _v, ...counts } = report as unknown as Record<string, unknown>;
    console.log(`\nD report: ${JSON.stringify(counts, (key, value) => (Array.isArray(value) && value.length > 6 ? [...value.slice(0, 6), `… ${value.length} in all`] : value))}`);
    const byKind = (qs: Quad[]) => tally([...members(qs)], (iri) => /\/(element|relationship|view)[-/]/.exec(iri)?.[1] ?? iri.replace(/^.*\//, ''), 5);
    console.log(`  members by kind: la-gram ${byKind(mine)} | converter ${byKind(conv)}`);
    console.log(`\nD import: model la-gram=${report.modelIri} converter=https://example.org/la/model/archisurance`);
    console.log(`  concepts la-gram=${lg.size} converter=${cv.size}; the same Exchange id=${sameId.length}; the same IRI=${sameIri.length}`);
    const sample = sameId.find((id) => id.startsWith('element'))!;
    console.log(`  e.g. ${sample}: la-gram ${lg.get(sample)} | converter ${cv.get(sample)}`);
    const typed = (qs: Quad[], iri: string) => qs.filter((q) => q.subject.value === iri && q.predicate.value === RDF + 'type').map((q) => short('<' + q.object.value + '>')).sort().join(',');
    console.log(`  its types: la-gram ${typed(mine, lg.get(sample)!)} | converter ${typed(conv, cv.get(sample)!)}`);
    console.log(`  arch:Element-typed: la-gram=${subjects(mine, NAMESPACES.arch + 'Element').size} converter=${subjects(conv, NAMESPACES.arch + 'Element').size}`);
    console.log(`  unrecognized (all): ${JSON.stringify((report as unknown as { unrecognizedTypes: string[] }).unrecognizedTypes)}`);
    const said = (qs: Quad[], iri: string) => qs.filter((q) => q.subject.value === iri).map((q) => short('<' + q.predicate.value + '>')).sort().join(' ');
    console.log(`  what la-gram says of ${sample}: ${said(mine, lg.get(sample)!)}\n  what the converter says: ${said(conv, cv.get(sample)!)}`);
    // The same file with the suffix taken off the relationship types, as the converter reads them.
    const app2 = await createApp({ assetMode: 'offline', validationDelayMs: 1e9 });
    const unsuffixed = xml.replace(/xsi:type="([A-Za-z]+)Relationship"/g, 'xsi:type="$1"');
    const report2 = await app2.importArchiMate(unsuffixed, 'payment-platform.xml');
    const mine2 = modelQuads(app2.components.store);
    const rel = [...members(mine2)].find((iri) => /relationship-/.test(iri))!;
    console.log(`  unsuffixed: relationships=${(report2 as unknown as { relationshipCount: number }).relationshipCount}; e.g. ${rel}: ${typed(mine2, rel)}`);
    console.log(`  folders la-gram=${subjects(mine, NAMESPACES.arch + 'Folder').size} converter=${subjects(conv, NAMESPACES.arch + 'Folder').size}`);
    const styleObjs = (qs: Quad[]) => qs.filter((q) => q.predicate.value === VIS + 'style').map((q) => q.object.value.replace(/^.*?((-|\/)style.*)$/, '{placement}$1'));
    console.log(`  styles la-gram: ${tally(styleObjs(mine), (s) => s, 3)} | converter: ${tally(styleObjs(conv), (s) => s, 3)}`);
    const props = (qs: Quad[]) => qs.filter((q) => q.subject.termType === 'NamedNode' && /\/element[-/]/.test(q.subject.value) && (q.predicate.value.includes('/property/') || q.predicate.value.includes('property-') || q.predicate.value === SCHEMA + 'additionalProperty')).map((q) => (q.predicate.value === SCHEMA + 'additionalProperty' ? 'schema:additionalProperty pair' : `a predicate of its own, e.g. ${q.predicate.value}`));
    console.log(`  properties la-gram: ${tally(props(mine), (s) => s, 2)} | converter: ${tally(props(conv), (s) => s, 2)}`);
    const viewpoints = (qs: Quad[]) => new Set(qs.filter((q) => q.predicate.value === NAMESPACES.arch + 'viewConformsToViewpoint').map((q) => q.object.value));
    const vl = viewpoints(mine), vc = viewpoints(conv);
    console.log(`  viewpoints la-gram=${[...vl].map((v) => short('<' + v + '>')).sort().join(',')} | converter=${[...vc].map((v) => short('<' + v + '>')).sort().join(',')}`);
  }, 240_000);
});
