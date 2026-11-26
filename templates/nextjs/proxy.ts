import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import MARKDOWN_COPY from "__MAP_IMPORT__";

/**
 * agent-ready-site. A request whose Accept header includes text/markdown is answered with the Markdown
 * copy of that page, at the unchanged URL; a normal browser request is left alone and gets HTML.
 * /agents (and /<lang>/agents on a multilingual site) is rewritten to the generated <path>/index.html.
 * The path map comes from `node agent-ready/build.mjs` (agent-ready/pages/*.md). It is generated: don't edit it.
 */
const MAP: Record<string, string> = MARKDOWN_COPY;

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname.replace(/\/+$/, "") || "/";
  const wantsMarkdown = (request.headers.get("accept") ?? "").includes("text/markdown");
  const isAgents = path === "/agents" || (path.endsWith("/agents") && path in MAP);
  const target = wantsMarkdown ? MAP[path] : isAgents ? `${path}/index.html` : undefined;
  if (!target) return NextResponse.next();
  const response = NextResponse.rewrite(new URL(target, request.url));
  response.headers.set("Vary", "Accept");
  return response;
}

// Matches /agents and /<lang>/agents always; any other page only if its Accept header names text/markdown.
export const config = {
  matcher: [
    "/agents",
    "/:lang/agents",
    { source: "/", has: [{ type: "header", key: "accept", value: ".*text/markdown.*" }] },
    { source: "/((?!_next/|api/|.*\\.).*)", has: [{ type: "header", key: "accept", value: ".*text/markdown.*" }] },
  ],
};
