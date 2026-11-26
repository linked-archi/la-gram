/**
 * Tests for `createApp()` — the real bootstrap, no stubs.
 *
 * Two things matter here and nowhere else:
 * 1. Startup actually loads the bundled metamodel, so the palette has content.
 * 2. Startup survives an unreadable asset bundle. A rejected `createApp()` in the
 *    browser means a blank screen; an empty palette is recoverable.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { DataFactory } from 'n3';
import { createApp } from '../app.js';
import { configureAssetRoot } from '@linked-archi/kernel/metamodel-manager/bundled-assets.js';

describe('createApp', () => {
  afterEach(() => {
    configureAssetRoot(null);
    vi.restoreAllMocks();
  });

  it('loads the bundled ArchiMate 4.0 metamodel at startup', async () => {
    const app = await createApp();

    expect(app.loadedMetamodel).not.toBeNull();
    expect(app.loadedMetamodel?.metamodelIri).toBe(
      'https://meta.linked.archi/archimate4/metamodel#ArchiMate4',
    );

    // The palette is real, not a placeholder.
    const palette = app.components.paletteGenerator.generatePalette(
      app.loadedMetamodel!.metamodelIri,
    );
    expect(palette.elementGroups.flatMap((g) => g.elements).length).toBeGreaterThan(0);
    expect(palette.elementGroups.length).toBeGreaterThan(1);
    expect(palette.relationshipTypes.length).toBeGreaterThan(0);
  });

  it('reads which properties take one value from the loaded metamodels, not from the model', async () => {
    const app = await createApp();
    const VIS = 'https://meta.linked.archi/core-vis#';
    const ARCH = 'https://meta.linked.archi/core#';
    const EX = 'https://example.org/vocab#';
    const component = () => ['https://meta.linked.archi/archimate4/onto#ApplicationComponent'];
    // A model claiming a property functional is not a rule.
    app.components.store.addQuads([
      DataFactory.quad(
        DataFactory.namedNode(`${EX}colour`),
        DataFactory.namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
        DataFactory.namedNode('http://www.w3.org/2002/07/owl#FunctionalProperty'),
      ) as never,
    ]);
    const rules = app.singleValued();
    expect(rules.limitOf(`${VIS}fillColor`, component)).toBe('one');
    expect(rules.limitOf(`${ARCH}inModel`, component)).toBe('one');
    expect(rules.limitOf(`${ARCH}inView`, component)).toBeUndefined();
    expect(rules.limitOf(`${EX}colour`, component)).toBeUndefined();
    // Kept until the metamodels change.
    expect(app.singleValued()).toBe(rules);
    await app.loadMetamodel('https://meta.linked.archi/basic/metamodel#Basic');
    expect(app.singleValued()).not.toBe(rules);
  });

  it('opening a model that declares a metamodel not loaded yet leaves nothing of the model before it in the file it saves', async () => {
    const app = await createApp({ assetMode: 'offline', validationDelayMs: 1e9 });
    const before = app.session.modelIri!;
    await app.openModel(
      `@prefix arch: <https://meta.linked.archi/core#> .
<https://example.org/m/model> a arch:Model ; arch:modelConformsToMetamodel <https://meta.linked.archi/archimate3/metamodel#ArchiMate3.2> .
`,
      'old.ttl',
    );
    // Loading ArchiMate 3.2 for it once wrote "the model before conforms to 3.2 and 4.0" among its triples.
    const saved = app.saveModel('turtle').text;
    expect(saved).not.toContain(before.slice(0, before.lastIndexOf('/')));
    expect(app.session.metamodelIris()).toEqual(['https://meta.linked.archi/archimate3/metamodel#ArchiMate3.2']);
  }, 60_000);

  it('emits metamodel-loaded once the UI has had a chance to subscribe', async () => {
    const app = await createApp();

    const seen: string[] = [];
    app.components.eventBus.on('metamodel-loaded', (e) => {
      seen.push(e.detail?.metamodelIri as string);
    });

    expect(app.announceLoadedMetamodel()).toBe(true);
    expect(seen).toEqual(['https://meta.linked.archi/archimate4/metamodel#ArchiMate4']);
  });

  it('still starts with an empty palette when the assets cannot be read', async () => {
    // Point asset resolution at a directory that has no `assets/` in it.
    configureAssetRoot('/nonexistent-la-gram-asset-root');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    const app = await createApp();

    expect(app.loadedMetamodel).toBeNull();
    expect(app.announceLoadedMetamodel()).toBe(false);
    expect(errors).toHaveBeenCalled();

    const palette = app.components.paletteGenerator.generatePalette();
    expect(palette.elementGroups).toEqual([]);
    expect(palette.relationshipTypes).toEqual([]);
  });
});
