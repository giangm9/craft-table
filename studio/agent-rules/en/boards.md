# Boards and screen info

- Each version is a full copy `versions/<version>/{boards,system}`. ONLY edit inside the thread's own version.
- A board is real React: `boards/<id>.tsx`, which only `export default`s one component that takes a `scenario` prop (the scenario id) and draws exactly that scenario's state.
- A board imports only: `react`, `lucide-react`, `@ds` (the version's design system), `boards/_kit/**`. Its data is FAKE data (`boards/_kit/fixtures.ts`).
- Screen info lives in `boards/<id>.meta.json` next to the board: `title`, `section`, `group`, `order`, `status`, `desc`, `viewports`, `scenarios: [{ id, title, desc }]`. `status` is one of `current` (the app as it is today), `proposed`, `approved`. Names/descriptions/scenarios are PLAIN WORDS (see the project's plain-language rule in `rules`, if it has one).
- A screen with status `current` must match the real app (if the project declares its source code, look it up in `src:<folder>/...` and quote path:line when you state something about the app). Big changes go in a new version; don't edit the live one.
- An option of a screen has the id `<screen>~<slug>` (files next to the main screen: `.tsx`, `.meta.json`, a spec if any). Edit an option like any other screen.
- Making a new option (when the person asks): copy the main screen's board + info to `<screen>~<slug>`, and the meta MUST have
  `"option": { "of": "<main screen>", "name": "<short name, e.g. A. Compact rows>", "status": "trying" }` — `of` is the main screen's exact id,
  `name` is the name shown in the screen list. The write/edit tools refuse any other shape. Don't change `status` yourself; the person adopts an option with a click.
- After editing a `.tsx`: `check typecheck` must be clean, then `view_frame` the right scenario to see the result yourself.
