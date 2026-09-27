import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../dist/", import.meta.url));
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
};
createServer((req, res) => {
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (!pathname.startsWith("/preview/")) throw Error("subpath required");
    const file = resolve(root, pathname.slice(9) || "index.html");
    if (!file.startsWith(root) || !statSync(file).isFile())
      throw Error("not found");
    res.writeHead(200, {
      "Content-Type": mime[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(4178, "127.0.0.1");
