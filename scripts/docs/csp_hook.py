"""The built site runs under app.linked.archi's Content-Security-Policy.

A MkDocs hook (mkdocs.yml, ``hooks:``). The server's policy runs no inline
script (``script-src 'self' 'wasm-unsafe-eval'``), and Material for MkDocs
writes a few into every page: the ``__md_get``/``__md_set`` helpers, the
palette restore, the content-tab restore. Without them, none of the theme's
JavaScript starts. So this hook:

- moves every executable inline ``<script>`` into a same-origin file,
  ``assets/javascripts/inline.<first 16 hex of its SHA-256>.js``, and puts a
  ``<script src>`` where it was: a synchronous external script runs at the same
  point in parsing, so order and position are kept. The same body on many
  pages is one file. Data blocks (``application/json``, ``application/ld+json``,
  ``text/template``) are left as they are.
- then checks every built ``*.html`` and ``*.css`` for anything else the policy
  would block, or a request to another site, and logs each as a warning, which
  fails ``mkdocs build --strict``.

``externalise``, ``audit_html`` and ``audit_css`` are pure functions over a
string, so a post-build pass over the output folder can use them as they are
(Zensical runs no hooks). How the site is written and built:
docs-site/developing/documentation.md.
"""

from __future__ import annotations

import hashlib
import html
import logging
import re
from html.parser import HTMLParser
from pathlib import Path
from typing import Callable
from urllib.parse import urlsplit

from mkdocs.utils import get_relative_url

log = logging.getLogger("mkdocs.hooks.csp_hook")

SCRIPT_DIR = "assets/javascripts"

# The HTML standard's JavaScript MIME type essences: a <script> whose type is
# one of these, or empty, or "module", runs; any other type is a data block.
JAVASCRIPT_TYPES = frozenset(
    {
        "application/ecmascript",
        "application/javascript",
        "application/x-ecmascript",
        "application/x-javascript",
        "text/ecmascript",
        "text/javascript",
        "text/javascript1.0",
        "text/javascript1.1",
        "text/javascript1.2",
        "text/javascript1.3",
        "text/javascript1.4",
        "text/javascript1.5",
        "text/jscript",
        "text/livescript",
        "text/x-ecmascript",
        "text/x-javascript",
    }
)

# Kept on the external script; async, defer, integrity and nonce are dropped:
# they do nothing on an inline script, and on an external one they would
# change when it runs.
_KEPT = re.compile(r"^(id|class|nomodule|data-.+)$")

# A comment, which is returned unchanged; or a script element, which ends at
# the first </script, as the HTML parser ends it.
_SCAN = re.compile(r"(<!--.*?-->)|<script\b([^>]*)>(.*?)</script\s*>", re.IGNORECASE | re.DOTALL)
_ATTRIBUTE = re.compile(
    r"""([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?"""
)
_ASCII_WHITESPACE = "\t\n\f\r "

# The site's executable inline scripts, collected over one build: site-relative
# path → body. Cleared by on_pre_build, written by on_post_build.
_scripts: dict[str, str] = {}
_moved = 0


def parse_attributes(source: str) -> list[tuple[str, str | None]]:
    """A start tag's attributes, in order: lower-cased names, unescaped values, ``None`` for a bare one."""
    attributes: list[tuple[str, str | None]] = []
    for match in _ATTRIBUTE.finditer(source):
        name = match.group(1).lower()
        value = next((v for v in match.group(2, 3, 4) if v is not None), None)
        attributes.append((name, html.unescape(value) if value is not None else None))
    return attributes


def script_kind(attributes: list[tuple[str, str | None]]) -> str | None:
    """``"classic"`` or ``"module"`` for a script that runs, ``None`` for a data block (HTML's rules)."""
    named = dict(attributes)
    if "type" in named:
        kind = (named["type"] or "").strip(_ASCII_WHITESPACE).lower()
    elif named.get("language"):
        kind = "text/" + named["language"].strip(_ASCII_WHITESPACE).lower()
    else:
        kind = ""
    if kind == "" or kind in JAVASCRIPT_TYPES:
        return "classic"
    if kind == "module":
        return "module"
    return None


def script_name(body: str) -> str:
    """The site-relative path a script's body is written to: named by its content."""
    return f"{SCRIPT_DIR}/inline.{hashlib.sha256(body.encode('utf-8')).hexdigest()[:16]}.js"


def _attribute_text(name: str, value: str | None) -> str:
    return f" {name}" if value is None else f' {name}="{html.escape(value, quote=True)}"'


def _transform(source: str, script_url: Callable[[str], str]) -> tuple[str, dict[str, str], int]:
    scripts: dict[str, str] = {}
    moved = 0

    def replace(match: re.Match[str]) -> str:
        nonlocal moved
        if match.group(1) is not None:
            return match.group(0)
        attributes = parse_attributes(match.group(2))
        body = match.group(3)
        if any(name == "src" for name, _ in attributes):
            return match.group(0)
        kind = script_kind(attributes)
        if kind is None:
            return match.group(0)
        if not body.strip(_ASCII_WHITESPACE):
            return ""
        moved += 1
        name = script_name(body)
        scripts[name] = body
        kept = "".join(_attribute_text(n, v) for n, v in attributes if _KEPT.match(n))
        module = ' type="module"' if kind == "module" else ""
        return f'<script src="{html.escape(script_url(name), quote=True)}"{module}{kept}></script>'

    return _SCAN.sub(replace, source), scripts, moved


def externalise(source: str, script_url: Callable[[str], str]) -> tuple[str, dict[str, str]]:
    """The HTML with each executable inline script replaced in place by an external one, and those scripts.

    ``script_url`` turns a site-relative script path into the URL the page
    loads it by. The scripts are returned as site-relative path → body.
    """
    output, scripts, _ = _transform(source, script_url)
    return output, scripts


def _collect(output: str, script_url: Callable[[str], str]) -> str:
    global _moved
    output, scripts, moved = _transform(output, script_url)
    _moved += moved
    for name, body in scripts.items():
        if _scripts.get(name, body) != body:
            log.warning("%s: two different scripts share this name", name)
        _scripts[name] = body
    return output


# ── The audit ──────────────────────────────────────────────────────────────

_ABSOLUTE = re.compile(r"^[\x00-\x20]*(https?:|//)", re.IGNORECASE)
_HTTP = re.compile(r"(?:^|,)[\x00-\x20]*http:", re.IGNORECASE)
_URL_ATTRIBUTES = ("href", "src", "action", "formaction", "xlink:href")
_LINK_RELS = frozenset(
    {
        "stylesheet",
        "preload",
        "modulepreload",
        "prefetch",
        "preconnect",
        "dns-prefetch",
        "icon",
        "apple-touch-icon",
        "mask-icon",
        "manifest",
    }
)
_EMBEDS = frozenset({"iframe", "frame", "embed", "object", "source", "track", "video", "audio"})
_SCRIPT_START = re.compile(r"<script\b", re.IGNORECASE)
_SCRIPT_END = re.compile(r"</script\s*>", re.IGNORECASE)
_CSS_IMPORT = re.compile(r"""@import\s+(?:url\(\s*)?["']?[\x00-\x20]*(?:https?:|//)""", re.IGNORECASE)
_CSS_URL = re.compile(r"""url\(\s*["']?[\x00-\x20]*(?:https?:|//)""", re.IGNORECASE)


def _is_javascript_url(value: str) -> bool:
    # Browsers strip leading and trailing C0 controls and spaces, and remove tabs
    # and newlines anywhere, before they read the scheme.
    return re.sub(r"[\x00-\x20]", "", value).lower().startswith("javascript:")


class _Audit(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.problems: list[str] = []
        self._script: list[tuple[str, str | None]] | None = None
        self._body: list[str] = []

    def _problem(self, message: str) -> None:
        self.problems.append(f"line {self.getpos()[0]}: {message}")

    def _check(self, tag: str, attributes: list[tuple[str, str | None]]) -> None:
        named = {name: value for name, value in attributes}
        for name, value in attributes:
            if name.startswith("on"):
                self._problem(f"inline event handler {name} on <{tag}>: the policy blocks it")
            if name in _URL_ATTRIBUTES and value is not None and _is_javascript_url(value):
                self._problem(f"javascript: URL in {name} of <{tag}>: the policy blocks it")
            if name == "srcset" and value is not None and _HTTP.search(value):
                self._problem(f"http: image in srcset of <{tag}>: mixed content")
        absolute: list[str] = []
        if tag == "script":
            absolute.append("src")
        elif tag == "link":
            rels = set((named.get("rel") or "").lower().split())
            if rels & _LINK_RELS:
                absolute.append("href")
        elif tag in _EMBEDS:
            absolute += ["src", "data"]
        for name in absolute:
            value = named.get(name)
            if value is not None and _ABSOLUTE.match(value):
                self._problem(f"<{tag}> {name} on another site: {value.strip()}")
        if tag == "img":
            src = named.get("src")
            if src is not None and _HTTP.search(src):
                self._problem(f"http: image in src of <img>: mixed content: {src.strip()}")
            if "alt" not in named:
                self._problem("<img> without alt")
        if "mermaid" in (named.get("class") or "").split():
            self._problem(f"class mermaid on <{tag}>: Material would load Mermaid from another site")

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = [(name.lower(), value) for name, value in attrs]
        self._check(tag, attributes)
        if tag == "script":
            self._script = attributes
            self._body = []

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._check(tag, [(name.lower(), value) for name, value in attrs])

    def handle_data(self, data: str) -> None:
        if self._script is not None:
            self._body.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag != "script" or self._script is None:
            return
        attributes, body = self._script, "".join(self._body)
        self._script, self._body = None, []
        if body and not any(name == "src" for name, _ in attributes) and script_kind(attributes) is not None:
            self._problem("executable inline <script>: the policy's script-src blocks it")


def audit_html(source: str) -> list[str]:
    """What in a built page the policy would block, or that asks another site for something: one line each."""
    problems: list[str] = []
    starts, ends = len(_SCRIPT_START.findall(source)), len(_SCRIPT_END.findall(source))
    if starts != ends:
        problems.append(f"{starts} <script> start tags but {ends} </script> end tags: a script is not closed")
    parser = _Audit()
    parser.feed(source)
    parser.close()
    return problems + parser.problems


def audit_css(source: str) -> list[str]:
    """A stylesheet's imports and url()s that point at another site: one line each."""
    problems: list[str] = []
    for number, line in enumerate(source.splitlines(), start=1):
        imports = _CSS_IMPORT.findall(line)
        problems += [f"line {number}: @import from another site"] * len(imports)
        urls = len(_CSS_URL.findall(line)) - len([i for i in imports if "url(" in i.lower()])
        problems += [f"line {number}: url() on another site"] * urls
    return problems


# ── MkDocs hooks ───────────────────────────────────────────────────────────


def on_pre_build(config) -> None:
    global _moved
    _scripts.clear()
    _moved = 0


def on_post_page(output: str, page, config) -> str:
    return _collect(output, lambda name: get_relative_url(name, page.url))


def on_post_template(output_content: str, template_name: str, config) -> str:
    # Static templates: 404.html among them, which MkDocs writes for any depth,
    # so its scripts are addressed from the site's root (/la-gram/docs/…).
    if not template_name.endswith(".html"):
        return output_content
    base = urlsplit(config.site_url or "/").path.rstrip("/")
    return _collect(output_content, lambda name: f"{base}/{name}")


def on_post_build(config) -> None:
    site = Path(config.site_dir)
    for name, body in sorted(_scripts.items()):
        target = site / name
        data = body.encode("utf-8")
        if target.is_file() and target.read_bytes() == data:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    for path in sorted(site.rglob("*")):
        if path.suffix not in (".html", ".css") or not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        problems = audit_html(text) if path.suffix == ".html" else audit_css(text)
        for problem in problems:
            log.warning("%s: %s", path.relative_to(site).as_posix(), problem)
    log.info("moved %d inline scripts into %d files", _moved, len(_scripts))
