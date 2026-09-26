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
import { modelQuads, readModelContents } from '../model-manager/model-queries.js';
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
