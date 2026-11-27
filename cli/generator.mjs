#!/usr/bin/env node
/**
 * agent-ready-site generator. Self-contained (Node 18+, no dependencies): `init` copies this file into the
 * site as agent-ready/build.mjs and wires it to the site's dev/build scripts.
 *
 * Reads:   agent-ready/site.json        the site's name, handle, URL, contact, /agents copy
 *          agent-ready/pages/*.md       one Markdown copy per public page, in English (frontmatter: path, title, summary,
 *                                       order, and markdown when the page's URL is not in English)
 *          agent-ready/pages/<lang>/*.md  the same for each further language in site.json "languages", in that
 *                                       language's own words; a page and its translation share a file name
 *          collections                  a JSON data file + a Markdown template: one copy per item (products, posts…)
 * Writes (into site.json "outDir", default "public"):
 *          llms.txt, llm.md             index in llmstxt.org format: home text, then a link to each copy
 *          llms-full.txt                everything in one file
 *          profile.json                 the site's public details as structured data
 *          <page path>.md               one copy per page (/about -> about.md, /work/x -> work/x.md;
 *                                       /sobre with markdown: /about -> about.md)
 *          agents/index.html            the /agents page: the files as a terminal session in an editor window
 *          <prefix>/llms.txt, …         for each further language: its own index, full file and /agents page
 *                                       (each language's home is its prefix, or site.json "home" / i18n.<lang>.home)
 *          and agent-ready/markdown-map.json  page path -> Markdown copy, for Accept: text/markdown rewrites
 *          and agent-ready/sync-lock.json     what each page's copy and "source" files looked like at the last
 *                                       build, so a copy whose source changed is reported (commit it)
 *
 * `--accept` records the current sources as in step with their copies (after a change that didn't touch the text).
 *
 * Every word comes from site.json and the page files, which hold only what the site itself says.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
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

/**
 * A page's `source`: the repository files its words come from, relative to the site's root. One path, or
 * several separated by commas, optionally in brackets: `app/about/page.tsx` or `[app/about/page.tsx, lib/about.ts]`.
 */
export function parseSource(value, where) {
  if (value == null || value === "") return [];
  const text = String(value).trim().replace(/^\[|\]$/g, "");
  // Split on commas outside quotes: "a, b.html" (quoted) is one path.
  const list = [...text.matchAll(/\s*(?:"([^"]*)"|'([^']*)'|([^,]+))\s*(?:,|$)/g)].map((m) => (m[1] ?? m[2] ?? m[3] ?? "").trim()).filter(Boolean);
  for (const path of list)
    if (path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.split(/[\\/]/).includes(".."))
      throw new Error(`${where}: source "${path}" must be a path inside the site's folder, like app/about/page.tsx`);
  return list.map((p) => p.replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/{2,}/g, "/").replace(/\/\.\//g, "/"));
}

const LANGUAGE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

function readPages(dir, label) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => {
      const { data, body } = parseFrontmatter(sameLines(readFileSync(join(dir, file), "utf8")));
      if (!data.path || !data.title) throw new Error(`${label}/${file} needs "path" and "title" in its frontmatter.`);
      const path = data.path === "/" ? "/" : "/" + String(data.path).replace(/^\/+|\/+$/g, "");
      // The path becomes a file name: plain URL characters only, no "." or ".." segments.
      if (!/^\/[A-Za-z0-9._~\-/]*$/.test(path) || path.split("/").some((seg) => seg === "." || seg === ".."))
        throw new Error(`${label}/${file}: path "${data.path}" must be a plain site path like /about or /work/case`);
      // The English path of the copy, for a page whose URL is in another language (/sobre -> /about.md).
      const markdown = data.markdown ? "/" + String(data.markdown).replace(/^\/+|\/+$|\.md$/g, "") : path;
      if (data.markdown && (!/^\/[A-Za-z0-9._~\-/]+$/.test(markdown) || markdown.split("/").some((seg) => seg === "." || seg === "..")))
        throw new Error(`${label}/${file}: markdown "${data.markdown}" must be a plain site path like /about or /work/case`);
      const source = parseSource(data.source, `${label}/${file}`);
      return { file, label, path, markdown, title: data.title, summary: data.summary ?? "", section: data.section ?? "", order: data.order ?? 100, full: true, body, source };
    })
    .sort((a, b) => a.order - b.order || a.path.localeCompare(b.path));
}

// ---------- collections: one page per item of a data file, through a Markdown template ----------

const PLACEHOLDER = /\{\{\s*(?:(list|join)\s+)?([A-Za-z0-9_$-]+(?:\.[A-Za-z0-9_$-]+)*)\s*\}\}/g;

function lookup(item, key) {
  return key.split(".").reduce((value, part) => (value == null ? undefined : value[part]), item);
}

function renderValue(value, helper) {
  if (value == null || value === "") return "";
  if (Array.isArray(value)) {
    const items = value.filter((v) => v != null && v !== "" && typeof v !== "object").map(String);
    return helper === "list" ? items.map((v) => `- ${v}`).join("\n") : items.join(", ");
  }
  if (typeof value === "object") return "";
  return String(value);
}

/**
 * Fills `{{key}}`, `{{nested.key}}`, `{{join key}}` (an array as "a, b, c") and `{{list key}}` (an array as a
 * "- " list). A line whose placeholders all come out empty is dropped, so optional fields leave no "Price: ".
 */
export function renderTemplate(template, item) {
  const lines = template.split("\n").flatMap((line) => {
    let placeholders = 0;
    let filled = 0;
    const out = line.replace(PLACEHOLDER, (_, helper, key) => {
      placeholders++;
      const value = renderValue(lookup(item, key), helper);
      if (value) filled++;
      return value;
    });
    return placeholders && !filled ? [] : [out];
  });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** One-line fields (path, title, summary, markdown, id): no line dropping. With `strict`, an empty placeholder is an error. */
function fillLine(template, item, strict) {
  return String(template).replace(PLACEHOLDER, (whole, helper, key) => {
    const value = renderValue(lookup(item, key), helper);
    if (!value && strict) throw new Error(`${whole} is empty`);
    return value;
  });
}

const plainPath = (path) => /^\/[A-Za-z0-9._~\-/]*$/.test(path) && path !== "/." && !path.split("/").some((seg) => seg === "." || seg === "..");

/** A collection's pages: one per item of its JSON source, each body filled from its template. */
function loadCollection(root, collection, index, where) {
  where = `${where}[${index}]${collection?.name ? ` ("${collection.name}")` : ""}`;
  for (const key of ["name", "source", "path", "title", "template"])
    if (!collection?.[key]) throw new Error(`${where} needs "${key}".`);
  const inside = (file, label) => {
    const target = resolve(root, file);
    if (!target.startsWith(root + sep)) throw new Error(`${where}: ${label} "${file}" must be inside the site's folder.`);
    if (!existsSync(target)) throw new Error(`${where}: ${label} "${file}" does not exist.`);
    return target;
  };
  const data = JSON.parse(readFileSync(inside(collection.source, "source"), "utf8"));
  const items = Array.isArray(data) ? data : data?.items;
  if (!Array.isArray(items)) throw new Error(`${where}: source must be a JSON array, or an object with an "items" array.`);
  const template = sameLines(readFileSync(inside(collection.template, "template"), "utf8")).trim();
  const order = collection.order ?? 100;
  const clean = (raw) => (raw === "/" ? "/" : "/" + String(raw).replace(/^\/+|\/+$/g, ""));
  return items.map((item, i) => {
    let path, markdown, title, id;
    try {
      path = clean(fillLine(collection.path, item, true));
      markdown = collection.markdown ? clean(fillLine(collection.markdown, item, true)).replace(/\.md$/, "") : path;
      title = fillLine(collection.title, item, true).trim();
      id = collection.id ? fillLine(collection.id, item, true) : String(i);
    } catch (error) {
      throw new Error(`${where} item ${i}: ${error.message} (path, markdown, title and id need every field they use).`);
    }
    if (!plainPath(path)) throw new Error(`${where} item ${i}: path "${path}" must be a plain site path like /about or /work/case`);
    if (!plainPath(markdown) || (collection.markdown && markdown === "/")) throw new Error(`${where} item ${i}: markdown "${markdown}" must be a plain site path like /products/x`);
    return {
      // A page and its translation share a file name; for a collection item, that is the collection and its id.
      file: `${collection.name}:${id}`,
      label: where,
      collection: collection.name,
      path,
      markdown,
      title,
      summary: collection.summary ? fillLine(collection.summary, item, false).trim() : "",
      section: collection.section ?? collection.name,
      order: order + i / (items.length + 1),
      full: collection.full !== false,
      body: renderTemplate(template, item),
    };
  });
}

/** A language's name in that language ("Português"), unless site.i18n[lang].languageName says otherwise. */
function languageName(lang, override) {
  if (override) return override;
  try {
    const name = new Intl.DisplayNames([lang], { type: "language" }).of(lang) ?? lang;
    return name.charAt(0).toLocaleUpperCase(lang) + name.slice(1);
  } catch {
    return lang;
  }
}

/**
 * The site's content, one entry per language. The first language is the default: its pages are in
 * agent-ready/pages/ and its files at the site root. Each further language has its pages in
 * agent-ready/pages/<lang>/ and its files under a prefix (/<lang> unless site.i18n[lang].prefix says otherwise),
 * with site.json values overridden by site.i18n[lang]. The returned object is the default language's content,
 * with `languages` holding all of them; a site.json without "languages" has one.
 */
export function loadContent(root) {
  root = resolve(root);
  const dir = join(root, "agent-ready");
  const sitePath = join(dir, "site.json");
  if (!existsSync(sitePath)) throw new Error(`Missing ${relative(process.cwd(), sitePath)}. Run \`agent-ready-site init\` first.`);
  const site = JSON.parse(readFileSync(sitePath, "utf8"));
  for (const key of ["name", "handle", "url", "headline"]) {
    if (!site[key]) throw new Error(`agent-ready/site.json needs "${key}".`);
  }
  // "type" (person or organization) is no longer used: an older site.json may still have it.
  delete site.type;
  site.url = site.url.replace(/\/+$/, "");

  const multi = Array.isArray(site.languages) && site.languages.length > 0;
  const codes = multi ? site.languages : [site.language ?? "en"];
  for (const code of codes) if (typeof code !== "string" || !LANGUAGE.test(code)) throw new Error(`agent-ready/site.json: "${code}" is not a language code like "en" or "pt-PT".`);
  if (new Set(codes.map((c) => c.toLowerCase())).size !== codes.length) throw new Error(`agent-ready/site.json: "languages" lists a language twice.`);
  // The default copies are always in English (translated if the site isn't); further languages keep their own words.
  if (multi && !/^en(-|$)/i.test(codes[0])) throw new Error(`agent-ready/site.json: the first of "languages" must be English ("en"), not "${codes[0]}". The default copies are in English; list the site's other languages after it.`);
  site.language = codes[0];

  const pagesDir = join(dir, "pages");
  const languages = codes.map((lang, i) => {
    const isDefault = i === 0;
    const own = isDefault ? {} : site.i18n?.[lang] ?? {};
    const prefix = isDefault ? "" : "/" + String(own.prefix ?? lang.toLowerCase()).replace(/^\/+|\/+$/g, "");
    if (!isDefault && !/^\/[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*$/.test(prefix))
      throw new Error(`agent-ready/site.json: the prefix for "${lang}" must be a plain path like /pt.`);
    // Collections: the top-level ones are English (the default copies); each further language lists its own in
    // i18n.<lang>.collections, from data in that language. They are never inherited from another language.
    const collections = (isDefault ? site.collections : own.collections) ?? [];
    if (!Array.isArray(collections)) throw new Error(`agent-ready/site.json: ${isDefault ? "" : `i18n.${lang}.`}collections must be a list.`);
    const collected = collections.flatMap((c, n) => loadCollection(root, c, n, `agent-ready/site.json ${isDefault ? "" : `i18n.${lang}.`}collections`));
    const all = [...readPages(isDefault ? pagesDir : join(pagesDir, lang), isDefault ? "agent-ready/pages" : `agent-ready/pages/${lang}`), ...collected].sort(
      (a, b) => a.order - b.order || a.path.localeCompare(b.path),
    );
    // The language's home page URL. By default the site root for English and the prefix for the others; a site
    // whose root is in another language sets "home" (English, e.g. /en) and i18n.<lang>.home (e.g. /).
    const ownHome = isDefault ? site.home : own.home;
    const homePath = ownHome == null ? prefix || "/" : "/" + String(ownHome).replace(/^\/+|\/+$/g, "");
    if (!/^\/[A-Za-z0-9._~\-/]*$/.test(homePath) || homePath.split("/").some((seg) => seg === "." || seg === ".."))
      throw new Error(`agent-ready/site.json: the home for "${lang}" must be a plain site path like / or /en, not "${ownHome}".`);
    if (collected.some((page) => page.path === homePath)) throw new Error(`A collection can't produce the home page (${homePath}).`);
    const home = all.find((page) => page.path === homePath);
    for (const page of all) page.language = lang;
    const { i18n, languages: _, prefix: __, languageName: name, home: ___, ...rest } = { ...site, ...own };
    return { site: { ...rest, collections, language: lang }, lang, name: languageName(lang, name), prefix, homePath, isDefault, home, pages: all.filter((page) => page !== home) };
  });

  // One home per language: two languages can't share one.
  for (const l of languages) {
    const other = languages.find((o) => o !== l && o.homePath === l.homePath);
    if (other) throw new Error(`agent-ready/site.json: ${l.lang} and ${other.lang} both have their home page at ${l.homePath}. Set "home" (English) or i18n.<lang>.home so each language has its own.`);
  }

  // One URL, one copy: two languages can't claim the same path.
  const seen = new Map();
  for (const l of languages)
    for (const page of [l.home, ...l.pages].filter(Boolean)) {
      const before = seen.get(page.path);
      if (before?.lang === l.lang) throw new Error(`Two pages have the path ${page.path}: ${before.who} and ${page.label}/${page.file}.`);
      if (before) throw new Error(`agent-ready/pages: "${page.path}" is used by both ${before.lang} and ${l.lang}.`);
      seen.set(page.path, { lang: l.lang, who: `${page.label}/${page.file}` });
    }

  // One copy, one page: no two pages write the same .md, and none overwrites a generated file.
  const copies = new Map();
  for (const l of languages) {
    const reserved = new Set([`${l.prefix}/llms`, `${l.prefix}/llm`, `${l.prefix}/agents`]);
    for (const page of l.pages) {
      if (reserved.has(page.markdown)) throw new Error(`${page.label}/${page.file}: the copy ${page.markdown}.md clashes with a generated file. Set another "markdown" path.`);
      if (copies.has(page.markdown))
        throw new Error(`${page.label}/${page.file} and ${copies.get(page.markdown)} both write ${page.markdown}.md. Give one of them another "markdown" path.`);
      copies.set(page.markdown, `${page.label}/${page.file}`);
    }
  }

  // Translations share a file name. Each page learns its translations; each language, what it lacks.
  for (const l of languages) {
    l.multi = multi;
    l.languages = languages;
    for (const page of l.pages)
      page.alternates = languages.filter((o) => o !== l).map((o) => ({ lang: o.lang, name: o.name, page: o.pages.find((p) => p.file === page.file) })).filter((a) => a.page);
    l.untranslated = [];
    for (const o of languages) {
      if (o === l) continue;
      for (const page of o.pages)
        if (!l.pages.some((p) => p.file === page.file) && !l.untranslated.some((u) => u.page.file === page.file)) l.untranslated.push({ lang: o.lang, name: o.name, page });
    }
  }
  return { ...languages[0], languages };
}

// ---------- Markdown ----------

/**
 * Titles of the sections the generator adds, in the site's language. A language not listed here gets English;
 * any title can be set in site.json "sections" (or i18n.<lang>.sections): { pages, notTranslated, languages, files }.
 * The contact section's title is site.json "contactTitle", and these are only its default.
 */
export const SECTION_TITLES = {
  en: { pages: "Pages", notTranslated: "Not translated", languages: "Languages", files: "Files", contact: "Contact" },
  pt: { pages: "Páginas", notTranslated: "Sem tradução", languages: "Línguas", files: "Ficheiros", contact: "Contacto" },
  "pt-br": { pages: "Páginas", notTranslated: "Sem tradução", languages: "Idiomas", files: "Arquivos", contact: "Contato" },
  es: { pages: "Páginas", notTranslated: "Sin traducir", languages: "Idiomas", files: "Archivos", contact: "Contacto" },
  fr: { pages: "Pages", notTranslated: "Non traduit", languages: "Langues", files: "Fichiers", contact: "Contact" },
  de: { pages: "Seiten", notTranslated: "Nicht übersetzt", languages: "Sprachen", files: "Dateien", contact: "Kontakt" },
  it: { pages: "Pagine", notTranslated: "Non tradotto", languages: "Lingue", files: "File", contact: "Contatti" },
  nl: { pages: "Pagina's", notTranslated: "Niet vertaald", languages: "Talen", files: "Bestanden", contact: "Contact" },
};

/** The section titles for a site (already merged with its language's i18n values). */
export function sectionTitles(site) {
  const code = String(site.language ?? "en").toLowerCase();
  const base = SECTION_TITLES[code] ?? SECTION_TITLES[code.split("-")[0]] ?? SECTION_TITLES.en;
  const own = site.sections && typeof site.sections === "object" ? site.sections : {};
  const out = { ...base };
  for (const key of Object.keys(base)) if (typeof own[key] === "string" && own[key].trim()) out[key] = own[key].trim();
  return out;
}

const list = (items) => items.map((item) => `- ${item}`).join("\n");
const section = (title, ...body) => [`## ${title}`, ...body.filter(Boolean)].join("\n\n");
const doc = (...parts) => parts.filter((part) => part).join("\n\n") + "\n";
const mdPath = (page) => `${page.markdown ?? page.path}.md`;

/**
 * Pages grouped into llms.txt sections (`## Products`, `## Policies`, …). Pages without a section go under the
 * Pages title (sections.pages). Sections follow `site.sectionOrder` first, then the order of their first page.
 */
export function pageSections({ site, pages }) {
  const fallback = sectionTitles(site).pages;
  const groups = new Map((Array.isArray(site.sectionOrder) ? site.sectionOrder : []).map((name) => [name, []]));
  for (const page of pages) {
    const name = page.section || fallback;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(page);
  }
  return [...groups].filter(([, list]) => list.length).map(([title, list]) => ({ title, pages: list }));
}

/** A collection's copies as one entry ("/products/*.md"), so a catalogue of hundreds doesn't flood the file list. */
function collectionEntries(site, pages) {
  return (site.collections ?? []).flatMap((collection) => {
    const items = pages.filter((page) => page.collection === collection.name);
    if (!items.length) return [];
    const glob = String(collection.markdown ?? collection.path).replace(PLACEHOLDER, "*").replace(/\.md$/, "").replace(/\/+$/, "");
    const label = collection.section ?? collection.name;
    return [{ path: `${glob.startsWith("/") ? "" : "/"}${glob}.md`, description: `Markdown copy of each of the ${items.length} ${label} pages.`, glob: true }];
  });
}

export function agentFiles({ site, pages, prefix = "" }) {
  const anyLeftOut = pages.some((page) => page.full === false);
  return [
    { path: `${prefix}/llms.txt`, description: "The entry point: the home page, a link to each page copy, and contact details." },
    { path: `${prefix}/llm.md`, description: `An alias of ${prefix}/llms.txt for tools that look for this name.` },
    { path: `${prefix}/llms-full.txt`, description: anyLeftOut ? "The index and the main page copies, joined into a single file." : "The index and every page copy, joined into a single file." },
    { path: "/profile.json", description: "Name, headline, pages and contact as JSON." },
    ...pages.filter((page) => !page.collection).map((page) => ({ path: mdPath(page), description: `Markdown copy of the ${page.title} page.` })),
    ...collectionEntries(site, pages),
    ...(site.extraFiles ?? []),
    { path: `${prefix}/agents`, description: "A human-readable view of these files." },
  ];
}

function contact({ site }) {
  if (!site.contact?.length) return "";
  return section(site.contactTitle ?? sectionTitles(site).contact, site.contactText ?? "", list(site.contact.map((c) => `${c.label}: ${c.value}`)));
}

/** The other languages' entry points, and the pages this language doesn't have (linked in the language they are in). */
function languageSections(content) {
  if (!content.multi) return [];
  const { site } = content;
  const others = content.languages.filter((l) => l !== content);
  const titles = sectionTitles(site);
  return [
    content.untranslated?.length
      ? section(titles.notTranslated, list(content.untranslated.map((u) => `[${u.page.title}](${site.url}${mdPath(u.page)}) (${u.name})`)))
      : "",
    others.length ? section(titles.languages, list(others.map((l) => `[${l.name}](${site.url}${l.prefix}/llms.txt) (${l.lang})`))) : "",
  ];
}

export function buildLlmsTxt(content, { withContact = true } = {}) {
  const { site, home, pages, prefix = "", homePath = prefix || "/" } = content;
  const homeUrl = `${site.url}${homePath === "/" ? "" : homePath}`;
  const titles = sectionTitles(site);
  return doc(
    `# ${site.name}`,
    `> ${site.headline}`,
    `Format: https://llmstxt.org. Below is the text of the home page (${homeUrl}), mirrored at ${site.url}${prefix}/llm.md, followed by links to a Markdown copy of each other page.`,
    list(
      [site.readingPreference && `Reading preference: ${site.readingPreference}`, site.updated && `Updated: ${site.updated}`].filter(Boolean),
    ),
    home?.body ?? "",
    ...pageSections(content).map((group) =>
      section(group.title, list(group.pages.map((p) => `[${p.title}](${site.url}${mdPath(p)})${p.summary ? `: ${p.summary}` : ""}`))),
    ),
    ...languageSections(content),
    section(titles.files, list(agentFiles(content).map((f) => `[${f.path}](${site.url}${f.path}): ${f.description}`))),
    withContact ? contact(content) : "",
  );
}

export function buildPageMd(content, page, { withContact = true } = {}) {
  const { site } = content;
  return doc(
    `# ${page.title}`,
    `Source: ${site.url}${page.path}`,
    page.alternates?.length ? `Also in: ${page.alternates.map((a) => `[${a.name}](${site.url}${mdPath(a.page)})`).join(", ")}` : "",
    page.summary ? `> ${page.summary}` : "",
    page.body,
    withContact ? contact(content) : "",
  );
}

export function buildLlmsFullTxt(content) {
  const parts = [buildLlmsTxt(content, { withContact: false }).trim()];
  for (const page of content.pages.filter((p) => p.full !== false)) parts.push("---", buildPageMd(content, page, { withContact: false }).trim());
  const c = contact(content);
  if (c) parts.push("---", c);
  return doc(...parts);
}

const plain = (text) => text.replace(/\*\*/g, "");

export function buildProfileJson(content) {
  const { site } = content;
  // One profile for the whole site: every language's pages, each with its language and its translations.
  const pages = content.multi ? content.languages.flatMap((l) => l.pages) : content.pages;
  const pageEntry = (p) => ({
    title: p.title,
    summary: plain(p.summary),
    ...(p.section ? { section: p.section } : {}),
    url: `${site.url}${p.path}`,
    markdown: `${site.url}${mdPath(p)}`,
    ...(content.multi
      ? { language: p.language, alternates: Object.fromEntries(p.alternates.map((a) => [a.lang, { url: `${site.url}${a.page.path}`, markdown: `${site.url}${mdPath(a.page)}` }])) }
      : {}),
  });
  return {
    name: site.name,
    headline: site.headline,
    ...(site.description ? { summary: site.description } : {}),
    ...(site.location ? { location: site.location } : {}),
    url: site.url,
    ...(site.updated ? { updated: site.updated } : {}),
    ...(site.readingPreference ? { readingPreference: site.readingPreference } : {}),
    contact: Object.fromEntries((site.contact ?? []).map((c) => [c.label.toLowerCase().replace(/[^a-z0-9]+/g, "_"), c.value])),
    ...(content.multi
      ? {
          languages: content.languages.map((l) => ({
            language: l.lang,
            name: l.name,
            home: `${site.url}${l.homePath}`,
            llms: `${site.url}${l.prefix}/llms.txt`,
            headline: l.site.headline,
          })),
        }
      : {}),
    pages: pages.map(pageEntry),
    ...(site.profile ? site.profile : {}),
    files: (content.multi ? content.languages : [content]).flatMap((l) => agentFiles(l)).filter((f) => !f.glob).map((f) => `${site.url}${f.path}`).filter((f, i, all) => all.indexOf(f) === i),
  };
}

export function buildMarkdownMap(content) {
  const map = {};
  for (const l of content.languages ?? [content]) {
    const prefix = l.prefix ?? "";
    map[l.homePath ?? (prefix || "/")] = `${prefix}/llms.txt`;
    map[`${prefix}/agents`] = `${prefix}/llms.txt`;
    for (const p of l.pages) map[p.path] = mdPath(p);
  }
  return map;
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

/** One line of llms.txt in the editor: headings in bold, quotes muted, list marks muted, safe links clickable. */
function markdownLineHtml(line) {
  if (!line) return "";
  if (/^#{1,6} /.test(line)) return `<span class="b">${esc(line)}</span>`;
  if (line.startsWith("> ")) return `<span class="m">${esc(line)}</span>`;
  if (line.startsWith("- ")) return `<span class="m">- </span>${inlineHtml(line.slice(2))}`;
  return inlineHtml(line);
}

function formatSize(bytes) {
  if (typeof bytes !== "number") return "-";
  return bytes < 1024 ? `${bytes}B` : `${(bytes / 1024).toFixed(1)}K`;
}

/** A command split into tokens (program, flags, arguments), each carrying its full text for the typing script. */
function commandHtml(command) {
  return command
    .split(/(\s+)/)
    .map((token, i) => {
      if (!token) return "";
      if (/^\s+$/.test(token)) return `<span data-t="${esc(token)}">${esc(token)}</span>`;
      const cls = i === 0 ? "c-prog" : token.startsWith("-") ? "c-flag" : "c-arg";
      return `<span class="${cls}" data-t="${esc(token)}">${esc(token)}</span>`;
    })
    .join("");
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

/**
 * /agents: the files shown as a terminal session inside a code-editor window. The session types itself out
 * (four commands: whoami, then README, the file list and llms.txt). Every word is in the HTML: rows are hidden only by the script,
 * so without JavaScript, or with reduced motion, the whole session shows at once. All colours and radii come
 * from the tokens above.
 */
export function buildAgentsHtml(content, sizes) {
  const { site } = content;
  const page = site.agentsPage ?? {};
  const title = page.title ?? "What AI agents read on this site";
  const lead =
    page.lead ??
    "Before a person opens a site, an AI assistant has often read it for them. The files below carry the words of every page as Markdown, so an assistant can quote them directly instead of piecing them together from the layout.";
  const readme = [
    ...(page.readme ?? [
      site.readingPreference ?? "AI tools are welcome to use the Markdown files below instead of the HTML pages.",
      "What follows is the full set of files an agent receives, unedited.",
    ]),
    site.updated ? `Updated ${site.updated}` : "",
  ].filter(Boolean);
  const theme = site.theme ?? {};
  const light = safeTheme(DEFAULT_THEME.light, theme.light, "light");
  const dark = safeTheme(DEFAULT_THEME.dark, theme.dark, "dark");
  const radius = safeValue(theme.radius, SAFE_LENGTH, DEFAULT_RADIUS, "theme.radius");
  const sans = safeValue(theme.fontSans, SAFE_FONT, DEFAULT_SANS, "theme.fontSans");
  const mono = safeValue(theme.fontMono, SAFE_FONT, DEFAULT_MONO, "theme.fontMono");
  const handle = site.handle;
  // Sites served under a sub-path (e.g. https://user.github.io/repo): every site-relative link gets that prefix.
  const base = new URL(site.url).pathname.replace(/\/+$/, "");
  const prefix = content.prefix ?? "";
  const homePath = content.homePath ?? (prefix || "/");
  const home = `${base}${homePath === "/" ? "" : homePath}/`;

  const blocks = [
    { command: "whoami", output: [`<h1>${esc(title)}</h1>`, `<p>${esc(lead)}</p>`] },
    { command: "cat README", output: readme.map((text, i) => `<p${i === readme.length - 1 ? ' class="m"' : ""}>${esc(text)}</p>`) },
    {
      command: "ls -lh",
      output: agentFiles(content).map(
        (f) =>
          `<div class="ls"><span class="m perm">-rw-r--r--</span><span class="m size">${formatSize(sizes[f.path])}</span>${f.glob ? `<span>${esc(f.path)}</span>` : `<a href="${esc(base + f.path)}">${esc(f.path)}</a>`}<span class="m desc"># ${esc(f.description)}</span></div>`,
      ),
    },
    { command: "cat llms.txt", stream: true, output: buildLlmsTxt(content).trimEnd().split("\n").map(markdownLineHtml) },
  ];

  let n = 1;
  const row = (inner, attrs = "") => `<div class="row"${attrs}><span class="n" aria-hidden="true">${n++}</span><div class="t">${inner || " "}</div></div>`;
  const prompt = (inner) =>
    `<p class="prompt"><span class="seg"><span class="u">${esc(handle)}</span><span class="d">~/agents</span></span><span class="m">%</span>${inner}</p>`;
  const body = blocks
    .map((block, b) => {
      const head = row(
        prompt(`<span class="sr">${esc(block.command)}</span><span class="cmd" aria-hidden="true">${commandHtml(block.command)}</span>`),
        ` data-b="${b}" data-k="cmd"`,
      );
      const out = block.output.map((line) => row(line, ` data-b="${b}" data-k="out"${block.stream ? ' data-s="1"' : ""}`)).join("");
      return head + out + row("", ` data-b="${b}" data-k="end"`);
    })
    .join("");
  const last = row(prompt('<span class="cur blink"></span>'), ' data-k="last"');
  const avatar =
    site.avatar && SAFE_URL.test(site.avatar)
      ? `<img src="${esc(site.avatar.startsWith("/") && !site.avatar.startsWith("//") ? base + site.avatar : site.avatar)}" alt="" width="40" height="40">`
      : `<span class="ini">${esc(site.name.trim().charAt(0).toUpperCase())}</span>`;

  return `<!doctype html>
<html lang="${esc(site.language ?? "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.metaTitle ?? `For AI agents | ${site.name}`)}</title>
<meta name="description" content="${esc(page.description ?? `Markdown and JSON copies of ${site.url.replace(/^https?:\/\//, "")} for AI assistants: llms.txt, every page as Markdown, and a profile.`)}">
<link rel="canonical" href="${esc(site.url)}${esc(prefix)}/agents">
<link rel="alternate" type="text/markdown" href="${esc(base + prefix)}/llms.txt">
<style>
:root{${tokenVars(light)}--radius:${radius};color-scheme:light}
@media (prefers-color-scheme:dark){:root:not(.light){${tokenVars(dark)}color-scheme:dark}}
:root.dark{${tokenVars(dark)}color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0}
body{background-color:var(--background);background-image:radial-gradient(var(--border) 1px,transparent 1px);background-size:12px 12px;background-attachment:fixed;color:var(--foreground);font:14px/1.6 ${mono};padding:1rem;-webkit-font-smoothing:antialiased}
@media (min-width:640px){body{padding:1.5rem 2rem}}
h1,p{margin:0;font:inherit}
h1{font-weight:600}
a{color:var(--foreground);text-decoration:underline;text-decoration-color:var(--muted-foreground);text-decoration-thickness:1px;text-underline-offset:3px}
a:hover{text-decoration-color:var(--foreground)}
a:focus-visible{outline:2px solid var(--ring);outline-offset:2px;border-radius:calc(var(--radius) - 2px)}
.win{max-width:72rem;margin:0 auto;min-height:calc(100svh - 2rem);background:var(--card);color:var(--card-foreground);border:1px solid var(--border);border-radius:calc(var(--radius) + 4px);display:flex;flex-direction:column}
@media (min-width:640px){.win{min-height:calc(100svh - 3rem)}}
.bar{display:grid;grid-template-columns:3rem 1fr;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--card);border-radius:calc(var(--radius) + 4px) calc(var(--radius) + 4px) 0 0;z-index:2;font-family:${sans}}
.bar .av{display:flex;align-items:center;justify-content:center;border-right:1px solid var(--border);padding:.75rem 0}
.bar .av a{display:block;border-radius:calc(var(--radius) - 2px);text-decoration:none}
.bar .av img,.ini{display:flex;align-items:center;justify-content:center;width:1.75rem;height:1.75rem;border-radius:calc(var(--radius) - 2px);object-fit:contain;background:var(--muted);color:var(--foreground);font-size:13px;font-weight:600}
.bar .fn{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:0 1rem 0 .75rem;color:var(--muted-foreground);min-width:0;font-size:13px}
.bar .fn .file{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:${mono}}
.bar .meta{display:flex;align-items:center;gap:1rem;flex-shrink:0}
.bar .meta .x{display:none}
@media (min-width:640px){.bar .meta .x{display:inline}}
.lines{position:relative;flex:1;padding:.75rem 0 2rem}
.lines:before{content:"";position:absolute;top:0;bottom:0;left:calc(3rem - 1px);width:1px;background:var(--border)}
.row{display:grid;grid-template-columns:3rem 1fr;align-items:start;padding:.3rem 0}
.row:hover{background:var(--muted)}
.n{text-align:right;padding-right:.75rem;color:var(--muted-foreground);opacity:.55;user-select:none;font-size:12px;line-height:22px}
.row:hover .n{opacity:1}
.t{min-width:0;padding-left:.875rem;padding-right:1rem;overflow-wrap:anywhere}
.m{color:var(--muted-foreground)}
.b{font-weight:600}
.prompt{display:flex;flex-wrap:wrap;align-items:center;column-gap:1ch}
.seg{display:inline-flex}
.seg .u{background:var(--primary);color:var(--primary-foreground);padding:0 1ch;border-radius:var(--radius) 0 0 var(--radius)}
.seg .d{background:var(--muted);color:var(--foreground);padding:0 1ch;border-radius:0 var(--radius) var(--radius) 0}
.c-prog{font-weight:600}.c-flag{color:var(--muted-foreground)}.c-arg{text-decoration:underline;text-decoration-color:var(--border);text-underline-offset:3px}
.ls{display:grid;grid-template-columns:5ch 1fr;column-gap:2ch}
.ls .perm{display:none}
.ls .size{text-align:right}
.ls .desc{grid-column-start:2}
@media (min-width:768px){.ls{grid-template-columns:10ch 5ch 24ch 1fr}.ls .perm{display:block}.ls .desc{grid-column-start:auto}}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.cur{display:inline-block;width:.6em;height:1em;margin-left:.1em;vertical-align:middle;background:var(--foreground)}
@media (prefers-reduced-motion:no-preference){.blink{animation:blink 1.1s steps(1,end) infinite}}
@keyframes blink{50%{opacity:0}}
.hide{visibility:hidden}
</style>
</head>
<body>
<main class="win">
<div class="bar"><div class="av"><a href="${esc(home)}" aria-label="${esc(site.name)}, back to the home page">${avatar}</a></div><div class="fn"><span class="file">${esc(handle)}.md</span><span class="meta"><span class="x">Markdown</span><span class="x">UTF-8</span><a href="${esc(home)}">Back to the site</a></span></div></div>
<div class="lines">${body}${last}</div>
</main>
<script>
(function(){
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var TYPE=35, WAIT=400, RUN=250, LINE=40, STREAM=12;
  var rows=[].slice.call(document.querySelectorAll(".row[data-k]"));
  rows.forEach(function(r){r.classList.add("hide")});
  var blocks={};
  rows.forEach(function(r){var b=r.getAttribute("data-b"); if(b===null) return; (blocks[b]=blocks[b]||[]).push(r)});
  var t=0; function at(ms,fn){t+=ms; setTimeout(fn,t)}
  Object.keys(blocks).sort(function(a,b){return a-b}).forEach(function(b){
    var rs=blocks[b], head=rs[0], toks=[].slice.call(head.querySelectorAll("[data-t]"));
    var cur=document.createElement("span"); cur.className="cur";
    at(0,function(){toks.forEach(function(s){s.textContent=""}); head.querySelector(".cmd").appendChild(cur); head.classList.remove("hide")});
    var first=true;
    toks.forEach(function(s){var full=s.getAttribute("data-t"); for(var i=1;i<=full.length;i++){(function(i){at(first?WAIT:TYPE,function(){s.textContent=full.slice(0,i)}); first=false})(i)}});
    at(RUN,function(){cur.remove()});
    rs.slice(1).forEach(function(r){at(r.getAttribute("data-s")?STREAM:LINE,function(){r.classList.remove("hide")})});
  });
  at(0,function(){var l=document.querySelector('.row[data-k="last"]'); if(l) l.classList.remove("hide")});
})();
</script>
</body>
</html>
`;
}


// ---------- write ----------

/** Whether this file is the script Node was started with, also when the path to it goes through a symlink. */
export function isMain(argv1, moduleUrl) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return resolve(argv1) === fileURLToPath(moduleUrl);
  }
}

/** The absolute file for a site path, or null if it would land outside outDir. */
export function safeTarget(outDir, path) {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  const target = resolve(outDir, "." + path);
  return target.startsWith(outDir + sep) ? target : null;
}

/** Every generated file, path -> text, for the site's content. Nothing is written. */
export function renderFiles(content) {
  const bytes = (s) => Buffer.byteLength(s, "utf8");
  const files = new Map();
  files.set("/profile.json", JSON.stringify(buildProfileJson(content), null, 2) + "\n");
  for (const l of content.languages) {
    const llms = buildLlmsTxt(l);
    files.set(`${l.prefix}/llms.txt`, llms);
    files.set(`${l.prefix}/llm.md`, llms);
    files.set(`${l.prefix}/llms-full.txt`, buildLlmsFullTxt(l));
    for (const page of l.pages) files.set(mdPath(page), buildPageMd(l, page));
  }
  const sizes = Object.fromEntries([...files].map(([path, text]) => [path, bytes(text)]));
  for (const l of content.languages) files.set(`${l.prefix}/agents/index.html`, buildAgentsHtml(l, sizes));
  return files;
}

// Folders that never hold pages. Dot-folders (.git, .next, …) are skipped too. At the site's root only, also the
// usual build and tool output, so a real route named /build or /out inside a pages folder still counts.
const SKIP_ALWAYS = new Set(["node_modules"]);
const SKIP_AT_ROOT = new Set(["dist", "build", "out", "coverage", "agent-ready"]);

/** Files under `dir` (relative to root, "/"-separated) whose relative path matches `test`. */
function walk(root, dir, test, out = []) {
  const base = join(root, dir);
  if (!existsSync(base)) return out;
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_ALWAYS.has(entry.name) || (!dir && SKIP_AT_ROOT.has(entry.name))) continue;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(root, rel, test, out);
    else if (test(rel)) out.push(rel);
  }
  return out;
}

/**
 * The files that define the site's pages, one per route, relative to the site's root: what a page's
 * `source` should name. Dynamic routes ([slug]) are left out (collections cover them), and so are each
 * framework's private, error and API files. Vite and other client-routed apps have no file per route: an empty list.
 */
export function routeFiles(root, { framework, outDir = "." } = {}) {
  const dynamic = (rel) => /\[[^\]]*\]/.test(rel);
  const segments = (rel, base) => rel.slice(base.length + 1).split("/");
  const under = (base, test) => walk(root, base, test).filter((rel) => !dynamic(rel)).map((rel) => ({ rel, parts: segments(rel, base) }));
  let found = [];
  if (framework === "nextjs") {
    for (const base of ["app", "src/app"]) {
      // App Router: page.* files; folders starting with _ are private, with @ are parallel-route slots.
      found.push(...under(base, (rel) => /(^|\/)page\.(tsx|jsx|ts|js|mdx|md)$/.test(rel)).filter(({ parts }) => !parts.some((p) => /^[_@]/.test(p))));
    }
    for (const base of ["pages", "src/pages"]) {
      // Pages Router: every file is a route, except _app/_document/_error, the error pages and pages/api.
      found.push(...under(base, (rel) => /\.(tsx|jsx|ts|js|mdx|md)$/.test(rel)).filter(({ parts }) => !/^_/.test(parts.at(-1)) && parts[0] !== "api" && !(parts.length === 1 && /^(404|500)\./.test(parts[0]))));
    }
  } else if (framework === "astro") {
    // Files and folders starting with _ are not routes; 404 and 500 at the top are error pages.
    found = under("src/pages", (rel) => /\.(astro|md|mdx|html)$/.test(rel)).filter(({ parts }) => !parts.some((p) => p.startsWith("_")) && !(parts.length === 1 && /^(404|500)\./.test(parts[0])));
  } else if (framework === "sveltekit") {
    found = under("src/routes", (rel) => /(^|\/)\+page\.svelte$/.test(rel));
  } else if (framework === "static") {
    const base = outDir === "." ? "" : outDir;
    // The /agents pages are generated; 404.html and 500.html at the top are error pages.
    found = walk(root, base, (rel) => rel.endsWith(".html"))
      .filter((rel) => !dynamic(rel))
      .map((rel) => ({ rel, parts: (base ? rel.slice(base.length + 1) : rel).split("/") }))
      .filter(({ rel, parts }) => !/(^|\/)agents\/index\.html$/.test(rel) && !(parts.length === 1 && /^(404|500)\.html$/.test(parts[0])));
  }
  return found.map((f) => f.rel).sort();
}

// ---------- sync: is each copy still in step with the files its words come from? ----------

const LOCK = "sync-lock.json";
/** Text with Windows line endings made plain, so a checkout with CRLF compares equal to one with LF. */
export const sameLines = (text) => text.replace(/\r\n/g, "\n");

const hashOf = (text) => {
  // FNV-1a, 64-bit: enough to notice a change, and no dependency on node:crypto's availability.
  let h = 0xcbf29ce484222325n;
  for (const byte of Buffer.from(sameLines(text), "utf8")) h = BigInt.asUintN(64, (h ^ BigInt(byte)) * 0x100000001b3n);
  return h.toString(16).padStart(16, "0");
};
/** The hash of a file, or null if it doesn't exist or isn't a file (a folder named as a source counts as missing). */
const readHash = (file) => {
  try {
    return statSync(file).isFile() ? hashOf(readFileSync(file, "utf8")) : null;
  } catch {
    return null;
  }
};

/** A page as a person names it: its title, and its language when the site has several ("Sobre" (Português)). */
export function pageLabel(page, multi = true) {
  return `"${page.title}"${multi && page.language ? ` (${languageName(page.language)})` : ""}`;
}

/** Every hand-written page of every language: home pages included, collection items left out (they follow their data). */
export function trackedPages(content) {
  return content.languages.flatMap((l) => [l.home, ...l.pages].filter((p) => p && !p.collection));
}

/**
 * Each tracked page's state against agent-ready/sync-lock.json:
 *   "ok"       the copy and its sources are as recorded (or the copy changed: it was updated)
 *   "new"      not recorded yet
 *   "stale"    a source changed and the copy didn't
 *   "missing"  a source file no longer exists
 *   "untracked" the page has no `source`
 * Returns { pages: [{ key, page, state, changed, missing }], lock: the lock as it should be written }.
 */
export function syncStatus(root, content, { accept = false } = {}) {
  root = resolve(root);
  const lockPath = join(root, "agent-ready", LOCK);
  // A lock that doesn't parse (a merge conflict, a bad edit) is treated as empty: every page starts again as "new".
  let previous = {};
  let lockError = null;
  if (existsSync(lockPath)) {
    try {
      previous = JSON.parse(readFileSync(lockPath, "utf8")) ?? {};
    } catch (error) {
      lockError = `agent-ready/${LOCK} could not be read (${error.message}); it was started again.`;
    }
  }
  const before = previous.pages ?? {};
  const lock = { pages: {} };
  const pages = [];
  for (const page of trackedPages(content)) {
    const key = `${page.label}/${page.file}`;
    const copy = readHash(join(root, key));
    const sources = Object.fromEntries(page.source.map((s) => [s, readHash(join(root, s))]));
    const missing = page.source.filter((s) => sources[s] === null);
    const old = before[key];
    let state;
    let changed = [];
    if (!page.source.length) state = "untracked";
    else if (missing.length) state = "missing";
    else if (!old) state = "new";
    else if (old.copy !== copy) state = "ok";
    else {
      changed = page.source.filter((s) => old.sources?.[s] !== sources[s]);
      state = changed.length ? "stale" : "ok";
    }
    pages.push({ key, page, state, changed, missing });
    // A stale or broken page keeps its old record, so it is reported until its copy changes or it is accepted.
    lock.pages[key] = (state === "stale" || state === "missing") && !accept ? old ?? { copy, sources } : { copy, sources };
  }
  return { pages, lock, lockPath, lockError };
}

export function build(root = process.cwd(), { accept = false, log = console.warn } = {}) {
  const content = loadContent(root);
  const outDir = resolve(root, content.site.outDir ?? "public");
  const files = renderFiles(content);

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

  // Copies that no longer follow their source: a warning, never a failure of the site's build.
  const warnings = [];
  try {
    const status = syncStatus(root, content, { accept });
    if (status.lockError) warnings.push(status.lockError);
    for (const p of status.pages) {
      if (p.state === "stale" && !accept)
        warnings.push(`the page ${pageLabel(p.page, content.multi)} changed and its copy for AI agents didn't. Ask Claude to "update agent-ready". (${p.key}; ${p.changed.join(", ")} changed)`);
      if (p.state === "missing")
        warnings.push(`the page ${pageLabel(p.page, content.multi)} was removed or moved, but its copy for AI agents is still there. Ask Claude to "update agent-ready". (${p.key}; ${p.missing.join(", ")} not found)`);
    }
    if (status.pages.some((p) => p.page.source.length)) writeFileSync(status.lockPath, JSON.stringify(status.lock, null, 2) + "\n");
  } catch (error) {
    warnings.push(`the check for copies that are out of date didn't run (${error.message}).`);
  }
  for (const w of warnings) log(`agent-ready: ${w}`);
  return { outDir, files: [...files.keys()], content, warnings };
}

// Run directly: `node agent-ready/build.mjs`
if (isMain(process.argv[1], import.meta.url)) {
  try {
    const root = process.argv[1].endsWith(join("agent-ready", "build.mjs")) ? resolve(dirname(process.argv[1]), "..") : process.cwd();
    const { outDir, files } = build(root, { accept: process.argv.includes("--accept") });
    console.log(`agent-ready: wrote ${files.length} files to ${relative(process.cwd(), outDir) || "."}`);
  } catch (error) {
    console.error(`agent-ready: ${error.message}`);
    process.exit(1);
  }
}
