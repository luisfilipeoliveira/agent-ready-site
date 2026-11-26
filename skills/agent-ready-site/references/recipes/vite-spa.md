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
