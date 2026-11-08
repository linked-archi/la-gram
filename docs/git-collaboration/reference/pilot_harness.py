#!/usr/bin/env python3
"""
pilot/harness.py — side-by-side bake-off: Git-native store vs Flexo-MMS.

The point of a pilot is apples-to-apples. So we define each editing SCENARIO
once (a base model + two concurrent edits + the outcome we EXPECT), then drive
BOTH backends through the identical scenario via a common adapter interface and
score them on the same rubric.

    scenario suite ─┬─▶ GitStoreAdapter   (git + ci/rdf_merge.py)
                    └─▶ FlexoStoreAdapter (Flexo Layer-1 over HTTP)
                         │
                         ▼
                   one scorecard (correctness, conflict precision, latency)

Run:
    python pilot/harness.py                 # both backends, all scenarios
    python pilot/harness.py --only git      # just the Git stack
    python pilot/harness.py --flexo-url http://localhost:8080

The Git adapter is fully runnable today (it reuses the merge driver you already
have). The Flexo adapter is a thin HTTP client against Layer-1 endpoints; the
exact payloads depend on your deployment, so those spots are marked TODO(flexo).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path

# ---------------------------------------------------------------------------
# Scenario model — written ONCE, consumed by every backend.
# ---------------------------------------------------------------------------
@dataclass
class Scenario:
    id: str
    description: str
    base: str                      # Turtle: common ancestor
    ours: str                      # Turtle: full state of the model after edit A
    theirs: str                    # Turtle: full state of the model after edit B
    expect: str                    # "auto" | "C1" | "C2" | "C3" | "C4" | "C5"
    note: str = ""


# A compact but representative suite — one scenario per taxonomy bucket, plus
# the common happy path. Extend freely; this is the contract both stacks meet.
PREFIX = """@prefix : <https://model.linked.archi/> .
@prefix core: <https://meta.linked.archi/core#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
"""

SCENARIOS: list[Scenario] = [
    Scenario(
        id="A1_independent_adds",
        description="Both add a different realizes-link to the same app",
        base=PREFIX + ':APP1 a core:Application ; rdfs:label "Billing" .',
        ours=PREFIX + ':APP1 a core:Application ; rdfs:label "Billing" ; core:realizes :CAP_invoice .',
        theirs=PREFIX + ':APP1 a core:Application ; rdfs:label "Billing" ; core:realizes :CAP_dunning .',
        expect="auto",
        note="Multi-valued property → union keeps both links.",
    ),
    Scenario(
        id="A2_disjoint_subjects",
        description="Each edits a different element entirely",
        base=PREFIX + ':APP1 a core:Application . :APP2 a core:Application .',
        ours=PREFIX + ':APP1 a core:Application ; rdfs:label "A" . :APP2 a core:Application .',
        theirs=PREFIX + ':APP1 a core:Application . :APP2 a core:Application ; rdfs:label "B" .',
        expect="auto",
    ),
    Scenario(
        id="C1_functional_divergence",
        description="Both set the single-valued label to different values",
        base=PREFIX + ':APP1 a core:Application ; rdfs:label "Billing" .',
        ours=PREFIX + ':APP1 a core:Application ; rdfs:label "Billing Service" .',
        theirs=PREFIX + ':APP1 a core:Application ; rdfs:label "Billing Svc" .',
        expect="C1",
        note="rdfs:label constrained sh:maxCount 1 → true conflict.",
    ),
    Scenario(
        id="C2_delete_vs_modify",
        description="Ours deletes the element; theirs modifies it",
        base=PREFIX + ':APP1 a core:Application ; rdfs:label "Billing" .',
        ours=PREFIX + '# APP1 removed entirely',
        theirs=PREFIX + ':APP1 a core:Application ; rdfs:label "Billing Service" .',
        expect="C2",
    ),
    Scenario(
        id="C5_literal_divergence",
        description="Same functional literal differs by value",
        base=PREFIX + ':APP1 a core:Application ; core:version "1.0" .',
        ours=PREFIX + ':APP1 a core:Application ; core:version "1.1" .',
        theirs=PREFIX + ':APP1 a core:Application ; core:version "2.0" .',
        expect="C5",
    ),
]


# ---------------------------------------------------------------------------
# Outcome + rubric
# ---------------------------------------------------------------------------
@dataclass
class MergeOutcome:
    merged_clean: bool              # did the backend auto-merge without human?
    conflicts: list[str] = field(default_factory=list)  # conflict kinds reported
    latency_s: float = 0.0
    error: str | None = None


@dataclass
class Score:
    scenario: str
    backend: str
    expected: str
    got_clean: bool
    got_conflicts: list[str]
    correct: bool                   # did behavior match expectation?
    latency_s: float
    error: str | None = None


def judge(sc: Scenario, out: MergeOutcome) -> bool:
    """Correct = auto-merged when we expected 'auto', OR flagged the expected
    conflict class when we expected a conflict."""
    if out.error:
        return False
    if sc.expect == "auto":
        return out.merged_clean and not out.conflicts
    # expecting a specific conflict class
    return (not out.merged_clean) and any(sc.expect in c for c in out.conflicts)


# ---------------------------------------------------------------------------
# Adapter interface — the single contract both stacks implement.
# ---------------------------------------------------------------------------
class StoreAdapter(ABC):
    name: str

    @abstractmethod
    def run_scenario(self, sc: Scenario) -> MergeOutcome:
        """Set up base, create two branches with ours/theirs, attempt a merge,
        and report what happened."""
        ...


class GitStoreAdapter(StoreAdapter):
    """Runnable today. Builds a throwaway git repo, wires the rdf merge driver,
    and performs a real two-branch merge of one element file."""

    name = "git"

    def __init__(self, merge_driver: str = "ci/rdf_merge.py"):
        self.merge_driver = str(Path(merge_driver).resolve())

    def _git(self, repo: Path, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["git", "-C", str(repo), *args],
            capture_output=True, text=True,
        )

    def run_scenario(self, sc: Scenario) -> MergeOutcome:
        t0 = time.perf_counter()
        try:
            with tempfile.TemporaryDirectory() as d:
                repo = Path(d)
                f = repo / "model" / "elements" / "app" / "APP1.ttl"
                f.parent.mkdir(parents=True, exist_ok=True)

                self._git(repo, "init", "-q")
                self._git(repo, "config", "user.email", "pilot@local")
                self._git(repo, "config", "user.name", "pilot")
                # Wire the semantic merge driver + attributes.
                (repo / ".gitattributes").write_text(
                    "*.ttl merge=rdf\n*.trig merge=rdf\n"
                )
                self._git(repo, "config", "merge.rdf.name", "rdf semantic merge")
                self._git(repo, "config", "merge.rdf.driver",
                          f"python {self.merge_driver} %O %A %B %P")

                # base on main
                f.write_text(sc.base)
                self._git(repo, "add", "-A")
                self._git(repo, "commit", "-qm", "base")

                # branch ours
                self._git(repo, "checkout", "-qb", "ours")
                f.write_text(sc.ours)
                self._git(repo, "commit", "-qam", "ours")

                # branch theirs from base
                self._git(repo, "checkout", "-q", "main")
                self._git(repo, "checkout", "-qb", "theirs")
                f.write_text(sc.theirs)
                self._git(repo, "commit", "-qam", "theirs")

                # merge ours into theirs
                merge = self._git(repo, "merge", "ours")
                latency = time.perf_counter() - t0

                sidecar = Path(str(f) + ".conflicts.json")
                conflicts: list[str] = []
                if sidecar.exists():
                    conflicts = [c["kind"] for c in json.loads(sidecar.read_text())]

                clean = merge.returncode == 0 and not conflicts
                return MergeOutcome(merged_clean=clean, conflicts=conflicts,
                                    latency_s=latency)
        except Exception as e:  # pragma: no cover
            return MergeOutcome(merged_clean=False, error=repr(e),
                                latency_s=time.perf_counter() - t0)


class FlexoStoreAdapter(StoreAdapter):
    """Thin HTTP client against Flexo-MMS Layer-1. Needs a running instance.
    Flexo versions at the graph level, so 'merge' is a server operation, not a
    text merge — we create two branches, commit each side, then ask Flexo to
    merge and read back its diff/conflict report."""

    name = "flexo"

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def run_scenario(self, sc: Scenario) -> MergeOutcome:
        t0 = time.perf_counter()
        try:
            import urllib.request  # stdlib; swap for requests if you prefer

            repo = f"pilot-{sc.id}"
            # The calls below are the shape of Layer-1's LDP + SPARQL interface.
            # Exact paths/payloads depend on your deployment — fill per your
            # Flexo version's API docs.
            # TODO(flexo): create org/repo
            #   PUT {base}/orgs/pilot/repos/{repo}
            # TODO(flexo): load base model onto master
            #   POST {base}/orgs/pilot/repos/{repo}/branches/master/graph  (SPARQL UPDATE: INSERT DATA base)
            # TODO(flexo): branch 'ours' and 'theirs' from master
            #   PUT {base}/.../branches/ours   (ref = master commit)
            #   PUT {base}/.../branches/theirs
            # TODO(flexo): apply ours/theirs as SPARQL UPDATE on each branch
            # TODO(flexo): request a merge ours -> theirs
            #   POST {base}/.../merge  {source: ours, target: theirs}
            # TODO(flexo): read the merge result / conflict report
            raise NotImplementedError(
                "Fill Layer-1 endpoints for your Flexo deployment "
                f"(base_url={self.base_url})."
            )
        except NotImplementedError as e:
            return MergeOutcome(merged_clean=False, error=str(e),
                                latency_s=time.perf_counter() - t0)
        except Exception as e:  # pragma: no cover
            return MergeOutcome(merged_clean=False, error=repr(e),
                                latency_s=time.perf_counter() - t0)


# ---------------------------------------------------------------------------
# Runner + scorecard
# ---------------------------------------------------------------------------
def run(adapters: list[StoreAdapter]) -> list[Score]:
    scores: list[Score] = []
    for sc in SCENARIOS:
        for ad in adapters:
            out = ad.run_scenario(sc)
            scores.append(Score(
                scenario=sc.id, backend=ad.name, expected=sc.expect,
                got_clean=out.merged_clean, got_conflicts=out.conflicts,
                correct=judge(sc, out), latency_s=out.latency_s, error=out.error,
            ))
    return scores


def scorecard_md(scores: list[Score]) -> str:
    lines = ["## Pilot scorecard", "",
             "| Scenario | Backend | Expected | Clean? | Conflicts | Correct | Latency |",
             "|---|---|---|---|---|---|---|"]
    for s in scores:
        confs = ", ".join(s.got_conflicts) or "—"
        mark = "✅" if s.correct else ("⚠️ n/a" if s.error else "❌")
        err = f" ({s.error.splitlines()[0]})" if s.error else ""
        lines.append(
            f"| {s.scenario} | {s.backend} | {s.expected} | "
            f"{'yes' if s.got_clean else 'no'} | {confs} | {mark}{err} | "
            f"{s.latency_s*1000:.0f} ms |"
        )
    # Aggregate per backend over non-errored scenarios.
    lines.append("")
    for name in sorted({s.backend for s in scores}):
        rel = [s for s in scores if s.backend == name and not s.error]
        if rel:
            acc = sum(s.correct for s in rel) / len(rel) * 100
            lines.append(f"- **{name}**: {acc:.0f}% correct over {len(rel)} runnable scenario(s).")
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["git", "flexo"], default=None)
    ap.add_argument("--flexo-url", default="http://localhost:8080")
    ap.add_argument("--merge-driver", default="ci/rdf_merge.py")
    args = ap.parse_args(argv[1:])

    adapters: list[StoreAdapter] = []
    if args.only in (None, "git"):
        adapters.append(GitStoreAdapter(args.merge_driver))
    if args.only in (None, "flexo"):
        adapters.append(FlexoStoreAdapter(args.flexo_url))

    scores = run(adapters)
    sys.stdout.write(scorecard_md(scores) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
