/**
 * Notation shapes for tests: the ArchiMate ones as the bundled notation files
 * declare them, and C4's and EDGY's as their notation files in linked-archi-meta
 * declare them (those are not bundled, so they are mirrored here — keep them in
 * step with `modelingLanguages/c4/c4-notation.ttl` and
 * `modelingLanguages/edgy/edgy-notation.ttl`).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Parser, Store } from 'n3';
import { readCustomShape, type CustomShape } from '@linked-archi/kernel/metamodel-manager/notation.js';

const stores = new Map<string, Store>();

/** A bundled notation file as a store (tests run from the project root). */
function bundled(path: string): Store {
  let store = stores.get(path);
  if (!store) {
    store = new Store(new Parser().parse(readFileSync(join(process.cwd(), 'node_modules/@linked-archi/kernel/assets', path), 'utf8')));
    stores.set(path, store);
  }
  return store;
}

/** An ArchiMate shape as the bundled notation declares it (`archimate4/notation#Box3D`). */
export function archimateShape(name: string, version: '4.0' | '3.2' = '4.0'): CustomShape {
  const [path, ns] =
    version === '4.0'
      ? ['archimate4/archimate4-notation.ttl', 'https://meta.linked.archi/archimate4/notation#']
      : ['archimate3/archimate3.2-notation.ttl', 'https://meta.linked.archi/archimate3/notation#'];
  const shape = readCustomShape(bundled(path), ns + name);
  if (!shape) throw new Error(`no ${name} in ${path}`);
  return shape;
}

/** C4's own shapes (`c4/notation#`). */
export const C4_SHAPES: Record<'Person' | 'MobileDevice' | 'WebBrowser' | 'Cylinder', CustomShape> = {
  Person: {
    iri: "https://meta.linked.archi/c4/notation#Person",
    fallback: "RoundedRectangle",
    variables: "r = min(h * 0.15, w * 0.3); cy = h * 0.165; top = h * 0.35; rb = min(h * 0.15, (h - top) / 2, w / 2)",
    outline: "M{rb},{top} L{w-rb},{top} A{rb},{rb} 0 0 1 {w},{top+rb} L{w},{h-rb} A{rb},{rb} 0 0 1 {w-rb},{h} L{rb},{h} A{rb},{rb} 0 0 1 0,{h-rb} L0,{top+rb} A{rb},{rb} 0 0 1 {rb},{top} Z M{w/2-r},{cy} A{r},{r} 0 0 1 {w/2+r},{cy} A{r},{r} 0 0 1 {w/2-r},{cy} Z",
    contentBox: "0 {top} {w} {h - top}",
  },
  MobileDevice: {
    iri: "https://meta.linked.archi/c4/notation#MobileDevice",
    fallback: "RoundedRectangle",
    variables: "s = min(h * 0.09, w / 4); t = h * 0.13; bt = h * 0.055; fr = min(h * 0.055, w / 2); br = h * 0.027; bcy = h * 0.065",
    outline: "M{fr},0 L{w-fr},0 A{fr},{fr} 0 0 1 {w},{fr} L{w},{h-fr} A{fr},{fr} 0 0 1 {w-fr},{h} L{fr},{h} A{fr},{fr} 0 0 1 0,{h-fr} L0,{fr} A{fr},{fr} 0 0 1 {fr},0 Z",
    details: "M{s},{t} L{w - s},{t} L{w - s},{h - bt} L{s},{h - bt} Z M{w/2-br},{bcy} A{br},{br} 0 0 1 {w/2+br},{bcy} A{br},{br} 0 0 1 {w/2-br},{bcy} Z",
    contentBox: "{s} {t} {w - 2 * s} {h - t - bt}",
  },
  WebBrowser: {
    iri: "https://meta.linked.archi/c4/notation#WebBrowser",
    fallback: "Rectangle",
    variables: "t = min(h * 0.155, 20); r = min(2, w / 2, h / 2); dr = t * 0.18; dy = t * 0.53; bx = t * 2.25; bx2 = max(t * 2.25, w - 7); by = t * 0.3; by2 = t * 0.76; br = t * 0.23",
    outline: "M{r},0 L{w-r},0 A{r},{r} 0 0 1 {w},{r} L{w},{h-r} A{r},{r} 0 0 1 {w-r},{h} L{r},{h} A{r},{r} 0 0 1 0,{h-r} L0,{r} A{r},{r} 0 0 1 {r},0 Z",
    details: "M3,{t} L{w - 3},{t} L{w - 3},{h - 3} L3,{h - 3} Z M{t*0.6-dr},{dy} A{dr},{dr} 0 0 1 {t*0.6+dr},{dy} A{dr},{dr} 0 0 1 {t*0.6-dr},{dy} Z M{t*1.2-dr},{dy} A{dr},{dr} 0 0 1 {t*1.2+dr},{dy} A{dr},{dr} 0 0 1 {t*1.2-dr},{dy} Z M{t*1.8-dr},{dy} A{dr},{dr} 0 0 1 {t*1.8+dr},{dy} A{dr},{dr} 0 0 1 {t*1.8-dr},{dy} Z M{bx+br},{by} L{bx2-br},{by} A{br},{br} 0 0 1 {bx2},{by+br} L{bx2},{by2-br} A{br},{br} 0 0 1 {bx2-br},{by2} L{bx+br},{by2} A{br},{br} 0 0 1 {bx},{by2-br} L{bx},{by+br} A{br},{br} 0 0 1 {bx+br},{by} Z",
    contentBox: "3 {t} {w - 6} {h - t - 3}",
  },
  Cylinder: {
    iri: "https://meta.linked.archi/c4/notation#Cylinder",
    fallback: "Rectangle",
    variables: "ry = min(h * 0.27, 30) / 2",
    outline: "M0,{ry} A{w / 2},{ry} 0 0 1 {w},{ry} L{w},{h - ry} A{w / 2},{ry} 0 0 1 0,{h - ry} Z",
    details: "M0,{ry} A{w / 2},{ry} 0 0 0 {w},{ry}",
    contentBox: "0 {2 * ry} {w} {h - 3 * ry}",
  },
};

/** EDGY's own shapes (`edgy/notation#`). */
export const EDGY_SHAPES: Record<'RightArrow' | 'Pill', CustomShape> = {
  RightArrow: {
    iri: "https://meta.linked.archi/edgy/notation#RightArrow",
    fallback: "Rectangle",
    variables: "d = min(h * 0.3, w / 2)",
    outline: "M0,0 L{w - d},0 L{w},{h / 2} L{w - d},{h} L0,{h} Z",
    contentBox: "0 0 {w - d} {h}",
  },
  Pill: {
    iri: "https://meta.linked.archi/edgy/notation#Pill",
    fallback: "RoundedRectangle",
    variables: "r = min(w, h) / 2",
    outline: "M{r},0 L{w-r},0 A{r},{r} 0 0 1 {w},{r} L{w},{h-r} A{r},{r} 0 0 1 {w-r},{h} L{r},{h} A{r},{r} 0 0 1 0,{h-r} L0,{r} A{r},{r} 0 0 1 {r},0 Z",
    contentBox: "{r / 2} 0 {w - r} {h}",
  },
};
