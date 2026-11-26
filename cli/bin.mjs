#!/usr/bin/env node
import { resolve } from "node:path";
import { build } from "./generator.mjs";
import { init } from "./init.mjs";
import { check } from "./check.mjs";

const HELP = `agent-ready-site: make a website readable by AI agents.

Usage
  agent-ready-site init [--name "Jane Doe"] [--handle jane] [--url https://example.com] [--out public] [--framework nextjs|astro|vite|static] [--force]
      Scaffold agent-ready/ in the current site and wire the build step.
  agent-ready-site build
      Generate llms.txt, the page copies, profile.json and /agents from agent-ready/.
  agent-ready-site check <url>
      Check a running or deployed site (e.g. http://localhost:3000).
`;

function flags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else out[key] = (i++, next);
  }
  return out;
}

const [command, ...rest] = process.argv.slice(2);
const root = resolve(process.cwd());

try {
  if (command === "init") {
    const { log } = init(root, flags(rest));
    console.log(log.map((line) => `- ${line}`).join("\n"));
    console.log("\nNext: fill agent-ready/site.json and agent-ready/pages/*.md from the site, then `node agent-ready/build.mjs`.");
  } else if (command === "build") {
    const { files, outDir } = build(root);
    console.log(`agent-ready: wrote ${files.length} files to ${outDir}`);
  } else if (command === "check") {
    if (!rest[0]) throw new Error("check needs a URL, e.g. agent-ready-site check http://localhost:3000");
    const ok = await check(rest[0]);
    process.exit(ok ? 0 : 1);
  } else {
    console.log(HELP);
    process.exit(command && command !== "help" && command !== "--help" ? 1 : 0);
  }
} catch (error) {
  console.error(`agent-ready-site: ${error.message}`);
  process.exit(1);
}
