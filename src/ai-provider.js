const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 65_536;
const MAX_OUTPUT_TOKENS = 1024;

export class AiProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AiProviderError";
    this.code = code;
  }
}

export function describeAiConfig(env) {
  const provider = env.AI_PROVIDER === "openai" || env.AI_PROVIDER === "anthropic" ? env.AI_PROVIDER : null;
  const apiKey = provider === "openai" ? env.OPENAI_API_KEY : provider === "anthropic" ? env.ANTHROPIC_API_KEY : null;
  const model = typeof env.AI_MODEL === "string" && env.AI_MODEL.trim() ? env.AI_MODEL.trim() : null;
  const enabled = Boolean(provider && apiKey && model);
  return { enabled, provider: enabled ? provider : null, model: enabled ? model : null };
}

export function createAiCompletion(env) {
  const config = describeAiConfig(env);
  if (!config.enabled) return null;
  const apiKey = config.provider === "openai" ? env.OPENAI_API_KEY : env.ANTHROPIC_API_KEY;
  const model = config.model;
  return async function complete(systemPrompt, userMessage, schema) {
    return config.provider === "openai"
      ? completeOpenAi({ apiKey, model, systemPrompt, userMessage, schema })
      : completeAnthropic({ apiKey, model, systemPrompt, userMessage, schema });
  };
}

async function completeOpenAi({ apiKey, model, systemPrompt, userMessage, schema }) {
  const response = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "cad_command_proposal", schema }
      }
    })
  });
  const text = await readLimitedText(response);
  if (!response.ok) throw new AiProviderError("upstream", "AIプロバイダがエラーを返しました。");
  const payload = parseJson(text);
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new AiProviderError("invalid_output", "AIプロバイダの応答形式が不正です。");
  return parseJsonObject(content);
}

async function completeAnthropic({ apiKey, model, systemPrompt, userMessage, schema }) {
  const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      tools: [{ name: "propose_cad_commands", description: "CAD操作コマンドを提案する", input_schema: schema }],
      tool_choice: { type: "tool", name: "propose_cad_commands" }
    })
  });
  const text = await readLimitedText(response);
  if (!response.ok) throw new AiProviderError("upstream", "AIプロバイダがエラーを返しました。");
  const payload = parseJson(text);
  const toolUse = Array.isArray(payload?.content) ? payload.content.find((block) => block?.type === "tool_use") : null;
  if (!toolUse || typeof toolUse.input !== "object" || toolUse.input === null) {
    throw new AiProviderError("invalid_output", "AIプロバイダの応答形式が不正です。");
  }
  return toolUse.input;
}

async function fetchWithTimeout(url, options) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new AiProviderError("timeout", "AIプロバイダへの接続がタイムアウトしました。");
    }
    throw new AiProviderError("upstream", "AIプロバイダへの接続に失敗しました。");
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
      throw new AiProviderError("invalid_output", "AIプロバイダの応答が大きすぎます。");
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

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new AiProviderError("invalid_output", "AIプロバイダの応答を解析できませんでした。");
  }
}

function parseJsonObject(text) {
  const parsed = parseJson(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AiProviderError("invalid_output", "AIプロバイダの応答形式が不正です。");
  }
  return parsed;
}
