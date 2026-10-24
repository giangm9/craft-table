#!/usr/bin/env node
// craft-table command line. Commands work on the project folder (the one with craft-table.json): the current
// folder, or CRAFT_PROJECT. The logic lives in studio/lib (init.mjs, login.mjs); this file only dispatches.
const [cmd = "help", ...args] = process.argv.slice(2);

const USAGE = `craft-table — a design workbench for your product team

Usage (inside your project folder, or with CRAFT_PROJECT=<folder>):
  craft-table init [folder] [--name <name>] [--lang en|vi]
                       create a project: a small design system and a welcome screen
  craft-table start    serve the studio (port: STUDIO_PORT, default 5180)
  craft-table login [token|file] [--api-key <key>]
                       connect the studio's Claude (saved in the project's .env)
  craft-table help     show this help`;

switch (cmd) {
  case "start": {
    // A missing or broken craft-table.json is a message for the user, not a stack trace.
    const { loadProject } = await import("../studio/lib/project.mjs");
    try {
      loadProject();
    } catch (e) {
      console.error(e.message);
      process.exitCode = 1;
      break;
    }
    await import("../studio/server.mjs");
    break;
  }
  case "init": {
    const { runInit } = await import("../studio/lib/init.mjs");
    process.exitCode = await runInit(args);
    break;
  }
  case "login": {
    const { runLogin } = await import("../studio/lib/login.mjs");
    process.exitCode = await runLogin(args);
    break;
  }
  case "help":
  case "--help":
  case "-h":
    console.log(USAGE);
    break;
  default:
    console.error(`Unknown command: ${cmd}\n\n${USAGE}`);
    process.exitCode = 1;
}
