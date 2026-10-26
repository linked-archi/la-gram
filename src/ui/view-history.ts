/**
 * Back and forward between views, as a browser keeps pages.
 *
 * Going to a view — from the toolbar, the model tree, the property panel's
 * "Appears in views", a revealed concept — records a visit and drops whatever
 * was forward of the current one; Back and Forward move along the visits
 * without recording. A view opened twice in a row is one visit, and a view
 * deleted since is skipped. Each visit keeps where its view was left — the
 * visible area and the selection — so coming back finds it as it was.
 *
 * Kept per model: opening another model starts afresh (`clear`).
 */

/** Where a view was left. */
export interface ViewPlace {
  /** The visible area, in diagram coordinates. */
  viewbox?: { x: number; y: number; width: number; height: number };
  /** The concepts selected. */
  selection?: string[];
}

/** One visit to a view. */
export interface ViewVisit {
  viewIri: string;
  place?: ViewPlace;
}

export class ViewHistory {
  private visits: ViewVisit[] = [];
  private at = -1;

  /**
   * @param exists Whether a view is still there; visits to one that is not are skipped.
   * @param limit The most visits kept; the oldest go first.
   */
  constructor(
    private readonly exists: (viewIri: string) => boolean,
    private readonly limit = 50,
  ) {}

  /** The view at the current visit. */
  get current(): ViewVisit | undefined {
    return this.visits[this.at];
  }

  /** A view was gone to (not by Back or Forward): a new visit, unless it is the current one. */
  visit(viewIri: string): void {
    if (this.current?.viewIri === viewIri) return;
    this.visits = this.visits.slice(0, this.at + 1);
    this.visits.push({ viewIri });
    if (this.visits.length > this.limit) this.visits.splice(0, this.visits.length - this.limit);
    this.at = this.visits.length - 1;
  }

  /** Where the current view is being left. */
  leave(place: ViewPlace): void {
    if (this.current) this.current.place = place;
  }

  /** The visit Back would go to, if any. */
  peekBack(): ViewVisit | undefined {
    return this.find(-1)?.visit;
  }

  /** The visit Forward would go to, if any. */
  peekForward(): ViewVisit | undefined {
    return this.find(1)?.visit;
  }

  /** Move back a visit — over views deleted since — and return it. */
  back(): ViewVisit | undefined {
    return this.move(-1);
  }

  /** Move forward a visit — over views deleted since — and return it. */
  forward(): ViewVisit | undefined {
    return this.move(1);
  }

  /** Forget every visit: another model. */
  clear(): void {
    this.visits = [];
    this.at = -1;
  }

  private find(step: -1 | 1): { visit: ViewVisit; index: number } | undefined {
    for (let i = this.at + step; i >= 0 && i < this.visits.length; i += step) {
      const visit = this.visits[i]!;
      if (visit.viewIri !== this.current?.viewIri && this.exists(visit.viewIri)) return { visit, index: i };
    }
    return undefined;
  }

  private move(step: -1 | 1): ViewVisit | undefined {
    const found = this.find(step);
    if (found) this.at = found.index;
    return found?.visit;
  }
}
