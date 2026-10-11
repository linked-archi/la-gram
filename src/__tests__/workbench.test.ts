// @vitest-environment jsdom

/**
 * The whole workbench, end to end: the real `createApp()` (bundled metamodels,
 * Oxigraph, validation) mounted by the real `mountUi()`, driven through the
 * commands the toolbar and the model tree issue. Dialogs and file I/O are
 * scripted; nothing else is stubbed.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { DataFactory } from 'n3';
import type { NamedNode } from '@rdfjs/types';
import { createApp, type App } from '../app.js';
import { mountUi, VIOLATION_MARKER, type MountedUi } from '../ui/mount-ui.js';
import type { Dialogs, FormField, FormOptions, FormValues } from '../ui/dialogs.js';
import { labelOf, modelQuads, readModelContents } from '../model-manager/model-queries.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { installJsdomSvgSupport } from '../ui/__tests__/jsdom-svg-support.js';

installJsdomSvgSupport();

const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const AM3 = 'https://meta.linked.archi/archimate3/onto#';
const nn = (v: string) => DataFactory.namedNode(v) as unknown as NamedNode;

/**
 * Dialogs answering from a script: prompts pop answers, confirms say yes, and
 * forms pop an answer merged over the fields' initial values (`null` cancels;
 * an empty script accepts the defaults).
 */
function scriptedDialogs() {
  const answers: Array<string | null> = [];
  const forms: Array<FormValues | null> = [];
  const confirms: string[] = [];
  const dialogs: Dialogs = {
    prompt: vi.fn(async () => (answers.length > 0 ? answers.shift()! : null)),
    form: vi.fn(async (_title: string, fields: FormField[], options?: FormOptions) => {
      const answer = forms.length > 0 ? forms.shift()! : {};
      if (answer === null) return null;
      const values: FormValues = { ...Object.fromEntries(fields.map((f) => [f.name, f.value ?? ''])), ...answer };
      const problem = options?.validate?.(values);
      if (problem) throw new Error(`form rejected: ${problem}`);
      return values;
    }),
    confirm: vi.fn(async (title: string) => {
      confirms.push(title);
      return true;
    }),
    choose: vi.fn(async () => (answers.length > 0 ? answers.shift()! : null)),
    info: vi.fn(async () => undefined),
    toast: vi.fn(),
  };
  return { dialogs, answers, forms, confirms };
}

let app: App;
let ui: MountedUi;
let script: ReturnType<typeof scriptedDialogs>;
let files: Array<{ name: string; text: string }>;
let saved: Array<{ content: string | Blob; fileName: string; mediaType: string }>;

beforeAll(async () => {
  app = await createApp({ assetMode: 'offline', validationDelayMs: 0 });
  script = scriptedDialogs();
  files = [];
  saved = [];
  const root = document.createElement('div');
  document.body.append(root);
  ui = mountUi(app, root, {
    dialogs: script.dialogs,
    pickFile: async () => files.shift() ?? null,
    saveFile: (content, fileName, mediaType) => {
      saved.push({ content, fileName, mediaType });
    },
  });
  app.announceLoadedMetamodel();
}, 60_000);

afterAll(() => ui.dispose());

const contents = () => readModelContents(app.components.store, app.components.viewManager.getViews());

describe('the workbench', () => {
  it('starts with a new model conforming to ArchiMate 4.0, one open diagram, and a palette', () => {
    expect(app.session.metamodelIris()).toEqual(['https://meta.linked.archi/archimate4/metamodel#ArchiMate4']);
    expect(app.session.activeViewIri).toBeDefined();
    expect(ui.appToolbar.views).toHaveLength(1);
    expect(ui.palettePanel.palette.elementGroups.length).toBeGreaterThan(0);
    expect(ui.appToolbar.loadedMetamodels.map((m) => m.label)).toEqual(['ArchiMate 4.0 Metamodel']);
    expect(ui.appToolbar.presentationContexts.length).toBeGreaterThan(0);
    // "Add property" is served by the catalog: what applies to the concept, never geometry.
    const actor = app.components.elementManager.createElement(`${AM4}BusinessActor`, app.session.modelIri!).value;
    const suggested = ui.propertyPanel.catalog!.suggest(actor);
    expect(suggested.map((p) => p.iri)).toContain(NAMESPACES.skos + 'altLabel');
    expect(suggested.map((p) => p.iri)).not.toContain(NAMESPACES.skos + 'definition');
    expect(suggested.some((p) => p.iri.startsWith(NAMESPACES['arch-vis']))).toBe(false);
    app.components.elementManager.deleteElement(actor);
  });

  it('keeps the RDF panel hidden until toggled, then shows the live model as Turtle', async () => {
    expect(ui.isRdfPanelOpen()).toBe(false);
    expect(ui.shell.rdfOpen).toBe(false);
    expect(ui.rdfPanel.text).toBe(''); // nothing serialized while hidden

    await ui.runCommand({ command: 'toggle-rdf' });
    expect(ui.isRdfPanelOpen()).toBe(true);
    expect(ui.appToolbar.rdfOpen).toBe(true);
    expect(ui.rdfPanel.text).toMatch(/^m:model a arch:Model;/m);
    expect(ui.rdfPanel.text).toContain(`@prefix m: <${app.session.namespace()!.namespace}>.`);
    expect(ui.rdfPanel.text).not.toContain('owl:Ontology');

    // A new element appears after the (debounced) refresh, and selecting it
    // marks its statements.
    const el = app.components.elementManager.createElement(`${AM4}BusinessActor`, app.session.modelIri!, {
      label: 'Visible in Turtle',
    }).value;
    app.components.eventBus.emit('model-changed', { origin: 'test' });
    ui.rdfPanel.refresh();
    expect(ui.rdfPanel.text).toContain('Visible in Turtle');
    ui.selectConcept(el);
    await ui.rdfPanel.updateComplete;
    expect(ui.rdfPanel.shadowRoot!.querySelector(`.rdf-block.selected`)?.getAttribute('data-subject')).toBe(el);

    app.components.elementManager.deleteElement(el);
    await ui.runCommand({ command: 'toggle-rdf' });
    expect(ui.isRdfPanelOpen()).toBe(false);
  });

  it('shows the palette on the right by default; the toolbar toggle hides and shows it', async () => {
    expect(ui.isPaletteOpen()).toBe(true);
    expect(ui.appToolbar.paletteOpen).toBe(true);
    await ui.runCommand({ command: 'toggle-palette' });
    expect(ui.isPaletteOpen()).toBe(false);
    expect(ui.shell.paletteOpen).toBe(false);
    expect(ui.appToolbar.paletteOpen).toBe(false);
    await ui.runCommand({ command: 'toggle-palette' });
    expect(ui.isPaletteOpen()).toBe(true);
  });

  it('keeps properties, validation and the SPARQL editor in the bottom tabs, violations counted on Validation', async () => {
    expect(ui.shell.bottomTab).toBe('properties');
    ui.showBottomTab('validation');
    expect(ui.shell.bottomTab).toBe('validation');
    // The new model's default view declares no viewpoint: a Warning, not counted.
    app.runValidation();
    await ui.shell.updateComplete;
    expect(ui.validationPanel.results.some((r) => r.severity === 'Warning')).toBe(true);
    expect(ui.shell.tabBadges.validation).toBeUndefined();
    // An element without a name is a Violation: counted on the tab.
    const unnamed = app.components.elementManager.createElement(`${AM4}BusinessActor`, app.session.modelIri!).value;
    app.runValidation();
    expect(ui.shell.tabBadges.validation).toBe('1');
    app.components.elementManager.deleteElement(unnamed);
    app.runValidation();
    expect(ui.shell.tabBadges.validation).toBeUndefined();
    ui.showBottomTab('properties');
  });

  it('tells about the selected type under the tree, from the loaded ontology and taxonomy — for a view, its viewpoint', async () => {
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => void stored.set(k, v),
      removeItem: (k: string) => void stored.delete(k),
    });
    const model = app.session.modelIri!;
    const actor = app.components.elementManager.createElement(`${AM4}BusinessActor`, model, { label: 'Clerk' }).value;
    const role = app.components.elementManager.createElement(`${AM4}Role`, model, { label: 'Cashier' }).value;
    const assignment = app.components.relationshipManager.createQualifiedRelationship!({
      typeIri: `${AM4}Assignment`,
      sourceIri: actor,
      targetIri: role,
      modelIri: model,
    }).iri;
    const guide = ui.typeGuidePanel;
    const root = guide.shadowRoot!;
    // In the left panel, under the tree — not in the property panel.
    expect(guide.slot).toBe('guide');
    expect(ui.propertyPanel.shadowRoot!.querySelector('.vtab[data-tab="about"]')).toBeNull();
    const about = async (iri: string) => {
      ui.selectConcept(iri);
      await guide.updateComplete;
      return root.querySelector<HTMLElement>('.body')!;
    };

    const actorAbout = await about(actor);
    expect(root.querySelector('.header .title')!.textContent).toBe('About Business Actor');
    expect(actorAbout.querySelector('.definition')!.textContent).toBe(
      'A business actor represents a business entity that is capable of performing behavior.',
    );
    expect(actorAbout.querySelector('details[data-section="guidance"]')!.textContent).toMatch(/should preferably be a noun/);
    expect(actorAbout.querySelector('details[data-section="classification"]')!.textContent).toMatch(/Business Domain[\s\S]*Also in Business Domain:/);
    expect(actorAbout.querySelector('.sources a')!.getAttribute('href')).toMatch(/^https:\/\/pubs\.opengroup\.org\//);

    const relationshipAbout = await about(assignment);
    expect(relationshipAbout.querySelector('.type')!.textContent).toMatch(/Assignment/);
    expect(relationshipAbout.querySelector('.definition')!.textContent).toMatch(/assignment/i);

    // A view: its viewpoint, when it has one.
    const view = app.session.createView('Diagram', { label: 'Org', viewpointIri: 'https://meta.linked.archi/archimate4/viewpoints#OrganizationViewpoint', open: false });
    const viewAbout = await about(view);
    expect(root.querySelector('.header .title')!.textContent).toBe('About Organization Viewpoint');
    expect(viewAbout.querySelector('details[data-section="facts"]')!.textContent).toMatch(/Shows[\s\S]*Business Actor/);

    // A type picked in the palette — here a relationship, which arms the connect
    // tool — is shown until something is selected; a model change meanwhile keeps it.
    // (jsdom cannot run the connect tool; the browser suite does.)
    const connect = vi.spyOn(ui.diagramCanvas, 'activateTool').mockImplementation(() => undefined);
    ui.palettePanel.dispatchEvent(
      new CustomEvent('palette-drag-start', {
        detail: { iri: `${AM4}Serving`, label: 'Serving', kind: 'relationship', sourceEvent: new MouseEvent('click') },
        bubbles: true,
        composed: true,
      }),
    );
    await guide.updateComplete;
    expect(root.querySelector('.header .title')!.textContent).toBe('About Serving');
    ui.selectConcept(undefined);
    const other = app.components.elementManager.createElement(`${AM4}Product`, model, { label: 'Other' }).value;
    await guide.updateComplete;
    expect(root.querySelector('.header .title')!.textContent).toBe('About Serving');
    ui.selectConcept(actor);
    await guide.updateComplete;
    expect(root.querySelector('.header .title')!.textContent).toBe('About Business Actor');
    app.components.elementManager.deleteElement(other);
    connect.mockRestore();

    // Folding it from its header leaves the header; the shell remembers.
    root.querySelector<HTMLButtonElement>('.header')!.click();
    await guide.updateComplete;
    expect([ui.shell.guideFolded, guide.folded]).toEqual([true, true]);
    expect(stored.get('la-gram:guide-folded')).toBe('true');
    root.querySelector<HTMLButtonElement>('.header')!.click();
    await guide.updateComplete;
    expect(guide.folded).toBe(false);

    ui.selectConcept(undefined);
    await guide.updateComplete;
    expect(root.querySelector('.header .title')!.textContent).toBe('About');
    app.session.deleteView(view);
    for (const iri of [actor, role]) app.components.elementManager.deleteElement(iri);
    vi.unstubAllGlobals();
  });

  it('splits the property panel into vertical tabs, and remembers the open one', async () => {
    // Node's own `localStorage` stub shadows jsdom's here; a store in memory stands in.
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => void stored.set(k, v),
      removeItem: (k: string) => void stored.delete(k),
    });
    const el = app.components.elementManager.createElement(`${AM4}BusinessActor`, app.session.modelIri!, { label: 'Tabbed' }).value;
    app.components.viewManager.addElementToView(app.session.activeViewIri!, el);
    ui.selectConcept(el);
    await ui.propertyPanel.updateComplete;
    const root = ui.propertyPanel.shadowRoot!;
    const tabs = () =>
      [...root.querySelectorAll('.vtab')].map((t) => [
        t.getAttribute('data-tab'),
        t.querySelector('.vtab-name')!.textContent,
        t.getAttribute('aria-selected'),
      ]);
    expect(tabs()).toEqual([
      ['info', 'Element information', 'true'],
      ['properties', 'Properties', 'false'],
      ['analysis', 'Analysis', 'false'],
      ['views', 'Appears in views', 'false'],
    ]);
    expect(root.querySelector('.pane')!.getAttribute('data-tab')).toBe('info');
    expect(root.querySelector('.pane .id-row')).not.toBeNull();

    root.querySelector<HTMLButtonElement>('.vtab[data-tab="views"]')!.click();
    await ui.propertyPanel.updateComplete;
    expect(root.querySelector('.pane')!.getAttribute('data-tab')).toBe('views');
    expect(root.querySelector('.pane .id-row')).toBeNull();
    expect(root.querySelector('.pane')!.textContent).toContain('Default View');
    // Kept for the next selection, and for a panel built later (a reload).
    expect(stored.get('la-gram:property-panel-tab')).toBe('views');
    expect(document.createElement('property-panel').activeTab).toBe('views');

    // Up / Down move between the tabs.
    root.querySelector<HTMLButtonElement>('.vtab[data-tab="views"]')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    await ui.propertyPanel.updateComplete;
    expect(ui.propertyPanel.activeTab).toBe('info');

    ui.selectConcept(undefined);
    app.components.elementManager.deleteElement(el);
    vi.unstubAllGlobals();
  });

  it('draws the relationships around the selected element in the Graph tab, runs its query, exports it, and makes it a view', async () => {
    const els = app.components.elementManager;
    const rels = app.components.relationshipManager;
    const model = app.session.modelIri!;
    const clerk = els.createElement(`${AM4}BusinessActor`, model, { label: 'Clerk' }).value;
    const role = els.createElement(`${AM4}BusinessRole`, model, { label: 'Cashier' }).value;
    const shop = els.createElement(`${AM4}ApplicationComponent`, model, { label: 'Till' }).value;
    rels.createQualifiedRelationship!({ typeIri: `${AM4}Assignment`, sourceIri: clerk, targetIri: role, modelIri: model });
    rels.createQualifiedRelationship!({ typeIri: `${AM4}Serving`, sourceIri: shop, targetIri: role, modelIri: model });

    // jsdom draws nothing: a stand-in records what would be drawn.
    const drawn: Array<{ nodes: number; edges: number }> = [];
    let placed = new Map<string, { x: number; y: number }>();
    ui.graphPanel.viewFactory = () => ({
      show: (nodes, edges) => {
        drawn.push({ nodes: nodes.length, edges: edges.length });
        placed = new Map(nodes.map((n, i) => [n.id, { x: i * 150, y: n.depth * 120 }]));
      },
      relayout: () => undefined,
      fit: () => undefined,
      resize: () => undefined,
      highlight: () => undefined,
      positions: () => placed,
      destroy: () => undefined,
    });
    ui.selectConcept(clerk);
    expect(ui.graphPanel.rootIri).toBe(clerk);
    ui.showBottomTab('graph');
    expect(ui.graphPanel.active).toBe(true);
    await ui.graphPanel.updateComplete;

    // Depth 2 by default: Clerk → Cashier ← Till.
    expect(ui.graphPanel.graph!.nodes.map((n) => n.label).sort()).toEqual(['Cashier', 'Clerk', 'Till']);
    expect(ui.graphPanel.graph!.edges).toHaveLength(2);
    expect(drawn.at(-1)).toEqual({ nodes: 3, edges: 2 });
    ui.graphPanel.setDepth(1);
    expect(ui.graphPanel.graph!.nodes.map((n) => n.label).sort()).toEqual(['Cashier', 'Clerk']);

    // The query runs in the SPARQL tab — a SELECT by default: a table, one row
    // per relationship, IRIs as prefixed names. Showing the tab queries and
    // re-renders: wait for the export buttons to be live.
    const button = (name: string) => ui.graphPanel.shadowRoot!.querySelector<HTMLButtonElement>(`[data-export="${name}"]`)!;
    await vi.waitFor(() => expect(button('open-sparql').disabled).toBe(false));
    expect(ui.graphPanel.queryForm).toBe('select');
    button('open-sparql').click();
    expect(ui.shell.bottomTab).toBe('sparql');
    await ui.sparqlEditor.updateComplete;
    const editor = ui.sparqlEditor.shadowRoot!;
    expect(editor.querySelector('.result-info')!.textContent).toMatch(/^1 result\(s\)/);
    expect([...editor.querySelectorAll('th')].map((th) => th.textContent)).toEqual([
      'source', 'sourceName', 'relationship', 'relationshipType', 'relationshipName', 'target', 'targetName',
    ]);
    expect(editor.querySelector('tbody tr')!.textContent).toMatch(/m:element-.*Clerk.*m:relationship-.*am4:Assignment.*m:element-.*Cashier/s);

    // … and its rows become a view.
    script.answers.push('Clerk and role');
    editor.querySelector<HTMLButtonElement>('.view-btn')!.click();
    await vi.waitFor(() => expect(app.components.viewManager.getViews().some((v) => v.label === 'Clerk and role')).toBe(true));
    const fromQuery = app.components.viewManager.getViews().find((v) => v.label === 'Clerk and role')!;
    expect(app.session.activeViewIri).toBe(fromQuery.iri);
    expect(app.components.viewManager.getNodes(fromQuery.iri).map((n) => n.elementIri).sort()).toEqual([clerk, role].sort());
    expect(app.components.viewManager.getLinks(fromQuery.iri)).toHaveLength(1);

    // The CONSTRUCT runs too, and shows its triples.
    ui.graphPanel.setQueryForm('construct');
    button('open-sparql').click();
    await ui.sparqlEditor.updateComplete;
    expect(editor.querySelector('.construct-count')!.textContent).toMatch(/^\d+ triple\(s\)/);
    expect([...editor.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['subject', 'predicate', 'object']);
    ui.graphPanel.setQueryForm('select');

    // The graph itself becomes a view, laid out as drawn — from the maximized
    // panel, which then steps aside for the new view.
    ui.showBottomTab('graph');
    ui.graphPanel.setDepth(2);
    ui.shell.setBottomMaximized(true);
    script.answers.push('Clerk — 2 hops');
    button('view').click();
    await vi.waitFor(() => expect(app.components.viewManager.getViews().some((v) => v.label === 'Clerk — 2 hops')).toBe(true));
    // The name offered: the root and the depth.
    expect(vi.mocked(script.dialogs.prompt).mock.calls.at(-1)).toEqual(['New view', 'Name — 3 elements, 2 relationships', 'Clerk — 2 hops']);
    const fromGraph = app.components.viewManager.getViews().find((v) => v.label === 'Clerk — 2 hops')!;
    expect(ui.shell.bottomMaximized).toBe(false);
    const nodes = app.components.viewManager.getNodes(fromGraph.iri);
    expect(nodes).toHaveLength(3);
    expect(app.components.viewManager.getLinks(fromGraph.iri)).toHaveLength(2);
    // Clerk is drawn first (the root), so it is leftmost and on top.
    const clerkNode = nodes.find((n) => n.elementIri === clerk)!;
    expect(clerkNode.bounds).toMatchObject({ x: 40, y: 40, width: 120, height: 55 });
    for (const view of [fromQuery, fromGraph]) app.session.deleteView(view.iri);
    ui.graphPanel.setDepth(1);

    // The graph's triples go to a Turtle file with the model's prefixes.
    button('turtle').click();
    const turtle = saved.at(-1)!;
    expect(turtle.fileName).toBe('Clerk-graph.ttl');
    expect(turtle.content as string).toMatch(/m:relationship-[0-9a-f-]{36} a am4:Assignment;/);
    expect(turtle.content as string).not.toContain('Till'); // depth 1

    ui.graphPanel.setDepth(2);
    ui.showBottomTab('properties');
    expect(ui.graphPanel.active).toBe(false);
    for (const iri of [clerk, role, shop]) els.deleteElement(iri);
  });

  it('hides and shows the model tree from the toolbar', async () => {
    const toggle = () => ui.appToolbar.shadowRoot!.querySelector<HTMLButtonElement>('[data-command="toggle-explorer"]')!;
    await ui.appToolbar.updateComplete;
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    toggle().click();
    await ui.appToolbar.updateComplete;
    expect([ui.isExplorerOpen(), ui.shell.explorerOpen, toggle().getAttribute('aria-pressed')]).toEqual([false, false, 'false']);
    ui.setExplorerOpen(true);
    await ui.appToolbar.updateComplete;
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
  });

  it('changes an element\u2019s type from the property panel — in the view or not — and offers a right-click menu', async () => {
    const els = app.components.elementManager;
    const model = app.session.modelIri!;
    const view = app.session.activeViewIri!;
    const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
    const typesOf = (iri: string) =>
      app.components.store.getQuads({ termType: 'NamedNode', value: iri } as never, { termType: 'NamedNode', value: RDF_TYPE } as never).map((q) => q.object.value);
    const placed = els.createElement(`${AM4}BusinessActor`, model, { label: 'Business Actor' }).value;
    app.components.viewManager.addElementToView(view, placed, { x: 100, y: 100, width: 120, height: 55 });
    app.components.eventBus.emit('model-changed', { origin: 'test' });
    const unplaced = els.createElement(`${AM4}BusinessActor`, model, { label: 'Clerk' }).value;
    const root = ui.propertyPanel.shadowRoot!;
    const typeSelect = async (iri: string) => {
      ui.selectConcept(iri);
      await ui.propertyPanel.updateComplete;
      return root.querySelector<HTMLSelectElement>('select.type-select');
    };
    const pick = async (select: HTMLSelectElement, typeIri: string) => {
      select.value = typeIri;
      select.dispatchEvent(new Event('change'));
      await vi.waitFor(() => expect(typesOf(select === null ? '' : (ui.propertyPanel.selectedIri as string))).toContain(typeIri));
    };

    // In the view: the dropdown lists the loaded types, grouped as in the palette; the change is undoable.
    const inView = (await typeSelect(placed))!;
    expect(inView.value).toBe(`${AM4}BusinessActor`);
    expect([...inView.querySelectorAll('optgroup')].map((g) => g.label)).toContain('Business Domain');
    await pick(inView, `${AM4}ApplicationComponent`);
    expect(typesOf(placed)).toEqual([`${AM4}ApplicationComponent`]);
    expect(ui.diagramCanvas.getElement(placed)?.typeIri).toBe(`${AM4}ApplicationComponent`);
    expect(labelOf(app.components.store, placed)).toBe('Application Component'); // the default name follows
    await ui.runCommand({ command: 'undo' });
    expect(typesOf(placed)).toEqual([`${AM4}BusinessActor`]);

    // Not in the view (selected in the tree): changed in the model directly; its own name stays.
    const offCanvas = (await typeSelect(unplaced))!;
    await pick(offCanvas, `${AM4}Role`);
    expect(typesOf(unplaced)).toEqual([`${AM4}Role`]);
    expect(labelOf(app.components.store, unplaced)).toBe('Clerk');
    await ui.propertyPanel.updateComplete;
    expect(ui.propertyPanel.heading?.typeLabel).toBe('Role');

    // A relationship's type stays read-only here.
    const rel = app.components.relationshipManager.createQualifiedRelationship!({ typeIri: `${AM4}Assignment`, sourceIri: placed, targetIri: unplaced, modelIri: model }).iri;
    expect(await typeSelect(rel)).toBeNull();

    // The right-click menu on the shape: edit, relate, show, copy, delete.
    const shape = (ui.diagramCanvas.getDiagram() as unknown as { get(n: string): { get(id: string): unknown } }).get('elementRegistry').get(placed);
    const entries = ui.diagramCanvas.contextMenuProvider.getPopupMenuEntries(shape) as Record<string, { group: string; action: () => void }>;
    expect(Object.keys(entries)).toEqual(['rename', 'change-type', 'append', 'properties', 'reveal-tree', 'graph', 'copy-iri', 'delete', 'delete-model']);
    entries['graph']!.action();
    expect([ui.shell.bottomTab, ui.graphPanel.rootIri]).toEqual(['graph', placed]);
    entries['properties']!.action();
    expect(ui.shell.bottomTab).toBe('properties');

    ui.selectConcept(undefined);
    for (const iri of [placed, unplaced]) els.deleteElement(iri);
  });

  it('creates, names and opens a new view from the toolbar', async () => {
    script.answers.push('Application landscape');
    await ui.runCommand({ command: 'new-view', value: 'Diagram' });
    const view = app.components.viewManager.getViews().find((v) => v.label === 'Application landscape');
    expect(view).toBeDefined();
    expect(app.session.activeViewIri).toBe(view!.iri);
    expect(ui.appToolbar.activeViewIri).toBe(view!.iri);
  });

  it('saves only the model, as Turtle, and marks it clean', async () => {
    ui.diagramCanvas.placeExisting; // canvas is ready
    const store = app.components.store;
    const el = app.components.elementManager.createElement(`${AM4}ApplicationComponent`, app.session.modelIri!, {
      label: 'Web Shop',
    }).value;
    app.components.viewManager.addElementToView(app.session.activeViewIri!, el, { x: 50, y: 50, width: 120, height: 55 });
    app.components.eventBus.emit('model-changed', { origin: 'test' });
    expect(app.isDirty()).toBe(true);

    await ui.runCommand({ command: 'save' });

    const file = saved.at(-1)!;
    expect(file.mediaType).toBe('text/turtle');
    expect(file.fileName).toMatch(/\.ttl$/);
    expect(file.content as string).toContain('Web Shop');
    expect(file.content as string).not.toContain('owl:Ontology');
    expect(app.isDirty()).toBe(false);
    expect(store.getQuads(nn(el)).length).toBeGreaterThan(0);
  });

  it('opens a saved model again: same elements, views and geometry', async () => {
    const turtle = saved.at(-1)!.content as string;
    const before = modelQuads(app.components.store).length;
    const modelBefore = app.session.modelIri;
    script.forms.push(null);
    await ui.runCommand({ command: 'new-model' });
    // Cancelled: nothing happened.
    expect(app.session.modelIri).toBe(modelBefore);
    script.forms.push({ label: 'Scratch' });
    await ui.runCommand({ command: 'new-model' });
    expect(app.session.modelLabel()).toBe('Scratch');
    // The suggested namespace: a fresh one under example.org.
    expect(app.session.namespace()?.namespace).toMatch(/^https:\/\/example\.org\/archimate\/[0-9a-f-]{36}\/$/);

    files.push({ name: 'shop.ttl', text: turtle });
    await ui.runCommand({ command: 'open-model' });

    expect(modelQuads(app.components.store).length).toBe(before);
    expect(contents().elements.map((e) => e.label)).toContain('Web Shop');
    expect(ui.appToolbar.views.map((v) => v.label).sort()).toEqual(['Application landscape', 'Default View']);
  });

  it('deletes an element from the model through the tree, after confirming', async () => {
    const el = contents().elements.find((e) => e.label === 'Web Shop')!;
    ui.modelExplorer.dispatchEvent(
      new CustomEvent('explorer-action', { detail: { action: 'delete-from-model', iri: el.iri, kind: 'element' } }),
    );
    await vi.waitFor(() => expect(app.components.store.getQuads(nn(el.iri))).toHaveLength(0));
    expect(script.confirms).toContain('Delete element from model');
  });

  it('imports an ArchiMate exchange file as an ArchiMate 3.2 model with its diagram', async () => {
    files.push({
      name: 'shop.xml',
      text: `<?xml version="1.0"?>
        <model xmlns="http://www.opengroup.org/xsd/archimate/3.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" identifier="m">
          <name xml:lang="en">Imported shop</name>
          <elements>
            <element identifier="a" xsi:type="ApplicationComponent"><name xml:lang="en">Web</name></element>
            <element identifier="b" xsi:type="ApplicationComponent"><name xml:lang="en">API</name></element>
          </elements>
          <relationships><relationship identifier="r" xsi:type="Serving" source="b" target="a"/></relationships>
          <views><diagrams><view identifier="v" xsi:type="Diagram"><name xml:lang="en">Main</name>
            <node identifier="na" elementRef="a" xsi:type="Element" x="10" y="10" w="120" h="55"/>
            <node identifier="nb" elementRef="b" xsi:type="Element" x="300" y="10" w="120" h="55"/>
            <connection identifier="c" relationshipRef="r" xsi:type="Relationship" source="nb" target="na"/>
          </view></diagrams></views>
        </model>`,
    });
    await ui.runCommand({ command: 'import-archimate' });

    expect(app.session.modelLabel()).toBe('Imported shop');
    expect(app.loadedMetamodels().map((m) => m.metamodelIri)).toContain(
      'https://meta.linked.archi/archimate3/metamodel#ArchiMate3.2',
    );
    expect(ui.appToolbar.views.map((v) => v.label)).toEqual(['Main']);
    // The imported diagram is on the canvas.
    const [web] = contents().elements.filter((e) => e.label === 'Web');
    expect(web.typeIri).toBe(`${AM3}ApplicationComponent`);
    expect(ui.diagramCanvas.getElement(web.iri)?.bounds).toMatchObject({ x: 10, y: 10 });
    expect(ui.diagramCanvas.getRelationships().size).toBe(1);
  });

  it('moves the model into a team namespace from Model settings, keeping the open view', async () => {
    script.forms.push({ namespace: 'https://acme.com/ea/shop/', prefix: 'shop' });
    await ui.runCommand({ command: 'model-settings' });

    expect(app.session.modelIri).toBe('https://acme.com/ea/shop/model');
    expect(app.session.activeViewIri).toBe('https://acme.com/ea/shop/view-v');
    expect(ui.appToolbar.activeViewIri).toBe('https://acme.com/ea/shop/view-v');
    const web = contents().elements.find((e) => e.label === 'Web')!;
    expect(web.iri).toBe('https://acme.com/ea/shop/element-a');
    expect(ui.diagramCanvas.getElement(web.iri)?.bounds).toMatchObject({ x: 10, y: 10 });
    expect(ui.diagramCanvas.getRelationships().size).toBe(1);

    const ttl = app.saveModel('turtle').text;
    expect(ttl).toContain('@prefix shop: <https://acme.com/ea/shop/>.');
    expect(ttl).toMatch(/^shop:element-a a am:ApplicationComponent;/m);
    expect(ttl.split('<https://acme.com/ea/shop/')).toHaveLength(2);
    expect(app.isDirty()).toBe(true);

    // A prefix another vocabulary already stands for is refused.
    expect(app.namespaceProblem('https://acme.com/ea/shop/', 'skos')).toMatch(/already stands for/);
    expect(app.namespaceProblem('not a namespace', 'shop')).not.toBeNull();
  });

  it('switches metamodel: the palette follows, the model stays', async () => {
    const before = modelQuads(app.components.store).length;
    await ui.runCommand({ command: 'switch-metamodel', value: 'https://meta.linked.archi/archimate3/metamodel#ArchiMate3.2' });
    expect(app.loadedMetamodels().map((m) => m.metamodelIri)).toEqual([
      'https://meta.linked.archi/archimate3/metamodel#ArchiMate3.2',
    ]);
    const types = ui.palettePanel.palette.elementGroups.flatMap((g) => g.elements.map((e) => e.iri));
    expect(types).toContain(`${AM3}BusinessActor`);
    expect(types.some((t) => t.startsWith(AM4))).toBe(false);
    expect(modelQuads(app.components.store).length).toBeGreaterThanOrEqual(before - 1);
  });

  it('validates against the real shapes and marks the offending shape on the canvas', () => {
    const [web] = contents().elements.filter((e) => e.label === 'Web');
    const labels = app.components.store.getQuads(nn(web.iri), nn(NAMESPACES.skos + 'prefLabel'));
    app.components.store.removeQuads(labels);
    app.components.eventBus.emit('model-changed', { origin: 'test' });

    const results = ui.validationPanel.results;
    expect(results.some((r) => r.focusNode.value === web.iri)).toBe(true);
    const canvas = (ui.diagramCanvas.getDiagram() as unknown as { get(n: string): { hasMarker(e: unknown, m: string): boolean } }).get('canvas');
    const registry = (ui.diagramCanvas.getDiagram() as unknown as { get(n: string): { get(id: string): unknown } }).get('elementRegistry');
    expect(canvas.hasMarker(registry.get(web.iri), VIOLATION_MARKER)).toBe(true);

    // Renaming it through the property panel fixes it — with a language tag.
    ui.propertyPanel.dispatchEvent(
      new CustomEvent('property-edit', {
        detail: { elementIri: web.iri, predicate: NAMESPACES.skos + 'prefLabel', value: 'Web' },
      }),
    );
    const label = app.components.store.getQuads(nn(web.iri), nn(NAMESPACES.skos + 'prefLabel'))[0].object as { language?: string };
    expect(label.language).toBe('en');
    expect(ui.validationPanel.results.some((r) => r.focusNode.value === web.iri)).toBe(false);
  });
});
