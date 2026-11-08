#!/usr/bin/env python3
"""
gitflexo/commit_objects.py — borrow Flexo's best idea into the Git-native store.

Flexo-MMS versions the graph itself: every commit is a first-class RDF object
(parent, author, timestamp, the delta) that you can QUERY with SPARQL — "what
changed between commit X and Y", "show the model as of commit Z". Plain Git over
TTL hides all that inside Git's own object store, unreachable from SPARQL.

This module adds a Flexo-style *commit graph* ALONGSIDE the Git history, written
as RDF into a `history/` tree in the same repo. You keep Git as the durable
store and PR workflow, but gain:

  * commit objects queryable via SPARQL (prov:wasDerivedFrom chain),
  * element-level change log ("every commit that touched APP-7f3a9c"),
  * diff between any two commits by set algebra on recorded deltas,
  * a serving layer: load history/ into any triplestore and query it.

It is driven from a post-commit hook (or the room server's checkpoint step):

    python gitflexo/commit_objects.py record HEAD

Design: the commit object stores delta COUNTS + affected element IRIs inline
(cheap, always queryable), and references the full added/removed triple sets in
a per-commit named graph (so you can replay/diff without re-reading Git blobs).
Reuses compute_delta + assemble logic shared with the merge/diff tooling.
"""

from __future__ import annotations

import hashlib
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from rdflib import Graph, Dataset, URIRef, Literal, Namespace
from rdflib.namespace import RDF, PROV, XSD

try:
    from rdf_merge import compute_delta, _is_quads
except Exception:  # pragma: no cover
    def _is_quads(p: str) -> bool:
        return str(p).endswith((".trig", ".nq"))

    @dataclass
    class _D:
        added: set
        removed: set

    def compute_delta(base: Graph, side: Graph):
        b, s = set(base), set(side)
        return _D(added=s - b, removed=b - s)


MMS = Namespace("https://meta.linked.archi/mms#")   # commit vocabulary
COMMIT = Namespace("https://model.linked.archi/commit/")
HISTORY_DIR = Path("history")


def _git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True).strip()


# ---------------------------------------------------------------------------
# Assemble the whole model at a ref (diff-side twin of assemble_graph.py).
# ---------------------------------------------------------------------------
def assemble_at(ref: str) -> Graph:
    g = Graph()
    tree = _git("ls-tree", "-r", "--name-only", ref).splitlines()
    for path in tree:
        if path.startswith("model/") and path.endswith((".ttl", ".trig")):
            blob = _git("show", f"{ref}:{path}")
            tmp = Dataset() if _is_quads(path) else Graph()
            tmp.parse(data=blob, format="trig" if _is_quads(path) else "turtle")
            for s, p, o in tmp:
                g.add((s, p, o))
    return g


def _element_of(subject: URIRef) -> str:
    """Normalize a triple subject to the element IRI it belongs to. For a plain
    model it's the subject itself; extend here if you use blank-ish sub-nodes."""
    return str(subject)


# ---------------------------------------------------------------------------
# Record a commit object for HEAD (or any ref) vs its first parent.
# ---------------------------------------------------------------------------
def record(ref: str = "HEAD") -> str:
    sha = _git("rev-parse", ref)
    parents = _git("rev-parse", f"{ref}^@").splitlines()
    author = _git("show", "-s", "--format=%an <%ae>", ref)
    when = int(_git("show", "-s", "--format=%ct", ref))

    head = assemble_at(ref)
    base = assemble_at(parents[0]) if parents else Graph()
    delta = compute_delta(base, head)

    affected = {_element_of(s) for (s, _p, _o) in (delta.added | delta.removed)}

    commit_iri = COMMIT[sha]
    meta = Graph()
    meta.add((commit_iri, RDF.type, MMS.Commit))
    meta.add((commit_iri, MMS.sha, Literal(sha)))
    meta.add((commit_iri, PROV.wasAttributedTo, Literal(author)))
    meta.add((commit_iri, PROV.generatedAtTime,
              Literal(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(when)),
                      datatype=XSD.dateTime)))
    meta.add((commit_iri, MMS.addedCount, Literal(len(delta.added))))
    meta.add((commit_iri, MMS.removedCount, Literal(len(delta.removed))))
    for p in parents:
        meta.add((commit_iri, PROV.wasDerivedFrom, COMMIT[p]))
    for el in sorted(affected):
        meta.add((commit_iri, MMS.touched, URIRef(el)))

    # Full delta in a per-commit named graph, so diffs need no blob re-reads.
    ds = Dataset()
    add_g = ds.graph(URIRef(f"{commit_iri}#added"))
    rem_g = ds.graph(URIRef(f"{commit_iri}#removed"))
    for t in delta.added:
        add_g.add(t)
    for t in delta.removed:
        rem_g.add(t)

    HISTORY_DIR.mkdir(exist_ok=True)
    # Append commit metadata to the running log; store delta per commit.
    log = HISTORY_DIR / "commits.ttl"
    with open(log, "a") as fh:
        fh.write(meta.serialize(format="turtle"))
    (HISTORY_DIR / f"{sha}.trig").write_text(ds.serialize(format="trig"))

    return sha


# ---------------------------------------------------------------------------
# Diff any two commits from recorded deltas (no Git blob access needed).
# ---------------------------------------------------------------------------
def diff(sha_a: str, sha_b: str) -> dict:
    """Net change A->B as triple sets, by composing recorded per-commit deltas
    along the ancestry. For a linear history this is the union of deltas between
    them; here we show the direct two-snapshot form for clarity."""
    ga = _load_delta_graph(sha_a)
    gb = _load_delta_graph(sha_b)
    added = set(gb["added"]) - set(ga["added"])
    removed = set(gb["removed"]) - set(ga["removed"])
    return {"added": added, "removed": removed}


def _load_delta_graph(sha: str) -> dict:
    ds = Dataset()
    path = HISTORY_DIR / f"{sha}.trig"
    if path.exists():
        ds.parse(path, format="trig")
    added = set(ds.graph(URIRef(f"{COMMIT[sha]}#added")))
    removed = set(ds.graph(URIRef(f"{COMMIT[sha]}#removed")))
    return {"added": added, "removed": removed}


# ---------------------------------------------------------------------------
# Example SPARQL you can now run over history/commits.ttl in any triplestore:
#
#   # Every commit that touched a given element, newest first
#   PREFIX mms: <https://meta.linked.archi/mms#>
#   PREFIX prov: <http://www.w3.org/ns/prov#>
#   SELECT ?commit ?when ?who WHERE {
#     ?commit a mms:Commit ;
#             mms:touched <https://model.linked.archi/APP-7f3a9c> ;
#             prov:generatedAtTime ?when ;
#             prov:wasAttributedTo ?who .
#   } ORDER BY DESC(?when)
#
#   # Commit ancestry (branch lineage)
#   SELECT ?c ?parent WHERE { ?c prov:wasDerivedFrom ?parent }
# ---------------------------------------------------------------------------
def main(argv: list[str]) -> int:
    if len(argv) >= 3 and argv[1] == "record":
        sha = record(argv[2])
        sys.stdout.write(f"recorded commit object for {sha}\n")
        return 0
    if len(argv) >= 4 and argv[1] == "diff":
        d = diff(argv[2], argv[3])
        sys.stdout.write(
            f"added={len(d['added'])} removed={len(d['removed'])}\n"
        )
        return 0
    sys.stderr.write("usage: commit_objects.py record <ref> | diff <shaA> <shaB>\n")
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
