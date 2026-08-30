#!/usr/bin/env node
// 100図面台帳(docs/compat-corpus/ledger.json)を操作するCLI。argvパースとファイルI/Oのみを
// 担い、検証・集計ロジックはscripts/lib/corpus-ledger.mjsの純関数を呼び出す。
//
// 使い方:
//   node scripts/corpus-ledger.mjs add --file=<path> --title=... --purpose=regression \
//        --license-status=pending [--write]   (既定はdry-run、標準出力へ表示のみ)
//   node scripts/corpus-ledger.mjs validate
//   node scripts/corpus-ledger.mjs stats
//   node scripts/corpus-ledger.mjs render
//   node scripts/corpus-ledger.mjs verify-files   (MIRAI_CORPUS_DIR未設定時はskip)
import { readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { buildEntry, computeStats, renderMarkdown, validateLedger } from "./lib/corpus-ledger.mjs";

const LEDGER_PATH = path.resolve("docs/compat-corpus/ledger.json");

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (command === "validate") return runValidate();
  if (command === "stats") return runStats();
  if (command === "render") return runRender();
  if (command === "add") return runAdd(args);
  if (command === "verify-files") return runVerifyFiles();

  console.error("使い方: node scripts/corpus-ledger.mjs <add|validate|stats|render|verify-files> [options]");
  return 1;
}

async function loadLedger() {
  const raw = await readFile(LEDGER_PATH, "utf8");
  return JSON.parse(raw);
}

async function runValidate() {
  const ledger = await loadLedger();
  const result = validateLedger(ledger);
  if (!result.valid) {
    console.error(result.errors.join("\n"));
    return 1;
  }
  console.log(`ledger OK: ${ledger.entries.length}件`);
  return 0;
}

async function runStats() {
  const ledger = await loadLedger();
  console.log(JSON.stringify(computeStats(ledger), null, 2));
  return 0;
}

async function runRender() {
  const ledger = await loadLedger();
  console.log(renderMarkdown(ledger));
  return 0;
}

async function runAdd(args) {
  if (!args.file) {
    console.error("エラー: --fileが必要です");
    return 1;
  }
  const ledger = await loadLedger();
  const fileStat = await stat(args.file);
  const content = await readFile(args.file);
  const sha256 = createHash("sha256").update(content).digest("hex");
  const corpusDir = process.env.MIRAI_CORPUS_DIR;
  const relativePath = corpusDir ? path.relative(corpusDir, path.resolve(args.file)) : path.basename(args.file);

  const entry = buildEntry(ledger, {
    title: args.title ?? "",
    purpose: args.purpose ?? "reference",
    scope: args.scope ?? "in-scope",
    outOfScopeReason: args["out-of-scope-reason"] ?? null,
    organization: args.organization,
    sourceRef: args["source-ref"],
    licenseStatus: args["license-status"] ?? "pending",
    licenseHolder: args.holder,
    relativePath,
    format: path.extname(args.file).slice(1).toLowerCase(),
    sha256,
    bytes: fileStat.size
  });

  const nextLedger = {
    ...ledger,
    updatedAt: new Date().toISOString().slice(0, 10),
    entries: [...ledger.entries, entry]
  };
  const validation = validateLedger(nextLedger);
  if (!validation.valid) {
    console.error(validation.errors.join("\n"));
    return 1;
  }

  if (args.write) {
    await writeFile(LEDGER_PATH, `${JSON.stringify(nextLedger, null, 2)}\n`);
    console.log(`追加しました: ${entry.id}`);
  } else {
    console.log("dry-run(--writeで実際に台帳へ追記します):");
    console.log(JSON.stringify(entry, null, 2));
  }
  return 0;
}

async function runVerifyFiles() {
  const ledger = await loadLedger();
  const validation = validateLedger(ledger);
  if (!validation.valid) {
    console.error(validation.errors.join("\n"));
    return 1;
  }
  const corpusDir = process.env.MIRAI_CORPUS_DIR;
  if (!corpusDir) {
    console.log("MIRAI_CORPUS_DIRが未設定のため実体検証をスキップしました。");
    return 0;
  }
  let failures = 0;
  for (const entry of ledger.entries) {
    const filePath = path.join(corpusDir, entry.file.relativePath);
    try {
      const content = await readFile(filePath);
      const sha256 = createHash("sha256").update(content).digest("hex");
      if (sha256 !== entry.file.sha256) {
        console.error(`${entry.id}: sha256が一致しません (${filePath})`);
        failures += 1;
      }
    } catch {
      console.error(`${entry.id}: ファイルが見つかりません (${filePath})`);
      failures += 1;
    }
  }
  if (failures > 0) return 1;
  console.log(`verify-files OK: ${ledger.entries.length}件`);
  return 0;
}

function parseArgs(argv) {
  const args = {};
  for (const token of argv) {
    if (token === "--write") {
      args.write = true;
      continue;
    }
    const match = token.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`エラー: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
