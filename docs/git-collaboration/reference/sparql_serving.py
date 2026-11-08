#!/usr/bin/env python3
"""
gitflexo/sparql_serving.py — a read-only SPARQL serving layer over the Git store.

Closes the one gap the Git-native design still had vs Flexo-MMS: querying the
model AS OF ANY COMMIT over live SPARQL. It does this WITHOUT adopting Flexo —
it reuses the per-commit delta graphs written by gitflexo/commit_objects.py and
loads reconstructed snapshots into a plain SPARQL 1.1 store (Apache Jena Fuseki)
via the Graph Store Protocol.

Mirrors Flexo's approach conceptually:
  * Flexo stores each materialized snapshot under an opaque named-graph IRI and
    lets query authors target specific model versions. We do the same: one
    named graph per commit, IRI = commit:<sha>.
  * Flexo reconstructs state from commit deltas on demand. We replay the
    #added/#removed delta graphs along ancestry to rebuild any commit cheaply,
    with no Git blob reads.

                 git repo                         Fuseki (Layer-0 role)
   ┌───────────────────────────────┐       ┌──────────────────────────────┐
   │ model/**        (shards)       │ sync  │ graph commit:HEADsha  (model) │
   │ history/commits.ttl (lineage)  ├──────▶│ graph mms:history     (meta)  │
   │ history/<sha>.trig  (deltas)   │       │ graph commit:<sha>    (snap)  │
   └───────────────────────────────┘       └──────────────────────────────┘
                                                      ▲ SPARQL 1.1 query

Commands:
    python gitflexo/sparql_serving.py sync   [--branch main]
    python gitflexo/sparql_serving.py materialize <sha>
    python gitflexo/sparql_serving.py drop   <sha>
    python gitflexo/sparql_serving.py query  "SELECT ..."   [--commit <sha>]

Endpoints are Fuseki defaults; override with --store. Uses stdlib urllib so it
runs anywhere; swap for requests/SPARQLWrapper if you prefer.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from rdflib import Graph, Dataset, URIRef

try:
    from commit_objects import assemble_at, COMMIT, HISTORY_DIR, _load_delta_graph
except Exception:  # pragma: no cover - allow standalone run
    from rdflib import Namespace
    COMMIT = Namespace("https://model.linked.archi/commit/")
    HISTORY_DIR = Path("history")

    def assemble_at(ref: str) -> Graph:
        raise RuntimeError("commit_objects.assemble_at unavailable; run from repo root")

    def _load_delta_graph(sha: str) -> dict:
        ds = Dataset()
        p = HISTORY_DIR / f"{sha}.trig"
        if p.exists():
            ds.parse(p, format="trig")
        return {
            "added": set(ds.graph(URIRef(f"{COMMIT[sha]}#added"))),
            "removed": set(ds.graph(URIRef(f"{COMMIT[sha]}#removed"))),
        }


# ---------------------------------------------------------------------------
# Git helpers
# ---------------------------------------------------------------------------
def _git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True).strip()


def ancestry(sha: str) -> list[str]:
    """Commit shas from root → sha (first-parent chain). Replaying deltas in
    this order reconstructs the snapshot at `sha`."""
    chain = _git("rev-list", "--first-parent", "--reverse", sha).splitlines()
    return chain


# ---------------------------------------------------------------------------
# Fuseki Graph Store Protocol client (named-graph PUT / DROP) + query
# ---------------------------------------------------------------------------
class FusekiStore:
    def __init__(self, base: str, dataset: str = "ds"):
        self.gsp = f"{base.rstrip('/')}/{dataset}/data"     # Graph Store Protocol
        self.query_ep = f"{base.rstrip('/')}/{dataset}/query"
        self.update_ep = f"{base.rstrip('/')}/{dataset}/update"

    def put_graph(self, graph_iri: str, g: Graph) -> None:
        """PUT replaces the named graph wholesale — idempotent snapshot load."""
        data = g.serialize(format="nt").encode("utf-8")
        url = f"{self.gsp}?{urllib.parse.urlencode({'graph': graph_iri})}"
        req = urllib.request.Request(url, data=data, method="PUT",
                                     headers={"Content-Type": "application/n-triples"})
        urllib.request.urlopen(req).read()

    def drop_graph(self, graph_iri: str) -> None:
        url = f"{self.gsp}?{urllib.parse.urlencode({'graph': graph_iri})}"
        req = urllib.request.Request(url, method="DELETE")
        try:
            urllib.request.urlopen(req).read()
        except urllib.error.HTTPError as e:  # 404 = already absent
            if e.code != 404:
                raise

    def query(self, sparql: str) -> str:
        url = f"{self.query_ep}?{urllib.parse.urlencode({'query': sparql})}"
        req = urllib.request.Request(url, headers={"Accept": "application/sparql-results+json"})
        return urllib.request.urlopen(req).read().decode("utf-8")


# ---------------------------------------------------------------------------
# Reconstruct a commit snapshot by replaying recorded deltas along ancestry.
# No Git blob reads — pure set algebra on the history/ delta graphs.
# ---------------------------------------------------------------------------
def reconstruct(sha: str) -> Graph:
    g = Graph()
    for c in ancestry(sha):
        d = _load_delta_graph(c)
        for t in d["removed"]:
            g.discard(t)
        for t in d["added"]:
            g.add(t)
    return g


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------
def cmd_sync(store: FusekiStore, branch: str) -> None:
    """Load the CURRENT branch head model + the commit lineage graph. This is
    the cheap, always-do-it baseline: one live model graph + queryable history.
    """
    head = _git("rev-parse", branch)
    model = assemble_at(branch)
    store.put_graph(str(COMMIT[head]), model)

    hist_file = HISTORY_DIR / "commits.ttl"
    if hist_file.exists():
        hist = Graph()
        hist.parse(hist_file, format="turtle")
        store.put_graph("https://meta.linked.archi/mms#history", hist)

    print(f"synced model@{head[:10]} ({len(model)} triples) + history lineage")


def cmd_materialize(store: FusekiStore, sha: str) -> None:
    """On-demand: reconstruct an OLD commit and serve it as its own named graph,
    exactly like Flexo materializing a snapshot under an opaque graph IRI."""
    g = reconstruct(sha)
    store.put_graph(str(COMMIT[sha]), g)
    print(f"materialized commit:{sha[:10]} as named graph ({len(g)} triples)")


def cmd_drop(store: FusekiStore, sha: str) -> None:
    store.drop_graph(str(COMMIT[sha]))
    print(f"dropped snapshot commit:{sha[:10]}")


def cmd_query(store: FusekiStore, sparql: str, commit: str | None) -> None:
    """Run a query. With --commit, scope it to that snapshot's named graph by
    wrapping in GRAPH { } if the query doesn't already specify one."""
    if commit and "GRAPH" not in sparql.upper():
        giri = str(COMMIT[_git("rev-parse", commit)])
        # naive but handy: inject a FROM clause targeting the snapshot graph
        sparql = sparql.replace(
            "WHERE", f"FROM <{giri}>\nWHERE", 1
        )
    print(store.query(sparql))


# Handy canned queries (the payoff of the whole serving layer) -------------
CANNED = {
    "history": """
PREFIX mms:  <https://meta.linked.archi/mms#>
PREFIX prov: <http://www.w3.org/ns/prov#>
SELECT ?commit ?when ?who ?added ?removed
FROM <https://meta.linked.archi/mms#history>
WHERE {
  ?commit a mms:Commit ;
          prov:generatedAtTime ?when ;
          prov:wasAttributedTo ?who ;
          mms:addedCount ?added ; mms:removedCount ?removed .
} ORDER BY DESC(?when)""",
    "touched": """
PREFIX mms:  <https://meta.linked.archi/mms#>
PREFIX prov: <http://www.w3.org/ns/prov#>
SELECT ?commit ?when WHERE {
  GRAPH <https://meta.linked.archi/mms#history> {
    ?commit mms:touched <https://model.linked.archi/APP-7f3a9c> ;
            prov:generatedAtTime ?when .
  }
} ORDER BY DESC(?when)""",
}


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("command",
                    choices=["sync", "materialize", "drop", "query", "canned"])
    ap.add_argument("arg", nargs="?", default=None)
    ap.add_argument("--store", default="http://localhost:3030")
    ap.add_argument("--dataset", default="ds")
    ap.add_argument("--branch", default="main")
    ap.add_argument("--commit", default=None)
    args = ap.parse_args(argv[1:])

    store = FusekiStore(args.store, args.dataset)

    if args.command == "sync":
        cmd_sync(store, args.branch)
    elif args.command == "materialize":
        if not args.arg:
            ap.error("materialize needs a <sha>")
        cmd_materialize(store, args.arg)
    elif args.command == "drop":
        if not args.arg:
            ap.error("drop needs a <sha>")
        cmd_drop(store, args.arg)
    elif args.command == "query":
        if not args.arg:
            ap.error("query needs a SPARQL string")
        cmd_query(store, args.arg, args.commit)
    elif args.command == "canned":
        key = args.arg or "history"
        if key not in CANNED:
            ap.error(f"unknown canned query '{key}'; choices: {list(CANNED)}")
        cmd_query(store, CANNED[key], None)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
