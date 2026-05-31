# agent.md

This file binds the current working folder to a chippy discussion that holds its development tasks. The `dev-task-runner` skill reads this file when invoked from this folder, finds open tasks tagged `#dev` in the referenced discussion, and works them one at a time (HI → MI → LO priority, oldest first within each priority bucket).

## Documentation

Project documentation lives under `documentation\`:

- `documentation\documentation.md` — product spec: problem statement, requirements list (R1–R59), and gate reviews.
- `documentation\target-architecture.md` — target module architecture for the rewrite.
- `documentation\implementation-plan.md` — the sequential 15-step build plan.
- `documentation\datadefinition.md` — authoritative on-disk data format; the spec the `dev-task-runner` skill operates against.
- `documentation\changelog.md` — version history of implementation changes; the reference for the current and future version history.
- `documentation\chippy-color-reference.html` — canonical color palette (dark and light).

## Tasks

- discussion: C:\Users\phili\OneDrive\pesopaso\Notebook\chippy.md
- tag: dev

## Fields

- `discussion` — absolute path to a discussion `.md` file. Add additional `- discussion:` lines to bind multiple discussions; the skill merges and re-sorts tasks across the union.
- `tag` — the tag a task must carry (in addition to `#task` and an open state) to be picked up. Defaults to `dev`.
