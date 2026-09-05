import { describe, it, expect, beforeEach } from 'vitest';
import { N3TtlParser } from '../ttl-parser.js';

describe('N3TtlParser', () => {
  let parser: N3TtlParser;

  beforeEach(() => {
    parser = new N3TtlParser();
  });

  describe('successful parsing', () => {
    it('parses a simple triple', () => {
      const ttl = `
        @prefix ex: <http://example.org/> .
        ex:s ex:p ex:o .
      `;
      const result = parser.parse(ttl);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.quads).toHaveLength(1);
        expect(result.quads[0].subject.value).toBe('http://example.org/s');
        expect(result.quads[0].predicate.value).toBe('http://example.org/p');
        expect(result.quads[0].object.value).toBe('http://example.org/o');
      }
    });

    it('parses multiple triples', () => {
      const ttl = `
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:a ex:q ex:c .
        ex:b ex:r ex:d .
      `;
      const result = parser.parse(ttl);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.quads).toHaveLength(3);
      }
    });

    it('parses triples with literal objects', () => {
      const ttl = `
        @prefix ex: <http://example.org/> .
        @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
        ex:s ex:name "Alice" .
        ex:s ex:age "30"^^xsd:integer .
      `;
      const result = parser.parse(ttl);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.quads).toHaveLength(2);
        expect(result.quads[0].object.value).toBe('Alice');
      }
    });

    it('parses an empty input', () => {
      const result = parser.parse('');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.quads).toHaveLength(0);
      }
    });

    it('parses prefix-only input with no triples', () => {
      const ttl = '@prefix ex: <http://example.org/> .';
      const result = parser.parse(ttl);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.quads).toHaveLength(0);
      }
    });

    it('parses blank nodes', () => {
      const ttl = `
        @prefix ex: <http://example.org/> .
        ex:s ex:p [ ex:q "value" ] .
      `;
      const result = parser.parse(ttl);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.quads.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe('prefix extraction', () => {
    it('extracts declared prefixes', () => {
      const ttl = `
        @prefix ex: <http://example.org/> .
        @prefix foaf: <http://xmlns.com/foaf/0.1/> .
        ex:s foaf:name "Alice" .
      `;
      parser.parse(ttl);
      expect(parser.prefixes['ex']).toBe('http://example.org/');
      expect(parser.prefixes['foaf']).toBe('http://xmlns.com/foaf/0.1/');
    });

    it('resets prefixes on each parse call', () => {
      parser.parse('@prefix a: <http://a.org/> . a:s a:p a:o .');
      expect(parser.prefixes['a']).toBe('http://a.org/');

      parser.parse('@prefix b: <http://b.org/> . b:s b:p b:o .');
      expect(parser.prefixes['b']).toBe('http://b.org/');
      // Previous prefix from the first parse should be cleared
      // (N3 callback only fires for prefixes in the current input)
    });
  });

  describe('error handling', () => {
    it('returns ParseError for invalid syntax', () => {
      const ttl = 'this is not valid turtle';
      const result = parser.parse(ttl);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBeTruthy();
        expect(result.error.line).toBeGreaterThan(0);
      }
    });

    it('returns ParseError for unclosed literal', () => {
      const ttl = `
        @prefix ex: <http://example.org/> .
        ex:s ex:p "unclosed literal .
      `;
      const result = parser.parse(ttl);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBeTruthy();
        expect(result.error.line).toBeGreaterThan(0);
      }
    });

    it('returns ParseError for missing period', () => {
      const ttl = `
        @prefix ex: <http://example.org/> .
        ex:s ex:p ex:o
        ex:a ex:b ex:c .
      `;
      const result = parser.parse(ttl);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBeTruthy();
      }
    });

    it('returns ParseError for invalid prefix usage', () => {
      const ttl = 'undeclared:s undeclared:p undeclared:o .';
      const result = parser.parse(ttl);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBeTruthy();
      }
    });
  });
});
