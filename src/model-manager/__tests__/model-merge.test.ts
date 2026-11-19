/**
 * The three-way merge on a fixture per kind of conflict
 * (`src/__tests__/fixtures/merge/`): each starts from `model.trig` and lists
 * what each side added and removed.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DataFactory, Parser } from 'n3';
import type { Quad } from '@rdfjs/types';
import { snapshotOf } from '../version-history.js';
import {
  NamespaceConflict,
  applyChoice,
  mergeSnapshots,
  quadsOfSnapshot,
  shaclCountCheck,
  snapshotModel,
  snapshotOfText,
  type MergeConflict,
  type MergeResult,
} from '../model-merge.js';
import { RdfShaclValidator } from '../../rdf-engine/shacl-validator.js';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { modelQuads } from '../model-queries.js';
import { namespaceQuads, planNamespaceChange } from '../model-namespace.js';

const M = 'https://example.org/m/';
const SKOS = 'http://www.w3.org/2004/02/skos/core#';
const ARCH = 'https://meta.linked.archi/core#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const EX = 'https://example.org/vocab#';

const read = (name: string) => readFileSync(new URL(`../../__tests__/fixtures/merge/${name}`, import.meta.url), 'utf8');
const trig = (name: string) => new Parser({ format: 'TriG' }).parse(read(name)) as unknown as Quad[];
const MODEL = snapshotOf(trig('model.trig').filter((q) => q.graph.termType === 'DefaultGraph'));

interface Fixture {
  base: string[];
  ours: string[];
  theirs: string[];
  shapes: Quad[];
}

/** A fixture's three versions; a removal not in base, or an addition already there, is a mistake in it. */
function fixture(name: string): Fixture {
  const quads = trig(name);
  const graph = (g: string) => snapshotOf(quads.filter((q) => q.graph.value === `urn:${g}`));
  const base = [...new Set([...MODEL, ...graph('base-added')])].sort();
  const side = (which: string) => {
    const lines = new Set(base);
    for (const line of graph(`${which}-removed`)) {
      if (!lines.delete(line)) throw new Error(`${name}: ${which} removes what base does not have: ${line}`);
    }
    for (const line of graph(`${which}-added`)) {
      if (lines.has(line)) throw new Error(`${name}: ${which} adds what base has: ${line}`);
      lines.add(line);
    }
    return [...lines].sort();
  };
  return { base, ours: side('ours'), theirs: side('theirs'), shapes: quads.filter((q) => q.graph.value === 'urn:shapes') };
}

function merge(f: Fixture, options: Parameters<typeof mergeSnapshots>[3] = {}): MergeResult {
  return mergeSnapshots(f.base, f.ours, f.theirs, options);
}

/** Lines with `m:` IRIs shortened, for readable expectations. */
const short = (lines: readonly string[]) => lines.map((l) => l.split(M).join('m:'));
const has = (lines: readonly string[], text: string) => lines.some((l) => l.includes(text));

/** What base-less changes each side made, applied to base: the merge when nothing conflicts. */
function bothApplied(f: Fixture): string[] {
  const b = new Set(f.base);
  const out = new Set(f.base);
  for (const side of [f.ours, f.theirs]) {
    const s = new Set(side);
    for (const l of f.base) if (!s.has(l)) out.delete(l);
    for (const l of side) if (!b.has(l)) out.add(l);
  }
  return [...out].sort();
}

describe('changes that do not touch each other', () => {
  it('combine without a conflict: additions, removals, the same change on both sides once', () => {
    const f = fixture('clean.trig');
    const result = merge(f);
    expect(result.conflicts).toEqual([]);
    expect(result.merged).toEqual(bothApplied(f));
    expect(result.merged.filter((l) => l.includes('altLabel'))).toHaveLength(1);
  });

  it('the same model on both sides, or a side left as base, gives the other side', () => {
    const f = fixture('clean.trig');
    expect(mergeSnapshots(f.base, f.ours, f.ours)).toEqual({ merged: f.ours, conflicts: [] });
    expect(mergeSnapshots(f.base, f.base, f.theirs)).toEqual({ merged: f.theirs, conflicts: [] });
    expect(mergeSnapshots(f.base, f.ours, f.base)).toEqual({ merged: f.ours, conflicts: [] });
  });
});

describe('a single value changed differently on each side', () => {
  it('is a conflict per language; the merged model keeps base’s value', () => {
    const f = fixture('value.trig');
    const { merged, conflicts } = merge(f);
    const names = conflicts.filter((c) => c.predicate === `${SKOS}prefLabel`);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatchObject({ kind: 'value', subjects: [`${M}billing`], language: 'en' });
    expect(short(names[0].held)).toEqual(['<m:billing> <http://www.w3.org/2004/02/skos/core#prefLabel> "Billing"@en .']);
    expect(short(names[0].options.ours)).toEqual(['<m:billing> <http://www.w3.org/2004/02/skos/core#prefLabel> "Invoicing"@en .']);
    expect(short(names[0].options.theirs)).toEqual(['<m:billing> <http://www.w3.org/2004/02/skos/core#prefLabel> "Accounts"@en .']);
    // Other languages, and the other side's names, merged.
    for (const name of ['"Billing"@en', '"Comptabilité"@fr', '"Abrechnung"@de', '"Web portal"@en', '"Portail"@fr']) expect(has(merged, name)).toBe(true);
    for (const name of ['"Invoicing"@en', '"Accounts"@en', '"Facturation"@fr', '"Portal"@en']) expect(has(merged, name)).toBe(false);
  });

  it('a concept retyped differently on each side is a conflict over its types', () => {
    const { merged, conflicts } = merge(fixture('value.trig'));
    const types = conflicts.find((c) => c.predicate === `${RDF}type`);
    expect(types).toMatchObject({ kind: 'value', subjects: [`${M}crm`] });
    expect(has(merged, '<https://example.org/m/crm> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://meta.linked.archi/archimate4/onto#ApplicationComponent>')).toBe(true);
    expect(merged.filter((l) => l.startsWith(`<${M}crm> <${RDF}type>`))).toHaveLength(1);
  });

  it('the model’s dcterms:modified stamped on both sides is no conflict: the later one is kept', () => {
    const f = fixture('modified.trig');
    for (const result of [merge(f), mergeSnapshots(f.base, f.theirs, f.ours)]) {
      expect(result.conflicts).toEqual([]);
      expect(result.merged.filter((l) => l.includes('/terms/modified>'))).toEqual([
        '<https://example.org/m/model> <http://purl.org/dc/terms/modified> "2026-11-05T14:30:00.000Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .',
      ]);
    }
  });

  it('picking a side gives that side’s value', () => {
    const f = fixture('value.trig');
    const { merged, conflicts } = merge(f);
    const name = conflicts.find((c) => c.predicate === `${SKOS}prefLabel`) as MergeConflict;
    const picked = applyChoice(merged, name, 'theirs');
    expect(has(picked, '"Accounts"@en')).toBe(true);
    expect(has(picked, '"Billing"@en')).toBe(false);
  });

  it('a relationship retargeted differently is one conflict over its whole connection', () => {
    const f = fixture('ends.trig');
    const { merged, conflicts } = merge(f);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: 'value', subjects: [`${M}serving`], predicate: `${ARCH}target` });
    // Base's connection, whole: end, reified triple, direct triple.
    const connection = merged.filter((l) => /m\/serving> <.*#(target|reifies)>|m\/billing> <.*#serves>/.test(l));
    expect(short(connection)).toEqual([
      '<m:billing> <https://meta.linked.archi/archimate4/onto#serves> <m:portal> .',
      '<m:serving> <http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies> <<( <m:billing> <https://meta.linked.archi/archimate4/onto#serves> <m:portal> )>> .',
      '<m:serving> <https://meta.linked.archi/core#target> <m:portal> .',
    ]);
    const theirs = applyChoice(merged, conflicts[0], 'theirs');
    expect(theirs).toEqual(f.theirs);
  });
});

describe('a concept deleted on one side', () => {
  it('and renamed on the other: kept, with what was deleted along with it', () => {
    const f = fixture('deleted-renamed.trig');
    const { merged, conflicts } = merge(f);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      kind: 'deleted',
      deletedBy: 'ours',
      subjects: [`${M}billing`, `${M}link-serving`, `${M}node-billing`, `${M}serving`],
    });
    // Theirs' version: Billing renamed, nothing lost.
    expect(merged).toEqual(f.theirs);
    expect(applyChoice(merged, conflicts[0], 'theirs')).toEqual(f.theirs);
    // Ours' option deletes it all again.
    expect(applyChoice(merged, conflicts[0], 'ours')).toEqual(f.ours);
  });

  it('and related to on the other: deleting removes the new relationship, not its other end', () => {
    const f = fixture('deleted-related.trig');
    const { merged, conflicts } = merge(f);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: 'deleted', deletedBy: 'ours', subjects: [`${M}crm`] });
    expect(merged).toEqual(f.theirs);
    const deleted = applyChoice(merged, conflicts[0], 'ours');
    expect(deleted).toEqual(f.ours);
    expect(has(deleted, '<https://example.org/m/portal> <http://www.w3.org/2004/02/skos/core#prefLabel>')).toBe(true);
  });

  it('and placed on a diagram on the other: deleting removes the new node', () => {
    const f = fixture('deleted-placed.trig');
    const { merged, conflicts } = merge(f);
    expect(conflicts.map((c) => [c.kind, c.subjects])).toEqual([['deleted', [`${M}crm`]]]);
    expect(merged).toEqual(f.theirs);
    expect(applyChoice(merged, conflicts[0], 'ours')).toEqual(f.ours);
  });

  it('and filed in a folder on the other: the folder’s entry is a reference too', () => {
    const f = fixture('deleted-filed.trig');
    const { merged, conflicts } = merge(f);
    expect(conflicts.map((c) => [c.kind, c.subjects, c.deletedBy])).toEqual([['deleted', [`${M}crm`], 'ours']]);
    expect(merged).toEqual(f.theirs);
    expect(applyChoice(merged, conflicts[0], 'ours')).toEqual(f.ours);
  });

  it('the same conflict with the sides the other way round', () => {
    const f = fixture('deleted-related.trig');
    const { merged, conflicts } = mergeSnapshots(f.base, f.theirs, f.ours);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].deletedBy).toBe('theirs');
    expect(merged).toEqual(f.theirs);
    expect(applyChoice(merged, conflicts[0], 'theirs')).toEqual(f.ours);
  });

  it('deletions that agree are no conflict', () => {
    const f = fixture('deleted-agreed.trig');
    const { merged, conflicts } = merge(f);
    expect(conflicts).toEqual([]);
    expect(merged).toEqual(f.ours);
  });
});

describe('a node’s bounds and a line’s route merge as a whole', () => {
  it('moved on one side and resized on the other: a conflict, base’s bounds kept', () => {
    const f = fixture('bounds.trig');
    const { merged, conflicts } = merge(f);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: 'bounds', subjects: [`${M}node-billing`] });
    expect(conflicts[0].held).toHaveLength(4);
    const billing = (lines: readonly string[]) => short(lines.filter((l) => l.startsWith(`<${M}node-billing> `) && l.includes('bounds')));
    expect(billing(merged)).toEqual(billing(f.base));
    // Portal's node, moved by theirs only.
    expect(has(merged, '<https://example.org/m/node-portal> <https://meta.linked.archi/core-vis#bounds-y> "80"')).toBe(true);
    expect(billing(applyChoice(merged, conflicts[0], 'ours'))).toEqual(billing(f.ours));
  });

  it('rerouted on both sides: a conflict, base’s route kept — never a mix', () => {
    const f = fixture('route.trig');
    const { merged, conflicts } = merge(f);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: 'route', subjects: [`${M}link-serving`] });
    expect(merged).toEqual(f.base);
    expect(applyChoice(merged, conflicts[0], 'ours')).toEqual(f.ours);
    expect(applyChoice(merged, conflicts[0], 'theirs')).toEqual(f.theirs);
  });

  it('rerouted on one side only: that route, while the other side changes something else', () => {
    const f = fixture('route.trig');
    const rename = (lines: string[]) =>
      lines.map((l) => (l.includes('"Portal"@en') ? l.replace('"Portal"@en', '"Web portal"@en') : l)).sort();
    const { merged, conflicts } = mergeSnapshots(f.base, f.theirs, rename(f.base));
    expect(conflicts).toEqual([]);
    expect(merged).toEqual(rename(f.theirs));
  });
});

describe('the same element placed on a diagram by both sides', () => {
  it('keeps both nodes, each with what its side drew at it; the conflict offers each alone', () => {
    const f = fixture('placement.trig');
    const { merged, conflicts } = merge(f);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: 'placement', subjects: [`${M}node-crm-a`, `${M}node-crm-b`] });
    // An element may be placed twice in a view: both placements, and the line theirs drew at its own.
    expect(has(merged, '<https://example.org/m/node-crm-a>')).toBe(true);
    expect(has(merged, '<https://example.org/m/node-crm-b>')).toBe(true);
    expect(has(merged, '<https://example.org/m/link-flow> <https://meta.linked.archi/core-vis#source> <https://example.org/m/node-crm-b>')).toBe(true);
    expect(has(merged, '<https://example.org/m/flow> <https://meta.linked.archi/core#inView>')).toBe(true);
    expect(has(merged, '<https://example.org/m/crm> <https://meta.linked.archi/core#inView>')).toBe(true);
    // Mine alone: theirs' node goes, with its line — the relationship stays, not shown in the view without it.
    const mine = applyChoice(merged, conflicts[0], 'ours');
    expect(has(mine, '<https://example.org/m/node-crm-b>')).toBe(false);
    expect(has(mine, '<https://example.org/m/link-flow>')).toBe(false);
    expect(has(mine, '<https://example.org/m/flow> <https://meta.linked.archi/core#source>')).toBe(true);
    expect(has(mine, '<https://example.org/m/flow> <https://meta.linked.archi/core#inView>')).toBe(false);
    expect(has(mine, '<https://example.org/m/crm> <https://meta.linked.archi/core#inView>')).toBe(true);
    const theirs = applyChoice(merged, conflicts[0], 'theirs');
    expect(has(theirs, '<https://example.org/m/node-crm-a>')).toBe(false);
    expect(has(theirs, '<https://example.org/m/node-crm-b>')).toBe(true);
    expect(has(theirs, '<https://example.org/m/link-flow> <https://meta.linked.archi/core-vis#source> <https://example.org/m/node-crm-b>')).toBe(true);
    expect(has(theirs, '<https://example.org/m/flow> <https://meta.linked.archi/core#inView>')).toBe(true);
    expect(has(theirs, '<https://example.org/m/crm> <https://meta.linked.archi/core#inView>')).toBe(true);
  });

  it('keeps the same nodes whichever side is ours', () => {
    const f = fixture('placement.trig');
    expect(mergeSnapshots(f.base, f.theirs, f.ours).merged).toEqual(merge(f).merged);
  });
});

describe('count limits broken by the combination', () => {
  it('are found with the SHACL validator, where neither side alone breaks them', () => {
    const f = fixture('count.trig');
    const counts = shaclCountCheck(new RdfShaclValidator(), f.shapes);
    const { merged, conflicts } = merge(f, { counts });
    expect(conflicts.map((c) => [c.kind, c.subjects[0], c.predicate])).toEqual([
      ['count', `${M}billing`, `${EX}owner`],
      ['count', `${M}portal`, `${EX}steward`],
    ]);
    const [owners, stewards] = conflicts;
    expect(owners.held).toHaveLength(3);
    expect(stewards.held).toHaveLength(0);
    expect(merged.filter((l) => l.includes(`<${EX}owner>`))).toHaveLength(3);
    // Each side's values, to keep.
    expect(applyChoice(merged, owners, 'ours').filter((l) => l.includes(`<${EX}owner>`))).toHaveLength(2);
    expect(short(stewards.options.theirs)).toEqual(['<m:portal> <https://example.org/vocab#steward> <m:ann> .']);
  });

  it('are not looked for without a check', () => {
    expect(merge(fixture('count.trig')).conflicts).toEqual([]);
  });
});

describe('files', () => {
  it('a TriG file’s graphs are read into one model, as opening it does', () => {
    const trigText = `@prefix m: <${M}> .\n<${M}graph/model> { m:a m:p m:b . }\n<${M}graph/views> { m:n m:q m:a . }`;
    expect(snapshotOfText(trigText, 'shop.trig')).toEqual([`<${M}a> <${M}p> <${M}b> .`, `<${M}n> <${M}q> <${M}a> .`]);
  });

  it('blank nodes do not match between files: both copies are kept', () => {
    const text = (name: string) => `@prefix m: <${M}> .\nm:billing m:name "${name}" ; m:address [ m:city "Ghent" ] .`;
    const base = snapshotOfText(text('Billing'), 'base.ttl');
    const ours = snapshotOfText(text('Invoicing'), 'ours.ttl');
    const theirs = snapshotOfText(text('Billing'), 'theirs.ttl').concat(`<${M}crm> <${M}name> "CRM" .`).sort();
    const { merged } = mergeSnapshots(base, ours, theirs);
    expect(merged.filter((l) => l.includes('"Ghent"'))).toHaveLength(2);
  });
});

describe('a model moved to another namespace on one side (DD-41, scenario S7)', () => {
  const NEW = 'https://acme.com/ea/shop/';
  const OTHER = 'https://acme.com/ea/store/';
  const AM4 = 'https://meta.linked.archi/archimate4/onto#';
  const VIS = 'https://meta.linked.archi/core-vis#';
  const VANN = 'http://purl.org/vocab/vann/';
  const name = (iri: string, text: string) => `<${iri}> <${SKOS}prefLabel> "${text}"@en .`;
  /** `lines` with `remove` taken out — each must be there — and `add` put in. */
  const edited = (lines: readonly string[], remove: readonly string[], add: readonly string[] = []): string[] => {
    const out = new Set(lines);
    for (const line of remove) if (!out.delete(line)) throw new Error(`not there: ${line}`);
    for (const line of add) out.add(line);
    return [...out].sort();
  };
  /** A version moved into `to` as Model settings moves a model (`ModelSession.setNamespace`), beside a vocabulary. */
  const movedTo = (lines: readonly string[], to: string, vocabulary: readonly Quad[] = []): string[] => {
    const store = new OxigraphRdfStore();
    try {
      store.addQuads([...quadsOfSnapshot(lines), ...vocabulary]);
      const plan = planNamespaceChange(store, `${M}model`, M, to);
      store.removeQuads(plan.remove);
      store.addQuads([...plan.add, ...namespaceQuads(`${to}model`, to)]);
      return snapshotOf(modelQuads(store));
    } finally {
      store.dispose();
    }
  };
  const inOld = (lines: readonly string[]) => lines.filter((l) => l.includes(`<${M}`));
  const renamed = (lines: readonly string[], ns: string, iri: string, from: string, to: string) =>
    edited(lines, [name(`${ns}${iri}`, from)], [name(`${ns}${iri}`, to)]);

  it('reads the model and its namespace off a snapshot: stated, or derived from the model’s IRI', () => {
    expect(snapshotModel(MODEL)).toEqual({ model: `${M}model`, namespace: M });
    expect(snapshotModel(movedTo(MODEL, NEW))).toEqual({ model: `${NEW}model`, namespace: NEW });
    expect(snapshotModel(MODEL.filter((l) => !l.endsWith(`<${ARCH}Model> .`)))).toBeUndefined();
  });

  it('a rename on the other side lands in the new namespace, whichever side moved it', () => {
    const moved = movedTo(MODEL, NEW);
    const theirs = renamed(MODEL, M, 'billing', 'Billing', 'Invoicing');
    const expected = movedTo(theirs, NEW);

    const result = mergeSnapshots(MODEL, moved, theirs);
    expect(result).toEqual({ merged: expected, conflicts: [], moved: { from: M, to: NEW, by: 'ours' } });
    expect(result.merged).toContain(name(`${NEW}billing`, 'Invoicing'));
    expect(inOld(result.merged)).toEqual([]);
    expect(mergeSnapshots(MODEL, theirs, moved)).toEqual({ merged: expected, conflicts: [], moved: { from: M, to: NEW, by: 'theirs' } });
  });

  it('what the other side added and removed is moved too: an element related and drawn, triple term and all; a deletion', () => {
    const search = `${M}element/search`;
    const serving = `${M}relationship/search-serves-portal`;
    const node = `${M}view#node-search`;
    const crm = MODEL.filter((l) => l.startsWith(`<${M}crm> `) || l.endsWith(` <${M}crm> .`));
    const theirs = edited(MODEL, crm, [
      `<${search}> <${RDF}type> <${AM4}ApplicationComponent> .`,
      name(search, 'Search'),
      `<${search}> <${ARCH}inModel> <${M}model> .`,
      `<${search}> <${AM4}serves> <${M}portal> .`,
      `<${serving}> <${RDF}type> <${AM4}Serving> .`,
      `<${serving}> <${ARCH}source> <${search}> .`,
      `<${serving}> <${ARCH}target> <${M}portal> .`,
      `<${serving}> <${RDF}reifies> <<( <${search}> <${AM4}serves> <${M}portal> )>> .`,
      `<${node}> <${VIS}view> <${M}view> .`,
      `<${node}> <${VIS}archElement> <${search}> .`,
    ]);

    const { merged, conflicts } = mergeSnapshots(MODEL, movedTo(MODEL, NEW), theirs);
    expect(conflicts).toEqual([]);
    expect(merged).toEqual(movedTo(theirs, NEW));
    expect(merged).toContain(`<${NEW}relationship/search-serves-portal> <${RDF}reifies> <<( <${NEW}element/search> <${AM4}serves> <${NEW}portal> )>> .`);
    expect(merged).toContain(`<${NEW}view#node-search> <${VIS}view> <${NEW}view> .`);
    expect(merged.some((l) => l.includes(`<${NEW}crm>`))).toBe(false);
    expect(inOld(merged)).toEqual([]);
  });

  it('changes that met still conflict, held as base had them, in the new namespace', () => {
    const ours = renamed(movedTo(MODEL, NEW), NEW, 'billing', 'Billing', 'Invoicing');
    const theirs = renamed(MODEL, M, 'billing', 'Billing', 'Accounts');
    const { merged, conflicts } = mergeSnapshots(MODEL, ours, theirs);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      kind: 'value',
      subjects: [`${NEW}billing`],
      predicate: `${SKOS}prefLabel`,
      held: [name(`${NEW}billing`, 'Billing')],
      options: { ours: [name(`${NEW}billing`, 'Invoicing')], theirs: [name(`${NEW}billing`, 'Accounts')] },
    });
    expect(merged).toContain(name(`${NEW}billing`, 'Billing'));
    expect(inOld(merged)).toEqual([]);
  });

  it('a concept deleted after the move and renamed on the other side: the deletion conflict, in the new namespace', () => {
    const moved = movedTo(MODEL, NEW);
    const ours = edited(moved, moved.filter((l) => l.startsWith(`<${NEW}crm> `)));
    const theirs = renamed(MODEL, M, 'crm', 'CRM', 'Customers');
    const { conflicts } = mergeSnapshots(MODEL, ours, theirs);
    expect(conflicts.map((c) => [c.kind, c.subjects, c.deletedBy])).toEqual([['deleted', [`${NEW}crm`], 'ours']]);
  });

  it('moved alike on both sides: base is moved, and each side’s other change merges', () => {
    const ours = renamed(movedTo(MODEL, NEW), NEW, 'billing', 'Billing', 'Invoicing');
    const theirs = renamed(movedTo(MODEL, NEW), NEW, 'portal', 'Portal', 'Web portal');
    const result = mergeSnapshots(MODEL, ours, theirs);
    expect(result.conflicts).toEqual([]);
    expect(result.moved).toEqual({ from: M, to: NEW, by: 'both' });
    expect(result.merged).toEqual(movedTo(renamed(renamed(MODEL, M, 'billing', 'Billing', 'Invoicing'), M, 'portal', 'Portal', 'Web portal'), NEW));
  });

  it('moved to a namespace of its own on each side: not merged', () => {
    const ours = movedTo(MODEL, NEW);
    const theirs = renamed(movedTo(MODEL, OTHER), OTHER, 'billing', 'Billing', 'Accounts');
    expect(() => mergeSnapshots(MODEL, ours, theirs)).toThrow(NamespaceConflict);
    expect(() => mergeSnapshots(MODEL, ours, theirs)).toThrow(`ours to ${NEW} and theirs to ${OTHER}`);
  });

  it('a vocabulary’s term in the old namespace, which the move left alone, stays as it is on the other side', () => {
    const ownedBy = `${M}ownedBy`;
    const vocabulary = [
      DataFactory.quad(DataFactory.namedNode(ownedBy), DataFactory.namedNode(`${RDF}type`), DataFactory.namedNode('http://www.w3.org/2002/07/owl#ObjectProperty'), DataFactory.namedNode('urn:vocab')),
    ] as unknown as Quad[];
    const base = edited(MODEL, [], [`<${M}billing> <${ownedBy}> <${M}crm> .`]);
    const ours = movedTo(base, NEW, vocabulary);
    expect(ours).toContain(`<${NEW}billing> <${ownedBy}> <${NEW}crm> .`);
    const theirs = edited(base, [], [`<${M}portal> <${ownedBy}> <${M}crm> .`]);
    const { merged, conflicts } = mergeSnapshots(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(merged).toContain(`<${NEW}portal> <${ownedBy}> <${NEW}crm> .`);
    expect(inOld(merged).every((l) => l.includes(`<${ownedBy}>`))).toBe(true);
  });

  it('a namespace set without moving the IRIs is merged as the statement it is: nothing is moved', () => {
    const declared = [`<${M}model> <${VANN}preferredNamespacePrefix> "m" .`, `<${M}model> <${VANN}preferredNamespaceUri> "${NEW}" .`];
    const ours = edited(MODEL, [], declared);
    const theirs = renamed(MODEL, M, 'billing', 'Billing', 'Invoicing');
    const result = mergeSnapshots(MODEL, ours, theirs);
    expect(result.moved).toBeUndefined();
    expect(result.merged).toEqual(edited(theirs, [], declared));
  });
});
