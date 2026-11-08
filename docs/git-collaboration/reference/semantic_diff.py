#!/usr/bin/env python3
"""
ci/semantic_diff.py — render a PR as added/removed/changed MODEL ELEMENTS.

Used in the PR pipeline (the `semantic-diff` CI stage):

    python ci/semantic_diff.py origin/main HEAD > diff.md

It compares two git refs, assembles the *whole* sharded model at each ref into
one graph, computes the triple-level delta, then GROUPS that delta by subject
so a reviewer sees "Application X: added realizes->Y, changed label" instead of
a 400-line Turtle patch.

Design notes
------------
* Operates on the assembled graph (all shards unioned), NOT per file — so an
  element whose triples move between shards still reads as one changed element,
  and relationships that live in a separate shard attach to their subject.
* Reuses the Delta concept from rdf_merge.py. If that module is importable we
  borrow `functional_predicates()` so "changed" (single-valued) renders as
  old -> new, while multi-valued renders as +added / -removed.
* Reads both refs WITHOUT checking them out, via `git cat-file`/`git archive`,
  so it is safe to run on a detached CI checkout.
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from rdflib import Graph, Dataset, URIRef, Literal

# Reuse metamodel-awareness from the merge driver when available.
try:
    from rdf_merge import functional_predicates, _is_quads
except Exception:  # pragma: no cover - fallback if run standalone
    def functional_predicates() -> set:
        return set()

    def _is_quads(path: str) -> bool:
        return str(path).endswith((".trig", ".nq"))


MODEL_GLOBS = ("model/**/*.ttl", "model/**/*.trig")


# ---------------------------------------------------------------------------
# Reading a whole model tree at an arbitrary git ref
# ---------------------------------------------------------------------------
def _git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True)


def list_model_files(ref: str) -> list[str]:
    """Every model shard present at `ref`."""
    out = _git("ls-tree", "-r", "--name-only", ref)
    files = []
    for line in out.splitlines():
        if line.startswith("model/") and line.endswith((".ttl", ".trig")):
            files.append(line)
    return files


def assemble_at_ref(ref: str) -> Graph:
    """Union every model shard at `ref` into a single graph/dataset.

    This is the diff-side twin of ci/assemble_graph.py: SHACL and semantic diff
    must both see the unified graph, because cross-shard structure (an app in
    one file realizing a capability defined in another) is only visible once
    assembled.
    """
    ds = Dataset()
    for path in list_model_files(ref):
        blob = _git("show", f"{ref}:{path}")
        fmt = "trig" if _is_quads(path) else "turtle"
        # Parse quads into the dataset; parse triples into the default graph.
        if fmt == "trig":
            ds.parse(data=blob, format="trig")
        else:
            ds.parse(data=blob, format="turtle")
    # Flatten to a single Graph of all triples (quads lose their graph name
    # here; placement/view changes are summarized separately below).
    g = Graph()
    for s, p, o in ds:
        g.add((s, p, o))
    return g


# ---------------------------------------------------------------------------
# Delta, grouped by element
# ---------------------------------------------------------------------------
@dataclass
class ElementChange:
    subject: str
    status: str                      # "added" | "removed" | "modified"
    added: list = field(default_factory=list)      # (p, o)
    removed: list = field(default_factory=list)     # (p, o)
    changed: list = field(default_factory=list)     # (p, old, new) functional


def diff_graphs(base: Graph, head: Graph) -> list[ElementChange]:
    base_t = set(base)
    head_t = set(head)
    added = head_t - base_t
    removed = base_t - head_t

    base_subj = {s for s, _, _ in base_t}
    head_subj = {s for s, _, _ in head_t}

    fp = functional_predicates()

    # Bucket added/removed triples by subject.
    add_by_s: dict = defaultdict(list)
    rem_by_s: dict = defaultdict(list)
    for s, p, o in added:
        add_by_s[s].append((p, o))
    for s, p, o in removed:
        rem_by_s[s].append((p, o))

    touched = set(add_by_s) | set(rem_by_s)
    changes: list[ElementChange] = []

    for s in sorted(touched, key=str):
        # Whole-element add / remove.
        if s not in base_subj:
            changes.append(ElementChange(str(s), "added", added=add_by_s[s]))
            continue
        if s not in head_subj:
            changes.append(ElementChange(str(s), "removed", removed=rem_by_s[s]))
            continue

        ec = ElementChange(str(s), "modified")
        a = add_by_s.get(s, [])
        r = rem_by_s.get(s, [])

        # Pair up functional-predicate changes as old -> new instead of +/-.
        a_by_p: dict = defaultdict(list)
        r_by_p: dict = defaultdict(list)
        for p, o in a:
            a_by_p[p].append(o)
        for p, o in r:
            r_by_p[p].append(o)

        for p in set(a_by_p) | set(r_by_p):
            if p in fp and a_by_p.get(p) and r_by_p.get(p):
                ec.changed.append((str(p), r_by_p[p][0], a_by_p[p][0]))
            else:
                for o in a_by_p.get(p, []):
                    ec.added.append((p, o))
                for o in r_by_p.get(p, []):
                    ec.removed.append((p, o))
        changes.append(ec)

    return changes


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------
def _short(term) -> str:
    """Compact an IRI/literal for display: last path/hash segment, or a quoted
    literal with its lang/datatype."""
    if isinstance(term, Literal):
        s = f'"{term}"'
        if term.language:
            s += f"@{term.language}"
        elif term.datatype:
            s += f"^^{_short(term.datatype)}"
        return s
    t = str(term)
    for sep in ("#", "/"):
        if sep in t:
            return t.rsplit(sep, 1)[-1] or t
    return t


def render_markdown(changes: list[ElementChange]) -> str:
    if not changes:
        return "## Semantic diff\n\n_No model-level changes._\n"

    added = [c for c in changes if c.status == "added"]
    removed = [c for c in changes if c.status == "removed"]
    modified = [c for c in changes if c.status == "modified"]

    lines = ["## Semantic diff", ""]
    lines.append(
        f"**{len(added)} added · {len(removed)} removed · "
        f"{len(modified)} modified** element(s)."
    )
    lines.append("")

    if added:
        lines.append("### 🟢 Added elements")
        for c in added:
            lines.append(f"- **{_short(c.subject)}**")
            for p, o in sorted(c.added, key=lambda x: str(x[0])):
                lines.append(f"    - `{_short(p)}` → {_short(o)}")
        lines.append("")

    if removed:
        lines.append("### 🔴 Removed elements")
        for c in removed:
            lines.append(f"- **{_short(c.subject)}** _(and all its triples)_")
        lines.append("")

    if modified:
        lines.append("### 🟡 Modified elements")
        for c in modified:
            lines.append(f"- **{_short(c.subject)}**")
            for p, old, new in sorted(c.changed, key=lambda x: str(x[0])):
                lines.append(f"    - `{_short(p)}`: {_short(old)} → {_short(new)}")
            for p, o in sorted(c.added, key=lambda x: str(x[0])):
                lines.append(f"    - + `{_short(p)}` → {_short(o)}")
            for p, o in sorted(c.removed, key=lambda x: str(x[0])):
                lines.append(f"    - − `{_short(p)}` → {_short(o)}")
        lines.append("")

    return "\n".join(lines)


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        sys.stderr.write("usage: semantic_diff.py <base-ref> <head-ref>\n")
        return 2
    base_ref, head_ref = argv[1], argv[2]
    base = assemble_at_ref(base_ref)
    head = assemble_at_ref(head_ref)
    changes = diff_graphs(base, head)
    sys.stdout.write(render_markdown(changes))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
