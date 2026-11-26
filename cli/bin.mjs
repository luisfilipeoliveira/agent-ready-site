#!/usr/bin/env node
import { resolve } from "node:path";
import { build } from "./generator.mjs";
import { init } from "./init.mjs";
import { readFileSync } from "node:fs";
import { check } from "./check.mjs";

const HELP = `agent-ready-site: make a website readable by AI agents.

Usage
  agent-ready-site init [--type person|organization] [--name "Jane Doe"] [--handle jane] [--url https://example.com] [--out public] [--framework nextjs|astro|vite|static] [--jsonld <file or URL>] [--force]
      Scaffold agent-ready/ in the current site and wire the build step.
      --jsonld fills site.json from the JSON-LD in a page (an HTML file, a .json file, or the running site's URL);
      on an existing site.json it only fills fields that are still empty or placeholders.
  agent-ready-site build
      Generate llms.txt, the page copies, profile.json and /agents from agent-ready/.
  agent-ready-site check <url>
      Check a running or deployed site (e.g. http://localhost:3000).
`;

/** The page HTML holding the JSON-LD: fetched from a URL, read from a file; a .json file is wrapped as one block. */
async function readJsonLdSource(source) {
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source, { redirect: "follow" });
    if (!res.ok) throw new Error(`--jsonld: ${source} answered ${res.status}`);
    return res.text();
  }
  const text = readFileSync(resolve(source), "utf8");
  return /\.json(ld)?$/i.test(source) ? `<script type="application/ld+json">${text}</script>` : text;
}

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
    const options = flags(rest);
    if (options.jsonld === true) throw new Error("--jsonld needs an HTML or JSON file, or a URL such as http://localhost:3000");
    if (typeof options.jsonld === "string") options.jsonld = await readJsonLdSource(options.jsonld);
    const { log } = init(root, options);
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
