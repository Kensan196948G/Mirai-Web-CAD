import { readdir, readFile } from "node:fs/promises";
import hcl from "hcl2-parser";

const terraformDir = "infra/cloudflare";
const terraformFiles = (await readdir(terraformDir))
  .filter((file) => file.endsWith(".tf"))
  .sort();
const documents = [];
const failures = [];

for (const file of terraformFiles) {
  const [document, diagnostics] = hcl.parseToObject(
    await readFile(`${terraformDir}/${file}`, "utf8")
  );
  if (diagnostics) {
    failures.push(`${file}: HCL parse failed: ${JSON.stringify(diagnostics)}`);
    continue;
  }
  documents.push(document);
}

const resources = Object.assign({}, ...documents.map((document) => document.resource ?? {}));
const variables = Object.assign({}, ...documents.map((document) => document.variable ?? {}));
const locals = Object.assign({}, ...documents.flatMap((document) => document.locals ?? []));
const imports = documents.flatMap((document) => document.import ?? []);

function requireCondition(condition, message) {
  if (!condition) failures.push(message);
}

function expression(value) {
  return String(value ?? "")
    .replace(/^\$\{([\s\S]*)\}$/, "$1")
    .replace(/\s+/g, "");
}

function resource(type, name) {
  const block = resources[type]?.[name]?.[0];
  requireCondition(Boolean(block), `missing resource: ${type}.${name}`);
  return block ?? {};
}

function variable(name) {
  const block = variables[name]?.[0];
  requireCondition(Boolean(block), `missing variable: ${name}`);
  return block ?? {};
}

function requireManagedCondition(value, label) {
  const parsed = expression(value);
  requireCondition(
    parsed.includes("var.enable_management") && parsed.includes("local.inventory_ready"),
    `${label}: must require enable_management and inventory_ready`
  );
}

function requireDestroyGuard(block, label) {
  requireCondition(
    block.lifecycle?.[0]?.prevent_destroy === true,
    `${label}: lifecycle.prevent_destroy must be true`
  );
}

const tunnel = resource("cloudflare_zero_trust_tunnel_cloudflared", "mirai_web_cad");
requireManagedCondition(tunnel.count, "Tunnel resource");
requireCondition(tunnel.account_id === "${var.account_id}", "Tunnel: account_id must use var.account_id");
requireCondition(tunnel.name === "mirai-web-cad", "Tunnel: unexpected name");
requireCondition(tunnel.config_src === "local", "Tunnel: config_src must remain local");
requireDestroyGuard(tunnel, "Tunnel resource");

const dns = resource("cloudflare_dns_record", "tunnel");
requireManagedCondition(dns.for_each, "DNS resource");
requireCondition(dns.zone_id === "${var.zone_id}", "DNS: zone_id must use var.zone_id");
requireCondition(dns.type === "CNAME", "DNS: record type must remain CNAME");
requireCondition(dns.content === "${local.tunnel_hostname}", "DNS: content must target the managed tunnel");
requireCondition(dns.proxied === true, "DNS: proxy must remain enabled");
requireDestroyGuard(dns, "DNS resource");

const access = resource("cloudflare_zero_trust_access_application", "mvp");
requireManagedCondition(access.count, "Access resource");
requireCondition(access.account_id === "${var.account_id}", "Access: account_id must use var.account_id");
requireCondition(access.domain === "mirai-web-cad-mvp.mirai-dx-platform.com", "Access: unexpected domain");
requireCondition(access.type === "self_hosted", "Access: application must remain self_hosted");
requireDestroyGuard(access, "Access resource");

const policies = access.policies ?? [];
requireCondition(policies.length === 1, "Access: exactly one inline policy is required");
const policy = policies[0] ?? {};
requireCondition(policy.id === "${var.mvp_access_policy_id}", "Access: existing policy ID must be retained");
requireCondition(policy.decision === "allow", "Access: policy decision must be allow");
requireCondition(policy.precedence === 1, "Access: allow policy must have precedence 1");
requireCondition(policy.include?.length === 1, "Access: policy must have exactly one include rule");
requireCondition(
  policy.include?.[0]?.email?.email === "${lower(trimspace(var.mvp_allowed_email))}",
  "Access: include rule must use the exact allowed email variable"
);
requireCondition(policy.exclude?.length === 0, "Access: exclude rules are not permitted");
requireCondition(policy.require?.length === 0, "Access: require rules are not configured for this MVP");

const managementGuard = resource("terraform_data", "management_guard");
requireCondition(
  expression(managementGuard.count) === "var.enable_management?1:0",
  "management guard must activate whenever management is enabled"
);
requireCondition(
  expression(managementGuard.lifecycle?.[0]?.precondition?.[0]?.condition).includes("local.inventory_ready"),
  "management guard must refuse incomplete inventory"
);

const enabled = variable("enable_management");
requireCondition(enabled.default === false, "enable_management must default to false");
const allowedEmail = variable("mvp_allowed_email");
requireCondition(
  allowedEmail.default === "kensan1969@gmail.com",
  "MVP access must default to kensan1969@gmail.com"
);
for (const idVariable of [
  "mvp_access_application_id",
  "mvp_access_policy_id",
  "mvp_dns_record_id",
  "production_dns_record_id"
]) {
  requireCondition(variable(idVariable).default === "", `${idVariable}: default must stay empty`);
  requireCondition(
    expression(locals.inventory_ready).includes(`var.${idVariable}`),
    `inventory_ready must validate ${idVariable}`
  );
}

const expectedImports = new Map([
  ["cloudflare_zero_trust_tunnel_cloudflared.mirai_web_cad[0]", {
    variables: ["var.tunnel_id"],
    id: '"${var.account_id}/${each.value}"'
  }],
  ["cloudflare_dns_record.tunnel[each.key]", {
    variables: ["var.mvp_dns_record_id", "var.production_dns_record_id"],
    id: '"${var.zone_id}/${each.value}"'
  }],
  ["cloudflare_zero_trust_access_application.mvp[0]", {
    variables: ["var.mvp_access_application_id"],
    id: '"accounts/${var.account_id}/${each.value}"'
  }]
]);
requireCondition(imports.length === expectedImports.size, "exactly three import blocks are required");
for (const block of imports) {
  const target = expression(block.to);
  const expected = expectedImports.get(target);
  requireCondition(Boolean(expected), `unexpected import target: ${target}`);
  requireManagedCondition(block.for_each, `Import ${target}`);
  if (expected) {
    for (const idVariable of expected.variables) {
      requireCondition(
        expression(block.for_each).includes(idVariable),
        `Import ${target}: for_each must use ${idVariable}`
      );
    }
    requireCondition(JSON.stringify(block.id) === expected.id, `Import ${target}: unexpected import ID`);
  }
  expectedImports.delete(target);
}
for (const target of expectedImports.keys()) failures.push(`missing import target: ${target}`);

function rejectForbidden(value, path = "root") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectForbidden(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (["everyone", "email_domain", "tunnel_secret", "api_token"].includes(key)) {
      failures.push(`${path}.${key}: forbidden Cloudflare setting`);
    }
    if (key === "decision" && ["bypass", "service_auth"].includes(item)) {
      failures.push(`${path}.${key}: forbidden Access decision ${item}`);
    }
    rejectForbidden(item, `${path}.${key}`);
  }
}
documents.forEach((document, index) => rejectForbidden(document, terraformFiles[index]));

if (failures.length > 0) {
  console.error([...new Set(failures)].join("\n"));
  process.exit(1);
}

console.log(`Cloudflare IaC guardrails ok (${terraformFiles.length} HCL files parsed)`);
