import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { handleApiRequest } from "../src/api-handler.js";
import {
  CONTENT_TYPES,
  RequestBodyTooLargeError,
  loadHeaderRules,
  makeHeadersResolver,
  nodeRequestToFetchRequest,
  resolveStaticFile,
  toResolvedPathname,
  writeFetchResponse
} from "./lib/http-bridge.mjs";

const root = process.cwd();
const staticRoot = path.join(root, "dist");
const port = Number(process.env.PORT ?? 4174);

const headerRules = await loadHeaderRules(path.join(root, "_headers")).catch((error) => {
  console.warn(`_headersを読み込めませんでした(ローカル開発では継続します): ${error.message}`);
  return [];
});
const headersForPath = makeHeadersResolver(headerRules);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname.startsWith("/api")) {
    let request;
    try {
      request = await nodeRequestToFetchRequest(req, url);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        res.writeHead(413, { "content-type": "text/plain; charset=utf-8" });
        res.end("payload too large");
        return;
      }
      throw error;
    }
    const response = await handleApiRequest(request, {
      AUTH_MODE: process.env.AUTH_MODE ?? "demo",
      APP_ENV: process.env.APP_ENV ?? "preview",
      DATABASE_URL: process.env.LOCAL_DB === "1" ? process.env.DATABASE_URL : undefined,
      ACCESS_ROLE_MAP: process.env.ACCESS_ROLE_MAP,
      ACCESS_DEFAULT_ROLE: process.env.ACCESS_DEFAULT_ROLE,
      CF_ACCESS_TEAM_DOMAIN: process.env.CF_ACCESS_TEAM_DOMAIN,
      CF_ACCESS_AUD: process.env.CF_ACCESS_AUD,
      CORS_ORIGIN: process.env.CORS_ORIGIN
    });
    await writeFetchResponse(res, response);
    return;
  }

  const file = await resolveStaticFile(staticRoot, url.pathname);
  if (!file) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
    return;
  }
  const ext = path.extname(file);
  const resolvedPathname = toResolvedPathname(staticRoot, file);
  res.writeHead(200, {
    "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream",
    "x-content-type-options": "nosniff",
    ...headersForPath(resolvedPathname)
  });
  res.end(await readFile(file));
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Mirai Web CAD local server: http://127.0.0.1:${port}/`);
});
