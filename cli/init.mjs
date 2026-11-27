import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detect } from "./detect.mjs";
import { routeFiles } from "./generator.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(HERE, "..", "templates");

const PLACEHOLDER_HOME = `---
path: /
title: Home
summary: One line on what this page says.
order: 0
source: __HOME_SOURCE__
---

Replace this with the home page's content, in Markdown, in the page's own order and headings.
`;

function placeholderSite({ framework, outDir, name, handle, url }) {
  return {
    framework,
    outDir,
    name: name ?? "Your Name",
    handle: handle ?? "you",
    url: url ?? "https://example.com",
    language: "en",
    headline: "The home page's main line, as the site says it.",
    description: "",
    location: "",
    updated: new Date().toISOString().slice(0, 10),
    readingPreference:
      "AI tools are welcome to use the Markdown files instead of the HTML pages. This is a preference only; robots.txt blocks nothing.",
    contactTitle: "Contact",
    contactText: "",
    contact: [{ label: "Email", value: "hello@example.com" }],
    agentsPage: {
      title: "What AI agents read on this site",
      lead: "Before a person opens a site, an AI assistant has often read it for them. The files below carry the words of every page as Markdown, so an assistant can quote them directly instead of piecing them together from the layout.",
    },
  };
}

/** The hook commands init adds; a settings file that already runs agent-ready/sync.mjs for an event keeps it as it is. */
function mergeSettings(path, log) {
  const ours = JSON.parse(readFileSync(join(TEMPLATES, "claude", "settings.json"), "utf8"));
  let settings = {};
  if (existsSync(path)) {
    try {
      settings = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return log.push(`.claude/settings.json is not valid JSON: add the hooks from ${join("templates", "claude", "settings.json")} by hand.`);
    }
  }
  settings.hooks ??= {};
  const added = [];
  const updated = [];
  for (const [event, groups] of Object.entries(ours.hooks)) {
    const list = settings.hooks[event] ?? [];
    // Our own groups are replaced with the current ones (an older init may have written others); the rest stay.
    const others = list.filter((g) => !JSON.stringify(g).includes("agent-ready/sync.mjs"));
    if (others.length === list.length) added.push(event);
    else if (JSON.stringify(list.slice(others.length)) !== JSON.stringify(groups) || list.length - others.length !== groups.length) updated.push(event);
    settings.hooks[event] = [...others, ...groups];
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
  if (added.length) log.push(`.claude/settings.json: added the ${added.join(" and ")} hooks (sync before finishing, audit before a pull request).`);
  if (updated.length) log.push(`.claude/settings.json: updated the agent-ready ${updated.join(" and ")} hooks.`);
  if (!added.length && !updated.length) log.push(".claude/settings.json: the agent-ready hooks were already there.");
}

/** A GitHub remote in .git/config: the repository runs GitHub Actions on its pull requests. */
function onGitHub(root) {
  const config = join(root, ".git", "config");
  return existsSync(config) && /url\s*=\s*\S*github\.com[:/]/i.test(readFileSync(config, "utf8"));
}

/**
 * Keeping the files current: agent-ready/sync.mjs (the audit), the agent-ready-sync subagent and the
 * Claude Code hooks that run it, and on GitHub a workflow that audits every pull request.
 */
function installSync(root, log) {
  copyFileSync(join(HERE, "sync.mjs"), join(root, "agent-ready", "sync.mjs"));
  log.push("Wrote agent-ready/sync.mjs (the audit: `node agent-ready/sync.mjs audit`).");
  mkdirSync(join(root, ".claude", "agents"), { recursive: true });
  copyFileSync(join(TEMPLATES, "claude", "agent-ready-sync.md"), join(root, ".claude", "agents", "agent-ready-sync.md"));
  log.push("Wrote .claude/agents/agent-ready-sync.md (the subagent that updates the copies).");
  mergeSettings(join(root, ".claude", "settings.json"), log);
  if (onGitHub(root)) {
    const workflow = join(root, ".github", "workflows", "agent-ready.yml");
    if (!existsSync(workflow)) {
      mkdirSync(dirname(workflow), { recursive: true });
      copyFileSync(join(TEMPLATES, "github", "agent-ready.yml"), workflow);
      log.push("Wrote .github/workflows/agent-ready.yml (audits every pull request).");
    }
  }
}

/**
 * Adds `node agent-ready/build.mjs` in front of the dev and build scripts, once. It goes inside the scripts
 * themselves, not in predev/prebuild: pnpm and Yarn 2+ don't run pre scripts, so the build step would be skipped.
 */
function wireScripts(root, pkg, log) {
  if (!pkg) return log.push("No package.json: run `node agent-ready/build.mjs` before each deploy.");
  const scripts = (pkg.scripts ??= {});
  const step = "node agent-ready/build.mjs";
  scripts["agent-ready"] = step;
  // Earlier versions of init used predev/prebuild: take the step out of them so it doesn't run twice.
  for (const name of ["predev", "prebuild"]) {
    if (scripts[name] === step) delete scripts[name];
    else if (scripts[name]?.startsWith(`${step} && `)) scripts[name] = scripts[name].slice(step.length + 4);
  }
  const wired = [];
  for (const name of ["dev", "build"]) {
    if (!scripts[name]) continue;
    if (!scripts[name].includes(step)) scripts[name] = `${step} && ${scripts[name]}`;
    wired.push(`\`${name}\``);
  }
  writeFileSync(join(root, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  log.push(
    wired.length
      ? `package.json: added \`agent-ready\`, and the build step at the start of ${wired.join(" and ")}.`
      : "package.json: added `agent-ready`. There is no `dev` or `build` script: run `npm run agent-ready` before each deploy.",
  );
}

function nextProxy(root, srcDir, log) {
  const base = join(root, srcDir);
  const existing = ["proxy.ts", "proxy.js", "middleware.ts", "middleware.js"].find((file) => existsSync(join(base, file)));
  const mapImport = srcDir ? "../agent-ready/markdown-map.json" : "./agent-ready/markdown-map.json";
  const proxy = readFileSync(join(TEMPLATES, "nextjs", "proxy.ts"), "utf8").replace("__MAP_IMPORT__", mapImport);
  if (existing) {
    writeFileSync(join(root, "agent-ready", "proxy.snippet.ts"), proxy);
    log.push(`${join(srcDir, existing)} exists: merge agent-ready/proxy.snippet.ts into it (see the Next.js recipe).`);
  } else {
    writeFileSync(join(base, "proxy.ts"), proxy);
    log.push(`Wrote ${join(srcDir, "proxy.ts")} (Accept: text/markdown rewrites and /agents).`);
  }
}

export function init(root, options = {}) {
  const found = detect(root);
  const framework = options.framework ?? found.framework;
  const outDir = options.out ?? found.outDir;
  const log = [`Detected: ${framework} (files go to ${outDir}/).`];
  const dir = join(root, "agent-ready");
  mkdirSync(join(dir, "pages"), { recursive: true });

  const sitePath = join(dir, "site.json");
  if (!existsSync(sitePath) || options.force) {
    writeFileSync(sitePath, JSON.stringify(placeholderSite({ framework, outDir, ...options }), null, 2) + "\n");
    log.push("Wrote agent-ready/site.json (placeholders: fill it from the site).");
  } else log.push("Kept the existing agent-ready/site.json.");

  const homePath = join(dir, "pages", "index.md");
  if (!existsSync(homePath)) {
    // The home page's route file, when the framework has one: the source the sync follows.
    const homeRoute = routeFiles(root, { framework, outDir }).find((f) => /^(src\/)?(app\/page|pages\/index|src\/pages\/index|src\/routes\/\+page|index)\.[a-z]+$/.test(f) || f === (outDir === "." ? "index.html" : `${outDir}/index.html`));
    writeFileSync(homePath, PLACEHOLDER_HOME.replace("__HOME_SOURCE__", homeRoute ?? ""));
    log.push("Wrote agent-ready/pages/index.md (placeholder home page).");
  }

  copyFileSync(join(HERE, "generator.mjs"), join(dir, "build.mjs"));
  log.push("Wrote agent-ready/build.mjs (the generator; rerun init to update it).");

  wireScripts(root, found.pkg, log);
  if (framework === "nextjs") nextProxy(root, found.srcDir ?? "", log);
  installSync(root, log);

  return { framework, outDir, log };
}
