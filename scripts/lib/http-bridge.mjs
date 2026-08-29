// Node.js httpサーバーとCloudflare Pages Functions互換のhandleApiRequest(Web標準
// Request/Response)を橋渡しする共通ロジック。scripts/serve-local.mjs(開発・E2E用、
// CSP等のheaderは緩い既定値)とscripts/serve-production.mjs(本番用、必須環境変数
// 検証あり)の両方から読み込まれる。ドリフト防止のため、静的ファイル配信、
// `_headers`パース、Node<->Fetch変換はこのファイルに一本化する。
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

/**
 * Cloudflare Pages形式の`_headers`ファイルをパースする。
 * 読み込み失敗時はfail-open(空ルールで継続)ではなく例外を投げる。呼び出し側で
 * 明示的にfail-open運用を選びたい場合(既定値のあるローカル開発サーバー等)は
 * try/catchで捕捉すること。
 * @param {string} file
 */
export async function loadHeaderRules(file) {
  const text = await readFile(file, "utf8");
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

/**
 * `_headers`のglobパターン(`/*`, `/assets/*`等)を正規表現へ変換する。
 * @param {string} pattern
 */
export function patternToRegExp(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * loadHeaderRulesの結果を受け取り、pathnameに対して適用すべきheaderをマージして
 * 返す関数を生成する。複数ルールにマッチした場合は後方(より具体的なパターン)が
 * 優先されるようObject.assignで上書きする(Cloudflare Pagesの挙動に合わせる)。
 * @param {ReturnType<typeof loadHeaderRules> extends Promise<infer T> ? T : never} headerRules
 */
export function makeHeadersResolver(headerRules) {
  return function headersForPath(pathname) {
    const merged = {};
    for (const rule of headerRules) {
      if (rule.regex.test(pathname)) Object.assign(merged, rule.headers);
    }
    return merged;
  };
}

/**
 * distディレクトリ配下から実ファイルを解決する。存在しないパスはSPAフォールバック
 * としてindex.htmlを返す。戻り値のpathはstaticRootからの絶対パス。
 * @param {string} staticRoot
 * @param {string} pathname
 */
export async function resolveStaticFile(staticRoot, pathname) {
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

/**
 * 解決済みファイルの絶対パスを、`_headers`のパターンマッチングに使う
 * "/"始まりの相対パスへ変換する。SPAフォールバック時に要求パス(例: 存在しない
 * /assets/missing.js)ではなく実際に返すファイル(index.html)でheaderルールを
 * 判定するために使う。
 * @param {string} staticRoot
 * @param {string} file
 */
export function toResolvedPathname(staticRoot, file) {
  return `/${path.relative(staticRoot, file).split(path.sep).join("/")}`;
}

// api-handler.jsのJSON本文上限(1 MiB)より緩めに設定した、Node層でのDoS防止用
// 粗いガード。正式なビジネスルールとしての本文サイズ検証はapi-handler.js側の
// readJson()が担う。ここでのガードは、api-handler.jsのストリーミング検証に
// 到達する前にNode.jsプロセスのメモリが無制限に膨らむことを防ぐためのもの。
const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;

export class RequestBodyTooLargeError extends Error {
  constructor(maxBodyBytes) {
    super(`request body exceeds ${maxBodyBytes} bytes`);
    this.name = "RequestBodyTooLargeError";
  }
}

/**
 * Node.js http.IncomingMessageをWeb標準Requestへ変換する。
 * 受信中に本文サイズを`maxBodyBytes`で制限し、超過時はRequestBodyTooLargeError
 * を投げて以後のチャンク受信を中断する(呼び出し側で413を返すこと)。
 * @param {import("node:http").IncomingMessage} req
 * @param {URL} url
 * @param {{ maxBodyBytes?: number }} [options]
 */
export async function nodeRequestToFetchRequest(req, url, options = {}) {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const chunks = [];
  let total = 0;
  // for await...ofは例外による早期終了時にreqを自動destroyする(既定の
  // destroyOnReturn: true)。ここでdestroyOnReturn: falseを指定し、上限超過時も
  // TCP接続とレスポンス送信経路を破壊しないようにする。destroy済みだと呼び出し側
  // が書き込む413レスポンスがクライアントに届かない可能性があるため。
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    total += chunk.length;
    if (total > maxBodyBytes) {
      // 送信中の残りのリクエストボディを読み捨てて接続を再利用可能な状態に保つ。
      req.resume();
      throw new RequestBodyTooLargeError(maxBodyBytes);
    }
    chunks.push(chunk);
  }
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  return new Request(url, {
    method: req.method,
    headers: req.headers,
    body
  });
}

/**
 * Web標準ResponseをNode.js http.ServerResponseへ書き戻す。
 * @param {import("node:http").ServerResponse} res
 * @param {Response} response
 */
export async function writeFetchResponse(res, response) {
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  const body = response.body ? Buffer.from(await response.arrayBuffer()) : Buffer.alloc(0);
  res.end(body);
}
