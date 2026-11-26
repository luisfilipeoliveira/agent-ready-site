# For coding agents (Cursor, Codex, Copilot, Claude Code and others)

If you were asked to make a website agent-ready with this project, follow
[`skills/agent-ready-site/SKILL.md`](skills/agent-ready-site/SKILL.md) step by step, in the repository of the
website (not in this one). Its references are in `skills/agent-ready-site/references/`.

The CLI is `cli/bin.mjs` in this repository (`node <path-to-this-repo>/cli/bin.mjs init`). Don't use
`npx agent-ready-site`: the package is not on npm yet, so that name could resolve to someone else's package.

If you are working on this repository itself: run `npm test` and `npm run privacy` before committing. Every
example, fixture and template uses placeholder content only (Example Bikes, Jane Doe, example.com).
