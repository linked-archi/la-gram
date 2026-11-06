// @vitest-environment jsdom
/**
 * Catalog and matrix views driven by the view's own membership (`arch:inView`):
 * a catalog lists, and a matrix indexes, the elements the view presents.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OxigraphRdfStore } from '../../../rdf-engine/rdf-store.js';
import { OxigraphViewManager } from '../../../model-manager/view-manager.js';
import { OxigraphElementManager } from '../../../model-manager/element-manager.js';
import { OxigraphRelationshipManager } from '../../../model-manager/relationship-manager.js';
import { N3TtlParser } from '../../../rdf-engine/ttl-parser.js';
import { N3MetamodelLoader } from '../../../metamodel-manager/metamodel-loader.js';
import { addableTypes, elementsOfType, viewMembers } from '../view-members.js';
import '../catalog-view.js';
import '../matrix-view.js';
import type { CatalogView } from '../catalog-view.js';
import type { MatrixView } from '../matrix-view.js';

const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const MODEL = 'https://example.org/model/m';

let store: OxigraphRdfStore;
let views: OxigraphViewManager;
let elements: OxigraphElementManager;
let actorA: string;
let actorB: string;
let process1: string;

beforeEach(async () => {
  store = new OxigraphRdfStore();
  await new N3MetamodelLoader(new N3TtlParser(), store).loadBundledMetamodel('archimate4');
  views = new OxigraphViewManager(store);
  elements = new OxigraphElementManager(store);
  actorA = elements.createElement(AM4 + 'BusinessActor', MODEL, { label: 'Sales' }).value;
  actorB = elements.createElement(AM4 + 'BusinessActor', MODEL, { label: 'Billing' }).value;
  process1 = elements.createElement(AM4 + 'Process', MODEL, { label: 'Order Handling' }).value;
  new OxigraphRelationshipManager(store).createQualifiedRelationship({
    typeIri: AM4 + 'Assignment',
    sourceIri: actorA,
    targetIri: process1,
    modelIri: MODEL,
  });
}, 60_000);

afterEach(() => {
  document.body.innerHTML = '';
  store.dispose();
});

const label = (typeIri: string) => typeIri.slice(typeIri.indexOf('#') + 1);

describe('view membership', () => {
  it('adds, lists and removes members without geometry', () => {
    const catalog = views.createView('Catalog', undefined, { modelIri: MODEL }).value;
    views.addMember(catalog, actorA);
    views.addMember(catalog, actorA);
    expect(views.getMembers(catalog)).toEqual([actorA]);
    expect(viewMembers(store.getQuads(), catalog).map((m) => m.label)).toEqual(['Sales']);
    views.removeMember(catalog, actorA);
    expect(views.getMembers(catalog)).toEqual([]);
  });

  it('offers the model’s element types to add, with what the view already holds', () => {
    const catalog = views.createView('Catalog', undefined, { modelIri: MODEL }).value;
    views.addMember(catalog, actorA);
    const types = addableTypes(store.getQuads(), catalog).sort((a, b) => a.typeIri.localeCompare(b.typeIri));
    expect(types).toEqual([
      { typeIri: AM4 + 'BusinessActor', count: 2, inView: 1 },
      { typeIri: AM4 + 'Process', count: 1, inView: 0 },
    ]);
    expect(elementsOfType(store.getQuads(), AM4 + 'BusinessActor').sort()).toEqual([actorA, actorB].sort());
  });
});

describe('catalog-view on a catalog view', () => {
  async function mount(viewIri: string): Promise<CatalogView> {
    const view = document.createElement('catalog-view');
    view.rdfStore = store;
    view.viewManager = views;
    view.typeLabelOf = label;
    view.viewIri = viewIri;
    document.body.appendChild(view);
    await view.updateComplete;
    return view;
  }
  const typeHeaders = (view: CatalogView) =>
    [...view.shadowRoot!.querySelectorAll('.type-header')].map((h) => h.textContent!.trim());

  it('lists its members, one table per type, and adds a type’s elements from the picker', async () => {
    const catalog = views.createView('Catalog', undefined, { modelIri: MODEL }).value;
    views.addMember(catalog, process1);
    const view = await mount(catalog);
    expect(typeHeaders(view)).toEqual(['Process (1)']);
    // No structural columns: membership and the model are not properties.
    const columns = [...view.shadowRoot!.querySelectorAll('th')].map((th) => th.textContent!.trim());
    expect(columns).not.toContain('inView');
    expect(columns).not.toContain('inModel');

    let changed = 0;
    view.addEventListener('view-members-change', () => changed++);
    const select = view.shadowRoot!.querySelector<HTMLSelectElement>('.view-add select')!;
    expect([...select.options].map((o) => o.textContent!.trim())).toEqual(['elements of a type…', 'BusinessActor (2)']);
    select.value = AM4 + 'BusinessActor';
    select.dispatchEvent(new Event('change'));
    await view.updateComplete;
    expect(typeHeaders(view)).toEqual(['BusinessActor (2)', 'Process (1)']);
    expect(views.getMembers(catalog).sort()).toEqual([actorA, actorB, process1].sort());
    expect(changed).toBe(1);
  });

  it('takes an element out of the catalog, not out of the model', async () => {
    const catalog = views.createView('Catalog', undefined, { modelIri: MODEL }).value;
    views.addMember(catalog, actorA);
    const view = await mount(catalog);
    view.shadowRoot!.querySelector<HTMLButtonElement>('td.row-actions button')!.click();
    await view.updateComplete;
    expect(views.getMembers(catalog)).toEqual([]);
    expect(store.getQuads().some((q) => q.subject.value === actorA)).toBe(true);
    expect(view.shadowRoot!.querySelector('.empty-message')?.textContent).toContain('lists no elements yet');
  });
});

describe('matrix-view on a matrix view', () => {
  it('indexes its members — rows and columns the two most common types — and shows the relationship', async () => {
    const matrix = views.createView('Matrix', undefined, { modelIri: MODEL }).value;
    for (const e of [actorA, actorB, process1]) views.addMember(matrix, e);
    const view = document.createElement('matrix-view') as MatrixView;
    view.rdfStore = store;
    view.viewManager = views;
    view.typeLabelOf = label;
    view.viewIri = matrix;
    document.body.appendChild(view);
    await view.updateComplete;

    const rows = [...view.shadowRoot!.querySelectorAll('th.row-header')].map((th) => th.textContent!.trim());
    const columns = [...view.shadowRoot!.querySelectorAll('th.col-header')].map((th) => th.textContent!.trim());
    expect(rows).toEqual(['Billing', 'Sales']);
    expect(columns).toEqual(['Order Handling']);
    const filled = [...view.shadowRoot!.querySelectorAll('td.has-relationship')].map((td) => td.textContent!.trim());
    expect(filled).toHaveLength(1);
  });
});
