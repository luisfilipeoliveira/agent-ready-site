# Contributing

- `npm test` runs the end-to-end test on the static example (init, build, pointers, serve, check).
- Next.js example, by hand:
  ```bash
  cp -R examples/next-placeholder /tmp/next-test && cd /tmp/next-test && npm install
  node <repo>/cli/bin.mjs init --name "Jane Doe" --handle jane --url https://example.com
  ```
  Then fill `agent-ready/` from `scripts/fixtures/jane/`, add the alternates, hint and footer link as in
  `skills/agent-ready-site/references/recipes/nextjs-app-router.md`, `npm run build && npx next start`, and
  `node <repo>/cli/bin.mjs check http://localhost:3000`. Every check should pass, Accept negotiation included.
- The examples stay **pristine** (no agent layer): they are what the skill starts from.
- Placeholder content only. `npm run privacy` scans the repo against a denylist kept outside it
  (`~/.config/agent-ready-site/denylist.txt` or `$AGENT_READY_DENYLIST`); the pre-commit hook in `.githooks/`
  runs it on staged files (`git config core.hooksPath .githooks`). Exact strings that may contain a denylisted term (such as
  this repo's own owner/name) go in `~/.config/agent-ready-site/allow.txt` (or `$AGENT_READY_ALLOWLIST`).
- Before publishing, run the full scan: `AGENT_READY_COMPARE=<path to the site this was extracted from> npm run privacy -- --history`.
  It also checks every commit and commit email, and fails on any 7-word phrase shared with that folder.
- `cli/generator.mjs` is copied into every site as `agent-ready/build.mjs`, so it must stay dependency-free and
  run on Node 18.
