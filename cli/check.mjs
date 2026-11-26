/**
 * Checks a running or deployed site against the agent-ready spec (skills/agent-ready-site/references/spec.md).
 * Fails on anything an agent needs; warns on what depends on the host (Accept negotiation on static hosts).
 */
const MARKDOWN_TYPES = /text\/(markdown|plain)/;

export async function check(base, { log = console.log } = {}) {
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
  for (const page of pages) {
    const path = local(page.markdown);
    await markdownFile(path);
    const pagePath = local(page.url);
    const { res, text } = await get(pagePath);
    if (res?.status !== 200) fail(pagePath, `status ${res?.status}`);
    else if (!new RegExp(`rel=["']alternate["'][^>]*type=["']text/markdown["'][^>]*href=["'][^"']*${escapeRe(path)}["']|type=["']text/markdown["'][^>]*href=["'][^"']*${escapeRe(path)}["'][^>]*rel=["']alternate["']|href=["'][^"']*${escapeRe(path)}["'][^>]*rel=["']alternate["']`, "i").test(text))
      fail(`${pagePath} alternate link`, `no <link rel="alternate" type="text/markdown" href="${path}">`);
    else pass(`${pagePath} links its Markdown copy`);
  }

  // Home page: alternate, hidden hint, footer link.
  {
    const { res, text } = await get("/");
    if (res?.status !== 200) fail("/", `status ${res?.status}`);
    else {
      if (/type=["']text\/markdown["']/i.test(text) && /llms\.txt/.test(text)) pass("/ links /llms.txt as its Markdown copy");
      else fail("/ alternate link", 'no <link rel="alternate" type="text/markdown" href="/llms.txt">');
      if (/AI (agents|assistants)\b[^<]*llms\.txt/i.test(text)) pass("/ has the hidden hint for agents");
      else warn("/ hint", "no hidden line pointing AI assistants to /llms.txt in <body>");
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
    const missing = pages.filter((page) => !llms.includes(page.markdown));
    if (missing.length) fail("/llms.txt index", `does not link ${missing.map((p) => p.markdown).join(", ")}`);
    else pass("/llms.txt links every page copy");
  }

  await checkCrawlers(base, { get, pass, warn });

  for (const r of results) {
    const mark = r.level === "pass" ? "ok  " : r.level === "warn" ? "warn" : "FAIL";
    log(`${mark} ${r.name}${r.why ? `: ${r.why}` : ""}`);
  }
  const count = (level) => results.filter((r) => r.level === level).length;
  const failed = count("fail");
  const warned = count("warn");
  log(`\n${count("pass")} passed, ${warned} warning${warned === 1 ? "" : "s"}, ${failed} failed.`);
  return failed === 0;
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

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
