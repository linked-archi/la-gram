/**
 * Tests for `createApp()` — the real bootstrap, no stubs.
 *
 * Two things matter here and nowhere else:
 * 1. Startup actually loads the bundled metamodel, so the palette has content.
 * 2. Startup survives an unreadable asset bundle. A rejected `createApp()` in the
 *    browser means a blank screen; an empty palette is recoverable.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createApp } from '../app.js';
import { configureAssetRoot } from '../metamodel-manager/bundled-assets.js';

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
