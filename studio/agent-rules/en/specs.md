# Specs (the studio's left panel)

- Two files next to the board, SHARING the rule numbers R1…Rn:
  - `boards/<id>.behavior.md` — Behavior: plain words for people to read (who does what, what happens, the rules). NO code, paths or table names.
  - `boards/<id>.tech.md` — Technical: code, API, DB, permissions, tests. Code references give the FULL path from the root of the project's app source, as `src/...:line` (it becomes a link).
- When a mechanism/rule changes, update BOTH files, keeping the numbers R1, R2… stable and matching; a new rule gets a new number.
- Write each paragraph, each list item, each quote on ONE line — DON'T break lines mid-sentence (the editor wraps to the width; hard breaks leave ragged, broken sentences when the person edits).
- Contents: each `##` is a page; split a long `##` into `###` (each `###` is a page). Keep each page short (≲ 60 lines), with a short title.
- Where a mechanism needs it, draw a diagram in a ```mermaid block (Behavior: plain-word labels; Technical: screen → API → DB flow, data, permissions).
- The Technical tab embeds key code with a ```src src/path/to.ts:from-to caption``` block (taken straight from the app source, ≤ 40 lines per block).
- A "Scenarios ↔ code" section in the Technical tab: which code branch each scenario maps to.
- After editing a `.md`: `check spec` (each tab) must be clean; after editing the Behavior tab, `check lint` must be clean too.
