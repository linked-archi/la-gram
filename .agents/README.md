# .agents

What the people and the agents working on la-gram write down besides the code.

| Path | Holds |
|---|---|
| `specs/la-gram/` | la-gram's specification: `requirements.md` (numbered requirements, cited by the code), `design.md`, and `tasks.md` — the task list by phase, known limitations and the change log, newest first |
| `specs/la-queries/` | the proposal, requirements and design of model questions, with its example queries |
| `specs/_archive/` | specifications that are no longer followed, kept for their history |
| `conventions.md` | principles and code conventions for working on la-gram |
| `tasks/<name>/` | one folder per piece of work — its plan, requirements, design, checklist and report — to read, and to continue from. Ignored by Git unless added: add one that others should be able to pick up |

Finishing a change: tests, the README, `specs/la-gram/` (requirements, design, and an entry in the change
log in `tasks.md`), and the documentation site in `docs-site/`.

**Kiro** reads `.kiro/specs/` and `.kiro/steering/`: there, `.kiro/specs` and
`.kiro/steering/project-conventions.md` are links to `specs/` and `conventions.md` here, so a spec
written here is a spec in Kiro too. On Windows, Git makes them links only with `core.symlinks` on (and
the right to make links); otherwise each is a small text file holding the path.
