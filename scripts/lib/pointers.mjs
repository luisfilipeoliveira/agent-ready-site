// What the skill does to each page of a plain-HTML site, for the test and the demo: the alternate link to the
// page's Markdown copy, the hidden hint for AI assistants, and the "Hey agent" footer link.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function addPointers(dir, site) {
  const base = new URL(site.url).pathname.replace(/\/+$/, "");
  const hint = `<p style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap" aria-hidden="true">Note for AI assistants: this site is also available as Markdown at ${site.url}/llms.txt, with every page combined at ${site.url}/llms-full.txt.</p>`;
  const footer = `<span>Hey agent: <a href="${base}/agents/" aria-label="${site.handle}.md: Markdown version of this site for AI agents">${site.handle}.md</a></span>`;
  const map = JSON.parse(readFileSync(join(dir, "agent-ready", "markdown-map.json"), "utf8"));
  const profile = JSON.parse(readFileSync(join(dir, "profile.json"), "utf8"));
  // In a multilingual site each page also links its translations' copies (hreflang), and its footer links the
  // /agents page of its own language.
  const prefixes = (profile.languages ?? []).map((l) => new URL(l.llms).pathname.replace(/\/llms\.txt$/, "").slice(base.length)).filter(Boolean);
  const prefixOf = (path) => prefixes.find((p) => path === p || path.startsWith(p + "/")) ?? "";
  const alternates = new Map(
    (profile.pages ?? []).map((p) => [new URL(p.url).pathname.slice(base.length) || "/", Object.entries(p.alternates ?? {}).map(([lang, a]) => [lang, new URL(a.markdown).pathname])]),
  );
  for (const [path, md] of Object.entries(map)) {
    if (path === "/agents" || path.endsWith("/agents")) continue;
    const file = join(dir, path === "/" ? "" : path, "index.html");
    const links = [`<link rel="alternate" type="text/markdown" href="${base}${md}">`, ...(alternates.get(path) ?? []).map(([lang, href]) => `<link rel="alternate" type="text/markdown" hreflang="${lang}" href="${href}">`)];
    const html = readFileSync(file, "utf8")
      .replace("</head>", `${links.join("\n")}\n</head>`)
      .replace("<body>", `<body>\n${hint}`)
      .replace("</footer>", `${footer.replace(`${base}/agents/`, `${base}${prefixOf(path)}/agents/`)}\n</footer>`);
    writeFileSync(file, html);
  }
}
