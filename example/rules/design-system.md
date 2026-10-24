# Acme Tasks design system

- Boards import only `react`, `lucide-react`, `@ds` and `boards/_kit/**`. Fake data lives in `boards/_kit/fixtures.ts`; the app's top bar is `Shell` in `boards/_kit/Shell.tsx`, initials are `Avatar` in `boards/_kit/Avatar.tsx`.
- `@ds` has `Button` (primary, secondary, ghost, danger; one primary per screen), `Card` (optional title and actions), `Badge` (neutral, accent, success, warning, danger), `Checkbox` and `TextField`, plus `cn`. Use them before writing new markup; a new component goes into `system/components/` and is exported from `index.ts`.
- Colours come from tokens only: `ink-*`, `accent-*`, `surface`, `surface-2`, and `success-` / `warning-` / `danger-` with steps 50, 200 and 700. Never a hex value or a Tailwind palette colour in a board. Accent text is `accent-600`, fills under white text `accent-700`.
- Flat: borders, no shadows. Rows in a list touch each other (`divide-y` inside a `Card`).
- No `h-screen` or `min-h-screen` in boards: frames are measured by their content.
- Every screen works at 390 px wide: nothing wider than the phone, rows stack instead of squeezing.
- Words on screen are plain English, short, sentence case ("Mark as done", not "MARK AS DONE").
