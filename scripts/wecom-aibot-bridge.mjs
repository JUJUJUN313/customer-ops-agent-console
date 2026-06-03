import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { WSClient, generateReqId } from "@wecom/aibot-node-sdk";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const statePath = join(root, "data", "state.json");
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=") || "true"];
  })
);
const apiBase = String(args.api || process.env.CUSTOMER_OPS_API || "http://127.0.0.1:5175").replace(/\/+$/, "");
const checkMode = args.check === "true";
const checkTimeoutMs = Math.max(5000, Number(args.timeout || 20000));
const seenMessageIds = new Map();
const seenTtlMs = 5 * 60 * 1000;

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

function readAibotConfig() {
  const state = readState();
  const config = state.wecomConfig?.aibot || {};
  if (!config.enabled) throw new Error("WeCom AI Bot is disabled in local config");
  if (!config.botId || !config.secret) throw new Error("WeCom AI Bot botId/secret is missing");
  return config;
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

async function recordStatus(status, detail = "", error = "") {
  try {
    await postJson("/api/wecom/aibot/status", { status, detail, error });
  } catch (statusError) {
    console.warn(`[wecom-bridge] 状态写入失败：${statusError.message}`);
  }
}

function cleanupSeen() {
  const now = Date.now();
  for (const [key, seenAt] of seenMessageIds.entries()) {
    if (now - seenAt > seenTtlMs) seenMessageIds.delete(key);
  }
}

function markDuplicate(messageId = "") {
  cleanupSeen();
  const key = String(messageId || "").trim();
  if (!key) return false;
  if (seenMessageIds.has(key)) return true;
  seenMessageIds.set(key, Date.now());
  return false;
}

function extractMessageText(body = {}) {
  if (body.text?.content) return String(body.text.content);
  if (body.voice?.content) return String(body.voice.content);
  if (body.mixed?.msg_item?.length) {
    return body.mixed.msg_item
      .map((item) => {
        if (item.text?.content) return item.text.content;
        if (item.image?.url) return "[图片消息]";
        return `[${item.msgtype || "混合"}消息]`;
      })
      .join("\n");
  }
  if (body.image?.url) return "[图片消息]";
  if (body.file?.url) return "[文件消息]";
  if (body.video?.url) return "[视频消息]";
  return body.msgtype ? `[${body.msgtype}消息]` : "";
}

function resolveSuggestedReply(state = {}, fallback = "") {
  const run = Array.isArray(state.agentRuns) ? state.agentRuns[0] : null;
  const reply = run?.suggestedReply || run?.pushCopy || run?.handoffPackage?.summary || run?.contextSummary || fallback;
  return String(reply || "已收到，我先帮您整理需求并同步给对应同事。").slice(0, 1800);
}

async function main() {
  const config = readAibotConfig();
  console.log(`[wecom-bridge] ${checkMode ? "检查" : "启动"}长连接，Bot ${maskSecret(config.botId)}，API ${apiBase}`);
  await recordStatus(checkMode ? "检查中" : "启动中", `Bot ${maskSecret(config.botId)}`);
  let finishedCheck = false;
  let checkTimer = null;
  async function finishCheck(code, status, detail = "", error = "") {
    if (!checkMode || finishedCheck) return;
    finishedCheck = true;
    if (checkTimer) clearTimeout(checkTimer);
    if (status) await recordStatus(status, detail, error);
    wsClient.disconnect();
    process.exit(code);
  }

  const wsClient = new WSClient({
    botId: config.botId,
    secret: config.secret,
    wsUrl: config.wsUrl || undefined,
    heartbeatInterval: Number(config.heartbeatInterval || 30000),
    maxReconnectAttempts: Number(config.maxReconnectAttempts ?? 10),
    logger: {
      debug: () => {},
      info: (message) => console.log(`[wecom-sdk] ${message}`),
      warn: (message) => console.warn(`[wecom-sdk] ${message}`),
      error: (message) => console.error(`[wecom-sdk] ${message}`)
    }
  });

  wsClient.on("connected", () => {
    console.log("[wecom-bridge] WebSocket 已连接");
    void recordStatus("已连接", "WebSocket connected");
  });

  wsClient.on("authenticated", () => {
    console.log("[wecom-bridge] 企微认证成功");
    void recordStatus("认证成功", "WeCom AI Bot authenticated");
    void finishCheck(0, "认证成功", "check passed");
  });

  wsClient.on("reconnecting", (attempt) => {
    console.warn(`[wecom-bridge] 正在重连，第 ${attempt} 次`);
    void recordStatus("重连中", `attempt ${attempt}`);
  });

  wsClient.on("disconnected", (reason) => {
    console.warn(`[wecom-bridge] 连接断开：${reason}`);
    void recordStatus("已断开", reason);
  });

  wsClient.on("error", (error) => {
    console.error(`[wecom-bridge] 错误：${error.message}`);
    void recordStatus("错误", "", error.message);
    if (checkMode && /auth|secret|credential|认证|鉴权/i.test(error.message)) {
      void finishCheck(1, "错误", "check failed", error.message);
    }
  });

  wsClient.on("event.enter_chat", async (frame) => {
    const latestConfig = readAibotConfig();
    if (!latestConfig.autoReply || !latestConfig.welcomeText) return;
    try {
      await wsClient.replyWelcome(frame, {
        msgtype: "text",
        text: { content: latestConfig.welcomeText }
      });
    } catch (error) {
      console.warn(`[wecom-bridge] 欢迎语发送失败：${error.message}`);
    }
  });

  wsClient.on("message", async (frame) => {
    const body = frame.body || {};
    const externalMessageId = body.msgid || frame.headers?.msgid || frame.headers?.req_id || "";
    if (markDuplicate(externalMessageId)) {
      console.log(`[wecom-bridge] 忽略重复消息 ${externalMessageId}`);
      return;
    }

    const message = extractMessageText(body);
    const latestConfig = readAibotConfig();
    try {
      const nextState = await postJson("/api/wecom/inbound", {
        source: "wecom-aibot",
        externalMessageId,
        requestId: frame.headers?.req_id || "",
        chatId: body.chatid || "",
        chatType: body.chattype || "",
        senderId: body.from?.userid || "",
        senderRole: "客户",
        senderName: body.from?.userid || "",
        channel: body.chattype === "group" ? "VIP群" : latestConfig.defaultChannel || "销售企微",
        message
      });
      console.log(`[wecom-bridge] 入站已写入：${body.chattype || "unknown"} ${body.chatid || body.from?.userid || ""} ${externalMessageId}`);

      if (latestConfig.autoReply) {
        const replyText = resolveSuggestedReply(nextState, latestConfig.welcomeText);
        await wsClient.replyStream(frame, generateReqId("customer_ops"), replyText, true);
        console.log(`[wecom-bridge] 已回复消息 ${externalMessageId}`);
      }
    } catch (error) {
      console.error(`[wecom-bridge] 入站处理失败：${error.message}`);
      await recordStatus("错误", "inbound handling failed", error.message);
    }
  });

  wsClient.connect();
  if (checkMode) {
    checkTimer = setTimeout(() => {
      console.error(`[wecom-bridge] 检查超时：${checkTimeoutMs}ms 内未完成认证`);
      void finishCheck(1, "检查超时", `${checkTimeoutMs}ms 内未完成认证`);
    }, checkTimeoutMs);
  }

  const shutdown = () => {
    console.log("[wecom-bridge] 正在退出");
    wsClient.disconnect();
    void recordStatus("已停止", "bridge process stopped").finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch(async (error) => {
  console.error(`[wecom-bridge] 启动失败：${error.message}`);
  await recordStatus("错误", "bridge startup failed", error.message);
  process.exit(1);
});
