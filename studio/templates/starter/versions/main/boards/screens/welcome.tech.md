# Welcome — Technical

- **Rules**: R1…R3 are the same rules as in the Behavior tab.
- **Code references**: set "source" in craft-table.json to your app's repository; then a reference like `src/<folder>/<file>.tsx:<line>` in this tab opens a read-only view of that code, and a src code block embeds the lines.

## Files
| Part | Where | What it does |
|---|---|---|
| Board | `boards/screens/welcome.tsx` | Draws each scenario with made-up data |
| Screen info | `boards/screens/welcome.meta.json` | Title, description, scenarios |
| Design system | `system/components/index.ts` | `Button` and `Card`, imported from `@ds` |
| Tokens | `system/tokens.css` | Colours and fonts (Tailwind v4 theme) |

## Rules → code
- **R1.** The first-visit branch renders both `Button`s: primary and secondary.
- **R2.** The returning branch greets `USER.firstName`.
- **R3.** `RECENT` holds the three latest pieces of work, newest first.

## Scenarios ↔ code
| Scenario | Code |
|---|---|
| first-visit | `scenario` missing, or anything but "returning" |
| returning | `scenario === "returning"` |
