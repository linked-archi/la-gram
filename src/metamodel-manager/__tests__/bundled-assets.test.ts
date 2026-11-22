import { describe, it, expect } from 'vitest';
import { N3TtlParser } from '../../rdf-engine/ttl-parser.js';
import {
  ASSET_ROOT,
  BUNDLED_ASSETS,
  BUNDLED_ICON_PREFIXES,
  PUBLISHED_BASE_URI,
  fetchAllAssetTexts,
  fetchAssetText,
  getAssetByIri,
  getAssetsByRole,
  resolveIconUri,
  resolveIconUriOrPassThrough,
  BUNDLED_METAMODELS,
  getBundledMetamodel,
  type BundledAssetRole,
} from '../bundled-assets.js';

describe('bundled asset registry', () => {
  it('finds an ontology by its owl:versionIRI too, as meta’s relationship tables import it', () => {
    const byVersion = getAssetByIri('https://meta.linked.archi/archimate4/onto/4.0#');
    expect(byVersion?.ontologyIri).toBe('https://meta.linked.archi/archimate4/onto#');
    expect(getAssetByIri('https://meta.linked.archi/archimate3/onto/3.2#')?.path).toBe('archimate3/archimate3.2-onto.ttl');
  });

  it('bundles each language’s relationship tables, outside the shapes graph', () => {
    for (const id of ['archimate4', 'archimate3']) {
      expect(getAssetsByRole('relationshipTables', id)).toHaveLength(1);
    }
  });

  it('describes every bundled TTL with a role, graph IRI and path', () => {
    // Six core files (the core question set and the core notation among them), thirteen per ArchiMate version
    // (4.0 and 3.2, their question sets among them), and Basic's six: manifest, ontology, taxonomy, its two
    // notation sets and its presentation contexts; four for each extension, decisions and processes.
    expect(BUNDLED_ASSETS).toHaveLength(46);
    expect(getAssetsByRole('coreQuestions').map((a) => a.ontologyIri)).toEqual(['https://meta.linked.archi/core-questions#']);
    // The core's own relationship types' notation, which no manifest names (VC-DD-5).
    expect(getAssetsByRole('coreNotation').map((a) => [a.ontologyIri, a.path, a.metamodel])).toEqual([
      ['https://meta.linked.archi/core-notation#', 'core/core-notation.ttl', undefined],
    ]);
    expect(getAssetsByRole('questions').map((a) => [a.metamodel, a.ontologyIri])).toEqual([
      ['archimate4', 'https://meta.linked.archi/archimate4/questions#'],
      ['archimate3', 'https://meta.linked.archi/archimate3/questions#'],
    ]);
    for (const asset of BUNDLED_ASSETS) {
      expect(asset.ontologyIri.startsWith(PUBLISHED_BASE_URI)).toBe(true);
      expect(asset.path.endsWith('.ttl')).toBe(true);
      expect(asset.path.startsWith('/')).toBe(false);
    }
  });

  it('covers every single-valued role exactly once per bundled language', () => {
    const roles: BundledAssetRole[] = ['manifest', 'ontology', 'taxonomy', 'presentationContexts'];
    for (const metamodel of BUNDLED_METAMODELS.filter((m) => m.id !== 'arch-decision' && m.id !== 'arch-processes')) {
      for (const role of roles) {
        expect(getAssetsByRole(role, metamodel.id), `${metamodel.id}/${role}`).toHaveLength(1);
      }
    }
    // The decision extension: a manifest, its vocabulary — with the relationship types that draw its links — a
    // taxonomy and its shapes; no notation and no presentation contexts.
    expect(getAssetsByRole('manifest', 'arch-decision')).toHaveLength(1);
    expect(getAssetsByRole('ontology', 'arch-decision').map((a) => a.ontologyIri)).toEqual(['https://meta.linked.archi/arch-decision#']);
    expect(getAssetsByRole('taxonomy', 'arch-decision')).toHaveLength(1);
    expect(getAssetsByRole('shapes', 'arch-decision')).toHaveLength(1);
    expect(getAssetsByRole('presentationContexts', 'arch-decision')).toHaveLength(0);
    // The processes extension, the same four.
    for (const role of ['manifest', 'ontology', 'taxonomy', 'shapes'] as const) {
      expect(getAssetsByRole(role, 'arch-processes'), `arch-processes/${role}`).toHaveLength(1);
    }
    expect(getAssetsByRole('ontology', 'arch-processes').map((a) => a.ontologyIri)).toEqual(['https://meta.linked.archi/arch-processes#']);
    for (const id of ['archimate4', 'archimate3']) {
      for (const role of ['notation', 'viewpoints', 'referenceData', 'questions'] as const) {
        expect(getAssetsByRole(role, id), `${id}/${role}`).toHaveLength(1);
      }
      // arch:formalRules names four shapes graphs per ArchiMate version.
      expect(getAssetsByRole('shapes', id)).toHaveLength(4);
    }
    // Basic: no shapes, viewpoints or reference data; two notation sets, the
    // default (rectangles) and the bubbles a presentation context selects.
    expect(getAssetsByRole('shapes', 'basic')).toHaveLength(0);
    expect(getAssetsByRole('notation', 'basic').map((a) => a.ontologyIri)).toEqual([
      'https://meta.linked.archi/basic/notation#',
      'https://meta.linked.archi/basic/notation-bubble#',
    ]);
    // No metamodel of la-gram's own: the core is the core ontology, not a metamodel.
    expect(getBundledMetamodel('https://meta.linked.archi/core/metamodel#Core')).toBeUndefined();
    expect(getAssetsByRole('coreOntology')).toHaveLength(1);
    expect(getAssetsByRole('coreVisOntology')).toHaveLength(1);
    expect(getAssetsByRole('coreShapes')).toHaveLength(2);
  });

  it('finds a bundled metamodel by subject IRI, manifest IRI or id', () => {
    const am4 = BUNDLED_METAMODELS[0];
    expect(getBundledMetamodel('https://meta.linked.archi/archimate4/metamodel#ArchiMate4')).toBe(am4);
    expect(getBundledMetamodel('https://meta.linked.archi/archimate4/metamodel#')).toBe(am4);
    expect(getBundledMetamodel('https://meta.linked.archi/archimate4/metamodel')).toBe(am4);
    expect(getBundledMetamodel('archimate3')?.label).toBe('ArchiMate 3.2');
    expect(getBundledMetamodel('https://meta.linked.archi/basic/metamodel#Basic')?.id).toBe('basic');
    expect(getBundledMetamodel('https://example.org/other#')).toBeUndefined();
  });

  it('orders the core ontologies before the files that import them', () => {
    const coreIndex = BUNDLED_ASSETS.findIndex((a) => a.role === 'coreOntology');
    const coreVisIndex = BUNDLED_ASSETS.findIndex((a) => a.role === 'coreVisOntology');
    const notationIndex = BUNDLED_ASSETS.findIndex((a) => a.role === 'notation');

    expect(coreIndex).toBeLessThan(notationIndex);
    expect(coreVisIndex).toBeLessThan(notationIndex);
  });

  it('looks assets up by graph IRI', () => {
    const onto = getAssetByIri('https://meta.linked.archi/archimate4/onto#');
    expect(onto?.role).toBe('ontology');
    expect(onto?.path).toBe('archimate4/archimate4-onto.ttl');
    // Basic's ontology is named without a fragment, as its manifest names it.
    expect(getAssetByIri('https://meta.linked.archi/basic')?.path).toBe('basic/basic-onto.ttl');

    expect(getAssetByIri('https://example.org/not-bundled#')).toBeUndefined();
  });
});

describe('icon URI resolution', () => {
  it('rewrites the published base to an asset-root-relative path', () => {
    expect(resolveIconUri('https://meta.linked.archi/archimate4/icons/business-actor.svg')).toBe(
      'archimate4/icons/business-actor.svg',
    );
  });

  it('preserves the glyphs subdirectory', () => {
    expect(resolveIconUri('https://meta.linked.archi/archimate4/icons/glyphs/role.svg')).toBe(
      'archimate4/icons/glyphs/role.svg',
    );
  });

  it('reports icon sets that are not bundled as unresolvable', () => {
    // Published, but C4's icons are not part of this bundle.
    expect(resolveIconUri('https://meta.linked.archi/c4/icons/person.svg')).toBeNull();
  });

  it('resolves the core-vis decoration markers to the bundle — every one the vocabulary names', async () => {
    expect(resolveIconUri('https://meta.linked.archi/core-vis/markers/open-arrowhead.svg')).toBe('core-vis/markers/open-arrowhead.svg');
    const { readFileSync, existsSync } = await import('node:fs');
    const vocabulary = readFileSync(new URL('../../../assets/core/core-vis-onto.ttl', import.meta.url), 'utf8');
    const symbols = [...vocabulary.matchAll(/arch-vis:decorSymbol\s+"([^"]+)"/g)].map((m) => m[1]!);
    expect(symbols.length).toBe(7);
    for (const uri of symbols) {
      const path = resolveIconUri(uri);
      expect(path, uri).not.toBeNull();
      expect(existsSync(new URL(`../../../assets/${path}`, import.meta.url)), uri).toBe(true);
    }
  });

  it('returns null for URIs outside the published base', () => {
    expect(resolveIconUri('https://example.org/icons/thing.svg')).toBeNull();
    expect(resolveIconUri('archimate4/icons/role.svg')).toBeNull();
  });

  it('passes unresolvable URIs through unchanged in the lenient helper', () => {
    expect(resolveIconUriOrPassThrough('https://example.org/icons/thing.svg')).toBe(
      'https://example.org/icons/thing.svg',
    );
    expect(
      resolveIconUriOrPassThrough('https://meta.linked.archi/archimate4/icons/node.svg'),
    ).toBe('archimate4/icons/node.svg');
  });

  it('resolves every bundled icon prefix', () => {
    for (const prefix of BUNDLED_ICON_PREFIXES) {
      expect(resolveIconUri(`${PUBLISHED_BASE_URI}${prefix}example.svg`)).toBe(
        `${prefix}example.svg`,
      );
    }
  });
});

describe('Node-side asset loading', () => {
  it('reads a bundled TTL off disk and parses it with N3TtlParser', async () => {
    const onto = getAssetsByRole('ontology')[0];
    const ttl = await fetchAssetText(onto);

    expect(ttl.length).toBeGreaterThan(0);
    expect(ttl).toContain('<https://meta.linked.archi/archimate4/onto#>');

    const parser = new N3TtlParser();
    const result = parser.parse(ttl);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Non-zero quad count: the asset really loaded, it is not an empty stub.
    expect(result.quads.length).toBeGreaterThan(0);
    // Floor well below the 927 quads the current file yields, so a truncated or
    // placeholder copy is caught while an upstream asset refresh is not.
    expect(result.quads.length).toBeGreaterThan(500);
    expect(parser.prefixes.arch).toBe('https://meta.linked.archi/core#');
  });

  it('accepts an asset-root-relative path as well as a registry entry', async () => {
    const ttl = await fetchAssetText('core/core-vis-onto.ttl');
    expect(ttl).toContain('<https://meta.linked.archi/core-vis#>');
  });

  it('parses every bundled asset without error', async () => {
    const loaded = await fetchAllAssetTexts();
    expect(loaded).toHaveLength(BUNDLED_ASSETS.length);

    for (const { asset, ttl } of loaded) {
      const result = new N3TtlParser().parse(ttl);
      expect(result.ok, `${asset.path} failed to parse`).toBe(true);
      if (result.ok) {
        expect(result.quads.length, `${asset.path} produced no quads`).toBeGreaterThan(0);
      }
    }
  });

  it('reports a missing asset rather than returning empty text', async () => {
    await expect(fetchAssetText('archimate4/does-not-exist.ttl')).rejects.toThrow();
  });

  it('exposes the asset root the webpack copy target uses', () => {
    expect(ASSET_ROOT).toBe('assets');
  });
});

describe('the bundled Architecture Decisions extension', () => {
  it('loads offline beside ArchiMate, with its element types in two groups and its links as relationship types', async () => {
    const { OxigraphRdfStore } = await import('../../rdf-engine/rdf-store.js');
    const { N3TtlParser } = await import('../../rdf-engine/ttl-parser.js');
    const { N3MetamodelLoader } = await import('../metamodel-loader.js');
    const { SparqlPaletteGenerator } = await import('../palette-generator.js');
    const { qualifiedFormOf, unqualifiedFormOf } = await import('../../model-manager/cascade.js');
    const store = new OxigraphRdfStore();
    const loader = new N3MetamodelLoader(new N3TtlParser(), store);
    const am4 = await loader.loadBundledMetamodel('archimate4');
    const decisions = await loader.loadBundledMetamodel('arch-decision');
    expect(decisions.assets.filter((a) => a.outcome !== 'loaded' && a.outcome !== 'already-loaded')).toEqual([]);

    const documents = (m: typeof am4) => ({
      iri: m.metamodelIri,
      label: m.info.name,
      documents: m.assets.map((a) => a.documentIri),
      conceptDocuments: m.assets.filter((a) => a.via === 'arch:modelConcepts').map((a) => a.documentIri),
    });
    const palette = new SparqlPaletteGenerator(store).generatePalette(undefined, {
      metamodelIris: [am4.metamodelIri, decisions.metamodelIri],
      metamodels: [documents(am4), documents(decisions)],
    });
    const AD = 'https://meta.linked.archi/arch-decision#';
    const group = (name: string) => palette.elementGroups.find((g) => g.category === name)?.elements.map((e) => e.label);
    expect(group('Decision Record')?.sort()).toEqual(['Decision', 'Issue', 'Option']);
    expect(group('Forces')).toHaveLength(11);
    expect(palette.completeness).toBeUndefined();
    const relationship = (iri: string) => palette.relationshipTypes.find((r) => r.iri === iri);
    expect(relationship(`${AD}ModifiesConcept`)).toMatchObject({ label: 'Modifies', unqualifiedPredicateIri: `${AD}modifiesConcept` });
    // Each metamodel's relationship types keep their own categories.
    expect(relationship(`${AD}ModifiesConcept`)?.category).toBe('Change Links');
    expect(relationship(`${AD}DependsOn`)?.category).toBe('Decision Map Links');
    expect(relationship(`${AD}IssueOwner`)?.category).toBe('Stakeholder Links');
    expect(relationship(`${AD}AppliedInOption`)?.category).toBe('Issue and Design Links');
    expect(relationship(`${AD}OpposingForce`)?.category).toBe('Force Links');
    // Conflicting decisions, opposing and complementary forces: no direction, a plain line.
    for (const symmetric of ['ConflictsWith', 'OpposingForce', 'ComplementaryForce']) {
      expect(relationship(`${AD}${symmetric}`)?.relationshipStyle, symmetric).toBeUndefined();
    }
    expect(relationship(`${AD}SupersededBy`)?.relationshipStyle?.targetDecor).toBe('OpenArrowhead');
    expect(relationship('https://meta.linked.archi/archimate4/onto#Composition')?.category).toBe('Structural Relationship');
    // An influence is drawn as one of its two kinds, each reached by Force Influence's qualified property.
    expect(relationship(`${AD}ForceInfluence`)).toBeUndefined();
    expect(unqualifiedFormOf(store, `${AD}SupportingInfluence`)).toBe(`${AD}influencedByForce`);
    expect(qualifiedFormOf(store, `${AD}SupportingInfluence`)).toBe(`${AD}hasInfluence`);
    expect(qualifiedFormOf(store, `${AD}ModifiesConcept`)).toBe(`${AD}qualifiedModifiesConcept`);
  }, 60_000);

  it('loads the bundled processes extension with no network: its three groups and thirteen relationship types in their categories', async () => {
    const { OxigraphRdfStore } = await import('../../rdf-engine/rdf-store.js');
    const { N3TtlParser } = await import('../../rdf-engine/ttl-parser.js');
    const { N3MetamodelLoader } = await import('../metamodel-loader.js');
    const { SparqlPaletteGenerator } = await import('../palette-generator.js');
    const store = new OxigraphRdfStore();
    const loader = new N3MetamodelLoader(new N3TtlParser(), store);
    const processes = await loader.loadBundledMetamodel('arch-processes');
    expect(processes.assets.filter((a) => a.outcome !== 'loaded' && a.outcome !== 'already-loaded')).toEqual([]);
    const palette = new SparqlPaletteGenerator(store).generatePalette(undefined, {
      metamodelIris: [processes.metamodelIri],
      metamodels: [{
        iri: processes.metamodelIri,
        label: processes.info.name,
        documents: processes.assets.map((a) => a.documentIri),
        conceptDocuments: processes.assets.filter((a) => a.via === 'arch:modelConcepts').map((a) => a.documentIri),
      }],
    });
    expect(palette.elementGroups.map((g) => g.category)).toEqual(['Process Structure', 'Deliverables', 'Roles']);
    const own = palette.relationshipTypes.filter((r) => !r.core);
    expect(own.map((r) => r.iri.replace('https://meta.linked.archi/arch-processes#', 'ap:')).sort()).toEqual([
      'ap:ApprovedBy', 'ap:Governs', 'ap:HasActivity', 'ap:HasSubProcess', 'ap:HasTask',
      'ap:Input', 'ap:MilestoneOfProcess', 'ap:Output', 'ap:PerformedBy', 'ap:Precedes',
      'ap:RelatedProcess', 'ap:ResponsibleFor', 'ap:TriggeredBy',
    ]);
    // A related process has no direction: a plain line. The others lead somewhere.
    expect(own.find((r) => r.iri.endsWith('#RelatedProcess'))?.relationshipStyle).toBeUndefined();
    expect(own.find((r) => r.iri.endsWith('#ResponsibleFor'))?.relationshipStyle?.targetDecor).toBe('OpenArrowhead');
    expect(new Set(own.map((r) => r.category))).toEqual(
      new Set(['Structure Links', 'Flow Links', 'Responsibility Links', 'Governance Links']),
    );
    expect(palette.completeness).toBeUndefined();
    store.dispose();
  }, 60_000);
});
