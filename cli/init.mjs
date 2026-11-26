import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detect } from "./detect.mjs";
import { SITE_TYPES } from "./generator.mjs";
import { siteFromJsonLd } from "./check.mjs";

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

function placeholderSite({ framework, outDir, type = "person", name, handle, url }) {
  const org = type === "organization";
  return {
    framework,
    outDir,
    type,
    name: name ?? (org ? "Your Organization" : "Your Name"),
    handle: handle ?? (org ? "yourorg" : "you"),
    url: url ?? "https://example.com",
    language: "en",
    headline: org
      ? "One line on what the organization does, as the home page says it."
      : "One line on who you are and what you do, as the home page says it.",
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

/**
 * Fills site.json from JSON-LD. A new file takes every imported field; an existing one only fills fields that
 * are missing, empty or still the placeholder, so nothing the owner or an agent wrote is replaced.
 */
function applyJsonLd(site, html, { type }, log) {
  const { fields, notes } = siteFromJsonLd(html, { type });
  const placeholder = placeholderSite({ type: fields.type ?? site.type });
  const unset = (key) => {
    const v = site[key];
    if (v === undefined || v === "" || (Array.isArray(v) && !v.length)) return true;
    if (key === "type") return false; // the type follows the name: filled together below
    return JSON.stringify(v) === JSON.stringify(placeholder[key]) || JSON.stringify(v) === JSON.stringify(placeholderSite({})[key]);
  };
  const filled = [];
  const kept = [];
  for (const [key, value] of Object.entries(fields)) {
    if (key === "type" && type) continue; // --type wins
    // The type is taken with the name: a site.json whose name is still the placeholder takes both.
    if (key === "type" ? unset("name") : unset(key)) {
      site[key] = value;
      filled.push(key);
    } else if (JSON.stringify(site[key]) !== JSON.stringify(value)) kept.push(key);
  }
  // Became an organization: placeholders still written for a person switch to the organization ones.
  if (filled.includes("type") && site.type === "organization") {
    const person = placeholderSite({});
    for (const key of ["handle", "headline"]) if (site[key] === person[key]) site[key] = placeholder[key];
  }
  log.push(...notes.slice(0, -1).filter((n) => !n.startsWith("Imported")));
  if (filled.length) log.push(`site.json: filled ${filled.join(", ")} from JSON-LD.`);
  if (kept.length) log.push(`site.json: kept your ${kept.join(", ")} (JSON-LD differs; check which one the site shows).`);
  if (Object.keys(fields).length) log.push(notes[notes.length - 1]);
  else log.push(notes[0]);
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
  if (options.type !== undefined && !SITE_TYPES.includes(options.type))
    throw new Error(`--type must be ${SITE_TYPES.join(" or ")}, not "${options.type}".`);
  const log = [`Detected: ${framework} (files go to ${outDir}/).`];
  const dir = join(root, "agent-ready");
  mkdirSync(join(dir, "pages"), { recursive: true });

  const sitePath = join(dir, "site.json");
  if (!existsSync(sitePath) || options.force) {
    const site = placeholderSite({ framework, outDir, ...options });
    // Flags given on the command line beat JSON-LD: drop them from the placeholder check by marking them set.
    if (options.jsonld) applyJsonLd(site, options.jsonld, options, log);
    for (const key of ["name", "handle", "url"]) if (options[key]) site[key] = options[key];
    writeFileSync(sitePath, JSON.stringify(site, null, 2) + "\n");
    log.push("Wrote agent-ready/site.json (placeholders: fill it from the site).");
  } else if (options.jsonld) {
    const site = JSON.parse(readFileSync(sitePath, "utf8"));
    applyJsonLd(site, options.jsonld, options, log);
    writeFileSync(sitePath, JSON.stringify(site, null, 2) + "\n");
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
