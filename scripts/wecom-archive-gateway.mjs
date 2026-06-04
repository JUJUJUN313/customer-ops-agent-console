import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const statePath = join(root, "data", "state.json");
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=") || "true"];
  })
);

const apiBase = String(args.api || process.env.CUSTOMER_OPS_API || "http://127.0.0.1:5175").replace(/\/+$/, "");
const once = args.once === "true";
const check = args.check === "true";

function maskSecret(value = "") {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 8) return "********";
  return `${text.slice(0, 4)}********${text.slice(-4)}`;
}

function readState() {
  if (!existsSync(statePath)) throw new Error(`state.json not found: ${statePath}`);
  return JSON.parse(readFileSync(statePath, "utf8"));
}

function readArchiveConfig() {
  const state = readState();
  const archive = state.wecomConfig?.archive || {};
  return archive;
}

async function postJson(path, payload) {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text };
  }
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

async function recordStatus(status, detail = "", extra = {}) {
  try {
    await postJson("/api/wecom/archive/status", { status, detail, ...extra });
  } catch (error) {
    console.warn(`[wecom-archive] 状态写入失败：${error.message}`);
  }
}

function normalizeSidecarMessage(raw = {}, cursor = "") {
  const roomId = raw.roomId || raw.chatId || raw.chatid || raw.room_id || raw.chat_id || "";
  const messageId = raw.messageId || raw.msgid || raw.msgId || raw.id || "";
  const msgType = raw.msgType || raw.msgtype || "text";
  const rawText = raw.text || raw.content || raw.message || raw.textContent || "";
  const text = rawText || (msgType === "text" ? "" : `[${msgType}消息]`);
  return {
    messageId,
    roomId,
    roomName: raw.roomName || raw.chatName || raw.groupName || raw.room_name || "",
    senderId: raw.senderId || raw.fromUserId || raw.from || raw.userid || "",
    senderName: raw.senderName || raw.fromName || raw.name || "",
    senderType: raw.senderType || raw.senderRoleType || "customer",
    msgType,
    text,
    sendAt: raw.sendAt || raw.msgtime || raw.time || new Date().toISOString(),
    source: "wecom-archive",
    cursor: raw.cursor || cursor,
    seq: raw.seq
  };
}

function sidecarPullUrl(sidecarUrl = "") {
  const base = String(sidecarUrl || "").replace(/\/+$/, "");
  if (!base) throw new Error("WeCom archive sidecar URL is required");
  return /\/pull$/i.test(base) ? base : `${base}/pull`;
}

function sidecarAckUrl(sidecarUrl = "") {
  const base = String(sidecarUrl || "").replace(/\/+$/, "").replace(/\/pull$/i, "");
  if (!base) throw new Error("WeCom archive sidecar URL is required");
  return /\/ack$/i.test(base) ? base : `${base}/ack`;
}

async function pullFromSidecar(archive = {}) {
  const response = await fetch(sidecarPullUrl(archive.sidecarUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      corpId: archive.corpId,
      archiveSecret: archive.archiveSecret,
      privateKey: archive.privateKey,
      privateKeyVersion: archive.privateKeyVersion,
      cursor: archive.cursor || "",
      seq: archive.seq || 0,
      limit: archive.limit || 100
    })
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text };
  }
  if (!response.ok) throw new Error(body.error || `sidecar HTTP ${response.status}`);
  const messages = Array.isArray(body.messages) ? body.messages : Array.isArray(body.data) ? body.data : [];
  return {
    messages,
    cursor: body.cursor || body.nextCursor || "",
    seq: Number(body.seq ?? body.nextSeq ?? archive.seq ?? 0),
    hasMore: Boolean(body.hasMore)
  };
}

async function ackSidecar(archive = {}, ack = {}) {
  const response = await fetch(sidecarAckUrl(archive.sidecarUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      corpId: archive.corpId,
      cursor: ack.cursor || archive.cursor || "",
      seq: ack.seq ?? archive.seq ?? 0,
      messageIds: ack.messageIds || [],
      processedAt: new Date().toISOString()
    })
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text };
  }
  if (!response.ok) throw new Error(body.error || `sidecar ACK HTTP ${response.status}`);
  return body;
}

async function runOnce() {
  const archive = readArchiveConfig();
  if (!archive.enabled) {
    throw new Error("WeCom archive gateway is disabled in local config");
  }
  if (archive.gatewayMode !== "sidecar") {
    throw new Error(`Unsupported archive gateway mode: ${archive.gatewayMode || "empty"}`);
  }
  if (!archive.corpId || !archive.archiveSecret || !archive.privateKey) {
    throw new Error("WeCom archive corpId/archiveSecret/privateKey is missing");
  }
  await recordStatus("拉取中", `corp ${maskSecret(archive.corpId)} seq ${archive.seq || 0}`, {
    trustedStatus: archive.trustedStatus || "待验证"
  });
  const result = await pullFromSidecar(archive);
  let ingested = 0;
  const ackMessageIds = [];
  for (const raw of result.messages) {
    const message = normalizeSidecarMessage(raw, result.cursor || archive.cursor || "");
    if (!message.messageId || !message.roomId || !message.text) {
      console.warn("[wecom-archive] 跳过缺少 messageId/roomId/text 的消息");
      continue;
    }
    await postJson("/api/wecom/archive/inbound", message);
    ackMessageIds.push(message.messageId);
    ingested += 1;
  }
  if (ackMessageIds.length) {
    try {
      await ackSidecar(archive, {
        cursor: result.cursor || archive.cursor || "",
        seq: result.seq,
        messageIds: ackMessageIds
      });
    } catch (error) {
      await recordStatus("ACK失败", "archive sidecar ack failed", {
        error: error.message,
        trustedStatus: "ACK异常"
      });
      throw error;
    }
  }
  await recordStatus("运行中", `本轮拉取 ${ingested} 条`, {
    cursor: result.cursor || archive.cursor || "",
    seq: result.seq,
    trustedStatus: "sidecar已连接",
    lastMessageAt: result.messages.at(-1)?.sendAt || result.messages.at(-1)?.msgtime || "",
    lastAckAt: ackMessageIds.length ? new Date().toISOString() : ""
  });
  return { ingested, hasMore: result.hasMore };
}

async function main() {
  const archive = readArchiveConfig();
  console.log(`[wecom-archive] ${check ? "检查" : "启动"}会话存档Gateway，API ${apiBase}`);
  if (check) {
    const missing = [];
    if (!archive.enabled) missing.push("enabled");
    if (archive.gatewayMode !== "sidecar") missing.push("gatewayMode=sidecar");
    if (!archive.corpId) missing.push("corpId");
    if (!archive.archiveSecret) missing.push("archiveSecret");
    if (!archive.privateKey) missing.push("privateKey");
    if (!archive.sidecarUrl) missing.push("sidecarUrl");
    const ok = missing.length === 0 && archive.enabled && archive.gatewayMode === "sidecar";
    const error = ok ? "" : `缺少 ${missing.join("、") || "sidecar模式"}`;
    const result = {
      ok,
      apiBase,
      gatewayMode: archive.gatewayMode || "",
      sidecarUrl: archive.sidecarUrl || "",
      missing,
      message: ok ? "会话存档配置满足sidecar启动条件" : error
    };
    console.log(JSON.stringify(result, null, 2));
    await recordStatus(ok ? "检查通过" : "检查失败", result.message, {
      error,
      trustedStatus: ok ? "配置已验证" : "配置未完成"
    });
    process.exit(ok ? 0 : 1);
  }

  let stopped = false;
  const shutdown = () => {
    stopped = true;
    void recordStatus("已停止", "archive gateway stopped").finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  do {
    try {
      const result = await runOnce();
      console.log(`[wecom-archive] 本轮完成，入站 ${result.ingested} 条${result.hasMore ? "，sidecar仍有更多消息" : ""}`);
    } catch (error) {
      console.error(`[wecom-archive] 拉取失败：${error.message}`);
      await recordStatus("错误", "archive pull failed", {
        error: error.message,
        trustedStatus: "异常"
      });
      if (once) process.exit(1);
    }
    if (once || stopped) break;
    const latest = readArchiveConfig();
    const delayMs = Math.max(3, Number(latest.pollIntervalSeconds || 10)) * 1000;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
  } while (!stopped);
}

main().catch(async (error) => {
  console.error(`[wecom-archive] 启动失败：${error.message}`);
  await recordStatus("错误", "archive gateway startup failed", {
    error: error.message,
    trustedStatus: "异常"
  });
  process.exit(1);
});
