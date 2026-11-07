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
import type { NamedPicker } from '../ui/panels/named-picker.js';
import { labelOf, modelQuads, readModelContents } from '../model-manager/model-queries.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { installJsdomSvgSupport } from '../ui/__tests__/jsdom-svg-support.js';

installJsdomSvgSupport();

const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const AM3 = 'https://meta.linked.archi/archimate3/onto#';
const archq = (id: string) => 'https://meta.linked.archi/core-questions#' + id;
const am4q = (id: string) => 'https://meta.linked.archi/archimate4/questions#' + id;
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
    // The open view, by default: the view itself, not the whole model.
    expect(ui.rdfPanel.scope).toBe('view');
    const viewName = app.session.activeViewIri!.slice(app.session.namespace()!.namespace.length);
    expect(ui.rdfPanel.text).toMatch(new RegExp(`^m:${viewName} a `, 'm'));
    expect(ui.rdfPanel.text).not.toMatch(/^m:model a arch:Model;/m);
    // The whole model, as Save writes it.
    ui.rdfPanel.scope = 'model';
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

    // Several selected on the canvas: the selection scope shows them all.
    const placeTwo = ['First on canvas', 'Second on canvas'].map((label, i) => {
      const iri = app.components.elementManager.createElement(`${AM4}BusinessActor`, app.session.modelIri!, { label }).value;
      app.components.viewManager.addElementToView(app.session.activeViewIri!, iri, { x: 100 + 200 * i, y: 300, width: 120, height: 55 });
      return iri;
    });
    app.components.eventBus.emit('model-changed', { origin: 'test' });
    const diagram = ui.diagramCanvas.getDiagram() as unknown as { get(n: string): any };
    diagram.get('selection').select(placeTwo.map((iri) => diagram.get('elementRegistry').get(iri)));
    ui.rdfPanel.scope = 'selection';
    await ui.rdfPanel.updateComplete;
    expect(ui.rdfPanel.text).toContain('First on canvas');
    expect(ui.rdfPanel.text).toContain('Second on canvas');
    expect(ui.rdfPanel.shadowRoot!.querySelector('.caption')!.textContent).toBe('2 selected');
    for (const iri of placeTwo) app.components.elementManager.deleteElement(iri);
    ui.rdfPanel.scope = 'view';
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
    // An element without a name is a Violation: counted on the tab — of the
    // open view (the scope by default) once it is drawn there, of the model at once.
    const unnamed = app.components.elementManager.createElement(`${AM4}BusinessActor`, app.session.modelIri!).value;
    app.runValidation();
    expect(ui.validationPanel.scope).toBe('view');
    expect(ui.shell.tabBadges.validation).toBeUndefined();
    await ui.validationPanel.updateComplete;
    const summary = () => ui.validationPanel.shadowRoot!.querySelector('.summary')!.textContent!.replace(/\s+/g, ' ');
    // Its missing name, and — a SPARQL-based principle, as Info — that it relates to nothing.
    expect(summary()).toContain('2 more in the model');
    ui.validationPanel.shadowRoot!.querySelector<HTMLButtonElement>('.summary .rest')!.click();
    expect(ui.validationPanel.scope).toBe('model');
    expect(ui.shell.tabBadges.validation).toBe('1');
    ui.validationPanel.scope = 'view';
    expect(ui.shell.tabBadges.validation).toBeUndefined();
    app.components.viewManager.addElementToView(app.session.activeViewIri!, unnamed, { x: 100, y: 600, width: 120, height: 55 });
    app.runValidation();
    expect(ui.shell.tabBadges.validation).toBe('1');
    await ui.validationPanel.updateComplete;
    expect(summary()).toContain('✗ 1 violation(s)');
    expect(summary()).not.toContain('more in the model');
    app.components.elementManager.deleteElement(unnamed);
    app.runValidation();
    expect(ui.shell.tabBadges.validation).toBeUndefined();
    ui.showBottomTab('properties');
  });

  it('shows the palette entry under the pointer in the About box — by its prefixed name — after a pause, and what was there after', async () => {
    const actor = `${AM4}BusinessActor`;
    expect(ui.palettePanel.prefixedName?.(actor)).toBe('am4:BusinessActor');
    const before = ui.typeGuidePanel.shownIri;
    const hover = (iri: string | undefined) =>
      ui.palettePanel.dispatchEvent(new CustomEvent('palette-hover', { detail: { iri }, bubbles: true, composed: true }));
    hover(actor);
    // Not at once: a sweep across the palette does not churn the box.
    expect(ui.typeGuidePanel.previewIri).toBe('');
    await vi.waitFor(() => expect(ui.typeGuidePanel.previewIri).toBe(actor), { timeout: 2000 });
    await ui.typeGuidePanel.updateComplete;
    expect(ui.typeGuidePanel.shadowRoot!.querySelector('.body .iri')!.textContent!.trim()).toBe('am4:BusinessActor');
    hover(undefined);
    await vi.waitFor(() => expect(ui.typeGuidePanel.previewIri).toBe(''), { timeout: 2000 });
    expect(ui.typeGuidePanel.shownIri).toBe(before);
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

  it('shows the look of what is selected on the canvas in an Appearance tab, and changes it for every one selected, undoably', async () => {
    const els = app.components.elementManager;
    const views = app.components.viewManager;
    const model = app.session.modelIri!;
    const view = app.session.activeViewIri!;
    const a = els.createElement(`${AM4}ApplicationComponent`, model, { label: 'Styled A' }).value;
    const b = els.createElement(`${AM4}ApplicationComponent`, model, { label: 'Styled B' }).value;
    const nodeA = views.addElementToView(view, a, { x: 100, y: 700, width: 120, height: 55 });
    const nodeB = views.addElementToView(view, b, { x: 300, y: 700, width: 120, height: 55 });
    app.components.eventBus.emit('model-changed', { origin: 'test' });
    const panel = ui.propertyPanel;
    const root = panel.shadowRoot!;
    const drawnFill = (iri: string) => document.querySelector(`[data-element-iri="${iri}"] .la-shape-body`)?.getAttribute('fill');
    const notationFill = drawnFill(a);

    // Picked in the tree: the model's concept, not a diagram's — no Appearance.
    ui.selectConcept(a);
    await panel.updateComplete;
    expect(root.querySelector('.vtab[data-tab="appearance"]')).toBeNull();

    // Both selected on the canvas: the tab, last among them, with every field an element's placement has.
    ui.diagramCanvas.selectIris([a, b]);
    await panel.updateComplete;
    expect(panel.appearance?.targets).toEqual([
      { iri: nodeA, kind: 'element' },
      { iri: nodeB, kind: 'element' },
    ]);
    expect([...root.querySelectorAll('.vtab')].map((t) => t.getAttribute('data-tab')).at(-1)).toBe('appearance');
    root.querySelector<HTMLButtonElement>('.vtab[data-tab="appearance"]')!.click();
    await panel.updateComplete;
    // Archi's rows: fill colour and gradient, fill opacity, line colour and width, line opacity and style, icon colour, …
    expect([...root.querySelectorAll('.appearance-field')].map((f) => f.getAttribute('data-field'))).toEqual([
      'fillColor',
      'gradient',
      'fillOpacity',
      'lineColor',
      'lineWidth',
      'lineOpacity',
      'borderStyle',
      'iconColor',
      'textAlignment',
      'textPosition',
      'font',
      'fontColor',
    ]);
    expect(root.querySelectorAll('.appearance > *').length).toBe(15); // 7 rows of two, and the footer
    expect(root.querySelector('.appearance-footer')!.textContent).toContain('Changes apply to the 2 selected.');

    // A fill picked: both, on their own styles, drawn so.
    const fill = root.querySelector<HTMLInputElement>('.appearance-field[data-field="fillColor"] input')!;
    fill.value = '#ffd6e0';
    fill.dispatchEvent(new Event('change'));
    expect([views.getNode(view, nodeA)?.appearance, views.getNode(view, nodeB)?.appearance]).toEqual([
      { fillColor: '#ffd6e0' },
      { fillColor: '#ffd6e0' },
    ]);
    expect([drawnFill(a), drawnFill(b)]).toEqual(['#ffd6e0', '#ffd6e0']);
    // Half opaque, keeping the colour; the text to the left.
    await panel.updateComplete;
    const opacity = root.querySelector<HTMLInputElement>('.appearance-field[data-field="fillOpacity"] input')!;
    opacity.value = '50';
    opacity.dispatchEvent(new Event('change'));
    root.querySelector<HTMLButtonElement>('.appearance-field[data-field="textAlignment"] button[data-value="left"]')!.click();
    expect(views.getNode(view, nodeA)?.appearance).toEqual({ fillColor: '#ffd6e080', textAlignment: 'left' });
    await panel.updateComplete;
    expect(root.querySelector('.appearance-field[data-field="textAlignment"] button[data-value="left"]')!.getAttribute('aria-pressed')).toBe('true');

    // "Notation only": drawn as the notation has it, the look kept — and the tab says so, offering to draw it.
    ui.canvasToolbar.shadowRoot!.querySelector<HTMLButtonElement>('button[data-switch="notation-only"]')!.click();
    expect(drawnFill(a)).toBe(notationFill);
    await panel.updateComplete;
    expect(root.querySelector('.appearance-notice')!.textContent).toContain('Notation only');
    root.querySelector<HTMLButtonElement>('.appearance-notice .show-own')!.click();
    await panel.updateComplete;
    expect(drawnFill(a)).toBe('#ffd6e080');
    expect(ui.canvasToolbar.notationOnly).toBe(false);
    expect(root.querySelector('.appearance-notice')).toBeNull();

    // Each change one step back, for both.
    await ui.runCommand({ command: 'undo' });
    await ui.runCommand({ command: 'undo' });
    await panel.updateComplete;
    expect(views.getNode(view, nodeB)?.appearance).toEqual({ fillColor: '#ffd6e0' });
    expect(panel.appearance?.own).toEqual({ fillColor: '#ffd6e0' });
    // Reset all: back to the notation's.
    root.querySelector<HTMLButtonElement>('.reset-appearance')!.click();
    expect([views.getNode(view, nodeA)?.appearance, views.getNode(view, nodeB)?.appearance]).toEqual([undefined, undefined]);
    expect(drawnFill(a)).toBe(notationFill);

    ui.diagramCanvas.selectIris([]);
    ui.selectConcept(undefined);
    for (const iri of [a, b]) els.deleteElement(iri);
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

  it('asks the model questions: from the SPARQL tab’s menu, from an element’s right-click menu, as model checks, and as a view', async () => {
    const els = app.components.elementManager;
    const rels = app.components.relationshipManager;
    const views = app.components.viewManager;
    const model = app.session.modelIri!;
    const view = app.session.activeViewIri!;
    const service = els.createElement(`${AM4}Service`, model, { label: 'Claims' }).value;
    const process = els.createElement(`${AM4}Process`, model, { label: 'Handle claim' }).value;
    const crm = els.createElement(`${AM4}ApplicationComponent`, model, { label: 'CRM' }).value;
    const capability = els.createElement(`${AM4}Capability`, model, { label: 'Claims management' }).value;
    rels.createQualifiedRelationship!({ typeIri: `${AM4}Serving`, sourceIri: service, targetIri: process, modelIri: model });
    views.addElementToView(view, crm, { x: 600, y: 300, width: 120, height: 55 });
    app.components.eventBus.emit('model-changed', { origin: 'test' });

    // The SPARQL tab's menu: every question of both sets; one needing a selection disabled, saying what to select.
    ui.diagramCanvas.selectIris([]);
    ui.selectConcept(undefined);
    ui.showBottomTab('sparql');
    const editor = ui.sparqlEditor.shadowRoot!;
    editor.querySelector<HTMLButtonElement>('.questions-btn')!.click();
    await ui.sparqlEditor.updateComplete;
    const entry = (iri: string) => editor.querySelector<HTMLButtonElement>(`button.question[data-iri="${iri}"]`)!;
    expect(editor.querySelectorAll('button.question')).toHaveLength(38);
    expect(entry(am4q('impact-of-change')).disabled).toBe(true);
    expect(entry(am4q('impact-of-change')).textContent).toContain('Select an element');
    // Picking one runs it, bound to the open model, and says what a row means.
    entry(am4q('unrealised-services')).click();
    await ui.sparqlEditor.updateComplete;
    expect(ui.sparqlEditor.questionsOpen).toBe(false);
    expect(ui.sparqlEditor.getQuery()).toContain(`VALUES ?model { <${model}> }`);
    expect(editor.querySelector('.asked')!.textContent).toContain('Does not prove');
    expect(editor.querySelector('tbody')!.textContent).toContain('Claims');

    // An element's right-click menu asks about it: the questions taking it, bound to it.
    const registry = (ui.diagramCanvas.getDiagram() as unknown as { get(n: string): { get(id: string): unknown } }).get('elementRegistry');
    const menu = ui.diagramCanvas.contextMenuProvider.getPopupMenuEntries(registry.get(crm)) as Record<string, { action: () => void }>;
    menu['ask']!.action();
    expect(ui.shell.bottomTab).toBe('sparql');
    await ui.sparqlEditor.updateComplete;
    expect(editor.querySelector('.menu-title')!.textContent).toContain('CRM');
    const about = [...editor.querySelectorAll<HTMLButtonElement>('button.question')];
    expect(about.map((b) => b.dataset.iri)).toEqual(expect.arrayContaining([archq('element-detail'), archq('views-showing'), am4q('impact-of-change')]));
    expect(about.some((b) => b.disabled)).toBe(false);
    entry(archq('views-showing')).click();
    await ui.sparqlEditor.updateComplete;
    expect(ui.sparqlEditor.getQuery()).toContain(`VALUES ?focus { <${crm}> }`);
    expect(editor.querySelector('tbody')!.textContent).toContain(views.getView(view)!.label);

    // Model checks, on request: beside the shapes' findings, scoped to the view, stale after an edit.
    ui.showBottomTab('validation');
    const panel = ui.validationPanel;
    expect(panel.checksAvailable).toBe(14);
    await panel.updateComplete;
    panel.shadowRoot!.querySelector<HTMLButtonElement>('.checks-btn')!.click();
    await vi.waitFor(() => expect(panel.checks).toBeDefined());
    expect([panel.checks!.ran, panel.checks!.failed]).toEqual([14, []]);
    const checksOn = (iri: string) => panel.checks!.results.filter((r) => r.focusNode.value === iri).map((r) => r.sourceShape.value);
    expect(checksOn(service)).toContain(am4q('unrealised-services'));
    expect(checksOn(crm)).toContain(am4q('applications-without-technology'));
    expect(checksOn(capability)).toContain(am4q('unrealised-capabilities'));
    panel.scope = 'view';
    expect(panel.shownResults.some((r) => r.focusNode.value === crm && r.sourceShape.value === am4q('applications-without-technology'))).toBe(true);
    expect(panel.shownResults.some((r) => r.focusNode.value === service)).toBe(false);
    app.components.eventBus.emit('model-changed', { origin: 'test' });
    expect(panel.checks!.stale).toBe(true);

    // A question's answer as a view, following the one viewpoint the question fits.
    const unrealised = ui.sparqlEditor.questionSource!().find((q) => q.iri === am4q('unrealised-capabilities'))!;
    expect(unrealised.viewpoints).toHaveLength(1);
    ui.showBottomTab('sparql');
    ui.sparqlEditor.ask(unrealised);
    await ui.sparqlEditor.updateComplete;
    script.answers.push('Unrealised capabilities');
    editor.querySelector<HTMLButtonElement>('.view-btn')!.click();
    await vi.waitFor(() => expect(views.getViews().some((v) => v.label === 'Unrealised capabilities')).toBe(true));
    const fromQuestion = views.getViews().find((v) => v.label === 'Unrealised capabilities')!;
    expect(fromQuestion.viewpointIri).toBe(unrealised.viewpoints[0]);
    expect(views.getNodes(fromQuestion.iri).map((n) => n.elementIri)).toContain(capability);
    expect(vi.mocked(script.dialogs.prompt).mock.calls.at(-1)?.[2]).toBe(unrealised.label);

    // Another model: the checks were the last one's.
    app.components.eventBus.emit('model-loaded', { modelIri: model });
    expect(panel.checks).toBeUndefined();

    app.session.deleteView(fromQuestion.iri);
    app.session.openView(view);
    for (const iri of [service, process, crm, capability]) els.deleteElement(iri);
  });

  it('undoes and redoes a property edit, and the canvas follows', async () => {
    const els = app.components.elementManager;
    const store = app.components.store;
    const view = app.session.activeViewIri!;
    const PREF_LABEL = NAMESPACES.skos + 'prefLabel';
    const placed = els.createElement(`${AM4}BusinessActor`, app.session.modelIri!, { label: 'Clerk' }).value;
    app.components.viewManager.addElementToView(view, placed, { x: 100, y: 300, width: 120, height: 55 });
    app.components.eventBus.emit('model-changed', { origin: 'test' });
    const edit = (detail: Record<string, unknown>, name = 'property-edit') =>
      ui.propertyPanel.dispatchEvent(new CustomEvent(name, { detail: { elementIri: placed, ...detail } }));

    edit({ predicate: PREF_LABEL, value: 'Cashier', language: 'en', previous: 'Clerk', previousLanguage: 'en' });
    expect([labelOf(store, placed), ui.diagramCanvas.getElement(placed)?.label]).toEqual(['Cashier', 'Cashier']);
    await ui.runCommand({ command: 'undo' });
    expect([labelOf(store, placed), ui.diagramCanvas.getElement(placed)?.label]).toEqual(['Clerk', 'Clerk']);
    await ui.runCommand({ command: 'redo' });
    expect([labelOf(store, placed), ui.diagramCanvas.getElement(placed)?.label]).toEqual(['Cashier', 'Cashier']);

    // Adding and removing a value are steps too.
    const notes = () => store.getQuads(nn(placed), nn(NAMESPACES.skos + 'note')).map((q) => q.object.value);
    edit({ predicate: NAMESPACES.skos + 'note', value: 'Counter staff' }, 'property-add');
    expect(notes()).toEqual(['Counter staff']);
    edit({ predicate: NAMESPACES.skos + 'note', value: 'Counter staff' }, 'property-remove');
    expect(notes()).toEqual([]);
    await ui.runCommand({ command: 'undo' });
    expect(notes()).toEqual(['Counter staff']);
    await ui.runCommand({ command: 'undo' });
    expect(notes()).toEqual([]);
    els.deleteElement(placed);
  });

  it('commits versions, compares them and restores one, undoably', async () => {
    const els = app.components.elementManager;
    const store = app.components.store;
    const history = ui.historyPanel;
    const placed = els.createElement(`${AM4}BusinessActor`, app.session.modelIri!, { label: 'Teller' }).value;
    app.components.viewManager.addElementToView(app.session.activeViewIri!, placed, { x: 100, y: 420, width: 120, height: 55 });
    app.components.eventBus.emit('model-changed', { origin: 'test' });
    ui.shell.showTab('history');
    const commit = async (message: string) => {
      const before = history.commits.length;
      history.dispatchEvent(new CustomEvent('history-commit', { detail: { message } }));
      await vi.waitFor(() => expect(history.commits.length).toBe(before + 1));
    };

    await commit('Teller added');
    const PREF_LABEL = NAMESPACES.skos + 'prefLabel';
    ui.propertyPanel.dispatchEvent(new CustomEvent('property-edit', {
      detail: { elementIri: placed, predicate: PREF_LABEL, value: 'Cashier', language: 'en', previous: 'Teller', previousLanguage: 'en' },
    }));
    await vi.waitFor(() => expect(history.working?.some((line) => line.includes('"Cashier"@en'))).toBe(true));
    await commit('Renamed');
    expect(history.commits.map((c) => c.message)).toEqual(['Renamed', 'Teller added']);

    // The second commit's changes are the rename: by element, the name old → new…
    await history.updateComplete;
    history.shadowRoot!.querySelector<HTMLElement>(`[data-commit="${history.commits[0].id}"]`)!.click();
    await history.updateComplete;
    const byElement = history.shadowRoot!.querySelector('model-diff-view')!;
    await byElement.updateComplete;
    const row = byElement.shadowRoot!.querySelector(`li.change[data-subject="${placed}"]`)!;
    expect(row.querySelector('.name')!.textContent!.trim()).toBe('Cashier');
    expect(row.querySelector('.type')!.textContent).toBe('Business Actor');
    expect(row.querySelector('ul.details')!.textContent!.trim()).toBe('Name (en): “Teller” → “Cashier”');
    // …and as triples: one name out, one in.
    history.shadowRoot!.querySelector<HTMLInputElement>('input[name="view"][value="triples"]')!.click();
    await history.updateComplete;
    expect(history.shadowRoot!.querySelector('pre.added')!.textContent).toContain('"Cashier"@en');
    expect(history.shadowRoot!.querySelector('pre.removed')!.textContent).toContain('"Teller"@en');

    // Restoring the first puts the old name back — on the canvas too — and undo takes it back.
    history.dispatchEvent(new CustomEvent('history-restore', { detail: { id: history.commits[1].id } }));
    await vi.waitFor(() => expect(labelOf(store, placed)).toBe('Teller'));
    expect(script.confirms.at(-1)).toBe('Restore this checkpoint');
    expect(ui.diagramCanvas.getElement(placed)?.label).toBe('Teller');
    await ui.runCommand({ command: 'undo' });
    expect(labelOf(store, placed)).toBe('Cashier');
    els.deleteElement(placed);
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
    const typePicker = async (iri: string) => {
      ui.selectConcept(iri);
      await ui.propertyPanel.updateComplete;
      const picker = root.querySelector<NamedPicker>('named-picker.type-picker');
      await picker?.updateComplete;
      return picker;
    };
    const openList = async (picker: NamedPicker) => {
      picker.shadowRoot!.querySelector('input')!.dispatchEvent(new Event('focus'));
      await picker.updateComplete;
    };
    const pick = async (picker: NamedPicker, typeIri: string) => {
      await openList(picker);
      picker.shadowRoot!.querySelector<HTMLElement>(`.option[data-iri="${typeIri}"]`)!.click();
      await vi.waitFor(() => expect(typesOf(ui.propertyPanel.selectedIri as string)).toContain(typeIri));
    };

    // In the view: the field shows the type's name and lists the loaded types, grouped as in the palette; the change is undoable.
    const inView = (await typePicker(placed))!;
    expect(inView.choice?.iri).toBe(`${AM4}BusinessActor`);
    expect(inView.shadowRoot!.querySelector('input')!.value).toBe('Business Actor');
    await openList(inView);
    expect([...inView.shadowRoot!.querySelectorAll('.group')].map((g) => g.textContent!.trim())).toContain('Business Domain');
    await pick(inView, `${AM4}ApplicationComponent`);
    expect(typesOf(placed)).toEqual([`${AM4}ApplicationComponent`]);
    expect(ui.diagramCanvas.getElement(placed)?.typeIri).toBe(`${AM4}ApplicationComponent`);
    expect(labelOf(app.components.store, placed)).toBe('Application Component'); // the default name follows
    await ui.runCommand({ command: 'undo' });
    expect(typesOf(placed)).toEqual([`${AM4}BusinessActor`]);

    // Not in the view (selected in the tree): changed in the model directly; its own name stays.
    const offCanvas = (await typePicker(unplaced))!;
    await pick(offCanvas, `${AM4}Role`);
    expect(typesOf(unplaced)).toEqual([`${AM4}Role`]);
    expect(labelOf(app.components.store, unplaced)).toBe('Clerk');
    await ui.propertyPanel.updateComplete;
    expect(ui.propertyPanel.heading?.typeLabel).toBe('Role');

    // A relationship's type stays read-only here.
    const rel = app.components.relationshipManager.createQualifiedRelationship!({ typeIri: `${AM4}Assignment`, sourceIri: placed, targetIri: unplaced, modelIri: model }).iri;
    expect(await typePicker(rel)).toBeNull();

    // The right-click menu on the shape: edit, relate, show, copy, delete.
    const shape = (ui.diagramCanvas.getDiagram() as unknown as { get(n: string): { get(id: string): unknown } }).get('elementRegistry').get(placed);
    const entries = ui.diagramCanvas.contextMenuProvider.getPopupMenuEntries(shape) as Record<string, { group: string; action: () => void }>;
    expect(Object.keys(entries)).toEqual(['rename', 'change-type', 'append', 'properties', 'reveal-tree', 'graph', 'ask', 'copy-iri', 'delete', 'delete-model']);
    entries['graph']!.action();
    expect([ui.shell.bottomTab, ui.graphPanel.rootIri]).toEqual(['graph', placed]);
    entries['properties']!.action();
    expect(ui.shell.bottomTab).toBe('properties');

    // On a relationship: its name and type, where to look at it and its ends, its IRI, deleting it.
    const other = els.createElement(`${AM4}BusinessActor`, model, { label: 'Teller' }).value;
    app.components.viewManager.addElementToView(view, other, { x: 400, y: 100, width: 120, height: 55 });
    const drawn = app.components.relationshipManager.createQualifiedRelationship!({ typeIri: `${AM4}Association`, sourceIri: placed, targetIri: other, modelIri: model }).iri;
    app.components.viewManager.addRelationshipToView(view, drawn);
    app.components.eventBus.emit('model-changed', { origin: 'test' });
    const registry = (ui.diagramCanvas.getDiagram() as unknown as { get(n: string): { get(id: string): unknown } }).get('elementRegistry');
    const line = ui.diagramCanvas.contextMenuProvider.getPopupMenuEntries(registry.get(drawn)) as Record<string, { action: () => void }>;
    expect(Object.keys(line)).toEqual([
      'rename', 'change-type', 'properties', 'reveal-tree', 'show-source', 'show-target', 'copy-iri', 'delete', 'delete-model',
    ]);

    // On the empty canvas: the open view's — what the model tree offers for a view — and the canvas's.
    const canvasRoot = (ui.diagramCanvas.getDiagram() as unknown as { get(n: string): { getRootElement(): unknown } }).get('canvas').getRootElement();
    const onView = ui.diagramCanvas.contextMenuProvider.getPopupMenuEntries(canvasRoot) as Record<string, { action: () => void }>;
    expect(Object.keys(onView)).toEqual([
      'rename-view', 'set-viewpoint', 'duplicate-view', 'select-all', 'zoom-fit', 'properties', 'reveal-tree', 'copy-iri', 'delete-view',
    ]);
    onView['properties']!.action();
    expect([ui.propertyPanel.selectedIri, ui.propertyPanel.heading?.kind]).toEqual([view, 'View']);
    onView['select-all']!.action();
    const selected = (ui.diagramCanvas.getDiagram() as unknown as { get(n: string): { get(): Array<{ id: string }> } }).get('selection').get();
    expect(selected.map((e) => e.id)).toEqual(expect.arrayContaining([placed, other, drawn]));
    app.components.relationshipManager.deleteRelationship!(drawn);
    els.deleteElement(other);

    ui.selectConcept(undefined);
    for (const iri of [placed, unplaced]) els.deleteElement(iri);
  });

  it('shows the open view when nothing is selected on the canvas, as a click on it in the tree does', () => {
    const view = app.session.activeViewIri!;
    const model = app.session.modelIri!;
    const els = app.components.elementManager;
    const diagram = ui.diagramCanvas.getDiagram() as unknown as { get(n: string): any };
    const placed = els.createElement(`${AM4}BusinessActor`, model, { label: 'Drawn' }).value;
    app.components.viewManager.addElementToView(view, placed, { x: 100, y: 500, width: 120, height: 55 });
    const elsewhere = els.createElement(`${AM4}BusinessActor`, model, { label: 'Not drawn' }).value;
    app.components.eventBus.emit('model-changed', { origin: 'test' });
    const shown = () => [ui.propertyPanel.selectedIri, ui.propertyPanel.heading?.kind];
    const clickCanvas = () =>
      diagram.get('eventBus').fire('element.click', { element: diagram.get('canvas').getRootElement(), originalEvent: new MouseEvent('click') });

    // Selected on the canvas, then a click on the empty canvas: the view.
    diagram.get('selection').select(diagram.get('elementRegistry').get(placed));
    expect(shown()).toEqual([placed, 'Element']);
    clickCanvas();
    expect(shown()).toEqual([view, 'View']);
    expect(diagram.get('selection').get()).toEqual([]);
    // Picked in the tree, nothing selected on the canvas — no selection to clear: the view all the same.
    ui.selectConcept(elsewhere);
    expect(shown()).toEqual([elsewhere, 'Element']);
    clickCanvas();
    expect(shown()).toEqual([view, 'View']);

    // Another view opened — nothing selected in it: that one.
    const second = app.components.viewManager.createView('Diagram', undefined, { label: 'Second', modelIri: model }).value;
    app.session.openView(second);
    expect(shown()).toEqual([second, 'View']);
    ui.selectConcept(elsewhere);
    app.session.openView(view);
    expect(shown()).toEqual([view, 'View']);

    app.components.viewManager.deleteView(second);
    app.components.eventBus.emit('views-changed', {});
    ui.selectConcept(undefined);
    for (const iri of [placed, elsewhere]) els.deleteElement(iri);
    app.components.eventBus.emit('model-changed', { origin: 'test' });
  });

  it('goes back and forward between the views opened — from the toolbar, the tree, the property panel — as they were left', async () => {
    const start = app.session.activeViewIri!;
    const model = app.session.modelIri!;
    const second = app.session.createView('Diagram', { label: 'Second', open: false });
    const third = app.session.createView('Diagram', { label: 'Third', open: false });
    // A concept in the second view, to find selected again on coming back.
    const actor = app.components.elementManager.createElement(`${AM4}BusinessActor`, model, { label: 'Back again' }).value;
    app.components.viewManager.addElementToView(second, actor, { x: 100, y: 100, width: 120, height: 55 });
    app.components.eventBus.emit('model-changed', { origin: 'test' });
    const at = () => app.session.activeViewIri;
    const labels = () => [ui.appToolbar.backLabel, ui.appToolbar.forwardLabel];

    // The toolbar's view list, then the tree, then the property panel's "Appears in views".
    await ui.runCommand({ command: 'open-view', value: second });
    ui.diagramCanvas.reveal(actor);
    ui.modelExplorer.dispatchEvent(new CustomEvent('explorer-action', { detail: { action: 'open-view', iri: third, kind: 'view' } }));
    await vi.waitFor(() => expect(at()).toBe(third));
    ui.propertyPanel.dispatchEvent(new CustomEvent('panel-open-view', { detail: { viewIri: start }, bubbles: true, composed: true }));
    expect(at()).toBe(start);
    expect(labels()).toEqual(['Third', '']);

    await ui.runCommand({ command: 'view-back' });
    expect(at()).toBe(third);
    await ui.runCommand({ command: 'view-back' });
    expect(at()).toBe(second);
    // As it was left: its concept selected again.
    expect(ui.diagramCanvas.selectedIris()).toEqual([actor]);
    expect(labels()).toEqual([expect.any(String), 'Third']);
    await ui.runCommand({ command: 'view-forward' });
    expect(at()).toBe(third);
    // Alt+← too.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true }));
    expect(at()).toBe(second);
    // Another view opened from here drops what was forward.
    await ui.runCommand({ command: 'open-view', value: start });
    expect(labels()).toEqual(['Second', '']);

    ui.selectConcept(undefined);
    app.components.elementManager.deleteElement(actor);
    for (const view of [second, third]) app.session.deleteView(view);
  });

  it('offers in the Metamodels menu the catalogue\u2019s entries Settings leaves there, and keeps the choice', async () => {
    {
      const AM3 = 'https://meta.linked.archi/archimate3/metamodel#ArchiMate3.2';
      const TOGAF = 'https://example.org/togaf/metamodel#TOGAF';
      ui.appToolbar.catalogue = [
        { iri: AM3, label: 'ArchiMate 3.2', kind: 'language' },
        { iri: TOGAF, label: 'TOGAF', kind: 'framework' },
      ];
      script.forms.push({ [`metamodels.${TOGAF}`]: false });
      await ui.runCommand({ command: 'settings' });
      const fields = vi.mocked(script.dialogs.form).mock.calls.at(-1)![1];
      // The section, the catalogue's groups, an entry each — offered, until unticked.
      expect(fields.filter((f) => f.name.startsWith('metamodels.')).map((f) => [f.type, f.label, f.value])).toEqual([
        ['group', 'Modelling languages', undefined],
        ['checkbox', 'ArchiMate 3.2', true],
        ['group', 'Frameworks', undefined],
        ['checkbox', 'TOGAF', true],
      ]);
      expect([...ui.appToolbar.hiddenCatalogue]).toEqual([TOGAF]);
      // Kept with the other personal settings (`la-gram:settings`): asked again, it is unticked.
      await ui.runCommand({ command: 'settings' });
      const again = vi.mocked(script.dialogs.form).mock.calls.at(-1)![1];
      expect(again.find((f) => f.name === `metamodels.${TOGAF}`)?.value).toBe(false);

      // The menu: TOGAF and its group gone, a way back to the choice saying how many are hidden.
      ui.appToolbar.shadowRoot!.querySelector<HTMLButtonElement>('button[data-menu="metamodels"]')!.click();
      await ui.appToolbar.updateComplete;
      const menu = ui.appToolbar.shadowRoot!.querySelector('.dropdown')!;
      const offered = [...menu.querySelectorAll('button[data-command="add-metamodel"]')].map((b) => b.getAttribute('data-value'));
      expect(offered).toEqual([AM3]);
      expect([...menu.querySelectorAll('.group')].map((g) => g.textContent!.trim())).not.toContain('Frameworks');
      expect(menu.querySelector('button[data-command="settings"]')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Choose which to show… 1 hidden');
      ui.appToolbar.shadowRoot!.querySelector<HTMLButtonElement>('button[data-menu="metamodels"]')!.click();

      // Ticked again: offered again.
      script.forms.push({ [`metamodels.${TOGAF}`]: true });
      await ui.runCommand({ command: 'settings' });
      expect(ui.appToolbar.hiddenCatalogue.size).toBe(0);
    }
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

    // Opening a view clears the canvas's undo history; that is not a change.
    const first = app.session.activeViewIri!;
    const other = app.components.viewManager.getViews().find((v) => v.iri !== first)!;
    app.session.openView(other.iri);
    app.session.openView(first);
    expect(app.isDirty()).toBe(false);
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

  it('makes folders in a group and files concepts — several at once, from the tree, by a drop, from the canvas — undoably, saved with the model', async () => {
    const modelIri = app.session.modelIri!;
    const view = app.session.activeViewIri!;
    const act = (detail: Record<string, unknown>) => ui.modelExplorer.dispatchEvent(new CustomEvent('explorer-action', { detail }));
    const drop = (detail: Record<string, unknown>) => ui.modelExplorer.dispatchEvent(new CustomEvent('explorer-move', { detail }));
    const folders = () => contents().folders ?? [];
    const folder = (label: string) => folders().find((f) => f.label === label);
    const members = (label: string) => (folder(label)?.members ?? []).slice().sort();
    const els = app.components.elementManager;
    const clerk = els.createElement(`${AM4}BusinessActor`, modelIri, { label: 'Clerk' }).value;
    const teller = els.createElement(`${AM4}BusinessActor`, modelIri, { label: 'Teller' }).value;

    // A model without folders: one made in the Elements group — in an Elements folder made with it — and one inside it.
    expect(folders()).toEqual([]);
    script.answers.push('Business');
    act({ action: 'new-folder', iri: '', kind: 'folder', folderKind: 'element' });
    await vi.waitFor(() => expect(folder('Business')).toBeDefined());
    expect(folder('Business')?.parentIri).toBe(folder('Elements')?.iri);
    expect(folder('Elements')).toMatchObject({ members: [] });
    expect(folder('Elements')?.parentIri).toBeUndefined();
    script.answers.push('Actors');
    act({ action: 'new-folder', iri: folder('Business')!.iri, kind: 'folder', folderKind: 'element' });
    await vi.waitFor(() => expect(folder('Actors')?.parentIri).toBe(folder('Business')!.iri));
    expect(folder('Actors')?.parentIri).toBeDefined();
    // In the tree, the Elements folder is the group, not a row of its own.
    const shown = () =>
      [...ui.modelExplorer.shadowRoot!.querySelectorAll<HTMLElement>('.row.folder[data-iri]')].map((r) => r.querySelector('.label')?.textContent);
    await vi.waitFor(() => expect(shown()).toEqual(['Business', 'Actors']));

    // Two at once, from the tree's menu; undone and done again.
    script.answers.push(folder('Actors')!.iri);
    act({ action: 'move-to-folder', iri: clerk, kind: 'element', folderKind: 'element', iris: [clerk, teller] });
    await vi.waitFor(() => expect(members('Actors')).toEqual([clerk, teller].sort()));
    // What was offered: no folder, and the group's folders by their path, each with the folders it is in.
    const asked = () => vi.mocked(script.dialogs.choose).mock.lastCall!;
    expect(asked()[0]).toBe('Move 2 elements to folder');
    expect(asked()[1].map((o) => [o.label, o.detail ?? '', o.group ?? ''])).toEqual([
      ['— No folder —', 'Directly under Elements', ''],
      ['Business', '', ''],
      ['Actors', 'in Business', ''],
    ]);
    await ui.runCommand({ command: 'undo' });
    expect(members('Actors')).toEqual([]);
    await ui.runCommand({ command: 'redo' });
    expect(members('Actors')).toEqual([clerk, teller].sort());

    // Dropped on a folder in the tree.
    drop({ iris: [teller], kind: 'element', folderIri: folder('Business')!.iri });
    expect(members('Business')).toEqual([teller]);
    expect(members('Actors')).toEqual([clerk]);

    // On the canvas: right-clicked among several selected, they go together — here out of their folders.
    app.components.viewManager.addElementToView(view, clerk, { x: 600, y: 300, width: 120, height: 55 });
    app.components.viewManager.addElementToView(view, teller, { x: 800, y: 300, width: 120, height: 55 });
    app.components.eventBus.emit('model-changed', { origin: 'test' });
    const registry = (ui.diagramCanvas.getDiagram() as unknown as { get(n: string): { get(id: string): unknown } }).get('elementRegistry');
    await vi.waitFor(() => expect(registry.get(teller)).toBeDefined());
    const menu = () => ui.diagramCanvas.contextMenuProvider.getPopupMenuEntries(registry.get(clerk)) as Record<string, { label: string; action: () => void }>;
    ui.diagramCanvas.selectIris([clerk, teller]);
    expect(Object.entries(menu()).map(([id, e]) => [id, e.label])).toEqual([['move-to-folder', 'Move 2 elements to folder…']]);
    script.answers.push('');
    menu()['move-to-folder']!.action();
    await vi.waitFor(() => expect(members('Business')).toEqual([]));
    // The folders last moved into first.
    expect(asked()[1].map((o) => [o.label, o.group ?? ''])).toEqual([
      ['— No folder —', ''],
      ['Business', 'Recent'],
      ['Actors', 'Recent'],
      ['Business', 'All folders'],
      ['Actors', 'All folders'],
    ]);
    expect(members('Actors')).toEqual([]);
    // One selected: among its other actions.
    ui.diagramCanvas.selectIris([clerk]);
    expect(Object.keys(menu())).toContain('move-to-folder');

    // Renamed; deleted, what it holds kept — Actors, now People, goes up to the Elements group with what is in it.
    drop({ iris: [clerk], kind: 'element', folderIri: folder('Actors')!.iri });
    script.answers.push('People');
    act({ action: 'rename-folder', iri: folder('Actors')!.iri, kind: 'folder', folderKind: 'element' });
    await vi.waitFor(() => expect(folder('People')).toBeDefined());
    act({ action: 'delete-folder', iri: folder('Business')!.iri, kind: 'folder', folderKind: 'element' });
    await vi.waitFor(() => expect(folder('Business')).toBeUndefined());
    expect(script.confirms).toContain('Delete folder');
    expect(folder('People')).toMatchObject({ parentIri: folder('Elements')!.iri, members: [clerk] });

    // Saved and opened again: still in its folder.
    const saved = app.saveModel('trig');
    const again = await createApp({ assetMode: 'offline', validationDelayMs: 1e9 });
    await again.openModel(saved.text, saved.fileName);
    const reopened = readModelContents(again.components.store, again.components.viewManager.getViews()).folders ?? [];
    expect(reopened.map((f) => [f.label, f.members]).sort()).toEqual([
      ['Elements', []],
      ['People', [clerk]],
    ]);

    // Left as found for the tests after.
    for (const f of ['People', 'Elements']) {
      act({ action: 'delete-folder', iri: folder(f)!.iri, kind: 'folder', folderKind: 'element' });
      await vi.waitFor(() => expect(folder(f)).toBeUndefined());
    }
    for (const iri of [clerk, teller]) {
      act({ action: 'delete-from-model', iri, kind: 'element' });
      await vi.waitFor(() => expect(app.components.store.getQuads(nn(iri))).toHaveLength(0));
    }
  }, 60_000);

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

    // An ArchiMate 3.2 model: its language's questions and the core's are offered, not ArchiMate 4.0's —
    // still loaded, but they would find nothing here.
    const declared = app.components.store
      .getQuads(nn(app.session.modelIri!), nn(NAMESPACES.arch + 'modelConformsToMetamodel'))
      .map((q) => q.object.value);
    expect(declared).toEqual(['https://meta.linked.archi/archimate3/metamodel#ArchiMate3.2']);
    expect(app.loadedMetamodels().some((m) => m.metamodelIri.includes('archimate4'))).toBe(true);
    const offered = ui.sparqlEditor.questionSource!();
    const from = (set: string) => offered.filter((q) => q.iri.startsWith(`https://meta.linked.archi/${set}#`)).length;
    expect([offered.length, from('core-questions'), from('archimate3/questions'), from('archimate4/questions')]).toEqual([37, 16, 21, 0]);
    expect(ui.validationPanel.checksAvailable).toBe(14);
    // "What realises each capability?" — ArchiMate 3.2's — asks the imported model.
    const capabilities = offered.find((q) => q.iri === 'https://meta.linked.archi/archimate3/questions#capability-realisation')!;
    expect(ui.sparqlEditor.ask(capabilities)).toMatchObject({ type: 'bindings' });
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
    expect(ui.validationPanel.results.some((r) => r.focusNode.value === web.iri && r.resultPath.value === NAMESPACES.skos + 'prefLabel')).toBe(false);
  });
});
