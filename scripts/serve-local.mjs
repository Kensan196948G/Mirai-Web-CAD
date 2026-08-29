import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { handleApiRequest } from "../src/api-handler.js";

const root = process.cwd();
const staticRoot = path.join(root, "dist");
const port = Number(process.env.PORT ?? 4174);
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const headerRules = await loadHeaderRules(path.join(root, "_headers"));

async function loadHeaderRules(file) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return [];
  }
  const rules = [];
  let current = null;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.trim()) continue;
    if (!line.startsWith(" ") && !line.startsWith("\t")) {
      current = { pattern: line.trim(), headers: {} };
      rules.push(current);
      continue;
    }
    if (!current) continue;
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;
    const name = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (name) current.headers[name] = value;
  }
  return rules.map((rule) => ({ ...rule, regex: patternToRegExp(rule.pattern) }));
}

function patternToRegExp(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function headersForPath(pathname) {
  const merged = {};
  for (const rule of headerRules) {
    if (rule.regex.test(pathname)) Object.assign(merged, rule.headers);
  }
  return merged;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname.startsWith("/api")) {
    const request = await nodeRequestToFetchRequest(req, url);
    const response = await handleApiRequest(request, {
      AUTH_MODE: process.env.AUTH_MODE ?? "demo",
      APP_ENV: process.env.APP_ENV ?? "preview",
      DATABASE_URL: process.env.DATABASE_URL,
      ACCESS_ROLE_MAP: process.env.ACCESS_ROLE_MAP,
      ACCESS_DEFAULT_ROLE: process.env.ACCESS_DEFAULT_ROLE,
      CF_ACCESS_TEAM_DOMAIN: process.env.CF_ACCESS_TEAM_DOMAIN,
      CF_ACCESS_AUD: process.env.CF_ACCESS_AUD
    });
    await writeFetchResponse(res, response);
    return;
  }

  const file = await resolveStaticFile(url.pathname);
  if (!file) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
    return;
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    "content-type": contentTypes[ext] ?? "application/octet-stream",
    "x-content-type-options": "nosniff",
    ...headersForPath(url.pathname)
  });
  res.end(await readFile(file));
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Mirai Web CAD local server: http://127.0.0.1:${port}/`);
});

async function resolveStaticFile(pathname) {
  const safePath = path
    .normalize(decodeURIComponent(pathname))
    .replace(/^(\.\.[/\\])+/, "")
    .replace(/^[/\\]+/, "");
  const candidates = [safePath || "index.html", path.join(safePath, "index.html"), "index.html"];
  for (const candidate of candidates) {
    const full = path.join(staticRoot, candidate);
    if (!full.startsWith(staticRoot)) continue;
    try {
      const info = await stat(full);
      if (info.isFile()) return full;
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function nodeRequestToFetchRequest(req, url) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  return new Request(url, {
    method: req.method,
    headers: req.headers,
    body
  });
}

async function writeFetchResponse(res, response) {
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  const body = response.body ? Buffer.from(await response.arrayBuffer()) : Buffer.alloc(0);
  res.end(body);
}
