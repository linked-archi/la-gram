/**
 * The diff by element: `fixtures/diff/changes.trig` changes the merge fixtures'
 * base model in each way it tells apart — a rename, an element added and
 * placed, one deleted, a relationship retargeted, nodes moved and resized, a
 * value added to a property that takes several, a folder entry.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Parser } from 'n3';
import type { Quad } from '@rdfjs/types';
import { snapshotOf } from '../version-history.js';
import { diffByElement, type ConceptChange, type ModelDiff } from '../model-diff.js';
import { markdownOfDiff } from '../model-diff-text.js';
import { SingleValued } from '../../rdf-engine/single-valued.js';

const M = 'https://example.org/m/';
const SKOS = 'http://www.w3.org/2004/02/skos/core#';
const ARCH = 'https://meta.linked.archi/core#';
const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';

const trig = (path: string) =>
  new Parser({ format: 'TriG' }).parse(readFileSync(new URL(`../../__tests__/fixtures/${path}`, import.meta.url), 'utf8')) as unknown as Quad[];
const MODEL = snapshotOf(trig('merge/model.trig').filter((q) => q.graph.termType === 'DefaultGraph'));

/** The fixture's new version: base, less what it removes, with what it adds. */
function changed(): string[] {
  const quads = trig('diff/changes.trig');
  const graph = (g: string) => snapshotOf(quads.filter((q) => q.graph.value === `urn:${g}`));
  const lines = new Set(MODEL);
  for (const line of graph('removed')) if (!lines.delete(line)) throw new Error(`removes what base does not have: ${line}`);
  for (const line of graph('added')) lines.add(line);
  return [...lines].sort();
}

const of = (diff: ModelDiff, local: string): ConceptChange => {
  const found = diff.changes.find((c) => c.subject === M + local);
  if (!found) throw new Error(`no change for ${local}`);
  return found;
};

describe('the diff by element', () => {
  const diff = diffByElement(MODEL, changed());

  it('lists the concepts changed, by kind and then name — not the triples', () => {
    expect(diff.changes.map((c) => [c.kind, c.status, diff.about[c.subject]?.name])).toEqual([
      ['element', 'removed', 'CRM'],
      ['element', 'added', 'ERP'],
      ['element', 'changed', 'Invoicing'],
      ['element', 'changed', 'Portal'],
      ['relationship', 'changed', undefined],
      ['view', 'changed', 'Overview'],
      ['folder', 'changed', 'Applications'],
    ]);
    expect(diff.counts).toEqual({ added: 1, removed: 1, changed: 5 });
  });

  it('a name changed in one language: old → new, the other language untouched', () => {
    const billing = of(diff, 'billing');
    expect(billing.values).toEqual([{ predicate: SKOS + 'prefLabel', language: 'en', from: ['"Billing"@en'], to: ['"Invoicing"@en'] }]);
    expect(billing.added).toEqual([]);
    expect(billing.removed).toEqual([]);
  });

  it('a relationship retargeted: its target old → new; its triple and rdf:reifies under it, not under its source', () => {
    const serving = of(diff, 'serving');
    expect(serving.values).toEqual([{ predicate: ARCH + 'target', from: [`<${M}portal>`], to: [`<${M}erp>`] }]);
    expect(serving.added).toEqual([]);
    expect(serving.removed).toEqual([]);
    expect(serving.ends).toEqual({ source: M + 'billing', target: M + 'erp' });
    expect(serving.lines.removed).toContain(`<${M}billing> <${AM4}serves> <${M}portal> .`);
    expect(serving.lines.added).toContain(`<${M}billing> <${AM4}serves> <${M}erp> .`);
  });

  it('an element added: its values, without its type and membership, which go without saying', () => {
    const erp = of(diff, 'erp');
    expect(erp.values).toEqual([{ predicate: SKOS + 'prefLabel', language: 'en', from: [], to: ['"ERP"@en'] }]);
    expect(erp.added).toEqual([]);
    expect(diff.about[M + 'erp']).toEqual({ name: 'ERP', types: [AM4 + 'ApplicationComponent'] });
  });

  it('an element removed: named from the version that had it', () => {
    expect(of(diff, 'crm').status).toBe('removed');
    expect(diff.about[M + 'crm']?.name).toBe('CRM');
  });

  it('a property that takes several values: the value added', () => {
    expect(of(diff, 'portal').added).toEqual([{ predicate: SKOS + 'definition', object: '"Where customers sign in"@en' }]);
    expect(of(diff, 'folder').added).toEqual([{ predicate: 'https://schema.org/itemListElement', object: `<${M}erp>` }]);
  });

  it('the view: its shapes placed, moved, resized, reconnected and rerouted — their points and cells under the link', () => {
    const view = of(diff, 'view');
    expect(view.shapes).toEqual([
      { shape: M + 'node-erp', kind: 'node', shows: M + 'erp', status: 'added' },
      {
        shape: M + 'link-serving', kind: 'link', shows: M + 'serving', status: 'changed', reconnected: true, rerouted: true,
      },
      {
        shape: M + 'node-billing', kind: 'node', shows: M + 'billing', status: 'changed', moved: true,
        bounds: { from: { x: 0, y: 0, w: 120, h: 55 }, to: { x: 40, y: 0, w: 120, h: 55 } },
      },
      {
        shape: M + 'node-portal', kind: 'node', shows: M + 'portal', status: 'changed', resized: true,
        bounds: { from: { x: 300, y: 0, w: 120, h: 55 }, to: { x: 300, y: 0, w: 160, h: 55 } },
      },
    ]);
    // ERP's arch:inView is accounted for by its node; nothing else is shown that was not.
    expect(view.shows).toEqual({ added: [], removed: [] });
    expect(view.lines.added).toContain(`<${M}erp> <${ARCH}inView> <${M}view> .`);
    expect(view.lines.removed).toContain(`<${M}link-serving-p1> <${RDF}type> <https://meta.linked.archi/core-vis#Point> .`);
  });

  it('every line is under exactly one concept', () => {
    const under = { added: diff.changes.flatMap((c) => c.lines.added), removed: diff.changes.flatMap((c) => c.lines.removed) };
    expect(under.added.sort()).toEqual([...diff.lines.added].sort());
    expect(under.removed.sort()).toEqual([...diff.lines.removed].sort());
  });

  it('the same version twice: no changes', () => {
    expect(diffByElement(MODEL, MODEL)).toEqual({ changes: [], counts: { added: 0, removed: 0, changed: 0 }, about: {}, lines: { added: [], removed: [] } });
  });

  it('from nothing (a file’s first commit): every concept added', () => {
    const first = diffByElement([], MODEL);
    expect(first.counts).toEqual({ added: 7, removed: 0, changed: 0 });
    expect(first.changes.find((c) => c.kind === 'view')?.shapes.map((s) => [s.status, s.shows])).toEqual([
      ['added', M + 'serving'],
      ['added', M + 'billing'],
      ['added', M + 'portal'],
    ]);
  });

  it('a retype: the type old → new', () => {
    const before = [`<${M}x> <${RDF}type> <${AM4}ApplicationComponent> .`, `<${M}x> <${SKOS}prefLabel> "X"@en .`];
    const after = [`<${M}x> <${RDF}type> <${AM4}ApplicationService> .`, `<${M}x> <${SKOS}prefLabel> "X"@en .`];
    expect(diffByElement(before, after).changes[0]?.values).toEqual([
      { predicate: RDF + 'type', from: [`<${AM4}ApplicationComponent>`], to: [`<${AM4}ApplicationService>`] },
    ]);
  });

  it('a metamodel’s single-valued property: old → new; without the rule, a value removed and one added', () => {
    const P = 'https://example.org/vocab#cost';
    const before = [`<${M}x> <${RDF}type> <${AM4}ApplicationComponent> .`, `<${M}x> <${P}> "1" .`];
    const after = [`<${M}x> <${RDF}type> <${AM4}ApplicationComponent> .`, `<${M}x> <${P}> "2" .`];
    const functional = SingleValued.from({
      getQuads: (s, p, o) =>
        p?.value === RDF + 'type' && o?.value === 'http://www.w3.org/2002/07/owl#FunctionalProperty' && !s
          ? ([{ subject: { termType: 'NamedNode', value: P } }] as never)
          : [],
    });
    expect(diffByElement(before, after, { singleValued: functional }).changes[0]?.values).toEqual([{ predicate: P, from: ['"1"'], to: ['"2"'] }]);
    const plain = diffByElement(before, after).changes[0]!;
    expect([plain.values, plain.added, plain.removed]).toEqual([[], [{ predicate: P, object: '"2"' }], [{ predicate: P, object: '"1"' }]]);
  });
});

describe('the diff by element, in words', () => {
  const diff = diffByElement(MODEL, changed());
  const words = {
    typeName: (iri: string) => ({ [AM4 + 'ApplicationComponent']: 'Application Component', [AM4 + 'Serving']: 'Serving' })[iri] ?? iri.slice(iri.lastIndexOf('#') + 1),
    propertyName: (iri: string) =>
      ({ [SKOS + 'prefLabel']: 'Name', [ARCH + 'target']: 'Target', [SKOS + 'definition']: 'Definition', 'https://schema.org/itemListElement': 'Contains' })[iri] ?? iri,
  };

  it('a line per concept, what changed under it: names for concepts, quotes for text, a view’s shapes as verbs', () => {
    expect(markdownOfDiff(diff, words).split('\n')).toEqual([
      '**Changes by element:** 1 added · 1 removed · 5 changed',
      '',
      '- ➖ **CRM** _Application Component_ — removed',
      '- ➕ **ERP** _Application Component_ — added',
      '  - Name (en): “ERP”',
      '- ✏️ **Invoicing** _Application Component_',
      '  - Name (en): “Billing” → “Invoicing”',
      '- ✏️ **Portal** _Application Component_',
      '  - + Definition: “Where customers sign in” (en)',
      '- ✏️ **Serving** Invoicing → ERP',
      '  - Target: Portal → ERP',
      '- ✏️ **Overview** _Diagram_',
      '  - placed ERP',
      '  - rerouted and reconnected Serving',
      '  - moved Invoicing',
      '  - resized Portal',
      '- ✏️ **Applications** _Folder_',
      '  - + Contains: ERP',
    ]);
  });

  it('at most so many concepts, the rest counted; none at all said so', () => {
    expect(markdownOfDiff(diff, words, 2).split('\n').slice(-2)).toEqual(['', '_… and 5 more._']);
    expect(markdownOfDiff(diffByElement(MODEL, MODEL), words)).toBe('_No changes to the model._');
  });
});

describe('the diff by element, and the provenance of edits (Req 9.16)', () => {
  const PROV = 'http://www.w3.org/ns/prov#';
  const DCT = 'http://purl.org/dc/terms/';
  const XSD_DT = '<http://www.w3.org/2001/XMLSchema#dateTime>';
  const at = (t: string) => `"${t}"^^${XSD_DT}`;
  const line = (s: string, p: string, o: string) => `<${s}> <${p}> ${o} .`;
  const SCHEMA = 'https://schema.org/';
  const LA_GRAM = 'https://app.linked.archi/la-gram/v0.3.0';
  /** A version in which `concepts` were last changed by `activity` at `time` — by `user`, if any — with the activity itself. */
  const stamped = (lines: readonly string[], activity: string, time: string, concepts: string[], user?: { iri: string; name: string; account?: string }) => [
    ...lines,
    ...concepts.flatMap((c) => [
      line(c, DCT + 'modified', at(time)),
      line(c, PROV + 'wasGeneratedBy', `<${activity}>`),
      line(c, PROV + 'generatedAtTime', at(time)),
    ]),
    line(activity, RDF + 'type', `<${PROV}Activity>`),
    line(activity, PROV + 'endedAtTime', at(time)),
    line(activity, PROV + 'wasAssociatedWith', `<${LA_GRAM}>`),
    line(LA_GRAM, RDF + 'type', `<${PROV}SoftwareAgent>`),
    line(LA_GRAM, SCHEMA + 'name', '"la-gram"'),
    line(LA_GRAM, SCHEMA + 'softwareVersion', '"0.3.0"'),
    ...(user
      ? [
          line(activity, PROV + 'wasAssociatedWith', `<${user.iri}>`),
          line(user.iri, RDF + 'type', `<${PROV}Person>`),
          line(user.iri, SCHEMA + 'name', `"${user.name}"`),
          ...(user.account ? [line(user.iri, SCHEMA + 'sameAs', `<${user.account}>`)] : []),
        ]
      : []),
  ].sort();
  const ada = { iri: `${M}provenance/user-ada`, name: 'Ada Lovelace', account: 'https://gitlab.com/ada' };

  it('a change says what changed — the name — not when or by whom; the triples still have it all', () => {
    const before = stamped(MODEL, `${M}provenance/edit-a1`, '2026-11-20T10:00:00Z', [M + 'portal']);
    const renamed = MODEL.map((l) => l.replace('"Portal"@en', '"Portal (new)"@en'));
    const after = stamped(renamed, `${M}provenance/edit-a2`, '2026-11-20T11:00:00Z', [M + 'portal']);
    const diff = diffByElement(before, after);
    expect(diff.changes.map((c) => c.subject)).toEqual([M + 'portal']);
    expect(of(diff, 'portal').values.map((v) => v.predicate)).toEqual([SKOS + 'prefLabel']);
    expect(of(diff, 'portal').added.concat(of(diff, 'portal').removed).map((v) => v.predicate)).toEqual([]);
    expect(diff.lines.added.some((l) => l.includes(PROV))).toBe(true);
  });

  it('stamps alone are no change', () => {
    const before = stamped(MODEL, `${M}provenance/edit-a1`, '2026-11-20T10:00:00Z', [M + 'portal']);
    const after = stamped(MODEL, `${M}provenance/edit-a2`, '2026-11-20T11:00:00Z', [M + 'portal']);
    expect(diffByElement(before, after).changes).toEqual([]);
  });

  it('a change says who made it, when and with what, as the later version records it; the Markdown too', () => {
    const before = stamped(MODEL, `${M}provenance/edit-a1`, '2026-11-20T10:00:00Z', [M + 'portal']);
    const renamed = MODEL.map((l) => l.replace('"Portal"@en', '"Portal (new)"@en'));
    const after = stamped(renamed, `${M}provenance/edit-a2`, '2026-11-20T16:40:31Z', [M + 'portal'], ada);
    const diff = diffByElement(before, after);
    expect(of(diff, 'portal').edit).toEqual({ at: '2026-11-20T16:40:31Z', by: 'Ada Lovelace', account: 'https://gitlab.com/ada', tool: 'la-gram 0.3.0' });
    const words = { typeName: (i: string) => i.slice(i.lastIndexOf('#') + 1), propertyName: (i: string) => i.slice(i.lastIndexOf('#') + 1) };
    expect(markdownOfDiff(diff, words)).toContain('— changed by Ada Lovelace, 2026-11-20 16:40 UTC');
  });

  it('a change the later version records no edit of names nobody: it was made where edits are not recorded', () => {
    const before = stamped(MODEL, `${M}provenance/edit-a1`, '2026-11-20T10:00:00Z', [M + 'portal'], ada);
    // Renamed in a text editor: the record of the last edit is the old one.
    const after = before.map((l) => l.replace('"Portal"@en', '"Portal (new)"@en'));
    expect(of(diffByElement(before, after), 'portal').edit).toBeUndefined();
  });
});
