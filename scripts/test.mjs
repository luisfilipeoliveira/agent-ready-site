#!/usr/bin/env node
// End-to-end test on the static example: init -> fixture content -> build -> pointers -> serve -> check.
// The Next.js example needs `npm install`, so it is covered by the manual steps in CONTRIBUTING.md.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { init } from "../cli/init.mjs";
import { build } from "../cli/generator.mjs";
import { check } from "../cli/check.mjs";
import { addPointers } from "./lib/pointers.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIX = join(ROOT, "scripts", "fixtures", "jane");
const dir = mkdtempSync(join(tmpdir(), "agent-ready-"));
const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
  console.log(`ok   ${msg}`);
};

try {
  cpSync(join(ROOT, "examples", "static-placeholder"), dir, { recursive: true });
  const { framework, outDir } = init(dir, {});
  assert(framework === "static" && outDir === ".", "init detects a static site served from its root");

  const site = { framework, outDir, ...JSON.parse(readFileSync(join(FIX, "site.json"), "utf8")) };
  writeFileSync(join(dir, "agent-ready", "site.json"), JSON.stringify(site));
  cpSync(join(FIX, "pages"), join(dir, "agent-ready", "pages"), { recursive: true });
  build(dir);
  assert(existsSync(join(dir, "work", "atlas-checkout.md")), "build writes nested page copies");

  // A removed page loses its copy on the next build.
  rmSync(join(dir, "agent-ready", "pages", "atlas-checkout.md"));
  build(dir);
  assert(!existsSync(join(dir, "work", "atlas-checkout.md")), "build removes the copy of a deleted page");
  cpSync(join(FIX, "pages"), join(dir, "agent-ready", "pages"), { recursive: true });
  build(dir);

  // ---------- security ----------
  const pagesDir = join(dir, "agent-ready", "pages");
  const evil = join(pagesDir, "evil.md");

  writeFileSync(evil, "---\npath: /../../escaped\ntitle: Evil\n---\n\nx\n");
  let threw = false;
  try {
    build(dir);
  } catch (error) {
    threw = /plain site path/.test(error.message);
  }
  assert(threw && !existsSync(join(dir, "..", "escaped.md")), "a page path with .. is rejected and nothing is written outside");
  rmSync(evil);

  const outside = join(dir, "..", `keep-${Date.now()}.txt`);
  writeFileSync(outside, "keep");
  writeFileSync(join(dir, "agent-ready", ".generated.json"), JSON.stringify(["/../" + outside.split("/").pop(), "/llms.txt"]));
  build(dir);
  assert(existsSync(outside), "a tampered ledger entry pointing outside outDir is not deleted");
  rmSync(outside);

  writeFileSync(evil, "---\npath: /links\ntitle: Links\norder: 99\n---\n\n[click](javascript:alert(1)) and [ok](https://example.com/a)\n");
  const home = join(pagesDir, "index.md");
  const homeBefore = readFileSync(home, "utf8");
  writeFileSync(home, homeBefore + "\n- [bad](javascript:alert(1))\n");
  const site0 = readFileSync(join(dir, "agent-ready", "site.json"), "utf8");
  writeFileSync(join(dir, "agent-ready", "site.json"), JSON.stringify({ ...JSON.parse(site0), theme: { light: { foreground: "red}</style><script>alert(1)</script>" }, radius: "1rem;}</style>", fontSans: "x</style><script>" } }));
  const warn = console.warn;
  console.warn = () => {};
  build(dir);
  console.warn = warn;
  const agents = readFileSync(join(dir, "agents", "index.html"), "utf8");
  assert(!/href="javascript:/i.test(agents) && agents.includes("[bad](javascript:alert(1))"), "javascript: links on /agents stay plain text");
  assert(!agents.includes("<script>alert") && agents.split("</style>").length === 2, "unsafe theme values fall back to the defaults");
  assert((agents.match(/<script/gi) ?? []).length === 1 && !/alert\(/.test(agents.split("<script>")[1]) && agents.includes(":root.dark{") && agents.includes("prefers-color-scheme:dark") && agents.includes("--radius:0.45rem"), "/agents has one inline script and ships the light, dark and radius tokens");
  rmSync(evil);
  writeFileSync(home, homeBefore);
  writeFileSync(join(dir, "agent-ready", "site.json"), site0);
  build(dir);

  // A site served under a sub-path: /agents links carry the prefix.
  const siteBase = readFileSync(join(dir, "agent-ready", "site.json"), "utf8");
  writeFileSync(join(dir, "agent-ready", "site.json"), JSON.stringify({ ...JSON.parse(siteBase), url: "https://example.com/sub/path" }));
  build(dir);
  const sub = readFileSync(join(dir, "agents", "index.html"), "utf8");
  assert(sub.includes('href="/sub/path/llms.txt"') && sub.includes('href="/sub/path/"') && !/href="\/llms\.txt"/.test(sub), "/agents links carry the base path of a sub-path site");
  writeFileSync(join(dir, "agent-ready", "site.json"), siteBase);
  build(dir);

  // ---------- sections and collections ----------
  const siteCol = readFileSync(join(dir, "agent-ready", "site.json"), "utf8");
  const aboutPath = join(pagesDir, "about.md");
  const aboutBefore = readFileSync(aboutPath, "utf8");
  writeFileSync(aboutPath, aboutBefore.replace("order: 10", "order: 10\nsection: About me"));
  mkdirSync(join(dir, "agent-ready", "data"), { recursive: true });
  writeFileSync(
    join(dir, "agent-ready", "data", "talks.json"),
    JSON.stringify({
      items: [
        { slug: "first-talk", name: "First talk", event: { name: "Example Conf" }, year: 2025, topics: ["Checkout", "Forms"], video: "" },
        { slug: "second-talk", name: "Second talk", event: { name: "Sample Meetup" }, year: 2024, topics: [], video: "https://example.com/v/2" },
      ],
    }),
  );
  writeFileSync(
    join(dir, "agent-ready", "talk.md"),
    "## Where\n\n{{event.name}}, {{year}}.\n\n## Topics\n\n{{list topics}}\n\nVideo: {{video}}\n",
  );
  writeFileSync(
    join(dir, "agent-ready", "site.json"),
    JSON.stringify({
      ...JSON.parse(siteCol),
      sections: ["Talks"],
      collections: [
        { name: "talks", section: "Talks", source: "agent-ready/data/talks.json", template: "agent-ready/talk.md", path: "/talks/{{slug}}", title: "{{name}}", summary: "{{event.name}}, {{year}}. {{join topics}}", order: 50, full: false },
      ],
    }),
  );
  build(dir);
  const llmsCol = readFileSync(join(dir, "llms.txt"), "utf8");
  const first = readFileSync(join(dir, "talks", "first-talk.md"), "utf8");
  const second = readFileSync(join(dir, "talks", "second-talk.md"), "utf8");
  assert(first.includes("Example Conf, 2025.") && first.includes("- Checkout\n- Forms") && !first.includes("Video:"), "a collection writes one copy per item from its template, dropping empty lines");
  assert(second.includes("Video: https://example.com/v/2") && !second.includes("## Topics\n\n\n"), "empty list placeholders leave no blank runs");
  assert(llmsCol.indexOf("## Talks") < llmsCol.indexOf("## About me") && llmsCol.includes("## Pages") && llmsCol.includes("[First talk](https://example.com/talks/first-talk.md): Example Conf, 2025. Checkout, Forms"),"llms.txt groups pages into sections, in site.sections order first");
  assert(llmsCol.includes("/talks/*.md") && !llmsCol.includes("[/talks/first-talk.md]"), "the file list shows a collection as one entry");
  const fullCol = readFileSync(join(dir, "llms-full.txt"), "utf8");
  assert(!fullCol.includes("# First talk") && fullCol.includes("# About"), "full: false keeps a collection out of llms-full.txt");
  const profileCol = JSON.parse(readFileSync(join(dir, "profile.json"), "utf8"));
  assert(profileCol.pages.some((p) => p.section === "Talks" && p.markdown.endsWith("/talks/second-talk.md")), "profile.json lists collection pages with their section");

  const reject = (siteJson, pattern, msg) => {
    writeFileSync(join(dir, "agent-ready", "site.json"), JSON.stringify(siteJson));
    let message = "";
    try {
      build(dir);
    } catch (error) {
      message = error.message;
    }
    assert(pattern.test(message), msg);
  };
  const colBase = JSON.parse(readFileSync(join(dir, "agent-ready", "site.json"), "utf8"));
  const col0 = colBase.collections[0];
  reject({ ...colBase, collections: [{ ...col0, path: "/talks/{{slug}}/../../x" }] }, /plain site path/, "a collection path with .. is rejected");
  reject({ ...colBase, collections: [{ ...col0, path: "/talks/{{missing}}" }] }, /need every field/, "a collection path with an empty field is rejected");
  reject({ ...colBase, collections: [{ ...col0, source: "../outside.json" }] }, /inside the site's folder/, "a collection source outside the site is rejected");
  reject({ ...colBase, collections: [{ ...col0, path: "/about" }] }, /Two pages have the path/, "two pages with the same path are rejected");

  rmSync(join(dir, "agent-ready", "data"), { recursive: true });
  rmSync(join(dir, "agent-ready", "talk.md"));
  writeFileSync(aboutPath, aboutBefore);
  writeFileSync(join(dir, "agent-ready", "site.json"), siteCol);
  build(dir);
  assert(!existsSync(join(dir, "talks", "first-talk.md")), "removing a collection removes its copies");

  // What the skill does to each page.
  addPointers(dir, site);

  const port = 4300 + Math.floor(Math.random() * 600);
  const server = spawn(process.execPath, [join(ROOT, "scripts", "serve-static.mjs"), dir, String(port)], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 400));
  try {
    const lines = [];
    const ok = await check(`http://localhost:${port}`, { log: (line) => lines.push(line) });
    console.log(lines.map((l) => `     ${l}`).join("\n"));
    assert(ok, "check passes on the agent-ready static site");
  } finally {
    server.kill();
  }
  console.log("\nAll tests passed.");
} catch (error) {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
