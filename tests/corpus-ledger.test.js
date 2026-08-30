import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  buildEntry,
  computeStats,
  measurableEntries,
  nextEntryId,
  renderMarkdown,
  validateLedger
} from "../scripts/lib/corpus-ledger.mjs";

const LEDGER_PATH = path.resolve("docs/compat-corpus/ledger.json");
const VALID_SHA = "a".repeat(64);

function baseLedger(entries = []) {
  return { schemaVersion: 1, updatedAt: "2026-08-30", targets: { total: 100, regression: 20, uat: 80 }, entries };
}

function grantedEntry(overrides = {}) {
  return {
    id: "corpus-001",
    title: "サンプル",
    purpose: "regression",
    scope: "in-scope",
    outOfScopeReason: null,
    source: { organization: "org", sourceRef: "ref-001", receivedAt: "2026-08-30" },
    file: { relativePath: "a/b.dxf", format: "dxf", originalDwgVersion: null, dxfVersion: null, sha256: VALID_SHA, bytes: 100 },
    license: { status: "granted", holder: "", scope: "", grantedBy: "", grantedAt: null, expiresAt: null, evidence: "", redistribution: false, confidential: true },
    contents: { entityCount: null, layerCount: null, hasXref: false, hasDimension: false, hasHatch: false, hasBlock: false, paper: null, scale: null },
    measurement: { lastRunAt: null, mode: null, score: null, grade: null, axisScores: null, criticalFindings: null, reportPath: null },
    notes: "",
    ...overrides
  };
}

test("the current repository ledger.json is valid regardless of entry count", async () => {
  const raw = await readFile(LEDGER_PATH, "utf8");
  const ledger = JSON.parse(raw);
  const result = validateLedger(ledger);
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.ok(Array.isArray(ledger.entries));
});

test("validateLedger rejects a duplicate id", () => {
  const ledger = baseLedger([grantedEntry(), grantedEntry()]);
  const result = validateLedger(ledger);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("重複")));
});

test("validateLedger rejects when regression exceeds the fixed 20-entry cap", () => {
  const overRegression = baseLedger(
    Array.from({ length: 21 }, (_, i) => grantedEntry({ id: `corpus-${String(i + 1).padStart(3, "0")}` }))
  );
  const result = validateLedger(overRegression);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("regression区分")));
});

test("validateLedger rejects when uat exceeds the fixed 80-entry cap", () => {
  const overUat = baseLedger(
    Array.from({ length: 81 }, (_, i) => grantedEntry({ id: `corpus-${String(i + 1).padStart(3, "0")}`, purpose: "uat" }))
  );
  const result = validateLedger(overUat);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("uat区分")));
});

test("validateLedger rejects when total entries exceed the fixed 100-entry cap", () => {
  const overTotal = baseLedger(
    Array.from({ length: 101 }, (_, i) => grantedEntry({ id: `corpus-${String(i + 1).padStart(3, "0")}`, purpose: "reference" }))
  );
  const result = validateLedger(overTotal);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("entries件数")));
});

test("validateLedger rejects a targets value that does not match the fixed Phase 0 caps, preventing a bypass", () => {
  const ledger = { ...baseLedger([]), targets: { total: 1000, regression: 1000, uat: 1000 } };
  const result = validateLedger(ledger);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("Phase 0の固定値")));
});

test("validateLedger requires license.status granted/internal/pending/denied and rejects other values", () => {
  const ledger = baseLedger([grantedEntry({ license: { ...grantedEntry().license, status: "unknown" } })]);
  const result = validateLedger(ledger);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("license.status")));
});

test("validateLedger rejects a file.format other than dxf, matching the Phase 0 ASCII-DXF-only intake policy", () => {
  const ledger = baseLedger([grantedEntry({ file: { ...grantedEntry().file, format: "json" } })]);
  const result = validateLedger(ledger);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("file.format")));
});

test("validateLedger rejects an unparsable license.expiresAt instead of silently treating it as unmeasurable-safe", () => {
  const ledger = baseLedger([grantedEntry({ license: { ...grantedEntry().license, expiresAt: "not-a-date" } })]);
  const result = validateLedger(ledger);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("license.expiresAt")));
});

test("measurableEntries excludes entries whose license is not granted or internal", () => {
  const ledger = baseLedger([
    grantedEntry({ id: "corpus-001", license: { ...grantedEntry().license, status: "granted" } }),
    grantedEntry({ id: "corpus-002", license: { ...grantedEntry().license, status: "pending" } })
  ]);
  const measurable = measurableEntries(ledger);
  assert.equal(measurable.length, 1);
  assert.equal(measurable[0].id, "corpus-001");
});

test("measurableEntries excludes a license that has expired", () => {
  const ledger = baseLedger([
    grantedEntry({ license: { ...grantedEntry().license, status: "granted", expiresAt: "2020-01-01" } })
  ]);
  const measurable = measurableEntries(ledger, new Date("2026-08-30"));
  assert.equal(measurable.length, 0);
});

test("measurableEntries treats an unparsable expiresAt as not measurable rather than as no-expiry", () => {
  const ledger = baseLedger([
    grantedEntry({ license: { ...grantedEntry().license, status: "granted", expiresAt: "not-a-date" } })
  ]);
  const measurable = measurableEntries(ledger, new Date("2026-08-30"));
  assert.equal(measurable.length, 0);
});

test("validateLedger rejects an absolute path or a path containing ..", () => {
  const absolute = baseLedger([grantedEntry({ file: { ...grantedEntry().file, relativePath: "/etc/passwd" } })]);
  assert.equal(validateLedger(absolute).valid, false);
  const traversal = baseLedger([grantedEntry({ file: { ...grantedEntry().file, relativePath: "../secret.dxf" } })]);
  assert.equal(validateLedger(traversal).valid, false);
});

test("validateLedger rejects a sha256 that is not 64 hex characters", () => {
  const ledger = baseLedger([grantedEntry({ file: { ...grantedEntry().file, sha256: "not-a-hash" } })]);
  assert.equal(validateLedger(ledger).valid, false);
});

test("validateLedger requires outOfScopeReason when scope is out-of-scope", () => {
  const ledger = baseLedger([grantedEntry({ scope: "out-of-scope", outOfScopeReason: null })]);
  const result = validateLedger(ledger);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("outOfScopeReason")));

  const withReason = baseLedger([grantedEntry({ scope: "out-of-scope", outOfScopeReason: "3Dソリッドのため対象外" })]);
  assert.equal(validateLedger(withReason).valid, true);
});

test("nextEntryId increments from the highest existing id", () => {
  const ledger = baseLedger([grantedEntry({ id: "corpus-003" }), grantedEntry({ id: "corpus-001" })]);
  assert.equal(nextEntryId(ledger), "corpus-004");
  assert.equal(nextEntryId(baseLedger([])), "corpus-001");
});

test("buildEntry assembles a complete entry with sensible defaults and never stores a raw contact or project field", () => {
  const ledger = baseLedger([]);
  const entry = buildEntry(ledger, { title: "テスト", relativePath: "a.dxf", format: "dxf", sha256: VALID_SHA, bytes: 10 });
  assert.equal(entry.id, "corpus-001");
  assert.equal(entry.purpose, "reference");
  assert.equal(entry.scope, "in-scope");
  assert.equal(entry.license.status, "pending");
  assert.equal(entry.measurement.lastRunAt, null);
  assert.equal("contact" in entry.source, false);
  assert.equal("project" in entry.source, false);
  assert.ok("sourceRef" in entry.source);
});

test("renderMarkdown includes every entry and the summary counts", () => {
  const ledger = baseLedger([grantedEntry()]);
  const markdown = renderMarkdown(ledger);
  assert.match(markdown, /corpus-001/);
  assert.match(markdown, /regression 1\/20/);
});

test("computeStats reports licensed and measurable counts consistent with measurableEntries", () => {
  const ledger = baseLedger([
    grantedEntry({ id: "corpus-001", license: { ...grantedEntry().license, status: "granted" } }),
    grantedEntry({ id: "corpus-002", license: { ...grantedEntry().license, status: "internal" } }),
    grantedEntry({ id: "corpus-003", license: { ...grantedEntry().license, status: "pending" } })
  ]);
  const stats = computeStats(ledger);
  assert.equal(stats.total, 3);
  assert.equal(stats.licensed, 2);
  assert.equal(stats.measurable, 2);
});
