# Recipe: plain static HTML

## Files
`outDir` is the folder that holds the site's `index.html` (`init` sets it). The generator writes `llms.txt`, the `.md` copies and `agents/index.html` next to the pages.

## Every HTML page
- In `<head>`: `<link rel="alternate" type="text/markdown" href="/about.md">` (on the home page, `/llms.txt`). The href is the page's entry in `agent-ready/markdown-map.json` (on `/sobre`, `/about.md`).
- The first element in `<body>`: the hidden hint from the spec.
- The footer: `Hey agent: <a href="/agents/" aria-label="jane.md: Markdown version of this site for AI agents">jane.md</a>`.

If the pages share an include or a template (an SSG, or server-side includes), edit it once there.

## Accept negotiation by host
- **Vercel** (`vercel.json`):
  ```json
  {
    "rewrites": [
      { "source": "/", "has": [{ "type": "header", "key": "accept", "value": "(.*)text/markdown(.*)" }], "destination": "/llms.txt" },
      { "source": "/about", "has": [{ "type": "header", "key": "accept", "value": "(.*)text/markdown(.*)" }], "destination": "/about.md" }
    ],
    "headers": [{ "source": "/(.*)", "headers": [{ "key": "Vary", "value": "Accept" }] }]
  }
  ```
  Add one rewrite per entry in `agent-ready/markdown-map.json`.
- **Netlify**: `_redirects` can't match headers. Use an Edge Function that reads `agent-ready/markdown-map.json`, or skip negotiation.
- **Cloudflare Pages**: use `functions/_middleware.js` with the same logic as the Next.js proxy.
- **GitHub Pages and other plain hosts**: negotiation isn't possible. The alternate links, the hint and `/llms.txt` still work, and `check` will warn.

## Verify
`npx serve <outDir>` (or the project's own server), then `check http://localhost:3000`.
