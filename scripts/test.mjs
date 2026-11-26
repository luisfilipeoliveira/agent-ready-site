#!/usr/bin/env node
// End-to-end test on the static example: init -> fixture content -> build -> pointers -> serve -> check.
// The Next.js example needs `npm install`, so it is covered by the manual steps in CONTRIBUTING.md.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { init } from "../cli/init.mjs";
import { build } from "../cli/generator.mjs";
import { check, parseRobots, robotsAllows } from "../cli/check.mjs";
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

  // ---------- English copy of a page whose URL is in another language ----------
  const pagesDir = join(dir, "agent-ready", "pages");
  const contact = join(pagesDir, "contact.md");
  writeFileSync(contact, "---\npath: /contacto\nmarkdown: /contact\ntitle: Contact\norder: 90\n---\n\nWrite any time.\n");
  build(dir);
  const map = JSON.parse(readFileSync(join(dir, "agent-ready", "markdown-map.json"), "utf8"));
  const contactMd = existsSync(join(dir, "contact.md")) ? readFileSync(join(dir, "contact.md"), "utf8") : "";
  const llmsTxt = readFileSync(join(dir, "llms.txt"), "utf8");
  const profileJson = JSON.parse(readFileSync(join(dir, "profile.json"), "utf8"));
  assert(
    !existsSync(join(dir, "contacto.md")) &&
      contactMd.includes("Source: https://example.com/contacto") &&
      map["/contacto"] === "/contact.md" &&
      llmsTxt.includes("(https://example.com/contact.md)") &&
      profileJson.pages.some((p) => p.url === "https://example.com/contacto" && p.markdown === "https://example.com/contact.md"),
    "markdown: gives a page an English copy name and the map, llms.txt and profile.json point to it",
  );
  const clash = join(pagesDir, "clash.md");
  writeFileSync(clash, "---\npath: /fale-connosco\nmarkdown: /contact\ntitle: Clash\n---\n\nx\n");
  let clashed = false;
  try {
    build(dir);
  } catch (error) {
    clashed = /both write \/contact\.md/.test(error.message);
  }
  assert(clashed, "two pages with the same copy name are rejected");
  writeFileSync(clash, "---\npath: /fora\nmarkdown: /../out\ntitle: Clash\n---\n\nx\n");
  clashed = false;
  try {
    build(dir);
  } catch (error) {
    clashed = /plain site path/.test(error.message);
  }
  assert(clashed && !existsSync(join(dir, "..", "out.md")), "a markdown path with .. is rejected");
  rmSync(clash);
  rmSync(contact);
  build(dir);
  assert(!existsSync(join(dir, "contact.md")), "build removes the English copy of a deleted page");

  // ---------- security ----------
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

  // Organization mode: type in profile.json, the logo uncropped on /agents, a clear error on an unknown type.
  const person = JSON.parse(readFileSync(join(dir, "profile.json"), "utf8"));
  assert(person.type === "person" && readFileSync(join(dir, "agents", "index.html"), "utf8").includes('<div class="av">'), "a site.json without type is a person");
  const siteOrg = readFileSync(join(dir, "agent-ready", "site.json"), "utf8");
  writeFileSync(join(dir, "agent-ready", "site.json"), JSON.stringify({ ...JSON.parse(siteOrg), type: "organization", name: "Example Co", handle: "example", avatar: "/logo.svg" }));
  build(dir);
  const orgProfile = JSON.parse(readFileSync(join(dir, "profile.json"), "utf8"));
  const orgAgents = readFileSync(join(dir, "agents", "index.html"), "utf8");
  assert(orgProfile.type === "organization" && orgProfile.name === "Example Co", "profile.json carries the organization type");
  assert(orgAgents.includes('<div class="av org">') && orgAgents.includes('src="/logo.svg"') && orgAgents.includes("example.md</span>") && orgAgents.includes(".bar .av.org img{object-fit:contain"), "/agents shows an organization's logo uncropped");
  writeFileSync(join(dir, "agent-ready", "site.json"), JSON.stringify({ ...JSON.parse(siteOrg), type: "company" }));
  let typeError = "";
  try {
    build(dir);
  } catch (error) {
    typeError = error.message;
  }
  assert(typeError.includes('"type" must be "person" or "organization"'), "an unknown type is rejected");
  writeFileSync(join(dir, "agent-ready", "site.json"), siteOrg);
  build(dir);
  const orgDir = mkdtempSync(join(tmpdir(), "agent-ready-org-"));
  try {
    init(orgDir, { type: "organization", framework: "static", out: "." });
    const placeholder = JSON.parse(readFileSync(join(orgDir, "agent-ready", "site.json"), "utf8"));
    assert(placeholder.type === "organization" && placeholder.handle === "yourorg" && placeholder.headline.includes("what the organization does"), "init --type organization writes organization placeholders");
    let flagError = "";
    try {
      init(orgDir, { type: "team" });
    } catch (error) {
      flagError = error.message;
    }
    assert(flagError.includes("--type must be person or organization"), "init rejects an unknown --type");
  } finally {
    rmSync(orgDir, { recursive: true, force: true });
  }

  // robots.txt parsing for the AI crawler check (RFC 9309: own group over *, longest rule wins, allow wins ties).
  const robots = parseRobots("User-agent: *\nDisallow: /private\n\nUser-agent: GPTBot\nUser-agent: CCBot\nDisallow: /\nAllow: /llms.txt$\n\nUser-agent: ClaudeBot\nDisallow: /*.txt\n\nUser-agent: PerplexityBot\nDisallow:\n");
  assert(robotsAllows(robots, "GPTBot", "/llms.txt") && !robotsAllows(robots, "gptbot", "/about.md") && !robotsAllows(robots, "CCBot", "/llms.txt.bak"), "robots.txt: a crawler's own group, with $ anchors and case-insensitive names");
  assert(!robotsAllows(robots, "ClaudeBot", "/llms.txt") && robotsAllows(robots, "ClaudeBot", "/private"), "robots.txt: * wildcards, and an own group replaces the * group");
  assert(robotsAllows(robots, "PerplexityBot", "/llms.txt") && !robotsAllows(robots, "Claude-User", "/private/x") && robotsAllows(robots, "Claude-User", "/llms.txt"), "robots.txt: empty Disallow allows all, others fall back to *");

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
    assert(lines.some((l) => l.startsWith("ok   robots.txt: none found")) && lines.some((l) => l.startsWith("ok   /llms.txt answers the")), "check reports no robots.txt and no User-Agent blocks");
  } finally {
    server.kill();
  }

  // A site that blocks AI crawlers in robots.txt and by User-Agent: the check warns but still passes.
  writeFileSync(join(dir, "robots.txt"), "User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n");
  const port2 = port + 1;
  const blocking = spawn(process.execPath, [join(ROOT, "scripts", "serve-static.mjs"), dir, String(port2)], { stdio: "ignore", env: { ...process.env, BLOCK_UA: "ClaudeBot|PerplexityBot" } });
  await new Promise((r) => setTimeout(r, 400));
  try {
    const lines = [];
    const ok = await check(`http://localhost:${port2}`, { log: (line) => lines.push(line) });
    const robotsLine = lines.find((l) => l.startsWith("warn robots.txt"));
    const uaLine = lines.find((l) => l.startsWith("warn AI crawler User-Agents"));
    assert(ok && robotsLine?.includes("GPTBot") && !robotsLine.includes("ClaudeBot"), "check warns on crawlers robots.txt blocks, without failing");
    assert(uaLine?.includes("ClaudeBot (403)") && uaLine.includes("PerplexityBot (403)") && !uaLine.includes("GPTBot"), "check warns on User-Agents the host refuses");
  } finally {
    blocking.kill();
    rmSync(join(dir, "robots.txt"));
  }
  console.log("\nAll tests passed.");
} catch (error) {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
