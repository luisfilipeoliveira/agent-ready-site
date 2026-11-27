#!/usr/bin/env node
import { resolve } from "node:path";
import { build } from "./generator.mjs";
import { init } from "./init.mjs";
import { check } from "./check.mjs";
import { audit } from "./sync.mjs";

const HELP = `agent-ready-site: make a website readable by AI agents.

Usage
  agent-ready-site init [--name "Jane Doe"] [--handle jane] [--url https://example.com] [--out public] [--framework nextjs|astro|sveltekit|vite|static] [--force]
      Scaffold agent-ready/ in the current site, wire the build step, and install the sync: the audit, the
      agent-ready-sync subagent and the Claude Code hooks (and a GitHub workflow on GitHub repositories).
  agent-ready-site build [--accept]
      Generate llms.txt, the page copies, profile.json and /agents from agent-ready/.
      --accept: the copies flagged as out of date are still right; stop flagging them.
  agent-ready-site audit [--url http://localhost:3000]
      Check that the copies still match the site's pages, in every language. Exit 1 if not.
      --url also runs check against the running site.
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
    console.log("\nNext: fill agent-ready/site.json and agent-ready/pages/*.md from the site (with a `source` for each page), then `node agent-ready/build.mjs`.");
  } else if (command === "build") {
    const { files, outDir } = build(root, { accept: Boolean(flags(rest).accept) });
    console.log(`agent-ready: wrote ${files.length} files to ${outDir}`);
  } else if (command === "audit") {
    const { problems, configured } = audit(root);
    if (!configured) throw new Error("no agent-ready/site.json here: run init first.");
    if (problems.length) console.error(`agent-ready audit: ${problems.length} problem${problems.length === 1 ? "" : "s"}.\n- ${problems.join("\n- ")}`);
    else console.log("agent-ready audit: the agent files match the site.");
    const url = flags(rest).url;
    const live = typeof url === "string" ? await check(url) : true;
    process.exit(problems.length || !live ? 1 : 0);
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
