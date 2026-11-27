#!/usr/bin/env node
/**
 * agent-ready-site sync: keeps the agent files in step with the site. Self-contained (Node 18+, no
 * dependencies): `init` copies it into the site as agent-ready/sync.mjs, next to build.mjs.
 *
 *   node agent-ready/sync.mjs audit     list every copy that no longer follows the site; exit 1 if any
 *   node agent-ready/sync.mjs stop      Claude Code Stop hook: when the audit finds something, ask Claude to
 *                                       run the agent-ready-sync subagent before it finishes
 *   node agent-ready/sync.mjs pre-pr    Claude Code PreToolUse hook: block a pull request (or a push) while
 *                                       the audit finds something
 *
 * The audit reads only the repository: it needs no network and runs the same in CI.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// In a site this file sits next to build.mjs (the generator); in this repository, next to generator.mjs.
const generator = await import(pathToFileURL(existsSync(join(HERE, "build.mjs")) ? join(HERE, "build.mjs") : join(HERE, "generator.mjs")).href);
const { loadContent, renderFiles, routeFiles, safeTarget, syncStatus } = generator;

/**
 * Everything that is out of step, as plain sentences. Each names the file to look at and what to do.
 * Returns { problems, configured }: `configured` is false when the site has no agent-ready/site.json yet.
 */
export function audit(root) {
  root = resolve(root);
  if (!existsSync(join(root, "agent-ready", "site.json"))) return { problems: [], configured: false };
  let content;
  try {
    content = loadContent(root);
  } catch (error) {
    return { problems: [`The build fails: ${error.message}`], configured: true };
  }
  const problems = [];

  // 1. Copies against their sources, in every language.
  const status = syncStatus(root, content);
  for (const p of status.pages) {
    if (p.state === "stale") problems.push(`${p.key} is out of date: ${p.changed.join(", ")} changed since the copy was written.`);
    if (p.state === "missing") problems.push(`${p.key}: its source ${p.missing.join(", ")} no longer exists (page removed or moved).`);
    if (p.state === "untracked") problems.push(`${p.key} has no "source" in its frontmatter, so changes to its page can't be followed.`);
  }

  // 2. Pages the site has and the copies don't: a route file that no page names as its source.
  const site = content.site;
  const sources = new Set(content.languages.flatMap((l) => [l.home, ...l.pages]).filter(Boolean).flatMap((p) => p.source ?? []));
  const ignored = new Set((site.syncIgnore ?? []).map(String));
  for (const file of routeFiles(root, { framework: site.framework, outDir: site.outDir ?? "public" }))
    if (!sources.has(file) && !ignored.has(file))
      problems.push(`${file} is a page with no copy. Add one in agent-ready/pages/ (and in each language it exists in), or list it in site.json "syncIgnore".`);

  // 3. Generated files on disk that the copies no longer produce (a copy changed, the build didn't run).
  const outDir = resolve(root, site.outDir ?? "public");
  const stale = [];
  for (const [path, text] of renderFiles(content)) {
    const target = safeTarget(outDir, path);
    if (target && existsSync(target) && readFileSync(target, "utf8") !== text) stale.push(path);
  }
  if (stale.length) problems.push(`Generated files are out of date (${stale.slice(0, 5).join(", ")}${stale.length > 5 ? `, and ${stale.length - 5} more` : ""}): run node agent-ready/build.mjs.`);

  return { problems, configured: true };
}

const SYNC_ASK =
  "Use the agent-ready-sync subagent to bring the agent files in step with the site: update each listed copy from its source " +
  "(in every language the page exists in), add or remove copies for added or removed pages, then run node agent-ready/build.mjs " +
  "and node agent-ready/sync.mjs audit until it reports nothing.";

/** Stop hook: one request per stop, never a loop (Claude Code sets stop_hook_active on the follow-up stop). */
export function stopHook(root, input = {}) {
  if (input.stop_hook_active) return null;
  const { problems } = audit(root);
  if (!problems.length) return null;
  return { decision: "block", reason: `agent-ready: the agent files no longer match the site.\n- ${problems.join("\n- ")}\n\n${SYNC_ASK}` };
}

const PR_COMMAND = /\bgh\s+pr\s+create\b|\bgit\s+push\b/;

/** PreToolUse hook: the message to block with, or null to let the call through. */
export function prePrHook(root, input = {}) {
  const tool = String(input.tool_name ?? "");
  const isPr = /create_pull_request$/.test(tool) || (tool === "Bash" && PR_COMMAND.test(String(input.tool_input?.command ?? "")));
  if (!isPr) return null;
  const { problems } = audit(root);
  if (!problems.length) return null;
  return `agent-ready audit failed: fix this before the pull request.\n- ${problems.join("\n- ")}\n\n${SYNC_ASK}`;
}

async function readStdin() {
  if (process.stdin.isTTY) return {};
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  try {
    return text.trim() ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

// Run directly: `node agent-ready/sync.mjs <audit|stop|pre-pr>`
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[1].endsWith(join("agent-ready", "sync.mjs")) ? resolve(HERE, "..") : process.cwd();
  const mode = process.argv[2] ?? "audit";
  try {
    if (mode === "audit") {
      const { problems, configured } = audit(root);
      if (!configured) console.log("agent-ready: no agent-ready/site.json here; nothing to audit.");
      else if (!problems.length) console.log("agent-ready audit: the agent files match the site.");
      else {
        console.error(`agent-ready audit: ${problems.length} problem${problems.length === 1 ? "" : "s"}.\n- ${problems.join("\n- ")}`);
        process.exit(1);
      }
    } else if (mode === "stop") {
      const result = stopHook(root, await readStdin());
      if (result) console.log(JSON.stringify(result));
    } else if (mode === "pre-pr") {
      const message = prePrHook(root, await readStdin());
      if (message) {
        console.error(message);
        process.exit(2);
      }
    } else {
      console.error(`agent-ready sync: unknown mode "${mode}" (use audit, stop or pre-pr).`);
      process.exit(1);
    }
  } catch (error) {
    // A hook must never break the session: report and let the call through.
    console.error(`agent-ready sync: ${error.message}`);
    process.exit(mode === "audit" ? 1 : 0);
  }
}
