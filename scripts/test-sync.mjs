#!/usr/bin/env node
// The sync: init installs it, the audit follows every page's source in every language, and the Claude Code
// hooks ask for a sync before finishing and block a pull request while something is out of step.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { init } from "../cli/init.mjs";
import { build } from "../cli/generator.mjs";

const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
  console.log(`ok   ${msg}`);
};
const dir = mkdtempSync(join(tmpdir(), "agent-ready-sync-"));
const file = (rel, text) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const read = (rel) => readFileSync(join(dir, rel), "utf8");
const html = (lang, title, body) => `<!doctype html>\n<html lang="${lang}">\n<head><title>${title}</title></head>\n<body><main>${body}</main></body>\n</html>\n`;
const page = (front, body) => `---\n${Object.entries(front).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n\n${body}\n`;
// The hooks and the audit as Claude Code and CI run them: the copied agent-ready/sync.mjs, input on stdin.
const sync = (mode, input) => {
  const r = spawnSync(process.execPath, [join(dir, "agent-ready", "sync.mjs"), mode], { input: input ? JSON.stringify(input) : "", encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const silent = () => {};

try {
  // ---------- A static site in English and Portuguese, on GitHub ----------
  file("index.html", html("en", "Home", "<h1>Example Bikes</h1><h2>Shop</h2><p>City and road bikes.</p>"));
  file("about/index.html", html("en", "About", "<h2>How we work</h2><p>A test ride first.</p>"));
  file("pt/index.html", html("pt", "Início", "<h1>Example Bikes</h1><h2>Loja</h2><p>Bicicletas de cidade e de estrada.</p>"));
  file("pt/sobre/index.html", html("pt", "Sobre", "<h2>Como trabalhamos</h2><p>Primeiro um passeio de teste.</p>"));
  file("404.html", html("en", "Not found", "<p>Nothing here.</p>"));
  file(".git/config", '[remote "origin"]\n\turl = git@github.com:example/example-bikes.git\n');
  file(".claude/settings.json", JSON.stringify({ permissions: { allow: ["Bash(npm test)"] }, hooks: { Stop: [{ hooks: [{ type: "command", command: "echo done" }] }] } }));

  const { log } = init(dir, { framework: "static", out: ".", name: "Example Bikes", handle: "examplebikes" });
  assert(existsSync(join(dir, "agent-ready", "sync.mjs")) && existsSync(join(dir, ".claude", "agents", "agent-ready-sync.md")), "init installs the audit and the agent-ready-sync subagent");
  assert(existsSync(join(dir, ".github", "workflows", "agent-ready.yml")) && read(".github/workflows/agent-ready.yml").includes("node agent-ready/sync.mjs audit"), "init adds a workflow that audits pull requests on a GitHub repository");
  assert(read("agent-ready/pages/index.md").includes("source: index.html"), "init gives the placeholder home page its route file as source");
  init(dir, {});
  const settings = JSON.parse(read(".claude/settings.json"));
  const commands = JSON.stringify(settings.hooks);
  assert(
    settings.permissions.allow[0] === "Bash(npm test)" && commands.includes("echo done") && commands.split("sync.mjs\\\" stop").length === 2 && commands.split("sync.mjs\\\" pre-pr").length === 2,
    "init merges the Stop and PreToolUse hooks into an existing settings file, once, keeping what was there",
  );
  assert(log.some((l) => l.includes("Stop and PreToolUse")), "init says which hooks it added");

  const noGit = mkdtempSync(join(tmpdir(), "agent-ready-nogit-"));
  try {
    init(noGit, { framework: "static", out: "." });
    assert(!existsSync(join(noGit, ".github")), "no workflow without a GitHub remote");
  } finally {
    rmSync(noGit, { recursive: true, force: true });
  }

  // The copies, each naming its source.
  const site = JSON.parse(read("agent-ready/site.json"));
  site.headline = "Bike shop in Sample Town.";
  site.languages = ["en", "pt"];
  site.i18n = { pt: { headline: "Loja de bicicletas em Sample Town." } };
  site.syncIgnore = ["404.html"];
  file("agent-ready/site.json", JSON.stringify(site, null, 2));
  file("agent-ready/pages/index.md", page({ path: "/", title: "Home", source: "index.html" }, "## Shop\n\nCity and road bikes."));
  file("agent-ready/pages/about.md", page({ path: "/about", title: "About", source: "about/index.html" }, "## How we work\n\nA test ride first."));
  file("agent-ready/pages/pt/index.md", page({ path: "/pt", title: "Início", source: "pt/index.html" }, "## Loja\n\nBicicletas de cidade e de estrada."));
  file("agent-ready/pages/pt/about.md", page({ path: "/pt/sobre", title: "Sobre", source: "pt/sobre/index.html" }, "## Como trabalhamos\n\nPrimeiro um passeio de teste."));
  build(dir, { log: silent });
  assert(existsSync(join(dir, "agent-ready", "sync-lock.json")), "the build records each copy and its sources in sync-lock.json");
  let r = sync("audit");
  assert(r.code === 0 && r.out.includes("The copies for AI agents are up to date"), "the audit passes when every page has a copy in step with its source");
  assert(sync("stop", {}).out === "", "the Stop hook stays quiet when nothing is out of step");
  assert(sync("pre-pr", { tool_name: "Bash", tool_input: { command: "gh pr create --fill" } }).code === 0, "a pull request goes through when the audit passes");

  // ---------- A change in Portuguese ----------
  file("pt/sobre/index.html", html("pt", "Sobre", "<h2>Como trabalhamos</h2><p>Primeiro um passeio de teste, depois a medição.</p>"));
  const warnings = [];
  build(dir, { log: (w) => warnings.push(w) });
  assert(warnings.some((w) => w.includes('the page "Sobre" (Português) changed and its copy for AI agents didn\'t. Ask Claude to "update agent-ready"') && w.includes("pt/sobre/index.html changed")), "the build warns when a Portuguese page changed and its copy didn't");
  r = sync("audit");
  assert(r.code === 1 && r.err.includes("agent-ready/pages/pt/about.md is out of date") && !r.err.includes("pages/about.md is"), "the audit fails on the Portuguese copy only");
  assert(r.err.split("\n")[0] === 'agent-ready: The copies for AI agents need an update: "Sobre" (Português). Ask Claude to "update agent-ready".', "the audit opens with one plain sentence naming the page and its language");
  r = sync("stop", {});
  const stop = JSON.parse(r.out);
  assert(stop.decision === "block" && stop.reason.includes("pt/about.md") && stop.reason.includes("agent-ready-sync subagent"), "the Stop hook asks Claude to run the subagent before finishing");
  assert(sync("stop", { stop_hook_active: true }).out === "", "the Stop hook asks once, never in a loop");
  r = sync("pre-pr", { tool_name: "Bash", tool_input: { command: "git add . && gh pr create --fill" } });
  assert(r.code === 2 && r.err.includes("fix this before the pull request") && r.err.includes("pt/about.md"), "a pull request with gh is blocked while a copy is out of date");
  assert(sync("pre-pr", { tool_name: "mcp__github__create_pull_request", tool_input: {} }).code === 2, "a pull request through the GitHub tools is blocked too");
  assert(sync("pre-pr", { tool_name: "Bash", tool_input: { command: "npm test" } }).code === 0, "other commands are never blocked");

  // The subagent's work: update the copy, build, audit.
  file("agent-ready/pages/pt/about.md", page({ path: "/pt/sobre", title: "Sobre", source: "pt/sobre/index.html" }, "## Como trabalhamos\n\nPrimeiro um passeio de teste, depois a medição."));
  r = sync("audit");
  assert(r.code === 1 && r.err.includes("Generated files are out of date") && r.err.includes("/pt/sobre.md"), "the audit fails when a copy changed and the build didn't run");
  build(dir, { log: silent });
  assert(sync("audit").code === 0 && read("pt/llms-full.txt").includes("depois a medição"), "after the update and a build, the audit passes and the Portuguese files carry the change");

  // ---------- A change in English that leaves the words alone ----------
  file("about/index.html", read("about/index.html").replace("<main>", '<main class="wide">'));
  assert(sync("audit").err.includes("pages/about.md is out of date"), "a changed English source flags its copy");
  build(dir, { accept: true, log: silent });
  assert(sync("audit").code === 0, "build --accept records a source change that didn't touch the words");

  // ---------- Pages added and removed ----------
  file("pt/contacto/index.html", html("pt", "Contacto", "<p>Escreva-nos.</p>"));
  r = sync("audit");
  assert(r.code === 1 && r.err.includes("pt/contacto/index.html is a page with no copy"), "a new page without a copy fails the audit");
  file("agent-ready/pages/pt/contact.md", page({ path: "/pt/contacto", title: "Contacto", source: "pt/contacto/index.html" }, "Escreva-nos."));
  build(dir, { log: silent });
  assert(sync("audit").code === 0, "its copy fixes it");
  rmSync(join(dir, "pt", "contacto"), { recursive: true });
  r = sync("audit");
  assert(r.code === 1 && r.err.includes("its source pt/contacto/index.html no longer exists"), "a removed page whose copy stayed fails the audit");
  rmSync(join(dir, "agent-ready", "pages", "pt", "contact.md"));
  build(dir, { log: silent });
  assert(sync("audit").code === 0 && !existsSync(join(dir, "pt", "contact.md")), "deleting the copy fixes it and the build removes its files");

  // ---------- A page with no source ----------
  file("agent-ready/pages/about.md", page({ path: "/about", title: "About" }, "## How we work\n\nA test ride first."));
  build(dir, { log: silent });
  r = sync("audit");
  assert(r.code === 1 && r.err.includes('pages/about.md has no "source"') && r.err.includes("about/index.html is a page with no copy"), "a copy without source can't be followed, and its page counts as missing");

  // ---------- No site.json: the hooks stay out of the way ----------
  rmSync(join(dir, "agent-ready", "site.json"));
  assert(sync("stop", {}).out === "" && sync("pre-pr", { tool_name: "Bash", tool_input: { command: "gh pr create" } }).code === 0, "the hooks do nothing on a site that isn't set up");

  console.log("\nSync tests passed.");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
