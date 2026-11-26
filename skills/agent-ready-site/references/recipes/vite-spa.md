# Recipe: Vite (React, Vue, Svelte SPA)

## Files
Generated into `public/`, so Vite copies them to `dist/`. `/agents/index.html` is a standalone page outside the SPA. The SPA's fallback rewrite must not catch it: most hosts serve real files first. On Vercel, a rewrite of everything to `/index.html` is applied after the filesystem, so it works.

## Alternate links and hint
Agents usually don't run JavaScript, so they only see `index.html`. Put both pointers there:
```html
<link rel="alternate" type="text/markdown" href="/llms.txt">
```
Put the hidden hint (markup in the spec) as the first element in `<body>`, before `<div id="root">`. If the site is prerendered (vite-plugin-ssr/vike, react-snap, and so on), add a per-route alternate in the head manager too, with `markdown-map.json`.

## Accept negotiation
Use host rules (see `static-html.md`).

## Footer
Add the link in the SPA's footer component. Use a plain `<a href="/agents">` (not the router's `<Link>`) so the browser loads the standalone page.

## Verify
`npm run build && npx vite preview`, then `check http://localhost:4173`. `vite dev` may route `/agents` to the SPA, so check the preview build.

## SvelteKit
`init` detects SvelteKit (framework `sveltekit`) and writes the files into `static/`, which SvelteKit serves from the site root.
- Alternate links: in `src/routes/+layout.svelte`, import `agent-ready/markdown-map.json` and add the `<link>` inside `<svelte:head>` for `map[$page.url.pathname]` (trailing slash removed, `/` for the home page).
- Hidden hint: the first element inside `<body>` in `src/app.html`, before `%sveltekit.body%`.
- Footer: `<a href="/agents" data-sveltekit-reload>`, so the router loads the standalone page instead of looking for a route.
- Accept negotiation: on a server adapter, in the `handle` hook in `src/hooks.server.ts`, with the same logic as the Next.js proxy. With `adapter-static`, use host rules (see `static-html.md`).
- Verify with `npm run build && npm run preview`, then `check http://localhost:4173`.
