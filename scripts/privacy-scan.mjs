#!/usr/bin/env node
// Keeps personal content out of this public repo. Three checks, all driven by files kept OUTSIDE the repo:
//
// 1. Denylist: fails when a file contains a term from ~/.config/agent-ready-site/denylist.txt (or
//    $AGENT_READY_DENYLIST). Skipped: LICENSE, and lines with the marker "privacy-allow".
// 2. --history: also scans every commit's diff and every author/committer name and email.
// 3. $AGENT_READY_COMPARE=<folder>: fails on any 7-word phrase of prose (Markdown, and string literals or
//    text in code) shared with that folder, e.g. a personal site this project was extracted from. Catches
//    copied sentences, not just names.
//
// With no denylist and no compare folder the scan passes, so contributors without them are not blocked.
// Flags: --staged (only staged files, for the pre-commit hook), --history.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join } from "node:path";

const staged = process.argv.includes("--staged");
const history = process.argv.includes("--history");
const git = (args, cwd) => execFileSync("git", args, { encoding: "utf8", cwd, maxBuffer: 256 * 1024 * 1024 });
const problems = [];

// ---------- 1 and 2: denylist ----------
const listPath = process.env.AGENT_READY_DENYLIST ?? join(homedir(), ".config", "agent-ready-site", "denylist.txt");
const terms = existsSync(listPath)
  ? readFileSync(listPath, "utf8")
      .split("\n")
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line && !line.startsWith("#"))
  : [];
if (!terms.length) console.log(`privacy-scan: no denylist at ${listPath}, skipping term checks.`);

const files = (staged ? git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]) : git(["ls-files", "--cached", "--others", "--exclude-standard"]))
  .split("\n")
  .filter(Boolean)
  .filter((file) => !file.includes("node_modules/") && existsSync(file));
const read = (file) => (staged ? git(["show", `:${file}`]) : readFileSync(file, "utf8"));

function scanText(label, text) {
  text.split("\n").forEach((line, i) => {
    if (line.includes("privacy-allow")) return;
    const lower = line.toLowerCase();
    for (const term of terms) if (lower.includes(term)) problems.push(`${label}:${i + 1}: denylisted "${term}"`);
  });
}

if (terms.length) {
  for (const file of files) {
    for (const term of terms) if (file.toLowerCase().includes(term)) problems.push(`${file}: file name has "${term}"`);
    if (file === "LICENSE") continue;
    const text = read(file);
    if (!text.includes("\u0000")) scanText(file, text);
  }
  if (history) {
    // Every added line in every commit, except LICENSE and lines marked privacy-allow.
    let current = "";
    for (const line of git(["log", "-p", "--all", "--format=@@commit %h", "--no-color", "--", ".", ":!LICENSE"]).split("\n")) {
      if (line.startsWith("@@commit ")) current = line.slice(9);
      else if (line.startsWith("+") && !line.startsWith("+++")) scanText(`history ${current}`, line.slice(1));
    }
    // Names and emails: only the noreply form of an email is allowed, never a real mailbox.
    for (const row of new Set(git(["log", "--all", "--format=%an <%ae>%n%cn <%ce>"]).split("\n").filter(Boolean))) {
      const email = /<([^>]*)>/.exec(row)?.[1] ?? "";
      if (!/@users\.noreply\.github\.com$|^noreply@/.test(email)) problems.push(`history: commit email is not a noreply address: ${row}`);
    }
  }
}

// ---------- 3: phrases shared with a reference folder ----------
const compare = process.env.AGENT_READY_COMPARE?.replace(/^~/, homedir());
const PROSE_EXT = new Set([".md", ".mdx", ".txt"]);
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".jsx", ".json", ".html", ".astro", ".svelte", ".vue"]);

/** The human-language part of a file: all of a Markdown file; string literals and markup text of code. */
function prose(text, file) {
  const ext = extname(file);
  if (PROSE_EXT.has(ext)) return [text];
  if (!CODE_EXT.has(ext)) return [];
  const out = [];
  for (const m of text.matchAll(/"((?:[^"\\\n]|\\.){20,})"|'((?:[^'\\\n]|\\.){20,})'|`([^`]{20,})`|>([^<>{}]{20,})</g)) out.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
  for (const m of text.matchAll(/(?:\/\/|\*|#)\s([^\n]{30,})/g)) out.push(m[1]); // comments
  return out;
}
const words = (t) => t.toLowerCase().replace(/\$\{[^}]*\}/g, " ").replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/).filter(Boolean);
function shingles(texts, n = 7) {
  const set = new Set();
  for (const t of texts) {
    const w = words(t);
    for (let i = 0; i + n <= w.length; i++) set.add(w.slice(i, i + n).join(" "));
  }
  return set;
}

if (compare) {
  if (!existsSync(compare)) problems.push(`AGENT_READY_COMPARE folder not found: ${compare}`);
  else {
    const theirs = new Map();
    for (const file of git(["ls-files"], compare).split("\n").filter(Boolean)) {
      if (file.includes("node_modules/")) continue;
      try {
        for (const s of shingles(prose(readFileSync(join(compare, file), "utf8"), file))) theirs.set(s, file);
      } catch {}
    }
    for (const file of files) {
      if (file === "LICENSE") continue;
      for (const s of shingles(prose(read(file), file))) if (theirs.has(s)) problems.push(`${file}: shares "${s}" with ${theirs.get(s)}`);
    }
  }
} else console.log("privacy-scan: AGENT_READY_COMPARE not set, skipping phrase comparison.");

if (problems.length) {
  console.error(`privacy-scan: ${problems.length} problem(s):\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(`privacy-scan: ${files.length} files clean${history ? ", history clean" : ""}${compare ? ", no phrases shared with the compare folder" : ""}.`);
