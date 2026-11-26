/**
 * Plain-text search over what a panel shows (Req 23.6; `.agents/tasks/search/`): where a query is in a text, and
 * those places as DOM ranges over an element's text nodes — which the RDF panel paints as highlights (SR-DD-3),
 * leaving its markup as it is.
 */

/** A match: its start in the text and its end, exclusive. */
export type TextMatch = readonly [start: number, end: number];

/** Every place `query` is in `text`, not overlapping, in order; case ignored unless `matchCase`. */
export function findMatches(text: string, query: string, matchCase = false): TextMatch[] {
  if (!query) return [];
  const haystack = matchCase ? text : text.toLowerCase();
  const needle = matchCase ? query : query.toLowerCase();
  // Lower-casing keeps the length of the text but for a few letters (İ): matched on a text of another length, the
  // offsets would not be the text's — so such a text is searched as it is.
  if (haystack.length !== text.length) return findMatches(text, query, true);
  const out: TextMatch[] = [];
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
    out.push([at, at + needle.length]);
  }
  return out;
}

/** The text an element shows, and where each of its text nodes starts in it. */
export interface TextIndex {
  text: string;
  nodes: Text[];
  starts: number[];
}

/** The element's text, as its text nodes hold it, in document order. */
export function textIndexOf(root: Node): TextIndex {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = '';
  const walker = (root.ownerDocument ?? (root as Document)).createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text);
    starts.push(text.length);
    text += (node as Text).data;
  }
  return { text, nodes, starts };
}

/** The text node holding offset `at`, and the offset in it; an end at a node's end stays in that node. */
function locate(index: TextIndex, at: number, isEnd: boolean): { node: Text; offset: number } {
  let lo = 0;
  let hi = index.nodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (index.starts[mid] < at || (!isEnd && index.starts[mid] === at)) lo = mid;
    else hi = mid - 1;
  }
  return { node: index.nodes[lo], offset: at - index.starts[lo] };
}

/** The matches as ranges over the index's text nodes. */
export function rangesOf(index: TextIndex, matches: readonly TextMatch[]): Range[] {
  if (index.nodes.length === 0) return [];
  const document = index.nodes[0].ownerDocument;
  return matches.map(([start, end]) => {
    const range = document.createRange();
    const from = locate(index, start, false);
    const to = locate(index, end, true);
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    return range;
  });
}
