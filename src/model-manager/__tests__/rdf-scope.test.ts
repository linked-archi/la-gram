/**
 * Part of the model as statements — what the RDF panel shows for the open view
 * or the selection: the right subjects, each with its route lists, and nothing
 * of another view or of the vocabularies.
 */
import { describe, it, expect } from 'vitest';
import { createApp } from '../../app.js';
import { conceptStatements, viewStatements } from '../rdf-scope.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';

const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const VIS = NAMESPACES['arch-vis'];

describe('the statements of a view or a concept', () => {
  it('gives a view its own, its concepts’ and its diagram’s — routes included — and a concept its own and its drawing there', async () => {
    const app = await createApp({ assetMode: 'offline', validationDelayMs: 1e9, validation: 'inline' });
    const { modelIri, viewIri } = app.newModel('Scopes');
    const { elementManager: e, relationshipManager: r, viewManager: v } = app.components;
    const portal = e.createElement(AM4 + 'ApplicationComponent', modelIri, { label: 'Portal' }).value;
    const clerk = e.createElement(AM4 + 'BusinessActor', modelIri, { label: 'Clerk' }).value;
    const elsewhere = e.createElement(AM4 + 'BusinessActor', modelIri, { label: 'Elsewhere' }).value;
    v.addElementToView(viewIri, portal, { x: 0, y: 0, width: 120, height: 55 });
    v.addElementToView(viewIri, clerk, { x: 400, y: 0, width: 120, height: 55 });
    const serving = r.createQualifiedRelationship!({ typeIri: AM4 + 'Serving', sourceIri: portal, targetIri: clerk, modelIri }).iri;
    v.addRelationshipToView(viewIri, serving, [{ x: 120, y: 27 }, { x: 260, y: -40 }, { x: 400, y: 27 }]);
    const other = v.createView('Diagram', undefined, { label: 'Other', modelIri }).value;
    v.addElementToView(other, elsewhere, { x: 0, y: 0, width: 120, height: 55 });
    v.addElementToView(other, portal, { x: 50, y: 50, width: 120, height: 55 });

    const view = viewStatements(app.components.store, viewIri);
    const subjects = new Set(view.map((q) => q.subject.value));
    for (const iri of [viewIri, portal, clerk, serving]) expect(subjects.has(iri), iri).toBe(true);
    expect(subjects.has(elsewhere)).toBe(false);
    // Its diagram: the two nodes and the link, and the link's route — cells and points.
    const drawnIn = (quads: typeof view, viewIri: string) =>
      quads.filter((q) => q.predicate.value === VIS + 'view' && q.object.value === viewIri).length;
    expect(drawnIn(view, viewIri)).toBe(3);
    expect(drawnIn(view, other)).toBe(0);
    const routePoints = view.filter((q) => q.predicate.value === VIS + 'point-x');
    expect(routePoints.map((q) => Number(q.object.value)).sort((a, b) => a - b)).toEqual([120, 260, 400]);
    // Only the model graph: no vocabulary statement about a type.
    expect(view.every((q) => q.graph.termType === 'DefaultGraph')).toBe(true);
    expect(subjects.has(AM4 + 'ApplicationComponent')).toBe(false);

    // A concept: its own statements, and how it is drawn in the open view — not elsewhere.
    const concept = conceptStatements(app.components.store, portal, viewIri);
    expect(new Set(concept.map((q) => q.subject.value)).has(portal)).toBe(true);
    expect(drawnIn(concept, viewIri)).toBe(1);
    expect(drawnIn(concept, other)).toBe(0);
    // Without a view, only its own.
    expect(conceptStatements(app.components.store, portal).every((q) => q.subject.value === portal)).toBe(true);
    // A selection of several: each one's statements, and each one's drawing in the open view.
    const both = conceptStatements(app.components.store, [portal, clerk], viewIri);
    const bothSubjects = new Set(both.map((q) => q.subject.value));
    expect([bothSubjects.has(portal), bothSubjects.has(clerk), bothSubjects.has(serving)]).toEqual([true, true, false]);
    expect(drawnIn(both, viewIri)).toBe(2);
  }, 120_000);
});
