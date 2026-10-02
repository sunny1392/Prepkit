import { createServer, type Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname } from "node:path";

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".txt": "text/plain", ".xml": "application/xml", ".json": "application/json", ".png": "image/png" };

/** Minimal static server for fixture company sites (stands in for the grader's localhost:8099). */
export function startStaticServer(root: string, port = 0): Promise<{ server: Server; url: string }> {
  const server = createServer(async (req, res) => {
    try {
      const path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
      if (path.startsWith("/slow")) {
        await new Promise((r) => setTimeout(r, 15000));
      }
      let file = join(root, path);
      const st = await stat(file).catch(() => null);
      if (st?.isDirectory()) file = join(file, "index.html");
      if (st?.isDirectory() && !path.endsWith("/")) {
        res.writeHead(301, { location: path + "/" }).end();
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/html" }).end("<h1>Not found</h1>");
    }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => {
    const addr = server.address();
    const p = typeof addr === "object" && addr ? addr.port : port;
    resolve({ server, url: `http://localhost:${p}` });
  }));
}
