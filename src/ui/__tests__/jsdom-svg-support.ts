/**
 * jsdom SVG layout stubs.
 *
 * jsdom implements the SVG DOM but none of the SVG *layout* APIs: there is no
 * geometry engine behind it, so `getBBox`, `getCTM`, `getScreenCTM`, the
 * `SVGSVGElement` matrix/point factories and `SVGGraphicsElement.transform`
 * are all missing, and the `SVGMatrix` global is not defined at all.
 * diagram-js (through tiny-svg) uses every one of those while wiring up its
 * viewport and positioning shapes, so a `Diagram` cannot boot without them.
 *
 * What is faithful here: affine matrix arithmetic, and the `transform`
 * attribute that tiny-svg writes onto an element. That means a shape's
 * `transform="matrix(1,0,0,1,x,y)"` really does reflect the position
 * diagram-js asked for, so tests can assert on it.
 *
 * What is *not* faithful: `getBBox` and friends return fixed numbers. There is
 * no layout engine, so tests must never assert on measured sizes.
 *
 * Two non-SVG gaps live here too, because they are the same kind of thing —
 * layout APIs jsdom does not implement that diagram-js calls unconditionally:
 * `CSS.escape` and `Element.prototype.scrollIntoView` (used by the popup menu).
 */

/** Minimal affine matrix standing in for `SVGMatrix`. */
class StubMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;

  static of(a: number, b: number, c: number, d: number, e: number, f: number): StubMatrix {
    const m = new StubMatrix();
    m.a = a;
    m.b = b;
    m.c = c;
    m.d = d;
    m.e = e;
    m.f = f;
    return m;
  }

  multiply(o: StubMatrix): StubMatrix {
    return StubMatrix.of(
      this.a * o.a + this.c * o.b,
      this.b * o.a + this.d * o.b,
      this.a * o.c + this.c * o.d,
      this.b * o.c + this.d * o.d,
      this.a * o.e + this.c * o.f + this.e,
      this.b * o.e + this.d * o.f + this.f,
    );
  }

  translate(x: number, y: number): StubMatrix {
    return this.multiply(StubMatrix.of(1, 0, 0, 1, x, y));
  }

  scale(factor: number): StubMatrix {
    return this.scaleNonUniform(factor, factor);
  }

  scaleNonUniform(x: number, y: number): StubMatrix {
    return this.multiply(StubMatrix.of(x, 0, 0, y, 0, 0));
  }

  flipX(): StubMatrix {
    return this.scaleNonUniform(-1, 1);
  }

  flipY(): StubMatrix {
    return this.scaleNonUniform(1, -1);
  }

  rotate(angle: number): StubMatrix {
    const rad = (angle * Math.PI) / 180;
    return this.multiply(StubMatrix.of(Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0));
  }

  inverse(): StubMatrix {
    const det = this.a * this.d - this.b * this.c;
    if (det === 0) return new StubMatrix();
    return StubMatrix.of(
      this.d / det,
      -this.b / det,
      -this.c / det,
      this.a / det,
      (this.c * this.f - this.d * this.e) / det,
      (this.b * this.e - this.a * this.f) / det,
    );
  }
}

/** Minimal mutable `SVGTransform` standing in for the real thing. */
class StubTransform {
  matrix = new StubMatrix();

  setMatrix(matrix: StubMatrix): void {
    this.matrix = matrix;
  }

  setTranslate(x: number, y: number): void {
    this.matrix = StubMatrix.of(1, 0, 0, 1, x, y);
  }

  setScale(x: number, y: number): void {
    this.matrix = StubMatrix.of(x, 0, 0, y, 0, 0);
  }

  setRotate(angle: number, _cx: number, _cy: number): void {
    this.matrix = new StubMatrix().rotate(angle);
  }
}

/** Serialize a matrix the way a browser serializes a consolidated transform. */
function serialize(m: StubMatrix): string {
  return `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`;
}

/**
 * Per-element `SVGTransformList` stub. Records appended transforms, keeps the
 * owner element's `transform` attribute in sync, and consolidates by
 * multiplying them out.
 */
function createTransformList(owner: Element): Record<string, unknown> {
  let items: StubMatrix[] = [];

  const sync = (): void => {
    if (items.length === 0) {
      owner.removeAttribute('transform');
      return;
    }
    owner.setAttribute('transform', serialize(consolidated()));
  };

  const consolidated = (): StubMatrix =>
    items.reduce((acc, m) => acc.multiply(m), new StubMatrix());

  return {
    get numberOfItems() {
      return items.length;
    },
    clear(): void {
      items = [];
      sync();
    },
    appendItem(item: { matrix?: StubMatrix } | StubMatrix): unknown {
      const matrix = item instanceof StubMatrix ? item : (item.matrix ?? new StubMatrix());
      items.push(matrix);
      sync();
      return item;
    },
    getItem(index: number): { matrix: StubMatrix } {
      return { matrix: items[index] ?? new StubMatrix() };
    },
    consolidate(): { matrix: StubMatrix } | null {
      if (items.length === 0) return null;
      return { matrix: consolidated() };
    },
    createSVGTransformFromMatrix(matrix: StubMatrix): { matrix: StubMatrix } {
      return { matrix };
    },
  };
}

/** Whether the stubs have already been installed in this realm. */
let installed = false;

/**
 * Install the stubs on the current realm. Safe to call repeatedly, and a
 * no-op outside a DOM environment.
 */
export function installJsdomSvgSupport(): void {
  if (installed) return;
  if (typeof SVGElement === 'undefined') return;

  const globalScope = globalThis as unknown as Record<string, unknown>;
  if (typeof globalScope['SVGMatrix'] === 'undefined') {
    globalScope['SVGMatrix'] = StubMatrix;
  }

  // jsdom does not implement the CSS object model utilities. diagram-js uses
  // `CSS.escape` to build selectors from element ids, which for this app are
  // IRIs — so it is on the hot path, not an edge case.
  const cssObject = globalScope['CSS'] as { escape?: unknown } | undefined;
  if (typeof cssObject?.escape !== 'function') {
    globalScope['CSS'] = {
      ...(cssObject ?? {}),
      escape: (value: string) => String(value).replace(/([^a-zA-Z0-9_\u00a0-\uffff-])/g, '\\$1'),
    };
  }

  // jsdom implements no scrolling, so `Element.prototype.scrollIntoView` is
  // simply absent. diagram-js's popup menu calls it on the highlighted entry
  // every time the selection moves (`PopupMenuList`'s layout effect), which is
  // on open — so without this the menu throws before it renders.
  const elementProto = Element.prototype as unknown as Record<string, unknown>;
  if (typeof elementProto['scrollIntoView'] !== 'function') {
    elementProto['scrollIntoView'] = () => undefined;
  }

  const svgProto = SVGElement.prototype as unknown as Record<string, unknown>;

  if (typeof svgProto['getBBox'] !== 'function') {
    svgProto['getBBox'] = function getBBox(): DOMRect {
      return {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        top: 0,
        left: 0,
        right: 100,
        bottom: 100,
      } as DOMRect;
    };
  }

  if (typeof svgProto['getCTM'] !== 'function') {
    svgProto['getCTM'] = () => new StubMatrix();
  }

  if (typeof svgProto['getScreenCTM'] !== 'function') {
    svgProto['getScreenCTM'] = () => new StubMatrix();
  }

  if (typeof svgProto['getComputedTextLength'] !== 'function') {
    svgProto['getComputedTextLength'] = () => 0;
  }

  if (!('transform' in svgProto)) {
    const lists = new WeakMap<Element, Record<string, unknown>>();
    Object.defineProperty(svgProto, 'transform', {
      configurable: true,
      get(this: Element) {
        let list = lists.get(this);
        if (!list) {
          list = createTransformList(this);
          lists.set(this, list);
        }
        return { baseVal: list };
      },
    });
  }

  if (typeof SVGSVGElement !== 'undefined') {
    const rootProto = SVGSVGElement.prototype as unknown as Record<string, unknown>;

    if (typeof rootProto['createSVGMatrix'] !== 'function') {
      rootProto['createSVGMatrix'] = () => new StubMatrix();
    }
    if (typeof rootProto['createSVGPoint'] !== 'function') {
      rootProto['createSVGPoint'] = () => ({
        x: 0,
        y: 0,
        matrixTransform: () => ({ x: 0, y: 0 }),
      });
    }
    if (typeof rootProto['createSVGTransform'] !== 'function') {
      rootProto['createSVGTransform'] = () => new StubTransform();
    }
    if (typeof rootProto['suspendRedraw'] !== 'function') {
      rootProto['suspendRedraw'] = () => 0;
    }
    if (typeof rootProto['unsuspendRedrawAll'] !== 'function') {
      rootProto['unsuspendRedrawAll'] = () => undefined;
    }
  }

  installed = true;
}
