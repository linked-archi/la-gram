import { describe, it, expect } from 'vitest';
import { NAMESPACES, PREFIXES, expandPrefixedName } from '../namespaces.js';

describe('NAMESPACES', () => {
  it('contains the arch: namespace', () => {
    expect(NAMESPACES.arch).toBe('https://meta.linked.archi/core#');
  });

  it('contains the arch-vis: namespace', () => {
    expect(NAMESPACES['arch-vis']).toBe('https://meta.linked.archi/core-vis#');
  });

  it('contains standard W3C namespaces', () => {
    expect(NAMESPACES.rdf).toBe('http://www.w3.org/1999/02/22-rdf-syntax-ns#');
    expect(NAMESPACES.rdfs).toBe('http://www.w3.org/2000/01/rdf-schema#');
    expect(NAMESPACES.owl).toBe('http://www.w3.org/2002/07/owl#');
    expect(NAMESPACES.skos).toBe('http://www.w3.org/2004/02/skos/core#');
    expect(NAMESPACES.sh).toBe('http://www.w3.org/ns/shacl#');
    expect(NAMESPACES.dc).toBe('http://purl.org/dc/elements/1.1/');
    expect(NAMESPACES.xsd).toBe('http://www.w3.org/2001/XMLSchema#');
  });
});

describe('PREFIXES', () => {
  it('mirrors NAMESPACES as a plain Record', () => {
    for (const [key, value] of Object.entries(NAMESPACES)) {
      expect(PREFIXES[key]).toBe(value);
    }
  });
});

describe('expandPrefixedName', () => {
  it('expands a known prefix', () => {
    expect(expandPrefixedName('arch:Element')).toBe('https://meta.linked.archi/core#Element');
  });

  it('expands arch-vis prefix', () => {
    expect(expandPrefixedName('arch-vis:bounds-x')).toBe('https://meta.linked.archi/core-vis#bounds-x');
  });

  it('returns the input unchanged for unknown prefixes', () => {
    expect(expandPrefixedName('unknown:Foo')).toBe('unknown:Foo');
  });

  it('returns the input unchanged when no colon is present', () => {
    expect(expandPrefixedName('nocolon')).toBe('nocolon');
  });
});
