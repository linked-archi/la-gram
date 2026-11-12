/**
 * Copy and paste on the canvas (`canvas-clipboard.ts`; the copy-paste task's R1–R13): the copy, cut and paste
 * events, the forced modes, duplicate, where a paste goes, and what it says.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataFactory, Parser } from 'n3';
import type { NamedNode } from '@rdfjs/types';
import { OxigraphRdfStore } from '../../../rdf-engine/rdf-store.js';
import { ObservableRdfStore } from '../../../rdf-engine/observable-store.js';
import { NAMESPACES } from '../../../rdf-engine/namespaces.js';
import { OxigraphElementManager } from '../../../model-manager/element-manager.js';
import { OxigraphRelationshipManager } from '../../../model-manager/relationship-manager.js';
import { OxigraphViewManager } from '../../../model-manager/view-manager.js';
import { CLIPBOARD_MIME, copyFromView, writeFragment, type PasteResult } from '../../../model-manager/clipboard.js';
import { T, langLiteral, nn, triple } from '../../../model-manager/vocabulary.js';
import { CanvasClipboard, PASTE_STEP, pasteMessage, type CanvasClipboardHost } from '../canvas-clipboard.js';

const MODEL = 'https://model.example.com/m/model';
const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const COMPONENT = `${AM4}ApplicationComponent`;
const box = (x: number, y: number) => ({ x, y, width: 120, height: 55 });

/** A clipboard event's data, as the browser gives it. */
class FakeData {
  readonly items = new Map<string, string>();
  setData(type: string, value: string): void {
    this.items.set(type, value);
  }
  getData(type: string): string {
    return this.items.get(type) ?? '';
  }
}
function clipboardEvent(data = new FakeData(), path: unknown[] = []) {
  return { clipboardData: data, composedPath: () => path, preventDefault: vi.fn() } as unknown as ClipboardEvent & { preventDefault: ReturnType<typeof vi.fn> };
}

let store: ObservableRdfStore;
let views: OxigraphViewManager;
let elements: OxigraphElementManager;
let relationships: OxigraphRelationshipManager;
let a: string, b: string, rel: string, v1: string, v2: string;
let open: string;
let selected: string[];
let pointer: { x: number; y: number } | undefined;
let host: CanvasClipboardHost & { notices: Array<[string, string]>; selectedNow: string[]; removed: number };
let clipboard: CanvasClipboard;

const nodeOf = (view: string, element: string) => views.getNodes(view).find((n) => n.elementIri === element)!.nodeIri;

beforeEach(() => {
  store = new ObservableRdfStore(new OxigraphRdfStore());
  elements = new OxigraphElementManager(store);
  relationships = new OxigraphRelationshipManager(store);
  views = new OxigraphViewManager(store);
  a = elements.createElement(COMPONENT, MODEL, { label: 'A' }).value;
  b = elements.createElement(COMPONENT, MODEL, { label: 'B' }).value;
  store.addQuads([triple(nn(a), nn(NAMESPACES.dcterms + 'identifier'), DataFactory.literal('APP-1') as unknown as NamedNode)]);
  rel = relationships.createQualifiedRelationship({ typeIri: `${AM4}Serving`, predicateIri: `${AM4}serves`, sourceIri: a, targetIri: b, modelIri: MODEL }).iri;
  v1 = views.createView('Diagram', undefined, { modelIri: MODEL }).value;
  v2 = views.createView('Diagram', undefined, { modelIri: MODEL }).value;
  views.addElementToView(v1, a, box(100, 100));
  views.addElementToView(v1, b, box(300, 100));
  views.addRelationshipToView(v1, rel);
  open = v1;
  selected = [nodeOf(v1, a), nodeOf(v1, b)];
  pointer = undefined;
  host = {
    notices: [],
    selectedNow: [],
    removed: 0,
    target: () => ({ viewIri: open, modelIri: MODEL, deps: { store, elements, relationships, views } }),
    selectedPlacements: () => selected,
    pointer: () => pointer,
    record: (apply) => {
      apply();
      return true;
    },
    selectPlacements: (iris) => {
      host.selectedNow = [...iris];
    },
    removeSelectionFromView: () => {
      host.removed++;
    },
    notice: (message, level) => {
      host.notices.push([message, level]);
    },
  };
  clipboard = new CanvasClipboard(host, {
    source: () => ({ metamodelIris: [], version: '0.2.0' }),
    prefixes: () => ({ am4: AM4, skos: NAMESPACES.skos }),
  });
});

describe('copy and cut (R1–R4)', () => {
  it("writes la-gram's copy and its Turtle to the copy event, and keeps it in the window", () => {
    const event = clipboardEvent();
    clipboard.onCopyEvent(event);
    expect(event.preventDefault).toHaveBeenCalled();
    const data = event.clipboardData as unknown as FakeData;
    expect(JSON.parse(data.getData(CLIPBOARD_MIME)).concepts).toHaveLength(3);
    expect(() => new Parser({ format: 'text/turtle' }).parse(data.getData('text/plain'))).not.toThrow();
    expect(data.getData('text/plain')).toContain('am4:ApplicationComponent');
    expect(clipboard.canPaste()).toBe(true);
  });

  it('leaves a text field its own copy, and copies nothing with nothing selected', () => {
    const fromField = clipboardEvent(new FakeData(), [{ tagName: 'INPUT' }]);
    clipboard.onCopyEvent(fromField);
    expect(fromField.preventDefault).not.toHaveBeenCalled();
    selected = [];
    const nothing = clipboardEvent();
    clipboard.onCopyEvent(nothing);
    expect(nothing.preventDefault).not.toHaveBeenCalled();
    expect(clipboard.canPaste()).toBe(false);
  });

  it('cut copies, then removes the selection from the view', () => {
    clipboard.onCopyEvent(clipboardEvent(), true);
    expect(host.removed).toBe(1);
    expect(clipboard.canPaste()).toBe(true);
  });

  it('from a menu, kept in the window where the browser fires no copy event', () => {
    expect(clipboard.copyFromMenu()).toBe(true);
    expect(clipboard.canPaste()).toBe(true);
  });
});

describe('paste (R5, R6, R10, R12)', () => {
  it('a paste event with la-gram\'s copy pastes it by the context: the same elements into another view', async () => {
    const source = { modelIri: MODEL, viewIri: v1, metamodelIris: [] };
    const data = new FakeData();
    data.setData(CLIPBOARD_MIME, writeFragment(copyFromView(store, views, source, selected)));
    open = v2;
    const event = clipboardEvent(data);
    clipboard.onPasteEvent(event);
    expect(event.preventDefault).toHaveBeenCalled();
    await vi.waitFor(() => expect(host.notices).toHaveLength(1));
    expect(host.notices[0]).toEqual(['Placed 2 elements and 1 relationship again.', 'info']);
    expect(views.getNodes(v2)).toHaveLength(2);
    expect(host.selectedNow).toHaveLength(3);
  });

  it('a paste event with anything else is left alone', () => {
    const data = new FakeData();
    data.setData('text/plain', 'some text');
    const event = clipboardEvent(data);
    clipboard.onPasteEvent(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('pasted again and again away from the pointer: 20 px further each time; at the pointer when it is over the diagram', async () => {
    clipboard.copy();
    open = v2;
    await clipboard.paste('copies');
    await clipboard.paste('copies');
    const xs = views.getNodes(v2).map((n) => n.bounds.x).sort((p, q) => p - q);
    expect(xs).toEqual([100 + PASTE_STEP, 100 + 2 * PASTE_STEP, 300 + PASTE_STEP, 300 + 2 * PASTE_STEP]);
    pointer = { x: 700, y: 500 };
    const result = (await clipboard.paste('copies'))!;
    const placed = views.getNodes(v2).filter((n) => result.nodes.includes(n.nodeIri));
    expect(Math.min(...placed.map((n) => n.bounds.x))).toBe(700);
  });

  it('the forced modes: copies into another view, references into this one', async () => {
    clipboard.copy();
    open = v2;
    expect((await clipboard.paste('copies'))!.elementsCopied).toBe(2);
    open = v1;
    expect((await clipboard.paste('references'))!.mode).toBe('references');
    expect(views.getNodes(v1).filter((n) => n.elementIri === a)).toHaveLength(2);
  });

  it('says there is nothing to paste before anything is copied', async () => {
    expect(await clipboard.paste('auto')).toBeUndefined();
    expect(host.notices[0][0]).toMatch(/^Nothing to paste/);
  });
});

describe('duplicate (R11)', () => {
  it('copies in this view, 20 px right and down, leaving the clipboard as it was', async () => {
    const result = (await clipboard.duplicate())!;
    expect(result).toMatchObject({ mode: 'copies', elementsCopied: 2, relationshipsCopied: 1 });
    const copyOfA = views.getNodes(v1).find((n) => n.elementIri === result.copied.get(a))!;
    expect(copyOfA.bounds).toMatchObject({ x: 100 + PASTE_STEP, y: 100 + PASTE_STEP });
    expect(clipboard.canPaste()).toBe(false);
    expect(host.notices[0]).toEqual(['Pasted 2 new elements and 1 new relationship; 1 property left out.', 'info']);
  });
});

describe('into another model (R9)', () => {
  it('asks about types no metamodel defines, and pastes nothing when the question is cancelled', async () => {
    const other = 'https://model.example.com/n/model';
    const otherView = views.createView('Diagram', undefined, { modelIri: other }).value;
    const ask = vi.fn(async () => null);
    const asking = new CanvasClipboard({ ...host, target: () => ({ viewIri: otherView, modelIri: other, deps: { store, elements, relationships, views } }) }, {
      source: () => ({ metamodelIris: [] }),
      prefixes: () => ({}),
      chooseUnknownTypes: ask,
    });
    const data = new FakeData();
    data.setData(CLIPBOARD_MIME, writeFragment(copyFromView(store, views, { modelIri: MODEL, viewIri: v1, metamodelIris: [] }, selected)));
    asking.onPasteEvent(clipboardEvent(data));
    await vi.waitFor(() => expect(ask).toHaveBeenCalledWith([COMPONENT]));
    expect(views.getNodes(otherView)).toEqual([]);
  });
});

describe('what a paste says (R12)', () => {
  const result = (over: Partial<PasteResult>): PasteResult => ({
    mode: 'copies',
    referencesImpossible: false,
    copied: new Map(),
    elementsCopied: 0,
    relationshipsCopied: 0,
    elementsPlaced: 0,
    relationshipsPlaced: 0,
    nodes: [],
    links: [],
    propertiesLeftOut: 0,
    notes: [],
    ...over,
  });

  it('what was pasted or placed, and what was left out or pasted otherwise, as a warning', () => {
    expect(pasteMessage(result({ elementsPlaced: 5, relationshipsPlaced: 4, nodes: ['1', '2', '3', '4', '5'], propertiesLeftOut: 3 }))).toEqual({
      message: 'Pasted 5 new elements and 4 new relationships; 3 properties left out.',
      warning: false,
    });
    expect(pasteMessage(result({ mode: 'references', elementsPlaced: 1, nodes: ['1', 'f'] })).message).toBe('Placed 1 element and 1 figure again.');
    const leftOut = pasteMessage(
      result({ elementsPlaced: 1, nodes: ['1'], referencesImpossible: true, notes: [{ iri: 'x', reason: 'not-permitted' }, { iri: 'y', reason: 'unknown-type' }] }),
    );
    expect(leftOut.warning).toBe(true);
    expect(leftOut.message).toBe(
      "Pasted 1 new element; copied from another model, so pasted as new; 2 left out: not permitted here; of types this model's metamodels do not define.",
    );
    expect(pasteMessage(result({})).message).toBe('Nothing pasted.');
  });
});

describe('the copy keeps a concept\'s names', () => {
  it('in every language', async () => {
    store.addQuads([triple(nn(a), T.prefLabel, langLiteral('A-fr', 'fr'))]);
    selected = [nodeOf(v1, a)];
    const result = (await clipboard.duplicate())!;
    expect(store.getQuads(nn(result.copied.get(a)!), T.prefLabel, null).map((q) => q.object.value).sort()).toEqual(['A', 'A-fr']);
  });
});

describe('from the model tree (R14)', () => {
  it('copies the concepts chosen and pastes them in sight, each at its notation\'s size, with the relationship between them', async () => {
    const sized = new CanvasClipboard(
      { ...host, sizeOf: () => ({ width: 150, height: 70 }), viewport: () => ({ x: 1000, y: 800, width: 900, height: 600 }) },
      { source: () => ({ metamodelIris: [] }), prefixes: () => ({}) },
    );
    const data = new FakeData();
    expect(sized.copyConcepts([a, b], data as unknown as DataTransfer)).toBe(true);
    expect(JSON.parse(data.getData(CLIPBOARD_MIME)).nodes).toEqual([]);
    open = v2;
    const result = (await sized.paste('auto'))!;
    expect(result).toMatchObject({ mode: 'references', elementsPlaced: 2, relationshipsPlaced: 1 });
    const bounds = views.getNodes(v2).map((n) => n.bounds).sort((p, q) => p.x - q.x);
    expect(bounds[0]).toEqual({ x: 1000 + 3 * PASTE_STEP, y: 800 + 3 * PASTE_STEP, width: 150, height: 70 });
  });

  it("the tree's Copy goes through the copy event when the browser fires one, whatever has the focus", () => {
    const tree = new CanvasClipboard(host, { source: () => ({ metamodelIris: [] }), prefixes: () => ({}) });
    const event = clipboardEvent();
    const execCommand = vi.fn(() => {
      expect(tree.copyingConcepts()).toBe(true);
      tree.onCopyEvent(event);
      return true;
    });
    const doc = globalThis.document as unknown;
    (globalThis as { document?: unknown }).document = { execCommand };
    try {
      expect(tree.copyConceptsFromMenu([a])).toBe(true);
    } finally {
      (globalThis as { document?: unknown }).document = doc;
    }
    expect(event.preventDefault).toHaveBeenCalled();
    expect(JSON.parse((event.clipboardData as unknown as FakeData).getData(CLIPBOARD_MIME)).concepts).toEqual([a]);
    expect(tree.copyingConcepts()).toBe(false);
  });
});
