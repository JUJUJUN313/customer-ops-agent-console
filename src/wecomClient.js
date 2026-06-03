function normalizeWebhookUrl(webhookUrl = "") {
  const url = String(webhookUrl || "").trim();
  if (!url) throw new Error("WeCom webhook URL is required");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("WeCom webhook must use https");
  if (!parsed.searchParams.get("key")) throw new Error("WeCom webhook key is required");
  return parsed.toString();
}

function cleanText(value = "", maxLength = 4000) {
  return String(value || "").trim().slice(0, maxLength);
}

export function maskWebhookUrl(webhookUrl = "") {
  const url = String(webhookUrl || "");
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const key = parsed.searchParams.get("key") || "";
    if (!key) return `${parsed.origin}${parsed.pathname}?key=********`;
    const masked = key.length <= 8 ? "********" : `${key.slice(0, 4)}********${key.slice(-4)}`;
    parsed.searchParams.set("key", masked);
    return parsed.toString();
  } catch {
    return "已配置Webhook";
  }
}

export async function sendWecomGroupRobotMessage(config = {}, payload = {}, options = {}) {
  const webhookUrl = normalizeWebhookUrl(config.webhookUrl);
  const msgtype = payload.msgtype === "text" ? "text" : "markdown";
  const content = cleanText(payload.content);
  if (!content) throw new Error("WeCom message content is required");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!fetchImpl) {
    clearTimeout(timeout);
    throw new Error("fetch is not available");
  }

  const body = msgtype === "text"
    ? {
        msgtype,
        text: {
          content,
          mentioned_list: payload.mentionedList || [],
          mentioned_mobile_list: payload.mentionedMobileList || []
        }
      }
    : {
        msgtype,
        markdown: { content }
      };

  const startedAt = Date.now();
  try {
    const response = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const raw = await response.text();
    let result = {};
    try {
      result = raw ? JSON.parse(raw) : {};
    } catch {
      result = { raw };
    }
    if (!response.ok) throw new Error(result.errmsg || `WeCom webhook HTTP ${response.status}`);
    if (Number(result.errcode || 0) !== 0) throw new Error(result.errmsg || `WeCom webhook errcode ${result.errcode}`);
    return {
      ok: true,
      provider: "wecom-group-robot",
      msgtype,
      response: result,
      latencyMs: Date.now() - startedAt
    };
  } finally {
    clearTimeout(timeout);
  }
}
