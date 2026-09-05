import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RdfPaletteProvider } from '../rdf-palette-provider.js';
import type { PaletteDefinition } from '../../../metamodel-manager/interfaces.js';
import type { ElementManager, Bounds } from '../../../model-manager/interfaces.js';

function createMockElementManager(): ElementManager {
  return {
    createElement: vi.fn(),
    updateProperty: vi.fn(),
    deleteElement: vi.fn(),
    updateLayout: vi.fn(),
  };
}

const MODEL_IRI = 'https://example.org/model/test';

function createTestPalette(): PaletteDefinition {
  return {
    elementGroups: [
      {
        category: 'Business',
        elements: [
          { iri: 'arch:BusinessProcess', label: 'Business Process', iconUrl: 'bp.svg', isAbstract: false },
          { iri: 'arch:BusinessActor', label: 'Business Actor', isAbstract: false },
          { iri: 'arch:AbstractBusiness', label: 'Abstract Business', isAbstract: true },
        ],
      },
      {
        category: 'Application',
        elements: [
          { iri: 'arch:AppComponent', label: 'Application Component', iconUrl: 'ac.svg', isAbstract: false },
        ],
      },
    ],
    relationshipTypes: [],
  };
}

describe('RdfPaletteProvider', () => {
  let provider: RdfPaletteProvider;
  let elementManager: ElementManager;
  let palette: PaletteDefinition;

  beforeEach(() => {
    elementManager = createMockElementManager();
    palette = createTestPalette();
    provider = new RdfPaletteProvider(palette, elementManager, MODEL_IRI);
  });

  it('generates entries for all concrete element types', () => {
    const entries = provider.getPaletteEntries();
    const keys = Object.keys(entries);

    // 2 concrete Business + 1 concrete Application = 3 entries (abstract excluded)
    expect(keys).toHaveLength(3);
  });

  it('excludes abstract element types', () => {
    const entries = provider.getPaletteEntries();
    const titles = Object.values(entries).map((e) => e.title);

    expect(titles).not.toContain('Abstract Business');
  });

  it('sets correct group from category', () => {
    const entries = provider.getPaletteEntries();
    const bpEntry = Object.values(entries).find((e) => e.title === 'Business Process');

    expect(bpEntry?.group).toBe('Business');
  });

  it('includes imageUrl when iconUrl is present', () => {
    const entries = provider.getPaletteEntries();
    const bpEntry = Object.values(entries).find((e) => e.title === 'Business Process');
    const baEntry = Object.values(entries).find((e) => e.title === 'Business Actor');

    expect(bpEntry?.imageUrl).toBe('bp.svg');
    expect(baEntry?.imageUrl).toBeUndefined();
  });

  it('click action calls createElement with correct type', () => {
    const entries = provider.getPaletteEntries();
    const bpEntry = Object.values(entries).find((e) => e.title === 'Business Process')!;

    bpEntry.action.click({ x: 200, y: 300 });

    expect(elementManager.createElement).toHaveBeenCalledWith(
      'arch:BusinessProcess',
      MODEL_IRI,
      { x: 200, y: 300, width: 130, height: 60 },
    );
  });

  it('dragstart action calls createElement', () => {
    const entries = provider.getPaletteEntries();
    const acEntry = Object.values(entries).find((e) => e.title === 'Application Component')!;

    acEntry.action.dragstart({ x: 50, y: 75 });

    expect(elementManager.createElement).toHaveBeenCalledWith(
      'arch:AppComponent',
      MODEL_IRI,
      { x: 50, y: 75, width: 130, height: 60 },
    );
  });

  it('uses default position when event has no coordinates', () => {
    const entries = provider.getPaletteEntries();
    const bpEntry = Object.values(entries).find((e) => e.title === 'Business Process')!;

    bpEntry.action.click({});

    expect(elementManager.createElement).toHaveBeenCalledWith(
      'arch:BusinessProcess',
      MODEL_IRI,
      { x: 100, y: 100, width: 130, height: 60 },
    );
  });

  it('returns empty entries for empty palette', () => {
    const emptyProvider = new RdfPaletteProvider(
      { elementGroups: [], relationshipTypes: [] },
      elementManager,
      MODEL_IRI,
    );
    const entries = emptyProvider.getPaletteEntries();

    expect(Object.keys(entries)).toHaveLength(0);
  });

  it('updatePaletteDefinition changes the entries', () => {
    const newPalette: PaletteDefinition = {
      elementGroups: [
        {
          category: 'Technology',
          elements: [
            { iri: 'arch:Node', label: 'Node', isAbstract: false },
          ],
        },
      ],
      relationshipTypes: [],
    };

    provider.updatePaletteDefinition(newPalette);
    const entries = provider.getPaletteEntries();

    expect(Object.keys(entries)).toHaveLength(1);
    expect(Object.values(entries)[0]
.title).toBe('Node');
  });
});
