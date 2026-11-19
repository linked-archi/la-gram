/**
 * The Turtle writer: a model's IRIs written as DD-41 says — a prefix per kind, a prefix per view, relative to
 * `@base`, in full — and read back as they were written (`.agents/tasks/iri-layout/requirements.md`, R1–R10).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataFactory, Parser as N3Parser, Writer as N3Writer } from 'n3';
import * as oxigraph from 'oxigraph';
import type { Quad } from '@rdfjs/types';
import { PREFIXES } from '../namespaces.js';
import type { PrefixMap } from '../interfaces.js';
import { N3TtlSerializer } from '../ttl-serializer.js';
import {
  N3_VERSION,
  escapedLocalName,
  isPathNamespace,
  modelPrefixes,
  usedPrefixes,
  viewPrefixLabel,
  writeTurtle,
} from '../turtle-writer.js';
import { fragmentTurtle } from '../../model-manager/clipboard.js';

const { namedNode, literal, quad, defaultGraph } = DataFactory;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const NS = 'https://example.org/archimate/2d441909-2be6-4dfe-aaa5-c7ee59edbc4c/';
const VIEW = `${NS}view/4b7e0c12-9d3a-4f61-8e2b-1c5d7a9e3f40`;
const ELEMENT = `${NS}element/6ad3ed74-f0b2-41aa-9e0c-adafbf5320d4`;
const NODE = `${VIEW}#node-e1f2a3b4-5c6d-4e7f-8a9b-0c1d2e3f4a5b`;
const LINK = `${VIEW}#link-9c3e5a71-2b4d-4f60-9a8b-7c6d5e4f3a21`;
const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const ARCH = PREFIXES['arch']!;
const VIS = PREFIXES['arch-vis']!;
const RDF = PREFIXES['rdf']!;
const MODEL = { namespace: NS, prefix: 'm' };
const KNOWN: PrefixMap = { ...PREFIXES, am4: AM4, m: NS };

const t = (s: string, p: string, o: string): Quad => quad(namedNode(s), namedNode(p), namedNode(o)) as unknown as Quad;
const l = (s: string, p: string, value: string): Quad => quad(namedNode(s), namedNode(p), literal(value, 'en')) as unknown as Quad;

/** The quads as canonical N-Quads lines, sorted: what two serializations must agree on. */
function canonical(quads: readonly Quad[]): string[] {
  const writer = new N3Writer({ format: 'application/n-quads' });
  const lines = writer.quadsToString(quads as Quad[]).split('\n').filter(Boolean);
  return lines.sort();
}

/** What Oxigraph reads from a Turtle or TriG text, as canonical N-Quads lines. */
function readByOxigraph(text: string, format: 'text/turtle' | 'application/trig'): string[] {
  const store = new oxigraph.Store();
  store.load(text, { format });
  return canonical(new N3Parser({ format: 'application/n-quads' }).parse(store.dump({ format: 'application/n-quads' })) as unknown as Quad[]);
}

/** The statements of a Turtle or TriG text, its `@base` and `@prefix` lines left out. */
function statements(text: string): string {
  return text.split('\n').filter((line) => !line.startsWith('@')).join('\n');
}

/** What N3.js reads. */
function readByN3(text: string, format: 'text/turtle' | 'application/trig' = 'text/turtle'): string[] {
  return canonical(new N3Parser({ format }).parse(text) as unknown as Quad[]);
}

/** A model drawn in the layout, with a name la-gram minted before it, a converter's and another model's. */
function layoutModel(): Quad[] {
  return [
    t(`${NS}model`, `${RDF}type`, `${ARCH}Model`),
    t(ELEMENT, `${RDF}type`, `${AM4}ApplicationComponent`),
    l(ELEMENT, `${PREFIXES['skos']}prefLabel`, 'Billing'),
    t(ELEMENT, `${ARCH}inModel`, `${NS}model`),
    t(`${NS}element-0d8f2c64-7b1e-4a93-b5d0-3e9c1a7f6b28`, `${RDF}type`, `${AM4}ApplicationComponent`),
    t(`${NS}element/component/default/payments-service`, `${RDF}type`, `${AM4}ApplicationComponent`),
    t(`${ELEMENT}/name/0f1e2d3c`, `${RDF}type`, `${VIS}PresentationName`),
    t(VIEW, `${RDF}type`, `${ARCH}Diagram`),
    t(NODE, `${RDF}type`, `${VIS}ArchNode`),
    t(NODE, `${VIS}view`, VIEW),
    t(NODE, `${VIS}archElement`, ELEMENT),
    t(NODE, `${VIS}style`, `${NODE}-style`),
    t(LINK, `${RDF}type`, `${VIS}Link`),
    t(LINK, `${VIS}points`, `${LINK}-points-0`),
    t(`${LINK}-points-0`, `${RDF}first`, `${LINK}-point-0`),
    t(`${LINK}-points-0`, `${RDF}rest`, `${RDF}nil`),
    t(`${NS}view/id-v77/node/id-n42`, `${RDF}type`, `${VIS}ArchNode`),
    t(`${NS}element-0d8f2c64-7b1e-4a93-b5d0-3e9c1a7f6b28`, `${AM4}serves`, 'https://example.org/archimate/other/element/x'),
  ];
}

describe('writeTurtle', () => {
  it('writes each IRI of the model with the first rule that applies (R1)', () => {
    const ttl = writeTurtle(layoutModel(), { prefixes: KNOWN, onlyUsed: true, model: MODEL });
    // 1. a prefix where the rest is a plain local name, la-gram's flat names among them
    expect(ttl).toContain('m:model a arch:Model');
    expect(ttl).toContain('me:6ad3ed74-f0b2-41aa-9e0c-adafbf5320d4 a am4:ApplicationComponent');
    expect(ttl).toContain('m:element-0d8f2c64-7b1e-4a93-b5d0-3e9c1a7f6b28 a am4:ApplicationComponent');
    expect(ttl).toContain('mv:4b7e0c12-9d3a-4f61-8e2b-1c5d7a9e3f40 a arch:Diagram');
    // 2. the view's prefix: its shapes and their parts, joined with `-`, with nothing to escape
    expect(ttl).toContain('mv3ef7da72:node-e1f2a3b4-5c6d-4e7f-8a9b-0c1d2e3f4a5b a arch-vis:ArchNode');
    expect(ttl).toContain('arch-vis:style mv3ef7da72:node-e1f2a3b4-5c6d-4e7f-8a9b-0c1d2e3f4a5b-style');
    expect(ttl).toContain('mv3ef7da72:link-9c3e5a71-2b4d-4f60-9a8b-7c6d5e4f3a21-points-0');
    expect(ttl).toContain('rdf:first mv3ef7da72:link-9c3e5a71-2b4d-4f60-9a8b-7c6d5e4f3a21-point-0');
    // 3. relative to @base: a compound id, a part of an element, a converter's nested shape
    expect(ttl.startsWith(`@base <${NS}>.\n`)).toBe(true);
    expect(ttl).toContain('<element/component/default/payments-service> a am4:ApplicationComponent');
    expect(ttl).toContain('<element/6ad3ed74-f0b2-41aa-9e0c-adafbf5320d4/name/0f1e2d3c> a arch-vis:PresentationName');
    expect(ttl).toContain('<view/id-v77/node/id-n42> a arch-vis:ArchNode');
    // 4. in full: another model's IRI
    expect(ttl).toContain('<https://example.org/archimate/other/element/x>');
    expect(ttl).not.toContain('../other');
  });

  it('declares the prefixes per kind and per view the IRIs use (R2, R3)', () => {
    const ttl = writeTurtle(layoutModel(), { prefixes: KNOWN, onlyUsed: true, model: MODEL });
    expect(ttl).toContain(`@prefix me: <${NS}element/>.`);
    expect(ttl).toContain(`@prefix mv: <${NS}view/>.`);
    expect(ttl).toContain(`@prefix mv3ef7da72: <${VIEW}#>.`);
    for (const unused of ['mr', 'mf', 'md', 'mdoc', 'ms', 'mg']) expect(ttl).not.toContain(`@prefix ${unused}:`);
  });

  it('writes a stakeholder with its kind’s prefix, as the guide’s kinds table has it (R2)', () => {
    const stakeholder = `${NS}stakeholder/owner-example.org`;
    const quads = [...layoutModel(), t(stakeholder, `${RDF}type`, `${ARCH}Stakeholder`)];
    const ttl = writeTurtle(quads, { prefixes: KNOWN, onlyUsed: true, model: MODEL });
    expect(ttl).toContain(`@prefix ms: <${NS}stakeholder/>.`);
    expect(ttl).toContain('ms:owner-example.org a arch:Stakeholder');
    expect(readByN3(ttl)).toEqual(canonical(quads));
  });

  it('is read back as written, by N3.js and by Oxigraph (R8)', () => {
    const quads = layoutModel();
    const ttl = writeTurtle(quads, { prefixes: KNOWN, onlyUsed: true, model: MODEL });
    expect(readByN3(ttl)).toEqual(canonical(quads));
    expect(readByOxigraph(ttl, 'text/turtle')).toEqual(canonical(quads));
  });

  it('writes TriG graphs by the graph prefix, and reads them back (R2, R8)', () => {
    const graph = namedNode(`${NS}graph/views`);
    const quads = layoutModel().map((q) => quad(q.subject as never, q.predicate as never, q.object as never, graph) as unknown as Quad);
    const trig = writeTurtle(quads, { prefixes: KNOWN, onlyUsed: true, model: MODEL, format: 'application/trig' });
    expect(trig).toContain(`@prefix mg: <${NS}graph/>.`);
    expect(trig).toContain('mg:views {');
    expect(readByN3(trig, 'application/trig')).toEqual(canonical(quads));
    expect(readByOxigraph(trig, 'application/trig')).toEqual(canonical(quads));
  });

  it('writes the triple term a relationship reifies with the same rules', () => {
    const rel = `${NS}relationship/r1`;
    const target = `${NS}element/e2`;
    const quads = [
      quad(namedNode(rel), namedNode(`${RDF}reifies`), quad(namedNode(ELEMENT), namedNode(`${AM4}serves`), namedNode(target))) as unknown as Quad,
      t(ELEMENT, `${AM4}serves`, target),
    ];
    const ttl = writeTurtle(quads, { prefixes: KNOWN, onlyUsed: true, model: MODEL });
    expect(ttl).toContain('mr:r1 rdf:reifies <<(me:6ad3ed74-f0b2-41aa-9e0c-adafbf5320d4 am4:serves me:e2)>>');
    expect(readByN3(ttl)).toEqual(canonical(quads));
    expect(readByOxigraph(ttl, 'text/turtle')).toEqual(canonical(quads));
  });

  it('writes a model la-gram made before the layout as it did (R1, R9)', () => {
    const flat = [
      t(`${NS}model`, `${RDF}type`, `${ARCH}Model`),
      t(`${NS}element-a`, `${RDF}type`, `${AM4}ApplicationComponent`),
      t(`${NS}node-b`, `${VIS}archElement`, `${NS}element-a`),
      t(`${NS}node-b`, `${VIS}style`, `${NS}node-b-style`),
      t(`${NS}link-c`, `${VIS}points`, `${NS}link-c-points-0`),
      t(`${NS}link-c-points-0`, `${RDF}first`, `${NS}link-c-p0`),
    ];
    const before = new N3Writer({ prefixes: usedPrefixes(KNOWN, flat) });
    for (const q of flat) before.addQuad(q as never);
    let expected = '';
    before.end((_e: Error | null, result: string) => (expected = result));
    expect(writeTurtle(flat, { prefixes: KNOWN, onlyUsed: true, model: MODEL })).toBe(expected);
  });

  it('gives a view its prefix whatever other views the file has (R3)', () => {
    const other = `${NS}view/another#node-n1`;
    const alone = writeTurtle([t(NODE, `${VIS}view`, VIEW)], { prefixes: KNOWN, model: MODEL });
    const withOther = writeTurtle([t(NODE, `${VIS}view`, VIEW), t(other, `${VIS}view`, `${NS}view/another`)], { prefixes: KNOWN, model: MODEL });
    expect(alone).toContain('mv3ef7da72:node-e1f2');
    expect(withOther).toContain('mv3ef7da72:node-e1f2');
    expect(viewPrefixLabel('m', VIEW)).toBe('mv3ef7da72');
    expect(viewPrefixLabel('shop', VIEW)).toBe('shopv3ef7da72');
  });

  it('leaves the prefix to the view whose IRI sorts first when two views have one hash (R4)', () => {
    // Two views whose SHA-256 begin alike: both would be `mv0c4b780c:`.
    const first = `${NS}view/v33085`;
    const second = `${NS}view/v36327`;
    expect(viewPrefixLabel('m', first)).toBe(viewPrefixLabel('m', second));
    const quads = [t(`${second}#node-n1`, `${VIS}view`, second), t(`${first}#node-n1`, `${VIS}view`, first)];
    const ttl = writeTurtle(quads, { prefixes: KNOWN, model: MODEL });
    expect(ttl).toContain(`@prefix mv0c4b780c: <${first}#>.`);
    expect(ttl).toContain('mv0c4b780c:node-n1 arch-vis:view mv:v33085');
    expect(ttl).toContain('<view/v36327#node-n1> arch-vis:view mv:v36327');
    expect(readByOxigraph(ttl, 'text/turtle')).toEqual(canonical(quads));
  });

  it('leaves a derived prefix to a vocabulary that holds it for another namespace (R5)', () => {
    const known = { ...KNOWN, md: 'https://example.org/markdown#' };
    const quads = [t(`${NS}decision/0007`, `${RDF}type`, `${ARCH}Element`)];
    const ttl = writeTurtle(quads, { prefixes: known, onlyUsed: true, model: MODEL });
    expect(ttl).not.toContain(`@prefix md: <${NS}decision/>`);
    expect(ttl).toContain('<decision/0007> a arch:Element');
    expect(modelPrefixes(MODEL, [`${NS}decision/0007`], known)).not.toHaveProperty('md');
    expect(modelPrefixes(MODEL, [`${NS}decision/0007`], KNOWN)).toHaveProperty('md', `${NS}decision/`);
  });

  it('writes @base only when an IRI is written relative to it, and only for a path namespace (R6)', () => {
    const plain = writeTurtle([t(ELEMENT, `${RDF}type`, `${AM4}ApplicationComponent`)], { prefixes: KNOWN, model: MODEL });
    expect(plain).not.toContain('@base');
    const urn = { namespace: 'urn:acme:ea:', prefix: 'm' };
    const compound = 'urn:acme:ea:element/component/default/x';
    const ttl = writeTurtle([t(compound, `${RDF}type`, `${AM4}ApplicationComponent`)], { prefixes: { ...KNOWN, m: urn.namespace }, model: urn });
    expect(ttl).not.toContain('@base');
    expect(ttl).toContain(`<${compound}>`);
    expect(isPathNamespace(NS)).toBe(true);
    expect(isPathNamespace('https://example.org/')).toBe(true);
    for (const no of ['urn:acme:ea:', 'https://example.org/x#', 'https://example.org/x', 'https://example.org/x?y/', 'ftp://example.org/x/']) {
      expect(isPathNamespace(no)).toBe(false);
    }
  });

  it('writes in full what a relative reference would not give back', () => {
    for (const iri of [`${NS}a:b/c`, `${NS}element/../x`, `${NS}./x`]) {
      const quads = [t(iri, `${RDF}type`, `${ARCH}Element`)];
      const ttl = writeTurtle(quads, { prefixes: KNOWN, model: MODEL });
      expect(ttl).toContain(`<${iri}>`);
      expect(readByN3(ttl)).toEqual(canonical(quads));
    }
  });

  it('writes prefixes alone without a model, as N3 does', () => {
    const quads = [t('http://example.org/s', 'http://example.org/p', 'http://example.org/o/1')];
    expect(writeTurtle(quads, { prefixes: { ex: 'http://example.org/' } })).not.toContain('@base');
  });
});

describe('escapedLocalName', () => {
  it('escapes each `/`, and what a local name cannot hold where it stands', () => {
    expect(escapedLocalName('node/e1f2')).toBe('node\\/e1f2');
    expect(escapedLocalName('link/l1/point/0')).toBe('link\\/l1\\/point\\/0');
    expect(escapedLocalName('a.b')).toBe('a.b');
    expect(escapedLocalName('a.')).toBe('a\\.');
    expect(escapedLocalName('-a')).toBe('\\-a');
    expect(escapedLocalName('a~b(c)')).toBe('a\\~b\\(c\\)');
    expect(escapedLocalName('a%20b')).toBe('a%20b');
    expect(escapedLocalName('a%2')).toBe('a\\%2');
    expect(escapedLocalName('Zürich:1')).toBe('Zürich:1');
    expect(escapedLocalName('a b')).toBeUndefined();
  });

  it('gives local names N3.js and Oxigraph read back', () => {
    const view = `${NS}view/v1`;
    const quads = ['node/a.b', 'node/a.', 'node/-a', 'node/a~b(c)', 'node/a%20b', 'node/Zürich:1'].map((local) =>
      t(`${view}#${local}`, `${VIS}view`, view),
    );
    const ttl = writeTurtle(quads, { prefixes: KNOWN, model: MODEL });
    expect(statements(ttl)).not.toContain('<');
    expect(readByN3(ttl)).toEqual(canonical(quads));
    expect(readByOxigraph(ttl, 'text/turtle')).toEqual(canonical(quads));
  });
});

describe('a copy as Turtle (R10)', () => {
  it('writes the model it was copied from as a saved model is', () => {
    const quads = [t(NODE, `${VIS}view`, VIEW), t(NODE, `${VIS}archElement`, ELEMENT)];
    const fragment = { source: { modelIri: `${NS}model`, namespace: NS, metamodelIris: [] }, concepts: [], nodes: [NODE], links: [], quads };
    const text = fragmentTurtle(fragment, KNOWN);
    expect(text).toContain('mv3ef7da72:node-e1f2a3b4-5c6d-4e7f-8a9b-0c1d2e3f4a5b');
    expect(text).toContain('me:6ad3ed74-f0b2-41aa-9e0c-adafbf5320d4');
    expect(readByN3(text)).toEqual(canonical(quads));
  });

  it('writes by the prefixes alone when it does not know the model', () => {
    const quads = [t(NODE, `${VIS}view`, VIEW)];
    expect(new N3TtlSerializer().serialize(quads, KNOWN)).toContain(`<${NODE}>`);
  });
});

describe('the n3 version the writer overrides', () => {
  it('is the one installed, and the one package.json pins exactly', () => {
    // `turtle-writer.ts` overrides `_encodeIriOrBlank`, an internal of n3's Writer. Another version may have
    // changed it: check the override against it, then move N3_VERSION and both package.json files together.
    const installed = (createRequire(import.meta.url)('n3/package.json') as { version: string }).version;
    expect(installed).toBe(N3_VERSION);
    const la = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    const cli = JSON.parse(readFileSync(join(ROOT, 'packages/la-gram-git/package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(la.dependencies['n3']).toBe(N3_VERSION);
    expect(cli.dependencies['n3']).toBe(N3_VERSION);
  });

  it('calls the override for subjects, predicates, objects, graphs and datatypes', () => {
    // Each name holds a `/`, which n3's own writer leaves as a full IRI: only the override writes it prefixed.
    const view = `${NS}view/v1`;
    const shape = `${view}#node/n1`;
    const quads = [
      quad(namedNode(shape), namedNode(`${view}#node/p`), namedNode(shape), namedNode(`${view}#node/g`)) as unknown as Quad,
      quad(namedNode(shape), namedNode(`${RDF}value`), literal('1', namedNode(`${view}#node/type`)), defaultGraph()) as unknown as Quad,
    ];
    const trig = writeTurtle(quads, { prefixes: KNOWN, model: MODEL, format: 'application/trig' });
    expect(statements(trig)).not.toContain('<');
    expect(trig).toContain('mv82386a7a:node\\/g {');
    expect(trig).toContain('"1"^^mv82386a7a:node\\/type');
    expect(readByN3(trig, 'application/trig')).toEqual(canonical(quads));
  });
});
