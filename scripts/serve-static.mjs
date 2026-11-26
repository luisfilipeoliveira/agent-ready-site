#!/usr/bin/env node
// Minimal static server for tests: `node scripts/serve-static.mjs <dir> [port]`.
// Serves index.html for folders (and /agents -> /agents/index.html) with the usual content types.
// No Accept negotiation, like most static hosts. BLOCK_UA=<regex> answers 403 to matching User-Agents,
// like a host's bot-protection rule.
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const port = Number(process.argv[3] ?? 3000);
const BLOCK_UA = process.env.BLOCK_UA ? new RegExp(process.env.BLOCK_UA, "i") : null;
const TYPES = { ".html": "text/html; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".json": "application/json", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" };

createServer((req, res) => {
  if (BLOCK_UA?.test(req.headers["user-agent"] ?? "")) return res.writeHead(403, { "Content-Type": "text/html" }).end("<html>Blocked</html>");
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = normalize(join(root, url));
  if (file !== root && !file.startsWith(root + sep)) return res.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) return res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));
