// @vitest-environment jsdom

/**
 * Two views at once (Req 24; `.agents/tasks/split-view/`), end to end: the real `createApp()` mounted by the real
 * `mountUi()`, split from the toolbar's command, the panes pressed as a modeller presses them.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createApp, type App } from '../app.js';
import { mountUi, type MountedUi } from '../ui/mount-ui.js';
import type { Dialogs } from '../ui/dialogs.js';
import { installJsdomSvgSupport } from '../ui/__tests__/jsdom-svg-support.js';
import type { DiagramCanvas } from '../ui/canvas/diagram-canvas.js';

installJsdomSvgSupport();

const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const MARKER = 'la-selected-elsewhere';
const SKOS_PREF_LABEL = 'http://www.w3.org/2004/02/skos/core#prefLabel';

let app: App;
let ui: MountedUi;

beforeAll(async () => {
  app = await createApp({ assetMode: 'offline', validationDelayMs: 0 });
  const dialogs: Dialogs = {
    prompt: vi.fn(async () => null),
    form: vi.fn(async () => null),
    confirm: vi.fn(async () => true),
    choose: vi.fn(async () => null),
    info: vi.fn(async () => undefined),
    toast: vi.fn(),
  };
  const root = document.createElement('div');
  document.body.append(root);
  ui = mountUi(app, root, { dialogs, pickFile: async () => null, saveFile: () => undefined });
  app.announceLoadedMetamodel();
}, 60_000);

afterAll(() => ui.dispose());

/** After the task that changed the model: the other pane is brought up to date then (SV-DD-2). */
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const press = (element: Element) => element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
const keysOf = (canvas: DiagramCanvas) =>
  (canvas.getDiagram() as unknown as { get(name: string): { getBinding(): unknown } }).get('keyboard').getBinding();
const marked = (canvas: DiagramCanvas, iri: string, marker = MARKER): boolean => {
  const diagram = canvas.getDiagram() as unknown as { get(name: string): unknown };
  const registry = diagram.get('elementRegistry') as { getAll(): Array<{ businessObject?: { iri?: string } }> };
  const djs = diagram.get('canvas') as { hasMarker(element: unknown, marker: string): boolean };
  const shapes = registry.getAll().filter((e) => e.businessObject?.iri === iri);
  return shapes.length > 0 && shapes.every((s) => djs.hasMarker(s, marker));
};

/** An element of the model, placed in `viewIri`. */
const placed = (viewIri: string, label: string, x = 100): string => {
  const iri = app.components.elementManager.createElement(`${AM4}ApplicationComponent`, app.session.modelIri!, { label }).value;
  app.components.viewManager.addElementToView(viewIri, iri, { x, y: 100, width: 120, height: 55 });
  app.components.eventBus.emit('model-changed', { origin: 'test' });
  return iri;
};

describe('two views at once (Req 24)', () => {
  let main: string;
  let detail: string;
  let shared: string;

  it('splits side by side: a second pane on the same view, in use, each pane its own canvas (SV-1, SV-6)', async () => {
    main = app.session.activeViewIri!;
    app.session.renameView(main, 'Main');
    shared = placed(main, 'Web Shop');
    expect(ui.panes()).toHaveLength(1);
    expect(ui.appToolbar.split).toBe('');
    // One pane: no header shown, nothing marked in use.
    expect(document.querySelector('.la-panes')!.getAttribute('data-split')).toBe('none');

    await ui.runCommand({ command: 'split', value: 'side-by-side' });
    const [first, second] = ui.panes();
    expect(ui.panes()).toHaveLength(2);
    expect(ui.splitOrientation()).toBe('side-by-side');
    expect(ui.appToolbar.split).toBe('side-by-side');
    expect(first!.viewIri).toBe(main);
    expect(second!.viewIri).toBe(main);
    expect(second!.inUse).toBe(true);
    expect(ui.diagramCanvas).toBe(second!.canvas);
    expect(first!.canvas).not.toBe(second!.canvas);
    // Each draws the view.
    expect(first!.canvas.getElement(shared)).toBeDefined();
    expect(second!.canvas.getElement(shared)).toBeDefined();
    // Headers: the view's name; the pane in use marked.
    expect([...document.querySelectorAll('.la-pane-title')].map((t) => t.textContent)).toEqual(['Main', 'Main']);
    expect(second!.element.classList.contains('la-pane-in-use')).toBe(true);
    expect(first!.element.classList.contains('la-pane-in-use')).toBe(false);
    // Only the pane in use takes the keys (SV-DD-2).
    expect(keysOf(second!.canvas)).toBe(document);
    expect(keysOf(first!.canvas)).toBeFalsy();
  });

  it('opens a view in the pane in use; pressing the other puts it in use, with its view, history and keys (SV-3)', async () => {
    detail = app.session.createView('Diagram', { label: 'Detail', open: false });
    await ui.runCommand({ command: 'open-view', value: detail });
    let [first, second] = ui.panes();
    expect(second!.viewIri).toBe(detail);
    expect(first!.viewIri).toBe(main);
    expect(app.session.activeViewIri).toBe(detail);
    expect(ui.appToolbar.activeViewIri).toBe(detail);
    // Its own history: back to Main.
    expect(ui.appToolbar.backLabel).toBe('Main');
    expect(document.querySelectorAll('.la-pane-title')[1]!.textContent).toBe('Detail');

    const drawn = first!.canvas.getDiagram();
    press(first!.element);
    [first, second] = ui.panes();
    expect(first!.inUse).toBe(true);
    expect(app.session.activeViewIri).toBe(main);
    expect(ui.appToolbar.activeViewIri).toBe(main);
    expect(ui.diagramCanvas).toBe(first!.canvas);
    // Drawn already: the same diagram, not drawn again.
    expect(first!.canvas.getDiagram()).toBe(drawn);
    expect(first!.canvas.getElement(shared)).toBeDefined();
    // The first pane's history has nothing before Main.
    expect(ui.appToolbar.backLabel).toBe('');
    expect(keysOf(first!.canvas)).toBe(document);
    expect(keysOf(second!.canvas)).toBeFalsy();
    expect(first!.element.classList.contains('la-pane-in-use')).toBe(true);
  });

  it('shows a change in both panes at once, and the events about the open view only in its own (SV-7, SV-DD-2)', async () => {
    const [first, second] = ui.panes();
    // The second pane on Main too.
    press(second!.element);
    await ui.runCommand({ command: 'open-view', value: main });
    press(first!.element);
    expect(ui.panes().map((p) => p.viewIri)).toEqual([main, main]);

    // Added to the view in the store: drawn in the pane in use at once, in the other after the task.
    const added = placed(main, 'Payments', 400);
    expect(first!.canvas.getElement(added)).toBeDefined();
    await settled();
    expect(second!.canvas.getElement(added)).toBeDefined();

    // Renamed: both panes say so.
    // Renamed as the property panel renames: the App writes it and says so.
    app.components.eventBus.emit('property-edited', { elementIri: added, property: SKOS_PREF_LABEL, value: 'Payments Hub', language: 'en' });
    await settled();
    expect(second!.canvas.getElement(added)?.label).toBe('Payments Hub');

    // A palette drop goes into the open view, Main, in the pane in use; the other pane, on Detail, does not draw it.
    press(second!.element);
    await ui.runCommand({ command: 'open-view', value: detail });
    press(first!.element);
    app.components.eventBus.emit('palette-drag', { typeIri: `${AM4}ApplicationService`, modelIri: app.session.modelIri, x: 50, y: 300 });
    await settled();
    const dropped = app.components.viewManager.getNodes(main).map((n) => n.elementIri).find((iri) => ![shared, added].includes(iri))!;
    expect(first!.canvas.getElement(dropped)).toBeDefined();
    expect(second!.canvas.getElement(dropped)).toBeUndefined();
    expect(app.components.viewManager.getNodes(detail)).toHaveLength(0);

    // Deleted from the model: gone from both.
    app.components.elementManager.deleteElement(added);
    app.components.eventBus.emit('element-deleted', { iri: added, elementIri: added });
    app.components.eventBus.emit('model-changed', { origin: 'test' });
    await settled();
    expect(first!.canvas.getElement(added)).toBeUndefined();
  });

  it('outlines in the other pane what is selected in the pane in use — until Sync selection is off (SV-8)', async () => {
    const [first, second] = ui.panes();
    press(second!.element);
    await ui.runCommand({ command: 'open-view', value: main });
    press(first!.element);
    first!.canvas.selectIris([shared]);
    expect(ui.propertyPanel.selectedIri).toBe(shared);
    expect(marked(second!.canvas, shared)).toBe(true);
    // Never in the pane in use itself.
    expect(marked(first!.canvas, shared)).toBe(false);

    // The other pane in use: its own selection (none) shown, and the marks go the other way.
    press(second!.element);
    expect(marked(second!.canvas, shared)).toBe(false);
    second!.canvas.selectIris([shared]);
    expect(marked(first!.canvas, shared)).toBe(true);

    await ui.runCommand({ command: 'split', value: 'sync-selection' });
    expect(ui.appToolbar.syncSelection).toBe(false);
    expect(marked(first!.canvas, shared)).toBe(false);
    await ui.runCommand({ command: 'split', value: 'sync-selection' });
    expect(ui.appToolbar.syncSelection).toBe(true);
    expect(marked(first!.canvas, shared)).toBe(true);
    second!.canvas.selectIris([]);
  });

  it('turns the panes one above the other, and closes the pane not in use (SV-1)', async () => {
    await ui.runCommand({ command: 'split', value: 'stacked' });
    expect(ui.splitOrientation()).toBe('stacked');
    expect(document.querySelector('.la-panes')!.getAttribute('data-split')).toBe('stacked');
    const inUse = ui.panes().find((p) => p.inUse)!;
    await ui.runCommand({ command: 'split', value: 'close' });
    expect(ui.panes()).toHaveLength(1);
    expect(ui.panes()[0]!.canvas).toBe(inUse.canvas);
    expect(ui.appToolbar.split).toBe('');
    expect(ui.panes()[0]!.element.classList.contains('la-pane-in-use')).toBe(false);
    // Its keys still bound: the one canvas takes them.
    expect(keysOf(inUse.canvas)).toBe(document);
  });

  it('opens a view beside from the model tree and from a view reference, splitting first (SV-5)', async () => {
    ui.modelExplorer.dispatchEvent(new CustomEvent('explorer-action', { detail: { action: 'open-view-beside', iri: detail, kind: 'view' } }));
    await vi.waitFor(() => expect(ui.panes()).toHaveLength(2));
    await settled();
    let [first, second] = ui.panes();
    expect(first!.viewIri).toBe(main);
    expect(second!.viewIri).toBe(detail);
    expect(second!.inUse).toBe(true);

    // From a reference in Main: into the pane not in use, which is put in use.
    press(first!.element);
    app.components.eventBus.emit('open-referenced-view', { nodeIri: 'urn:n', viewIri: detail, beside: true });
    await settled();
    [first, second] = ui.panes();
    expect(second!.inUse).toBe(true);
    expect(second!.viewIri).toBe(detail);
    expect(first!.viewIri).toBe(main);
  });

  it('closes the pane of a view deleted, and a pane by its ×, leaving the other in use (SV-4, SV-7)', async () => {
    const extra = app.session.createView('Diagram', { label: 'Extra', open: false });
    const [first, second] = ui.panes();
    await ui.runCommand({ command: 'open-view', value: extra });
    press(first!.element);
    app.session.deleteView(extra);
    await settled();
    expect(ui.panes()).toHaveLength(1);
    expect(ui.panes()[0]!.canvas).toBe(first!.canvas);
    expect(second!.element.isConnected).toBe(false);

    // Split again, and close the pane in use by its ×: the first stays, in use.
    await ui.runCommand({ command: 'split', value: 'side-by-side' });
    const [one, two] = ui.panes();
    expect(two!.inUse).toBe(true);
    two!.element.querySelector<HTMLButtonElement>('.la-pane-close')!.click();
    expect(ui.panes()).toHaveLength(1);
    expect(ui.panes()[0]!.canvas).toBe(one!.canvas);
    expect(ui.panes()[0]!.inUse).toBe(true);
    expect(app.session.activeViewIri).toBe(one!.viewIri);
  });

  it('shows a catalog in a pane, the canvas toolbar only over a diagram in use (SV-6)', async () => {
    const catalog = app.session.createView('Catalog', { label: 'Inventory', open: false });
    await ui.openBeside(catalog);
    const [first, second] = ui.panes();
    expect(second!.kind).toBe('catalog');
    expect(second!.element.querySelector('catalog-view')!.hidden).toBe(false);
    expect(second!.element.querySelector<HTMLElement>('.la-diagram-host')!.hidden).toBe(true);
    expect(ui.canvasToolbar.hidden).toBe(true);
    expect(document.querySelectorAll('.la-pane-title')[1]!.textContent).toBe('Inventory (catalog)');
    press(first!.element);
    expect(ui.canvasToolbar.hidden).toBe(false);
    expect(ui.activeCanvasView()).toBe('diagram');
    // Sync selection: the catalog marks the row of what the diagram in use has selected.
    first!.canvas.selectIris([shared]);
    expect(second!.element.querySelector('catalog-view')!.selectedIri).toBe(shared);
    first!.canvas.selectIris([]);
    expect(second!.element.querySelector('catalog-view')!.selectedIri).toBe('');
    press(second!.element);
    expect(ui.activeCanvasView()).toBe('catalog');
    press(first!.element);
    ui.closeSplit();
  });

  it('marks and locks what collaborators hold in both panes, a pane opened later too', async () => {
    ui.setCanvasMarkers('la-remote-selected', new Set([shared]));
    ui.setLockedIris(new Set([shared]));
    await ui.split('side-by-side');
    for (const p of ui.panes()) expect(marked(p.canvas, shared, 'la-remote-selected')).toBe(true);
    ui.setCanvasMarkers('la-remote-selected', new Set());
    ui.setLockedIris(new Set());
    for (const p of ui.panes()) expect(marked(p.canvas, shared, 'la-remote-selected')).toBe(false);
  });

  it('keeps both panes when the model moves to another namespace, and closes the split when another model opens (SV-9)', async () => {
    const [, second] = ui.panes();
    press(second!.element);
    await ui.runCommand({ command: 'open-view', value: detail });
    press(ui.panes()[0]!.element);
    const namespace = 'https://example.org/moved/';
    app.setModelNamespace(namespace, { rename: true });
    await settled();
    expect(ui.panes()).toHaveLength(2);
    const views = ui.panes().map((p) => p.viewIri!);
    expect(views.every((v) => v.startsWith(namespace))).toBe(true);
    expect(views[1]).toBe(namespace + detail.slice(detail.indexOf('view/')));
    expect(ui.panes()[1]!.canvas.currentView()).toBe(views[1]);

    app.newModel('Another');
    await settled();
    expect(ui.panes()).toHaveLength(1);
    expect(ui.appToolbar.split).toBe('');
    expect(ui.panes()[0]!.viewIri).toBe(app.session.activeViewIri);
  });
  it('splits from the top bar: Split beside the View list, its menu marking what is in force (SV-1)', async () => {
    const bar = ui.appToolbar.shadowRoot!;
    const open = async () => {
      bar.querySelector<HTMLButtonElement>('button[data-menu="split"]')!.click();
      await ui.appToolbar.updateComplete;
      return bar.querySelector('.dropdown.split')!;
    };
    const entries = (menu: Element) =>
      [...menu.querySelectorAll('button')].map((b) => ({
        label: b.querySelector('.label')!.textContent,
        checked: b.getAttribute('aria-checked'),
        disabled: b.disabled,
      }));
    // Beside the View list's ＋.
    const button = bar.querySelector('button[data-menu="split"]')!;
    expect(button.parentElement!.previousElementSibling!.querySelector('[data-menu="new-view"]')).not.toBeNull();
    expect(button.getAttribute('aria-label')).toBe('Split');
    let menu = await open();
    expect(entries(menu)).toEqual([
      { label: 'Side by side', checked: 'false', disabled: false },
      { label: 'One above the other', checked: 'false', disabled: false },
      { label: 'Close split', checked: null, disabled: true },
      { label: 'Sync selection', checked: 'true', disabled: false },
    ]);
    menu.querySelector<HTMLButtonElement>('[data-value="stacked"]')!.click();
    await vi.waitFor(() => expect(ui.panes()).toHaveLength(2));
    await ui.appToolbar.updateComplete;
    expect(button.getAttribute('aria-pressed')).toBe('true');
    menu = await open();
    expect(entries(menu).map((e) => [e.label, e.checked, e.disabled])).toEqual([
      ['Side by side', 'false', false],
      ['One above the other', 'true', false],
      ['Close split', null, false],
      ['Sync selection', 'true', false],
    ]);
    menu.querySelector<HTMLButtonElement>('[data-value="close"]')!.click();
    await vi.waitFor(() => expect(ui.panes()).toHaveLength(1));
  });
});
