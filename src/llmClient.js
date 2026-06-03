export function chatCompletionsUrl(apiUrl = "") {
  const base = String(apiUrl || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("LLM API URL is required");
  if (/\/chat\/completions$/i.test(base)) return base;
  return `${base}/chat/completions`;
}

export async function invokeChatCompletion(modelConfig, messages, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("Fetch API is not available");
  const apiUrl = chatCompletionsUrl(modelConfig.apiUrl);
  const apiKey = String(modelConfig.apiKey || "").trim();
  if (!apiKey) throw new Error("LLM API Key is required");
  if (!modelConfig.model) throw new Error("LLM model is required");

  const timeoutMs = Number(options.timeoutMs || 25000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetchImpl(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelConfig.model,
        messages,
        temperature: Number(modelConfig.temperature ?? 0.2),
        max_tokens: Math.max(1, Math.min(Number(modelConfig.maxTokens || 1024), Number(options.maxTokens || 1200)))
      }),
      signal: controller.signal
    });

    const raw = await response.text();
    let payload = {};
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = { raw };
      }
    }

    if (!response.ok) {
      const detail = payload?.error?.message || payload?.message || raw || `HTTP ${response.status}`;
      throw new Error(`LLM request failed: ${response.status} ${String(detail).slice(0, 500)}`);
    }

    const content = payload?.choices?.[0]?.message?.content || payload?.choices?.[0]?.text || "";
    if (!String(content).trim()) throw new Error("LLM response did not include text content");

    return {
      content: String(content).trim(),
      usage: payload.usage || null,
      latencyMs: Date.now() - startedAt,
      endpoint: apiUrl
    };
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`LLM request timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
