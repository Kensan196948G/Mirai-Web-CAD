import { readFile } from "node:fs/promises";

const files = [
  "infra/cloudflare/main.tf",
  "infra/cloudflare/variables.tf",
  "infra/cloudflare/versions.tf"
];
const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
const failures = [];

for (const required of [
  'prevent_destroy = true',
  'decision   = "allow"',
  'email = lower(trimspace(var.mvp_allowed_email))',
  '"kensan1969@gmail.com"',
  'config_src = "local"',
  "default     = false",
  "Refusing management until all existing Access and DNS IDs have been inventoried."
]) {
  if (!source.includes(required)) failures.push(`missing guardrail: ${required}`);
}

for (const forbidden of [
  /decision\s*=\s*"bypass"/,
  /decision\s*=\s*"service_auth"/,
  /\beveryone\s*=/,
  /\bemail_domain\s*=/,
  /tunnel_secret\s*=/,
  /api_token\s*=/
]) {
  if (forbidden.test(source)) failures.push(`forbidden Cloudflare setting: ${forbidden}`);
}

const destroyGuards = source.match(/prevent_destroy\s*=\s*true/g)?.length ?? 0;
if (destroyGuards < 3) failures.push("Tunnel, DNS, and Access resources must all prevent destroy");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Cloudflare IaC guardrails ok");
