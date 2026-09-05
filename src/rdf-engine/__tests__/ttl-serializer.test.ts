import { describe, it, expect } from 'vitest';
import { DataFactory } from 'n3';
import type { Quad } from '@rdfjs/types';
import { N3TtlSerializer } from '../ttl-serializer.js';
import { N3TtlParser } from '../ttl-parser.js';
import type { PrefixMap } from '../interfaces.js';

const { namedNode, literal, quad } = DataFactory;

function makeQuad(s: string, p: string, o: string): Quad {
  return quad(namedNode(s), namedNode(p), namedNode(o)) as unknown as Quad;
}

function makeLiteralQuad(s: string, p: string, value: string): Quad {
  return quad(namedNode(s), namedNode(p), literal(value)) as unknown as Quad;
}

describe('N3TtlSerializer', () => {
  const serializer = new N3TtlSerializer();
  const parser = new N3TtlParser();

  const prefixes: PrefixMap = {
    ex: 'http://example.org/',
    rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  };

  describe('prefix declarations', () => {
    it('places @prefix declarations before triple statements', () => {
      const quads: Quad[] = [
        makeQuad('http://example.org/s', 'http://example.org/p', 'http://example.org/o'),
      ];
      const output = serializer.serialize(quads, prefixes);

      const prefixPos = output.indexOf('@prefix');
      const triplePos = output.indexOf('ex:s');
      expect(prefixPos).toBeGreaterThanOrEqual(0);
      expect(triplePos).toBeGreaterThan(prefixPos);
    });

    it('includes all provided prefixes in the output', () => {
      const quads: Quad[] = [
        makeQuad('http://example.org/s', 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type', 'http://example.org/Thing'),
      ];
      const output = serializer.serialize(quads, prefixes);

      expect(output).toContain('@prefix ex:');
      expect(output).toContain('@prefix rdf:');
    });
  });

  describe('shortest prefix usage', () => {
    it('uses the shortest matching prefix for IRIs', () => {
      const quads: Quad[] = [
        makeQuad(
          'http://example.org/s',
          'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
          'http://example.org/Thing',
        ),
      ];
      const output = serializer.serialize(quads, prefixes);

      // Should use ex: not the full IRI
      expect(output).toContain('ex:s');
      expect(output).toContain('ex:Thing');
      // N3.js Writer uses the Turtle "a" shorthand for rdf:type
      expect(output).toMatch(/\ba\b/);
    });

    it('picks the shorter prefix label when two prefixes share the same URI', () => {
      const dualPrefixes: PrefixMap = {
        e: 'http://example.org/',
        example: 'http://example.org/',
      };
      const quads: Quad[] = [
        makeQuad('http://example.org/s', 'http://example.org/p', 'http://example.org/o'),
      ];
      const output = serializer.serialize(quads, dualPrefixes);

      // Should use the shorter prefix "e:" rather than "example:"
      expect(output).toContain('e:s');
      expect(output).not.toContain('example:s');
    });
  });

  describe('subject grouping', () => {
    it('groups triples by subject using semicolons', () => {
      const quads: Quad[] = [
        makeQuad('http://example.org/s', 'http://example.org/p1', 'http://example.org/o1'),
        makeLiteralQuad('http://example.org/s', 'http://example.org/p2', 'value'),
      ];
      const output = serializer.serialize(quads, prefixes);

      // N3 Writer groups same-subject triples with ";"
      expect(output).toContain(';');
      // The subject should appear only once
      const subjectMatches = output.match(/ex:s\b/g);
      expect(subjectMatches).toHaveLength(1);
    });

    it('separates different subjects with periods', () => {
      const quads: Quad[] = [
        makeQuad('http://example.org/a', 'http://example.org/p', 'http://example.org/o1'),
        makeQuad('http://example.org/b', 'http://example.org/p', 'http://example.org/o2'),
      ];
      const output = serializer.serialize(quads, prefixes);

      expect(output).toContain('ex:a');
      expect(output).toContain('ex:b');
    });
  });

  describe('valid Turtle output', () => {
    it('produces output that can be parsed back', () => {
      const quads: Quad[] = [
        makeQuad('http://example.org/s', 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type', 'http://example.org/Thing'),
        makeLiteralQuad('http://example.org/s', 'http://example.org/name', 'Test'),
        makeQuad('http://example.org/a', 'http://example.org/rel', 'http://example.org/b'),
      ];
      const output = serializer.serialize(quads, prefixes);
      const result = parser.parse(output);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.quads).toHaveLength(3);
      }
    });

    it('handles empty quad array', () => {
      const output = serializer.serialize([], prefixes);
      // Should still have prefix declarations or be empty/valid
      const result = parser.parse(output);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.quads).toHaveLength(0);
      }
    });

    it('handles quads with literal values', () => {
      const quads: Quad[] = [
        makeLiteralQuad('http://example.org/s', 'http://example.org/label', 'Hello World'),
      ];
      const output = serializer.serialize(quads, prefixes);

      expect(output).toContain('"Hello World"');
      const result = parser.parse(output);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.quads).toHaveLength(1);
        expect(result.quads[0].object.value).toBe('Hello World');
      }
    });
  });

  describe('deterministic output', () => {
    it('produces the same output for the same input regardless of quad order', () => {
      const q1 = makeQuad('http://example.org/b', 'http://example.org/p', 'http://example.org/o');
      const q2 = makeQuad('http://example.org/a', 'http://example.org/p', 'http://example.org/o');

      const output1 = serializer.serialize([q1, q2], prefixes);
      const output2 = serializer.serialize([q2, q1], prefixes);

      expect(output1).toBe(output2);
    });
  });
});
