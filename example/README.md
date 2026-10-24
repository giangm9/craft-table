# Acme Tasks — the example project

A small, made-up team to-do app designed in craft-table: three screens (task list, task detail, settings), each with its scenarios and its two-tab spec, and a design system of five components. Open it to see what a project looks like; the studio's end-to-end tests (`tests/run-e2e.mjs`) run on it.

## Run it

From the craft-table folder:

```sh
CRAFT_PROJECT=example node bin/craft-table.mjs start
```

then open http://localhost:5180 (another port: `STUDIO_PORT=5190`).

## What is inside

| Path | What it holds |
|---|---|
| `craft-table.json` | Name, one-line description, language of the project |
| `versions/index.json` | The versions, and which one is live (`main`) |
| `versions/main/version.json` | Title, status and note of that version |
| `versions/main/system/` | The design system: `tokens.css` and `components/` (imported in boards as `@ds`) |
| `versions/main/boards/` | One board per screen: `<id>.tsx`, `<id>.meta.json`, `<id>.behavior.md`, `<id>.tech.md`; shared pieces and fake data in `_kit/` |
| `rules/` | Extra rules for Claude in this project, on top of craft-table's own |

The studio adds `threads/` (design conversations) and `data/` (history, uploads; not kept in git) when it runs.
