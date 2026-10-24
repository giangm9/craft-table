# craft-table

A design workbench for a product team. Screens are drawn as real React components with your own design system,
next to their specs, in versions you can compare, with Claude in the room as a design partner.

- **Boards**: one board per screen, written in React + Tailwind and rendered live in frames (desktop and phone),
  one frame per scenario ("A normal day", "No tasks yet", "A busy week").
- **Design system per version**: each version has its own `tokens.css` and components, imported in boards as `@ds`.
- **Specs**: every screen has a two-tab spec, *Behavior* (plain words, for everyone) and *Technical* (for the
  people who build it), edited together in the browser, with Mermaid diagrams.
- **Versions and options**: a version is a full copy of the design; an option is a variant of one screen that you
  try, compare and then adopt or remove.
- **History**: every change to a screen is kept as a snapshot you can compare and restore.
- **Threads with Claude**: talk about a screen, mark areas on its frames, and Claude edits the boards, specs and
  screen info, looks at the result in a real browser, and checks its own work before answering.
- **English and Vietnamese**: the studio follows each viewer's choice; Claude answers in the language you write in.

craft-table runs as a small Node server inside your design project folder. Your design lives in plain files
(`.tsx`, `.md`, `.json`) that you keep in git like any other code.

## Quick start

You need Node.js 22.13 or newer (24 recommended) and Git.

craft-table is not on the npm registry; install it from GitHub into a new folder (npm also downloads a Chrome,
which Claude uses to look at the screens):

```sh
mkdir my-design && cd my-design
npm init -y
npm install --save-dev github:giangm9/craft-table
npx craft-table init --name "My product"
npx craft-table start
```

Open http://localhost:5180. You get a welcome screen and a small design system to start from.

To work with Claude, connect it once (it is saved in the project's `.env`, readable only by you):

```sh
npx craft-table login            # sign in with your Claude subscription (runs `claude setup-token`)
npx craft-table login --api-key sk-ant-…   # or use an Anthropic API key
```

Restart the studio after logging in.

If Claude says it cannot open a browser ("Could not find Chrome"), your npm skipped Puppeteer's install script;
run `npx puppeteer browsers install chrome` once.

To look around a finished project first, clone this repository, run `npm install`, then
`CRAFT_PROJECT=example node bin/craft-table.mjs start`.

## Commands

| Command | What it does |
|---|---|
| `craft-table init [folder] [--name <name>] [--lang en\|vi]` | Creates a project: `craft-table.json`, a `main` version with a small design system and a welcome screen, `.gitignore` |
| `craft-table start` | Serves the studio (port `STUDIO_PORT`, default 5180) |
| `craft-table login [token\|file] [--api-key <key>]` | Connects the studio's Claude; the credential goes into the project's `.env` |

Commands work on the current folder, or on the folder in `CRAFT_PROJECT`.

## A project folder

```
craft-table.json          name, description, language, optional source link and lint settings
versions/
  index.json              the versions and which one is live
  main/
    version.json          title, status and note of the version
    system/               the design system: tokens.css and components/ (imported as @ds)
    boards/               one board per screen:
      screens/orders.tsx          the screen (default export, takes a `scenario` prop)
      screens/orders.meta.json    title, description, scenarios, frames
      screens/orders.behavior.md  spec, Behavior tab
      screens/orders.tech.md      spec, Technical tab
      _kit/                       shared pieces and fake data for the boards
rules/                    extra rules for Claude in this project (optional)
threads/                  conversations (created by the studio; keep them in git if you like)
data/                     history, uploads, Claude's session (created by the studio; not for git)
.env                      secrets: Claude's credential, sign-in settings (not for git)
```

By convention a board imports only `react`, `lucide-react`, `@ds` and `boards/_kit/**` (Claude follows this rule),
so a board stays a picture of the design, never a piece of the real app.

### craft-table.json

```json
{
  "name": "Acme Tasks",
  "description": "a small team to-do app",
  "language": "en",
  "logo": "/logo.png",
  "source": { "path": "../acme-app", "label": "acme-app", "roots": ["src"], "extensions": ["ts", "tsx"] },
  "lint": { "plainLanguage": true },
  "externalOrigins": ["https://avatars.example.com"]
}
```

| Field | Meaning |
|---|---|
| `name` | Required. Shown in the studio and told to Claude |
| `description` | One line about the product, told to Claude |
| `language` | `en` (default) or `vi`: the studio's default language, the language of Claude's instructions, and of texts the studio writes into the project |
| `logo` | A file in the project's `public/` folder |
| `source` | Optional, read-only link to the real app's code: people can open it from specs, Claude can search and quote it (`path:line`) |
| `externalOrigins` | Other sites your boards load images or fonts from (e.g. an avatar service). Claude's screenshots block every other site |
| `lint.plainLanguage` | When `true`, screen descriptions, scenarios and the Behavior tab must be plain words: code, file paths and jargon are flagged in the editor and block Claude's check |

### Rules for Claude

Claude reads craft-table's own rules (how boards, specs and marks work) and the Markdown files in your project's
`rules/` folder. A file in `rules/` with the same name as a built-in topic (`boards.md`, `specs.md`, `marks.md`)
replaces it. Typical project rules: how to use your design system, words to use on screen, what the spec must cover.

## Languages

The studio speaks English and Vietnamese. Each viewer picks a language with the switch in the sidebar (also on the
Versions and Spec pages); the choice is a cookie (`ct_lang`). Without it, the project's `language` applies.

What the studio stores is language-neutral (status codes, not words), so people reading in different languages see
the same project. Claude's instructions follow the project's language, and Claude replies in the language each
person writes in.

## Running it for a team

On its own, the studio answers only the machine it runs on: anyone at `localhost` can use it, nobody else can.
For a team, run it on a server behind HTTPS and turn on sign-in with any OpenID Connect provider (Google, Keycloak,
Authentik, Auth0…). Set these in the environment or in the project's `.env`:

| Variable | Meaning |
|---|---|
| `STUDIO_PUBLIC_URL` | The address people open, e.g. `https://studio.example.com` (no path) |
| `IDP_ISSUER` | Your provider's issuer URL (its `/.well-known/openid-configuration` must answer) |
| `OIDC_CLIENT_ID` | Client id registered at the provider (default `craft-table`) |
| `OIDC_CLIENT_SECRET` | Its secret |
| `SESSION_SECRET` | At least 32 random characters, e.g. `openssl rand -hex 32` |
| `ALLOWED_EMAILS` | Optional comma-separated list of who may sign in; empty = anyone your provider lets through |

Register `<STUDIO_PUBLIC_URL>/__auth/callback` as the redirect URI. Sign-in turns on only when `IDP_ISSUER`,
`OIDC_CLIENT_SECRET` and `SESSION_SECRET` are all set; the start-up log says which mode is on.

Other settings: `STUDIO_PORT` (default 5180), `STUDIO_AGENT_MODEL` (Claude model alias, default `sonnet`),
`STUDIO_ENV_FILE` (another file instead of the project's `.env`), `CRAFT_PROJECT` (the project folder).

### Docker

The repository has a `Dockerfile`. Mount your project folder at `/project`:

```sh
docker build -t craft-table .

# One person on Linux: share the host's network, open http://localhost:5180
docker run -d --network host --user "$(id -u):$(id -g)" -v "$PWD:/project" --name studio craft-table

# A team (or Docker Desktop): publish the port and turn on sign-in
docker run -d -p 5180:5180 --user "$(id -u):$(id -g)" -v "$PWD:/project" --name studio \
  -e STUDIO_PUBLIC_URL=https://studio.example.com -e IDP_ISSUER=https://id.example.com \
  -e OIDC_CLIENT_SECRET=… -e SESSION_SECRET="$(openssl rand -hex 32)" craft-table

# Then connect Claude, and restart the container
docker exec -it studio craft-table login
docker restart studio
```

`--user` makes the files the studio and Claude write belong to you. Without sign-in, a browser that reaches the
container through a published port comes from Docker's network, not from "this machine", and gets an error page:
on Docker Desktop (Mac, Windows), either turn on sign-in or run the studio with `npx` instead of Docker.

## Security

- **Claude works in a closed sandbox.** It has no shell and no built-in tools: only the studio's own tools. They
  read the thread's version, its conversation and the rules, and write only boards, specs, screen info and the
  design system inside that version. Claude cannot read `.env` or `data/`, and the real app's source (`source`) is
  read-only.
- **Without sign-in, only this machine gets in.** A request counts as "this machine" when it comes from a loopback
  address, carries no forwarding headers and names `localhost` as its host. Requests from this machine also skip
  sign-in when sign-in is on, so tools on the server (and Claude's own browser) can use the studio.
- **Put a real proxy in front, never a raw TCP forward.** A reverse proxy or tunnel on the same machine must add
  `X-Forwarded-For` (nginx, Caddy, Traefik and cloudflared do). A raw TCP forward to `127.0.0.1` (`ssh -R`, `socat`)
  hides who is connecting, and anyone reaching it would pass as this machine.
- **Other sites cannot act for you.** Changes are refused when the browser says they come from another site
  (`Sec-Fetch-Site`, `Origin`), so a page elsewhere cannot use your session.
- **Sign-in** uses the authorization-code flow with `state`, `nonce` and PKCE; the ID token's signature is checked
  against the provider's keys. Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` on HTTPS.
- **Boards are code.** Anyone who can edit a board runs code in the browsers of people who open it. Give access only
  to people you would let into the design repository.

## Development

```sh
npm install
npm test             # unit tests (studio/lib and tests/)
npm run typecheck
npm run test:e2e     # end-to-end tests with a real Chrome, on the example project (port 5190)
```

The studio UI is React + Vite, served from source; there is no build step. Texts live in dictionaries
(`studio/src/i18n/` for the UI, `studio/lib/i18n/` for the server and Claude); `node studio/lib/i18n-gate.mjs` fails
when Vietnamese appears outside them, and `tests/vi-texts.test.mjs` locks the Vietnamese side.

## License

MIT — see [LICENSE](LICENSE).
