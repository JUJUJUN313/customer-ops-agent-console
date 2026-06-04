import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  audit,
  batchUpdateOutboundDraftsAction,
  batchUpdateTasksAction,
  buildCapabilityAudit,
  buildChatSessionsReport,
  buildModelConfigReport,
  buildOutboundDraftReport,
  buildPersonalWechatReport,
  buildTaskSlaReport,
  buildWecomConfigReport,
  bindChatSessionCustomerAction,
  createCustomerAction,
  createOutboundDraftAction,
  createSalesSampleAction,
  createTaskAction,
  diagnoseState,
  escalateOverdueTasksAction,
  enhanceLatestAgentRunWithLlmAction,
  approvePersonalWechatSendJobAction,
  confirmPersonalWechatSendJobAction,
  failPersonalWechatSendJobAction,
  getChatSessionReport,
  ingestMessageAction,
  ingestPersonalWechatMessageAction,
  ingestWecomArchiveMessageAction,
  ingestWecomMessageAction,
  recordOutcomeAction,
  markPersonalWechatSendJobDispatchedAction,
  runAgentAction,
  runDemoAction,
  runWorkflowAction,
  seedState,
  sendOutboundDraftToWecomAction,
  sendWecomTestAction,
  runPersonalWechatSendSchedulerAction,
  subscribeQuoteAction,
  testWecomAibotConfigAction,
  testModelConnectionAction,
  updateCustomerAction,
  updateModelConfigAction,
  updatePersonalWechatConfigAction,
  updatePersonalWechatGatewayStatusAction,
  updateWecomBridgeStatusAction,
  updateWecomArchiveStatusAction,
  updateWecomGroupBindingAction,
  updateOutboundDraftStatusAction,
  updateTaskAction,
  updateTemplateAction,
  updateWecomConfigAction,
  replyChatSessionAction,
  upsertQuoteAction
} from "../src/systemActions.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataDir = join(root, "data");
const statePath = join(dataDir, "state.json");
const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const port = Number(portArg?.split("=")[1] || process.env.PORT || 5175);
const host = "127.0.0.1";
let mutationQueue = Promise.resolve();

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
};

function endpointWithPath(base = "", path = "/health") {
  const cleanBase = String(base || "").replace(/\/+$/, "");
  if (!cleanBase) throw new Error("Sidecar URL is empty");
  return `${cleanBase}${path.startsWith("/") ? path : `/${path}`}`;
}

async function checkHttpEndpoint(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json,text/plain,*/*" }
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return {
      ok: response.ok,
      httpStatus: response.status,
      latencyMs: Date.now() - startedAt,
      body,
      bodyPreview: text.slice(0, 180)
    };
  } finally {
    clearTimeout(timer);
  }
}

function ensureStore() {
  mkdirSync(dataDir, { recursive: true });
  if (!existsSync(statePath)) {
    writeState(seedState());
  }
}

function readState() {
  ensureStore();
  return JSON.parse(readFileSync(statePath, "utf8"));
}

function writeState(state) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function publicModelConfig(state) {
  const report = buildModelConfigReport(state);
  const sourceConfig = state.modelConfig || {};
  const agents = {};
  for (const item of report.agents) {
    const sourceOverride = sourceConfig.agents?.[item.key] || {};
    agents[item.key] = {
      ...sourceOverride,
      apiKey: "",
      apiKeyConfigured: item.override.apiKeyConfigured,
      apiKeyMasked: item.override.apiKeyMasked
    };
  }
  return {
    global: {
      ...(sourceConfig.global || {}),
      apiKey: "",
      apiKeyConfigured: report.global.apiKeyConfigured,
      apiKeyMasked: report.global.apiKeyMasked
    },
    voice: {
      asr: {
        ...(sourceConfig.voice?.asr || {}),
        apiKey: "",
        apiKeyConfigured: report.voice.asr.apiKeyConfigured,
        apiKeyMasked: report.voice.asr.apiKeyMasked
      },
      tts: {
        ...(sourceConfig.voice?.tts || {}),
        apiKey: "",
        apiKeyConfigured: report.voice.tts.apiKeyConfigured,
        apiKeyMasked: report.voice.tts.apiKeyMasked
      }
    },
    agents
  };
}

function publicState(state) {
  const copy = structuredClone(state);
  copy.modelConfig = publicModelConfig(state);
  const wecomReport = buildWecomConfigReport(state);
  copy.wecomConfig = wecomReport.config;
  copy.wecomBindings = { groups: wecomReport.bindings || [] };
  copy.wecomLogs = Array.isArray(state.wecomLogs) ? state.wecomLogs.slice(0, 100) : [];
  copy.personalWechat = buildPersonalWechatReport(state).config;
  return copy;
}

function mutateState(mutator) {
  const run = mutationQueue.then(async () => {
    const nextState = await mutator(readState());
    writeState(nextState);
    return nextState;
  });
  mutationQueue = run.catch(() => {});
  return run;
}

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        rejectBody(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch (error) {
        rejectBody(error);
      }
    });
  });
}

function safePath(urlPath) {
  let decoded = "/";
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0] || "/");
  } catch {
    return join(root, "index.html");
  }
  const normalizedPath = normalize(decoded).replace(/^[/\\]+/, "");
  const candidate = resolve(root, normalizedPath || "index.html");
  const relativePath = relative(root, candidate);
  if (relativePath === ".." || relativePath.startsWith("../") || relativePath.startsWith("..\\")) {
    return join(root, "index.html");
  }
  return candidate;
}

function staticAccessDenied(filePath) {
  const relativePath = relative(root, filePath);
  const segments = relativePath.split(/[\\/]/);
  return segments[0] === "data" || segments.some((segment) => segment.startsWith("."));
}

function notFound(res) {
  res.writeHead(404, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end("Not found");
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/health") {
    return json(res, 200, { ok: true, mode: "offline-api", statePath });
  }

  if (req.method === "GET" && pathname === "/api/state") {
    return json(res, 200, publicState(readState()));
  }

  if (req.method === "GET" && pathname === "/api/diagnostics") {
    return json(res, 200, diagnoseState(readState()));
  }

  if (req.method === "GET" && pathname === "/api/capabilities") {
    return json(res, 200, buildCapabilityAudit(readState()));
  }

  if (req.method === "GET" && pathname === "/api/chat/sessions") {
    return json(res, 200, buildChatSessionsReport(readState()));
  }

  const chatSessionMatch = pathname.match(/^\/api\/chat\/sessions\/([^/]+)$/);
  if (req.method === "GET" && chatSessionMatch) {
    return json(res, 200, getChatSessionReport(readState(), chatSessionMatch[1]));
  }

  if (req.method === "GET" && pathname === "/api/tasks/sla") {
    return json(res, 200, buildTaskSlaReport(readState()));
  }

  if (req.method === "GET" && pathname === "/api/model-config") {
    return json(res, 200, buildModelConfigReport(readState()));
  }

  if (req.method === "GET" && pathname === "/api/wecom/config") {
    return json(res, 200, buildWecomConfigReport(readState()));
  }

  if (req.method === "GET" && pathname === "/api/personal-wechat/config") {
    return json(res, 200, buildPersonalWechatReport(readState()));
  }

  if (req.method === "GET" && pathname === "/api/wecom/aibot/check") {
    return json(res, 200, testWecomAibotConfigAction(readState()));
  }

  if (req.method === "POST" && pathname === "/api/wecom/archive/check-sidecar") {
    const currentState = readState();
    const archive = currentState.wecomConfig?.archive || {};
    const missing = [];
    if (!archive.enabled) missing.push("enabled");
    if (archive.gatewayMode !== "sidecar") missing.push("gatewayMode=sidecar");
    if (!archive.sidecarUrl) missing.push("sidecarUrl");
    if (!archive.corpId) missing.push("corpId");
    if (!archive.archiveSecret) missing.push("archiveSecret");
    if (!archive.privateKey) missing.push("privateKey");
    if (missing.length) {
      const detail = `会话存档配置未完成：${missing.join("、")}`;
      const nextState = await mutateState((state) => updateWecomArchiveStatusAction(state, {
        status: "检查失败",
        trustedStatus: "配置未完成",
        detail,
        error: detail
      }));
      return json(res, 200, { ok: false, missing, state: publicState(nextState) });
    }
    try {
      const healthUrl = endpointWithPath(archive.sidecarUrl, "/health");
      const result = await checkHttpEndpoint(healthUrl, 5000);
      const ok = Boolean(result.ok);
      const health = result.body?.capabilities || result.body || {};
      const canPull = ok && (health.canPull !== false);
      const decryptReady = ok && (health.decryptReady !== false);
      const nextState = await mutateState((state) => updateWecomArchiveStatusAction(state, {
        status: ok && canPull && decryptReady ? "检查通过" : "检查失败",
        trustedStatus: ok && canPull && decryptReady ? "sidecar可拉取" : ok ? "sidecar能力不足" : "sidecar异常",
        detail: ok
          ? `Sidecar健康检查 ${result.httpStatus}，${result.latencyMs}ms，拉取 ${canPull ? "可用" : "不可用"}，解密 ${decryptReady ? "可用" : "不可用"}`
          : `Sidecar健康检查失败 HTTP ${result.httpStatus}`,
        error: ok && canPull && decryptReady ? "" : ok ? "Sidecar未声明可拉取或可解密" : `Sidecar健康检查失败 HTTP ${result.httpStatus}`
      }));
      return json(res, 200, { ok: ok && canPull && decryptReady, url: healthUrl, result, capability: { canPull, decryptReady }, state: publicState(nextState) });
    } catch (error) {
      const nextState = await mutateState((state) => updateWecomArchiveStatusAction(state, {
        status: "检查失败",
        trustedStatus: "sidecar不可达",
        detail: "会话存档Sidecar不可达",
        error: error.message
      }));
      return json(res, 200, { ok: false, error: error.message, state: publicState(nextState) });
    }
  }

  if (req.method === "POST" && pathname === "/api/personal-wechat/gateway/check") {
    const currentState = readState();
    const personalWechat = currentState.personalWechat || {};
    const gateway = personalWechat.gateway || {};
    if (gateway.mode === "disabled") {
      const nextState = await mutateState((state) => updatePersonalWechatGatewayStatusAction(state, {
        status: "检查失败",
        detail: "统一出站Gateway已停用",
        error: "统一出站Gateway已停用"
      }));
      return json(res, 200, { ok: false, missing: ["gateway.mode"], state: publicState(nextState) });
    }
    if (gateway.mode === "mock" || !gateway.mode) {
      const nextState = await mutateState((state) => updatePersonalWechatGatewayStatusAction(state, {
        status: "Mock检查通过",
        connected: true,
        canSend: false,
        sendMode: "proactive",
        supportsConfirm: false,
        supportsRecall: false,
        detail: "当前为Mock本地验证模式，不会调用外部Sidecar"
      }));
      return json(res, 200, { ok: true, mode: "mock", state: publicState(nextState) });
    }
    const missing = [];
    if (!gateway.sidecarUrl) missing.push("sidecarUrl");
    if (!gateway.sendEndpoint) missing.push("sendEndpoint");
    if (missing.length) {
      const detail = `个人微信Gateway配置未完成：${missing.join("、")}`;
      const nextState = await mutateState((state) => updatePersonalWechatGatewayStatusAction(state, {
        status: "检查失败",
        detail,
        error: detail
      }));
      return json(res, 200, { ok: false, missing, state: publicState(nextState) });
    }
    try {
      const healthUrl = endpointWithPath(gateway.sidecarUrl, "/health");
      const result = await checkHttpEndpoint(healthUrl, 5000);
      const ok = Boolean(result.ok);
      const capability = result.body?.capabilities || result.body || {};
      const canSend = ok && (capability.canSend === true || capability.send?.enabled === true);
      const sendMode = capability.sendMode === "reply_window" || capability.sendMode === "proactive"
        ? capability.sendMode
        : capability.send?.mode === "reply_window" || capability.send?.mode === "proactive"
          ? capability.send.mode
          : "proactive";
      const supportsConfirm = ok && (capability.supportsConfirm === true || capability.confirm?.enabled === true);
      const supportsRecall = ok && (capability.supportsRecall === true || capability.recall?.enabled === true);
      const nextState = await mutateState((state) => updatePersonalWechatGatewayStatusAction(state, {
        status: ok ? canSend ? "Sidecar可发送" : "Sidecar可达但不可发送" : "检查失败",
        connected: ok,
        canSend,
        sendMode,
        supportsConfirm,
        supportsRecall,
        detail: ok
          ? `Sidecar健康检查 ${result.httpStatus}，${result.latencyMs}ms，发送能力 ${canSend ? "可用" : "不可用"}`
          : `Sidecar健康检查失败 HTTP ${result.httpStatus}`,
        error: ok ? canSend ? "" : "Sidecar未声明canSend=true" : `Sidecar健康检查失败 HTTP ${result.httpStatus}`
      }));
      return json(res, 200, { ok: ok && canSend, url: healthUrl, result, capability: { canSend, sendMode, supportsConfirm, supportsRecall }, state: publicState(nextState) });
    } catch (error) {
      const nextState = await mutateState((state) => updatePersonalWechatGatewayStatusAction(state, {
        status: "检查失败",
        canSend: false,
        detail: "统一出站Sidecar不可达",
        error: error.message
      }));
      return json(res, 200, { ok: false, error: error.message, state: publicState(nextState) });
    }
  }

  if (req.method === "POST" && pathname === "/api/model-config/test") {
    const body = await readBody(req);
    return json(res, 200, await testModelConnectionAction(readState(), body));
  }

  if (req.method === "GET" && pathname === "/api/outbound-drafts") {
    return json(res, 200, buildOutboundDraftReport(readState()));
  }

  if (req.method === "POST" && pathname === "/api/reset") {
    const state = await mutateState(() => {
      const nextState = seedState();
      audit(nextState, "重置本地样例数据", "state");
      return nextState;
    });
    return json(res, 200, publicState(state));
  }

  if (req.method === "POST" && pathname === "/api/demo/run") {
    const state = await mutateState((currentState) => runDemoAction(currentState));
    return json(res, 200, publicState(state));
  }

  if (req.method === "POST" && pathname === "/api/workflow/run") {
    const state = await mutateState((currentState) => runWorkflowAction(currentState));
    return json(res, 200, publicState(state));
  }

  const agentMatch = pathname.match(/^\/api\/agents\/([^/]+)\/run$/);
  if (req.method === "POST" && agentMatch) {
    const body = await readBody(req);
    let nextState = await mutateState((currentState) => runAgentAction(currentState, agentMatch[1], body));
    if (body.useLlm === true || body.useLlm === "true") {
      nextState = await mutateState((currentState) => enhanceLatestAgentRunWithLlmAction(currentState, agentMatch[1], body));
    }
    return json(res, 200, publicState(nextState));
  }

  const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/status$/);
  if (req.method === "POST" && taskMatch) {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => updateTaskAction(currentState, taskMatch[1], body.status || "跟进中"));
    return json(res, 200, publicState(nextState));
  }

  if (req.method === "POST" && pathname === "/api/tasks/batch-status") {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => batchUpdateTasksAction(currentState, body));
    return json(res, 200, publicState(nextState));
  }

  if (req.method === "POST" && pathname === "/api/quotes/subscribe") {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => subscribeQuoteAction(currentState, body.customerId, body.model));
    return json(res, 200, publicState(nextState));
  }

  if (req.method === "POST" && pathname === "/api/channels/message") {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => ingestMessageAction(currentState, body));
    return json(res, 200, publicState(nextState));
  }

  if (req.method === "POST" && pathname === "/api/customers") {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => createCustomerAction(currentState, body));
    return json(res, 200, publicState(nextState));
  }

  const customerMatch = pathname.match(/^\/api\/customers\/([^/]+)$/);
  if (req.method === "POST" && customerMatch) {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => updateCustomerAction(currentState, customerMatch[1], body));
    return json(res, 200, publicState(nextState));
  }

  const outcomeMatch = pathname.match(/^\/api\/customers\/([^/]+)\/outcome$/);
  if (req.method === "POST" && outcomeMatch) {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => recordOutcomeAction(currentState, { customerId: outcomeMatch[1], ...body }));
    return json(res, 200, publicState(nextState));
  }

  if (req.method === "POST" && pathname === "/api/tasks") {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => createTaskAction(currentState, body));
    return json(res, 200, publicState(nextState));
  }

  if (req.method === "POST" && pathname === "/api/tasks/escalate") {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => escalateOverdueTasksAction(currentState, body));
    return json(res, 200, publicState(nextState));
  }

  if (req.method === "POST" && pathname === "/api/quotes") {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => upsertQuoteAction(currentState, body));
    return json(res, 200, publicState(nextState));
  }

  if (req.method === "POST" && pathname === "/api/sales-samples") {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => createSalesSampleAction(currentState, body));
    return json(res, 200, publicState(nextState));
  }

  if (req.method === "POST" && pathname === "/api/model-config") {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => updateModelConfigAction(currentState, body));
    return json(res, 200, publicState(nextState));
  }

  if (req.method === "POST" && pathname === "/api/wecom/config") {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => updateWecomConfigAction(currentState, body));
    return json(res, 200, publicState(nextState));
  }

  if (req.method === "POST" && pathname === "/api/wecom/aibot/status") {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => updateWecomBridgeStatusAction(currentState, body));
    return json(res, 200, publicState(nextState));
  }

  if (req.method === "POST" && pathname === "/api/wecom/archive/status") {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => updateWecomArchiveStatusAction(currentState, body));
    return json(res, 200, publicState(nextState));
  }

  if (req.method === "POST" && pathname === "/api/wecom/group-bindings") {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => updateWecomGroupBindingAction(currentState, body));
    return json(res, 200, publicState(nextState));
  }

  const chatReplyMatch = pathname.match(/^\/api\/chat\/sessions\/([^/]+)\/reply$/);
  if (req.method === "POST" && chatReplyMatch) {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => replyChatSessionAction(currentState, chatReplyMatch[1], body));
    return json(res, 200, publicState(nextState));
  }

  const chatBindMatch = pathname.match(/^\/api\/chat\/sessions\/([^/]+)\/bind-customer$/);
  if (req.method === "POST" && chatBindMatch) {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => bindChatSessionCustomerAction(currentState, chatBindMatch[1], body));
    return json(res, 200, publicState(nextState));
  }

  if (req.method === "POST" && pathname === "/api/wecom/test-send") {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => sendWecomTestAction(currentState, body));
    return json(res, 200, publicState(nextState));
  }

  if (req.method === "POST" && pathname === "/api/wecom/inbound") {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => ingestWecomMessageAction(currentState, body));
    return json(res, 200, publicState(nextState));
  }

  if (req.method === "POST" && pathname === "/api/wecom/archive/inbound") {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => ingestWecomArchiveMessageAction(currentState, body));
    return json(res, 200, publicState(nextState));
  }

  if (req.method === "POST" && pathname === "/api/personal-wechat/config") {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => updatePersonalWechatConfigAction(currentState, body));
    return json(res, 200, publicState(nextState));
  }

  if (req.method === "POST" && pathname === "/api/personal-wechat/inbound") {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => ingestPersonalWechatMessageAction(currentState, body));
    return json(res, 200, publicState(nextState));
  }

  if (req.method === "POST" && pathname === "/api/personal-wechat/send-scheduler/run") {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => runPersonalWechatSendSchedulerAction(currentState, body));
    return json(res, 200, publicState(nextState));
  }

  const personalWechatConfirmMatch = pathname.match(/^\/api\/personal-wechat\/send-jobs\/([^/]+)\/confirm$/);
  if (req.method === "POST" && personalWechatConfirmMatch) {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => confirmPersonalWechatSendJobAction(currentState, personalWechatConfirmMatch[1], body));
    return json(res, 200, publicState(nextState));
  }

  const personalWechatApproveMatch = pathname.match(/^\/api\/personal-wechat\/send-jobs\/([^/]+)\/approve$/);
  if (req.method === "POST" && personalWechatApproveMatch) {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => approvePersonalWechatSendJobAction(currentState, personalWechatApproveMatch[1], body));
    return json(res, 200, publicState(nextState));
  }

  const personalWechatDispatchedMatch = pathname.match(/^\/api\/personal-wechat\/send-jobs\/([^/]+)\/dispatched$/);
  if (req.method === "POST" && personalWechatDispatchedMatch) {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => markPersonalWechatSendJobDispatchedAction(currentState, personalWechatDispatchedMatch[1], body));
    return json(res, 200, publicState(nextState));
  }

  const personalWechatFailMatch = pathname.match(/^\/api\/personal-wechat\/send-jobs\/([^/]+)\/fail$/);
  if (req.method === "POST" && personalWechatFailMatch) {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => failPersonalWechatSendJobAction(currentState, personalWechatFailMatch[1], body));
    return json(res, 200, publicState(nextState));
  }

  if (req.method === "POST" && pathname === "/api/outbound-drafts") {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => createOutboundDraftAction(currentState, body));
    return json(res, 200, publicState(nextState));
  }

  const draftStatusMatch = pathname.match(/^\/api\/outbound-drafts\/([^/]+)\/status$/);
  if (req.method === "POST" && draftStatusMatch) {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => updateOutboundDraftStatusAction(currentState, draftStatusMatch[1], body));
    return json(res, 200, publicState(nextState));
  }

  const draftWecomMatch = pathname.match(/^\/api\/outbound-drafts\/([^/]+)\/send-wecom$/);
  if (req.method === "POST" && draftWecomMatch) {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => sendOutboundDraftToWecomAction(currentState, draftWecomMatch[1], body));
    return json(res, 200, publicState(nextState));
  }

  if (req.method === "POST" && pathname === "/api/outbound-drafts/batch-status") {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => batchUpdateOutboundDraftsAction(currentState, body));
    return json(res, 200, publicState(nextState));
  }

  const templateMatch = pathname.match(/^\/api\/templates\/([^/]+)$/);
  if (req.method === "POST" && templateMatch) {
    const body = await readBody(req);
    const nextState = await mutateState((currentState) => updateTemplateAction(currentState, templateMatch[1], body));
    return json(res, 200, publicState(nextState));
  }

  return json(res, 404, { error: "API not found" });
}

function serveStatic(req, res) {
  let filePath = safePath(req.url || "/");
  if (staticAccessDenied(filePath)) {
    notFound(res);
    return;
  }
  if (!existsSync(filePath)) {
    filePath = join(root, "index.html");
  }
  if (statSync(filePath).isDirectory()) {
    filePath = join(filePath, "index.html");
  }
  if (staticAccessDenied(filePath)) {
    notFound(res);
    return;
  }
  const type = mime[extname(filePath)] || "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": "no-store"
  });
  createReadStream(filePath).pipe(res);
}

ensureStore();

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${host}:${port}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
      return;
    }
    serveStatic(req, res);
  } catch (error) {
    const clientError = /not found|required|invalid|must be|too large|json|unexpected token/i.test(error.message);
    json(res, clientError ? 400 : 500, { error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`Customer ops console running at http://${host}:${port}`);
  console.log(`Offline API state file: ${statePath}`);
});
