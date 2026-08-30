// Entra ID(Azure AD)のグループ所属をMicrosoft Graph APIから取得するモジュール。
// 非対話式(client credentials flow、app-only)でのみアクセスする。利用者ログイン自体は
// Cloudflare Access One-Time PINのままであり、本モジュールは案件単位RBACのための
// グループ→ロールマッピングにのみ使う(Issue #5、2026-08-30の方針決定)。
//
// src/ai-provider.jsと対になる構成: describe*Config(env)で設定状態のみ返す、
// create*(env)は設定不足ならnullを返すファクトリ、AbortSignal.timeoutでタイムアウト、
// レスポンスサイズ上限、fail-soft(例外を外へ投げずnullへ縮退)という作法を踏襲する。
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 65_536;
const TOKEN_EXPIRY_SAFETY_MARGIN_MS = 5 * 60 * 1000;
const DEFAULT_GROUP_CACHE_TTL_MINUTES = 15;

// モジュールスコープのインメモリキャッシュ。単一プロセス(このアプリはホスト常駐の単一
// systemdサービスとして動作)内で共有し、リクエスト毎にMicrosoft Graphを呼ばないようにする。
// テストではresetEntraGraphCache()で初期化すること。
let tokenCache = null; // { accessToken, expiresAt }
let groupCache = new Map(); // email(lowercase) -> { groupIds, expiresAt }

export function resetEntraGraphCache() {
  tokenCache = null;
  groupCache = new Map();
}

export class EntraGraphError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EntraGraphError";
    this.code = code;
  }
}

export function describeEntraConfig(env) {
  const tenantId = normalize(env.ENTRA_TENANT_ID);
  const clientId = normalize(env.ENTRA_CLIENT_ID);
  const clientSecret = normalize(env.ENTRA_CLIENT_SECRET);
  const enabled = Boolean(tenantId && clientId && clientSecret);
  return { enabled, tenantConfigured: Boolean(tenantId) };
}

// 設定不足ならnullを返す(createAiCompletionと同型)。有効時は
// async (email) => string[] | null を返す。null戻り値は「解決できなかった」を意味し、
// 呼び出し元(src/api-handler.jsのresolveActor)はACCESS_DEFAULT_ROLEへ縮退させること。
export function createEntraGroupResolver(env, fetchImpl = fetch) {
  const config = describeEntraConfig(env);
  if (!config.enabled) return null;
  const tenantId = normalize(env.ENTRA_TENANT_ID);
  const clientId = normalize(env.ENTRA_CLIENT_ID);
  const clientSecret = normalize(env.ENTRA_CLIENT_SECRET);
  const cacheTtlMs = resolveCacheTtlMs(env.ENTRA_GROUP_CACHE_TTL_MINUTES);

  return async function resolveGroupsForEmail(email) {
    if (typeof email !== "string" || !email.includes("@")) return null;
    const key = email.toLowerCase();
    const now = Date.now();
    const cached = groupCache.get(key);
    if (cached && cached.expiresAt > now) return cached.groupIds;

    try {
      const accessToken = await getAppAccessToken({ tenantId, clientId, clientSecret, fetchImpl });
      const groupIds = await fetchUserGroupIds({ accessToken, email: key, fetchImpl });
      groupCache.set(key, { groupIds, expiresAt: now + cacheTtlMs });
      return groupIds;
    } catch (error) {
      // fail-soft: 失敗はACCESS_DEFAULT_ROLEへの縮退に委ねる。メールアドレス(個人識別子)は
      // ログへ残さない(scripts/serve-production.mjsのACCESS_ROLE_MAP検証と同じ配慮)。
      console.error("Entra group resolution failed", {
        code: error instanceof EntraGraphError ? error.code : "unknown"
      });
      return null;
    }
  };
}

function resolveCacheTtlMs(value) {
  const minutes = Number(value);
  const safe = Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_GROUP_CACHE_TTL_MINUTES;
  return safe * 60 * 1000;
}

async function getAppAccessToken({ tenantId, clientId, clientSecret, fetchImpl }) {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now) return tokenCache.accessToken;

  const url = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials"
  });
  const response = await fetchWithTimeout(fetchImpl, url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  const text = await readLimitedText(response);
  if (!response.ok) throw new EntraGraphError("token_upstream", "Entra IDトークン取得がエラーを返しました。");
  const payload = parseJsonObject(text, "token_invalid_output");
  const accessToken = payload.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new EntraGraphError("token_invalid_output", "Entra IDトークン応答にaccess_tokenがありません。");
  }
  const expiresIn = Number(payload.expires_in);
  const ttlMs = (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 60 * 60 * 1000) - TOKEN_EXPIRY_SAFETY_MARGIN_MS;
  tokenCache = { accessToken, expiresAt: now + Math.max(ttlMs, 0) };
  return accessToken;
}

async function fetchUserGroupIds({ accessToken, email, fetchImpl }) {
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}/memberOf?$select=id`;
  const response = await fetchWithTimeout(fetchImpl, url, {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}` }
  });
  const text = await readLimitedText(response);
  if (!response.ok) throw new EntraGraphError("graph_upstream", "Microsoft Graph APIがエラーを返しました。");
  const payload = parseJsonObject(text, "graph_invalid_output");
  if (!Array.isArray(payload.value)) {
    throw new EntraGraphError("graph_invalid_output", "Microsoft Graph APIの応答形式が不正です。");
  }
  return payload.value.map((item) => item?.id).filter((id) => typeof id === "string" && id);
}

async function fetchWithTimeout(fetchImpl, url, options) {
  try {
    return await fetchImpl(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new EntraGraphError("timeout", "Entra ID/Microsoft Graphへの接続がタイムアウトしました。");
    }
    throw new EntraGraphError("network", "Entra ID/Microsoft Graphへの接続に失敗しました。");
  }
}

async function readLimitedText(response) {
  const reader = response.body?.getReader?.();
  if (!reader) return response.text();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new EntraGraphError("invalid_output", "応答が大きすぎます。");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseJsonObject(text, errorCode) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new EntraGraphError(errorCode, "応答を解析できませんでした。");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new EntraGraphError(errorCode, "応答形式が不正です。");
  }
  return parsed;
}

function normalize(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
