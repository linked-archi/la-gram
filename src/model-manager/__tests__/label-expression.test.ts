import { describe, it, expect } from 'vitest';
import { labelFromExpression, parseLabelExpression, type LabelSource, type LabelValue } from '../label-expression.js';

const EX = 'https://example.org/model/';
const AM = 'https://meta.linked.archi/archimate4/onto#';
const DCT = 'http://purl.org/dc/terms/';

/** A small model: a component, its owner, what serves it. */
function source(): LabelSource {
  const triples: Array<[string, string, LabelValue]> = [
    [EX + 'payments', DCT + 'creator', { literal: 'Ana' }],
    [EX + 'payments', DCT + 'description', { literal: 'Takes payments', language: 'en' }],
    [EX + 'payments', DCT + 'description', { literal: 'Nimmt Zahlungen', language: 'de' }],
    [EX + 'payments', AM + 'realizes', { iri: EX + 'checkout' }],
    [EX + 'payments', AM + 'realizes', { iri: EX + 'refunds' }],
    [EX + 'gateway', AM + 'serves', { iri: EX + 'payments' }],
    [EX + 'gateway', DCT + 'creator', { literal: 'Bo' }],
  ];
  const names: Record<string, string> = { payments: 'Payments', checkout: 'Checkout', gateway: 'Gateway' };
  return {
    values: (s, p) => triples.filter(([ts, tp]) => ts === s && tp === p).map(([, , o]) => o),
    subjectsOf: (o, p) => triples.filter(([, tp, to]) => tp === p && 'iri' in to && to.iri === o).map(([s]) => s),
    nameOf: (iri) => names[iri.slice(EX.length)],
    typeOf: (iri) => (iri === EX + 'payments' ? 'Application Component' : undefined),
    prefixes: { am4: AM, dcterms: DCT },
  };
}

const label = (expression: string, subject = EX + 'payments') => labelFromExpression(expression, subject, source());

describe('a label expression', () => {
  it('its name and type; text as it is; a brace written twice', () => {
    expect(label('{name} «{type}»')).toBe('Payments «Application Component»');
    expect(label('{{not a placeholder}} {name}')).toBe('{not a placeholder} Payments');
  });

  it('a property’s values: a literal as it is — in the language shown — a resource by its name, else its local name', () => {
    expect(label('by {dcterms:creator}')).toBe('by Ana');
    expect(label('{dcterms:description}')).toBe('Takes payments');
    expect(label('{am4:realizes}')).toBe('Checkout, refunds');
    expect(label(`{<${DCT}creator>}`)).toBe('Ana');
  });

  it('a path, followed on — and backwards with ^', () => {
    expect(label('served by {^am4:serves}')).toBe('served by Gateway');
    expect(label('{^am4:serves/dcterms:creator}')).toBe('Bo');
  });

  it('its lines; one whose placeholders all come to nothing left out', () => {
    expect(label('{name}\nowner: {dcterms:creator}\nnotes: {dcterms:subject}')).toBe('Payments\nowner: Ana');
    expect(label('{name}\n(application)')).toBe('Payments\n(application)');
  });

  it('a placeholder it cannot read drawn as written — and said what is wrong', () => {
    const parsed = parseLabelExpression('{name} {nope:x} {name/} {} {dcterms:creator/}', { dcterms: DCT });
    expect(parsed.errors).toEqual([
      '{nope:x}: no prefix nope: is known',
      '{name/}: name stands alone, not in a path',
      '{}: nothing between the braces',
      '{dcterms:creator/}: a path ending with /',
    ]);
    expect(label('{name} {nope:x}')).toBe('Payments {nope:x}');
    // Never closed: text.
    expect(label('{name} {dcterms:creator')).toBe('Payments {dcterms:creator');
  });
});
