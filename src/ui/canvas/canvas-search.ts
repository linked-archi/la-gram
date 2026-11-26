/**
 * Search on the canvas (Req 23.2–23.5; `.agents/tasks/search/`): the open diagram's placements and lines whose name,
 * figure text or type's name holds the text, in reading order; the current one selected and scrolled into view;
 * each outlined (SR-DD-2). What the canvas is — its shapes, a type's name, selecting, scrolling, markers — is the
 * host's.
 */

import type { RdfBusinessObject } from './rdf-renderer.js';

/** Every match's marker; the current one's too. */
export const SEARCH_MATCH_MARKER = 'la-search-match';
export const SEARCH_CURRENT_MARKER = 'la-search-current';

/** The height of a row of reading order (SR-3): shapes whose tops are this close read left to right. */
const ROW = 20;

interface Point {
  x: number;
  y: number;
}

/** What a canvas shape carries that the search reads. */
export interface SearchShape {
  id: string;
  x?: number;
  y?: number;
  waypoints?: Point[];
  businessObject?: RdfBusinessObject;
  labelTarget?: unknown;
}

/** What the search needs of the canvas. */
export interface CanvasSearchHost {
  /** Every placement and line of the open diagram: no root, no external labels. */
  shapes(): SearchShape[];
  /** A type's name, as the palette shows it. */
  typeLabel(typeIri: string): string | undefined;
  select(shapes: SearchShape[]): void;
  /** Scroll it into view. */
  reveal(shape: SearchShape): void;
  mark(shape: SearchShape, marker: string, on: boolean): void;
}

/** What the find bar shows: the text, how many match, which is current (−1 for none). */
export interface CanvasSearchState {
  query: string;
  count: number;
  current: number;
}

const words = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * What a shape is found by (SR-2): its name — an element's, a relationship's, a figure's text, a view reference's
 * view — its own text where it shows one, and, for an element or a relationship, its type's name.
 */
export function searchTextsOf(object: RdfBusinessObject | undefined, typeLabel: (typeIri: string) => string | undefined): string[] {
  if (!object) return [];
  const texts: string[] = [];
  if (object.label) texts.push(object.label);
  if (object.labelText) texts.push(object.labelText);
  if ((object.kind === 'element' || object.kind === 'relationship') && object.typeIri) {
    const type = typeLabel(object.typeIri);
    if (type) texts.push(type);
  }
  return texts;
}

/** Whether any of the texts holds the query: case ignored, runs of white space as one. */
export function textsMatch(texts: readonly string[], query: string): boolean {
  const q = words(query);
  return q !== '' && texts.some((t) => words(t).includes(q));
}

/** Where a shape is read from: its top left, a line's the top left of its route. */
function corner(shape: SearchShape): Point {
  if (shape.waypoints && shape.waypoints.length > 0) {
    return { x: Math.min(...shape.waypoints.map((p) => p.x)), y: Math.min(...shape.waypoints.map((p) => p.y)) };
  }
  return { x: shape.x ?? 0, y: shape.y ?? 0 };
}

export class CanvasSearch {
  private query = '';
  private matches: SearchShape[] = [];
  private index = -1;

  constructor(private readonly host: CanvasSearchHost) {}

  state(): CanvasSearchState {
    return { query: this.query, count: this.matches.length, current: this.index };
  }

  /**
   * Search the open diagram. A new text makes the first match current, selected and scrolled to; `again` — the
   * diagram changed, the text did not (SR-5) — keeps the current match while it still matches, and moves nothing.
   */
  search(query: string, again = false): CanvasSearchState {
    const was = this.matches[this.index]?.id;
    this.unmark();
    this.query = query;
    const found = this.host
      .shapes()
      .filter((s) => !s.labelTarget && textsMatch(searchTextsOf(s.businessObject, (t) => this.host.typeLabel(t)), query))
      .map((shape) => ({ shape, at: corner(shape) }))
      .sort((a, b) => Math.floor(a.at.y / ROW) - Math.floor(b.at.y / ROW) || a.at.x - b.at.x || a.shape.id.localeCompare(b.shape.id))
      .map((m) => m.shape);
    this.matches = found;
    for (const shape of found) this.host.mark(shape, SEARCH_MATCH_MARKER, true);
    if (again) {
      const kept = found.findIndex((s) => s.id === was);
      this.index = kept >= 0 ? kept : found.length > 0 ? Math.min(Math.max(this.index, 0), found.length - 1) : -1;
      const current = found[this.index];
      if (current) this.host.mark(current, SEARCH_CURRENT_MARKER, true);
    } else {
      this.index = found.length > 0 ? 0 : -1;
      this.focus();
    }
    return this.state();
  }

  /** To the next match, or the previous; past the last, the first. */
  step(direction: 1 | -1): CanvasSearchState {
    const n = this.matches.length;
    if (n === 0) return this.state();
    const current = this.matches[this.index];
    if (current) this.host.mark(current, SEARCH_CURRENT_MARKER, false);
    this.index = (((this.index + direction) % n) + n) % n;
    this.focus();
    return this.state();
  }

  /** Every match selected (SR-3); the bar stays. */
  selectAll(): void {
    if (this.matches.length > 0) this.host.select(this.matches);
  }

  /** The search over: the outlines away, the selection as it is. */
  clear(): void {
    this.unmark();
    this.matches = [];
    this.index = -1;
    this.query = '';
  }

  private focus(): void {
    const current = this.matches[this.index];
    if (!current) return;
    this.host.mark(current, SEARCH_CURRENT_MARKER, true);
    this.host.select([current]);
    this.host.reveal(current);
  }

  private unmark(): void {
    for (const shape of this.matches) {
      this.host.mark(shape, SEARCH_MATCH_MARKER, false);
      this.host.mark(shape, SEARCH_CURRENT_MARKER, false);
    }
  }
}
