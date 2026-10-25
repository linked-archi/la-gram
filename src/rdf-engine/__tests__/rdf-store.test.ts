import { describe, it, expect, beforeEach } from 'vitest';
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
    const plain = [makeQuad('https://ex.org/a', 'https://ex.org/p', 'https://ex.org/b'), typed('https://ex.org/a', '10', 'integer')];
    expect(store.canonical(plain)).toBe(plain);
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
