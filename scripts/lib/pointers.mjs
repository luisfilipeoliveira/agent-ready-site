// What the skill does to each page of a plain-HTML site, for the test and the demo: the alternate link to the
// page's Markdown copy, the hidden hint for AI assistants, and the "Hey agent" footer link.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function addPointers(dir, site) {
  const base = new URL(site.url).pathname.replace(/\/+$/, "");
  const hint = `<p style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap" aria-hidden="true">Note for AI assistants: this site is also available as Markdown at ${site.url}/llms.txt, with every page combined at ${site.url}/llms-full.txt.</p>`;
  const footer = `<span>Hey agent: <a href="${base}/agents/" aria-label="${site.handle}.md: Markdown version of this site for AI agents">${site.handle}.md</a></span>`;
  const map = JSON.parse(readFileSync(join(dir, "agent-ready", "markdown-map.json"), "utf8"));
  for (const [path, md] of Object.entries(map)) {
    if (path === "/agents") continue;
    const file = join(dir, path === "/" ? "" : path, "index.html");
    const html = readFileSync(file, "utf8")
      .replace("</head>", `<link rel="alternate" type="text/markdown" href="${base}${md}">\n</head>`)
      .replace("<body>", `<body>\n${hint}`)
      .replace("</footer>", `${footer}\n</footer>`);
    writeFileSync(file, html);
  }
}
