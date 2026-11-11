"""Is this the Python environment requirements-docs.txt pins?

    python scripts/docs/check_env.py [requirements-docs.txt]

Run by scripts/docs/run.mjs with .venv-docs' interpreter before every build and
serve, and at the end of setup. It imports MkDocs, Material and
pymdown-extensions, then compares the installed version of every package the
file pins (a ``name==version`` line) with its pin. Exit 0 when all match;
otherwise one line per problem on stderr, and exit 1:

    mkdocs-material: 9.7.6 installed, 9.7.7 required
    pymdown-extensions: not installed
    import material failed: ModuleNotFoundError: No module named 'material'

Standard library only, so that it runs in an environment that has nothing yet.
"""

from __future__ import annotations

import importlib
import importlib.metadata
import re
import sys
from pathlib import Path
from typing import Callable, Iterable

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_LOCK = ROOT / "requirements-docs.txt"

# What the build imports: MkDocs, Material's theme and the pymdownx extensions.
MODULES = ("mkdocs", "material", "pymdownx")

_PIN = re.compile(r"^([A-Za-z0-9][A-Za-z0-9._-]*)==(\S+)$")


def parse_pins(text: str) -> tuple[list[tuple[str, str]], list[str]]:
    """The ``(name, version)`` pins of a requirements file, and its lines that are not one.

    Blank lines and comments are skipped, and a trailing ``# …`` is stripped.
    """
    pins: list[tuple[str, str]] = []
    problems: list[str] = []
    for number, raw in enumerate(text.splitlines(), start=1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        match = _PIN.match(line)
        if match:
            pins.append((match.group(1), match.group(2)))
        else:
            problems.append(f"line {number}: not name==version: {raw.strip()}")
    return pins, problems


def check(
    pins: Iterable[tuple[str, str]],
    version: Callable[[str], str] = importlib.metadata.version,
    import_module: Callable[[str], object] = importlib.import_module,
    modules: Iterable[str] = MODULES,
) -> list[str]:
    """One line per problem: a module that does not import, a pin not installed, or another version."""
    problems: list[str] = []
    for module in modules:
        try:
            import_module(module)
        except Exception as error:  # any failure to import is a broken environment
            problems.append(f"import {module} failed: {type(error).__name__}: {error}")
    for name, required in pins:
        try:
            installed = version(name)
        except importlib.metadata.PackageNotFoundError:
            problems.append(f"{name}: not installed")
            continue
        if installed != required:
            problems.append(f"{name}: {installed} installed, {required} required")
    return problems


def main(argv: list[str]) -> int:
    lock = Path(argv[0]) if argv else DEFAULT_LOCK
    try:
        text = lock.read_text(encoding="utf-8")
    except OSError as error:
        print(f"{lock}: cannot be read: {error.strerror or error}", file=sys.stderr)
        return 1
    pins, problems = parse_pins(text)
    problems = [f"{lock.name}: {p}" for p in problems] + check(pins)
    if not pins:
        problems.append(f"{lock.name}: no name==version line")
    for problem in problems:
        print(problem, file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
