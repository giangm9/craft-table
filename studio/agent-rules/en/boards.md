# Boards and screen info

- Each version is a full copy `versions/<version>/{boards,system}`. ONLY edit inside the thread's own version.
- A board is real React: `boards/<id>.tsx`, which only `export default`s one component that takes a `scenario` prop (the scenario id) and draws exactly that scenario's state.
- A board imports only: `react`, `lucide-react`, `@ds` (the version's design system), `boards/_kit/**`. Its data is FAKE data (`boards/_kit/fixtures.ts`).
- Screen info lives in `boards/<id>.meta.json` next to the board: `title`, `section`, `group`, `order`, `status`, `desc`, `viewports`, `scenarios: [{ id, title, desc }]`. `status` is one of `current` (the app as it is today), `proposed`, `approved`. Names/descriptions/scenarios are PLAIN WORDS (see the project's plain-language rule in `rules`, if it has one).
- Edit the screens the person asks about DIRECTLY, in place, in the thread's version — a `current` screen too. Never copy a screen into an option or a new version on your own to leave it untouched. Don't change `status` unless the person asks.
- `current` = the screen was drawn from the real app. When you state what the app does today, look it up in the source code if the project declares it (`src:<folder>/...`) and quote path:line.
- An option of a screen has the id `<screen>~<slug>` (files next to the main screen: `.tsx`, `.meta.json`, a spec if any). Edit an option like any other screen.
- Make a new option ONLY when the person asks for one (an option, a variant, an alternative to compare) — never on your own, not even for a big change. Then copy the main screen's board + info to `<screen>~<slug>`, and the meta MUST have
  `"option": { "of": "<main screen>", "name": "<short name, e.g. A. Compact rows>", "status": "trying" }` — `of` is the main screen's exact id,
  `name` is the name shown in the screen list. The write/edit tools refuse any other shape. Don't change `status` yourself; the person adopts an option with a click.
- After editing a `.tsx`: `check typecheck` must be clean, then `view_frame` the right scenario to see the result yourself.
