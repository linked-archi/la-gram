/**
 * Bands (ELK task, R4): read from the list a loaded metamodel's manifest names with
 * `arch:diagramGroupOrder`, and given to elements of no band from what they hold or are related to; and
 * *Arrange view…*'s remembered settings.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { DataFactory, Parser } from 'n3';
import type { Quad } from '@rdfjs/types';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { fetchAssetText } from '../../metamodel-manager/bundled-assets.js';
import { DIAGRAM_GROUP_ORDER, bandsOf, withNeighbourBands } from '../bands.js';
import { ARRANGE_DEFAULTS, arrangeSettings, rememberArrangeSettings } from '../../ui/arrange-settings.js';

const TAXONOMY = `
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix arch: <https://meta.linked.archi/core#> .
@prefix am4:  <https://meta.linked.archi/archimate4/onto#> .
@prefix :     <https://meta.linked.archi/archimate4/tax#> .
:Domain a skos:Concept .
:BusinessDomain a skos:Concept ; skos:broader :Domain ; skos:narrower am4:BusinessActor, :BusinessExtras .
:BusinessExtras a skos:Concept ; skos:narrower am4:BusinessObject .
:ApplicationDomain a skos:Concept ; skos:broader :Domain ; skos:narrower am4:ApplicationComponent .
:TechnologyDomain a skos:Concept ; skos:narrower am4:Node .
am4:Device skos:broader :TechnologyDomain .
:CommonDomain a skos:Concept ; skos:broader :Domain ; skos:narrower am4:Process .
:Bands a skos:OrderedCollection ;
    skos:memberList ( :BusinessDomain :ApplicationDomain :TechnologyDomain ) .
`;

/** The manifest, in a graph of its own: the list it points to is in the taxonomy's. */
const MANIFEST = `<https://meta.linked.archi/archimate4/metamodel#ArchiMate4> <${DIAGRAM_GROUP_ORDER}> <https://meta.linked.archi/archimate4/tax#Bands> .`;

/** Each document in the graph named after it, as the loader keeps them. */
function storeWith(...documents: Array<[graph: string, turtle: string]>): OxigraphRdfStore {
  const store = new OxigraphRdfStore();
  for (const [graphIri, turtle] of documents) {
    const graph = DataFactory.namedNode(graphIri);
    store.addQuads(new Parser().parse(turtle).map((q) => DataFactory.quad(q.subject, q.predicate, q.object, graph) as unknown as Quad));
  }
  return store;
}
const TAX_GRAPH = 'https://meta.linked.archi/archimate4/tax#';
const MANIFEST_GRAPH = 'https://meta.linked.archi/archimate4/metamodel#';

describe('bands from a loaded metamodel', () => {
  it("each type of a listed group — at any depth, narrower or broader — in its group's band; a group not listed gives none", () => {
    const AM4 = 'https://meta.linked.archi/archimate4/onto#';
    const bands = bandsOf(storeWith([TAX_GRAPH, TAXONOMY], [MANIFEST_GRAPH, MANIFEST]));
    expect(bands.get(`${AM4}BusinessActor`)).toBe(0);
    expect(bands.get(`${AM4}BusinessObject`)).toBe(0);
    expect(bands.get(`${AM4}ApplicationComponent`)).toBe(1);
    expect(bands.get(`${AM4}Node`)).toBe(2);
    expect(bands.get(`${AM4}Device`)).toBe(2);
    expect(bands.has(`${AM4}Process`)).toBe(false);
  });

  it('none when no manifest points to a list — a list alone is not an order', () => {
    expect(bandsOf(storeWith([TAX_GRAPH, TAXONOMY])).size).toBe(0);
  });

  it("ArchiMate 3.2's: motivation, an aspect, above the layers; strategy elements in the Strategy layer's band, physical ones in the Technology layer's", async () => {
    const AM = 'https://meta.linked.archi/archimate3/onto#';
    const bands = bandsOf(
      storeWith(
        ['https://meta.linked.archi/archimate3/tax#', await fetchAssetText('archimate3/archimate3.2-tax.ttl')],
        ['https://meta.linked.archi/archimate3/metamodel#', await fetchAssetText('archimate3/archimate3.2-metamodel.ttl')],
      ),
    );
    expect(['Stakeholder', 'Capability', 'BusinessActor', 'ApplicationComponent', 'Node', 'Equipment', 'WorkPackage'].map((t) => bands.get(AM + t))).toEqual([
      0, 1, 2, 3, 4, 4, 5,
    ]);
    expect(bands.has(AM + 'Grouping')).toBe(false);
  });

  it("ArchiMate 4.0's: motivation and strategy on top; the Common Domain's elements in no band", async () => {
    const AM4 = 'https://meta.linked.archi/archimate4/onto#';
    const bands = bandsOf(
      storeWith(
        [TAX_GRAPH, await fetchAssetText('archimate4/archimate4-tax.ttl')],
        [MANIFEST_GRAPH, await fetchAssetText('archimate4/archimate4-metamodel.ttl')],
      ),
    );
    expect(['Goal', 'Capability', 'BusinessActor', 'ApplicationComponent', 'Node', 'WorkPackage'].map((t) => bands.get(AM4 + t))).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect(bands.has(AM4 + 'Process')).toBe(false);
  });
});

describe('an element of no band', () => {
  it('takes the band most of what it holds is in, else most of what it is related to — the upper on a tie', () => {
    const filled = withNeighbourBands({
      nodes: [
        { id: 'actor', width: 1, height: 1, band: 0 },
        { id: 'app', width: 1, height: 1, band: 1 },
        { id: 'app2', width: 1, height: 1, band: 1 },
        { id: 'process', width: 1, height: 1 },
        { id: 'tied', width: 1, height: 1 },
        { id: 'group', width: 1, height: 1 },
        { id: 'inGroup', width: 1, height: 1, band: 1, parent: 'group' },
        { id: 'chained', width: 1, height: 1 },
        { id: 'alone', width: 1, height: 1 },
      ],
      edges: [
        { id: 'e1', source: 'actor', target: 'process' },
        { id: 'e2', source: 'app', target: 'process' },
        { id: 'e3', source: 'app2', target: 'process' },
        { id: 'e4', source: 'actor', target: 'tied' },
        { id: 'e5', source: 'app', target: 'tied' },
        { id: 'e6', source: 'process', target: 'chained' },
      ],
    });
    const band = (id: string) => filled.nodes.find((n) => n.id === id)!.band;
    expect(band('process')).toBe(1);
    expect(band('tied')).toBe(0);
    expect(band('group')).toBe(1);
    expect(band('chained')).toBe(1);
    expect(band('alone')).toBeUndefined();
  });
});

describe("Arrange view's settings", () => {
  afterEach(() => globalThis.localStorage?.clear?.());

  it('are remembered, each checked; the defaults otherwise', () => {
    const storage = new Map<string, string>();
    const fake = { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), clear: () => storage.clear() };
    const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true });
    try {
      expect(arrangeSettings()).toEqual(ARRANGE_DEFAULTS);
      rememberArrangeSettings({ direction: 'RIGHT', spacing: 'roomy', bands: false });
      expect(arrangeSettings()).toEqual({ direction: 'RIGHT', spacing: 'roomy', bands: false });
      storage.set('la-gram:arrange-view', JSON.stringify({ direction: 'SIDEWAYS', spacing: 'roomy' }));
      expect(arrangeSettings()).toEqual({ direction: 'DOWN', spacing: 'roomy', bands: true });
    } finally {
      if (real) Object.defineProperty(globalThis, 'localStorage', real);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
