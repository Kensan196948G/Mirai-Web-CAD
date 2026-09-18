import { API_SECURITY_HEADERS, handleApiRequest } from "../../src/api-handler.js";

// Cloudflare Pages Functions の入口。
//
// PagesのURL(*.pages.dev とそのpreview)は Cloudflare Access の外側にあり、誰でも到達できる。
// そのため、認証方式をリクエストヘッダーで自己申告する "demo" モードでは稼働させない。
// AUTH_MODE が未設定・不正値の場合も含めて "access" 以外は拒否する(fail-closed)。
// これにより「AUTH_MODEを設定し忘れたPages環境が、x-demo-roleヘッダーだけで
// cad_admin相当の権限を許してしまう」経路を塞ぐ(docs/operations.md参照)。
//
// なお Pages Functions の応答には `_headers` のルールが適用されない(実測: API応答に
// CSP/HSTSが付かない)。そのためAPI側のヘッダをここでも明示的に付与する。
export async function onRequest(context) {
  if (context.env.AUTH_MODE !== "access") {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "この環境ではAPIを提供していません。本番URLを利用してください。"
      }),
      {
        status: 503,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          ...API_SECURITY_HEADERS
        }
      }
    );
  }
  return handleApiRequest(context.request, context.env);
}
