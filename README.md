# agent-ready-site

Make your website readable by AI agents, generated from the site's own content.

More and more, the first reader of a website is an AI assistant working for someone else. Agents that
read rendered layouts guess: they miss text in carousels, misread cards, and invent what isn't there.
`agent-ready-site` gives them the same content as your pages, in plain Markdown, and shows people that
it's there with a small link in the footer:

> Hey agent: **jane.md**

## What it adds to your site

| URL | What it is |
| --- | --- |
| `/llms.txt` (and `/llm.md`) | The index, in the [llms.txt](https://llmstxt.org) format: your home page, links to every page copy, and contact |
| `/about.md`, `/work/case.md`, … | A Markdown copy of every public page, at the page's URL + `.md` |
| `/llms-full.txt` | Everything in one file |
| `/profile.json` | Name, headline, pages and contact as JSON |
| `/agents` | A simple page for people: the files with their sizes, and a preview of llms.txt (no JavaScript, light and dark) |

It also points agents to these files:
- a `<link rel="alternate" type="text/markdown">` on every page;
- a hidden first line in `<body>`;
- `Accept: text/markdown` negotiation where your host allows it;
- the **"Hey agent: `<handle>`.md"** footer link.

The content comes only from your site. The agent reads your pages (or the data files behind them) and writes
one Markdown file per page in `agent-ready/pages/`. A tiny generator with no dependencies turns those files into
everything above on every build.

## Install

### With Claude Code (recommended)

```bash
/plugin marketplace add luisfilipeoliveira/agent-ready-site
/plugin install agent-ready-site@agent-ready-site
```

Then, in your website's repository, ask:

> Make this site agent-ready.

The skill scaffolds the files, reads your pages, writes the Markdown, wires the pointers, adds the footer
link, builds the site and runs the checks. It asks you only for your name, the handle for `<handle>.md`
and your production URL, if it can't find them.

### With another coding agent (Cursor, Codex, Copilot…)

Clone this repository next to your site and tell your agent:

> Follow `../agent-ready-site/AGENTS.md` to make this site agent-ready.

### By hand, with the CLI

```bash
npx agent-ready-site init --name "Jane Doe" --handle jane --url https://example.com
# write agent-ready/site.json and agent-ready/pages/*.md (see the spec)
node agent-ready/build.mjs
npx agent-ready-site check http://localhost:3000
```

The spec and the recipes for each framework are in
[`skills/agent-ready-site/references/`](skills/agent-ready-site/references/).

## Frameworks

| Stack | Files | Accept negotiation |
| --- | --- | --- |
| Next.js (App Router) | `public/` + `proxy.ts` (written by `init`) | Yes, in the proxy |
| Astro | `public/` | Middleware (SSR) or host rules |
| Vite SPA | `public/` | Host rules |
| Plain HTML | next to `index.html` | Host rules (Vercel, Cloudflare); not possible on GitHub Pages |

## What gets added to your repository

```
agent-ready/
  site.json        name, handle, URL, contact, /agents copy, optional theme
  pages/*.md       one Markdown copy per public page (you or your agent keep these current)
  build.mjs        the generator (runs before dev and build)
  markdown-map.json, .generated.json   written by the generator
public/            llms.txt, llm.md, llms-full.txt, profile.json, the .md copies, agents/index.html
```

When your content changes, update the matching file in `agent-ready/pages/` and the build does the rest.

## Privacy

Only what your site already shows to an anonymous visitor goes into these files. The skill never copies
anything from behind a login, from drafts or from private notes, and adds no contact details your site doesn't
already show.

## License

MIT. Made by Luís Oliveira. <!-- privacy-allow -->
