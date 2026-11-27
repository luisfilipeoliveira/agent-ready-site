# agent-ready-site

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/cover-dark.png">
  <img src="docs/cover.png" alt="agent-ready-site: make any website readable by AI agents. An editor window runs ls -lh and cat llms.txt next to the footer link Hey agent: you.md">
</picture>

**Live demo:** [a placeholder site made agent-ready](https://luisfilipeoliveira.github.io/agent-ready-site/demo/), with its [/agents page](https://luisfilipeoliveira.github.io/agent-ready-site/demo/agents/) and [llms.txt](https://luisfilipeoliveira.github.io/agent-ready-site/demo/llms.txt).

Make your website readable by AI agents, from the site's own content.

More and more, the first reader of a website is an AI assistant working for someone else. Assistants that read
the rendered layout guess: they miss text in carousels, misread cards and invent what isn't there.

`agent-ready-site` gives them the words of every page as plain Markdown, in every language your site has, and keeps
those copies up to date when the site changes. Nothing is invented: every word comes from your pages. It adds a
small "Hey agent" link to your footer and an `/agents` page, so people can see what AI assistants read. You set it
up in Claude Code in a couple of minutes, without writing code.

## Get started in 2 minutes

You don't need to know how to code. [Claude Code](https://claude.com/claude-code) does the work for you.

1. **Open your website's project in Claude Code** (the desktop app or the terminal). Open the folder of your site,
   not the folder of agent-ready-site.
2. **Add agent-ready-site.** Type these two lines in Claude Code, one at a time:
   ```text
   /plugin marketplace add luisfilipeoliveira/agent-ready-site
   /plugin install agent-ready-site@agent-ready-site
   ```
   Added it before? Get the latest version first:
   ```text
   /plugin marketplace update agent-ready-site
   ```
3. **Type `/agent-ready`**, or just say *"Make this site readable by AI agents"*.

What happens next:

- Claude shows you the pages it found, in every language your site has, before it writes anything.
- It only asks for what it can't find on your site: the name to show, a short handle for the footer link (for
  example `examplebikes.md`) and your site's address.
- It writes a copy of each page for AI agents, adds the "Hey agent" link to your footer and checks that it all works.
- It ends with a short summary in plain words. It saves the work in your project, and asks before publishing it or
  opening a pull request.

## What you get

- **AI assistants read your site correctly.** Every page has a clean copy they can quote, instead of guessing from
  the layout.
- **One small visible change:** the "Hey agent" link in your footer, in your site's own style.
- **A page for people** at `/agents`. AI agents don't need it: it's where the footer link takes your visitors, so
  anyone can see exactly what AI assistants read on your site.

## Keeping it up to date

You don't need to do anything. When you change your site with Claude, the copies for AI agents update themselves,
in every language, before Claude finishes. Before a pull request, they are checked again.

If you change the site some other way, or just want to be sure, tell Claude:

| Say this | Or type | What happens |
| --- | --- | --- |
| "Update agent-ready" | `/agent-ready-update` | The copies are brought up to date with your pages |
| "Check agent-ready" | `/agent-ready-check` | You get a plain answer: all up to date, or which pages need an update |

## Privacy

Only what your site already shows to an anonymous visitor goes into these files. The skill never copies
anything from behind a login, from drafts or from private notes, and adds no contact details your site doesn't
already show.

## For developers

Everything above runs on a small Node CLI with no dependencies. This section is for people who want to see or run
it themselves.

### What it adds to your site

| URL | What it is |
| --- | --- |
| `/llms.txt` (and `/llm.md`) | The index, in the [llms.txt](https://llmstxt.org) format: your home page, links to every page copy, and contact |
| `/about.md`, `/work/case.md`, … | A Markdown copy of every public page, at the page's URL + `.md`. In English at the root; on a multilingual site, each further language also gets copies in its own words (`/pt/sobre.md`). A page whose URL isn't in English gets an English copy name (`/sobre` → `/about.md`) |
| `/llms-full.txt` | Everything in one file |
| `/profile.json` | Name, headline, pages and contact as JSON |
| `/agents` | A page for people that shows what agents read (see below) |

#### The /agents page

Agents read `/llms.txt` and the `.md` copies. `/agents` is not for them: it is the human view of the same files, the
page the "Hey agent" footer link opens. Anyone can see there exactly what an AI assistant receives from the site.

It shows the files as a terminal session in a code-editor window, in four steps:

1. `whoami`: the page's title and lead (`agentsPage` in `site.json`).
2. `cat README`: the site's reading preference, a note that what follows is the full set of files an agent receives,
   unedited, and the `updated` date.
3. `ls -lh`: every generated file with its size, a link to it and one line on what it is.
4. `cat llms.txt`: the index, exactly as agents get it.

The header shows the site's avatar (or its initial) and `<handle>.md`, with a link back to the site. The session
types itself out; without JavaScript, or with reduced motion, it shows all at once. Light and dark follow the
visitor's setting. A multilingual site gets one page per language (`/pt/agents`), each linking back to its own home.
The page also links its `llms.txt` as a Markdown alternate, so an agent that lands on it is sent to the files.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/agents-dark.png">
  <img src="docs/agents-light.png" alt="The /agents page: an editor window with numbered lines and a shell session that runs whoami, cat README, ls -lh with the generated files and their sizes, and cat llms.txt" width="720">
</picture>

Screenshots of the placeholder example with the default tokens. A site can use its own colours, radius and fonts
through `theme` in `agent-ready/site.json`, so the page looks like part of the site.

It also points agents to these files:
- a `<link rel="alternate" type="text/markdown">` on every page;
- a hidden first line in `<body>`;
- `Accept: text/markdown` negotiation where your host allows it;
- the **"Hey agent: `<handle>`.md"** footer link.

The content comes only from your site. The agent reads your pages (or the data files behind them) and writes
one Markdown file per page in `agent-ready/pages/`. A tiny generator with no dependencies turns those files into
everything above on every build.

Pages that come from data, such as a product catalogue or a blog, don't need a file each: a **collection** in
`site.json` points at the JSON and one Markdown template, and the build writes a copy per item. `/llms.txt` groups
the copies into sections (`## Products`, `## Posts`, `## Policies`) the way the site is organised.

### Install without the Claude Code plugin

#### With another coding agent (Cursor, Codex, Copilot…)

Clone this repository next to your site and tell your agent:

> Follow `../agent-ready-site/AGENTS.md` to make this site agent-ready.

#### By hand, with the CLI

You only need Node 18 or later. Clone this repository next to your site, then, from your site's root:

```bash
node ../agent-ready-site/cli/bin.mjs init --name "Jane Doe" --handle jane --url https://example.com
# write agent-ready/site.json and agent-ready/pages/*.md (see the spec)
node agent-ready/build.mjs
node agent-ready/sync.mjs audit
node ../agent-ready-site/cli/bin.mjs check http://localhost:3000
```

After `init`, everything runs from your own repository with `node agent-ready/...`: no package manager needed.
If your site has a `package.json`, `init` also adds the build step to its `dev` and `build` scripts (npm, pnpm, Yarn
and Bun all work).

Without a clone, the same CLI is on npm: `npx agent-ready-site` does the same as `node ../agent-ready-site/cli/bin.mjs`.

A site in several languages lists them in `site.json`, English first (`"languages": ["en", "pt"]`). The English
copies stay in `agent-ready/pages/`; each further language keeps the site's own words in `agent-ready/pages/<lang>/`
and gets its own `llms.txt` and `/agents` under its prefix. Pages the site doesn't show in that language are
linked in the language they exist in, never translated. A site whose root is in another language, with English
under a path (`/` in Portuguese, `/en` in English), sets `"home": "/en"` and `i18n.pt.home: "/"`; `/llms.txt` stays
the English one.

`check` also warns if robots.txt or the host's bot protection turns AI crawlers away from `/llms.txt`. It tests
robots.txt rules and User-Agent blocks; blocks that verify the crawler's IP can't be seen from outside. It also
warns where the files and the live pages disagree: a headline, a contact detail or a heading the site doesn't
show, or an `updated` date older than six months.

The spec and the recipes for each framework are in
[`skills/agent-ready-site/references/`](skills/agent-ready-site/references/).

### Frameworks

| Stack | Files | Accept negotiation |
| --- | --- | --- |
| Next.js (App Router) | `public/` + `proxy.ts` (written by `init`) | Yes, in the proxy |
| Astro | `public/` | Middleware (SSR) or host rules |
| SvelteKit | `static/` | Server hook or host rules |
| Vite SPA | `public/` | Host rules |
| Plain HTML | next to `index.html` | Host rules (Vercel, Cloudflare); not possible on GitHub Pages |

### What gets added to your repository

```
agent-ready/
  site.json        name, handle, URL, contact, /agents copy, optional theme
  pages/*.md       one Markdown copy per public page (you or your agent keep these current)
  templates/*.md   optional: one template per collection (product, post…), filled from your data
  build.mjs        the generator (runs before dev and build)
  sync.mjs         the audit and the Claude Code hooks
  sync-lock.json   what each copy and its source looked like at the last build (commit it)
  markdown-map.json, .generated.json   written by the generator
.claude/           the agent-ready-sync subagent and the hooks (merged into your settings.json)
.github/workflows/agent-ready.yml      the audit on every pull request (GitHub only)
public/            llms.txt, llm.md, llms-full.txt, profile.json, the .md copies, agents/index.html
                   (static/ in SvelteKit, next to index.html on a plain HTML site)
```

Each copy names the file its words come from (`source: app/about/page.tsx`), which is how a change is noticed. To run
the audit yourself:

```bash
node agent-ready/sync.mjs audit
```

## License

MIT. Made by Luís Oliveira. <!-- privacy-allow -->
