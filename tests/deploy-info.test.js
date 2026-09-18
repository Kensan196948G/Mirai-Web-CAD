import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEPLOY_PROVENANCE,
  classifyDeployProvenance,
  evaluateDeployProvenance,
  readCommitCounts,
  readDeployInfo
} from "../scripts/lib/deploy-info.mjs";
import { handleApiRequest } from "../src/api-handler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");

// git呼び出しを差し替え、実リポジトリ状態に依存せずに判定ロジックを固定する。
function fakeGit(table) {
  return (args) => {
    const key = args.join(" ");
    if (key in table) {
      const value = table[key];
      if (value instanceof Error) throw value;
      return value;
    }
    throw new Error(`unexpected git call: ${key}`);
  };
}

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const MAIN = "fedcba9876543210fedcba9876543210fedcba98";

test("readDeployInfo は commit/branch/未コミット有無/origin_main を読み取る", () => {
  const info = readDeployInfo({
    cwd: repoRoot,
    gitRunner: fakeGit({
      "rev-parse HEAD": HEAD,
      "rev-parse --abbrev-ref HEAD": "main",
      "status --porcelain": "",
      "rev-parse --verify origin/main": MAIN
    })
  });
  assert.equal(info.commit, HEAD);
  assert.equal(info.commitShort, HEAD.slice(0, 7));
  assert.equal(info.branch, "main");
  assert.equal(info.dirty, false);
  assert.equal(info.originMain, MAIN);
});

test("readDeployInfo は未コミット変更がある作業ツリーを dirty とする", () => {
  const info = readDeployInfo({
    cwd: repoRoot,
    gitRunner: fakeGit({
      "rev-parse HEAD": HEAD,
      "rev-parse --abbrev-ref HEAD": "main",
      "status --porcelain": " M src/api-handler.js",
      "rev-parse --verify origin/main": MAIN
    })
  });
  assert.equal(info.dirty, true);
});

test("readDeployInfo は git が使えなくても例外を投げず unknown 相当を返す", () => {
  const info = readDeployInfo({
    cwd: repoRoot,
    gitRunner: fakeGit({ "rev-parse HEAD": new Error("git not found") })
  });
  assert.deepEqual(info, { commit: null, commitShort: null, branch: null, dirty: null, originMain: null });
});

test("readDeployInfo は origin/main 参照が無くても commit 自体は返す", () => {
  const info = readDeployInfo({
    cwd: repoRoot,
    gitRunner: fakeGit({
      "rev-parse HEAD": HEAD,
      "rev-parse --abbrev-ref HEAD": "main",
      "status --porcelain": "",
      "rev-parse --verify origin/main": new Error("unknown revision")
    })
  });
  assert.equal(info.commit, HEAD);
  assert.equal(info.originMain, null);
});

test("readCommitCounts は left-right の出力を behind/ahead として解釈する", () => {
  const counts = readCommitCounts({
    cwd: repoRoot,
    gitRunner: fakeGit({
      "rev-parse --verify origin/main": MAIN,
      "rev-list --left-right --count origin/main...HEAD": "2\t4"
    })
  });
  assert.deepEqual(counts, { ahead: 4, behind: 2 });
});

test("readCommitCounts は origin/main 未取得なら null を返す", () => {
  const counts = readCommitCounts({
    cwd: repoRoot,
    gitRunner: fakeGit({ "rev-parse --verify origin/main": new Error("unknown revision") })
  });
  assert.equal(counts, null);
});

test("classifyDeployProvenance は origin/main と一致かつクリーンなら verified", () => {
  const result = classifyDeployProvenance({ commit: HEAD, dirty: false, counts: { ahead: 0, behind: 0 } });
  assert.equal(result.status, DEPLOY_PROVENANCE.VERIFIED);
  assert.deepEqual(result.reasons, []);
});

test("classifyDeployProvenance は origin/main に無い commit が稼働していれば ahead とする", () => {
  const result = classifyDeployProvenance({ commit: HEAD, dirty: false, counts: { ahead: 4, behind: 0 } });
  assert.equal(result.status, DEPLOY_PROVENANCE.AHEAD);
  assert.match(result.reasons.join("\n"), /origin\/mainに存在しないcommitが4件/);
});

test("classifyDeployProvenance は未コミット変更のみでも dirty とする", () => {
  const result = classifyDeployProvenance({ commit: HEAD, dirty: true, counts: { ahead: 0, behind: 0 } });
  assert.equal(result.status, DEPLOY_PROVENANCE.DIRTY);
  assert.match(result.reasons.join("\n"), /未コミットの変更/);
});

test("classifyDeployProvenance は未コミット変更と未マージcommitが併存すれば ahead を優先する", () => {
  const result = classifyDeployProvenance({ commit: HEAD, dirty: true, counts: { ahead: 1, behind: 0 } });
  assert.equal(result.status, DEPLOY_PROVENANCE.AHEAD);
  assert.equal(result.reasons.length, 2);
});

test("classifyDeployProvenance は origin/main が先行しているだけなら behind(デプロイ待ち)とする", () => {
  const result = classifyDeployProvenance({ commit: HEAD, dirty: false, counts: { ahead: 0, behind: 3 } });
  assert.equal(result.status, DEPLOY_PROVENANCE.BEHIND);
  assert.match(result.reasons.join("\n"), /デプロイ待ち/);
});

test("classifyDeployProvenance は commit 不明なら unknown とする", () => {
  const result = classifyDeployProvenance({ commit: null, dirty: null, counts: null });
  assert.equal(result.status, DEPLOY_PROVENANCE.UNKNOWN);
});

test("evaluateDeployProvenance は実リポジトリの素性を判定できる", () => {
  const result = evaluateDeployProvenance({ cwd: repoRoot });
  assert.ok(Object.values(DEPLOY_PROVENANCE).includes(result.status));
  assert.ok(Array.isArray(result.reasons));
  assert.equal(typeof result.info, "object");
});

test("check-deploy-drift は判定不能(exit 2)にならず、実リポジトリのHEADを報告する", () => {
  // 作業ブランチがorigin/mainより先行している場合(開発ブランチ)は意図的にexit 1を返すため、
  // 終了コードは0/1のいずれも許容し、レポートの構造とHEADの一致だけを検証する。
  let stdout;
  let exitCode = 0;
  try {
    stdout = execFileSync(process.execPath, ["scripts/check-deploy-drift.mjs", "--json"], {
      cwd: repoRoot,
      encoding: "utf8"
    });
  } catch (error) {
    exitCode = error.status;
    stdout = error.stdout;
  }
  assert.ok(exitCode === 0 || exitCode === 1, `unexpected exit code: ${exitCode}`);
  const report = JSON.parse(stdout);
  assert.ok(Object.values(DEPLOY_PROVENANCE).includes(report.status));
  assert.equal(typeof report.checkedAt, "string");
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  assert.equal(report.local.commit, head);
});

test("health は稼働commitを deploy ブロックで報告し、余分な内部情報を含めない", async () => {
  const env = {
    AUTH_MODE: "access",
    APP_ENV: "production",
    ACCESS_JWT_VERIFIER: async () => ({ email: "viewer@example.com" }),
    DEPLOY_INFO: { commit: HEAD, branch: "main", dirty: false, filesystemPath: "/secret/path" }
  };
  const response = await handleApiRequest(
    new Request("https://example.test/api/health", { headers: { "cf-access-jwt-assertion": "token" } }),
    env
  );
  const body = await response.json();
  assert.deepEqual(body.deploy, { commit: HEAD, branch: "main", dirty: false });
  assert.equal("filesystemPath" in body.deploy, false);
});

test("health は DEPLOY_INFO 未設定でも deploy ブロックを null で返す", async () => {
  const response = await handleApiRequest(
    new Request("https://example.test/api/health", {
      headers: { "cf-access-jwt-assertion": "token" }
    }),
    { AUTH_MODE: "access", APP_ENV: "production", ACCESS_JWT_VERIFIER: async () => ({ email: "v@example.com" }) }
  );
  const body = await response.json();
  assert.deepEqual(body.deploy, { commit: null, branch: null, dirty: null });
});
