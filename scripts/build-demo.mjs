#!/usr/bin/env node
// Builds the live demo served by GitHub Pages at docs/demo/: the plain-HTML example with the placeholder
// content, made agent-ready exactly as the skill would (init, page copies, build, pointers, footer link).
// `npm run demo`. Pass a URL to build for another host: `node scripts/build-demo.mjs https://example.org/demo`.
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { init } from "../cli/init.mjs";
import { build } from "../cli/generator.mjs";
import { addPointers } from "./lib/pointers.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "demo");
const URL_ = (process.argv[2] ?? "https://luisfilipeoliveira.github.io/agent-ready-site/demo").replace(/\/+$/, "");
const base = new URL(URL_).pathname.replace(/\/+$/, "");

rmSync(OUT, { recursive: true, force: true });
cpSync(join(ROOT, "examples", "static-placeholder"), OUT, { recursive: true });

// The example links from the site root; under a sub-path every root link needs the prefix.
function htmlFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? htmlFiles(path) : name.endsWith(".html") ? [path] : [];
  });
}
if (base) for (const file of htmlFiles(OUT)) writeFileSync(file, readFileSync(file, "utf8").replace(/(href|src)="\/(?!\/)/g, `$1="${base}/`));

const { framework, outDir } = init(OUT, {});
const fixture = join(ROOT, "scripts", "fixtures", "jane");
const site = { framework, outDir, ...JSON.parse(readFileSync(join(fixture, "site.json"), "utf8")), url: URL_ };
writeFileSync(join(OUT, "agent-ready", "site.json"), JSON.stringify(site, null, 2) + "\n");
cpSync(join(fixture, "pages"), join(OUT, "agent-ready", "pages"), { recursive: true });
build(OUT);
addPointers(OUT, site);

// The demo ships the generated site only; the agent-ready/ sources stay in the repo's fixtures.
rmSync(join(OUT, "agent-ready"), { recursive: true, force: true });
// GitHub Pages runs Jekyll by default, which skips some files; serve everything as is.
writeFileSync(join(ROOT, "docs", ".nojekyll"), "");
console.log(`demo: built ${URL_} into docs/demo/${existsSync(join(OUT, "agents", "index.html")) ? "" : " (no /agents?)"}`);
