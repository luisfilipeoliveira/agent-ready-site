/**
 * Checks a running or deployed site against the agent-ready spec (skills/agent-ready-site/references/spec.md).
 * Fails on anything an agent needs; warns on what depends on the host (Accept negotiation on static hosts).
 */
import { SECTION_TITLES } from "./generator.mjs";

const MARKDOWN_TYPES = /text\/(markdown|plain)/;

export async function check(base, { log = console.log, now = new Date() } = {}) {
  base = base.replace(/\/+$/, "");
  const results = [];
  const pass = (name) => results.push({ level: "pass", name });
  const fail = (name, why) => results.push({ level: "fail", name, why });
  const warn = (name, why) => results.push({ level: "warn", name, why });

  async function get(path, headers = {}) {
    try {
      const res = await fetch(base + path, { headers, redirect: "follow" });
      return { res, text: await res.text() };
    } catch (error) {
      return { res: null, text: "", error };
    }
  }

  async function markdownFile(path) {
    const { res, text, error } = await get(path);
    if (!res) return fail(path, `request failed (${error?.message})`);
    if (res.status !== 200) return fail(path, `status ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    if (!MARKDOWN_TYPES.test(type)) return fail(path, `content-type is "${type}", expected text/markdown or text/plain`);
    if (!text.trimStart().startsWith("#")) return fail(path, "does not start with a Markdown heading");
    pass(`${path} (${type.split(";")[0]})`);
    return text;
  }

  const llms = await markdownFile("/llms.txt");
  await markdownFile("/llm.md");
  await markdownFile("/llms-full.txt");

  let profile = null;
  {
    const { res, text } = await get("/profile.json");
    try {
      if (res?.status !== 200) throw new Error(`status ${res?.status}`);
      profile = JSON.parse(text);
      pass("/profile.json (valid JSON)");
    } catch (error) {
      fail("/profile.json", error.message);
    }
  }

  // Every page copy the profile lists, plus its HTML page's alternate link.
  const pages = profile?.pages ?? [];
  // Page URLs in profile.json are production URLs: take the part after the site URL, so the same check runs
  // against a local server, a preview or a sub-path deploy.
  const siteUrl = (profile?.url ?? "").replace(/\/+$/, "");
  const local = (url) => (siteUrl && url.startsWith(siteUrl) ? url.slice(siteUrl.length) || "/" : new URL(url).pathname);
  const copies = new Map(); // page -> { markdown, html }
  for (const page of pages) {
    const path = local(page.markdown);
    const markdown = await markdownFile(path);
    const pagePath = local(page.url);
    const { res, text } = await get(pagePath);
    if (res?.status === 200) copies.set(page, { path: pagePath, markdown, html: text });
    if (res?.status === 200 && page.language) checkPageLanguage(page, pagePath, text, { local, warn });
    if (res?.status !== 200) fail(pagePath, `status ${res?.status}`);
    else if (!new RegExp(`rel=["']alternate["'][^>]*type=["']text/markdown["'][^>]*href=["'][^"']*${escapeRe(path)}["']|type=["']text/markdown["'][^>]*href=["'][^"']*${escapeRe(path)}["'][^>]*rel=["']alternate["']|href=["'][^"']*${escapeRe(path)}["'][^>]*rel=["']alternate["']`, "i").test(text))
      fail(`${pagePath} alternate link`, `no <link rel="alternate" type="text/markdown" href="${path}">`);
    else pass(`${pagePath} links its Markdown copy`);
  }

  // Home page: alternate, hidden hint, footer link. On a multilingual site, the English home (usually /, or for
  // example /en on a site whose root is in another language).
  const languages = profile?.languages ?? [];
  const homePath = languages.length ? local(languages[0].home) : "/";
  let homeHtml = "";
  {
    const { res, text } = await get(homePath);
    if (res?.status === 200) homeHtml = text;
    if (res?.status !== 200) fail(homePath, `status ${res?.status}`);
    else {
      if (/type=["']text\/markdown["']/i.test(text) && /llms\.txt/.test(text)) pass(`${homePath} links /llms.txt as its Markdown copy`);
      else fail(`${homePath} alternate link`, 'no <link rel="alternate" type="text/markdown" href="/llms.txt">');
      if (/AI (agents|assistants)\b[^<]*llms\.txt/i.test(text)) pass(`${homePath} has the hidden hint for agents`);
      else warn(`${homePath} hint`, "no hidden line pointing AI assistants to /llms.txt in <body>");
      if (/Hey agent:?\s*(<!--.*?-->\s*)*<a[^>]+href=["'](\/agents|[^"']*\/agents\/?)["']/is.test(text)) pass("footer has the 'Hey agent' link to /agents");
      else fail("footer link", "no 'Hey agent: <handle>.md' link to /agents in the home page HTML");
    }
  }

  // /agents page.
  {
    const { res, text } = await get("/agents");
    if (res?.status === 200 && /<html/i.test(text) && /llms\.txt/.test(text)) pass("/agents renders");
    else fail("/agents", `status ${res?.status ?? "none"}${res?.status === 200 ? ", but it is not the agents page" : ""}`);
  }

  // Further languages: each has its own index, full file, home page and /agents.
  const llmsByLanguage = new Map(languages.length ? [[languages[0].language, llms]] : []);
  const languageHomes = [];
  for (const l of languages.slice(1)) {
    const llmsPath = local(l.llms);
    const prefix = llmsPath.replace(/\/llms\.txt$/, "");
    llmsByLanguage.set(l.language, await markdownFile(llmsPath));
    await markdownFile(`${prefix}/llms-full.txt`);
    const homePath = local(l.home);
    const { res, text } = await get(homePath);
    if (res?.status !== 200) fail(homePath, `status ${res?.status}`);
    else {
      languageHomes.push({ ...l, path: homePath, html: text, llmsPath, llms: llmsByLanguage.get(l.language) });
      if (new RegExp(`type=["']text/markdown["'][^>]*${escapeRe(llmsPath)}|${escapeRe(llmsPath)}["'][^>]*type=["']text/markdown["']`).test(text)) pass(`${homePath} links ${llmsPath} as its Markdown copy`);
      else fail(`${homePath} alternate link`, `no <link rel="alternate" type="text/markdown" href="${llmsPath}">`);
      if (/Hey agent:?\s*(<!--.*?-->\s*)*<a[^>]+href=["'][^"']*\/agents\/?["']/is.test(text)) pass(`${homePath} footer has the 'Hey agent' link`);
      else fail(`${homePath} footer link`, "no 'Hey agent: <handle>.md' link to /agents");
      checkPageLanguage({ language: l.language }, homePath, text, { local, warn });
    }
    const agents = await get(`${prefix}/agents`);
    if (agents.res?.status === 200 && /<html/i.test(agents.text) && agents.text.includes(llmsPath)) pass(`${prefix}/agents renders`);
    else fail(`${prefix}/agents`, `status ${agents.res?.status ?? "none"}${agents.res?.status === 200 ? ", but it is not the agents page" : ""}`);
  }

  // Pages missing in a language. Each is named once, in the first language that has it.
  const order = languages.map((l) => l.language);
  for (const lang of order) {
    const missing = pages.filter(
      (p) => p.language && p.language !== lang && !p.alternates?.[lang] && !Object.keys(p.alternates ?? {}).some((a) => order.indexOf(a) < order.indexOf(p.language)),
    );
    if (missing.length) warn(`not translated (${lang})`, `${missing.map((p) => local(p.url)).join(", ")} ${missing.length === 1 ? "has" : "have"} no ${lang} copy; ${lang} readers get the original (listed under "Not translated")`);
  }

  // Accept negotiation: needs a server or edge rule, so a static host may not have it.
  {
    const { res, text } = await get("/", { Accept: "text/markdown" });
    const type = res?.headers.get("content-type") ?? "";
    if (res?.status === 200 && MARKDOWN_TYPES.test(type) && text.trimStart().startsWith("#")) {
      if ((res.headers.get("vary") ?? "").toLowerCase().includes("accept")) pass("Accept: text/markdown on / returns Markdown, Vary: Accept");
      else warn("Accept negotiation", "Markdown returned without Vary: Accept (caches may mix the two)");
    } else warn("Accept negotiation", "Accept: text/markdown on / still returns HTML (fine on hosts without rewrites; see the recipe)");
    const about = pages[0] && local(pages[0].url);
    if (about) {
      const r = await get(about, { Accept: "text/markdown" });
      if (r.res?.status === 200 && r.text.trimStart().startsWith("#")) pass(`Accept: text/markdown on ${about} returns Markdown`);
      else warn("Accept negotiation", `${about} with Accept: text/markdown still returns HTML`);
    }
  }

  if (llms && pages.length) {
    // Each language's index links its own pages; a single-language site has only /llms.txt.
    const indexOf = (page) => (page.language && llmsByLanguage.has(page.language) ? llmsByLanguage.get(page.language) : llms);
    const missing = pages.filter((page) => indexOf(page) && !indexOf(page).includes(page.markdown));
    const names = languages.length > 1 ? "each llms.txt links every page copy in its language" : "/llms.txt links every page copy";
    if (missing.length) fail("llms.txt index", `does not link ${missing.map((p) => p.markdown).join(", ")}`);
    else pass(names);
  }

  if (profile) checkConsistency({ profile, llms, homeHtml, copies, languageHomes, now }, { pass, warn });
  await checkCrawlers(base, { get, pass, warn });

  for (const r of results) {
    const mark = r.level === "pass" ? "ok  " : r.level === "warn" ? "warn" : "FAIL";
    log(`${mark} ${r.name}${r.why ? `: ${r.why}` : ""}`);
  }
  const count = (level) => results.filter((r) => r.level === level).length;
  const failed = count("fail");
  const warned = count("warn");
  const mismatches = results.filter((r) => r.level === "warn" && r.name.startsWith("mismatch")).length;
  log(`\n${count("pass")} passed, ${warned} warning${warned === 1 ? "" : "s"}${mismatches ? ` (${mismatches} where the files and the site disagree)` : ""}, ${failed} failed.`);
  return failed === 0;
}

// ---------- consistency ----------

/** Visible text of an HTML page: no scripts, styles or tags, entities decoded, whitespace collapsed. */
export function htmlText(html) {
  return normalise(
    decodeEntities(
      html
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

function decodeEntities(text) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: "-", mdash: "-", hellip: "..." };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return named[code.toLowerCase()] ?? whole;
  });
}

/** Lower case, typographic quotes and dashes made plain, one space between words: small layout differences don't count. */
const normalise = (text) =>
  text
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201c\u201d\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Markdown inline text as a visitor reads it: links become their label, emphasis and code marks go. */
const markdownText = (text) => normalise(text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, ""));

/**
 * `##` and `###` headings of a Markdown file, up to (not including) the sections the generator adds: a known
 * title, or a `##` section that links the agent files (a title the site set in "sections").
 */
function headings(markdown, { stopAt = [] } = {}) {
  const out = [];
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{2,3}) (.+)$/.exec(lines[i]);
    if (!m) continue;
    if (stopAt.includes(m[2].trim())) break;
    if (m[1] === "##" && stopAt.length) {
      const next = lines.slice(i + 1).findIndex((l) => /^## /.test(l));
      const body = lines.slice(i + 1, next < 0 ? undefined : i + 1 + next).join("\n");
      if (/\]\([^)\s]*(\/llms\.txt|\/profile\.json|\.md)\)/.test(body)) break;
    }
    out.push(m[2].trim());
  }
  return out;
}

/** The meta description of an HTML page, normalised, or "". */
const metaDescription = (html) => {
  const tag = /<meta\b[^>]*name=["']description["'][^>]*>/i.exec(html)?.[0] ?? "";
  return normalise(decodeEntities(/content=["']([^"']*)["']/i.exec(tag)?.[1] ?? ""));
};

/**
 * A copy without the contact section the generator adds at its end. That section's title is the site's own
 * (contactTitle, per language), so it is found by its content: the last `##` section, listing a contact value.
 */
function withoutContact(markdown, contact = {}) {
  const at = markdown.lastIndexOf("\n## ");
  const values = Object.values(contact).map(String).filter(Boolean);
  if (at < 0 || !values.length) return markdown;
  const tail = markdown.slice(at);
  return values.some((v) => tail.includes(`: ${v}`)) ? markdown.slice(0, at) : markdown;
}

const STALE_DAYS = 180;
// The sections the generator adds to llms.txt after the home page's own text.
// In every language the generator knows, so the home page's own headings end where its sections begin.
const GENERATED_SECTIONS = [...new Set(Object.values(SECTION_TITLES).flatMap((t) => Object.values(t)))];

/**
 * Where the agent files and the live HTML disagree: words the copies carry that the site doesn't show, or
 * details the site shows differently. Exact comparisons only, so a warning always names what to look at; a
 * copy that says the same thing in other words is not caught. All of these warn, never fail.
 */
export function checkConsistency({ profile, llms, homeHtml, copies, languageHomes = [], now = new Date() }, { pass, warn }) {
  const homeText = htmlText(homeHtml);
  const allText = [homeText, ...[...copies.values()].map((c) => htmlText(c.html))].join(" ");
  const allHtml = [homeHtml, ...[...copies.values()].map((c) => c.html)].join(" ");
  const mismatch = (name, why) => warn(`mismatch: ${name}`, why);
  let found = 0;
  const flag = (name, why) => (found++, mismatch(name, why));

  // A client-rendered page has (almost) no text in its HTML: comparing would only produce noise.
  if (homeText.length < 80) {
    warn("consistency", "the home page HTML has almost no text (rendered in the browser?), so the copies can't be compared with it");
    return;
  }

  if (profile.name && !homeText.includes(normalise(profile.name))) flag("name", `"${profile.name}" (profile.json) is not on the home page`);
  if (profile.headline && !homeText.includes(markdownText(profile.headline))) flag("headline", `"${profile.headline}" (profile.json) is not on the home page; it should be its main line, verbatim`);

  // Contact: only details the site already shows publicly (writing.md, Privacy).
  for (const [label, value] of Object.entries(profile.contact ?? {})) {
    const v = String(value).trim();
    const bare = v.replace(/^mailto:|^tel:/i, "").replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "");
    if (!allText.includes(normalise(bare)) && !decodeEntities(allHtml).toLowerCase().includes(bare.toLowerCase()))
      flag(`contact ${label}`, `"${v}" is not shown on any page checked; list only contact details the site shows publicly`);
  }

  // Each copy: its title, summary and headings must be on the HTML page it copies.
  for (const [page, copy] of copies) {
    const text = htmlText(copy.html);
    if (text.length < 40) continue;
    const missing = [];
    if (page.title && !text.includes(markdownText(page.title))) missing.push(`title "${page.title}"`);
    if (page.summary && !text.includes(markdownText(page.summary)) && !metaDescription(copy.html).includes(markdownText(page.summary)))
      missing.push(`summary "${page.summary}"`);
    for (const h of headings(withoutContact(copy.markdown ?? "", profile.contact), { stopAt: ["Contact"] })) if (!text.includes(markdownText(h))) missing.push(`heading "${h}"`);
    if (missing.length) flag(copy.path, `the Markdown copy has ${missing.join(", ")}, not on the page`);
  }

  // The home page's own text in llms.txt, which ends where the generated sections start (page sections included).
  const stopAt = [...GENERATED_SECTIONS, ...new Set((profile.pages ?? []).map((p) => p.section).filter(Boolean))];
  if (llms) {
    const missing = headings(withoutContact(llms, profile.contact), { stopAt }).filter((h) => !homeText.includes(markdownText(h)));
    if (missing.length) flag("/llms.txt", `has heading${missing.length === 1 ? "" : "s"} ${missing.map((h) => `"${h}"`).join(", ")}, not on the home page`);
  }

  // Each further language: its headline and its index's headings on its own home page.
  for (const l of languageHomes) {
    const text = htmlText(l.html);
    if (text.length < 80) continue;
    if (l.headline && !text.includes(markdownText(l.headline))) flag(`${l.path} headline`, `"${l.headline}" (${l.language}) is not on ${l.path}`);
    const missing = l.llms ? headings(withoutContact(l.llms, profile.contact), { stopAt }).filter((h) => !text.includes(markdownText(h))) : [];
    if (missing.length) flag(l.llmsPath, `has heading${missing.length === 1 ? "" : "s"} ${missing.map((h) => `"${h}"`).join(", ")}, not on ${l.path}`);
  }

  // The updated date: an old one suggests the copies no longer follow the site.
  if (profile.updated) {
    const days = Math.floor((now - new Date(profile.updated)) / 86400000);
    if (Number.isNaN(days)) flag("updated", `"${profile.updated}" is not a date (use YYYY-MM-DD)`);
    else if (days < -1) flag("updated", `${profile.updated} is in the future`);
    else if (days > STALE_DAYS) flag("updated", `${profile.updated} is ${days} days ago; check the copies still match the site, then update it`);
  }

  if (!found) pass("the copies, profile.json and the live pages agree (name, headline, contact, titles, summaries, headings, JSON-LD)");
}

// ---------- AI crawlers ----------

/**
 * The AI crawlers and fetchers sites most often allow or block. `ua` is the User-Agent they send; tokens with no
 * `ua` (Google-Extended, Applebot-Extended) only exist in robots.txt and never fetch anything themselves.
 */
export const AI_CRAWLERS = [
  { token: "GPTBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)" },
  { token: "OAI-SearchBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)" },
  { token: "ChatGPT-User", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot" },
  { token: "ClaudeBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)" },
  { token: "Claude-SearchBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +https://www.anthropic.com)" },
  { token: "Claude-User", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +https://www.anthropic.com)" },
  { token: "PerplexityBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)" },
  { token: "Perplexity-User", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)" },
  { token: "CCBot", ua: "CCBot/2.0 (https://commoncrawl.org/faq/)" },
  { token: "Google-Extended" },
  { token: "Applebot-Extended" },
];

/** robots.txt as groups of { agents, rules }, following RFC 9309 (consecutive user-agent lines share one group). */
export function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const kv = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const value = kv[2].trim();
    if (key === "user-agent") {
      if (!lastWasAgent) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (current && (key === "allow" || key === "disallow")) current.rules.push({ allow: key === "allow", path: value });
    }
  }
  return groups;
}

/** Whether `token` may fetch `path`: its own group (or `*`), longest matching rule wins, allow wins ties. */
export function robotsAllows(groups, token, path) {
  const name = token.toLowerCase();
  const own = groups.filter((g) => g.agents.includes(name));
  const rules = (own.length ? own : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules);
  let best = null;
  for (const rule of rules) {
    if (!rule.path) continue; // "Disallow:" with no path allows everything
    if (!robotsPathRe(rule.path).test(path)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
  }
  return !best || best.allow;
}

const robotsPathRe = (pattern) => {
  const end = pattern.endsWith("$");
  const body = (end ? pattern.slice(0, -1) : pattern).split("*").map(escapeRe).join(".*");
  return new RegExp(`^${body}${end ? "$" : ""}`);
};

/**
 * robots.txt rules and User-Agent blocks for AI crawlers. Both are the owner's choice, so they only warn: the
 * point is that a site made readable for agents is not also turning them away without knowing it.
 */
async function checkCrawlers(base, { get, pass, warn }) {
  const { origin, pathname } = new URL(base + "/");
  const prefix = pathname.replace(/\/+$/, "");
  const llmsPath = `${prefix}/llms.txt`;

  // robots.txt lives at the origin's root, even for a site under a sub-path.
  const robots = await fetch(`${origin}/robots.txt`, { redirect: "follow" }).then(
    async (res) => ({ status: res.status, text: await res.text() }),
    () => null,
  );
  if (!robots || robots.status !== 200) pass("robots.txt: none found, so no AI crawler is blocked");
  else {
    const groups = parseRobots(robots.text);
    const blocked = AI_CRAWLERS.filter((c) => !robotsAllows(groups, c.token, llmsPath)).map((c) => c.token);
    if (blocked.length) warn("robots.txt", `blocks ${blocked.join(", ")} from ${llmsPath} (fine if intended; those agents won't read the Markdown)`);
    else pass(`robots.txt lets the ${AI_CRAWLERS.length} AI crawlers checked read ${llmsPath}`);
  }

  // Firewall or bot-protection rules that match the User-Agent. Rules that verify the crawler's IP (Cloudflare's
  // "Block AI bots", for example) can't be reproduced from here, so a pass only covers User-Agent rules.
  const baseline = await get("/llms.txt");
  if (baseline.res?.status !== 200) return; // already reported above
  const refused = [];
  for (const crawler of AI_CRAWLERS.filter((c) => c.ua)) {
    const { res, text } = await get("/llms.txt", { "User-Agent": crawler.ua });
    const type = res?.headers.get("content-type") ?? "";
    if (!res) refused.push(`${crawler.token} (no response)`);
    else if (res.status !== 200) refused.push(`${crawler.token} (${res.status})`);
    else if (!MARKDOWN_TYPES.test(type) || !text.trimStart().startsWith("#")) refused.push(`${crawler.token} (gets ${type.split(";")[0] || "no content-type"}, not the Markdown)`);
  }
  if (refused.length) warn("AI crawler User-Agents", `/llms.txt is refused to ${refused.join(", ")}; check the host's firewall or bot protection`);
  else pass(`/llms.txt answers the ${AI_CRAWLERS.filter((c) => c.ua).length} AI crawler User-Agents (IP-verified blocks can't be tested from here)`);
}

/**
 * A page in a multilingual site: its <html lang> is the copy's language, and its head links each translation's
 * copy with hreflang, so an agent on one language finds the others.
 */
function checkPageLanguage(page, pagePath, html, { local, warn }) {
  const declared = /<html\b[^>]*\blang=["']([^"']+)["']/i.exec(html)?.[1];
  const primary = (code) => String(code).toLowerCase().split("-")[0];
  if (declared && primary(declared) !== primary(page.language))
    warn(`mismatch: ${pagePath} language`, `<html lang="${declared}">, but its copy is ${page.language}`);
  const missing = Object.entries(page.alternates ?? {}).filter(([lang, alt]) => {
    const href = escapeRe(local(alt.markdown));
    const lang_ = escapeRe(lang);
    return !new RegExp(`<link\\b(?=[^>]*hreflang=["']${lang_}["'])(?=[^>]*href=["'][^"']*${href}["'])[^>]*>`, "i").test(html);
  });
  if (missing.length)
    warn(`${pagePath} hreflang`, `no <link rel="alternate" type="text/markdown" hreflang="…"> for ${missing.map(([lang, alt]) => `${lang} (${local(alt.markdown)})`).join(", ")}`);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
