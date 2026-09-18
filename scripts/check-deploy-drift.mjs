#!/usr/bin/env node
// 本番稼働中のコミットがレビュー済みの origin/main と一致しているかを検査する。
//
// 事故(Issue #98)では、本番ホストのローカルmainに未マージのPR #87ブランチのcommitが
// 入ったまま稼働が続き、人手で気づくまで検出できなかった。このスクリプトは
// 「本番が今どのコミットで動いているか」と「origin/mainとどれだけずれているか」を
// 機械的に比較し、ずれがあれば非ゼロ終了する。systemdのtimerから定期実行するほか、
// デプロイ直後の確認コマンドとしても使う。
//
// 使い方:
//   node scripts/check-deploy-drift.mjs                    # ローカルgit情報のみで判定
//   node scripts/check-deploy-drift.mjs --url http://127.0.0.1:18812
//   node scripts/check-deploy-drift.mjs --remote           # origin/mainの最新をls-remoteで確認
//   node scripts/check-deploy-drift.mjs --json
//
// 終了コード: 0=一致, 1=乖離あり, 2=判定不能(git情報なし)
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  DEPLOY_PROVENANCE,
  evaluateDeployProvenance,
  readDeployInfo
} from "./lib/deploy-info.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const useRemote = args.includes("--remote");
const url = readOption("--url") ?? process.env.DEPLOY_HEALTH_URL ?? null;

const evaluation = evaluateDeployProvenance({ cwd: repoRoot });
const remoteMain = useRemote ? readRemoteMain() : null;
const runningCommit = url ? await readRunningCommit(url) : null;

const driftReasons = [...evaluation.reasons];
let extraDrift = false;
if (remoteMain && evaluation.info.commit && remoteMain.commit !== evaluation.info.originMain) {
  driftReasons.push("ローカルのorigin/main参照がリモートより古い可能性があります(git fetchが必要)");
  extraDrift = true;
}
if (runningCommit && evaluation.info.commit && runningCommit !== evaluation.info.commit) {
  driftReasons.push(`稼働APIが報告するcommit(${short(runningCommit)})と作業ツリーのcommit(${short(evaluation.info.commit)})が一致しません`);
  extraDrift = true;
}

const report = {
  checkedAt: new Date().toISOString(),
  local: evaluation.info,
  counts: evaluation.counts,
  status: evaluation.status,
  remoteMain: remoteMain?.commit ?? null,
  runningApiCommit: runningCommit,
  driftReasons
};

const failed =
  evaluation.status === DEPLOY_PROVENANCE.AHEAD ||
  evaluation.status === DEPLOY_PROVENANCE.DIRTY ||
  extraDrift;

if (asJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  printHumanReport(report);
}

if (evaluation.status === DEPLOY_PROVENANCE.UNKNOWN) process.exit(2);
process.exit(failed ? 1 : 0);

function printHumanReport(current) {
  const lines = [];
  lines.push(`デプロイ素性検査: ${current.checkedAt}`);
  lines.push(`  作業ツリー commit : ${current.local.commit ?? "不明"} (${current.local.branch ?? "detached"})`);
  lines.push(`  origin/main      : ${current.local.originMain ?? "未取得"}`);
  lines.push(`  ahead/behind     : ${current.counts ? `${current.counts.ahead} / ${current.counts.behind}` : "不明"}`);
  lines.push(`  未コミット変更    : ${current.local.dirty === null ? "不明" : current.local.dirty ? "あり" : "なし"}`);
  if (current.runningApiCommit) lines.push(`  稼働APIのcommit   : ${current.runningApiCommit}`);
  lines.push(`  判定             : ${label(current.status)}`);
  for (const reason of current.driftReasons) lines.push(`   - ${reason}`);
  process.stdout.write(`${lines.join("\n")}\n`);
}

function label(status) {
  if (status === DEPLOY_PROVENANCE.VERIFIED) return "一致(レビュー済みmainと同一)";
  if (status === DEPLOY_PROVENANCE.BEHIND) return "デプロイ待ち(本番がorigin/mainより遅れ)";
  if (status === DEPLOY_PROVENANCE.AHEAD) return "乖離(未レビューのcommitが稼働している可能性)";
  if (status === DEPLOY_PROVENANCE.DIRTY) return "乖離(未コミット変更が稼働している可能性)";
  return "判定不能";
}

function readOption(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

// リモートのmainを読み取り専用で確認する。ローカルのrefは書き換えない(ls-remoteは
// fetchと違いrefs/remotes配下を更新しない)。
function readRemoteMain() {
  try {
    const output = execFileSync("git", ["ls-remote", "origin", "refs/heads/main"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15000
    }).trim();
    const commit = output.split(/\s+/)[0];
    return commit ? { commit } : null;
  } catch {
    return null;
  }
}

// 稼働中APIの /api/health が報告するcommitを読む。未対応バージョン(古いデプロイ)では
// deployブロックが無いためnullを返し、判定はローカルgit情報のみで継続する。
async function readRunningCommit(baseUrl) {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/health`, {
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return null;
    const body = await response.json();
    const commit = body?.deploy?.commit;
    return typeof commit === "string" && commit.length > 0 ? commit : null;
  } catch {
    return null;
  }
}

function short(commit) {
  return typeof commit === "string" ? commit.slice(0, 7) : String(commit);
}
