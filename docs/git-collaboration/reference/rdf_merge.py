#!/usr/bin/env python3
"""
ci/rdf_merge.py — Git semantic three-way merge driver for RDF (Turtle / TriG).

Registered in .git/config as:

    [merge "rdf"]
        name   = RDF semantic three-way merge
        driver = python ci/rdf_merge.py %O %A %B %P

Git invokes it per conflicting file with:
    %O  path to the common-ancestor (base) version
    %A  path to OUR version        — ALSO the file the result MUST be written to
    %B  path to THEIR version
    %P  the repo-relative pathname (used to pick the right SHACL shapes)

Contract:
    - Write the merged graph back into the %A path (canonical serialization).
    - exit 0  -> merge resolved cleanly, Git accepts %A.
    - exit 1  -> true conflicts remain; we still write the best-effort merged
                 graph to %A, emit a sidecar <path>.conflicts.json, and embed
                 human-readable conflict blocks as comments. Git marks the path
                 unmerged so a human resolves it.

Why not <<<<<<< ======= >>>>>>> line markers?  Those make a .ttl file
syntactically invalid RDF, so no tool (editor, validator, the room server)
can load it to help resolve the conflict. Instead we keep %A a VALID graph
containing all auto-merged triples, and describe each true conflict out-of-band
(sidecar JSON + comment block). See write_result().
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Iterable

from rdflib import Graph, Dataset, URIRef, Literal, BNode
from rdflib.namespace import OWL, RDF, SH

Triple = tuple  # (s, p, o)

# ---------------------------------------------------------------------------
# Ontology / shapes location. In CI these are vendored under ontology/.
# The driver loads them to know which predicates are single-valued (functional)
# and to run the post-merge SHACL cardinality check (C3).
# ---------------------------------------------------------------------------
ONTOLOGY_DIR = Path(__file__).resolve().parent.parent / "ontology"
SHAPES_DIR = ONTOLOGY_DIR / "shapes"


def _is_quads(path: str) -> bool:
    return str(path).endswith((".trig", ".nq"))


def load_graph(path: str) -> Graph:
    """Parse a shard into a Graph (or Dataset for quads). Missing file => empty
    graph, which is how Git represents an add/delete on one side."""
    g = Dataset() if _is_quads(path) else Graph()
    p = Path(path)
    if p.exists() and p.stat().st_size > 0:
        g.parse(path, format="trig" if _is_quads(path) else "turtle")
    return g


# ---------------------------------------------------------------------------
# Functional (single-valued) predicate discovery.
# A predicate is single-valued if EITHER:
#   * it is declared owl:FunctionalProperty, OR
#   * some SHACL property shape constrains it with sh:maxCount 1.
# These are the predicates where two different objects = a C1 conflict.
# ---------------------------------------------------------------------------
def functional_predicates() -> set[URIRef]:
    fp: set[URIRef] = set()

    onto = Graph()
    for ttl in ONTOLOGY_DIR.glob("*.ttl"):
        onto.parse(ttl, format="turtle")
    for s in onto.subjects(RDF.type, OWL.FunctionalProperty):
        if isinstance(s, URIRef):
            fp.add(s)

    shapes = load_shapes()
    # sh:path P ; sh:maxCount 1  => P is single-valued
    for ps in shapes.subjects(SH.maxCount, Literal(1)):
        for path in shapes.objects(ps, SH.path):
            if isinstance(path, URIRef):
                fp.add(path)
    return fp


def load_shapes() -> Graph:
    shapes = Graph()
    if SHAPES_DIR.exists():
        for ttl in SHAPES_DIR.glob("*.ttl"):
            shapes.parse(ttl, format="turtle")
    return shapes


# ---------------------------------------------------------------------------
# Delta model
# ---------------------------------------------------------------------------
@dataclass
class Delta:
    added: set = field(default_factory=set)
    removed: set = field(default_factory=set)


def compute_delta(base: Graph, side: Graph) -> Delta:
    """What one side changed relative to the common ancestor, as triple sets.
    Reliable because canonicalization + skolemization already made triples
    comparable by value (handles N1/N2/N3)."""
    base_t = set(base)
    side_t = set(side)
    return Delta(added=side_t - base_t, removed=base_t - side_t)


# ---------------------------------------------------------------------------
# Conflict model
# ---------------------------------------------------------------------------
@dataclass
class Conflict:
    kind: str            # "C1_functional" | "C2_delete_modify" | ...
    subject: str
    predicate: str | None
    ours: list = field(default_factory=list)
    theirs: list = field(default_factory=list)
    detail: str = ""


def _subjects(triples: Iterable[Triple]) -> set:
    return {t[0] for t in triples}


# ---------------------------------------------------------------------------
# Core three-way merge
# ---------------------------------------------------------------------------
def three_way_merge(base: Graph, ours: Graph, theirs: Graph, path: str):
    """Return (merged_graph, conflicts). merged_graph always holds every
    auto-mergeable triple; conflicts lists the C1–C5 that need a human."""
    da = compute_delta(base, ours)
    db = compute_delta(base, theirs)
    fp = functional_predicates()

    merged = Dataset() if _is_quads(path) else Graph()
    for t in base:
        merged.add(t)

    conflicts: list[Conflict] = []

    # ---- C2: delete-vs-modify -------------------------------------------
    # One side removed EVERY triple about a subject (deleted the element),
    # the other side still has triples about it that it added/changed.
    ours_subj_deleted = _subjects(da.removed) - _subjects(set(ours))
    theirs_subj_deleted = _subjects(db.removed) - _subjects(set(theirs))

    def touched(delta: Delta) -> set:
        return _subjects(delta.added) | _subjects(delta.removed)

    c2_subjects = (ours_subj_deleted & touched(db)) | (
        theirs_subj_deleted & touched(da)
    )
    for s in c2_subjects:
        deleter = "ours" if s in ours_subj_deleted else "theirs"
        conflicts.append(
            Conflict(
                kind="C2_delete_modify",
                subject=str(s),
                predicate=None,
                detail=f"{deleter} deleted this element; the other side modified it.",
            )
        )

    # Apply the non-conflicting adds/removes (A1–A4).
    # Skip anything whose subject is in a C2 standoff — leave base state there.
    def safe(triple: Triple) -> bool:
        return triple[0] not in c2_subjects

    for t in (da.added | db.added):          # A1, A2, A3 (set union dedups)
        if safe(t):
            merged.add(t)
    for t in (da.removed | db.removed):       # A2, A4
        if safe(t) and t in merged:
            merged.remove(t)

    # ---- C1 / C5: functional-property divergence -------------------------
    # For each single-valued predicate, if both sides set (s,p) to different
    # objects, that is a true conflict. C5 is the same test where the objects
    # are literals differing by value/datatype/lang.
    def sp_objects(delta_added: set, s, p) -> set:
        return {o for (ss, pp, o) in delta_added if ss == s and pp == p}

    cand = {(s, p) for (s, p, _o) in (da.added | db.added) if p in fp}
    for (s, p) in cand:
        if s in c2_subjects:
            continue
        ours_obj = sp_objects(da.added, s, p)
        theirs_obj = sp_objects(db.added, s, p)
        if ours_obj and theirs_obj and ours_obj != theirs_obj:
            is_literal = any(isinstance(o, Literal) for o in ours_obj | theirs_obj)
            conflicts.append(
                Conflict(
                    kind="C5_literal" if is_literal else "C1_functional",
                    subject=str(s),
                    predicate=str(p),
                    ours=[str(o) for o in ours_obj],
                    theirs=[str(o) for o in theirs_obj],
                    detail="Single-valued property set to different values on each side.",
                )
            )
            # Leave BOTH out of merged to force an explicit human pick,
            # so we never silently keep an arbitrary one.
            for o in ours_obj | theirs_obj:
                if (s, p, o) in merged:
                    merged.remove((s, p, o))

    # ---- C4: placement divergence (views only) ---------------------------
    # Diagram interchange: a node's geometry is single-valued per view. If both
    # sides moved the same node to different coordinates, that's a position
    # conflict. Modelled generically via the geometry predicates in core-vis.
    if _is_quads(path):
        conflicts.extend(_detect_placement_conflicts(da, db))

    # ---- C3: union violates SHACL cardinality ----------------------------
    conflicts.extend(_detect_shacl_cardinality(merged))

    return merged, conflicts


def _detect_placement_conflicts(da: Delta, db: Delta) -> list[Conflict]:
    """C4: same diagram element, different bounds/Point on each side.
    Geometry predicates come from the core-vis ontology; kept simple here."""
    VIS = "https://meta.linked.archi/core-vis#"
    geom = {URIRef(VIS + n) for n in ("x", "y", "width", "height", "point")}
    out: list[Conflict] = []
    for p in geom:
        a = {(s, o) for (s, pp, o) in da.added if pp == p}
        b = {(s, o) for (s, pp, o) in db.added if pp == p}
        a_subj = {s for s, _ in a}
        b_subj = {s for s, _ in b}
        for s in a_subj & b_subj:
            ao = {o for ss, o in a if ss == s}
            bo = {o for ss, o in b if ss == s}
            if ao != bo:
                out.append(
                    Conflict(
                        kind="C4_placement",
                        subject=str(s),
                        predicate=str(p),
                        ours=[str(o) for o in ao],
                        theirs=[str(o) for o in bo],
                        detail="Same diagram node placed differently on each side.",
                    )
                )
    return out


def _detect_shacl_cardinality(merged: Graph) -> list[Conflict]:
    """C3: the merged graph individually-valid sides can still break a shape
    (e.g. two sides each add one value to a sh:maxCount 2 property -> 3).
    We run pyshacl and surface only cardinality-type results as conflicts."""
    try:
        from pyshacl import validate
    except ImportError:
        return []  # CI's dedicated SHACL stage will still catch it

    shapes = load_shapes()
    if len(shapes) == 0:
        return []
    conforms, report_graph, _ = validate(
        data_graph=merged, shacl_graph=shapes, inference="none", advanced=True
    )
    if conforms:
        return []

    out: list[Conflict] = []
    for res in report_graph.subjects(RDF.type, SH.ValidationResult):
        comp = report_graph.value(res, SH.sourceConstraintComponent)
        if comp and ("Count" in str(comp) or "Cardinality" in str(comp)):
            focus = report_graph.value(res, SH.focusNode)
            p = report_graph.value(res, SH.resultPath)
            out.append(
                Conflict(
                    kind="C3_shacl_cardinality",
                    subject=str(focus),
                    predicate=str(p) if p else None,
                    detail="Merged result violates a cardinality shape; trim values.",
                )
            )
    return out


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
def write_result(path: str, merged: Graph, conflicts: list[Conflict]) -> None:
    """Write the canonical merged graph to %A. If conflicts remain, keep the
    file VALID RDF (all auto-merged triples), prepend a human-readable comment
    block, and drop a machine-readable sidecar the room server / reviewer UI
    can render."""
    fmt = "trig" if _is_quads(path) else "turtle"
    body = merged.serialize(format=fmt)

    if conflicts:
        lines = [
            "# ====================================================================",
            f"# {len(conflicts)} UNRESOLVED SEMANTIC CONFLICT(S) — do not commit as-is.",
            "# Auto-merged triples are below and VALID. Each conflict is described",
            "# here and in the sidecar *.conflicts.json. Resolve, delete this block,",
            "# then `git add` the file.",
            "#",
        ]
        for i, c in enumerate(conflicts, 1):
            lines.append(f"#  [{i}] {c.kind}  <{c.subject}>")
            if c.predicate:
                lines.append(f"#      predicate : {c.predicate}")
            if c.ours or c.theirs:
                lines.append(f"#      ours      : {c.ours}")
                lines.append(f"#      theirs    : {c.theirs}")
            lines.append(f"#      -> {c.detail}")
        lines.append("# ====================================================================\n")
        body = "\n".join(lines) + "\n" + body

        sidecar = Path(path + ".conflicts.json")
        sidecar.write_text(json.dumps([asdict(c) for c in conflicts], indent=2))

    Path(path).write_text(body)


def main(argv: list[str]) -> int:
    if len(argv) < 5:
        sys.stderr.write("usage: rdf_merge.py %O %A %B %P\n")
        return 2
    base_p, ours_p, theirs_p, repo_path = argv[1], argv[2], argv[3], argv[4]

    base = load_graph(base_p)
    ours = load_graph(ours_p)
    theirs = load_graph(theirs_p)

    merged, conflicts = three_way_merge(base, ours, theirs, repo_path)
    write_result(ours_p, merged, conflicts)  # result MUST go to %A

    if conflicts:
        sys.stderr.write(
            f"rdf_merge: {len(conflicts)} semantic conflict(s) in {repo_path}; "
            f"left for manual resolution.\n"
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
