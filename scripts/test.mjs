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
import { check, parseRobots, robotsAllows, siteFromJsonLd } from "../cli/check.mjs";
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

  // JSON-LD as a source for site.json: @graph, @id references, the WebSite's publisher, contact points, sameAs.
  const ldHtml = `<html><head><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", url: "https://example.com/", inLanguage: "pt-PT", publisher: { "@id": "#org" } },
      { "@type": "Person", "@id": "#founder", name: "Jane Doe" },
      { "@type": "Organization", "@id": "#org", name: "Example Co", url: "https://example.com/", description: "Tools for example teams.", logo: { "@type": "ImageObject", url: "https://example.com/logo.svg" }, address: { "@id": "#addr" }, founder: { "@id": "#founder" }, contactPoint: [{ "@type": "ContactPoint", contactType: "sales", email: "mailto:sales@example.com" }, { "@type": "ContactPoint", contactType: "customer support", telephone: "+1 555 0100" }], sameAs: ["https://www.linkedin.com/company/example", "https://github.com/example", "https://example.social/@co"] },
      { "@type": "PostalAddress", "@id": "#addr", addressLocality: "Braga", addressCountry: { "@type": "Country", name: "Portugal" } },
    ],
  })}</script><script type="application/ld+json">{ broken</script></head></html>`;
  const fromLd = siteFromJsonLd(ldHtml);
  assert(fromLd.fields.type === "organization" && fromLd.fields.name === "Example Co" && fromLd.fields.url === "https://example.com", "JSON-LD import picks the entity the WebSite publishes, and skips broken blocks");
  assert(fromLd.fields.avatar === "https://example.com/logo.svg" && fromLd.fields.location === "Braga, Portugal" && fromLd.fields.language === "pt-PT" && fromLd.fields.description === "Tools for example teams.", "JSON-LD import resolves @id references for the logo, address and language");
  assert(JSON.stringify(fromLd.fields.contact) === JSON.stringify([{ label: "Sales email", value: "sales@example.com" }, { label: "Customer Support phone", value: "+1 555 0100" }, { label: "LinkedIn", value: "https://www.linkedin.com/company/example" }, { label: "GitHub", value: "https://github.com/example" }, { label: "example.social", value: "https://example.social/@co" }]), "JSON-LD import turns contact points and sameAs into labelled contacts");
  assert(siteFromJsonLd(ldHtml, { type: "person" }).fields.name === "Jane Doe" && !("headline" in fromLd.fields), "--type picks the other entity, and the headline never comes from JSON-LD");
  assert(Object.keys(siteFromJsonLd("<html></html>").fields).length === 0, "a page without JSON-LD imports nothing");
  const ldDir = mkdtempSync(join(tmpdir(), "agent-ready-ld-"));
  try {
    const fresh = init(ldDir, { framework: "static", out: ".", jsonld: ldHtml });
    const ldSite = JSON.parse(readFileSync(join(ldDir, "agent-ready", "site.json"), "utf8"));
    assert(ldSite.type === "organization" && ldSite.name === "Example Co" && ldSite.headline.includes("what the organization does") && ldSite.handle === "yourorg" && fresh.log.some((l) => l.includes("filled type, name")), "init --jsonld fills a new site.json and leaves the headline and handle to the owner");
    writeFileSync(join(ldDir, "agent-ready", "site.json"), JSON.stringify({ ...ldSite, name: "Example Company", description: "", contact: [] }));
    const again = init(ldDir, { jsonld: ldHtml });
    const merged = JSON.parse(readFileSync(join(ldDir, "agent-ready", "site.json"), "utf8"));
    assert(merged.name === "Example Company" && merged.description === "Tools for example teams." && merged.contact.length === 5 && again.log.some((l) => l.includes("kept your name")), "init --jsonld on an existing site.json fills only empty fields and reports the rest");
  } finally {
    rmSync(ldDir, { recursive: true, force: true });
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
    const ok = await check(`http://localhost:${port}`, { log: (line) => lines.push(line), now: new Date("2026-02-15") });
    console.log(lines.map((l) => `     ${l}`).join("\n"));
    assert(ok, "check passes on the agent-ready static site");
    assert(lines.some((l) => l.startsWith("ok   the copies, profile.json and the live pages agree")) && !lines.some((l) => l.includes("mismatch")), "check finds no mismatch when the copies follow the site");
    assert(lines.some((l) => l.startsWith("ok   robots.txt: none found")) && lines.some((l) => l.startsWith("ok   /llms.txt answers the")), "check reports no robots.txt and no User-Agent blocks");
  } finally {
    server.kill();
  }

  // Copies that drifted from the site: each disagreement is a warning that names it; the check still passes.
  const siteDrift = readFileSync(join(dir, "agent-ready", "site.json"), "utf8");
  const aboutCopy = join(dir, "agent-ready", "pages", "about.md");
  const aboutBefore = readFileSync(aboutCopy, "utf8");
  const homeHtmlPath = join(dir, "index.html");
  const homeHtmlBefore = readFileSync(homeHtmlPath, "utf8");
  writeFileSync(join(dir, "agent-ready", "site.json"), JSON.stringify({ ...JSON.parse(siteDrift), headline: "Designer of everything.", contact: [{ label: "Phone", value: "+1 555 0100" }] }));
  writeFileSync(aboutCopy, aboutBefore.replace("## How I work", "## How I used to work"));
  writeFileSync(homeHtmlPath, homeHtmlBefore.replace("</head>", '<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Jane Doe","url":"https://example.org"}]}</script>\n</head>'));
  build(dir);
  const port3 = port + 2;
  const drifting = spawn(process.execPath, [join(ROOT, "scripts", "serve-static.mjs"), dir, String(port3)], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 400));
  try {
    const lines = [];
    const ok = await check(`http://localhost:${port3}`, { log: (line) => lines.push(line), now: new Date("2026-12-01") });
    const has = (...parts) => lines.some((l) => l.startsWith("warn mismatch") && parts.every((p) => l.includes(p)));
    assert(ok, "check still passes when the copies drift");
    assert(has("headline", "Designer of everything."), "check flags a headline that is not on the home page");
    assert(has("contact phone", "+1 555 0100"), "check flags a contact detail the site doesn't show");
    assert(has("/about", 'heading "How I used to work"') && !has("/about", "How I work\""), "check flags a copy heading that is not on its page");
    assert(has("JSON-LD type", "organization", "person") && has("updated", "304 days ago"), "check flags JSON-LD that disagrees with profile.json and a stale updated date");
    assert(lines.some((l) => /\(\d+ where the files and the site disagree\)/.test(l)), "the summary counts the mismatches");
    assert(!lines.some((l) => l.includes("agree (name")), "no all-clear line when something disagrees");
  } finally {
    drifting.kill();
    writeFileSync(join(dir, "agent-ready", "site.json"), siteDrift);
    writeFileSync(aboutCopy, aboutBefore);
    writeFileSync(homeHtmlPath, homeHtmlBefore);
    build(dir);
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
