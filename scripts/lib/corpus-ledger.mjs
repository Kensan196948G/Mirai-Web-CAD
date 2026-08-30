// 80-90%代替方針Phase 0「100図面の台帳と利用許諾が存在する」に対応する台帳の純関数群。
// ファイルI/Oはscripts/corpus-ledger.mjs(CLI)側に閉じ込め、このファイルはNode標準の
// テスト(tests/corpus-ledger.test.js)から直接importして検証できる状態を保つ。
//
// 実図面はリポジトリにコミットしない。台帳が持つのはrelativePath+sha256+統計値のみで、
// 実体はMIRAI_CORPUS_DIR環境変数が指すローカルディレクトリに置く運用とする(著作権・
// 機密保持のため)。
import path from "node:path";

const ID_PATTERN = /^corpus-(\d{3})$/;
const PURPOSES = ["regression", "uat", "reference"];
const SCOPES = ["in-scope", "out-of-scope"];
const LICENSE_STATUSES = ["granted", "pending", "denied", "internal"];
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
// Phase 0はASCII DXFのみ受入。DWGは恒久的に対象外(ADR-0002)。
const ALLOWED_FORMATS = ["dxf"];
// Phase 0の固定枠。ledger.targetsがこれと異なる場合は無効とし、20/80/100の上限判定にも
// 常にこの固定値のみを用いる(ledger.targetsを不正な値に書き換えて上限判定を回避できない
// ようにするため、ユーザー入力由来のtargetsを上限計算に直接使わない)。
const PHASE0_TARGETS = Object.freeze({ total: 100, regression: 20, uat: 80 });

export function validateLedger(ledger) {
  const errors = [];

  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger)) {
    return { valid: false, errors: ["ledgerはオブジェクトである必要があります。"] };
  }
  if (ledger.schemaVersion !== 1) errors.push("schemaVersionは1である必要があります。");
  if (!Array.isArray(ledger.entries)) {
    errors.push("entriesは配列である必要があります。");
    return { valid: errors.length === 0, errors };
  }

  if (ledger.targets !== undefined) {
    const targets = ledger.targets;
    const matchesPhase0 =
      targets &&
      typeof targets === "object" &&
      targets.total === PHASE0_TARGETS.total &&
      targets.regression === PHASE0_TARGETS.regression &&
      targets.uat === PHASE0_TARGETS.uat;
    if (!matchesPhase0) {
      errors.push(
        `targetsはPhase 0の固定値(total:${PHASE0_TARGETS.total}, regression:${PHASE0_TARGETS.regression}, uat:${PHASE0_TARGETS.uat})と一致する必要があります。`
      );
    }
  }

  const ids = new Set();
  let regressionCount = 0;
  let uatCount = 0;

  ledger.entries.forEach((entry, index) => {
    const prefix = `entries[${index}]`;
    if (!entry || typeof entry !== "object") {
      errors.push(`${prefix}: オブジェクトである必要があります。`);
      return;
    }

    if (typeof entry.id !== "string" || !ID_PATTERN.test(entry.id)) {
      errors.push(`${prefix}.id: "corpus-NNN"形式である必要があります: ${entry.id}`);
    } else if (ids.has(entry.id)) {
      errors.push(`${prefix}.id: 重複しています: ${entry.id}`);
    } else {
      ids.add(entry.id);
    }

    if (!PURPOSES.includes(entry.purpose)) {
      errors.push(`${prefix}.purpose: ${PURPOSES.join("|")}のいずれかである必要があります: ${entry.purpose}`);
    } else if (entry.purpose === "regression") {
      regressionCount += 1;
    } else if (entry.purpose === "uat") {
      uatCount += 1;
    }

    if (!SCOPES.includes(entry.scope)) {
      errors.push(`${prefix}.scope: ${SCOPES.join("|")}のいずれかである必要があります: ${entry.scope}`);
    }
    if (entry.scope === "out-of-scope" && !entry.outOfScopeReason) {
      errors.push(`${prefix}.outOfScopeReason: scope=out-of-scopeの場合は必須です。`);
    }

    const relativePath = entry.file?.relativePath;
    if (typeof relativePath !== "string" || !relativePath) {
      errors.push(`${prefix}.file.relativePath: 必須です。`);
    } else if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes("..")) {
      errors.push(`${prefix}.file.relativePath: 絶対パスまたは".."を含めることはできません: ${relativePath}`);
    } else if (!relativePath.toLowerCase().endsWith(".dxf")) {
      errors.push(`${prefix}.file.relativePath: Phase 0は.dxf拡張子のみ受入です: ${relativePath}`);
    }

    if (typeof entry.file?.sha256 !== "string" || !SHA256_PATTERN.test(entry.file.sha256)) {
      errors.push(`${prefix}.file.sha256: 64桁の16進数である必要があります。`);
    }

    if (!ALLOWED_FORMATS.includes(entry.file?.format)) {
      errors.push(`${prefix}.file.format: Phase 0は${ALLOWED_FORMATS.join("|")}のみ受入です: ${entry.file?.format}`);
    }

    if (!LICENSE_STATUSES.includes(entry.license?.status)) {
      errors.push(`${prefix}.license.status: ${LICENSE_STATUSES.join("|")}のいずれかである必要があります: ${entry.license?.status}`);
    }
    if (entry.license?.expiresAt != null && Number.isNaN(new Date(entry.license.expiresAt).getTime())) {
      errors.push(`${prefix}.license.expiresAt: 有効な日付である必要があります: ${entry.license.expiresAt}`);
    }
  });

  if (regressionCount > PHASE0_TARGETS.regression) {
    errors.push(`regression区分が上限(${PHASE0_TARGETS.regression})を超えています: ${regressionCount}件`);
  }
  if (uatCount > PHASE0_TARGETS.uat) {
    errors.push(`uat区分が上限(${PHASE0_TARGETS.uat})を超えています: ${uatCount}件`);
  }
  if (ledger.entries.length > PHASE0_TARGETS.total) {
    errors.push(`entries件数が上限(${PHASE0_TARGETS.total})を超えています: ${ledger.entries.length}件`);
  }

  return { valid: errors.length === 0, errors };
}

// 測定対象(採点を回せる)entryのみを返す。scope=in-scope かつ
// license.statusがgranted/internal かつ 許諾が期限切れでないもの。
// 完了基準「利用許諾が存在する」を機械検査可能にする核心。
export function measurableEntries(ledger, now = new Date()) {
  return ledger.entries.filter((entry) => isMeasurable(entry, now));
}

function isMeasurable(entry, now) {
  if (entry.scope !== "in-scope") return false;
  const status = entry.license?.status;
  if (status !== "granted" && status !== "internal") return false;
  const expiresAt = entry.license?.expiresAt;
  if (expiresAt) {
    const expiryTime = new Date(expiresAt).getTime();
    // 不正な日付(NaN)は「無期限」として扱わず、安全側(測定対象外)に倒す。
    if (Number.isNaN(expiryTime) || expiryTime < now.getTime()) return false;
  }
  return true;
}

export function computeStats(ledger, now = new Date()) {
  const entries = ledger.entries ?? [];
  const targets = PHASE0_TARGETS;
  const regression = entries.filter((entry) => entry.purpose === "regression").length;
  const uat = entries.filter((entry) => entry.purpose === "uat").length;
  const reference = entries.filter((entry) => entry.purpose === "reference").length;
  const licensed = entries.filter((entry) => entry.license?.status === "granted" || entry.license?.status === "internal").length;
  const measurable = measurableEntries(ledger, now).length;
  const measured = entries.filter((entry) => Boolean(entry.measurement?.lastRunAt)).length;
  return { total: entries.length, targets, regression, uat, reference, licensed, measurable, measured };
}

export function renderMarkdown(ledger) {
  const stats = computeStats(ledger);
  const summary = `件数: ${stats.total} (regression ${stats.regression}/${stats.targets.regression}, uat ${stats.uat}/${stats.targets.uat}) / 許諾済み ${stats.licensed} / 測定可能 ${stats.measurable} / 測定済み ${stats.measured}`;
  const header = "| ID | Title | Purpose | Scope | License | Grade | Score |";
  const separator = "| --- | --- | --- | --- | --- | --- | --- |";
  const rows = ledger.entries.map(
    (entry) =>
      `| ${entry.id} | ${escapeCell(entry.title)} | ${entry.purpose} | ${entry.scope} | ${entry.license?.status ?? "-"} | ${entry.measurement?.grade ?? "-"} | ${entry.measurement?.score ?? "-"} |`
  );
  return [summary, "", header, separator, ...rows].join("\n");
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|");
}

// ファイル拡張子とfile.formatが"dxf"を名乗っていても、実体がバイナリ(例: DWGを単に
// リネームしたもの)であれば台帳へ登録させない。ASCII DXFは常にプレーンテキストで
// "SECTION"...."EOF"というgroup code構造を持つ一方、バイナリDWGはNULバイトを含む。
// この実体検証はscripts/corpus-ledger.mjs(CLI)のadd/verify-filesから呼び出す。
export function isAsciiDxfContent(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (bytes.length === 0) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return false;
  }
  const text = bytes.toString("utf8");
  return /\bSECTION\b/.test(text) && /\bEOF\b/.test(text);
}

export function nextEntryId(ledger) {
  const numbers = ledger.entries
    .map((entry) => Number(entry.id?.match(ID_PATTERN)?.[1]))
    .filter((value) => Number.isFinite(value));
  const next = numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
  return `corpus-${String(next).padStart(3, "0")}`;
}

export function buildEntry(ledger, fields) {
  return {
    id: fields.id ?? nextEntryId(ledger),
    title: fields.title ?? "",
    purpose: fields.purpose ?? "reference",
    scope: fields.scope ?? "in-scope",
    outOfScopeReason: fields.outOfScopeReason ?? null,
    // 連絡先・案件名等の個人・案件識別情報は、公開git履歴に永続化される台帳へは保存しない。
    // 詳細はアクセス制御された外部の許諾記録側で管理し、ここにはその参照IDのみを置く。
    source: {
      organization: fields.organization ?? "",
      sourceRef: fields.sourceRef ?? "",
      receivedAt: fields.receivedAt ?? new Date().toISOString().slice(0, 10)
    },
    file: {
      relativePath: fields.relativePath,
      format: fields.format,
      dxfVersion: fields.dxfVersion ?? null,
      sha256: fields.sha256,
      bytes: fields.bytes
    },
    license: {
      status: fields.licenseStatus ?? "pending",
      holder: fields.licenseHolder ?? "",
      scope: fields.licenseScope ?? "",
      grantedBy: fields.grantedBy ?? "",
      grantedAt: fields.grantedAt ?? null,
      expiresAt: fields.expiresAt ?? null,
      evidence: fields.evidence ?? "",
      redistribution: fields.redistribution ?? false,
      confidential: fields.confidential ?? true
    },
    contents: {
      entityCount: fields.entityCount ?? null,
      layerCount: fields.layerCount ?? null,
      hasXref: fields.hasXref ?? false,
      hasDimension: fields.hasDimension ?? false,
      hasHatch: fields.hasHatch ?? false,
      hasBlock: fields.hasBlock ?? false,
      paper: fields.paper ?? null,
      scale: fields.scale ?? null
    },
    measurement: {
      lastRunAt: null,
      mode: null,
      score: null,
      grade: null,
      axisScores: null,
      criticalFindings: null,
      reportPath: null
    },
    notes: fields.notes ?? ""
  };
}
