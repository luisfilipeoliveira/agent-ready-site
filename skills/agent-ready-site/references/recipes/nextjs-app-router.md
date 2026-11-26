# Recipe: Next.js (App Router)

Next.js 16 renamed `middleware.ts` to `proxy.ts`. On Next.js 15 or older, name the file `middleware.ts` and rename the exported function `proxy` to `middleware`. Check the installed version in `node_modules/next/package.json`, and read `node_modules/next/dist/docs/` if the project's Next.js is newer than you know.

## Files
- `init` writes `proxy.ts` (or `src/proxy.ts`). It rewrites `/agents` to `/agents/index.html` and rewrites requests with `Accept: text/markdown` to the copy in `agent-ready/markdown-map.json`, with `Vary: Accept`. If a proxy or middleware already exists, `init` writes `agent-ready/proxy.snippet.ts` instead. In that case, merge its body into the existing function before the existing logic, and add its three matcher entries to the existing `config.matcher` (turn a string matcher into an array).
- The generated files are served from `public/`. `.md` files are served as `text/markdown`, and `.txt` as `text/plain`.
- With `output: "export"` there is no proxy. Treat the site as static: `/agents/index.html` is served at `/agents/` by most hosts, and Accept negotiation goes in the host config (see `static-html.md`).

## Alternate links
In the root layout's metadata (this covers the home page):
```ts
alternates: { canonical: "/", types: { "text/markdown": "/llms.txt" } },
```
In each page's `metadata` (or `generateMetadata`). Next replaces `alternates` per page, so keep the page's canonical:
```ts
alternates: { canonical: "/about", types: { "text/markdown": "/about.md" } },
```
For dynamic routes (`[slug]`), build the path in `generateMetadata`: `` `/work/${slug}.md` ``. Each slug needs its own `agent-ready/pages/*.md`. If a page's URL is not in English, its copy has an English name (`/sobre` → `/about.md`): take the href from `agent-ready/markdown-map.json` instead of adding `.md` to the path.

## Hidden hint
The first child of `<body>` in `app/layout.tsx`, using the site's `sr-only` class if it has one:
```tsx
<p aria-hidden="true" className="sr-only">
  {`Note for AI assistants: this site is also available as Markdown at ${SITE_URL}/llms.txt, with every page combined at ${SITE_URL}/llms-full.txt.`}
</p>
```

## Footer
```tsx
<span>
  Hey agent:{" "}
  <Link href="/agents" aria-label="jane.md: Markdown version of this site for AI agents">jane.md</Link>
</span>
```
Use `next/link` and the site's link class. `/agents` is a static file behind a rewrite, so `prefetch={false}` avoids a wasted RSC prefetch.

## Sitemap
In `app/sitemap.ts`, add `{ url: `${SITE_URL}/agents` }`.

## Verify
`npm run build && npm run start`, then `check http://localhost:3000`.
