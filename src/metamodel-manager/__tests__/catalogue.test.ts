/**
 * The built-in metamodel catalogue behind the Metamodels menu.
 */

import { describe, it, expect } from 'vitest';
import { CATALOGUE_KIND_LABELS, METAMODEL_CATALOGUE } from '../catalogue.js';

describe('METAMODEL_CATALOGUE', () => {
  it('lists Basic once, as a modelling language', () => {
    const basic = METAMODEL_CATALOGUE.filter((e) => e.iri === 'https://meta.linked.archi/basic/metamodel#Basic');
    expect(basic).toEqual([
      { iri: 'https://meta.linked.archi/basic/metamodel#Basic', label: 'Basic', kind: 'language' },
    ]);
  });

  it('keeps Basic in path order among the languages, after Backstage', () => {
    const languages = METAMODEL_CATALOGUE.filter((e) => e.kind === 'language').map((e) => e.label);
    expect(languages.indexOf('Basic')).toBe(languages.indexOf('Backstage Catalog') + 1);
  });

  it('names every metamodel once', () => {
    const iris = METAMODEL_CATALOGUE.map((e) => e.iri);
    expect(new Set(iris).size).toBe(iris.length);
  });

  it('still starts with the core metamodel', () => {
    expect(METAMODEL_CATALOGUE[0]).toMatchObject({
      iri: 'https://meta.linked.archi/core/metamodel#Core',
      kind: 'core',
    });
  });

  it('has a section title for every kind it uses', () => {
    for (const entry of METAMODEL_CATALOGUE) {
      expect(CATALOGUE_KIND_LABELS[entry.kind], entry.iri).toBeTruthy();
    }
  });
});
