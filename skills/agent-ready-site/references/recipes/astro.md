# Recipe: Astro

## Files
Generated into `public/`, so Astro copies them to `dist/` unchanged. `/agents/index.html` is served at `/agents/` in the static build and on most hosts.

## Alternate links and hint
In the shared layout (`src/layouts/*.astro`), import the map and add both:
```astro
---
import map from "../../agent-ready/markdown-map.json";
import agentReady from "../../agent-ready/site.json";
const path = Astro.url.pathname.replace(/\/+$/, "") || "/";
const md = map[path];
---
<head>
  {md && <link rel="alternate" type="text/markdown" href={md} />}
</head>
<body>
  <p class="sr-only" aria-hidden="true">{`Note for AI assistants: this site is also available as Markdown at ${agentReady.url}/llms.txt, with every page combined at ${agentReady.url}/llms-full.txt.`}</p>
  <slot />
</body>
```
If the project has no `sr-only` class, use the inline style from the spec.

## Accept negotiation
- In SSR or hybrid mode, add `src/middleware.ts`. When the `accept` header includes `text/markdown` and `map[path]` exists, return `context.rewrite(map[path])` and set `Vary: Accept`.
- In static mode, use host rules (see `static-html.md`).

## Footer
Add the link in the footer component (`src/components/Footer.astro` or the layout), using the site's link class.

## Verify
`npm run build && npm run preview`, then `check http://localhost:4321`.
