# Finding the site's content

Work out where the words come from before you write any Markdown. Try these in order and stop when you have every public page.

1. **Routes.** List the pages people can reach:
   - Next.js: `app/**/page.tsx` (route groups in `(parens)` are not part of the URL) or `pages/**`.
   - Astro: `src/pages/**`.
   - SvelteKit: `src/routes/**/+page.svelte`.
   - Vite or React Router: the router config.
   - Static: every `index.html` / `*.html`.

   Then check `sitemap.xml` / `sitemap.ts` for anything you missed. Leave out: 404, legal pages unless the owner wants them, `/api`, admin, preview and draft routes, password-protected pages, and pages marked `noindex`.
   Sites with collections of many entries (blog, changelog, docs, case studies, job openings): cover the main pages and each collection's index page. Before writing a copy for every entry, tell the owner how many there are and ask whether to include them all, the most recent ones or none. Docs that already have their own Markdown source or `llms.txt` stay where they are: link them from the `extraFiles` list instead of copying them.
2. **Data files.** Many sites keep their copy in `lib/`, `data/`, `content/` or `src/data/` (TS/JSON/YAML), and the pages only render it. Read those files and use them as the source, keeping the page's order. When one template renders many items from them (`/products/[slug]`, `/blog/[slug]`), that's a collection (`references/spec.md`): note the route, the data file and the fields the page shows.

Every file you take a page's words from goes in that page's `source`, so the sync can follow it.
3. **MDX / Markdown content.** Content collections (`src/content/**`), `posts/*.mdx`, and so on. Use the rendered text: drop component tags, but keep the words they show.
4. **Rendered HTML (fallback).** For content that isn't in the repository's files, never call an outside service or API: build and start the site, fetch each page and take the text of `<main>` (or `<body>` without the nav and footer). Use this to check the other sources too: the Markdown must match what a visitor sees.

## What counts as the page's content

- Headings, paragraphs, lists, quotes and testimonials, the visible text of cards, captions that carry information, and link targets that matter (case studies, a CV, profiles).
- Text that only appears on interaction (tabs, accordions, carousels) still counts: include it in reading order.
- Image `alt` text only when the image carries information the text doesn't.
- Leave out: navigation, cookie banners, decorative labels, "scroll down" hints, and animation-only text.
