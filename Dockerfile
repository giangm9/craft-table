# craft-table studio for any project. Mount the project folder (the one with craft-table.json) at /project.
#   docker build -t craft-table .
#
# Without sign-in the studio answers only its own machine: a browser coming through a published port (-p) arrives
# from Docker's network and gets 503 on every page. So run it one of two ways.
#
# One person on Linux — share the machine's network, open http://localhost:5180 (port taken? add -e STUDIO_PORT=…):
#   docker run -d --network host --user "$(id -u):$(id -g)" -v "$PWD:/project" --name studio craft-table
#
# A team, or Docker Desktop — publish the port and turn on sign-in through an OpenID Connect provider. Register
# <STUDIO_PUBLIC_URL>/__auth/callback there (client id "craft-table", or set OIDC_CLIENT_ID); ALLOWED_EMAILS limits
# who gets in. The same settings can be lines in /project/.env instead of -e:
#   docker run -d -p 5180:5180 --user "$(id -u):$(id -g)" -v "$PWD:/project" --name studio \
#     -e IDP_ISSUER=https://id.example.com -e OIDC_CLIENT_SECRET=your-client-secret \
#     -e SESSION_SECRET="$(openssl rand -hex 32)" -e STUDIO_PUBLIC_URL=https://studio.example.com craft-table
#
# Then connect the studio's Claude (saved in /project/.env):
#   docker exec -it studio craft-table login
#
# --user: what the studio and Claude write in the project (data/, threads/, boards, .env) belongs to you. Without it
# the studio runs as "node" (uid 1000, the first user on most Linux machines), never as root.
# The project needs no node_modules of its own: boards and its CSS use the packages shipped in this image
# (studio/lib/vite-config.mjs). Working data — history, uploads, Claude's session (HOME) — lives in /project/data.
FROM node:24-bookworm-slim

# unzip: Puppeteer unpacks Chrome with it. Fonts for the screenshots Claude takes of the boards (Latin with
# diacritics, Greek, Cyrillic…). tini runs as
# PID 1: it reaps the helper processes Chrome leaves behind (node as PID 1 would keep them as zombies).
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core fonts-noto-core ca-certificates tini unzip \
  && rm -rf /var/lib/apt/lists/*

# Chrome for those screenshots lives outside HOME (HOME is in the project's data/ at run time).
ENV PUPPETEER_CACHE_DIR=/opt/puppeteer
WORKDIR /app
COPY package.json package-lock.json ./
# Every dependency is a runtime dependency. One browser: npm ci skips puppeteer's own download (it would add
# chrome-headless-shell, which the studio never uses — shots.mjs launches headless: true, i.e. full Chrome), and
# Chrome is installed explicitly with the system libraries it needs (--install-deps uses apt, hence the list update).
RUN PUPPETEER_SKIP_DOWNLOAD=1 npm ci --no-audit --no-fund \
  && apt-get update \
  && npx puppeteer browsers install chrome --install-deps \
  && rm -rf /var/lib/apt/lists/* /root/.npm

COPY bin ./bin
COPY studio ./studio
COPY tsconfig.base.json ./
# /project belongs to "node": a fresh named volume mounted there takes that owner, so the studio can write to it.
RUN ln -s /app/bin/craft-table.mjs /usr/local/bin/craft-table && mkdir -p /project && chown node:node /project

ENV CRAFT_PROJECT=/project HOME=/project/data/home STUDIO_PORT=5180 \
    CRAFT_LOGIN_HINT="docker exec -it <container> craft-table login" NPM_CONFIG_UPDATE_NOTIFIER=false
USER node
EXPOSE 5180
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.STUDIO_PORT || 5180) + '/__api/project').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "bin/craft-table.mjs", "start"]
