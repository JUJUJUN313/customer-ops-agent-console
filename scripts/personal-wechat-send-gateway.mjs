#!/usr/bin/env node
const apiBase = process.env.CUSTOMER_OPS_API || "http://127.0.0.1:5175";
const once = process.argv.includes("--once");
const check = process.argv.includes("--check");
const receiveOnly = process.argv.includes("--receive-only");
const sendOnly = process.argv.includes("--send-only");
const pollIntervalMs = Number(process.env.PERSONAL_WECHAT_GATEWAY_INTERVAL_MS || 3000);
const pullLimit = Number(process.env.PERSONAL_WECHAT_GATEWAY_PULL_LIMIT || 50);

async function api(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }
  if (!response.ok) throw new Error(payload.error || `API ${path} failed: ${response.status}`);
  return payload;
}

async function sidecarPost(gateway, job) {
  const endpoint = `${String(gateway.sidecarUrl || "").replace(/\/+$/, "")}${gateway.sendEndpoint || "/send"}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jobId: job.jobId,
      accountId: job.accountId,
      roomId: job.roomId,
      roomName: job.roomName,
      text: job.replyText,
      triggerMessageIds: job.triggerMessageIds || [],
      source: job.source || "personal-wechat"
    })
  });
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }
  if (!response.ok) throw new Error(payload.error || `Sidecar send failed: ${response.status}`);
  return payload;
}

function sidecarEndpoint(gateway, endpoint) {
  return `${String(gateway.sidecarUrl || "").replace(/\/+$/, "")}${endpoint || ""}`;
}

async function sidecarPull(config, gateway) {
  const endpoint = sidecarEndpoint(gateway, gateway.receiveEndpoint || "/messages");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId: config.account?.id || "",
      cursor: gateway.cursor || "",
      limit: pullLimit
    })
  });
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }
  if (!response.ok) throw new Error(payload.error || `Sidecar pull failed: ${response.status}`);
  return payload;
}

async function sidecarAck(config, gateway, ackPayload) {
  if (!gateway.supportsAck) return { skipped: true };
  const endpoint = sidecarEndpoint(gateway, gateway.ackEndpoint || "/ack");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId: config.account?.id || "",
      ...ackPayload
    })
  });
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }
  if (!response.ok) throw new Error(payload.error || `Sidecar ack failed: ${response.status}`);
  return payload;
}

function firstValue(source, keys, fallback = "") {
  for (const key of keys) {
    if (source?.[key] !== undefined && source[key] !== null && source[key] !== "") return source[key];
  }
  return fallback;
}

function normalizeInboundMessage(message = {}) {
  const msgType = String(firstValue(message, ["msgType", "type", "messageType"], "text"));
  const text = msgType === "text"
    ? String(firstValue(message, ["text", "content", "message"], ""))
    : String(firstValue(message, ["text", "content", "message"], `[${msgType}消息]`));
  return {
    messageId: String(firstValue(message, ["messageId", "msgid", "msgId", "id"], `pwx_sidecar_${Date.now()}`)),
    roomId: String(firstValue(message, ["roomId", "chatId", "chatid", "conversationId"], "")),
    roomName: String(firstValue(message, ["roomName", "chatName", "conversationName"], "")),
    senderId: String(firstValue(message, ["senderId", "fromId", "from"], "")),
    senderName: String(firstValue(message, ["senderName", "fromName", "name"], "未知发送人")),
    senderType: String(firstValue(message, ["senderType", "senderRoleType"], "customer")),
    msgType,
    text,
    sendAt: String(firstValue(message, ["sendAt", "timestamp", "createdAt"], new Date().toISOString())),
    source: String(firstValue(message, ["source"], "personal-wechat"))
  };
}

function extractMessages(payload = {}) {
  const rawMessages = Array.isArray(payload.messages)
    ? payload.messages
    : Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.items)
        ? payload.items
        : [];
  return rawMessages.map(normalizeInboundMessage).filter((message) => message.roomId && message.messageId);
}

function extractConfirmations(payload = {}) {
  const rawConfirmations = Array.isArray(payload.confirmations) ? payload.confirmations : [];
  const rawMessages = Array.isArray(payload.messages)
    ? payload.messages
    : Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.items)
        ? payload.items
        : [];
  const messageConfirmations = rawMessages
    .filter((message) => ["managed_account", "bot"].includes(message.senderType) && (message.jobId || message.echoOfJobId || message.sendJobId))
    .map((message) => ({
      jobId: message.jobId || message.echoOfJobId || message.sendJobId,
      confirmedMessageId: message.messageId || message.msgid || message.id
    }));
  return [...rawConfirmations, ...messageConfirmations]
    .map((item) => ({
      jobId: String(firstValue(item, ["jobId", "sendJobId", "echoOfJobId"], "")),
      confirmedMessageId: String(firstValue(item, ["confirmedMessageId", "messageId", "msgid", "externalMessageId"], "")),
      now: String(firstValue(item, ["now", "confirmedAt", "sendAt"], new Date().toISOString()))
    }))
    .filter((item) => item.jobId);
}

async function pullInbound(config, gateway) {
  if (gateway.mode !== "sidecar" || gateway.canReceive !== true || sendOnly) return { pulled: 0, acked: 0, confirmations: 0 };
  const payload = await sidecarPull(config, gateway);
  const messages = extractMessages(payload);
  const confirmations = extractConfirmations(payload);
  let pulled = 0;
  let confirmed = 0;
  for (const confirmation of confirmations) {
    try {
      await api(`/api/personal-wechat/send-jobs/${encodeURIComponent(confirmation.jobId)}/confirm`, {
        method: "POST",
        body: JSON.stringify({
          confirmedMessageId: confirmation.confirmedMessageId,
          now: confirmation.now
        })
      });
      confirmed += 1;
      console.log(`confirmed ${confirmation.jobId}`);
    } catch (error) {
      console.error(`confirm failed ${confirmation.jobId}: ${error.message}`);
    }
  }
  for (const message of messages) {
    if (["managed_account", "bot"].includes(message.senderType) && confirmations.some((item) => item.confirmedMessageId === message.messageId)) {
      continue;
    }
    await api("/api/personal-wechat/inbound", {
      method: "POST",
      body: JSON.stringify(message)
    });
    pulled += 1;
    console.log(`inbound ${message.roomId} ${message.messageId}`);
  }
  const cursor = payload.nextCursor || payload.cursor || messages.at(-1)?.messageId || gateway.cursor || "";
  let acked = 0;
  if (messages.length || cursor !== gateway.cursor) {
    await api("/api/personal-wechat/gateway/status", {
      method: "POST",
      body: JSON.stringify({
        status: "Sidecar消息已拉取",
        cursor,
        lastPulledAt: new Date().toISOString(),
        detail: `拉取${messages.length}条，确认${confirmed}条`
      })
    });
  }
  if (messages.length && gateway.supportsAck) {
    await sidecarAck(config, gateway, {
      cursor,
      messageIds: messages.map((message) => message.messageId)
    });
    acked = messages.length;
    await api("/api/personal-wechat/gateway/status", {
      method: "POST",
      body: JSON.stringify({
        status: "Sidecar消息已ACK",
        cursor,
        lastAckAt: new Date().toISOString(),
        detail: `ACK ${acked} 条个人微信消息`
      })
    });
  }
  return { pulled, acked, confirmations: confirmed, cursor };
}

async function refreshGatewayStatus() {
  try {
    const result = await api("/api/personal-wechat/gateway/check", { method: "POST" });
    return result;
  } catch (error) {
    if (check) throw error;
    console.error(`gateway check failed: ${error.message}`);
    return null;
  }
}

async function runOnce() {
  await refreshGatewayStatus();
  const report = await api("/api/personal-wechat/config");
  const config = report.config || {};
  const gateway = config.gateway || {};
  if (gateway.mode !== "sidecar") {
    const message = `Personal WeChat gateway mode is ${gateway.mode || "unknown"}; sidecar sender is idle.`;
    if (check) console.log(message);
    return { checked: true, dispatched: 0, failed: 0, message };
  }
  if (!gateway.sidecarUrl) throw new Error("Personal WeChat sidecarUrl is required");
  if (check) {
    const qrCodeAvailable = Boolean(gateway.loginQrCodeUrl || gateway.loginQrCodeText);
    console.log(JSON.stringify({
      ok: Boolean(gateway.canSend || gateway.canReceive),
      apiBase,
      sidecarUrl: gateway.sidecarUrl,
      sendEndpoint: gateway.sendEndpoint || "/send",
      receiveEndpoint: gateway.receiveEndpoint || "/messages",
      ackEndpoint: gateway.ackEndpoint || "/ack",
      canSend: Boolean(gateway.canSend),
      canReceive: Boolean(gateway.canReceive),
      sendMode: gateway.sendMode || "proactive",
      supportsConfirm: Boolean(gateway.supportsConfirm),
      supportsRecall: Boolean(gateway.supportsRecall),
      supportsAck: Boolean(gateway.supportsAck),
      loginStatus: gateway.loginStatus || "未连接",
      qrCodeAvailable,
      nextStep: qrCodeAvailable
        ? "请扫码登录个人微信后重新运行检查。"
        : gateway.canReceive || gateway.canSend
          ? "Sidecar能力可用，可以运行 --once 做接收/发送联调。"
          : "请先启动个人微信Sidecar，并在 /health 中声明 canReceive 或 canSend。",
      cursor: gateway.cursor || "",
      status: gateway.status || ""
    }, null, 2));
    return { checked: true, dispatched: 0, failed: 0 };
  }
  if (gateway.canSend !== true) {
    const message = gateway.canReceive === true
      ? "Personal WeChat sidecar can receive messages, but canSend=true is required before dispatching outbound jobs."
      : "Personal WeChat sidecar is reachable only after /health declares canReceive=true or canSend=true.";
    const receiveResult = await pullInbound(config, gateway);
    return { checked: true, dispatched: 0, failed: 0, message, canSend: false, ...receiveResult };
  }
  const receiveResult = await pullInbound(config, gateway);
  const jobs = (config.sendJobs || []).filter((job) => job.status === "sending");
  let dispatched = 0;
  let failed = 0;
  for (const job of receiveOnly ? [] : jobs) {
    try {
      const result = await sidecarPost(gateway, job);
      await api(`/api/personal-wechat/send-jobs/${encodeURIComponent(job.jobId)}/dispatched`, {
        method: "POST",
        body: JSON.stringify({
          gatewayMode: "sidecar",
          gatewayRequestId: result.gatewayRequestId || result.requestId || result.id || "",
          externalMessageId: result.externalMessageId || result.messageId || result.msgid || "",
          now: new Date().toISOString()
        })
      });
      dispatched += 1;
      console.log(`dispatched ${job.jobId}`);
    } catch (error) {
      failed += 1;
      await api(`/api/personal-wechat/send-jobs/${encodeURIComponent(job.jobId)}/fail`, {
        method: "POST",
        body: JSON.stringify({ error: error.message, now: new Date().toISOString() })
      });
      console.error(`failed ${job.jobId}: ${error.message}`);
    }
  }
  return { checked: false, dispatched, failed, ...receiveResult };
}

async function main() {
  do {
    const result = await runOnce();
    if (once || check) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(1000, pollIntervalMs)));
  } while (true);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
