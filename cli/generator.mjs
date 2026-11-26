#!/usr/bin/env node
/**
 * agent-ready-site generator. Self-contained (Node 18+, no dependencies): `init` copies this file into the
 * site as agent-ready/build.mjs and wires it to the site's dev/build scripts.
 *
 * Reads:   agent-ready/site.json        the site's name, handle, URL, contact, /agents copy
 *          agent-ready/pages/*.md       one Markdown copy per public page (frontmatter: path, title, summary, order)
 * Writes (into site.json "outDir", default "public"):
 *          llms.txt, llm.md             index in llmstxt.org format: home text, then a link to each copy
 *          llms-full.txt                everything in one file
 *          profile.json                 the site's public details as structured data
 *          <page path>.md               one copy per page (/about -> about.md, /work/x -> work/x.md)
 *          agents/index.html            the /agents page: a list of the files and a preview of llms.txt
 *          and agent-ready/markdown-map.json  page path -> Markdown copy, for Accept: text/markdown rewrites
 *
 * Every word comes from site.json and the page files, which hold only what the site itself says.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// ---------- input ----------

/** Minimal frontmatter: `key: value` lines between `---` fences. Values may be quoted. */
export function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return { data: {}, body: text.trim() };
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2].trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    data[kv[1]] = /^-?\d+$/.test(value) ? Number(value) : value;
  }
  return { data, body: match[2].trim() };
}

export function loadContent(root) {
  const dir = join(root, "agent-ready");
  const sitePath = join(dir, "site.json");
  if (!existsSync(sitePath)) throw new Error(`Missing ${relative(process.cwd(), sitePath)}. Run \`agent-ready-site init\` first.`);
  const site = JSON.parse(readFileSync(sitePath, "utf8"));
  for (const key of ["name", "handle", "url", "headline"]) {
    if (!site[key]) throw new Error(`agent-ready/site.json needs "${key}".`);
  }
  site.url = site.url.replace(/\/+$/, "");
  const pagesDir = join(dir, "pages");
  const pages = existsSync(pagesDir)
    ? readdirSync(pagesDir)
        .filter((file) => file.endsWith(".md"))
        .map((file) => {
          const { data, body } = parseFrontmatter(readFileSync(join(pagesDir, file), "utf8"));
          if (!data.path || !data.title) throw new Error(`agent-ready/pages/${file} needs "path" and "title" in its frontmatter.`);
          const path = data.path === "/" ? "/" : "/" + String(data.path).replace(/^\/+|\/+$/g, "");
          // The path becomes a file name: plain URL characters only, no "." or ".." segments.
          if (!/^\/[A-Za-z0-9._~\-/]*$/.test(path) || path.split("/").some((seg) => seg === "." || seg === ".."))
            throw new Error(`agent-ready/pages/${file}: path "${data.path}" must be a plain site path like /about or /work/case`);
          return { file, path, title: data.title, summary: data.summary ?? "", order: data.order ?? 100, body };
        })
        .sort((a, b) => a.order - b.order || a.path.localeCompare(b.path))
    : [];
  const home = pages.find((page) => page.path === "/");
  return { site, home, pages: pages.filter((page) => page.path !== "/") };
}

// ---------- Markdown ----------

const list = (items) => items.map((item) => `- ${item}`).join("\n");
const section = (title, ...body) => [`## ${title}`, ...body.filter(Boolean)].join("\n\n");
const doc = (...parts) => parts.filter((part) => part).join("\n\n") + "\n";
const mdPath = (page) => `${page.path}.md`;

export function agentFiles({ site, pages }) {
  return [
    { path: "/llms.txt", description: "The entry point: the home page, a link to each page copy, and contact details." },
    { path: "/llm.md", description: "An alias of /llms.txt for tools that look for this name." },
    { path: "/llms-full.txt", description: "The index and every page copy, joined into a single file." },
    { path: "/profile.json", description: "Name, headline, pages and contact as JSON." },
    ...pages.map((page) => ({ path: mdPath(page), description: `Markdown copy of the ${page.title} page.` })),
    ...(site.extraFiles ?? []),
    { path: "/agents", description: "A human-readable view of these files." },
  ];
}

function contact({ site }) {
  if (!site.contact?.length) return "";
  return section(site.contactTitle ?? "Contact", site.contactText ?? "", list(site.contact.map((c) => `${c.label}: ${c.value}`)));
}

export function buildLlmsTxt(content, { withContact = true } = {}) {
  const { site, home, pages } = content;
  return doc(
    `# ${site.name}`,
    `> ${site.headline}`,
    `Format: https://llmstxt.org. Below is the text of the home page (${site.url}), mirrored at ${site.url}/llm.md, followed by links to a Markdown copy of each other page.`,
    list(
      [site.readingPreference && `Reading preference: ${site.readingPreference}`, site.updated && `Updated: ${site.updated}`].filter(Boolean),
    ),
    home?.body ?? "",
    pages.length ? section("Pages", list(pages.map((p) => `[${p.title}](${site.url}${mdPath(p)})${p.summary ? `: ${p.summary}` : ""}`))) : "",
    section("Files", list(agentFiles(content).map((f) => `[${f.path}](${site.url}${f.path}): ${f.description}`))),
    withContact ? contact(content) : "",
  );
}

export function buildPageMd(content, page, { withContact = true } = {}) {
  const { site } = content;
  return doc(
    `# ${page.title}`,
    `Source: ${site.url}${page.path}`,
    page.summary ? `> ${page.summary}` : "",
    page.body,
    withContact ? contact(content) : "",
  );
}

export function buildLlmsFullTxt(content) {
  const parts = [buildLlmsTxt(content, { withContact: false }).trim()];
  for (const page of content.pages) parts.push("---", buildPageMd(content, page, { withContact: false }).trim());
  const c = contact(content);
  if (c) parts.push("---", c);
  return doc(...parts);
}

const plain = (text) => text.replace(/\*\*/g, "");

export function buildProfileJson(content) {
  const { site, pages } = content;
  return {
    name: site.name,
    headline: site.headline,
    ...(site.description ? { summary: site.description } : {}),
    ...(site.location ? { location: site.location } : {}),
    url: site.url,
    ...(site.updated ? { updated: site.updated } : {}),
    ...(site.readingPreference ? { readingPreference: site.readingPreference } : {}),
    contact: Object.fromEntries((site.contact ?? []).map((c) => [c.label.toLowerCase().replace(/[^a-z0-9]+/g, "_"), c.value])),
    pages: pages.map((p) => ({ title: p.title, summary: plain(p.summary), url: `${site.url}${p.path}`, markdown: `${site.url}${mdPath(p)}` })),
    ...(site.profile ? site.profile : {}),
    files: agentFiles(content).map((f) => `${site.url}${f.path}`),
  };
}

export function buildMarkdownMap(content) {
  return {
    "/": "/llms.txt",
    "/agents": "/llms.txt",
    ...Object.fromEntries(content.pages.map((p) => [p.path, mdPath(p)])),
  };
}

// ---------- /agents page ----------

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const LINK = /\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s)]+[^\s).,:;])/g;
const SAFE_URL = /^(https?:\/\/|mailto:|\/(?!\/))/i;

function inlineHtml(text) {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const index = match.index ?? 0;
    out += esc(text.slice(last, index));
    const [whole, label, href, bare] = match;
    const url = href ?? bare;
    // Only web, mail and site-relative links become clickable; anything else (javascript:, data:) stays text.
    if (!SAFE_URL.test(url)) {
      out += esc(whole);
      last = index + whole.length;
      continue;
    }
    out += label
      ? `<span class="m">[</span><a href="${esc(url)}">${esc(label)}</a><span class="m">](${esc(url)})</span>`
      : `<a href="${esc(url)}">${esc(whole)}</a>`;
    last = index + whole.length;
  }
  return out + esc(text.slice(last));
}

/** One line of the llms.txt preview: headings in bold, safe links clickable, everything else as text. */
function previewLineHtml(line) {
  if (/^#{1,6} /.test(line)) return `<strong>${esc(line)}</strong>`;
  return inlineHtml(line);
}

function formatSize(bytes) {
  if (typeof bytes !== "number") return "";
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Default UI tokens for /agents: a neutral palette in oklch with a 0.45rem radius. A site overrides any of
 * them through site.theme.light / site.theme.dark (same names, camelCase), e.g. with its own shadcn values.
 */
const DEFAULT_THEME = {
  light: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.147 0.004 49.25)",
    card: "oklch(1 0 0)",
    cardForeground: "oklch(0.147 0.004 49.25)",
    primary: "oklch(0.216 0.006 56.043)",
    primaryForeground: "oklch(0.985 0.001 106.423)",
    muted: "oklch(0.97 0.001 106.424)",
    mutedForeground: "oklch(0.553 0.013 58.071)",
    border: "oklch(0.923 0.003 48.717)",
    ring: "oklch(0.709 0.01 56.259)",
  },
  dark: {
    background: "oklch(0.147 0.004 49.25)",
    foreground: "oklch(0.985 0.001 106.423)",
    card: "oklch(0.216 0.006 56.043)",
    cardForeground: "oklch(0.985 0.001 106.423)",
    primary: "oklch(0.923 0.003 48.717)",
    primaryForeground: "oklch(0.216 0.006 56.043)",
    muted: "oklch(0.268 0.007 34.298)",
    mutedForeground: "oklch(0.709 0.01 56.259)",
    border: "oklch(1 0 0 / 10%)",
    ring: "oklch(0.553 0.013 58.071)",
  },
};
const DEFAULT_RADIUS = "0.45rem";
const DEFAULT_SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const DEFAULT_MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

// Theme values land inside <style>: only plain colour, length and font-list characters are allowed, so a
// value can never close the rule or the element. Anything else falls back to the default.
const SAFE_COLOUR = /^[#(),.%/\w\s-]+$/;
const SAFE_LENGTH = /^\d*\.?\d+(rem|px|em)$/;
const SAFE_FONT = /^[\w\s"',.-]+$/;

function safeValue(value, pattern, fallback, label) {
  if (value === undefined) return fallback;
  if (typeof value === "string" && pattern.test(value)) return value;
  console.warn(`agent-ready: ignored ${label} (not a plain value)`);
  return fallback;
}

function safeTheme(defaults, custom = {}, mode) {
  const out = { ...defaults };
  for (const key of Object.keys(custom)) {
    if (key in defaults) out[key] = safeValue(custom[key], SAFE_COLOUR, defaults[key], `theme.${mode}.${key}`);
  }
  return out;
}

const tokenVars = (t) => Object.entries(t).map(([k, v]) => `--${k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}:${v};`).join("");

export function buildAgentsHtml(content, sizes) {
  const { site } = content;
  const page = site.agentsPage ?? {};
  const title = page.title ?? "What AI agents read on this site";
  const lead =
    page.lead ??
    "Before a person opens a site, an AI assistant has often read it for them. The files below carry the words of every page as Markdown, so an assistant can quote them directly instead of piecing them together from the layout.";
  const notes = page.readme ?? [
    site.readingPreference ?? "AI tools are welcome to use the Markdown files below instead of the HTML pages.",
    "What follows is the full set of files an agent receives, unedited.",
  ];
  const theme = site.theme ?? {};
  const light = safeTheme(DEFAULT_THEME.light, theme.light, "light");
  const dark = safeTheme(DEFAULT_THEME.dark, theme.dark, "dark");
  const radius = safeValue(theme.radius, SAFE_LENGTH, DEFAULT_RADIUS, "theme.radius");
  const sans = safeValue(theme.fontSans, SAFE_FONT, DEFAULT_SANS, "theme.fontSans");
  const mono = safeValue(theme.fontMono, SAFE_FONT, DEFAULT_MONO, "theme.fontMono");

  const files = agentFiles(content)
    .map(
      (f) => `<li>
<div class="file-head"><a class="path" href="${esc(f.path)}">${esc(f.path)}</a>${sizes[f.path] !== undefined ? `<span class="size">${formatSize(sizes[f.path])}</span>` : ""}</div>
<p class="desc">${esc(f.description)}</p>
</li>`,
    )
    .join("\n");
  const preview = buildLlmsTxt(content).trimEnd().split("\n").map(previewLineHtml).join("\n");

  return `<!doctype html>
<html lang="${esc(site.language ?? "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.metaTitle ?? `For AI agents | ${site.name}`)}</title>
<meta name="description" content="${esc(page.description ?? `Markdown and JSON copies of ${site.url.replace(/^https?:\/\//, "")} for AI assistants: llms.txt, every page as Markdown, and a profile.`)}">
<link rel="canonical" href="${esc(site.url)}/agents">
<link rel="alternate" type="text/markdown" href="/llms.txt">
<style>
:root{${tokenVars(light)}--radius:${radius};color-scheme:light}
@media (prefers-color-scheme:dark){:root:not(.light){${tokenVars(dark)}color-scheme:dark}}
:root.dark{${tokenVars(dark)}color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--background);color:var(--foreground);font:16px/1.6 ${sans};-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:underline;text-decoration-color:var(--muted-foreground);text-underline-offset:3px}
a:hover{text-decoration-color:var(--foreground)}
a:focus-visible{outline:2px solid var(--ring);outline-offset:2px;border-radius:calc(var(--radius) - 2px)}
.wrap{max-width:720px;margin:0 auto;padding:0 16px}
header.top{border-bottom:1px solid var(--border)}
header.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:56px}
.site{font-weight:600;text-decoration:none}
.back{font-size:14px;color:var(--muted-foreground)}
main.wrap{padding-top:40px;padding-bottom:64px}
h1{font-size:28px;line-height:1.25;letter-spacing:-0.01em;margin:0 0 12px}
h2{font-size:16px;margin:0}
.lead{margin:0;color:var(--foreground)}
.notes{margin:16px 0 0;padding:0;list-style:none;font-size:14px;color:var(--muted-foreground)}
.notes li+li{margin-top:4px}
section{margin-top:32px}
.card{background:var(--card);color:var(--card-foreground);border:1px solid var(--border);border-radius:calc(var(--radius) + 4px);overflow:hidden}
.card-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 16px;border-bottom:1px solid var(--border)}
.files{list-style:none;margin:0;padding:0}
.files li{padding:12px 16px}
.files li+li{border-top:1px solid var(--border)}
.file-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.path{font-family:${mono};font-size:14px;overflow-wrap:anywhere}
.size{font-family:${mono};font-size:12px;color:var(--muted-foreground);white-space:nowrap}
.desc{margin:2px 0 0;font-size:14px;color:var(--muted-foreground)}
.m{color:var(--muted-foreground)}
.button{display:inline-flex;align-items:center;height:32px;padding:0 12px;border-radius:var(--radius);background:var(--primary);color:var(--primary-foreground);font-size:14px;font-weight:500;text-decoration:none}
.button:hover{opacity:.9}
pre{margin:0;padding:16px;background:var(--muted);font:13px/1.6 ${mono};white-space:pre-wrap;overflow-wrap:anywhere}
footer.bottom{border-top:1px solid var(--border);font-size:14px;color:var(--muted-foreground)}
footer.bottom .wrap{padding-top:16px;padding-bottom:16px}
</style>
</head>
<body>
<header class="top"><div class="wrap"><a class="site" href="/">${esc(site.name)}</a><a class="back" href="/">Back to the site</a></div></header>
<main class="wrap">
<h1>${esc(title)}</h1>
<p class="lead">${esc(lead)}</p>
<ul class="notes">${notes.map((line) => `<li>${esc(line)}</li>`).join("")}${site.updated ? `<li>Updated ${esc(site.updated)}</li>` : ""}</ul>
<section aria-labelledby="files-title">
<div class="card">
<div class="card-head"><h2 id="files-title">Files</h2></div>
<ul class="files">
${files}
</ul>
</div>
</section>
<section aria-labelledby="preview-title">
<div class="card">
<div class="card-head"><h2 id="preview-title">llms.txt</h2><a class="button" href="/llms.txt">Open</a></div>
<pre>${preview}</pre>
</div>
</section>
</main>
<footer class="bottom"><div class="wrap">${esc(site.handle)}.md</div></footer>
</body>
</html>
`;
}


// ---------- write ----------

/** The absolute file for a site path, or null if it would land outside outDir. */
export function safeTarget(outDir, path) {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  const target = resolve(outDir, "." + path);
  return target.startsWith(outDir + sep) ? target : null;
}

export function build(root = process.cwd()) {
  const content = loadContent(root);
  const outDir = resolve(root, content.site.outDir ?? "public");
  const bytes = (s) => Buffer.byteLength(s, "utf8");

  const files = new Map();
  const llms = buildLlmsTxt(content);
  files.set("/llms.txt", llms);
  files.set("/llm.md", llms);
  files.set("/llms-full.txt", buildLlmsFullTxt(content));
  files.set("/profile.json", JSON.stringify(buildProfileJson(content), null, 2) + "\n");
  for (const page of content.pages) files.set(mdPath(page), buildPageMd(content, page));

  const sizes = Object.fromEntries([...files].map(([path, text]) => [path, bytes(text)]));
  files.set("/agents/index.html", buildAgentsHtml(content, sizes));

  // Remove files a previous run wrote that no longer exist (a page was deleted or renamed).
  const ledgerPath = join(root, "agent-ready", ".generated.json");
  const previous = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : [];
  for (const old of Array.isArray(previous) ? previous : []) {
    if (files.has(old)) continue;
    const target = safeTarget(outDir, old);
    if (target) rmSync(target, { force: true });
    else console.warn(`agent-ready: ignored ledger entry outside ${outDir}: ${old}`);
  }

  for (const [path, text] of files) {
    const target = safeTarget(outDir, path);
    if (!target) throw new Error(`refusing to write outside ${outDir}: ${path}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  writeFileSync(ledgerPath, JSON.stringify([...files.keys()], null, 2) + "\n");
  writeFileSync(join(root, "agent-ready", "markdown-map.json"), JSON.stringify(buildMarkdownMap(content), null, 2) + "\n");
  return { outDir, files: [...files.keys()], content };
}

// Run directly: `node agent-ready/build.mjs`
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = process.argv[1].endsWith(join("agent-ready", "build.mjs")) ? resolve(dirname(process.argv[1]), "..") : process.cwd();
    const { outDir, files } = build(root);
    console.log(`agent-ready: wrote ${files.length} files to ${relative(process.cwd(), outDir) || "."}`);
  } catch (error) {
    console.error(`agent-ready: ${error.message}`);
    process.exit(1);
  }
}
