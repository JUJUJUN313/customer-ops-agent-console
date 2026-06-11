#!/usr/bin/env node
const apiBase = process.env.CUSTOMER_OPS_API || "http://127.0.0.1:5175";
const once = process.argv.includes("--once");
const check = process.argv.includes("--check");
const receiveOnly = process.argv.includes("--receive-only");
const sendOnly = process.argv.includes("--send-only");
const pollIntervalMs = Number(process.env.WECOM_CLIENT_REALTIME_INTERVAL_MS || 2000);
const pullLimit = Number(process.env.WECOM_CLIENT_REALTIME_PULL_LIMIT || 50);
const unreadStatusIntervalMs = Math.max(300, Number(process.env.WECOM_CLIENT_UNREAD_STATUS_INTERVAL_MS || 800));
const currentRoomWatchIntervalMs = Math.max(500, Number(process.env.WECOM_CLIENT_CURRENT_WATCH_INTERVAL_MS || 1000));
const currentRoomWatchMaxCycles = Number(process.env.WECOM_CLIENT_CURRENT_WATCH_MAX_CYCLES || (once ? 5 : 0));
const idleConversationName = process.env.WECOM_AUTOMATION_IDLE_CONVERSATION || "文件传输助手";
let unreadHint = {
  hasUnread: false,
  detectedAt: "",
  lastCheckedAt: "",
  lastStatusMs: 0,
  error: ""
};
let unreadStatusMonitorStarted = false;

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

function endpoint(worker, path = "") {
  return `${String(worker.sidecarUrl || "").replace(/\/+$/, "")}${path || ""}`;
}

function workerError(payload = {}, path = "", status = "") {
  const error = new Error(payload.error || payload.message || `WeCom client worker ${path} failed: ${status}`);
  error.errorCode = payload.errorCode || payload.status || "";
  error.payload = payload;
  return error;
}

async function workerPost(worker, path, body) {
  const response = await fetch(endpoint(worker, path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
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
  if (!response.ok) throw workerError(payload, path, response.status);
  return payload;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function markUnreadHint(payload = {}) {
  unreadHint = {
    hasUnread: Boolean(payload.hasUnread),
    detectedAt: payload.hasUnread ? payload.detectedAt || new Date().toISOString() : "",
    lastCheckedAt: new Date().toISOString(),
    lastStatusMs: Math.max(0, Number(payload.timings?.totalMs || payload.lastStatusMs || 0)),
    error: payload.error || ""
  };
  return unreadHint;
}

async function pollUnreadStatus(worker = {}) {
  if (!worker.sidecarUrl || worker.canReceive !== true) return markUnreadHint({ hasUnread: false });
  const startedAt = Date.now();
  const payload = await workerPost(worker, "/unread-status", {});
  return markUnreadHint({
    ...payload,
    detectedAt: payload.hasUnread ? new Date().toISOString() : "",
    lastStatusMs: Date.now() - startedAt
  });
}

function startUnreadStatusMonitor(worker = {}) {
  if (unreadStatusMonitorStarted || once || check || receiveOnly || worker.canReceive !== true || !worker.sidecarUrl) return;
  unreadStatusMonitorStarted = true;
  const loop = async () => {
    try {
      await pollUnreadStatus(worker);
    } catch (error) {
      markUnreadHint({ hasUnread: false, error: error.message });
    } finally {
      setTimeout(loop, unreadStatusIntervalMs).unref?.();
    }
  };
  setTimeout(loop, 0).unref?.();
}

function isIdleConversationName(roomName = "") {
  const normalized = String(roomName || "").replace(/\u200b/g, "").trim();
  return Boolean(normalized && normalized === idleConversationName);
}

function needsIdleAfterReceive(receiveResult = {}) {
  const roomName = receiveResult.roomName || receiveResult.unreadRoomName || "";
  if (receiveResult.unsupportedUnread && isIdleConversationName(roomName)) return false;
  return receiveResult.pulled > 0 ||
    receiveResult.acked > 0 ||
    receiveResult.confirmations > 0 ||
    receiveResult.unsupportedUnread;
}

function emptyReceiveResult(extra = {}) {
  return {
    pulled: 0,
    acked: 0,
    confirmations: 0,
    failedInbound: 0,
    cursor: "",
    pulledRoomIds: [],
    pulledRoomNames: [],
    roomId: "",
    roomName: "",
    currentOnly: false,
    noUnreadDetected: false,
    unsupportedUnread: false,
    unreadRoomName: "",
    ...extra
  };
}

function workerLooksStale(worker = {}) {
  const text = `${worker.lastError || ""}\n${worker.loginStatus || ""}\n${worker.status || ""}`;
  return /client_stale|wecom_window_stale|wecom_window_missing|不可交互/.test(text);
}

async function recoverLocalWorkerIfStale(worker = {}) {
  if (!worker.sidecarUrl || !workerLooksStale(worker)) return { attempted: false, recovered: false };
  try {
    const result = await workerPost(worker, "/recover", {});
    return {
      attempted: true,
      recovered: result.status === "recovered" || result.ok === true,
      result
    };
  } catch (error) {
    console.error(`worker recover failed: ${error.message}`);
    return { attempted: true, recovered: false, error: error.message };
  }
}

async function resetLocalWorkerToIdle(worker = {}, reason = "") {
  if (!worker.sidecarUrl) return { attempted: false, reset: false };
  try {
    const result = await workerPost(worker, "/idle", { reason });
    return {
      attempted: true,
      reset: result.reset === true || result.status === "idle",
      result
    };
  } catch (error) {
    console.error(`worker idle reset failed: ${error.message}`);
    return { attempted: true, reset: false, error: error.message };
  }
}

async function resetLocalWorkerToIdleIfNoImmediateTask(worker = {}, reason = "", skipRoomIds = []) {
  if (!worker.sidecarUrl) return { attempted: false, reset: false };
  try {
    const peek = await peekScheduledJobs(skipRoomIds);
    if (peek.hasTask) {
      return {
        attempted: false,
        reset: false,
        skipped: true,
        reason: "next_task_pending",
        nextTaskJobIds: peek.jobs.map((job) => job.jobId)
      };
    }
  } catch (error) {
    console.error(`worker idle peek failed: ${error.message}`);
  }
  return resetLocalWorkerToIdle(worker, reason);
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
    messageId: String(firstValue(message, ["messageId", "msgid", "msgId", "id"], `wecom_client_${Date.now()}`)),
    roomId: String(firstValue(message, ["roomId", "chatId", "chatid", "conversationId"], "")),
    roomName: String(firstValue(message, ["roomName", "chatName", "conversationName", "groupName"], "")),
    senderId: String(firstValue(message, ["senderId", "fromId", "from", "userid"], "")),
    senderName: String(firstValue(message, ["senderName", "fromName", "name"], "未知发送人")),
    senderType: String(firstValue(message, ["senderType", "senderRoleType"], "customer")),
    msgType,
    text,
    sendAt: String(firstValue(message, ["sendAt", "timestamp", "createdAt"], new Date().toISOString())),
    source: "wecom-client-realtime",
    confirmSource: "vendor-archive-download"
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

function collectKnownMessageIds(report = {}, limit = 300) {
  const ids = [];
  const contexts = report.queue?.groupContexts || report.config?.queue?.groupContexts || [];
  for (const context of contexts || []) {
    for (const message of context.messages || []) {
      if (message?.messageId) ids.push(String(message.messageId));
    }
  }
  const logs = report.queue?.logs || report.config?.queue?.logs || report.config?.logs || [];
  for (const log of logs || []) {
    if (log?.messageId) ids.push(String(log.messageId));
  }
  return [...new Set(ids.filter(Boolean))].slice(-Math.max(20, Number(limit || 300)));
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
    .filter((message) => ["managed_account", "bot", "staff"].includes(message.senderType) && (message.jobId || message.echoOfJobId || message.sendJobId))
    .map((message) => ({
      jobId: message.jobId || message.echoOfJobId || message.sendJobId,
      confirmedMessageId: message.messageId || message.msgid || message.id
    }));
  return [...rawConfirmations, ...messageConfirmations]
    .map((item) => ({
      confirmationId: String(firstValue(item, ["confirmationId", "receiptId", "id"], "")),
      jobId: String(firstValue(item, ["jobId", "sendJobId", "echoOfJobId"], "")),
      confirmedMessageId: String(firstValue(item, ["confirmedMessageId", "messageId", "msgid", "externalMessageId"], "")),
      now: String(firstValue(item, ["now", "confirmedAt", "sendAt"], new Date().toISOString()))
    }))
    .filter((item) => item.jobId);
}

async function submitInboundMessages(config, worker, rawMessages = [], detailPrefix = "发送前保护") {
  const inboundMessages = rawMessages.map(normalizeInboundMessage).filter((message) => message.roomId && message.messageId);
  if (!inboundMessages.length) {
    return {
      pulled: 0,
      acked: 0,
      failedInbound: 0,
      cursor: worker.cursor || "",
      pulledRoomIds: [],
      pulledRoomNames: []
    };
  }
  let pulled = 0;
  const successfulMessages = [];
  const failedMessages = [];
  const batchResponse = await api("/api/wecom-client/realtime/inbound-batch", {
    method: "POST",
    body: JSON.stringify({ messages: inboundMessages })
  });
  const acceptedIds = new Set((batchResponse.batchResult?.accepted || []).map((item) => item.messageId).filter(Boolean));
  const failedById = new Map((batchResponse.batchResult?.failed || []).map((item) => [item.messageId, item]));
  for (const message of inboundMessages) {
    if (acceptedIds.has(message.messageId)) {
      successfulMessages.push(message);
      pulled += 1;
      console.log(`inbound ${message.roomId} ${message.messageId}`);
      continue;
    }
    const failure = failedById.get(message.messageId) || {
      errorCode: "inbound_write_failed",
      error: "Inbound batch did not accept this message."
    };
    const error = new Error(failure.error || "Inbound batch failed");
    error.errorCode = failure.errorCode || "inbound_write_failed";
    failedMessages.push({ message, error });
    console.error(`inbound failed ${message.roomId} ${message.messageId}: ${error.message}`);
  }
  const cursor = failedMessages.length
    ? worker.cursor || ""
    : successfulMessages.at(-1)?.messageId || inboundMessages.at(-1)?.messageId || worker.cursor || "";
  await api("/api/wecom-client/realtime/status", {
    method: "POST",
    body: JSON.stringify({
      status: failedMessages.length ? `${detailPrefix}部分入站失败` : `${detailPrefix}已入站`,
      lastSeenAt: new Date().toISOString(),
      worker: {
        cursor,
        lastPulledAt: new Date().toISOString()
      },
      detail: `${detailPrefix}入站${successfulMessages.length}/${inboundMessages.length}条，失败${failedMessages.length}条`
    })
  });
  let acked = 0;
  if (successfulMessages.length && worker.supportsAck) {
    await workerPost(worker, worker.ackEndpoint || "/ack", {
      accountId: config.employeeAccount?.id || "",
      cursor,
      roomId: successfulMessages.at(-1)?.roomId || "",
      messageIds: successfulMessages.map((message) => message.messageId),
      messages: successfulMessages.map((message) => ({
        messageId: message.messageId,
        roomId: message.roomId,
        roomName: message.roomName
      }))
    });
    acked = successfulMessages.length;
    await api("/api/wecom-client/realtime/status", {
      method: "POST",
      body: JSON.stringify({
        status: `${detailPrefix}已ACK`,
        worker: {
          cursor,
          lastAckAt: new Date().toISOString()
        },
        detail: `${detailPrefix}ACK ${successfulMessages.length} 条企微客户端消息`
      })
    });
  }
  return {
    pulled,
    acked,
    failedInbound: failedMessages.length,
    cursor,
    pulledRoomIds: [...new Set(successfulMessages.map((message) => message.roomId).filter(Boolean))],
    pulledRoomNames: [...new Set(successfulMessages.map((message) => message.roomName).filter(Boolean))]
  };
}

function asTimeMs(value = "", fallback = 0) {
  const date = new Date(value || "");
  const time = date.getTime();
  return Number.isNaN(time) ? fallback : time;
}

function findQueueJob(report = {}, jobId = "") {
  const queue = report.queue || report.config?.queue || {};
  const sendJobs = Array.isArray(queue.sendJobs) ? queue.sendJobs : [];
  const groupContexts = Array.isArray(queue.groupContexts) ? queue.groupContexts : [];
  const job = sendJobs.find((item) => item.jobId === jobId);
  const context = job ? groupContexts.find((item) => item.roomId === job.roomId) : null;
  return { job, context };
}

function validateBeforeSend(report = {}, scheduledJob = {}, now = new Date()) {
  const { job, context } = findQueueJob(report, scheduledJob.jobId);
  if (!job) {
    return { ok: false, errorCode: "preflight_job_missing", error: "发送前预检失败：任务已经不存在。" };
  }
  if (job.status !== "sending") {
    return { ok: false, errorCode: "preflight_job_not_sending", error: `发送前预检失败：任务状态已变为${job.status}。` };
  }
  if (!context) {
    return { ok: false, errorCode: "preflight_context_missing", error: "发送前预检失败：群上下文不存在。" };
  }
  const nowMs = now.getTime();
  const validAfterMs = asTimeMs(job.validAfterAt || context.quietUntilAt, 0);
  if (validAfterMs > nowMs) {
    const waitSeconds = Math.max(1, Math.ceil((validAfterMs - nowMs) / 1000));
    return { ok: false, errorCode: "preflight_quiet_window", error: `发送前预检失败：会话静默窗口未结束，请${waitSeconds}秒后重新判断。` };
  }
  const contextRoomVersion = Math.max(0, Number(context.roomVersion || 0));
  const triggerRoomVersion = Math.max(0, Number(job.triggerRoomVersion || scheduledJob.triggerRoomVersion || 0));
  if (contextRoomVersion > 0 && triggerRoomVersion > 0 && contextRoomVersion !== triggerRoomVersion) {
    return {
      ok: false,
      errorCode: "preflight_room_version_stale",
      error: `发送前预检失败：会话已有新消息，任务版本${triggerRoomVersion}落后当前版本${contextRoomVersion}。`
    };
  }
  const staffReplyMs = asTimeMs(context.lastStaffReplyAt, 0);
  const createdMs = asTimeMs(job.createdAt || scheduledJob.createdAt, 0);
  if (staffReplyMs > 0 && createdMs > 0 && staffReplyMs > createdMs) {
    return { ok: false, errorCode: "preflight_staff_replied", error: "发送前预检失败：群里已有员工回复，取消自动发送。" };
  }
  if (context.pendingSendJobId && context.pendingSendJobId !== job.jobId) {
    return { ok: false, errorCode: "preflight_room_job_changed", error: "发送前预检失败：同群待发送任务已变化。" };
  }
  return { ok: true, job, context };
}

async function pullRealtime(config, worker, options = {}) {
  if (worker.mode !== "local-script" || worker.canReceive !== true || sendOnly) return { pulled: 0, acked: 0, confirmations: 0 };
  const report = await api("/api/wecom-client/realtime/config");
  const knownMessageIds = collectKnownMessageIds(report);
  const currentOnly = options.currentOnly === true;
  const payload = await workerPost(worker, worker.receiveEndpoint || "/messages", {
    accountId: config.employeeAccount?.id || "",
    cursor: currentOnly ? "" : worker.cursor || "",
    knownMessageIds,
    limit: pullLimit,
    unreadOnly: currentOnly ? false : options.unreadOnly !== false,
    currentOnly
  });
  const messages = extractMessages(payload);
  const confirmations = extractConfirmations(payload);
  let pulled = 0;
  let confirmed = 0;
  const ackableConfirmations = [];
  const successfulMessages = [];
  const failedMessages = [];
  for (const confirmation of confirmations) {
    try {
      await api(`/api/wecom-client/realtime/send-jobs/${encodeURIComponent(confirmation.jobId)}/confirm`, {
        method: "POST",
        body: JSON.stringify({
          confirmedMessageId: confirmation.confirmedMessageId,
          now: confirmation.now
        })
      });
      confirmed += 1;
      ackableConfirmations.push(confirmation);
      console.log(`confirmed ${confirmation.jobId}`);
    } catch (error) {
      console.error(`confirm failed ${confirmation.jobId}: ${error.message}`);
    }
  }
  const inboundMessages = messages.filter((message) =>
    !(["managed_account", "bot", "staff"].includes(message.senderType) && confirmations.some((item) => item.confirmedMessageId === message.messageId))
  );
  if (inboundMessages.length) {
    const batchResponse = await api("/api/wecom-client/realtime/inbound-batch", {
      method: "POST",
      body: JSON.stringify({ messages: inboundMessages })
    });
    const acceptedIds = new Set((batchResponse.batchResult?.accepted || []).map((item) => item.messageId).filter(Boolean));
    const failedById = new Map((batchResponse.batchResult?.failed || []).map((item) => [item.messageId, item]));
    for (const message of inboundMessages) {
      if (acceptedIds.has(message.messageId)) {
        successfulMessages.push(message);
        pulled += 1;
        console.log(`inbound ${message.roomId} ${message.messageId}`);
        continue;
      }
      const failure = failedById.get(message.messageId) || {
        errorCode: "inbound_write_failed",
        error: "Inbound batch did not accept this message."
      };
      const error = new Error(failure.error || "Inbound batch failed");
      error.errorCode = failure.errorCode || "inbound_write_failed";
      failedMessages.push({ message, error });
      console.error(`inbound failed ${message.roomId} ${message.messageId}: ${error.message}`);
    }
  }
  const cursor = failedMessages.length
    ? worker.cursor || ""
    : payload.nextCursor || payload.cursor || successfulMessages.at(-1)?.messageId || messages.at(-1)?.messageId || worker.cursor || "";
  let acked = 0;
  if (successfulMessages.length || failedMessages.length || confirmations.length || cursor !== worker.cursor) {
    await api("/api/wecom-client/realtime/status", {
      method: "POST",
      body: JSON.stringify({
        status: failedMessages.length ? "实时未读部分入站失败" : "实时未读已拉取",
        lastSeenAt: new Date().toISOString(),
        worker: {
          cursor,
          lastPulledAt: new Date().toISOString()
        },
        detail: `拉取${messages.length}条，入站${successfulMessages.length}条，失败${failedMessages.length}条，确认${confirmed}条`
      })
    });
  }
  if ((successfulMessages.length || ackableConfirmations.length) && worker.supportsAck) {
    await workerPost(worker, worker.ackEndpoint || "/ack", {
      accountId: config.employeeAccount?.id || "",
      cursor,
      roomId: successfulMessages.at(-1)?.roomId || payload.roomId || "",
      messageIds: successfulMessages.map((message) => message.messageId),
      messages: successfulMessages.map((message) => ({
        messageId: message.messageId,
        roomId: message.roomId,
        roomName: message.roomName
      })),
      confirmationIds: ackableConfirmations.map((confirmation) => confirmation.confirmationId || confirmation.confirmedMessageId || confirmation.jobId),
      confirmedMessageIds: ackableConfirmations.map((confirmation) => confirmation.confirmedMessageId).filter(Boolean)
    });
    acked = successfulMessages.length + ackableConfirmations.length;
    await api("/api/wecom-client/realtime/status", {
      method: "POST",
      body: JSON.stringify({
        status: "实时未读已ACK",
        worker: {
          cursor,
          lastAckAt: new Date().toISOString()
        },
        detail: `ACK ${successfulMessages.length} 条企微客户端消息，${ackableConfirmations.length} 条确认回执`
      })
    });
  }
  return {
    pulled,
    acked,
    confirmations: confirmed,
    failedInbound: failedMessages.length,
    cursor,
    pulledRoomIds: [...new Set(successfulMessages.map((message) => message.roomId).filter(Boolean))],
    pulledRoomNames: [...new Set(successfulMessages.map((message) => message.roomName).filter(Boolean))],
    roomId: payload.roomId || successfulMessages.at(-1)?.roomId || "",
    roomName: payload.roomName || successfulMessages.at(-1)?.roomName || "",
    currentOnly: Boolean(payload.currentOnly || currentOnly),
    noUnreadDetected: Boolean(payload.noUnreadDetected),
    unsupportedUnread: Boolean(payload.unsupportedUnread),
    unreadRoomName: payload.roomName || ""
  };
}

async function peekScheduledJobs(skipRoomIds = []) {
  const preview = await api("/api/wecom-client/realtime/send-scheduler/peek", {
    method: "POST",
    body: JSON.stringify({
      skipRoomIds,
      skipReason: "当前会话看守中，本轮不发送刚读取会话。"
    })
  });
  const jobs = (preview.personalWechat?.sendJobs || []).filter((job) => job.status === "sending");
  return {
    hasTask: jobs.length > 0,
    jobs
  };
}

async function watchCurrentRoomUntilTask(config, worker, seedReceiveResult = {}) {
  const watchedRoomId = seedReceiveResult.roomId || seedReceiveResult.pulledRoomIds?.[0] || "";
  const watchedRoomName = seedReceiveResult.roomName || seedReceiveResult.unreadRoomName || seedReceiveResult.pulledRoomNames?.[0] || "";
  if (!watchedRoomId || seedReceiveResult.unsupportedUnread || seedReceiveResult.noUnreadDetected) {
    return { watched: false, pulled: 0, acked: 0, pulledRoomIds: [], pulledRoomNames: [] };
  }
  const aggregate = {
    watched: true,
    watchRoomId: watchedRoomId,
    watchRoomName: watchedRoomName,
    watchCycles: 0,
    pulled: 0,
    acked: 0,
    confirmations: 0,
    failedInbound: 0,
    pulledRoomIds: [],
    pulledRoomNames: [],
    exitedForTask: false
  };
  while (currentRoomWatchMaxCycles <= 0 || aggregate.watchCycles < currentRoomWatchMaxCycles) {
    const peek = await peekScheduledJobs([]);
    if (peek.hasTask) {
      aggregate.exitedForTask = true;
      aggregate.nextTaskJobIds = peek.jobs.map((job) => job.jobId);
      break;
    }
    await sleep(currentRoomWatchIntervalMs);
    const latestReport = await api("/api/wecom-client/realtime/config");
    const latestConfig = latestReport.config || config;
    const latestWorker = latestConfig.worker || worker;
    const result = await pullRealtime(latestConfig, latestWorker, { currentOnly: true });
    aggregate.watchCycles += 1;
    aggregate.pulled += result.pulled || 0;
    aggregate.acked += result.acked || 0;
    aggregate.confirmations += result.confirmations || 0;
    aggregate.failedInbound += result.failedInbound || 0;
    for (const roomId of result.pulledRoomIds || []) {
      if (!aggregate.pulledRoomIds.includes(roomId)) aggregate.pulledRoomIds.push(roomId);
    }
    for (const roomName of result.pulledRoomNames || []) {
      if (!aggregate.pulledRoomNames.includes(roomName)) aggregate.pulledRoomNames.push(roomName);
    }
    if (result.unsupportedUnread || result.noUnreadDetected || (result.roomId && result.roomId !== watchedRoomId)) {
      aggregate.exitedForRoomChange = true;
      break;
    }
  }
  return aggregate;
}

async function refreshWorkerStatus() {
  try {
    return await api("/api/wecom-client/realtime/worker/check", { method: "POST" });
  } catch (error) {
    if (check) throw error;
    console.error(`worker check failed: ${error.message}`);
    return null;
  }
}

async function runOnce() {
  await refreshWorkerStatus();
  let report = await api("/api/wecom-client/realtime/config");
  let config = report.config || {};
  let worker = config.worker || {};
  if (worker.mode !== "local-script") {
    const message = `WeCom client worker mode is ${worker.mode || "unknown"}; realtime worker is idle.`;
    if (check) console.log(message);
    return { checked: true, dispatched: 0, failed: 0, message };
  }
  if (!worker.sidecarUrl) {
    const result = {
      checked: true,
      ok: false,
      dispatched: 0,
      failed: 0,
      missing: ["worker.sidecarUrl"],
      message: "WeCom client worker sidecarUrl is required",
      nextStep: "在企微客户端实时连接器中填写本地脚本URL，例如 http://127.0.0.1:8791。"
    };
    if (check) return result;
    throw new Error(result.message);
  }
  if (!check) {
    const recovery = await recoverLocalWorkerIfStale(worker);
    if (recovery.attempted) {
      await refreshWorkerStatus();
      report = await api("/api/wecom-client/realtime/config");
      config = report.config || {};
      worker = config.worker || {};
      if (!recovery.recovered) {
        return {
          checked: true,
          recovered: false,
          dispatched: 0,
          failed: 0,
          message: "企微窗口不可交互，已尝试恢复但未成功，本轮暂停。"
        };
      }
    }
  }
  startUnreadStatusMonitor(worker);
  if (check) {
    console.log(JSON.stringify({
      ok: Boolean(worker.canSend || worker.canReceive),
      apiBase,
      workerUrl: worker.sidecarUrl,
      sendEndpoint: worker.sendEndpoint || "/send",
      receiveEndpoint: worker.receiveEndpoint || "/messages",
      ackEndpoint: worker.ackEndpoint || "/ack",
      canSend: Boolean(worker.canSend),
      canReceive: Boolean(worker.canReceive),
      supportsAck: Boolean(worker.supportsAck),
      supportsConfirm: Boolean(worker.supportsConfirm),
      loginStatus: worker.loginStatus || "未连接",
      noScreenshots: true,
      nextStep: worker.canReceive || worker.canSend
        ? "Worker能力可用，可以运行 --once 做实时未读/发送联调。"
        : "请先启动企微客户端本地脚本，并在 /health 中声明 canReceive 或 canSend。"
    }, null, 2));
    return { checked: true, dispatched: 0, failed: 0 };
  }
  let sendQueuePeek = null;
  let hasSendTask = false;
  if (!receiveOnly && worker.canSend === true) {
    try {
      sendQueuePeek = await peekScheduledJobs([]);
      hasSendTask = sendQueuePeek.hasTask;
    } catch (error) {
      console.error(`send-queue peek failed: ${error.message}`);
    }
  }
  let receiveResult = emptyReceiveResult({
    sendQueueHasTask: hasSendTask,
    unreadHint: Boolean(unreadHint.hasUnread),
    nextTaskJobIds: sendQueuePeek?.jobs?.map((job) => job.jobId) || []
  });
  if (receiveOnly) {
    receiveResult = await pullRealtime(config, worker);
  } else if (!hasSendTask && worker.canReceive === true && unreadHint.hasUnread) {
    receiveResult = await pullRealtime(config, worker);
    receiveResult.directUnreadRead = true;
    markUnreadHint({ hasUnread: false });
  }
  if (receiveOnly) {
    const shouldIdle = needsIdleAfterReceive(receiveResult);
    const idleResult = shouldIdle
      ? await resetLocalWorkerToIdle(worker, "receive-only-cycle")
      : { attempted: false, reset: false };
    return {
      checked: false,
      dispatched: 0,
      failed: 0,
      receiveOnly: true,
      idleReset: idleResult,
      ...receiveResult
    };
  }
  const watchResult = receiveResult.pulled > 0
    ? await watchCurrentRoomUntilTask(config, worker, receiveResult)
    : { watched: false, pulled: 0, acked: 0, confirmations: 0, failedInbound: 0, pulledRoomIds: [], pulledRoomNames: [] };
  const guardedRoomIds = [...new Set([
    ...(receiveResult.pulledRoomIds || []),
    ...(watchResult.pulledRoomIds || [])
  ].filter(Boolean))];
  if (worker.canSend !== true) {
    return {
      checked: true,
      dispatched: 0,
      failed: 0,
      message: "WeCom client worker canReceive may be available, but canSend=true is required before dispatching outbound jobs.",
      canSend: false,
      ...receiveResult,
      watchResult
    };
  }
  const scheduledState = await api("/api/wecom-client/realtime/send-scheduler/run", {
    method: "POST",
    body: JSON.stringify({
      maxJobs: 1,
      skipRoomIds: guardedRoomIds,
      skipReason: guardedRoomIds.length > 0
        ? "本轮刚读取到该会话新消息，等待下一轮静默/版本判断后再发送。"
        : ""
    })
  });
  const schedulerResult = scheduledState.personalWechat?.schedulerResult || {
    dispatched: [],
    skipped: [],
    expired: []
  };
  const jobs = (scheduledState.personalWechat?.sendJobs || [])
    .filter((job) => job.status === "sending")
    .slice(0, 1);
  let dispatched = 0;
  let failed = 0;
  let preSendAborted = 0;
  let preSendInboundCount = 0;
  let preSendAcked = 0;
  let postSendReceiveResult = emptyReceiveResult({ postSendReceive: false });
  let postSendUnreadStatus = {
    checked: false,
    hasUnread: false,
    source: "",
    timings: {}
  };
  for (const job of receiveOnly ? [] : jobs) {
    try {
      const preflightReport = await api("/api/wecom-client/realtime/config");
      const preflight = validateBeforeSend(preflightReport, job, new Date());
      if (!preflight.ok) {
        await api(`/api/wecom-client/realtime/send-jobs/${encodeURIComponent(job.jobId)}/fail`, {
          method: "POST",
          body: JSON.stringify({
            status: "cancelled",
            errorCode: preflight.errorCode,
            error: preflight.error,
            now: new Date().toISOString()
          })
        });
        failed += 1;
        console.error(`preflight blocked ${job.jobId}: ${preflight.error}`);
        continue;
      }
      const result = await workerPost(worker, worker.sendEndpoint || "/send", {
        jobId: job.jobId,
        accountId: job.accountId,
        roomId: job.roomId,
        roomName: job.roomName,
        expectedTitleToken: job.expectedTitleToken || job.roomName?.match(/\[[^\]]+\]/)?.[0] || job.roomName || "",
        text: job.replyText,
        triggerMessageIds: job.triggerMessageIds || [],
        triggerRoomVersion: job.triggerRoomVersion || 0,
        triggerLatestMessageId: job.triggerLatestMessageId || "",
        triggerLatestText: job.triggerLatestText || "",
        triggerObservedAt: job.triggerObservedAt || "",
        triggerReadBatchId: job.triggerReadBatchId || "",
	        source: job.source || "wecom-client-realtime",
	        allowSend: true,
	        noScreenshot: true
	      });
	      if (result.status === "aborted_new_messages") {
	        const inboundResult = await submitInboundMessages(config, worker, result.messages || [], "发送前保护");
	        preSendAborted += 1;
	        preSendInboundCount += inboundResult.pulled || 0;
	        preSendAcked += inboundResult.acked || 0;
	        await api(`/api/wecom-client/realtime/send-jobs/${encodeURIComponent(job.jobId)}/fail`, {
	          method: "POST",
	          body: JSON.stringify({
	            status: "cancelled",
	            errorCode: result.errorCode || "preflight_room_version_stale",
	            error: result.error || "发送前发现目标会话已有新消息，取消旧回复并重新判断。",
	            now: new Date().toISOString()
	          })
	        });
	        console.error(`pre-send aborted ${job.jobId}: ${result.error || "new messages before send"}`);
	        continue;
	      }
	      if (result.status === "target_latest_unverified") {
	        preSendAborted += 1;
	        await api(`/api/wecom-client/realtime/send-jobs/${encodeURIComponent(job.jobId)}/fail`, {
	          method: "POST",
	          body: JSON.stringify({
	            status: "cancelled",
	            errorCode: result.errorCode || "target_latest_unverified",
	            error: result.error || "发送前无法确认目标会话最新消息，取消本次发送。",
	            now: new Date().toISOString()
	          })
	        });
	        console.error(`pre-send unverified ${job.jobId}: ${result.error || "latest message unverified"}`);
	        continue;
	      }
	      if (result.status && result.status !== "sent") {
	        throw new Error(`${result.errorCode || result.status}: ${result.error || "WeCom local send did not complete"}`);
	      }
      await api(`/api/wecom-client/realtime/send-jobs/${encodeURIComponent(job.jobId)}/dispatched`, {
        method: "POST",
        body: JSON.stringify({
          gatewayMode: "wecom-client-local-script",
          gatewayRequestId: result.gatewayRequestId || result.requestId || result.id || "",
          externalMessageId: result.externalMessageId || result.messageId || result.msgid || "",
          openStrategy: result.openStrategy || result.timings?.openStrategy || "",
          sendTimings: result.timings || {},
          preSendGuard: result.preSendGuard || null,
          now: new Date().toISOString()
        })
      });
      dispatched += 1;
      console.log(`dispatched ${job.jobId} strategy=${result.openStrategy || result.timings?.openStrategy || "unknown"} totalMs=${result.timings?.totalMs || 0}`);
    } catch (error) {
      failed += 1;
      await api(`/api/wecom-client/realtime/send-jobs/${encodeURIComponent(job.jobId)}/fail`, {
        method: "POST",
        body: JSON.stringify({
          errorCode: error.errorCode || error.payload?.errorCode || error.payload?.status || "",
          error: error.message,
          now: new Date().toISOString()
        })
      });
      console.error(`failed ${job.jobId}: ${error.message}`);
    }
    if (worker.canReceive === true) {
      try {
        const hint = { ...unreadHint, source: "resident-monitor" };
        postSendUnreadStatus = {
          checked: true,
          hasUnread: Boolean(hint.hasUnread),
          source: hint.source || "",
          timings: { totalMs: hint.lastStatusMs || 0 },
          detectedAt: hint.detectedAt || "",
          error: hint.error || ""
        };
        if (hint.hasUnread) {
          const latestReport = await api("/api/wecom-client/realtime/config");
          const latestConfig = latestReport.config || config;
          const latestWorker = latestConfig.worker || worker;
          postSendReceiveResult = await pullRealtime(latestConfig, latestWorker);
          postSendReceiveResult.postSendReceive = true;
          markUnreadHint({ hasUnread: false });
        }
        break;
      } catch (error) {
        postSendUnreadStatus = {
          checked: true,
          hasUnread: false,
          source: "resident-monitor",
          error: error.message
        };
        console.error(`post-send unread status failed: ${error.message}`);
        break;
      }
    }
  }
  const shouldIdle = needsIdleAfterReceive(receiveResult) ||
    needsIdleAfterReceive(postSendReceiveResult) ||
    watchResult.pulled > 0 ||
    watchResult.acked > 0 ||
    watchResult.confirmations > 0 ||
    watchResult.exitedForTask ||
    dispatched > 0 ||
    failed > 0 ||
    preSendAborted > 0;
  const idleResult = shouldIdle
    ? await resetLocalWorkerToIdleIfNoImmediateTask(worker, "worker-cycle-complete", guardedRoomIds)
    : { attempted: false, reset: false };
  return {
    checked: false,
    dispatched,
    failed,
    preSendAborted,
    preSendInboundCount,
    preSendAcked,
    postSendPulled: postSendReceiveResult.pulled || 0,
    postSendAcked: postSendReceiveResult.acked || 0,
    postSendFailedInbound: postSendReceiveResult.failedInbound || 0,
    postSendRoomName: postSendReceiveResult.roomName || "",
    postSendUnreadStatus,
    schedulerDispatched: schedulerResult.dispatched || [],
    schedulerSkipped: schedulerResult.skipped || [],
    schedulerExpired: schedulerResult.expired || [],
    idleReset: idleResult,
    ...receiveResult,
    watched: Boolean(watchResult.watched),
    watchCycles: watchResult.watchCycles || 0,
    watchPulled: watchResult.pulled || 0,
    watchAcked: watchResult.acked || 0,
    watchRoomId: watchResult.watchRoomId || "",
    watchRoomName: watchResult.watchRoomName || "",
    watchExitedForTask: Boolean(watchResult.exitedForTask),
    guardedRoomIds
  };
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
