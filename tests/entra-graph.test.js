import test from "node:test";
import assert from "node:assert/strict";
import { createEntraGroupResolver, describeEntraConfig, resetEntraGraphCache } from "../src/entra-graph.js";

const BASE_ENV = { ENTRA_TENANT_ID: "tenant-1", ENTRA_CLIENT_ID: "client-1", ENTRA_CLIENT_SECRET: "secret-1" };

function mockResponse(status, jsonBody) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(jsonBody) };
}

function tokenOk() {
  return mockResponse(200, { access_token: "fake-token", expires_in: 3600 });
}

function groupsOk(ids) {
  return mockResponse(200, { value: ids.map((id) => ({ id })) });
}

function makeFetch(handlers) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes("login.microsoftonline.com")) return handlers.token();
    if (url.includes("graph.microsoft.com")) return handlers.graph();
    throw new Error(`unexpected url: ${url}`);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test("describeEntraConfig reports enabled only when all three variables are set", () => {
  assert.equal(describeEntraConfig(BASE_ENV).enabled, true);
  assert.equal(describeEntraConfig({ ...BASE_ENV, ENTRA_CLIENT_SECRET: undefined }).enabled, false);
  assert.equal(describeEntraConfig({}).enabled, false);
  assert.equal(describeEntraConfig({ ENTRA_TENANT_ID: "t" }).tenantConfigured, true);
});

test("createEntraGroupResolver returns null when configuration is incomplete", () => {
  const resolver = createEntraGroupResolver({ ENTRA_TENANT_ID: "t" }, async () => mockResponse(200, {}));
  assert.equal(resolver, null);
});

test("resolveGroupsForEmail returns group ids on success", async () => {
  resetEntraGraphCache();
  const fetchImpl = makeFetch({ token: tokenOk, graph: () => groupsOk(["group-a", "group-b"]) });
  const resolve = createEntraGroupResolver(BASE_ENV, fetchImpl);
  const groups = await resolve("user@example.com");
  assert.deepEqual(groups, ["group-a", "group-b"]);
});

test("resolveGroupsForEmail rejects a value without an @ without making any network call", async () => {
  resetEntraGraphCache();
  const fetchImpl = makeFetch({ token: tokenOk, graph: () => groupsOk(["group-a"]) });
  const resolve = createEntraGroupResolver(BASE_ENV, fetchImpl);
  const groups = await resolve("not-an-email");
  assert.equal(groups, null);
  assert.equal(fetchImpl.calls.length, 0);
});

test("token and group lookups are cached: a second call for the same email makes no further HTTP calls", async () => {
  resetEntraGraphCache();
  const fetchImpl = makeFetch({ token: tokenOk, graph: () => groupsOk(["group-a"]) });
  const resolve = createEntraGroupResolver(BASE_ENV, fetchImpl);
  await resolve("user@example.com");
  const callsAfterFirst = fetchImpl.calls.length;
  assert.equal(callsAfterFirst, 2); // token + graph
  await resolve("user@example.com");
  assert.equal(fetchImpl.calls.length, callsAfterFirst); // fully cached, no new calls
});

test("a second call for a different email reuses the cached app token but still fetches groups", async () => {
  resetEntraGraphCache();
  const fetchImpl = makeFetch({ token: tokenOk, graph: () => groupsOk(["group-a"]) });
  const resolve = createEntraGroupResolver(BASE_ENV, fetchImpl);
  await resolve("user1@example.com");
  const callsAfterFirst = fetchImpl.calls.length;
  await resolve("user2@example.com");
  assert.equal(fetchImpl.calls.length, callsAfterFirst + 1); // only the graph call, token reused
});

test("the app token cache does not leak across different tenant/client configurations", async () => {
  resetEntraGraphCache();
  const tokensIssued = [];
  const fetchImpl = async (url) => {
    if (url.includes("login.microsoftonline.com")) {
      const token = `token-for-${url}`;
      tokensIssued.push(token);
      return mockResponse(200, { access_token: token, expires_in: 3600 });
    }
    return groupsOk(["group-a"]);
  };
  const resolveTenantA = createEntraGroupResolver(BASE_ENV, fetchImpl);
  const resolveTenantB = createEntraGroupResolver({ ...BASE_ENV, ENTRA_TENANT_ID: "tenant-2" }, fetchImpl);
  // Distinct emails to isolate this test from the per-email group cache: the point here is
  // whether the *token* cache is tenant-scoped, not whether the group cache is.
  await resolveTenantA("user-a@example.com");
  await resolveTenantB("user-b@example.com");
  // Each tenant must obtain its own token (distinct login.microsoftonline.com/{tenant}/... URL),
  // proving the cache key includes the tenant and a tenant-B request never reuses tenant-A's token.
  assert.equal(tokensIssued.length, 2);
  assert.notEqual(tokensIssued[0], tokensIssued[1]);
});

test("resetEntraGraphCache forces a fresh token and group lookup", async () => {
  resetEntraGraphCache();
  const fetchImpl = makeFetch({ token: tokenOk, graph: () => groupsOk(["group-a"]) });
  const resolve = createEntraGroupResolver(BASE_ENV, fetchImpl);
  await resolve("user@example.com");
  resetEntraGraphCache();
  await resolve("user@example.com");
  assert.equal(fetchImpl.calls.length, 4); // token+graph, then token+graph again
});

test("resolveGroupsForEmail is fail-soft (returns null, does not throw) when the token endpoint errors", async () => {
  resetEntraGraphCache();
  const fetchImpl = makeFetch({ token: () => mockResponse(401, { error: "invalid_client" }), graph: () => groupsOk(["group-a"]) });
  const resolve = createEntraGroupResolver(BASE_ENV, fetchImpl);
  const groups = await resolve("user@example.com");
  assert.equal(groups, null);
});

test("resolveGroupsForEmail is fail-soft when the Graph API errors", async () => {
  resetEntraGraphCache();
  const fetchImpl = makeFetch({ token: tokenOk, graph: () => mockResponse(403, { error: "Forbidden" }) });
  const resolve = createEntraGroupResolver(BASE_ENV, fetchImpl);
  const groups = await resolve("user@example.com");
  assert.equal(groups, null);
});

test("resolveGroupsForEmail is fail-soft when the response body is not valid JSON", async () => {
  resetEntraGraphCache();
  const fetchImpl = async (url) =>
    url.includes("login.microsoftonline.com") ? { ok: true, status: 200, text: async () => "not json" } : groupsOk(["group-a"]);
  const resolve = createEntraGroupResolver(BASE_ENV, fetchImpl);
  const groups = await resolve("user@example.com");
  assert.equal(groups, null);
});

test("resolveGroupsForEmail is fail-soft when the fetch implementation throws a TimeoutError", async () => {
  resetEntraGraphCache();
  const fetchImpl = async () => {
    const error = new Error("timed out");
    error.name = "TimeoutError";
    throw error;
  };
  const resolve = createEntraGroupResolver(BASE_ENV, fetchImpl);
  const groups = await resolve("user@example.com");
  assert.equal(groups, null);
});

test("resolveGroupsForEmail returns null when the Graph memberOf response has no usable value array", async () => {
  resetEntraGraphCache();
  const fetchImpl = makeFetch({ token: tokenOk, graph: () => mockResponse(200, { notValue: true }) });
  const resolve = createEntraGroupResolver(BASE_ENV, fetchImpl);
  const groups = await resolve("user@example.com");
  assert.equal(groups, null);
});
