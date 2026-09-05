import { describe, it, expect, beforeEach } from 'vitest';
import { DataFactory } from 'n3';
import type { Quad, NamedNode } from '@rdfjs/types';
import { OxigraphRdfStore } from '../rdf-store.js';

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
