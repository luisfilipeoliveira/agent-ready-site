import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detect } from "./detect.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(HERE, "..", "templates");

const PLACEHOLDER_HOME = `---
path: /
title: Home
summary: One line on what this page says.
order: 0
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
    headline: "One line on who you are and what you do, as the home page says it.",
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

/** Adds `node agent-ready/build.mjs` in front of the dev and build scripts, once. */
function wireScripts(root, pkg, log) {
  if (!pkg) return log.push("No package.json: run `node agent-ready/build.mjs` before each deploy.");
  const scripts = (pkg.scripts ??= {});
  const step = "node agent-ready/build.mjs";
  scripts["agent-ready"] = step;
  for (const name of ["predev", "prebuild"]) {
    if (!scripts[name]) scripts[name] = step;
    else if (!scripts[name].includes(step)) scripts[name] = `${step} && ${scripts[name]}`;
  }
  writeFileSync(join(root, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  log.push("package.json: added `agent-ready`, and the build step before `dev` and `build`.");
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
    writeFileSync(homePath, PLACEHOLDER_HOME);
    log.push("Wrote agent-ready/pages/index.md (placeholder home page).");
  }

  copyFileSync(join(HERE, "generator.mjs"), join(dir, "build.mjs"));
  log.push("Wrote agent-ready/build.mjs (the generator; rerun init to update it).");

  wireScripts(root, found.pkg, log);
  if (framework === "nextjs") nextProxy(root, found.srcDir ?? "", log);

  return { framework, outDir, log };
}
