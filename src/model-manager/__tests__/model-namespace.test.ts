import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DataFactory } from 'n3';
import type { NamedNode, Quad } from '@rdfjs/types';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { ObservableRdfStore } from '../../rdf-engine/observable-store.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';
import {
  DEFAULT_MODEL_BASE,
  ensureNamespace,
  isPartNamed,
  mintIri,
  mintModelNamespace,
  mintShapeIri,
  modelIriIn,
  namespaceOfIri,
  namespaceProblem,
  partIri,
  pathSegment,
} from '../../rdf-engine/iri.js';
import { OxigraphElementManager } from '../element-manager.js';
import { OxigraphViewManager } from '../view-manager.js';
import { OxigraphRelationshipManager } from '../relationship-manager.js';
import { ModelSession } from '../model-session.js';
import { modelQuads } from '../model-queries.js';
import { derivedNamespace, isValidPrefix, planNamespaceChange, readModelNamespace } from '../model-namespace.js';

const nn = (v: string) => DataFactory.namedNode(v) as unknown as NamedNode;
const TYPE = 'https://example.org/lang#Component';
const REL = NAMESPACES.arch + 'rel';
/** The relationship's unqualified predicate, as a metamodel names it: the relationship reifies `source SERVES target`. */
const SERVES = 'https://example.org/lang#serves';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

describe('IRI minting', () => {
  it('mints {kind}/{uuid} in a namespace (DD-41)', () => {
    expect(mintIri('https://acme.com/ea/', 'element')).toMatch(new RegExp(`^https://acme\\.com/ea/element/${UUID}$`));
    expect(mintIri('https://acme.com/ea', 'view')).toMatch(new RegExp(`^https://acme\\.com/ea/view/${UUID}$`));
    expect(mintIri('https://acme.com/ea/', 'relationship')).toMatch(new RegExp(`^https://acme\\.com/ea/relationship/${UUID}$`));
    expect(mintIri('https://acme.com/ea/', 'folder')).toMatch(new RegExp(`^https://acme\\.com/ea/folder/${UUID}$`));
  });

  it('mints a shape in its view’s IRI, and flat in the model’s namespace where the view already holds a #', () => {
    const ns = () => 'https://acme.com/ea#';
    expect(mintShapeIri('https://acme.com/ea/view/v1', 'node', ns)).toMatch(new RegExp(`^https://acme\\.com/ea/view/v1#node/${UUID}$`));
    expect(mintShapeIri('https://acme.com/ea/view/v1', 'link', ns)).toMatch(new RegExp(`^https://acme\\.com/ea/view/v1#link/${UUID}$`));
    expect(mintShapeIri('https://acme.com/ea#view-1', 'node', ns)).toMatch(new RegExp(`^https://acme\\.com/ea#node-${UUID}$`));
  });

  it('names a part under its owner with /, and knows a part named either way', () => {
    const node = 'https://acme.com/ea/view/v1#node/n1';
    expect(partIri(node, 'style')).toBe(`${node}/style`);
    expect(partIri(node, 'style', '0a1b2c3d')).toBe(`${node}/style/0a1b2c3d`);
    const key = /[0-9a-f]{8}/;
    for (const own of [`${node}/style`, `${node}/style/0a1b2c3d`, `${node}-style`, `${node}-style-0a1b2c3d`]) {
      expect(isPartNamed(node, own, 'style', key)).toBe(true);
    }
    // Exactly: another node's style, a longer name, a key that is none.
    for (const other of [`${node}1/style`, `${node}-style-x`, `${node}/style/0a1b2c3d/more`, `${node}/stylesheet`, 'https://acme.com/other/style']) {
      expect(isPartNamed(node, other, 'style', key)).toBe(false);
    }
    expect(isPartNamed(node, `${node}/label`, 'label')).toBe(true);
    expect(isPartNamed(node, `${node}-label-expression`, 'label')).toBe(false);
  });

  it('encodes an identifier as the converters do', () => {
    expect(pathSegment('id-5120')).toBe('id-5120');
    expect(pathSegment('a b')).toBe('a%20b');
    expect(pathSegment("it's (x)!~")).toBe('it%27s%20%28x%29%21%7E');
    expect(pathSegment('Zürich')).toBe('Z%C3%BCrich');
  });

  it('gives a new model the DD-15 namespace {base}{notation}/{modelId}/ and names it {ns}model', () => {
    const ns = mintModelNamespace(undefined, 'archimate');
    expect(ns).toMatch(new RegExp(`^https://example\\.org/archimate/${UUID}/$`));
    expect(modelIriIn(ns)).toBe(`${ns}model`);
    expect(DEFAULT_MODEL_BASE).toBe('https://example.org/');
    expect(mintModelNamespace('https://acme.com/ea', 'bpmn')).toMatch(/^https:\/\/acme\.com\/ea\/bpmn\//);
  });

  it('knows a namespace when it sees one', () => {
    expect(ensureNamespace('https://a.org/x')).toBe('https://a.org/x/');
    expect(ensureNamespace('https://a.org/x#')).toBe('https://a.org/x#');
    expect(ensureNamespace('urn:acme:')).toBe('urn:acme:');
    expect(namespaceOfIri('https://a.org/x/view-1')).toBe('https://a.org/x/');
    expect(namespaceOfIri('https://a.org/x#view-1')).toBe('https://a.org/x#');
    expect(namespaceOfIri('urn:acme:view-1')).toBe('urn:acme:');
  });

  it('rejects what cannot be a namespace, and prefixes Turtle cannot write', () => {
    expect(namespaceProblem('https://acme.com/ea/')).toBeNull();
    expect(namespaceProblem('https://acme.com/ea')).toBeNull();
    expect(namespaceProblem('http://acme.com/ea/')).toBeNull();
    // DD-41: an https: or http: IRI, with no # or ? — a shape is named after its view with a #.
    expect(namespaceProblem('urn:acme:ea:')).toMatch(/https: or http:/);
    expect(namespaceProblem('https://acme.com/ea#')).toMatch(/# or a \?/);
    expect(namespaceProblem('https://acme.com/ea/?x=1')).toMatch(/# or a \?/);
    expect(namespaceProblem('')).toMatch(/empty/);
    expect(namespaceProblem('acme/ea')).toMatch(/absolute/);
    expect(namespaceProblem('https://acme.com/my model/')).toMatch(/characters/);
    expect(isValidPrefix('m')).toBe(true);
    expect(isValidPrefix('shop-2')).toBe(true);
    expect(isValidPrefix('2shop')).toBe(false);
    expect(isValidPrefix('a:b')).toBe(false);
  });
});

describe('the model namespace', () => {
  let store: ObservableRdfStore;
  let inner: OxigraphRdfStore;
  let elements: OxigraphElementManager;
  let views: OxigraphViewManager;
  let rels: OxigraphRelationshipManager;
  let emit: ReturnType<typeof vi.fn>;
  let session: ModelSession;

  beforeEach(() => {
    inner = new OxigraphRdfStore();
    store = new ObservableRdfStore(inner);
    elements = new OxigraphElementManager(store);
    views = new OxigraphViewManager(store);
    rels = new OxigraphRelationshipManager(store);
    emit = vi.fn();
    session = new ModelSession(store, elements, views, { emit });
  });
  afterEach(() => inner.dispose());

  /** A model with two elements, a relationship, and both drawn with a routed link. */
  function populate(modelIri: string, viewIri: string) {
    const a = elements.createElement(TYPE, modelIri, { label: 'A' }).value;
    const b = elements.createElement(TYPE, modelIri, { label: 'B' }).value;
    const rel = rels.createQualifiedRelationship({ typeIri: REL, predicateIri: SERVES, sourceIri: a, targetIri: b, modelIri }).iri;
    views.addElementToView(viewIri, a, { x: 0, y: 0, width: 100, height: 50 });
    views.addElementToView(viewIri, b, { x: 200, y: 0, width: 100, height: 50 });
    views.addRelationshipToView(viewIri, rel, [{ x: 100, y: 25 }, { x: 200, y: 25 }]);
    return { a, b, rel };
  }

  const subjects = () => [...new Set(modelQuads(store).map((q) => q.subject.value))];

  /** Every IRI a term holds — inside an RDF 1.2 triple term too, which has no value of its own. */
  const irisOf = (term: Quad['object']): string[] =>
    term.termType === 'Quad'
      ? [term.subject, term.predicate, term.object].flatMap((t) => irisOf(t as Quad['object']))
      : term.termType === 'NamedNode'
        ? [term.value]
        : [];
  const allIris = () => modelQuads(store).flatMap((q) => [q.subject, q.predicate, q.object].flatMap((t) => irisOf(t as Quad['object'])));
  /** What a relationship rdf:reifies: its triple term's subject, predicate and object. */
  const reified = (rel: string) =>
    store.getQuads(nn(rel), nn(NAMESPACES.rdf + 'reifies'), null).map((q) => {
      expect(q.object.termType).toBe('Quad');
      const t = q.object as unknown as Quad;
      return [t.subject.value, t.predicate.value, t.object.value];
    });

  it('is recorded on the model, and everything of the model is minted in it', () => {
    const ns = 'https://acme.com/ea/shop/';
    const { modelIri, viewIri } = session.newModel({ label: 'Shop', namespace: ns, prefix: 'shop' });
    expect(modelIri).toBe(`${ns}model`);
    expect(session.namespace()).toEqual({ namespace: ns, prefix: 'shop', declared: true });
    expect(viewIri).toMatch(new RegExp(`^${ns}view/${UUID}$`));

    const { a, rel } = populate(modelIri, viewIri);
    expect(a).toMatch(new RegExp(`^${ns}element/${UUID}$`));
    expect(rel).toMatch(new RegExp(`^${ns}relationship/${UUID}$`));
    const [node] = views.getNodes(viewIri);
    expect(node.nodeIri).toMatch(new RegExp(`^${viewIri}#node/${UUID}$`));
    const [link] = views.getLinks(viewIri);
    expect(link.linkIri).toMatch(new RegExp(`^${viewIri}#link/${UUID}$`));
    expect(subjects()).toContain(`${link.linkIri}/points/0`);
    expect(subjects()).toContain(`${link.linkIri}/point/1`);
    // Every subject is in the namespace, in the layout (DD-41): the model, {kind}/{id}, a shape in its view, a part under either.
    const layout = /^(?:model|(?:element|relationship|view|folder)\/[\w-]+(?:#(?:node|link)\/[\w-]+)?(?:\/[\w-]+)*)$/;
    expect(subjects().filter((s) => !s.startsWith(ns) || !layout.test(s.slice(ns.length)))).toEqual([]);
  });

  it('is derived for a model that declares none', () => {
    expect(derivedNamespace('https://acme.com/ea/shop/model')).toBe('https://acme.com/ea/shop/');
    expect(derivedNamespace('urn:la-gram:archimate/1234')).toBe('urn:la-gram:archimate/1234/');
    expect(derivedNamespace('https://acme.com/ea/shop#')).toBe('https://acme.com/ea/shop#');
    store.addQuads([DataFactory.quad(nn('urn:la-gram:archimate/1234'), nn(NAMESPACES.rdf + 'type'), nn(NAMESPACES.arch + 'Model')) as unknown as Quad]);
    expect(readModelNamespace(store, 'urn:la-gram:archimate/1234')).toEqual({
      namespace: 'urn:la-gram:archimate/1234/',
      prefix: 'm',
      declared: false,
    });
  });

  it('moves the whole model into a new namespace, and re-opens the same view there', () => {
    const { modelIri, viewIri } = session.newModel({ label: 'Shop' });
    const old = session.namespace()!.namespace;
    const { a, b, rel } = populate(modelIri, viewIri);
    expect(reified(rel)).toEqual([[a, SERVES, b]]);
    const before = modelQuads(store).length;
    emit.mockClear();

    const target = 'https://acme.com/ea/shop/';
    const mapping = session.setNamespace(target);

    expect(session.modelIri).toBe(`${target}model`);
    expect(session.namespace()).toEqual({ namespace: target, prefix: 'm', declared: true });
    expect(session.activeViewIri).toBe(mapping.get(viewIri));
    expect(session.activeViewIri).toBe(`${target}${viewIri.slice(old.length)}`);
    // Same statements (plus dcterms:modified), none left in the old namespace — inside triple terms neither.
    expect(modelQuads(store).length).toBe(before + 1);
    expect(allIris().filter((iri) => iri.startsWith(old))).toEqual([]);
    // What the relationship reifies names the moved elements: source, the same predicate, target.
    expect(reified(mapping.get(rel)!)).toEqual([[mapping.get(a), SERVES, mapping.get(b)]]);
    expect(views.getNodes(session.activeViewIri!)).toHaveLength(2);
    expect(views.getLinks(session.activeViewIri!)[0].waypoints).toEqual([{ x: 100, y: 25 }, { x: 200, y: 25 }]);
    expect(emit).toHaveBeenCalledWith('model-loaded', expect.objectContaining({ renamed: true }));
  });

  it('is one store change, so a collaborator receives it as one update', () => {
    const { modelIri, viewIri } = session.newModel({ label: 'Shop' });
    populate(modelIri, viewIri);
    const changes = vi.fn();
    store.subscribe(changes);
    session.setNamespace('https://acme.com/ea/shop/');
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it('leaves existing IRIs alone when asked, and mints new ones in the new namespace', () => {
    const { modelIri, viewIri } = session.newModel({ label: 'Shop' });
    const { a } = populate(modelIri, viewIri);
    const target = 'https://acme.com/ea/shop/';
    expect(session.setNamespace(target, { rename: false }).size).toBe(0);
    expect(session.modelIri).toBe(modelIri);
    expect(store.getQuads(nn(a)).length).toBeGreaterThan(0);
    expect(elements.createElement(TYPE, modelIri).value).toMatch(new RegExp(`^${target}element/${UUID}$`));
  });

  it('changes only the prefix when the namespace stays', () => {
    const { modelIri } = session.newModel({ label: 'Shop' });
    const ns = session.namespace()!.namespace;
    expect(session.setNamespace(ns, { prefix: 'shop' }).size).toBe(0);
    expect(session.modelIri).toBe(modelIri);
    expect(session.namespace()).toEqual({ namespace: ns, prefix: 'shop', declared: true });
  });

  it('keeps every local part when it moves a model: a converter’s nested names, la-gram’s flat ones, a shape in its view', () => {
    const legacy = 'urn:la-gram:archimate/1234';
    const quads = [
      [legacy, NAMESPACES.rdf + 'type', NAMESPACES.arch + 'Model'],
      [`${legacy}/element/e1`, NAMESPACES.rdf + 'type', TYPE],
      [`${legacy}/element/e1`, NAMESPACES.arch + 'inModel', legacy],
      [`${legacy}/element-e2`, NAMESPACES.rdf + 'type', TYPE],
      [`${legacy}/element-e2`, NAMESPACES.arch + 'inModel', legacy],
      [`${legacy}/view/v1`, NAMESPACES.rdf + 'type', NAMESPACES.arch + 'View'],
      [`${legacy}/view/v1`, NAMESPACES.arch + 'inModel', legacy],
      [`${legacy}/view/v1/node/n1`, NAMESPACES['arch-vis'] + 'view', `${legacy}/view/v1`],
      [`${legacy}/view/v1#node/n2`, NAMESPACES['arch-vis'] + 'view', `${legacy}/view/v1`],
    ].map(([s, p, o]) => DataFactory.quad(nn(s), nn(p), nn(o)) as unknown as Quad);
    store.addQuads(quads);
    session.adopt({ emit: false });
    expect(session.modelIri).toBe(legacy);

    const target = 'https://acme.com/ea/legacy/';
    const mapping = session.setNamespace(target);
    expect(mapping.get(legacy)).toBe(`${target}model`);
    expect(mapping.get(`${legacy}/element/e1`)).toBe(`${target}element/e1`);
    expect(mapping.get(`${legacy}/element-e2`)).toBe(`${target}element-e2`);
    expect(mapping.get(`${legacy}/view/v1/node/n1`)).toBe(`${target}view/v1/node/n1`);
    expect(mapping.get(`${legacy}/view/v1#node/n2`)).toBe(`${target}view/v1#node/n2`);
    expect(store.getQuads(nn(`${target}element/e1`), nn(NAMESPACES.arch + 'inModel')).map((q) => q.object.value)).toEqual([
      `${target}model`,
    ]);
    expect(session.activeViewIri).toBe(`${target}view/v1`);
  });

  it('does not rename vocabulary terms that happen to sit in the old namespace', () => {
    const { modelIri } = session.newModel({ label: 'Shop' });
    const ns = session.namespace()!.namespace;
    const term = `${ns}ownedBy`;
    store.addQuads([
      DataFactory.quad(nn(term), nn(NAMESPACES.rdf + 'type'), nn(NAMESPACES.owl + 'ObjectProperty'), nn('urn:vocab')) as unknown as Quad,
    ]);
    const a = elements.createElement(TYPE, modelIri).value;
    store.addQuads([DataFactory.quad(nn(a), nn(term), nn(modelIri)) as unknown as Quad]);
    const plan = planNamespaceChange(store, modelIri, ns, 'https://acme.com/ea/shop/');
    expect(plan.mapping.has(term)).toBe(false);
    expect(plan.mapping.has(a)).toBe(true);
  });

  it('follows a collaborator who moved the model: same view, new IRIs', () => {
    const { modelIri, viewIri } = session.newModel({ label: 'Shop' });
    populate(modelIri, viewIri);
    // A second session over the same data stands in for the collaborator.
    const peer = new ModelSession(store, elements, views);
    peer.adopt({ emit: false });
    peer.openView(viewIri);
    peer.setNamespace('https://acme.com/ea/shop/');
    emit.mockClear();

    expect(session.resync()).toBe(true);
    expect(session.modelIri).toBe(peer.modelIri);
    expect(session.activeViewIri).toBe(peer.activeViewIri);
    expect(emit).toHaveBeenCalledWith('model-loaded', expect.objectContaining({ remote: true }));
    // Nothing to follow the second time.
    expect(session.resync()).toBe(false);
  });
});
