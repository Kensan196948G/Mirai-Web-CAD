import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { handleApiRequest } from "../src/api-handler.js";
import { developmentServerUrls } from "./lib/network-addresses.mjs";
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
const host = String(process.env.HOST ?? "0.0.0.0").trim() || "0.0.0.0";

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
      CORS_ORIGIN: process.env.CORS_ORIGIN,
      AI_PROVIDER: process.env.AI_PROVIDER,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      AI_MODEL: process.env.AI_MODEL,
      AI_RATE_LIMIT_PER_MINUTE: process.env.AI_RATE_LIMIT_PER_MINUTE,
      ENTRA_TENANT_ID: process.env.ENTRA_TENANT_ID,
      ENTRA_CLIENT_ID: process.env.ENTRA_CLIENT_ID,
      ENTRA_CLIENT_SECRET: process.env.ENTRA_CLIENT_SECRET,
      ENTRA_GROUP_ROLE_MAP: process.env.ENTRA_GROUP_ROLE_MAP,
      ENTRA_GROUP_CACHE_TTL_MINUTES: process.env.ENTRA_GROUP_CACHE_TTL_MINUTES
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

server.listen(port, host, () => {
  console.log(`Mirai Web CAD local server (${host}:${port})`);
  const urls = host === "0.0.0.0" ? developmentServerUrls(port) : [{ kind: "URL", url: `http://${host}:${port}/` }];
  for (const entry of urls) console.log(`  ${entry.kind}: ${entry.url}`);
});
