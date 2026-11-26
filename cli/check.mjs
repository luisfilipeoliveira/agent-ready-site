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
  for (const page of pages) {
    const path = new URL(page.markdown).pathname;
    await markdownFile(path);
    const pagePath = new URL(page.url).pathname;
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
    const about = pages[0] && new URL(pages[0].url).pathname;
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

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
