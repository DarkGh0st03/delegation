import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { availabilitySummary, loadCatalog, searchBooks } from "./src/catalog.js";

const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

/** HTTP server: JSON API under /api and the web page from public/. */
export function createApp(catalog) {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }
    if (url.pathname === "/api/books") {
      const books = searchBooks(catalog, { query: url.searchParams.get("q") ?? "" });
      sendJson(response, 200, { books, summary: availabilitySummary(books) });
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const path = normalize(join(PUBLIC_DIR, file));
    const type = CONTENT_TYPES[extname(path)];
    if (!path.startsWith(PUBLIC_DIR) || !type) {
      response.writeHead(404).end("Not found");
      return;
    }
    try {
      const body = await readFile(path);
      response.writeHead(200, { "content-type": type });
      response.end(body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "127.0.0.1";
  createApp(await loadCatalog()).listen(port, host, () => {
    console.log(`Campus Library running on http://${host}:${port}`);
  });
}
