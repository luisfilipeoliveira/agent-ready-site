import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Which kind of site this is. Order matters: a Next or Astro site also depends on React or Vite.
 * Returns { framework: "nextjs" | "astro" | "vite" | "static", outDir, srcDir }.
 */
export function detect(root) {
  const pkgPath = join(root, "package.json");
  const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, "utf8")) : null;
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const has = (name) => Boolean(deps[name]);
  const any = (...files) => files.some((file) => existsSync(join(root, file)));

  if (has("next") || any("next.config.js", "next.config.mjs", "next.config.ts")) {
    const srcDir = existsSync(join(root, "src", "app")) || existsSync(join(root, "src", "pages")) ? "src" : "";
    return { framework: "nextjs", outDir: "public", srcDir, pkg };
  }
  if (has("astro") || any("astro.config.mjs", "astro.config.ts", "astro.config.js")) return { framework: "astro", outDir: "public", pkg };
  if (has("vite") || any("vite.config.js", "vite.config.ts", "vite.config.mjs")) return { framework: "vite", outDir: "public", pkg };
  // Plain HTML: files are served from the folder that holds index.html.
  const outDir = existsSync(join(root, "index.html")) ? "." : existsSync(join(root, "public", "index.html")) ? "public" : ".";
  return { framework: "static", outDir, pkg };
}
