import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataFactory } from 'n3';
import type { Quad, NamedNode } from '@rdfjs/types';
import { OxigraphRdfStore, detectQueryType } from '../rdf-store.js';

const { namedNode, literal, quad } = DataFactory;

function nn(value: string): NamedNode {
  return namedNode(value) as unknown as NamedNode;
}

function makeQuad(s: string, p: string, o: string): Quad {
  return quad(namedNode(s), namedNode(p), namedNode(o)) as unknown as Quad;
}

function makeLiteralQuad(s: string, p: string, value: string): Quad {
  return quad(namedNode(s), namedNode(p), literal(value)) as unknown as Quad;
}

describe('OxigraphRdfStore', () => {
  let store: OxigraphRdfStore;

  beforeEach(() => {
    store = new OxigraphRdfStore();
  });

  describe('addQuads', () => {
    it('adds quads that can be retrieved', () => {
      const q = makeQuad('http://ex.org/s', 'http://ex.org/p', 'http://ex.org/o');
      store.addQuads([q]);

      const result = store.getQuads();
      expect(result).toHaveLength(1);
      expect(result[0].subject.value).toBe('http://ex.org/s');
      expect(result[0].predicate.value).toBe('http://ex.org/p');
      expect(result[0].object.value).toBe('http://ex.org/o');
    });

    it('adds multiple quads at once', () => {
      const quads = [
        makeQuad('http://ex.org/a', 'http://ex.org/p', 'http://ex.org/b'),
        makeQuad('http://ex.org/c', 'http://ex.org/p', 'http://ex.org/d'),
      ];
      store.addQuads(quads);
      expect(store.getQuads()).toHaveLength(2);
    });

    it('handles literal objects', () => {
      const q = makeLiteralQuad('http://ex.org/s', 'http://ex.org/name', 'Alice');
      store.addQuads([q]);

      const result = store.getQuads();
      expect(result).toHaveLength(1);
      expect(result[0].object.value).toBe('Alice');
    });
  });

  describe('removeQuads', () => {
    it('removes specified quads from the store', () => {
      const q1 = makeQuad('http://ex.org/a', 'http://ex.org/p', 'http://ex.org/b');
      const q2 = makeQuad('http://ex.org/c', 'http://ex.org/p', 'http://ex.org/d');
      store.addQuads([q1, q2]);
      expect(store.getQuads()).toHaveLength(2);

      store.removeQuads([q1]);
      const remaining = store.getQuads();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].subject.value).toBe('http://ex.org/c');
    });

    it('does nothing when removing a quad that does not exist', () => {
      const q = makeQuad('http://ex.org/x', 'http://ex.org/y', 'http://ex.org/z');
      store.removeQuads([q]); // should not throw
      expect(store.getQuads()).toHaveLength(0);
    });
  });

  describe('getQuads', () => {
    beforeEach(() => {
      store.addQuads([
        makeQuad('http://ex.org/a', 'http://ex.org/p1', 'http://ex.org/b'),
        makeQuad('http://ex.org/a', 'http://ex.org/p2', 'http://ex.org/c'),
        makeQuad('http://ex.org/d', 'http://ex.org/p1', 'http://ex.org/e'),
      ]);
    });

    it('returns all quads when no filters are provided', () => {
      expect(store.getQuads()).toHaveLength(3);
    });

    it('filters by subject', () => {
      const result = store.getQuads(nn('http://ex.org/a'));
      expect(result).toHaveLength(2);
      result.forEach((q) => expect(q.subject.value).toBe('http://ex.org/a'));
    });

    it('filters by predicate', () => {
      const result = store.getQuads(null, nn('http://ex.org/p1'));
      expect(result).toHaveLength(2);
      result.forEach((q) => expect(q.predicate.value).toBe('http://ex.org/p1'));
    });

    it('filters by object', () => {
      const result = store.getQuads(null, null, nn('http://ex.org/b'));
      expect(result).toHaveLength(1);
      expect(result[0].subject.value).toBe('http://ex.org/a');
    });

    it('filters by subject and predicate', () => {
      const result = store.getQuads(nn('http://ex.org/a'), nn('http://ex.org/p1'));
      expect(result).toHaveLength(1);
      expect(result[0].object.value).toBe('http://ex.org/b');
    });
  });

  describe('query — SELECT', () => {
    it('executes a SELECT query and returns bindings', () => {
      store.addQuads([
        makeQuad('http://ex.org/s', 'http://ex.org/p', 'http://ex.org/o'),
      ]);

      const result = store.query('SELECT ?s ?p ?o WHERE { ?s ?p ?o }');
      expect(result.type).toBe('bindings');
      if (result.type === 'bindings') {
        expect(result.results).toHaveLength(1);
        expect(result.results[0]['s']).toBeDefined();
        expect((result.results[0]['s'] as NamedNode).value).toBe('http://ex.org/s');
      }
    });

    it('returns empty bindings for no matches', () => {
      const result = store.query('SELECT ?s WHERE { ?s <http://ex.org/nope> ?o }');
      expect(result.type).toBe('bindings');
      if (result.type === 'bindings') {
        expect(result.results).toHaveLength(0);
      }
    });
  });

  describe('query — CONSTRUCT', () => {
    it('executes a CONSTRUCT query and returns quads', () => {
      store.addQuads([
        makeQuad('http://ex.org/s', 'http://ex.org/p', 'http://ex.org/o'),
      ]);

      const result = store.query('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }');
      expect(result.type).toBe('quads');
      if (result.type === 'quads') {
        expect(result.quads).toHaveLength(1);
        expect(result.quads[0].subject.value).toBe('http://ex.org/s');
      }
    });

    it('returns empty quads for no matches', () => {
      const result = store.query('CONSTRUCT { ?s ?p ?o } WHERE { ?s <http://ex.org/nope> ?o }');
      expect(result.type).toBe('quads');
      if (result.type === 'quads') {
        expect(result.quads).toHaveLength(0);
      }
    });

    it('returns empty quads for a CONSTRUCT with prefixes, IRIs with # and a subquery', () => {
      const result = store.query(
        [
          '# a comment with SELECT in it',
          'PREFIX ex: <http://ex.org/ns#>',
          'CONSTRUCT { ?s ex:p ?o } WHERE {',
          '  { SELECT ?s WHERE { ?s a <http://ex.org/ns#Thing> } }',
          '  ?s ?q ?o . FILTER(?q IN (<http://ex.org/ns#a>, <http://ex.org/ns#b>) && ?o != "# not a comment")',
          '  ?o ex:q <http://ex.org/plain> .',
          '}',
        ].join('\n'),
      );
      expect(result).toEqual({ type: 'quads', quads: [] });
    });
  });

  describe('detectQueryType', () => {
    it('reads the query form, not a subquery, a comment, an IRI or a string', () => {
      expect(detectQueryType('SELECT * WHERE { ?s ?p ?o }')).toBe('SELECT');
      expect(detectQueryType('prefix x: <http://x/#> construct { ?s ?p ?o } where { { select ?s where { ?s ?p ?o } } }')).toBe('CONSTRUCT');
      expect(detectQueryType('# ASK\nDESCRIBE <http://x/ASK#SELECT>')).toBe('DESCRIBE');
      expect(detectQueryType('PREFIX s: <http://x/SELECT#>\nASK { ?s ?p "CONSTRUCT" }')).toBe('ASK');
    });
  });

  describe('query — ASK', () => {
    it('returns true when pattern matches', () => {
      store.addQuads([
        makeQuad('http://ex.org/s', 'http://ex.org/p', 'http://ex.org/o'),
      ]);

      const result = store.query('ASK { <http://ex.org/s> <http://ex.org/p> <http://ex.org/o> }');
      expect(result.type).toBe('boolean');
      if (result.type === 'boolean') {
        expect(result.value).toBe(true);
      }
    });

    it('returns false when pattern does not match', () => {
      const result = store.query('ASK { <http://ex.org/x> <http://ex.org/y> <http://ex.org/z> }');
      expect(result.type).toBe('boolean');
      if (result.type === 'boolean') {
        expect(result.value).toBe(false);
      }
    });
  });

  describe('query — DESCRIBE', () => {
    it('returns quads describing a resource', () => {
      store.addQuads([
        makeQuad('http://ex.org/s', 'http://ex.org/p1', 'http://ex.org/o1'),
        makeQuad('http://ex.org/s', 'http://ex.org/p2', 'http://ex.org/o2'),
      ]);

      const result = store.query('DESCRIBE <http://ex.org/s>');
      expect(result.type).toBe('quads');
      if (result.type === 'quads') {
        expect(result.quads.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe('query — error handling', () => {
    it('throws on invalid SPARQL syntax', () => {
      expect(() => store.query('NOT VALID SPARQL')).toThrow();
    });
  });

  describe('update', () => {
    it('inserts data via SPARQL UPDATE', () => {
      store.update('INSERT DATA { <http://ex.org/s> <http://ex.org/p> <http://ex.org/o> }');

      const quads = store.getQuads();
      expect(quads).toHaveLength(1);
      expect(quads[0].subject.value).toBe('http://ex.org/s');
    });

    it('deletes data via SPARQL UPDATE', () => {
      store.addQuads([
        makeQuad('http://ex.org/s', 'http://ex.org/p', 'http://ex.org/o'),
      ]);

      store.update('DELETE DATA { <http://ex.org/s> <http://ex.org/p> <http://ex.org/o> }');
      expect(store.getQuads()).toHaveLength(0);
    });

    it('supports DELETE/INSERT combined updates', () => {
      store.addQuads([
        makeLiteralQuad('http://ex.org/s', 'http://ex.org/name', 'Old'),
      ]);

      store.update(`
        DELETE { <http://ex.org/s> <http://ex.org/name> "Old" }
        INSERT { <http://ex.org/s> <http://ex.org/name> "New" }
        WHERE { <http://ex.org/s> <http://ex.org/name> "Old" }
      `);

      const quads = store.getQuads();
      expect(quads).toHaveLength(1);
      expect(quads[0].object.value).toBe('New');
    });

    it('throws on invalid SPARQL UPDATE syntax', () => {
      expect(() => store.update('NOT VALID UPDATE')).toThrow();
    });
  });
});

describe('quads as the store holds them', () => {
  const XSD = 'http://www.w3.org/2001/XMLSchema#';
  const typed = (s: string, value: string, type: string) =>
    quad(namedNode(s), namedNode('https://ex.org/p'), literal(value, namedNode(XSD + type))) as unknown as Quad;
  const shown = (quads: Quad[]) => quads.map((q) => `${q.subject.value} "${q.object.value}"^^${(q.object as { datatype: NamedNode }).datatype.value.replace(XSD, '')}`);

  it('Oxigraph keeps numbers, booleans and dates in canonical form; strings and IRIs as they are', () => {
    const store = new OxigraphRdfStore();
    const quads = [typed('https://ex.org/a', '010', 'int'), typed('https://ex.org/b', '1', 'boolean'), typed('https://ex.org/c', '1.50', 'decimal'), makeLiteralQuad('https://ex.org/d', 'https://ex.org/p', ' 010 ')];
    store.addQuads(quads);
    const held = store.canonical(quads);
    expect(shown(held)).toEqual(['https://ex.org/a "10"^^integer', 'https://ex.org/b "true"^^boolean', 'https://ex.org/c "1.5"^^decimal', 'https://ex.org/d " 010 "^^string']);
    expect(held.every((q) => store.has(q))).toBe(true);
    const tagged = [quad(namedNode('https://ex.org/e'), namedNode('https://ex.org/p'), literal('Colour', 'en-GB')) as unknown as Quad];
    store.addQuads(tagged);
    expect((store.canonical(tagged)[0].object as { language: string }).language).toBe('en-gb');
    expect(store.getQuads(nn('https://ex.org/e'))[0].object).toEqual(store.canonical(tagged)[0].object);
    const plain = [makeQuad('https://ex.org/a', 'https://ex.org/p', 'https://ex.org/b'), typed('https://ex.org/a', '10', 'integer')];
    expect(store.canonical(plain)).toBe(plain);
  });

  it('a double or decimal written plainly is taken as it is, and is as Oxigraph keeps it; one not, put through it', () => {
    const store = new OxigraphRdfStore();
    const values = ['0', '120', '-3.75', '0.1', '12.25', '123456789012345', '1.000001', '1.50', '1E3', '-0', '0120', '1234567890123456.5'];
    for (const type of ['double', 'decimal']) {
      const quads = values.map((v, i) => typed(`https://ex.org/n${type}${i}`, v, type));
      store.addQuads(quads);
      const held = store.canonical(quads);
      held.forEach((q, i) => expect(store.getQuads(nn(`https://ex.org/n${type}${i}`))[0].object).toEqual(q.object));
    }
  });

  it('a number of any integer type, a double or a decimal, in any form, is rewritten as Oxigraph keeps it', () => {
    let seed = 11;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pick = <T>(xs: T[]) => xs[Math.floor(next() * xs.length)];
    const zeros = () => '0'.repeat(Math.floor(next() * 3));
    const digits = (n: number) => Array.from({ length: n }, () => Math.floor(next() * 10)).join('');
    const integerTypes = ['integer', 'int', 'long', 'short', 'byte', 'nonNegativeInteger', 'unsignedInt', 'positiveInteger', 'unsignedByte'];
    const quads: Quad[] = [];
    for (let i = 0; i < 3000; i++) {
      const sign = pick(['', '', '-', '+']);
      if (i % 2 === 0) {
        quads.push(typed(`https://ex.org/i${i}`, `${sign}${zeros()}${digits(1 + Math.floor(next() * 12))}`, pick(integerTypes)));
      } else {
        const fraction = pick(['', '.', `.${digits(1 + Math.floor(next() * 5))}${zeros()}`]);
        quads.push(typed(`https://ex.org/d${i}`, `${sign}${zeros()}${pick(['', digits(1 + Math.floor(next() * 8))])}${fraction || '.0'}`, pick(['double', 'decimal'])));
      }
    }
    for (const value of ['0', '-0', '-0.0', '0.0', '.5', '1.', '+3.0', '132.0']) quads.push(typed(`https://ex.org/z${value}`, value, 'double'), typed(`https://ex.org/y${value}`, value, 'decimal'));
    const store = new OxigraphRdfStore();
    store.addQuads(quads);
    const held = store.canonical(quads);
    // What Oxigraph gives back, exactly: value and datatype.
    const form = (o: Quad['object']) => `${o.value}^^${(o as { datatype: NamedNode }).datatype.value}`;
    const wrong = held.filter((q) => form(store.getQuads(q.subject as NamedNode)[0].object) !== form(q.object));
    expect(wrong.map((q) => `${quads[held.indexOf(q)].object.value} → ${form(q.object)}`)).toEqual([]);
  });

  it('a change is reported, recorded and undone in the form the store holds', async () => {
    const { ObservableRdfStore } = await import('../observable-store.js');
    const store = new ObservableRdfStore(new OxigraphRdfStore());
    const told: string[] = [];
    store.subscribe((change) => told.push(...shown(change.added).map((s) => `+${s}`), ...shown(change.removed).map((s) => `-${s}`)));
    const { added } = store.record(() => store.addQuads([typed('https://ex.org/a', '010', 'int'), typed('https://ex.org/a', '10', 'integer')]));
    expect(shown(added)).toEqual(['https://ex.org/a "10"^^integer']);
    expect(told).toEqual(['+https://ex.org/a "10"^^integer']);
    store.applyDiff({ added, removed: [] }, true);
    expect(store.getQuads()).toHaveLength(0);
    store.addQuads([typed('https://ex.org/b', '1', 'boolean')]);
    store.removeQuads([typed('https://ex.org/b', 'true', 'boolean')]);
    expect(told.slice(2)).toEqual(['+https://ex.org/b "true"^^boolean', '-https://ex.org/b "true"^^boolean']);
  });
});

describe('the copy of the model graph', () => {
  const XSD = 'http://www.w3.org/2001/XMLSchema#';
  const DG = DataFactory.defaultGraph() as unknown as NamedNode;
  const keys = (quads: Quad[]) => quads.map((q) => `${q.subject.value} ${q.predicate.value} ${q.object.value}`).sort();

  async function stores() {
    const { ObservableRdfStore } = await import('../observable-store.js');
    const inner = new OxigraphRdfStore();
    return { inner, store: new ObservableRdfStore(inner) };
  }
  const same = (inner: OxigraphRdfStore, store: { getQuads: OxigraphRdfStore['getQuads'] }) =>
    expect(keys(store.getQuads(null, null, null, DG))).toEqual(keys(inner.getQuads(null, null, null, DG)));

  it('holds what the store holds, after adds, removes, an update and a bulk load; the metamodel graphs stay out', async () => {
    const { inner, store } = await stores();
    store.addQuads([makeQuad('https://ex.org/a', 'https://ex.org/p', 'https://ex.org/b'), quad(namedNode('https://ex.org/a'), namedNode('https://ex.org/n'), literal('010', namedNode(XSD + 'int'))) as unknown as Quad]);
    store.addQuads([quad(namedNode('https://ex.org/m'), namedNode('https://ex.org/p'), namedNode('https://ex.org/c'), namedNode('https://ex.org/g')) as unknown as Quad]);
    same(inner, store);
    expect(store.modelSize()).toBe(2);
    store.removeQuads([makeQuad('https://ex.org/a', 'https://ex.org/p', 'https://ex.org/b')]);
    store.update('INSERT DATA { <https://ex.org/x> <https://ex.org/p> <https://ex.org/y> }');
    store.load('<https://ex.org/z> <https://ex.org/p> <https://ex.org/y> .', { format: 'application/n-triples' });
    same(inner, store);
    expect(keys(store.getQuads(null, null, null, DG))).toEqual([
      'https://ex.org/a https://ex.org/n 10',
      'https://ex.org/x https://ex.org/p https://ex.org/y',
      'https://ex.org/z https://ex.org/p https://ex.org/y',
    ]);
  });

  it('everything is the model and the named graphs', async () => {
    const { inner, store } = await stores();
    store.addQuads([makeQuad('https://ex.org/a', 'https://ex.org/p', 'https://ex.org/b')]);
    store.load('<https://ex.org/C> <https://ex.org/p> <https://ex.org/D> .', { format: 'application/n-triples', graph: 'https://ex.org/meta' });
    store.load('<https://ex.org/E> <https://ex.org/p> <https://ex.org/F> .', { format: 'application/n-triples', graph: 'https://ex.org/notation' });
    expect(inner.namedGraphs().map((g) => g.value).sort()).toEqual(['https://ex.org/meta', 'https://ex.org/notation']);
    const all = (quads: Quad[]) => quads.map((q) => `${q.subject.value} ${q.graph.value}`).sort();
    expect(all(store.getQuads())).toEqual(all(inner.getQuads()));
    expect(store.getQuads()).toHaveLength(3);
  });

  it('a literal asked for is found in any of its forms', async () => {
    const { store } = await stores();
    store.addQuads([quad(namedNode('https://ex.org/a'), namedNode('https://ex.org/n'), literal('010', namedNode(XSD + 'int'))) as unknown as Quad]);
    expect(store.getQuads(null, null, literal('10', namedNode(XSD + 'integer')) as unknown as NamedNode, DG)).toHaveLength(1);
    expect(store.getQuads(null, null, literal('010', namedNode(XSD + 'int')) as unknown as NamedNode, DG)).toHaveLength(1);
  });

  it('a write the store refuses part-way leaves the copy as the store is', async () => {
    const { inner, store } = await stores();
    const refused = { ...makeQuad('https://ex.org/b', 'https://ex.org/p', 'https://ex.org/c'), subject: { termType: 'Variable', value: 'v' } } as unknown as Quad;
    expect(() => store.addQuads([makeQuad('https://ex.org/a', 'https://ex.org/p', 'https://ex.org/b'), refused])).toThrow();
    same(inner, store);
  });
});

describe('a large addition, given to the inner store in the background (Task 22)', () => {
  const DG = DataFactory.defaultGraph() as unknown as NamedNode;
  const P = 'https://ex.org/p';
  const many = (n: number) => Array.from({ length: n }, (_, i) => makeQuad(`https://ex.org/s${i}`, P, `https://ex.org/o${i % 7}`));
  const keys = (quads: Quad[]) => quads.map((q) => `${q.subject.value} ${q.predicate.value} ${q.object.value} ${q.graph.value}`).sort();

  async function stores() {
    const { ObservableRdfStore } = await import('../observable-store.js');
    const inner = new OxigraphRdfStore();
    const store = new ObservableRdfStore(inner);
    store.load('<https://ex.org/s1> <https://ex.org/meta> <https://ex.org/M> .', { format: 'application/n-triples', graph: 'https://ex.org/g' });
    return { inner, store };
  }
  const settled = (store: { behind: boolean }) =>
    new Promise<void>((resolve) => {
      const wait = () => (store.behind ? setTimeout(wait, 5) : resolve());
      wait();
    });

  it('is read whole at once — the model, and every graph — while the inner store gets it after', async () => {
    const { inner, store } = await stores();
    store.addQuads(many(12000));
    expect(store.behind).toBe(true);
    expect(inner.getQuads(null, null, null, DG).length).toBeLessThan(12000);
    expect(store.getQuads(null, null, null, DG)).toHaveLength(12000);
    expect(keys(store.getQuads(nn('https://ex.org/s1')))).toEqual([
      'https://ex.org/s1 https://ex.org/meta https://ex.org/M https://ex.org/g',
      'https://ex.org/s1 https://ex.org/p https://ex.org/o1 ',
    ]);
    expect(store.getQuads(null, nn(P), nn('https://ex.org/o3'))).toHaveLength(Math.ceil((12000 - 3) / 7));
    expect(store.getQuads(null, null, null, nn('https://ex.org/g'))).toHaveLength(1);
    await settled(store);
    expect(inner.getQuads(null, null, null, DG)).toHaveLength(12000);
    expect(keys(store.getQuads(nn('https://ex.org/s1')))).toHaveLength(2);
  });

  it('is all there for SPARQL, an update, the size; not waited for by a metamodel question', async () => {
    const { store } = await stores();
    store.addQuads(many(6000));
    const count = (r: ReturnType<typeof store.query>) => (r.type === 'bindings' ? Number(r.results[0]?.['n']?.value) : NaN);
    expect(count(store.queryMetamodels('SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }'))).toBeLessThan(6000);
    expect(store.behind).toBe(true);
    expect(count(store.query('SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }'))).toBe(6000);
    expect(store.behind).toBe(false);
    store.addQuads(many(6000).map((q, i) => makeQuad(`https://ex.org/t${i}`, P, q.object.value)));
    expect(store.size()).toBe(12001);
  });

  it('what is removed before it reaches the inner store never does; what is added again does', async () => {
    const { inner, store } = await stores();
    const quads = many(8000);
    store.addQuads(quads);
    store.removeQuads([quads[7000], quads[7001]]);
    store.addQuads([quads[7001]]);
    await settled(store);
    expect(inner.has(quads[7000])).toBe(false);
    expect(inner.has(quads[7001])).toBe(true);
    expect(keys(inner.getQuads(null, null, null, DG))).toEqual(keys(store.getQuads(null, null, null, DG)));
  });

  it('the whole model removed — another opened — is cleared in one go, told to listeners, the backlog dropped', async () => {
    const { inner, store } = await stores();
    const first = many(7000);
    store.addQuads(first);
    expect(store.behind).toBe(true);
    const told: number[] = [];
    store.subscribe((change) => told.push(change.removed.length));
    const clear = vi.spyOn(inner, 'update');
    store.removeQuads(store.getQuads(null, null, null, DG));
    expect(clear).toHaveBeenCalledWith('CLEAR SILENT DEFAULT');
    expect(told).toEqual([7000]);
    expect(store.behind).toBe(false);
    expect(inner.getQuads(null, null, null, DG)).toHaveLength(0);
    expect(store.getQuads(null, null, null, nn('https://ex.org/g'))).toHaveLength(1);
    const second = many(6000).map((q, i) => makeQuad(`https://ex.org/n${i}`, P, q.object.value));
    store.addQuads(second);
    await settled(store);
    expect(inner.getQuads(null, null, null, DG)).toHaveLength(6000);
  });

  it('a term the inner store cannot hold is refused at once, and the model keeps none of the addition', async () => {
    const { store } = await stores();
    const quads = [...many(6000), quad(namedNode('not an IRI'), namedNode(P), namedNode('https://ex.org/o')) as unknown as Quad];
    expect(() => store.addQuads(quads)).toThrow();
    expect(store.getQuads(null, null, null, DG)).toHaveLength(0);
    expect(store.behind).toBe(false);
  });
});
