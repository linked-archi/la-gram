"""Every page says what it is about, in one line: its front matter's ``description``.

A MkDocs hook (mkdocs.yml, ``hooks:``). Material writes ``description`` into
the page's ``<meta name="description">``; without one, every page shows the
site's description in search results. A page whose description is missing,
not a string, empty, more than one line or longer than 200 characters gets a
warning, which fails ``mkdocs build --strict``. Every other key is accepted as
it is: ``title`` (the navigation and the H1 give one anyway), and ``date``,
``date_modified`` and ``tags``, which the site does not ask for yet
(docs-site/developing/documentation.md).
"""

from __future__ import annotations

import logging
from typing import Any, Mapping

log = logging.getLogger("mkdocs.hooks.front_matter_hook")

MAX_LENGTH = 200


def description_problem(meta: Mapping[str, Any]) -> str | None:
    """What is wrong with a page's front-matter description, or ``None``."""
    if "description" not in meta or meta["description"] is None:
        return "no description in the front matter"
    value = meta["description"]
    if not isinstance(value, str):
        return f"the description is not a string ({type(value).__name__})"
    text = value.strip()
    if not text:
        return "the description is empty"
    if "\n" in text or "\r" in text:
        return "the description is more than one line"
    if len(text) > MAX_LENGTH:
        return f"the description is {len(text)} characters long; at most {MAX_LENGTH}"
    return None


def on_page_markdown(markdown: str, page, config, files) -> str:
    problem = description_problem(page.meta)
    if problem:
        log.warning("%s: %s", page.file.src_uri, problem)
    return markdown
