#!/usr/bin/env node
// End-to-end test on the static example: init -> fixture content -> build -> pointers -> serve -> check.
// The Next.js example needs `npm install`, so it is covered by the manual steps in CONTRIBUTING.md.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { init } from "../cli/init.mjs";
import { build, parseFrontmatter, sectionTitles } from "../cli/generator.mjs";
import { check, parseRobots, robotsAllows, siteFromJsonLd } from "../cli/check.mjs";
import { addPointers } from "./lib/pointers.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIX = join(ROOT, "scripts", "fixtures", "bike-shop");
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
  assert(existsSync(join(dir, "services", "bike-fitting.md")), "build writes nested page copies");

  // A removed page loses its copy on the next build.
  rmSync(join(dir, "agent-ready", "pages", "bike-fitting.md"));
  build(dir);
  assert(!existsSync(join(dir, "services", "bike-fitting.md")), "build removes the copy of a deleted page");
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

  // Organization mode (the fixture's own): type in profile.json, the logo uncropped on /agents.
  // Person mode: a site.json without type. And a clear error on an unknown type.
  const fixtureProfile = JSON.parse(readFileSync(join(dir, "profile.json"), "utf8"));
  assert(fixtureProfile.type === "organization" && readFileSync(join(dir, "agents", "index.html"), "utf8").includes('<div class="av org">'), "the bike shop fixture is an organization");
  const siteOrg = readFileSync(join(dir, "agent-ready", "site.json"), "utf8");
  const { type: _type, ...personSite } = JSON.parse(siteOrg);
  writeFileSync(join(dir, "agent-ready", "site.json"), JSON.stringify({ ...personSite, name: "Jane Doe", handle: "jane" }));
  build(dir);
  const person = JSON.parse(readFileSync(join(dir, "profile.json"), "utf8"));
  assert(person.type === "person" && person.name === "Jane Doe" && readFileSync(join(dir, "agents", "index.html"), "utf8").includes('<div class="av">'), "a site.json without type is a person");
  writeFileSync(join(dir, "agent-ready", "site.json"), JSON.stringify({ ...JSON.parse(siteOrg), name: "Example Co", handle: "example", avatar: "/logo.svg" }));
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

  // The build step goes inside dev and build (pnpm and Yarn 2+ skip pre scripts), once, and replaces old pre scripts.
  const pkgDir = mkdtempSync(join(tmpdir(), "agent-ready-pkg-"));
  try {
    const step = "node agent-ready/build.mjs";
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ scripts: { dev: "vite", build: "vite build", predev: step, prebuild: `${step} && tsc` } }));
    init(pkgDir, { framework: "vite" });
    init(pkgDir, { framework: "vite" });
    const { scripts } = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
    assert(
      scripts.dev === `${step} && vite` && scripts.build === `${step} && vite build` && !("predev" in scripts) && scripts.prebuild === "tsc" && scripts["agent-ready"] === step,
      "init puts the build step at the start of dev and build, once, without pre scripts",
    );
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ devDependencies: { "@sveltejs/kit": "^2.0.0", vite: "^6.0.0" } }));
    const svelte = init(pkgDir, {});
    assert(svelte.framework === "sveltekit" && svelte.outDir === "static", "init detects SvelteKit and writes into static/");
  } finally {
    rmSync(pkgDir, { recursive: true, force: true });
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
  assert(fromLd.fields.avatar === "https://example.com/logo.svg" && fromLd.fields.location === "Braga, Portugal" && fromLd.fields.language === undefined && fromLd.notes.some((n) => n.includes('"pt-PT"') && n.includes("English")) && fromLd.fields.description === "Tools for example teams.", "JSON-LD import resolves @id references for the logo and address, and flags a site that isn't in English");
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
  const aboutHeading = aboutBefore.match(/^## (.+)$/m)[1];
  // JSON-LD of the other type than the fixture's, and the fixture's own date, so the test holds for any fixture.
  const fixtureType = site.type ?? "person";
  const otherType = fixtureType === "person" ? "organization" : "person";
  const staleDays = Math.round((new Date("2026-12-01") - new Date(site.updated)) / 86400000);
  writeFileSync(aboutCopy, aboutBefore.replace(`## ${aboutHeading}`, `## ${aboutHeading}, before`));
  writeFileSync(homeHtmlPath, homeHtmlBefore.replace("</head>", `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"${otherType === "person" ? "Person" : "Organization"}","name":${JSON.stringify(site.name)},"url":"https://example.org"}]}</script>\n</head>`));
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
    assert(has("/about", `heading "${aboutHeading}, before"`) && !has("/about", `heading "${aboutHeading}"`), "check flags a copy heading that is not on its page");
    assert(has("JSON-LD type", otherType, fixtureType) && has("updated", `${staleDays} days ago`), "check flags JSON-LD that disagrees with profile.json and a stale updated date");
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
  // A bilingual site: English at the root, Portuguese under /pt. The case study has no Portuguese copy.
  const bi = mkdtempSync(join(tmpdir(), "agent-ready-bi-"));
  try {
    cpSync(join(ROOT, "examples", "static-placeholder"), bi, { recursive: true });
    init(bi, {});
    // The fixture's third page (not home, not about) stays untranslated, whatever the fixture is.
    const otherFile = readdirSync(join(FIX, "pages")).find((f) => f.endsWith(".md") && f !== "index.md" && f !== "about.md");
    const other = parseFrontmatter(readFileSync(join(FIX, "pages", otherFile), "utf8")).data;
    const biSite = { ...site, languages: ["en", "pt"], i18n: { pt: { headline: "A frase principal da página inicial, em português.", contactTitle: "Contacto" } } };
    writeFileSync(join(bi, "agent-ready", "site.json"), JSON.stringify(biSite));
    cpSync(join(FIX, "pages"), join(bi, "agent-ready", "pages"), { recursive: true });
    const ptPages = join(bi, "agent-ready", "pages", "pt");
    mkdirSync(ptPages, { recursive: true });
    writeFileSync(join(ptPages, "index.md"), "---\npath: /pt\ntitle: Início\norder: 0\n---\n\n## Destaques\n\n- Um destaque.\n");
    writeFileSync(join(ptPages, "about.md"), "---\npath: /pt/sobre\ntitle: Sobre\nsummary: Desenho produtos digitais há doze anos.\norder: 10\n---\n\n## Como trabalho\n\nComeço pelos números.\n");
    const page = (lang, title, body) => `<!doctype html>\n<html lang="${lang}">\n<head>\n<meta charset="utf-8">\n<title>${title}</title>\n</head>\n<body>\n<main>\n${body}\n</main>\n<footer>\n<span>${site.name}</span>\n<a href="mailto:hello@example.com">hello@example.com</a>\n</footer>\n</body>\n</html>\n`;
    mkdirSync(join(bi, "pt", "sobre"), { recursive: true });
    writeFileSync(join(bi, "pt", "index.html"), page("pt", site.name, `<h1>${site.name}</h1>\n<p>${biSite.i18n.pt.headline}</p>\n<h2>Destaques</h2>\n<p>Um destaque.</p>`));
    writeFileSync(join(bi, "pt", "sobre", "index.html"), page("pt", "Sobre", "<h1>Sobre</h1>\n<p>Desenho produtos digitais há doze anos.</p>\n<h2>Como trabalho</h2>\n<p>Começo pelos números.</p>"));
    build(bi);

    const en = readFileSync(join(bi, "llms.txt"), "utf8");
    const pt = readFileSync(join(bi, "pt", "llms.txt"), "utf8");
    assert(en.includes("## Languages\n\n- [Português](https://example.com/pt/llms.txt) (pt)") && !en.includes("Not translated"), "/llms.txt links the other language's index");
    assert(pt.startsWith(`# ${site.name}\n\n> A frase principal`) && pt.includes("[Sobre](https://example.com/pt/sobre.md)") && pt.includes("## Contacto"), "/pt/llms.txt uses the Portuguese pages and site.json overrides");
    assert(pt.includes(`## Sem tradução\n\n- [${other.title}](https://example.com${other.path}.md) (English)`) && pt.includes("## Línguas\n\n- [English](https://example.com/llms.txt) (en)"), "/pt/llms.txt lists untranslated pages in their own language, never a made-up translation");
    assert(["## Páginas", "## Sem tradução", "## Línguas", "## Ficheiros", "## Contacto"].every((t) => pt.includes(t)) && !/## (Pages|Files|Languages|Not translated)\b/.test(pt), "/pt/llms.txt has its generated section titles in Portuguese");
    assert(["## Pages", "## Languages", "## Files", "## Contact"].every((t) => en.includes(t)), "/llms.txt keeps its section titles in English");
    assert(readFileSync(join(bi, "about.md"), "utf8").includes("Also in: [Português](https://example.com/pt/sobre.md)") && existsSync(join(bi, "pt", "sobre.md")) && existsSync(join(bi, "pt", "llms-full.txt")), "page copies link their translations; each language has its full file");
    const biProfile = JSON.parse(readFileSync(join(bi, "profile.json"), "utf8"));
    const biAbout = biProfile.pages.find((p) => p.url === "https://example.com/about");
    assert(biProfile.languages.map((l) => `${l.language}:${l.llms}`).join(" ") === "en:https://example.com/llms.txt pt:https://example.com/pt/llms.txt" && biAbout.language === "en" && biAbout.alternates.pt.markdown === "https://example.com/pt/sobre.md" && biProfile.pages.length === 3, "profile.json lists the languages and every page with its translations");
    const biMap = JSON.parse(readFileSync(join(bi, "agent-ready", "markdown-map.json"), "utf8"));
    assert(biMap["/pt"] === "/pt/llms.txt" && biMap["/pt/agents"] === "/pt/llms.txt" && biMap["/pt/sobre"] === "/pt/sobre.md", "markdown-map.json covers each language's paths");
    const ptAgents = readFileSync(join(bi, "pt", "agents", "index.html"), "utf8");
    assert(ptAgents.includes('<html lang="pt">') && ptAgents.includes('href="/pt/"') && ptAgents.includes('rel="canonical" href="https://example.com/pt/agents"'), "/pt/agents is in Portuguese and links back to /pt/");

    // Section titles: a language without built-in titles falls back to English; a site can set its own.
    const titleSite = (extra) => sectionTitles({ ...biSite, ...extra });
    assert(titleSite({ language: "pt-BR" }).files === "Arquivos" && titleSite({ language: "pt-PT" }).files === "Ficheiros" && titleSite({ language: "ja" }).pages === "Pages", "section titles follow the language and region, with English as the fallback");
    writeFileSync(join(bi, "agent-ready", "site.json"), JSON.stringify({ ...biSite, i18n: { pt: { ...biSite.i18n.pt, sections: { pages: "Conteúdos", files: 42 } } } }));
    build(bi);
    const ptCustom = readFileSync(join(bi, "pt", "llms.txt"), "utf8");
    assert(ptCustom.includes("## Conteúdos") && ptCustom.includes("## Ficheiros"), "i18n sections set a language's own titles, and ignore values that aren't text");
    writeFileSync(join(bi, "agent-ready", "site.json"), JSON.stringify(biSite));
    build(bi);

    // Errors: a path two languages claim, and a language code that isn't one.
    writeFileSync(join(ptPages, "clash.md"), "---\npath: /about\ntitle: Clash\n---\n");
    let clash = "";
    try {
      build(bi);
    } catch (error) {
      clash = error.message;
    }
    assert(clash.includes('"/about" is used by both en and pt'), "two languages can't claim the same path");
    rmSync(join(ptPages, "clash.md"));
    writeFileSync(join(bi, "agent-ready", "site.json"), JSON.stringify({ ...biSite, languages: ["en", "portuguese!"] }));
    let badLang = "";
    try {
      build(bi);
    } catch (error) {
      badLang = error.message;
    }
    assert(badLang.includes('"portuguese!" is not a language code'), "an invalid language code is rejected");
    writeFileSync(join(bi, "agent-ready", "site.json"), JSON.stringify({ ...biSite, languages: ["pt", "en"] }));
    let notEnglish = "";
    try {
      build(bi);
    } catch (error) {
      notEnglish = error.message;
    }
    assert(notEnglish.includes('first of "languages" must be English'), "the default copies are in English: languages starts with en");
    writeFileSync(join(bi, "agent-ready", "site.json"), JSON.stringify(biSite));
    writeFileSync(join(ptPages, "clash.md"), "---\npath: /pt/outra\ntitle: Clash\nmarkdown: /pt/sobre\n---\n");
    let copyClash = "";
    try {
      build(bi);
    } catch (error) {
      copyClash = error.message;
    }
    assert(copyClash.includes("both write /pt/sobre.md"), "two pages in different files can't write the same copy");
    writeFileSync(join(ptPages, "clash.md"), "---\npath: /pt/outra\ntitle: Clash\nmarkdown: /pt/llms\n---\n");
    let reservedClash = "";
    try {
      build(bi);
    } catch (error) {
      reservedClash = error.message;
    }
    assert(reservedClash.includes("/pt/llms.md clashes with a generated file"), "a further language's copy can't overwrite its own generated files");
    rmSync(join(ptPages, "clash.md"));
    writeFileSync(join(bi, "agent-ready", "site.json"), JSON.stringify(biSite));
    build(bi);

    addPointers(bi, biSite);
    const biPort = port + 3;
    const biServer = spawn(process.execPath, [join(ROOT, "scripts", "serve-static.mjs"), bi, String(biPort)], { stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 400));
    try {
      const lines = [];
      const ok = await check(`http://localhost:${biPort}`, { log: (line) => lines.push(line), now: new Date("2026-02-15") });
      const fails = lines.filter((l) => l.startsWith("FAIL"));
      assert(ok && !fails.length, `check passes on the bilingual site${fails.length ? `: ${fails.join("; ")}` : ""}`);
      assert(["ok   /pt/llms.txt", "ok   /pt links /pt/llms.txt", "ok   /pt/agents renders", "ok   each llms.txt links every page copy in its language"].every((p) => lines.some((l) => l.startsWith(p))), "check covers each language's index, home and /agents");
      assert(lines.some((l) => l.startsWith("warn not translated (pt)") && l.includes(other.path)) && !lines.some((l) => l.includes("hreflang")) && !lines.some((l) => l.includes("mismatch")), "check names the untranslated page, and finds the hreflang links and languages in order");
      // A page whose <html lang> is wrong, and a translation not linked with hreflang.
      const ptAbout = join(bi, "pt", "sobre", "index.html");
      writeFileSync(ptAbout, readFileSync(ptAbout, "utf8").replace('<html lang="pt">', '<html lang="en">').replace(/<link[^>]*hreflang="en"[^>]*>\n/, ""));
      const lines2 = [];
      await check(`http://localhost:${biPort}`, { log: (line) => lines2.push(line), now: new Date("2026-02-15") });
      assert(lines2.some((l) => l.startsWith("warn mismatch: /pt/sobre language") && l.includes('lang="en"')) && lines2.some((l) => l.startsWith("warn /pt/sobre hreflang") && l.includes("en (/about.md)")), "check flags a wrong <html lang> and a missing hreflang link");
    } finally {
      biServer.kill();
    }
  } finally {
    rmSync(bi, { recursive: true, force: true });
  }

  // ---------- A site whose root is in another language: / and /sobre in Portuguese, /en and /en/about in English ----------
  const ptRoot = mkdtempSync(join(tmpdir(), "agent-ready-ptroot-"));
  try {
    mkdirSync(join(ptRoot, "agent-ready", "pages", "pt"), { recursive: true });
    const rootSite = {
      type: "organization", name: "Example Bikes", handle: "examplebikes", url: "https://example.com", outDir: ".",
      headline: "Bike shop in Sample Town.", home: "/en", languages: ["en", "pt"],
      contact: [{ label: "Email", value: "hello@example.com" }],
      i18n: { pt: { home: "/", headline: "Loja de bicicletas em Sample Town.", contactTitle: "Contacto" } },
    };
    const write = (file, text) => writeFileSync(join(ptRoot, "agent-ready", "pages", file), text);
    write("index.md", "---\npath: /en\ntitle: Home\n---\n\n## Shop\n\nCity and road bikes.\n");
    write("about.md", "---\npath: /en/about\nmarkdown: /about\ntitle: About\nsummary: Open since 2014.\n---\n\n## How we work\n\nA test ride first.\n");
    write("pt/index.md", "---\npath: /\ntitle: Início\n---\n\n## Loja\n\nBicicletas de cidade e de estrada.\n");
    write("pt/about.md", "---\npath: /sobre\ntitle: Sobre\nsummary: Abertos desde 2014.\n---\n\n## Como trabalhamos\n\nPrimeiro um passeio de teste.\n");
    writeFileSync(join(ptRoot, "agent-ready", "site.json"), JSON.stringify({ ...rootSite, i18n: { pt: { ...rootSite.i18n.pt, home: "/en" } } }));
    let sameHome = "";
    try {
      build(ptRoot);
    } catch (error) {
      sameHome = error.message;
    }
    assert(sameHome.includes("both have their home page at /en"), "two languages can't share a home page");
    writeFileSync(join(ptRoot, "agent-ready", "site.json"), JSON.stringify(rootSite));
    build(ptRoot);

    const enLlms = readFileSync(join(ptRoot, "llms.txt"), "utf8");
    const ptLlms = readFileSync(join(ptRoot, "pt", "llms.txt"), "utf8");
    assert(enLlms.includes("home page (https://example.com/en)") && enLlms.includes("City and road bikes.") && enLlms.includes("[About](https://example.com/about.md)"), "/llms.txt is the English home (/en) with English copy names");
    assert(ptLlms.includes("home page (https://example.com)") && ptLlms.includes("Bicicletas de cidade") && ptLlms.includes("[Sobre](https://example.com/sobre.md)"), "/pt/llms.txt is the Portuguese home at the site root");
    const rootMap = JSON.parse(readFileSync(join(ptRoot, "agent-ready", "markdown-map.json"), "utf8"));
    assert(rootMap["/"] === "/pt/llms.txt" && rootMap["/en"] === "/llms.txt" && rootMap["/sobre"] === "/sobre.md" && rootMap["/en/about"] === "/about.md" && rootMap["/pt/agents"] === "/pt/llms.txt", "markdown-map.json sends each home to its own language's index");
    const rootProfile = JSON.parse(readFileSync(join(ptRoot, "profile.json"), "utf8"));
    assert(rootProfile.languages.map((l) => `${l.language}:${l.home}`).join(" ") === "en:https://example.com/en pt:https://example.com/", "profile.json gives each language its real home");
    assert(readFileSync(join(ptRoot, "agents", "index.html"), "utf8").includes('<a href="/en/">Back to the site</a>') && readFileSync(join(ptRoot, "pt", "agents", "index.html"), "utf8").includes('<a href="/">'), "each /agents page links back to its own language's home");

    const html = (lang, title, body, footer) => `<!doctype html>\n<html lang="${lang}">\n<head>\n<meta charset="utf-8">\n<title>${title}</title>\n</head>\n<body>\n<main>\n${body}\n</main>\n<footer>\n<span>Example Bikes</span>\n<a href="mailto:hello@example.com">hello@example.com</a>\n</footer>\n</body>\n</html>\n`;
    for (const [path, lang, title, body] of [
      ["", "pt", "Example Bikes", `<h1>Example Bikes</h1>\n<p>${rootSite.i18n.pt.headline}</p>\n<h2>Loja</h2>\n<p>Bicicletas de cidade e de estrada.</p>`],
      ["sobre", "pt", "Sobre", "<h1>Sobre</h1>\n<p>Abertos desde 2014.</p>\n<h2>Como trabalhamos</h2>\n<p>Primeiro um passeio de teste.</p>"],
      ["en", "en", "Example Bikes", `<h1>Example Bikes</h1>\n<p>${rootSite.headline}</p>\n<h2>Shop</h2>\n<p>City and road bikes.</p>`],
      ["en/about", "en", "About", "<h1>About</h1>\n<p>Open since 2014.</p>\n<h2>How we work</h2>\n<p>A test ride first.</p>"],
    ]) {
      mkdirSync(join(ptRoot, path), { recursive: true });
      writeFileSync(join(ptRoot, path, "index.html"), html(lang, title, body));
    }
    addPointers(ptRoot, rootSite);
    assert(readFileSync(join(ptRoot, "index.html"), "utf8").includes('href="/pt/llms.txt"') && readFileSync(join(ptRoot, "sobre", "index.html"), "utf8").includes('href="/pt/agents/"') && readFileSync(join(ptRoot, "en", "about", "index.html"), "utf8").includes('href="/agents/"'), "pointers follow each page's language, not its URL");
    const rootPort = port + 4;
    const rootServer = spawn(process.execPath, [join(ROOT, "scripts", "serve-static.mjs"), ptRoot, String(rootPort)], { stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 400));
    try {
      const lines = [];
      const ok = await check(`http://localhost:${rootPort}`, { log: (line) => lines.push(line), now: new Date("2026-02-15") });
      const fails = lines.filter((l) => l.startsWith("FAIL"));
      assert(ok && !fails.length, `check passes on a site whose root is in Portuguese${fails.length ? `: ${fails.join("; ")}` : ""}`);
      assert(lines.some((l) => l.startsWith("ok   /en links /llms.txt")) && lines.some((l) => l.startsWith("ok   / links /pt/llms.txt")) && !lines.some((l) => l.includes("mismatch") || l.includes("hreflang")), "check reads the English home at /en and the Portuguese one at /");
    } finally {
      rootServer.kill();
    }
  } finally {
    rmSync(ptRoot, { recursive: true, force: true });
  }

  console.log("\nAll tests passed.");
} catch (error) {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
