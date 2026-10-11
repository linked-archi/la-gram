/**
 * ArchiMate Model Exchange File Format (Open Group, 3.x) → Linked.Archi RDF.
 *
 * The exchange format is what every ArchiMate tool — Archi, BiZZdesign,
 * Sparx — can write, so it is the practical way into this tool for an existing
 * model. It is an ArchiMate **3.x** format, so it maps onto the ArchiMate 3.2
 * ontology (`https://meta.linked.archi/archimate3/onto#`), which ships with the
 * application for exactly this reason.
 *
 * ## Two steps
 *
 * 1. {@link parseArchiMateExchange} reads the XML into a plain structure:
 *    elements, relationships, property values, and every diagram with its
 *    (absolutely positioned, possibly nested) nodes and its connections'
 *    bendpoints. Pure; no RDF.
 * 2. {@link applyExchangeModel} writes that structure through the *same*
 *    element, relationship and view managers the editor uses. An imported model
 *    is therefore indistinguishable from a hand-drawn one: qualified
 *    relationships with their unqualified triples, `arch:inModel` on every
 *    concept, `arch-vis:ArchNode`s and `arch-vis:Link`s in `arch:Diagram`s.
 *
 * ## What maps to what
 *
 * | Exchange                              | RDF                                            |
 * |---------------------------------------|------------------------------------------------|
 * | `<element xsi:type="BusinessActor">`  | `am3:BusinessActor` (`AndJunction` → `am3:Junction_And`) |
 * | `<relationship xsi:type="Serving">`   | `am3:Serving` + `source am3:serves target`     |
 * | `<relationship xsi:type="Access" accessType="Read">` | `am3:ReadAccess` (`Write`, the default → `am3:WriteAccess`; `ReadWrite` → `am3:ReadWriteAccess`; `Access` → `am3:Access`) |
 * | `<relationship xsi:type="Association" isDirected="true">` | `am3:DirectedAssociation` |
 * | `<name>` / `<documentation>`          | `skos:prefLabel` / `skos:definition`, language-tagged |
 * | `<property propertyDefinitionRef>`    | `<model>/property/<slug>` with the value       |
 * | `<view xsi:type="Diagram">`           | `arch:Diagram` (+ viewpoint when it resolves)   |
 * | `<node elementRef x y w h>`           | `arch-vis:ArchNode` with bounds                 |
 * | a `<node>` inside another             | `arch-vis:inNode` to its nearest element ancestor |
 * | `<connection relationshipRef>`        | `arch-vis:Link`, bendpoints as its route        |
 *
 * Types the loaded ontology does not define are reported, not invented.
 * Nodes that stand for no element (labels, visual groups) are counted and
 * skipped: core-vis has `arch-vis:ContainerNode` for them, but this editor does
 * not draw them yet. A second placement of one element in one view is skipped
 * too — the editor keeps one placement per element per view.
 */

import { DataFactory } from 'n3';
import type { Term } from '@rdfjs/types';
import type { ElementManager, Point, RelationshipManager, ViewManager } from '../model-manager/interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { ensureNamespace } from '../rdf-engine/iri.js';
import { derivedNamespace } from '../model-manager/model-namespace.js';

/** The ArchiMate 3.2 ontology namespace exchange types map into. */
export const ARCHIMATE_NS = 'https://meta.linked.archi/archimate3/onto#';
/** The ArchiMate 3.2 metamodel an imported model conforms to. */
export const ARCHIMATE3_METAMODEL = 'https://meta.linked.archi/archimate3/metamodel#ArchiMate3.2';

const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

/** Exchange type names that the ontology spells differently. */
const TYPE_ALIASES: Record<string, string> = {
  AndJunction: 'Junction_And',
  OrJunction: 'Junction_Or',
};

/**
 * The exchange format's `accessType` values, as the ontology's kinds of access
 * (subclasses of Access). `Access` is the unspecified kind.
 */
const ACCESS_KINDS: Record<string, string> = {
  Read: 'ReadAccess',
  Write: 'WriteAccess',
  ReadWrite: 'ReadWriteAccess',
  Access: 'Access',
};

// ── Parsed structure ──────────────────────────────────────────────────────

/** A property value on an element, relationship or the model. */
export interface ExchangeProperty {
  name: string;
  value: string;
}

/** An element or relationship from the exchange file. */
export interface ExchangeConcept {
  id: string;
  type: string;
  name?: string;
  documentation?: string;
  lang?: string;
  properties: ExchangeProperty[];
}

/** A relationship: a concept with ends. */
export interface ExchangeRelationship extends ExchangeConcept {
  source: string;
  target: string;
  /** An access's `accessType` attribute, when the file gives one (the format's default is `Write`). */
  accessType?: string;
  /** An association's `isDirected="true"`. */
  isDirected?: boolean;
}

/** A node on a diagram, absolute coordinates. */
export interface ExchangeNode {
  id: string;
  /** The `xsi:type` of the node — `Element`, `Container`, `Label`. */
  kind: string;
  elementRef?: string;
  /** The node it is drawn inside, when nested. */
  parentId?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A connection on a diagram. */
export interface ExchangeConnection {
  id: string;
  relationshipRef?: string;
  /** Node ids. */
  source: string;
  target: string;
  bendpoints: Point[];
}

/** A diagram. */
export interface ExchangeView {
  id: string;
  name?: string;
  viewpoint?: string;
  nodes: ExchangeNode[];
  connections: ExchangeConnection[];
}

/** Everything read from one exchange file. */
export interface ExchangeModel {
  name?: string;
  documentation?: string;
  lang?: string;
  elements: ExchangeConcept[];
  relationships: ExchangeRelationship[];
  views: ExchangeView[];
}

// ── XML helpers ───────────────────────────────────────────────────────────

/** Children of `parent` with the given local name (any namespace), direct only. */
export function getChildElements(parent: Element, localName: string): Element[] {
  return Array.from(parent.children).filter((child) => child.localName === localName);
}

/** Text of the first direct child with the given local name, trimmed, or `null`. */
export function getChildText(parent: Element, localName: string): string | null {
  const child = getChildElements(parent, localName)[0];
  const text = child?.textContent?.trim();
  return text ? text : null;
}

/** `xsi:type`, however the file spelled it. */
export function getXsiType(el: Element): string | null {
  return el.getAttributeNS(XSI, 'type') || el.getAttribute('xsi:type') || el.getAttribute('type') || null;
}

function langOf(el: Element | undefined): string | undefined {
  if (!el) return undefined;
  return el.getAttributeNS(XML_NS, 'lang') || el.getAttribute('xml:lang') || undefined;
}

function num(el: Element, attribute: string): number {
  const n = Number(el.getAttribute(attribute));
  return Number.isFinite(n) ? n : 0;
}

// ── Parse ─────────────────────────────────────────────────────────────────

/**
 * Read an exchange file.
 *
 * @throws when the text is not well-formed XML or not an exchange model.
 */
export function parseArchiMateExchange(xml: string): ExchangeModel {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Not well-formed XML');
  }
  const root = doc.documentElement;
  if (root.localName !== 'model') {
    throw new Error(`Not an ArchiMate exchange file (root element <${root.localName}>)`);
  }

  // Property definitions: id → name.
  const propertyNames = new Map<string, string>();
  for (const defs of getChildElements(root, 'propertyDefinitions')) {
    for (const def of getChildElements(defs, 'propertyDefinition')) {
      const id = def.getAttribute('identifier');
      const name = getChildText(def, 'name');
      if (id && name) propertyNames.set(id, name);
    }
  }
  const propertiesOf = (el: Element): ExchangeProperty[] => {
    const out: ExchangeProperty[] = [];
    for (const block of getChildElements(el, 'properties')) {
      for (const prop of getChildElements(block, 'property')) {
        const ref = prop.getAttribute('propertyDefinitionRef') ?? '';
        const value = getChildText(prop, 'value');
        const name = propertyNames.get(ref) ?? ref;
        if (name && value !== null) out.push({ name, value });
      }
    }
    return out;
  };
  const concept = (el: Element): ExchangeConcept => {
    const nameEl = getChildElements(el, 'name')[0];
    const lang = langOf(nameEl);
    return {
      id: el.getAttribute('identifier') ?? '',
      type: getXsiType(el) ?? '',
      ...(getChildText(el, 'name') ? { name: getChildText(el, 'name') as string } : {}),
      ...(getChildText(el, 'documentation') ? { documentation: getChildText(el, 'documentation') as string } : {}),
      ...(lang ? { lang } : {}),
      properties: propertiesOf(el),
    };
  };

  const model: ExchangeModel = { elements: [], relationships: [], views: [] };
  const modelName = getChildText(root, 'name');
  if (modelName) model.name = modelName;
  const modelDoc = getChildText(root, 'documentation');
  if (modelDoc) model.documentation = modelDoc;
  const modelLang = langOf(getChildElements(root, 'name')[0]);
  if (modelLang) model.lang = modelLang;

  for (const block of getChildElements(root, 'elements')) {
    for (const el of getChildElements(block, 'element')) model.elements.push(concept(el));
  }
  for (const block of getChildElements(root, 'relationships')) {
    for (const el of getChildElements(block, 'relationship')) {
      const accessType = el.getAttribute('accessType');
      model.relationships.push({
        ...concept(el),
        source: el.getAttribute('source') ?? '',
        target: el.getAttribute('target') ?? '',
        ...(accessType ? { accessType } : {}),
        ...(el.getAttribute('isDirected') === 'true' ? { isDirected: true } : {}),
      });
    }
  }

  for (const views of getChildElements(root, 'views')) {
    for (const diagrams of getChildElements(views, 'diagrams')) {
      for (const viewEl of getChildElements(diagrams, 'view')) {
        const view: ExchangeView = {
          id: viewEl.getAttribute('identifier') ?? '',
          nodes: [],
          connections: [],
        };
        const name = getChildText(viewEl, 'name');
        if (name) view.name = name;
        const viewpoint = viewEl.getAttribute('viewpoint');
        if (viewpoint) view.viewpoint = viewpoint;

        const walk = (parent: Element, parentId?: string): void => {
          for (const nodeEl of getChildElements(parent, 'node')) {
            const id = nodeEl.getAttribute('identifier') ?? '';
            view.nodes.push({
              id,
              kind: getXsiType(nodeEl) ?? 'Element',
              ...(parentId ? { parentId } : {}),
              ...(nodeEl.getAttribute('elementRef') ? { elementRef: nodeEl.getAttribute('elementRef') as string } : {}),
              x: num(nodeEl, 'x'),
              y: num(nodeEl, 'y'),
              w: num(nodeEl, 'w'),
              h: num(nodeEl, 'h'),
            });
            walk(nodeEl, id);
          }
        };
        walk(viewEl);

        for (const connEl of getChildElements(viewEl, 'connection')) {
          view.connections.push({
            id: connEl.getAttribute('identifier') ?? '',
            ...(connEl.getAttribute('relationshipRef')
              ? { relationshipRef: connEl.getAttribute('relationshipRef') as string }
              : {}),
            source: connEl.getAttribute('source') ?? '',
            target: connEl.getAttribute('target') ?? '',
            bendpoints: getChildElements(connEl, 'bendpoint').map((bp) => ({ x: num(bp, 'x'), y: num(bp, 'y') })),
          });
        }
        model.views.push(view);
      }
    }
  }
  return model;
}

// ── Map ───────────────────────────────────────────────────────────────────

/** The ontology class for an exchange type name. */
export function exchangeTypeIri(xsiType: string, namespace = ARCHIMATE_NS): string {
  return namespace + (TYPE_ALIASES[xsiType] ?? xsiType);
}

/**
 * A relationship's class: its `xsi:type`, made specific by the attributes the
 * ontology models as subclasses — an access's `accessType` (absent means
 * `Write`, the format's default) and an association's `isDirected`. When the
 * loaded ontology lacks the subclass, the type itself.
 */
export function exchangeRelationshipTypeIri(
  rel: ExchangeRelationship,
  namespace = ARCHIMATE_NS,
  known: (iri: string) => boolean = () => true,
): string {
  const kind =
    rel.type === 'Access'
      ? ACCESS_KINDS[rel.accessType ?? 'Write']
      : rel.type === 'Association' && rel.isDirected
        ? 'DirectedAssociation'
        : undefined;
  const specific = kind ? namespace + kind : undefined;
  return specific && known(specific) ? specific : exchangeTypeIri(rel.type, namespace);
}

/** Dependencies of {@link applyExchangeModel}: the editor's own managers. */
export interface ApplyExchangeDeps {
  elements: ElementManager;
  relationships: RelationshipManager;
  views: ViewManager;
  modelIri: string;
  /** Whether the loaded ontology defines a class; unknown types are reported. */
  knownClass?: (iri: string) => boolean;
  /** Resolve an exchange viewpoint name (`Layered`) to a viewpoint IRI. */
  viewpointFor?: (name: string) => string | undefined;
  /** Namespace of the ArchiMate vocabulary the exchange types map into. */
  namespace?: string;
  /**
   * The model's namespace, where the imported concepts are named
   * (`m:element-{exchange id}`); derived from `modelIri` when omitted.
   */
  modelNamespace?: string;
}

/** What {@link applyExchangeModel} did. */
export interface ImportReport {
  elementCount: number;
  relationshipCount: number;
  viewCount: number;
  nodeCount: number;
  connectionCount: number;
  /** Exchange types no loaded ontology defines. */
  unrecognizedTypes: string[];
  /** Nodes standing for no element, or repeating one already placed. */
  skippedNodes: number;
}

/** An IRI-safe local part from an exchange identifier. */
function safeId(id: string): string {
  return encodeURIComponent(id.trim() || 'unnamed').replace(/%/g, '_');
}

/** A property-name slug. */
function slug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'property';
}

/**
 * Where a line from a rectangle's centre towards `toward` leaves the
 * rectangle — so an imported route docks on the shape's edge rather than
 * starting inside it.
 */
function clipToRect(rect: { x: number; y: number; w: number; h: number }, toward: Point): Point {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = dx === 0 ? Infinity : rect.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : rect.h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: Math.round(cx + dx * s), y: Math.round(cy + dy * s) };
}

/**
 * Write a parsed exchange model into the store as a Linked.Archi model.
 *
 * The caller owns the model resource (`deps.modelIri`) and clears whatever was
 * in the store before; this adds the concepts and views.
 */
export function applyExchangeModel(model: ExchangeModel, deps: ApplyExchangeDeps): ImportReport {
  const ns = deps.namespace ?? ARCHIMATE_NS;
  const known = deps.knownClass ?? (() => true);
  const report: ImportReport = {
    elementCount: 0,
    relationshipCount: 0,
    viewCount: 0,
    nodeCount: 0,
    connectionCount: 0,
    unrecognizedTypes: [],
    skippedNodes: 0,
  };
  const unrecognized = new Set<string>();
  const iriOf = new Map<string, string>();
  // Exchange identifiers are kept — a re-import names the same concepts alike.
  const base = ensureNamespace(deps.modelNamespace ?? derivedNamespace(deps.modelIri));
  const literal = (value: string, lang?: string) =>
    DataFactory.literal(value, lang ?? model.lang ?? 'en') as unknown as Term;

  const writeExtras = (iri: string, concept: ExchangeConcept) => {
    if (concept.documentation) {
      deps.elements.updateProperty(iri, NAMESPACES.skos + 'definition', literal(concept.documentation, concept.lang));
    }
    for (const prop of concept.properties) {
      deps.elements.updateProperty(iri, `${base}property-${slug(prop.name)}`, DataFactory.literal(prop.value) as unknown as Term);
    }
  };

  for (const el of model.elements) {
    const typeIri = exchangeTypeIri(el.type, ns);
    if (!el.type || !known(typeIri)) {
      if (el.type) unrecognized.add(el.type);
      continue;
    }
    const iri = deps.elements.createElement(typeIri, deps.modelIri, {
      iri: `${base}element-${safeId(el.id)}`,
      label: el.name ?? el.type,
      ...(el.lang ?? model.lang ? { language: el.lang ?? model.lang } : {}),
    }).value;
    iriOf.set(el.id, iri);
    writeExtras(iri, el);
    report.elementCount += 1;
  }

  // Relationships may point at relationships, so resolve in passes until stable.
  const pending = [...model.relationships];
  let progressed = true;
  while (pending.length > 0 && progressed) {
    progressed = false;
    for (let i = 0; i < pending.length; ) {
      const rel = pending[i];
      const typeIri = exchangeRelationshipTypeIri(rel, ns, known);
      if (!rel.type || !known(typeIri)) {
        if (rel.type) unrecognized.add(rel.type);
        pending.splice(i, 1);
        continue;
      }
      const source = iriOf.get(rel.source);
      const target = iriOf.get(rel.target);
      if (!source || !target) {
        i += 1;
        continue;
      }
      const iri = `${base}relationship-${safeId(rel.id)}`;
      if (deps.relationships.createQualifiedRelationship) {
        deps.relationships.createQualifiedRelationship({
          typeIri,
          sourceIri: source,
          targetIri: target,
          modelIri: deps.modelIri,
          iri,
          ...(rel.name ? { label: rel.name } : {}),
        });
      }
      iriOf.set(rel.id, iri);
      writeExtras(iri, rel);
      report.relationshipCount += 1;
      pending.splice(i, 1);
      progressed = true;
    }
  }

  for (const view of model.views) {
    const viewIri = deps.views.createView('Diagram', view.viewpoint ? deps.viewpointFor?.(view.viewpoint) : undefined, {
      iri: `${base}view-${safeId(view.id)}`,
      label: view.name ?? 'View',
      modelIri: deps.modelIri,
    }).value;
    report.viewCount += 1;

    const nodeRect = new Map<string, ExchangeNode>();
    const nodeElement = new Map<string, string>();
    for (const node of view.nodes) {
      const elementIri = node.elementRef ? iriOf.get(node.elementRef) : undefined;
      if (!elementIri || deps.views.getNode(viewIri, elementIri)) {
        report.skippedNodes += 1;
        continue;
      }
      deps.views.addElementToView(viewIri, elementIri, { x: node.x, y: node.y, width: node.w || 120, height: node.h || 55 });
      nodeRect.set(node.id, node);
      nodeElement.set(node.id, elementIri);
      report.nodeCount += 1;
    }

    // Nested nodes: inside their nearest ancestor that stands for an element (a
    // visual group in between is not drawn).
    const byId = new Map(view.nodes.map((node) => [node.id, node]));
    for (const [nodeId, elementIri] of nodeElement) {
      let ancestor = byId.get(nodeId)?.parentId;
      while (ancestor && !nodeElement.has(ancestor)) ancestor = byId.get(ancestor)?.parentId;
      if (ancestor) deps.views.setNodeParent?.(viewIri, elementIri, nodeElement.get(ancestor));
    }

    for (const conn of view.connections) {
      const relIri = conn.relationshipRef ? iriOf.get(conn.relationshipRef) : undefined;
      const src = nodeRect.get(conn.source);
      const tgt = nodeRect.get(conn.target);
      if (!relIri || !src || !tgt) continue;
      const route =
        conn.bendpoints.length > 0
          ? [clipToRect(src, conn.bendpoints[0]), ...conn.bendpoints, clipToRect(tgt, conn.bendpoints[conn.bendpoints.length - 1])]
          : undefined;
      if (deps.views.addRelationshipToView(viewIri, relIri, route)) report.connectionCount += 1;
    }
  }

  report.unrecognizedTypes = [...unrecognized].sort();
  return report;
}
