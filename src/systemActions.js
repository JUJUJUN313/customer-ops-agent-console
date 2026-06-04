import { initialState, STAGES } from "./data.js";
import {
  cloneState,
  getCustomer,
  runOrchestratorAgent,
  runDialerAgent,
  runNurtureAgent,
  runQuoteAgent,
  runSalesAgent,
  runVipAgent,
  subscribeQuote,
  updateTaskStatus
} from "./agentEngine.js";
import { invokeChatCompletion } from "./llmClient.js";
import { maskWebhookUrl, sendWecomGroupRobotMessage } from "./wecomClient.js";

const VALID_RISKS = new Set(["低", "中", "高"]);
const VALID_PRIORITIES = new Set(["低", "中", "高"]);
const VALID_OWNER_ROLES = new Set(["电销", "销售", "私域", "客服", "售后", "主管", "运营"]);
const VALID_MESSAGE_ROLES = new Set(["客户", ...VALID_OWNER_ROLES]);
const VALID_TEMPLATE_RISKS = new Set(["低", "中", "高"]);
const VALID_STAGES = new Set(STAGES);
const VALID_TASK_STATUSES = new Set(["待处理", "跟进中", "已完成"]);
const VALID_DRAFT_STATUSES = new Set(["待确认", "已确认", "已复制", "人工已处理", "已废弃", "企微已发送"]);
const VALID_DRAFT_CHANNELS = new Set(["电话外呼", "短信", "企微私聊", "VIP群", "报价页", "人工触达"]);
const VALID_WECOM_SEND_MODES = new Set(["manualApproval", "testOnly"]);
const VALID_WECOM_MSGTYPES = new Set(["markdown", "text"]);
const VALID_OUTCOMES = new Set(["成交", "继续培育", "暂缓", "无效"]);
const VALID_SAMPLE_OUTCOMES = new Set(["成交", "继续培育", "暂缓", "无效"]);
const MODEL_AGENT_DEFINITIONS = [
  { key: "dialer", agentName: "外呼筛选Agent", scene: "电销外呼筛选" },
  { key: "nurture", agentName: "电销培育Agent", scene: "电销企微培育" },
  { key: "sales", agentName: "销售承接Agent", scene: "会员卡销售承接" },
  { key: "vip", agentName: "VIP群分流Agent", scene: "VIP小群分流" },
  { key: "quote", agentName: "报价推荐Agent", scene: "报价推荐" },
  { key: "orchestrator", agentName: "闭环编排Agent", scene: "全链路编排" }
];
const MODEL_AGENT_KEYS = new Set(MODEL_AGENT_DEFINITIONS.map((item) => item.key));
const DEFAULT_MODEL_CONFIG = {
  global: {
    provider: "DeepSeek兼容网关",
    apiUrl: "https://api.deepseek.com",
    apiKey: "",
    model: "deepseek-v4-flash",
    temperature: 0.2,
    maxTokens: 4096
  },
  voice: {
    asr: {
      provider: "未配置",
      apiUrl: "",
      apiKey: "",
      model: "",
      language: "zh-CN"
    },
    tts: {
      provider: "未配置",
      apiUrl: "",
      apiKey: "",
      model: "",
      voice: "默认",
      speed: 1
    }
  },
  agents: Object.fromEntries(MODEL_AGENT_DEFINITIONS.map((item) => [
    item.key,
    { provider: "", apiUrl: "", apiKey: "", model: "", temperature: "", maxTokens: "" }
  ]))
};
const DEFAULT_WECOM_CONFIG = {
  enabled: false,
  sendMode: "manualApproval",
  defaultRouteId: "wecom_route_default",
  routes: [
    {
      id: "wecom_route_default",
      name: "企微测试群机器人",
      channel: "VIP群",
      webhookUrl: "",
      msgtype: "markdown",
      enabled: false
    }
  ],
  inbound: {
    enabled: true,
    defaultChannel: "VIP群",
    secret: ""
  },
  aibot: {
    enabled: false,
    botId: "",
    secret: "",
    wsUrl: "",
    defaultCustomerId: "",
    defaultChannel: "VIP群",
    autoReply: false,
    welcomeText: "您好，我是客户运营助手，已收到您的消息，会先整理需求并同步给对应同事。",
    heartbeatInterval: 30000,
    maxReconnectAttempts: 10,
    bridgeStatus: "未启动",
    lastConnectedAt: "",
    lastEventAt: "",
    lastError: ""
  },
  archive: {
    enabled: false,
    provider: "企微会话内容存档",
    cursor: "",
    lastPulledAt: "",
    lastMessageAt: "",
    status: "未配置",
    lastError: "",
    defaultCustomerId: "",
    defaultChannel: "VIP群"
  }
};
const DEFAULT_WECOM_BINDINGS = { groups: [] };
const DEFAULT_PERSONAL_WECHAT = {
  enabled: true,
  account: {
    id: "personal_wx_default",
    name: "个人微信托管号",
    displayName: "VIP群AccountAgent",
    defaultCustomerId: "",
    autoReply: true,
    requireApprovalForRisk: true,
    minSendIntervalSeconds: 3,
    concurrency: 1,
    maxSendsPerMinute: 20,
    maxQueueAgeSeconds: 60,
    failureBackoffSeconds: 30,
    mergeWindowSeconds: 45,
    status: "未连接",
    lastEventAt: "",
    lastError: ""
  },
  groupContexts: [],
  sendJobs: [],
  decisions: [],
  logs: []
};
const ACTIVE_PERSONAL_WECHAT_JOB_STATUSES = new Set(["queued", "sending", "sent", "manual_required"]);
const DISPATCHABLE_PERSONAL_WECHAT_JOB_STATUSES = new Set(["queued"]);
const HIGH_RISK_REPLY_PATTERNS = [
  /报价|价格|多少钱|锁价|保价|今日价|底价|优惠/,
  /退款|退货|赔偿|补偿|投诉|维权/,
  /合同|协议|付款|打款|定金|发票/,
  /承诺|保证|责任|维修责任|交付时间/
];

function id(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function nowLabel() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date());
}

function appendEvent(state, customerId, event) {
  state.events = Array.isArray(state.events) ? state.events : [];
  const createdAt = new Date().toISOString();
  state.events.unshift({
    id: id("e"),
    customerId,
    time: nowLabel(),
    createdAt,
    ...event,
    createdAt: event.createdAt || createdAt
  });
  state.events = state.events.slice(0, 500);
}

function mentionsFromText(text) {
  return [...String(text || "").matchAll(/@([\u4e00-\u9fa5A-Za-z0-9_]+)/g)].map((match) => match[1]);
}

function defaultMembersFor(customer, channel) {
  const base = [{ name: customer.contact || customer.name, role: "客户" }];
  if (channel.includes("VIP")) {
    return [
      ...base,
      { name: customer.owner || "私域顾问", role: "私域" },
      { name: "销售值班", role: "销售" },
      { name: "客服值班", role: "客服" },
      { name: "售后值班", role: "售后" }
    ];
  }
  if (channel.includes("销售")) return [...base, { name: customer.owner || "销售值班", role: "销售" }];
  return [...base, { name: customer.owner || "电销值班", role: "电销" }];
}

function appendConversationMessage(state, payload = {}) {
  state.conversations = Array.isArray(state.conversations) ? state.conversations : [];
  const customer = requireCustomer(state, payload.customerId);
  const channel = cleanText(payload.channel, "本地渠道");
  const messageText = cleanText(payload.message);
  if (!messageText) throw new Error("Channel message is required");
  let conversation = state.conversations.find(
    (item) => item.customerId === customer.id && item.channel === channel
  );
  if (!conversation) {
    conversation = {
      id: id("conv"),
      customerId: customer.id,
      channel,
      title: `${customer.name}${channel.includes("VIP") ? "会员小群" : channel}`,
      members: defaultMembersFor(customer, channel),
      messages: []
    };
    state.conversations.unshift(conversation);
  }
  if (!Array.isArray(conversation.messages)) conversation.messages = [];
  if (!Array.isArray(conversation.members)) conversation.members = defaultMembersFor(customer, channel);
  const senderRole = normalizeMessageRole(payload.senderRole, "客户");
  const sender = cleanText(payload.senderName, senderRole === "客户" ? customer.contact || customer.name : `${senderRole}值班`);
  const message = {
    id: id("m"),
    sender,
    senderRole,
    text: messageText,
    mentions: mentionsFromText(messageText),
    time: nowLabel(),
    createdAt: new Date().toISOString()
  };
  conversation.messages.push(message);
  conversation.messages = conversation.messages.slice(-80);
  return message;
}

function appendTask(state, customerId, task) {
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const existing = state.tasks.find(
    (item) => item.customerId === customerId && item.title === task.title && item.status !== "已完成"
  );
  if (existing) {
    existing.reason = task.reason || existing.reason;
    existing.priority = task.priority || existing.priority;
    existing.ownerRole = task.ownerRole || existing.ownerRole;
    existing.owner = task.owner || existing.owner;
    existing.sla = task.sla || existing.sla;
    return ensureTaskTiming(existing);
  }
  const next = {
    id: id("t"),
    customerId,
    owner: task.owner || "待分配",
    status: "待处理",
    sla: task.sla || "2小时",
    ...task
  };
  ensureTaskTiming(next);
  state.tasks.unshift(next);
  return next;
}

function listFromInput(value) {
  return String(value || "")
    .split(/[，,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeStage(value, fallback = "待筛选") {
  const stage = cleanText(value, fallback);
  if (!VALID_STAGES.has(stage)) throw new Error(`Invalid customer stage: ${stage}`);
  return stage;
}

function normalizeTaskStatus(value, fallback = "跟进中") {
  const status = cleanText(value, fallback);
  if (!VALID_TASK_STATUSES.has(status)) throw new Error(`Invalid task status: ${status}`);
  return status;
}

function normalizeRisk(value, fallback = "低") {
  const risk = cleanText(value, fallback);
  if (!VALID_RISKS.has(risk)) throw new Error(`Invalid customer risk: ${risk}`);
  return risk;
}

function normalizePriority(value, fallback = "中") {
  const priority = cleanText(value, fallback);
  if (!VALID_PRIORITIES.has(priority)) throw new Error(`Invalid task priority: ${priority}`);
  return priority;
}

function normalizeOwnerRole(value, fallback = "销售") {
  const role = cleanText(value, fallback);
  if (!VALID_OWNER_ROLES.has(role)) throw new Error(`Invalid owner role: ${role}`);
  return role;
}

function normalizeMessageRole(value, fallback = "客户") {
  const role = cleanText(value, fallback);
  if (!VALID_MESSAGE_ROLES.has(role)) throw new Error(`Invalid sender role: ${role}`);
  return role;
}

function normalizeSampleOutcome(value, fallback = "成交") {
  const outcome = cleanText(value, fallback);
  if (!VALID_SAMPLE_OUTCOMES.has(outcome)) throw new Error(`Invalid sales sample outcome: ${outcome}`);
  return outcome;
}

function normalizeSalesOutcome(value, fallback = "继续培育") {
  const outcome = cleanText(value, fallback);
  if (!VALID_OUTCOMES.has(outcome)) throw new Error(`Invalid sales outcome: ${outcome}`);
  return outcome;
}

function finiteNumber(value, fallback = 0) {
  if (value === "" || value === null || value === undefined) return fallback;
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function boundedScore(value, fallback = 30) {
  const safeFallback = finiteNumber(fallback, 30);
  return Math.max(0, Math.min(100, finiteNumber(value, safeFallback)));
}

function cleanLimitedText(value, fallback = "", maxLength = 120) {
  return cleanText(value, fallback).slice(0, maxLength);
}

function normalizeTemperature(value, fallback = 0.2, allowEmpty = false) {
  if (allowEmpty && (value === "" || value === null || value === undefined)) return "";
  const next = finiteNumber(value, fallback);
  return Math.round(Math.max(0, Math.min(2, next)) * 100) / 100;
}

function normalizeMaxTokens(value, fallback = 2000, allowEmpty = false) {
  if (allowEmpty && (value === "" || value === null || value === undefined)) return "";
  const next = Math.round(finiteNumber(value, fallback));
  return Math.max(256, Math.min(200000, next));
}

function normalizeApiUrl(value, fallback = "", allowEmpty = true) {
  const next = cleanLimitedText(value, fallback, 300).replace(/\/+$/, "");
  if (!next) {
    if (allowEmpty) return "";
    throw new Error("API URL is required");
  }
  if (!/^https?:\/\//i.test(next)) throw new Error(`Invalid API URL: ${next}`);
  return next;
}

function normalizeWebSocketUrl(value, fallback = "") {
  const next = cleanLimitedText(value, fallback, 300).replace(/\/+$/, "");
  if (!next) return "";
  if (!/^wss?:\/\//i.test(next)) throw new Error(`Invalid WebSocket URL: ${next}`);
  return next;
}

function normalizeApiKey(value, fallback = "") {
  return cleanLimitedText(value, fallback, 500);
}

function normalizeWebhookUrl(value, fallback = "") {
  const url = cleanLimitedText(value, fallback, 600);
  if (!url) return "";
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("WeCom webhook must use https");
  if (!parsed.searchParams.get("key")) throw new Error("WeCom webhook key is required");
  return parsed.toString();
}

function maskSecret(value = "") {
  const secret = String(value || "");
  if (!secret) return "";
  if (secret.length <= 8) return "********";
  return `${secret.slice(0, 4)}********${secret.slice(-4)}`;
}

function normalizeGlobalModelConfig(input = {}) {
  const model = input.model === undefined || input.model === null
    ? DEFAULT_MODEL_CONFIG.global.model
    : cleanLimitedText(input.model, "", 120);
  if (!model) throw new Error("Global model is required");
  return {
    provider: cleanLimitedText(input.provider, DEFAULT_MODEL_CONFIG.global.provider),
    apiUrl: normalizeApiUrl(input.apiUrl, DEFAULT_MODEL_CONFIG.global.apiUrl, false),
    apiKey: normalizeApiKey(input.apiKey, DEFAULT_MODEL_CONFIG.global.apiKey),
    model,
    temperature: normalizeTemperature(input.temperature, DEFAULT_MODEL_CONFIG.global.temperature),
    maxTokens: normalizeMaxTokens(input.maxTokens, DEFAULT_MODEL_CONFIG.global.maxTokens)
  };
}

function normalizeAgentModelOverride(input = {}) {
  const override = {
    provider: cleanLimitedText(input.provider, "", 120),
    apiUrl: normalizeApiUrl(input.apiUrl, "", true),
    apiKey: normalizeApiKey(input.apiKey, ""),
    model: cleanLimitedText(input.model, "", 120),
    temperature: normalizeTemperature(input.temperature, "", true),
    maxTokens: normalizeMaxTokens(input.maxTokens, "", true)
  };
  const configured = Boolean(
    override.provider ||
    override.apiUrl ||
    override.apiKey ||
    override.model ||
    override.temperature !== "" ||
    override.maxTokens !== ""
  );
  return configured ? override : { provider: "", apiUrl: "", apiKey: "", model: "", temperature: "", maxTokens: "" };
}

function normalizeVoiceModelConfig(input = {}, defaults = {}) {
  return {
    provider: cleanLimitedText(input.provider, defaults.provider || "未配置", 120),
    apiUrl: normalizeApiUrl(input.apiUrl, defaults.apiUrl || "", true),
    apiKey: normalizeApiKey(input.apiKey, defaults.apiKey || ""),
    model: cleanLimitedText(input.model, defaults.model || "", 120),
    language: cleanLimitedText(input.language, defaults.language || "zh-CN", 40),
    voice: cleanLimitedText(input.voice, defaults.voice || "默认", 80),
    speed: normalizeTemperature(input.speed, defaults.speed ?? 1)
  };
}

function normalizeModelConfig(config = {}) {
  const global = normalizeGlobalModelConfig(config.global || {});
  const voice = {
    asr: normalizeVoiceModelConfig(config.voice?.asr || {}, DEFAULT_MODEL_CONFIG.voice.asr),
    tts: normalizeVoiceModelConfig(config.voice?.tts || {}, DEFAULT_MODEL_CONFIG.voice.tts)
  };
  const agents = {};
  for (const item of MODEL_AGENT_DEFINITIONS) {
    agents[item.key] = normalizeAgentModelOverride(config.agents?.[item.key] || {});
  }
  return { global, voice, agents };
}

function mergeModelConfigWithSecret(currentConfig = {}, incomingConfig = {}) {
  const merged = { ...currentConfig, ...incomingConfig };
  if (incomingConfig.clearApiKey === true || incomingConfig.clearApiKey === "true") {
    merged.apiKey = "";
  } else if (!incomingConfig.apiKey) {
    merged.apiKey = currentConfig.apiKey || "";
  }
  return merged;
}

function ensureModelConfig(state) {
  state.modelConfig = normalizeModelConfig(state.modelConfig || DEFAULT_MODEL_CONFIG);
  return state.modelConfig;
}

function normalizeWecomMsgtype(value, fallback = "markdown") {
  const msgtype = cleanText(value, fallback);
  if (!VALID_WECOM_MSGTYPES.has(msgtype)) throw new Error(`Invalid WeCom msgtype: ${msgtype}`);
  return msgtype;
}

function normalizeWecomSendMode(value, fallback = "manualApproval") {
  const mode = cleanText(value, fallback);
  if (!VALID_WECOM_SEND_MODES.has(mode)) throw new Error(`Invalid WeCom send mode: ${mode}`);
  return mode;
}

function normalizeWecomRoute(route = {}, current = {}) {
  const routeId = cleanLimitedText(route.id || current.id || id("wecom_route"), "", 80);
  const clearWebhook = route.clearWebhook === true || route.clearWebhook === "true";
  const webhookUrl = clearWebhook
    ? ""
    : route.webhookUrl
      ? normalizeWebhookUrl(route.webhookUrl)
      : current.webhookUrl || "";
  return {
    id: routeId,
    name: cleanLimitedText(route.name, current.name || "企微测试群机器人", 120),
    channel: cleanLimitedText(route.channel, current.channel || "VIP群", 40),
    webhookUrl,
    msgtype: normalizeWecomMsgtype(route.msgtype, current.msgtype || "markdown"),
    enabled: route.enabled === true || route.enabled === "true"
  };
}

function normalizeWecomAibotConfig(config = {}, current = DEFAULT_WECOM_CONFIG.aibot) {
  const clearBotId = config.clearBotId === true || config.clearBotId === "true";
  const clearSecret = config.clearSecret === true || config.clearSecret === "true";
  const heartbeatInterval = Math.round(finiteNumber(config.heartbeatInterval, current.heartbeatInterval || 30000));
  const maxReconnectAttempts = Math.round(finiteNumber(config.maxReconnectAttempts, current.maxReconnectAttempts ?? 10));
  return {
    enabled: config.enabled === undefined ? Boolean(current.enabled) : config.enabled === true || config.enabled === "true",
    botId: clearBotId
      ? ""
      : config.botId
        ? cleanLimitedText(config.botId, "", 220)
        : current.botId || "",
    secret: clearSecret
      ? ""
      : config.secret
        ? normalizeApiKey(config.secret, "")
        : current.secret || "",
    wsUrl: config.wsUrl
      ? normalizeWebSocketUrl(config.wsUrl, "")
      : cleanLimitedText(current.wsUrl || "", "", 300),
    defaultCustomerId: cleanLimitedText(config.defaultCustomerId, current.defaultCustomerId || "", 80),
    defaultChannel: cleanLimitedText(config.defaultChannel, current.defaultChannel || "VIP群", 40),
    autoReply: config.autoReply === undefined ? Boolean(current.autoReply) : config.autoReply === true || config.autoReply === "true",
    welcomeText: cleanLimitedText(config.welcomeText, current.welcomeText || DEFAULT_WECOM_CONFIG.aibot.welcomeText, 500),
    heartbeatInterval: Math.max(5000, Math.min(120000, heartbeatInterval)),
    maxReconnectAttempts: Math.max(-1, Math.min(100, maxReconnectAttempts)),
    bridgeStatus: cleanLimitedText(config.bridgeStatus, current.bridgeStatus || "未启动", 40),
    lastConnectedAt: cleanLimitedText(config.lastConnectedAt, current.lastConnectedAt || "", 80),
    lastEventAt: cleanLimitedText(config.lastEventAt, current.lastEventAt || "", 80),
    lastError: cleanLimitedText(config.lastError, current.lastError || "", 400)
  };
}

function normalizeWecomArchiveConfig(config = {}, current = DEFAULT_WECOM_CONFIG.archive) {
  return {
    enabled: config.enabled === undefined ? Boolean(current.enabled) : config.enabled === true || config.enabled === "true",
    provider: cleanLimitedText(config.provider, current.provider || DEFAULT_WECOM_CONFIG.archive.provider, 120),
    cursor: cleanLimitedText(config.cursor, current.cursor || "", 220),
    lastPulledAt: cleanLimitedText(config.lastPulledAt, current.lastPulledAt || "", 80),
    lastMessageAt: cleanLimitedText(config.lastMessageAt, current.lastMessageAt || "", 80),
    status: cleanLimitedText(config.status, current.status || "未配置", 40),
    lastError: cleanLimitedText(config.lastError, current.lastError || "", 400),
    defaultCustomerId: cleanLimitedText(config.defaultCustomerId, current.defaultCustomerId || "", 80),
    defaultChannel: cleanLimitedText(config.defaultChannel, current.defaultChannel || "VIP群", 40)
  };
}

function normalizeWecomConfig(config = {}, current = DEFAULT_WECOM_CONFIG) {
  const currentRoutes = Array.isArray(current.routes) && current.routes.length ? current.routes : DEFAULT_WECOM_CONFIG.routes;
  const inputRoutes = Array.isArray(config.routes) && config.routes.length ? config.routes : currentRoutes;
  const routes = inputRoutes.map((route, index) => normalizeWecomRoute(route, currentRoutes[index] || {}));
  const fallbackRouteId = routes[0]?.id || DEFAULT_WECOM_CONFIG.defaultRouteId;
  const defaultRouteId = routes.some((route) => route.id === config.defaultRouteId)
    ? config.defaultRouteId
    : current.defaultRouteId && routes.some((route) => route.id === current.defaultRouteId)
      ? current.defaultRouteId
      : fallbackRouteId;
  const inbound = {
    enabled: config.inbound?.enabled === undefined ? Boolean(current.inbound?.enabled ?? true) : config.inbound.enabled === true || config.inbound.enabled === "true",
    defaultChannel: cleanLimitedText(config.inbound?.defaultChannel, current.inbound?.defaultChannel || "VIP群", 40),
    secret: config.inbound?.clearSecret === true || config.inbound?.clearSecret === "true"
      ? ""
      : config.inbound?.secret
        ? normalizeApiKey(config.inbound.secret, "")
        : current.inbound?.secret || ""
  };
  const aibot = normalizeWecomAibotConfig(config.aibot || {}, current.aibot || DEFAULT_WECOM_CONFIG.aibot);
  const archive = normalizeWecomArchiveConfig(config.archive || {}, current.archive || DEFAULT_WECOM_CONFIG.archive);
  return {
    enabled: config.enabled === undefined ? Boolean(current.enabled) : config.enabled === true || config.enabled === "true",
    sendMode: normalizeWecomSendMode(config.sendMode, current.sendMode || "manualApproval"),
    defaultRouteId,
    routes,
    inbound,
    aibot,
    archive
  };
}

function ensureWecomConfig(state) {
  state.wecomConfig = normalizeWecomConfig(state.wecomConfig || {}, state.wecomConfig || DEFAULT_WECOM_CONFIG);
  state.wecomLogs = Array.isArray(state.wecomLogs) ? state.wecomLogs : [];
  return state.wecomConfig;
}

function normalizeWecomGroupBinding(binding = {}) {
  const chatId = cleanLimitedText(binding.chatId, "", 180);
  if (!chatId) return null;
  return {
    chatId,
    chatName: cleanLimitedText(binding.chatName, binding.groupName || `企微群 ${chatId.slice(-6)}`, 160),
    customerId: cleanLimitedText(binding.customerId, "", 80),
    channel: cleanLimitedText(binding.channel, "VIP群", 40),
    source: cleanLimitedText(binding.source, "wecom-aibot", 60),
    status: binding.status === "已绑定" ? "已绑定" : "待绑定",
    messageCount: Math.max(0, Math.round(finiteNumber(binding.messageCount, 0))),
    lastMessageAt: cleanLimitedText(binding.lastMessageAt, "", 80),
    lastSenderId: cleanLimitedText(binding.lastSenderId, "", 180),
    createdAt: cleanLimitedText(binding.createdAt, new Date().toISOString(), 80),
    updatedAt: cleanLimitedText(binding.updatedAt, binding.createdAt || new Date().toISOString(), 80)
  };
}

function ensureWecomBindings(state) {
  const source = state.wecomBindings || DEFAULT_WECOM_BINDINGS;
  const rawGroups = Array.isArray(source.groups) ? source.groups : [];
  const seen = new Set();
  const groups = [];
  for (const raw of rawGroups) {
    const binding = normalizeWecomGroupBinding(raw);
    if (!binding || seen.has(binding.chatId)) continue;
    const customer = Array.isArray(state.customers) ? state.customers.find((item) => item.id === binding.customerId) : null;
    if (customer?.tags?.includes("企微群待绑定")) binding.status = "待绑定";
    seen.add(binding.chatId);
    groups.push(binding);
  }
  state.wecomBindings = { groups };
  return state.wecomBindings;
}

function findWecomGroupBinding(state, chatId = "") {
  const normalizedChatId = cleanLimitedText(chatId, "", 180);
  if (!normalizedChatId) return null;
  const bindings = ensureWecomBindings(state);
  return bindings.groups.find((binding) => binding.chatId === normalizedChatId) || null;
}

function createPlaceholderWecomCustomer(state, { chatId = "", chatName = "" } = {}) {
  state.customers = Array.isArray(state.customers) ? state.customers : [];
  const suffix = cleanLimitedText(chatId, "", 180).slice(-6) || id("grp").slice(-6);
  const customerId = id("c");
  const customer = {
    id: customerId,
    name: cleanLimitedText(chatName, `企微群待绑定-${suffix}`, 120),
    contact: "待识别",
    phone: "",
    stage: "VIP维护",
    owner: "待分配",
    tradeVolume: 0,
    purchaseFrequency: 0,
    lastTradeDays: 0,
    memberStatus: "待确认",
    targetCard: "待确认",
    tags: ["企微群待绑定", "长连接入站"],
    watchedModels: [],
    intentScore: 30,
    risk: "中",
    notes: `由企微群 ${chatId || "未知chatid"} 首次入站自动创建，请在企微接入页绑定到真实客户档案。`,
    wecomChatId: chatId
  };
  state.customers.unshift(customer);
  appendEvent(state, customerId, {
    channel: "企微入站",
    type: "自动建档",
    text: `检测到未绑定企微群 ${chatName || chatId}，已创建待绑定客户档案。`
  });
  return customer;
}

function upsertWecomGroupBinding(state, payload = {}) {
  const bindings = ensureWecomBindings(state);
  const chatId = cleanLimitedText(payload.chatId, "", 180);
  if (!chatId) throw new Error("WeCom chatId is required for group binding");
  const now = new Date().toISOString();
  let binding = bindings.groups.find((item) => item.chatId === chatId);
  const nextStatus = payload.status === "待绑定"
    ? "待绑定"
    : payload.status === "已绑定"
      ? "已绑定"
      : payload.customerId
        ? "已绑定"
        : "待绑定";
  if (!binding) {
    binding = normalizeWecomGroupBinding({
      chatId,
      chatName: payload.chatName || payload.groupName || `企微群 ${chatId.slice(-6)}`,
      customerId: payload.customerId || "",
      channel: payload.channel || "VIP群",
      source: payload.source || "wecom-aibot",
      status: nextStatus,
      createdAt: now,
      updatedAt: now
    });
    bindings.groups.unshift(binding);
  } else {
    binding.chatName = cleanLimitedText(payload.chatName || payload.groupName, binding.chatName, 160);
    binding.customerId = payload.customerId === undefined ? binding.customerId : cleanLimitedText(payload.customerId, "", 80);
    binding.channel = cleanLimitedText(payload.channel, binding.channel || "VIP群", 40);
    binding.source = cleanLimitedText(payload.source, binding.source || "wecom-aibot", 60);
    binding.status = nextStatus;
    binding.updatedAt = now;
  }
  if (payload.lastMessageAt) binding.lastMessageAt = cleanLimitedText(payload.lastMessageAt, now, 80);
  if (payload.lastSenderId) binding.lastSenderId = cleanLimitedText(payload.lastSenderId, "", 180);
  if (payload.incrementMessageCount) binding.messageCount = Math.max(0, Number(binding.messageCount || 0) + 1);
  state.wecomBindings.groups = bindings.groups.slice(0, 500);
  return binding;
}

function publicWecomRoute(route = {}) {
  return {
    ...route,
    webhookUrl: "",
    webhookConfigured: Boolean(route.webhookUrl),
    webhookMasked: maskWebhookUrl(route.webhookUrl)
  };
}

function publicWecomAibotConfig(aibot = DEFAULT_WECOM_CONFIG.aibot) {
  return {
    ...aibot,
    botId: "",
    secret: "",
    botIdConfigured: Boolean(aibot.botId),
    botIdMasked: maskSecret(aibot.botId),
    secretConfigured: Boolean(aibot.secret),
    secretMasked: maskSecret(aibot.secret)
  };
}

function publicWecomConfig(config = DEFAULT_WECOM_CONFIG) {
  return {
    ...config,
    routes: (config.routes || []).map(publicWecomRoute),
    inbound: {
      ...(config.inbound || DEFAULT_WECOM_CONFIG.inbound),
      secret: "",
      secretConfigured: Boolean(config.inbound?.secret),
      secretMasked: maskSecret(config.inbound?.secret)
    },
    aibot: publicWecomAibotConfig(config.aibot || DEFAULT_WECOM_CONFIG.aibot)
  };
}

function appendWecomLog(state, log = {}) {
  state.wecomLogs = Array.isArray(state.wecomLogs) ? state.wecomLogs : [];
  const nextLog = {
    id: id("wecom"),
    type: cleanLimitedText(log.type, "send", 40),
    status: cleanLimitedText(log.status, "成功", 40),
    routeId: cleanLimitedText(log.routeId, "", 80),
    routeName: cleanLimitedText(log.routeName, "", 120),
    customerId: cleanLimitedText(log.customerId, "", 80),
    customerName: cleanLimitedText(log.customerName, "", 120),
    draftId: cleanLimitedText(log.draftId, "", 80),
    channel: cleanLimitedText(log.channel, "企微", 40),
    source: cleanLimitedText(log.source, "", 60),
    externalMessageId: cleanLimitedText(log.externalMessageId, "", 180),
    requestId: cleanLimitedText(log.requestId, "", 180),
    chatId: cleanLimitedText(log.chatId, "", 180),
    senderId: cleanLimitedText(log.senderId, "", 180),
    deduped: Boolean(log.deduped),
    contentPreview: cleanLimitedText(log.contentPreview, "", 180),
    error: cleanLimitedText(log.error, "", 400),
    latencyMs: Number.isFinite(Number(log.latencyMs)) ? Number(log.latencyMs) : null,
    externalSideEffects: Boolean(log.externalSideEffects),
    createdAt: new Date().toISOString()
  };
  state.wecomLogs.unshift(nextLog);
  state.wecomLogs = state.wecomLogs.slice(0, 200);
  return nextLog;
}

function resolveWecomRoute(state, routeId = "") {
  const config = ensureWecomConfig(state);
  const route = config.routes.find((item) => item.id === (routeId || config.defaultRouteId)) || config.routes[0];
  if (!config.enabled) throw new Error("WeCom connector is disabled");
  if (!route) throw new Error("WeCom route is not configured");
  if (!route.enabled) throw new Error(`WeCom route is disabled: ${route.name}`);
  if (!route.webhookUrl) throw new Error(`WeCom webhook is empty: ${route.name}`);
  return route;
}

function defaultWecomInboundChannel(channel = "VIP群") {
  if (String(channel).includes("销售")) return "销售模拟私聊";
  if (String(channel).includes("电销")) return "电销模拟私聊";
  if (String(channel).includes("VIP") || String(channel).includes("群")) return "VIP模拟群";
  return cleanLimitedText(channel, "VIP模拟群", 40);
}

function resolveWecomInboundTarget(state, payload = {}, config = DEFAULT_WECOM_CONFIG) {
  state.customers = Array.isArray(state.customers) ? state.customers : [];
  const chatId = cleanLimitedText(payload.chatId, "", 180);
  const chatName = cleanLimitedText(payload.chatName || payload.groupName, chatId ? `企微群 ${chatId.slice(-6)}` : "", 160);
  const inboundChannel = payload.channel || config.aibot?.defaultChannel || config.inbound?.defaultChannel || "VIP群";

  if (payload.customerId) {
    const customer = requireCustomer(state, payload.customerId);
    if (chatId) {
      upsertWecomGroupBinding(state, {
        chatId,
        chatName,
        customerId: customer.id,
        channel: inboundChannel,
        source: payload.source || "wecom-aibot"
      });
    }
    return { customerId: customer.id, chatId, chatName, binding: chatId ? findWecomGroupBinding(state, chatId) : null, createdCustomer: false };
  }

  if (chatId) {
    let binding = findWecomGroupBinding(state, chatId);
    let customer = binding?.customerId ? getCustomer(state, binding.customerId) : null;
    let createdCustomer = false;
    if (!customer) {
      customer = createPlaceholderWecomCustomer(state, { chatId, chatName });
      createdCustomer = true;
    }
    const placeholderCustomer = createdCustomer || (Array.isArray(customer.tags) && customer.tags.includes("企微群待绑定") && binding?.status !== "已绑定");
    binding = upsertWecomGroupBinding(state, {
      chatId,
      chatName,
      customerId: customer.id,
      channel: binding?.channel || inboundChannel,
      source: payload.source || "wecom-aibot",
      status: placeholderCustomer ? "待绑定" : "已绑定"
    });
    return { customerId: customer.id, chatId, chatName, binding, createdCustomer };
  }

  const fallbackCustomerId = config.aibot?.defaultCustomerId || state.selectedCustomerId || state.customers[0]?.id || "";
  const customer = requireCustomer(state, fallbackCustomerId);
  return { customerId: customer.id, chatId: "", chatName: "", binding: null, createdCustomer: false };
}

function latestWecomSummary(state) {
  const logs = Array.isArray(state.wecomLogs) ? state.wecomLogs : [];
  return {
    total: logs.length,
    sent: logs.filter((log) => log.status === "成功").length,
    failed: logs.filter((log) => log.status === "失败").length,
    lastAt: logs[0]?.createdAt || "",
    lastStatus: logs[0]?.status || ""
  };
}

function hasRecentWecomInbound(state, externalMessageId = "") {
  const msgId = cleanLimitedText(externalMessageId, "", 180);
  if (!msgId) return false;
  const logs = Array.isArray(state.wecomLogs) ? state.wecomLogs : [];
  return logs.some((log) => log.type === "消息入站" && log.status === "成功" && log.externalMessageId === msgId);
}

function normalizePersonalWechatAccount(account = {}, current = DEFAULT_PERSONAL_WECHAT.account) {
  const minSendIntervalSeconds = Math.round(finiteNumber(account.minSendIntervalSeconds, current.minSendIntervalSeconds || 3));
  const concurrency = Math.round(finiteNumber(account.concurrency, current.concurrency || 1));
  const maxSendsPerMinute = Math.round(finiteNumber(account.maxSendsPerMinute, current.maxSendsPerMinute || 20));
  const maxQueueAgeSeconds = Math.round(finiteNumber(account.maxQueueAgeSeconds, current.maxQueueAgeSeconds || 60));
  const failureBackoffSeconds = Math.round(finiteNumber(account.failureBackoffSeconds, current.failureBackoffSeconds || 30));
  const mergeWindowSeconds = Math.round(finiteNumber(account.mergeWindowSeconds, current.mergeWindowSeconds || 45));
  return {
    id: cleanLimitedText(account.id, current.id || DEFAULT_PERSONAL_WECHAT.account.id, 80),
    name: cleanLimitedText(account.name, current.name || DEFAULT_PERSONAL_WECHAT.account.name, 120),
    displayName: cleanLimitedText(account.displayName, current.displayName || DEFAULT_PERSONAL_WECHAT.account.displayName, 120),
    defaultCustomerId: cleanLimitedText(account.defaultCustomerId, current.defaultCustomerId || "", 80),
    autoReply: account.autoReply === undefined ? Boolean(current.autoReply) : account.autoReply === true || account.autoReply === "true",
    requireApprovalForRisk: account.requireApprovalForRisk === undefined ? Boolean(current.requireApprovalForRisk ?? true) : account.requireApprovalForRisk === true || account.requireApprovalForRisk === "true",
    minSendIntervalSeconds: Math.max(1, Math.min(60, minSendIntervalSeconds)),
    concurrency: Math.max(1, Math.min(3, concurrency)),
    maxSendsPerMinute: Math.max(1, Math.min(60, maxSendsPerMinute)),
    maxQueueAgeSeconds: Math.max(15, Math.min(600, maxQueueAgeSeconds)),
    failureBackoffSeconds: Math.max(5, Math.min(600, failureBackoffSeconds)),
    mergeWindowSeconds: Math.max(5, Math.min(300, mergeWindowSeconds)),
    status: cleanLimitedText(account.status, current.status || "未连接", 40),
    lastEventAt: cleanLimitedText(account.lastEventAt, current.lastEventAt || "", 80),
    lastError: cleanLimitedText(account.lastError, current.lastError || "", 400)
  };
}

function normalizePersonalWechatContext(context = {}) {
  const roomId = cleanLimitedText(context.roomId, "", 180);
  if (!roomId) return null;
  const messages = Array.isArray(context.messages) ? context.messages : [];
  return {
    roomId,
    roomName: cleanLimitedText(context.roomName, `外部群 ${roomId.slice(-6)}`, 160),
    customerId: cleanLimitedText(context.customerId, "", 80),
    accountId: cleanLimitedText(context.accountId, DEFAULT_PERSONAL_WECHAT.account.id, 80),
    lastMessageAt: cleanLimitedText(context.lastMessageAt, "", 80),
    lastReplyAt: cleanLimitedText(context.lastReplyAt, "", 80),
    lastStaffReplyAt: cleanLimitedText(context.lastStaffReplyAt, "", 80),
    pendingSendJobId: cleanLimitedText(context.pendingSendJobId, "", 80),
    messageCount: Math.max(0, Math.round(finiteNumber(context.messageCount, 0))),
    messages: messages.slice(-20).map((message) => ({
      messageId: cleanLimitedText(message.messageId, id("pwx_msg"), 180),
      senderName: cleanLimitedText(message.senderName, "未知发送人", 120),
      senderType: normalizePersonalWechatSenderType(message.senderType),
      text: cleanLimitedText(message.text, "", 500),
      msgType: cleanLimitedText(message.msgType, "text", 40),
      sendAt: cleanLimitedText(message.sendAt, new Date().toISOString(), 80),
      source: cleanLimitedText(message.source, "personal-wechat", 60)
    }))
  };
}

function normalizePersonalWechatSendJob(job = {}) {
  const status = ["queued", "sending", "sent", "confirmed", "failed", "cancelled", "manual_required"].includes(job.status)
    ? job.status
    : "queued";
  return {
    jobId: cleanLimitedText(job.jobId, id("pwx_send"), 80),
    roomId: cleanLimitedText(job.roomId, "", 180),
    roomName: cleanLimitedText(job.roomName, "", 160),
    accountId: cleanLimitedText(job.accountId, DEFAULT_PERSONAL_WECHAT.account.id, 80),
    replyText: cleanLimitedText(job.replyText, "", 1800),
    triggerMessageIds: Array.isArray(job.triggerMessageIds) ? job.triggerMessageIds.map((item) => cleanLimitedText(item, "", 180)).filter(Boolean) : [],
    status,
    riskLevel: ["low", "medium", "high"].includes(job.riskLevel) ? job.riskLevel : "low",
    reason: cleanLimitedText(job.reason, "", 400),
    gatewayMode: cleanLimitedText(job.gatewayMode, "mock", 40),
    source: cleanLimitedText(job.source, "personal-wechat", 60),
    attempts: Math.max(0, Math.round(finiteNumber(job.attempts, 0))),
    createdAt: cleanLimitedText(job.createdAt, new Date().toISOString(), 80),
    scheduledAt: cleanLimitedText(job.scheduledAt, "", 80),
    sentAt: cleanLimitedText(job.sentAt, "", 80),
    confirmedAt: cleanLimitedText(job.confirmedAt, "", 80),
    confirmedMessageId: cleanLimitedText(job.confirmedMessageId, "", 180),
    retryAfterAt: cleanLimitedText(job.retryAfterAt, "", 80),
    error: cleanLimitedText(job.error, "", 400)
  };
}

function normalizePersonalWechatDecision(decision = {}) {
  const action = ["ignore", "auto_reply", "require_approval", "create_task"].includes(decision.action) ? decision.action : "ignore";
  return {
    decisionId: cleanLimitedText(decision.decisionId, id("pwx_decision"), 80),
    roomId: cleanLimitedText(decision.roomId, "", 180),
    roomName: cleanLimitedText(decision.roomName, "", 160),
    triggerMessageIds: Array.isArray(decision.triggerMessageIds) ? decision.triggerMessageIds.map((item) => cleanLimitedText(item, "", 180)).filter(Boolean) : [],
    action,
    replyText: cleanLimitedText(decision.replyText, "", 1800),
    riskLevel: ["low", "medium", "high"].includes(decision.riskLevel) ? decision.riskLevel : "low",
    source: cleanLimitedText(decision.source, "personal-wechat", 60),
    reason: cleanLimitedText(decision.reason, "", 400),
    createdAt: cleanLimitedText(decision.createdAt, new Date().toISOString(), 80)
  };
}

function normalizePersonalWechatConfig(config = {}, current = DEFAULT_PERSONAL_WECHAT) {
  const account = normalizePersonalWechatAccount(config.account || {}, current.account || DEFAULT_PERSONAL_WECHAT.account);
  const contexts = (Array.isArray(config.groupContexts) ? config.groupContexts : current.groupContexts || [])
    .map(normalizePersonalWechatContext)
    .filter(Boolean);
  return {
    enabled: config.enabled === undefined ? Boolean(current.enabled ?? true) : config.enabled === true || config.enabled === "true",
    account,
    groupContexts: contexts.slice(0, 500),
    sendJobs: (Array.isArray(config.sendJobs) ? config.sendJobs : current.sendJobs || []).map(normalizePersonalWechatSendJob).slice(0, 200),
    decisions: (Array.isArray(config.decisions) ? config.decisions : current.decisions || []).map(normalizePersonalWechatDecision).slice(0, 200),
    logs: (Array.isArray(config.logs) ? config.logs : current.logs || []).slice(0, 200),
    schedulerResult: config.schedulerResult || current.schedulerResult || null
  };
}

function ensurePersonalWechat(state) {
  state.personalWechat = normalizePersonalWechatConfig(state.personalWechat || {}, state.personalWechat || DEFAULT_PERSONAL_WECHAT);
  return state.personalWechat;
}

function publicPersonalWechat(config = DEFAULT_PERSONAL_WECHAT) {
  return {
    ...config,
    account: {
      ...(config.account || DEFAULT_PERSONAL_WECHAT.account)
    },
    sendJobs: (config.sendJobs || []).slice(0, 100),
    decisions: (config.decisions || []).slice(0, 100),
    groupContexts: (config.groupContexts || []).slice(0, 100),
    logs: (config.logs || []).slice(0, 100),
    schedulerResult: config.schedulerResult || null
  };
}

function normalizePersonalWechatSenderType(value = "customer") {
  const senderType = cleanLimitedText(value, "customer", 40);
  return ["customer", "staff", "managed_account", "bot", "unknown"].includes(senderType) ? senderType : "unknown";
}

function appendPersonalWechatLog(state, log = {}) {
  const config = state.personalWechat?.account && Array.isArray(state.personalWechat.logs)
    ? state.personalWechat
    : ensurePersonalWechat(state);
  const nextLog = {
    id: id("pwx_log"),
    type: cleanLimitedText(log.type, "记录", 40),
    status: cleanLimitedText(log.status, "成功", 40),
    accountId: cleanLimitedText(log.accountId, config.account.id, 80),
    roomId: cleanLimitedText(log.roomId, "", 180),
    roomName: cleanLimitedText(log.roomName, "", 160),
    messageId: cleanLimitedText(log.messageId, "", 180),
    sendJobId: cleanLimitedText(log.sendJobId, "", 80),
    contentPreview: cleanLimitedText(log.contentPreview, "", 180),
    error: cleanLimitedText(log.error, "", 400),
    externalSideEffects: Boolean(log.externalSideEffects),
    createdAt: new Date().toISOString()
  };
  config.logs.unshift(nextLog);
  config.logs = config.logs.slice(0, 200);
  return nextLog;
}

function hasRecentPersonalWechatMessage(state, messageId = "") {
  const normalizedMessageId = cleanLimitedText(messageId, "", 180);
  if (!normalizedMessageId) return false;
  const config = ensurePersonalWechat(state);
  return config.groupContexts.some((context) =>
    (context.messages || []).some((message) => message.messageId === normalizedMessageId)
  ) || config.logs.some((log) => log.type === "消息入站" && log.messageId === normalizedMessageId);
}

function upsertPersonalWechatContext(state, payload = {}) {
  const config = ensurePersonalWechat(state);
  const roomId = cleanLimitedText(payload.roomId, "", 180);
  if (!roomId) throw new Error("Personal WeChat roomId is required");
  let context = config.groupContexts.find((item) => item.roomId === roomId);
  if (!context) {
    context = normalizePersonalWechatContext({
      roomId,
      roomName: payload.roomName || `外部群 ${roomId.slice(-6)}`,
      customerId: payload.customerId || "",
      accountId: payload.accountId || config.account.id,
      messages: []
    });
    config.groupContexts.unshift(context);
  }
  context.roomName = cleanLimitedText(payload.roomName, context.roomName, 160);
  context.customerId = cleanLimitedText(payload.customerId, context.customerId, 80);
  context.accountId = cleanLimitedText(payload.accountId, context.accountId || config.account.id, 80);
  if (payload.message) {
    context.messages.push({
      messageId: cleanLimitedText(payload.message.messageId, id("pwx_msg"), 180),
      senderName: cleanLimitedText(payload.message.senderName, "未知发送人", 120),
      senderType: normalizePersonalWechatSenderType(payload.message.senderType),
      text: cleanLimitedText(payload.message.text, "", 500),
      msgType: cleanLimitedText(payload.message.msgType, "text", 40),
      sendAt: cleanLimitedText(payload.message.sendAt, new Date().toISOString(), 80),
      source: cleanLimitedText(payload.message.source, "personal-wechat", 60)
    });
    context.messages = context.messages.slice(-20);
    context.messageCount = Math.max(0, Number(context.messageCount || 0) + 1);
    context.lastMessageAt = payload.message.sendAt || new Date().toISOString();
    if (["staff", "bot", "managed_account"].includes(payload.message.senderType)) context.lastStaffReplyAt = context.lastMessageAt;
  }
  return context;
}

function personalWechatMessageText(payload = {}) {
  if (payload.msgType && payload.msgType !== "text") return `[${payload.msgType}消息]`;
  return cleanLimitedText(payload.text || payload.message, "", 4000);
}

function normalizeInboundGroupMessage(payload = {}, sourceFallback = "personal-wechat") {
  const source = cleanLimitedText(payload.source, sourceFallback, 60);
  const roomId = cleanLimitedText(payload.roomId || payload.chatId || payload.chatid, "", 180);
  if (!roomId) throw new Error("Inbound group roomId is required");
  const senderType = normalizePersonalWechatSenderType(payload.senderType || payload.senderRoleType);
  const messageId = cleanLimitedText(
    payload.messageId || payload.externalMessageId || payload.msgid || `${source}_${roomId}_${Date.now()}`,
    "",
    180
  );
  const msgType = cleanLimitedText(payload.msgType, "text", 40);
  const text = personalWechatMessageText({ ...payload, msgType });
  if (!text) throw new Error("Inbound group message text is required");
  return {
    messageId,
    roomId,
    roomName: cleanLimitedText(payload.roomName || payload.chatName || payload.groupName, `外部群 ${roomId.slice(-6)}`, 160),
    customerId: cleanLimitedText(payload.customerId, "", 80),
    senderId: cleanLimitedText(payload.senderId || payload.userid || payload.fromUserId, "", 180),
    senderName: cleanLimitedText(payload.senderName, senderType === "managed_account" || senderType === "bot" ? "托管号" : "客户", 120),
    senderType,
    msgType,
    text,
    sendAt: cleanLimitedText(payload.sendAt, new Date().toISOString(), 80),
    source
  };
}

function isHighRiskPersonalWechatMessage(text = "") {
  return HIGH_RISK_REPLY_PATTERNS.some((pattern) => pattern.test(String(text || "")));
}

function recentConsecutiveCustomerMessages(context = {}, latestMessageId = "", windowSeconds = 45) {
  const messages = Array.isArray(context.messages) ? context.messages : [];
  const latest = messages.find((message) => message.messageId === latestMessageId) || messages.at(-1);
  const latestMs = personalWechatJobTimeMs(latest?.sendAt, Date.now());
  const windowMs = Math.max(5, Number(windowSeconds || 45)) * 1000;
  const merged = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.senderType !== "customer") break;
    const sentMs = personalWechatJobTimeMs(message.sendAt, latestMs);
    if (latestMs - sentMs > windowMs) break;
    merged.unshift(message);
  }
  return merged.length ? merged : latest ? [latest] : [];
}

function createPersonalWechatDecision(state, payload = {}, context = {}) {
  const config = ensurePersonalWechat(state);
  const text = personalWechatMessageText(payload);
  const senderType = normalizePersonalWechatSenderType(payload.senderType);
  const latestMessageId = cleanLimitedText(payload.messageId || payload.externalMessageId, "", 180);
  const mergedMessages = senderType === "customer"
    ? recentConsecutiveCustomerMessages(context, latestMessageId, config.account.mergeWindowSeconds)
    : [];
  const triggerMessageIds = senderType === "customer"
    ? mergedMessages.map((message) => message.messageId).filter(Boolean)
    : [latestMessageId].filter(Boolean);
  const mergedText = mergedMessages.length
    ? mergedMessages.map((message) => message.text).join("\n")
    : text;
  if (senderType !== "customer") {
    return normalizePersonalWechatDecision({
      roomId: context.roomId,
      roomName: context.roomName,
      triggerMessageIds,
      action: "ignore",
      riskLevel: "low",
      source: payload.source,
      reason: "员工或机器人消息只进入上下文，不触发AccountAgent自动回复。"
    });
  }
  const highRisk = isHighRiskPersonalWechatMessage(mergedText);
  const action = highRisk && config.account.requireApprovalForRisk ? "require_approval" : config.account.autoReply ? "auto_reply" : "require_approval";
  const replyText = highRisk
    ? "收到，我先同步给负责同事确认后再回复您。"
    : "收到，我先帮您整理需求并同步给对应同事。";
  return normalizePersonalWechatDecision({
    roomId: context.roomId,
    roomName: context.roomName,
    triggerMessageIds,
    action,
    replyText,
    riskLevel: highRisk ? "high" : "low",
    source: payload.source,
    reason: highRisk
      ? "命中报价、退款、赔偿、付款或承诺类高风险词，需人工确认。"
      : `低风险收到确认或流程说明，可由单账号AccountAgent自动回复。${triggerMessageIds.length > 1 ? `已合并${triggerMessageIds.length}条连续客户消息。` : ""}`
  });
}

function cancelActivePersonalWechatJobsForRoom(config, roomId = "", reason = "") {
  for (const job of config.sendJobs || []) {
    if (job.roomId === roomId && ACTIVE_PERSONAL_WECHAT_JOB_STATUSES.has(job.status)) {
      job.status = "cancelled";
      job.error = cleanLimitedText(reason, "同群新消息触发，取消旧发送任务。", 400);
    }
  }
}

function mergeIntoActivePersonalWechatJob(config, decision = {}) {
  const activeJob = (config.sendJobs || []).find((job) =>
    job.roomId === decision.roomId && ["queued", "manual_required"].includes(job.status)
  );
  if (!activeJob) return null;
  activeJob.triggerMessageIds = [...new Set([...(activeJob.triggerMessageIds || []), ...(decision.triggerMessageIds || [])])];
  activeJob.replyText = decision.replyText || activeJob.replyText;
  activeJob.riskLevel = activeJob.riskLevel === "high" || decision.riskLevel === "high" ? "high" : decision.riskLevel || activeJob.riskLevel;
  activeJob.status = activeJob.riskLevel === "high" || decision.action === "require_approval" ? "manual_required" : "queued";
  activeJob.reason = cleanLimitedText(`连续客户消息已合并；${decision.reason || activeJob.reason || ""}`, "", 400);
  activeJob.source = cleanLimitedText(decision.source, activeJob.source || "personal-wechat", 60);
  activeJob.createdAt = new Date().toISOString();
  activeJob.scheduledAt = "";
  activeJob.retryAfterAt = "";
  activeJob.error = "";
  const context = (config.groupContexts || []).find((item) => item.roomId === activeJob.roomId);
  if (context) context.pendingSendJobId = activeJob.jobId;
  return activeJob;
}

function personalWechatNowMs(value = "") {
  if (value) {
    const candidate = new Date(value).getTime();
    if (!Number.isNaN(candidate)) return candidate;
  }
  return Date.now();
}

function personalWechatJobTimeMs(value = "", fallbackMs = 0) {
  const candidate = new Date(value || "").getTime();
  return Number.isNaN(candidate) ? fallbackMs : candidate;
}

function expirePersonalWechatSendJobs(config, nowMs = Date.now()) {
  const expiredJobs = [];
  const maxAgeMs = Math.max(15, Number(config.account?.maxQueueAgeSeconds || 60)) * 1000;
  for (const job of config.sendJobs || []) {
    if (!["queued", "manual_required"].includes(job.status)) continue;
    const createdMs = personalWechatJobTimeMs(job.createdAt, nowMs);
    if (nowMs - createdMs <= maxAgeMs) continue;
    job.status = "cancelled";
    job.error = `发送任务已超过${Math.round(maxAgeMs / 1000)}秒，需要重新判断后再发送。`;
    const context = (config.groupContexts || []).find((item) => item.roomId === job.roomId);
    if (context?.pendingSendJobId === job.jobId) context.pendingSendJobId = "";
    expiredJobs.push(job);
  }
  return expiredJobs;
}

function personalWechatThrottleWaitSeconds(config, job, nowMs = Date.now(), options = {}) {
  const minIntervalMs = Math.max(1, Number(config.account?.minSendIntervalSeconds || 3)) * 1000;
  const sentTimes = (config.sendJobs || [])
    .filter((item) => item.jobId !== job.jobId && item.accountId === job.accountId && ["sent", "confirmed"].includes(item.status))
    .map((item) => personalWechatJobTimeMs(item.sentAt || item.confirmedAt, 0))
    .filter((value) => !options.ignoreSentAtMs || value !== options.ignoreSentAtMs)
    .filter((value) => value > 0)
    .sort((a, b) => b - a);
  const latestSentMs = sentTimes[0] || 0;
  const remainingMs = latestSentMs + minIntervalMs - nowMs;
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

function personalWechatSendsInLastMinute(config, accountId = "", nowMs = Date.now()) {
  const windowStart = nowMs - 60_000;
  return (config.sendJobs || []).filter((item) => {
    if (item.accountId !== accountId) return false;
    const sentMs = personalWechatJobTimeMs(item.sentAt || item.scheduledAt || item.confirmedAt, 0);
    return sentMs >= windowStart && sentMs <= nowMs && ["sending", "sent", "confirmed"].includes(item.status);
  }).length;
}

function personalWechatRoomHasEarlierActiveJob(config, job) {
  const jobCreatedMs = personalWechatJobTimeMs(job.createdAt, 0);
  return (config.sendJobs || []).some((item) => {
    if (item.jobId === job.jobId || item.roomId !== job.roomId) return false;
    if (!ACTIVE_PERSONAL_WECHAT_JOB_STATUSES.has(item.status)) return false;
    const itemCreatedMs = personalWechatJobTimeMs(item.createdAt, 0);
    return itemCreatedMs > 0 && jobCreatedMs > 0 && itemCreatedMs < jobCreatedMs;
  });
}

function dispatchPersonalWechatJobs(state, payload = {}) {
  const config = ensurePersonalWechat(state);
  const nowMs = personalWechatNowMs(payload.now);
  const now = new Date(nowMs).toISOString();
  const expiredJobs = expirePersonalWechatSendJobs(config, nowMs);
  for (const job of expiredJobs) {
    appendPersonalWechatLog(state, {
      type: "发送过期",
      status: "失败",
      accountId: job.accountId,
      roomId: job.roomId,
      roomName: job.roomName,
      sendJobId: job.jobId,
      contentPreview: job.replyText,
      error: job.error,
      externalSideEffects: false
    });
  }
  const maxDispatch = Math.max(1, Math.min(10, Math.round(finiteNumber(payload.maxJobs, config.account.concurrency || 1))));
  const concurrency = Math.max(1, Math.min(3, Number(config.account.concurrency || 1)));
  const alreadySending = config.sendJobs.filter((job) => job.accountId === config.account.id && job.status === "sending").length;
  let availableSlots = Math.max(0, Math.min(maxDispatch, concurrency - alreadySending));
  const dispatched = [];
  const skipped = [];
  const candidates = (config.sendJobs || [])
    .filter((job) => DISPATCHABLE_PERSONAL_WECHAT_JOB_STATUSES.has(job.status))
    .sort((a, b) => personalWechatJobTimeMs(a.createdAt, 0) - personalWechatJobTimeMs(b.createdAt, 0));
  for (const job of candidates) {
    if (availableSlots <= 0) break;
    if (job.accountId !== config.account.id) continue;
    if (job.retryAfterAt && personalWechatJobTimeMs(job.retryAfterAt, 0) > nowMs) {
      skipped.push(job.jobId);
      continue;
    }
    if (personalWechatRoomHasEarlierActiveJob(config, job)) {
      job.error = "同群存在更早的活跃发送任务，保持FIFO等待。";
      skipped.push(job.jobId);
      continue;
    }
    const waitSeconds = personalWechatThrottleWaitSeconds(config, job, nowMs, { ignoreSentAtMs: nowMs });
    if (waitSeconds > 0) {
      job.error = `账号发送限频中，请${waitSeconds}秒后再发送。`;
      skipped.push(job.jobId);
      appendPersonalWechatLog(state, {
        type: "发送限频",
        status: "失败",
        accountId: job.accountId,
        roomId: job.roomId,
        roomName: job.roomName,
        sendJobId: job.jobId,
        contentPreview: job.replyText,
        error: job.error,
        externalSideEffects: false
      });
      continue;
    }
    if (personalWechatSendsInLastMinute(config, job.accountId, nowMs) >= Number(config.account.maxSendsPerMinute || 20)) {
      job.error = `账号分钟发送上限${config.account.maxSendsPerMinute}条已达到。`;
      skipped.push(job.jobId);
      appendPersonalWechatLog(state, {
        type: "分钟限流",
        status: "失败",
        accountId: job.accountId,
        roomId: job.roomId,
        roomName: job.roomName,
        sendJobId: job.jobId,
        contentPreview: job.replyText,
        error: job.error,
        externalSideEffects: false
      });
      continue;
    }
    job.status = "sent";
    job.scheduledAt = now;
    job.sentAt = now;
    job.attempts = Math.max(0, Number(job.attempts || 0)) + 1;
    job.error = "";
    config.account.status = "发送中";
    config.account.lastEventAt = now;
    appendPersonalWechatLog(state, {
      type: "调度发送",
      status: "成功",
      accountId: job.accountId,
      roomId: job.roomId,
      roomName: job.roomName,
      sendJobId: job.jobId,
      contentPreview: job.replyText,
      externalSideEffects: false
    });
    dispatched.push(job.jobId);
    availableSlots -= 1;
  }
  audit(state, "个人微信发送调度", config.account.id, `发送${dispatched.length}条，跳过${skipped.length}条`);
  return { dispatched, skipped, expired: expiredJobs.map((job) => job.jobId) };
}

function enqueuePersonalWechatSendJob(state, decision = {}) {
  const config = ensurePersonalWechat(state);
  if (!decision.replyText || !["auto_reply", "require_approval"].includes(decision.action)) return null;
  expirePersonalWechatSendJobs(config);
  const mergedJob = mergeIntoActivePersonalWechatJob(config, decision);
  if (mergedJob) return mergedJob;
  cancelActivePersonalWechatJobsForRoom(config, decision.roomId, "同一群只保留一个待发送任务。");
  const job = normalizePersonalWechatSendJob({
    jobId: id("pwx_send"),
    roomId: decision.roomId,
    roomName: decision.roomName,
    accountId: config.account.id,
    replyText: decision.replyText,
    triggerMessageIds: decision.triggerMessageIds,
    status: decision.action === "auto_reply" ? "queued" : "manual_required",
    riskLevel: decision.riskLevel,
    reason: decision.reason,
    gatewayMode: "mock",
    source: decision.source || "personal-wechat"
  });
  config.sendJobs.unshift(job);
  config.sendJobs = config.sendJobs.slice(0, 200);
  const context = config.groupContexts.find((item) => item.roomId === job.roomId);
  if (context) context.pendingSendJobId = job.jobId;
  return job;
}

function resolveEffectiveAgentModel(state, agentKey) {
  const config = ensureModelConfig(state);
  const definition = MODEL_AGENT_DEFINITIONS.find((item) => item.key === agentKey) || {
    key: agentKey,
    agentName: agentKey,
    scene: "未知场景"
  };
  const override = config.agents[definition.key] || { provider: "", apiUrl: "", apiKey: "", model: "", temperature: "", maxTokens: "" };
  const inherited = !(
    override.provider ||
    override.apiUrl ||
    override.apiKey ||
    override.model ||
    override.temperature !== "" ||
    override.maxTokens !== ""
  );
  const apiKey = inherited ? config.global.apiKey : override.apiKey || config.global.apiKey;
  return {
    agentKey: definition.key,
    agentName: definition.agentName,
    scene: definition.scene,
    provider: inherited ? config.global.provider : override.provider || config.global.provider,
    apiUrl: inherited ? config.global.apiUrl : override.apiUrl || config.global.apiUrl,
    model: inherited ? config.global.model : override.model || config.global.model,
    temperature: inherited ? config.global.temperature : override.temperature === "" ? config.global.temperature : override.temperature,
    maxTokens: inherited ? config.global.maxTokens : override.maxTokens === "" ? config.global.maxTokens : override.maxTokens,
    apiKeyConfigured: Boolean(apiKey),
    apiKeyMasked: maskSecret(apiKey),
    source: inherited ? "全局默认" : "Agent独立配置",
    inheritedFromGlobal: inherited
  };
}

function resolveEffectiveAgentModelWithSecret(state, agentKey) {
  const config = ensureModelConfig(state);
  const publicModel = resolveEffectiveAgentModel(state, agentKey);
  const override = config.agents[publicModel.agentKey] || {};
  const apiKey = publicModel.inheritedFromGlobal ? config.global.apiKey : override.apiKey || config.global.apiKey;
  return {
    ...publicModel,
    apiKey
  };
}

function buildAgentExecutionReport(state, agentKey) {
  const modelConfig = resolveEffectiveAgentModel(state, agentKey);
  const hasModelRoute = Boolean(modelConfig.apiUrl && modelConfig.model);
  return {
    engine: "本地规则引擎",
    modelInvocation: "未调用",
    externalSideEffects: false,
    persistedState: true,
    modelRouteConfigured: hasModelRoute,
    modelRoute: {
      provider: modelConfig.provider,
      apiUrl: modelConfig.apiUrl,
      model: modelConfig.model,
      source: modelConfig.source,
      apiKeyConfigured: modelConfig.apiKeyConfigured,
      temperature: modelConfig.temperature,
      maxTokens: modelConfig.maxTokens
    },
    boundary: hasModelRoute
      ? "已保存LLM连接配置；本次未启用真实LLM增强，结果由本地规则引擎生成。"
      : "本次结果由本地规则引擎生成，未调用外部LLM。",
    blockedExternalActions: ["真实外呼", "短信发送", "企微消息发送", "企微群读取", "外部CRM写入"]
  };
}

function publicModelInvocationConfig(modelConfig) {
  return {
    provider: modelConfig.provider,
    apiUrl: modelConfig.apiUrl,
    model: modelConfig.model,
    source: modelConfig.source,
    apiKeyConfigured: Boolean(modelConfig.apiKey),
    temperature: modelConfig.temperature,
    maxTokens: modelConfig.maxTokens
  };
}

function normalizeDraftChannel(value, fallback = "人工触达") {
  const channel = cleanText(value, fallback);
  if (!VALID_DRAFT_CHANNELS.has(channel)) throw new Error(`Invalid draft channel: ${channel}`);
  return channel;
}

function normalizeDraftStatus(value, fallback = "待确认") {
  const status = cleanText(value, fallback);
  if (!VALID_DRAFT_STATUSES.has(status)) throw new Error(`Invalid draft status: ${status}`);
  return status;
}

function draftChannelForAgent(agentKey) {
  if (agentKey === "dialer") return "电话外呼";
  if (agentKey === "nurture") return "企微私聊";
  if (agentKey === "sales") return "企微私聊";
  if (agentKey === "vip") return "VIP群";
  if (agentKey === "quote") return "报价页";
  return "人工触达";
}

function draftTypeForAgent(agentKey) {
  if (agentKey === "dialer") return "外呼引导话术";
  if (agentKey === "nurture") return "电销培育回复";
  if (agentKey === "sales") return "销售承接话术";
  if (agentKey === "vip") return "VIP群分流回复";
  if (agentKey === "quote") return "报价触达文案";
  if (agentKey === "orchestrator") return "闭环计划触达";
  return "人工触达文案";
}

function draftContentFromRun(run, customer, agentKey) {
  if (!run) return "";
  if (run.pushCopy) return run.pushCopy;
  if (run.suggestedReply) return run.suggestedReply;
  if (run.playbook?.handoffSummary) return run.playbook.handoffSummary;
  if (run.contextSummary) return run.contextSummary;
  if (run.nextAction) {
    return `${customer.contact || customer.name}，${run.nextAction}。请人工确认后再通过真实渠道触达。`;
  }
  if (agentKey === "orchestrator" && Array.isArray(run.plans)) {
    const plan = run.plans.find((item) => item.customerId === customer.id);
    return plan?.suggestedMessage || "";
  }
  return "";
}

function upsertOutboundDraft(state, draft) {
  state.outboundDrafts = Array.isArray(state.outboundDrafts) ? state.outboundDrafts : [];
  const content = cleanLimitedText(draft.content, "", 1200);
  if (!content) return null;
  const now = new Date().toISOString();
  const existing = state.outboundDrafts.find(
    (item) =>
      item.customerId === draft.customerId &&
      item.sourceAgent === draft.sourceAgent &&
      item.content === content &&
      !["人工已处理", "已废弃"].includes(item.status)
  );
  if (existing) {
    existing.updatedAt = now;
    existing.priority = draft.priority || existing.priority;
    existing.channel = draft.channel || existing.channel;
    existing.sourceRunId = draft.sourceRunId || existing.sourceRunId;
    existing.externalSideEffects = false;
    return existing;
  }
  const next = {
    id: id("draft"),
    customerId: draft.customerId,
    customerName: draft.customerName,
    sourceAgent: draft.sourceAgent || "人工创建",
    sourceRunId: draft.sourceRunId || "",
    channel: normalizeDraftChannel(draft.channel, "人工触达"),
    draftType: cleanText(draft.draftType, "人工触达文案"),
    content,
    priority: normalizePriority(draft.priority, "中"),
    status: normalizeDraftStatus(draft.status, "待确认"),
    externalSideEffects: false,
    note: cleanText(draft.note),
    createdAt: now,
    updatedAt: now,
    confirmedAt: "",
    copiedAt: "",
    completedAt: "",
    discardedAt: ""
  };
  state.outboundDrafts.unshift(next);
  state.outboundDrafts = state.outboundDrafts.slice(0, 300);
  return next;
}

function createDraftFromLatestAgentRun(state, agentKey, customerIdOverride = "") {
  const run = state.agentRuns[0];
  if (!run) return null;
  if (agentKey === "orchestrator" && !customerIdOverride) return null;
  const customerId = customerIdOverride || run.handoffPackage?.customerId || run.customerId || state.selectedCustomerId;
  const customer = getCustomer(state, customerId);
  if (!customer) return null;
  const content = draftContentFromRun(run, customer, agentKey);
  const draft = upsertOutboundDraft(state, {
    customerId: customer.id,
    customerName: customer.name,
    sourceAgent: run.agent || draftTypeForAgent(agentKey),
    sourceRunId: run.id || "",
    channel: draftChannelForAgent(agentKey),
    draftType: draftTypeForAgent(agentKey),
    content,
    priority: run.priority || (run.humanRequired ? "高" : "中"),
    note: "由本地Agent生成，需人工确认后通过真实渠道处理。"
  });
  if (draft) {
    run.outboundDraftId = draft.id;
  }
  return draft;
}

function listSummary(values = [], fallback = "暂无") {
  const list = values
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return list.length ? list.join("、") : fallback;
}

function agentRunAuditDetail(run = {}) {
  if (run.summary) return run.summary;
  if (run.llmEnhancement?.content) return run.llmEnhancement.content;
  if (run.contextSummary) return run.contextSummary;
  if (run.pushCopy) return run.pushCopy;
  if (run.suggestedReply) return run.suggestedReply;
  if (run.playbook?.handoffSummary) return run.playbook.handoffSummary;
  if (Array.isArray(run.recommendations) && run.recommendations.length) {
    return `推荐报价：${listSummary(run.recommendations.map((item) => `${item.model}${item.config ? ` ${item.config}` : ""}`))}`;
  }
  if (Array.isArray(run.quoteRecommendations) && run.quoteRecommendations.length) {
    return `销售可沟通报价：${listSummary(run.quoteRecommendations.map((item) => `${item.model}${item.config ? ` ${item.config}` : ""}`))}`;
  }
  if (Array.isArray(run.plans)) return `已生成${run.totalPlans || run.plans.length}个客户运营动作`;
  return run.nextAction || `${run.agent || "Agent"}已完成本地分析`;
}

function agentRunPromptSummary(run = {}) {
  const quoteList = (run.recommendations || run.quoteRecommendations || [])
    .slice(0, 3)
    .map((item) => `${item.brand || ""}${item.model || ""}${item.config ? ` ${item.config}` : ""} ${item.price ? `报价${item.price}` : ""}`.trim());
  return [
    `Agent：${run.agent || "未知"}`,
    run.score !== undefined ? `外呼评分：${run.score}，下一阶段：${run.nextStage || "未记录"}` : "",
    run.intent ? `识别意图：${run.intent}，置信度：${run.confidence || "未记录"}` : "",
    run.need ? `客户需求：${run.need}` : "",
    run.routeTo ? `建议处理角色：${run.routeTo}，优先级：${run.priority || "未记录"}` : "",
    run.recommendedCard ? `推荐卡种：${run.recommendedCard}，异议：${run.objection || "未识别"}` : "",
    run.nextAction ? `本地建议动作：${run.nextAction}` : "",
    run.playbook?.handoffSummary ? `销售交接摘要：${run.playbook.handoffSummary}` : "",
    run.contextSummary ? `上下文摘要：${run.contextSummary}` : "",
    quoteList.length ? `推荐报价：${quoteList.join("；")}` : "",
    run.suggestedReply ? `本地建议话术：${run.suggestedReply}` : "",
    run.pushCopy ? `本地推送文案：${run.pushCopy}` : ""
  ].filter(Boolean).join("\n").slice(0, 2800);
}

function buildLlmMessages(state, run, customer, message = "") {
  const tags = Array.isArray(customer.tags) ? customer.tags.slice(0, 8).join("、") : "";
  const watchedModels = Array.isArray(customer.watchedModels) ? customer.watchedModels.slice(0, 6).join("、") : "";
  return [
    {
      role: "system",
      content: [
        "你是客户运营中台的Agent增强器，服务对象是销售、电销、私域、客服和售后员工。",
        "你的任务是基于本地规则Agent结果，生成更好用的中文业务建议。",
        "不要声称已经外呼、发短信、发企微或完成外部动作；所有触达都需要人工确认。",
        "不要承诺最低价、绝对库存、赔偿或平台未给出的权益。",
        "输出必须包含三段：客户判断、建议下一步、可发送草稿。控制在350字以内。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "客户摘要：",
        `客户名称：${customer.name}`,
        `当前阶段：${customer.stage}`,
        `会员状态：${customer.memberStatus || "未记录"}`,
        `意向分：${customer.intentScore || 0}`,
        `推荐卡种：${customer.targetCard || "未记录"}`,
        `标签：${tags || "暂无"}`,
        `关注型号：${watchedModels || "暂无"}`,
        "",
        "客户最新消息：",
        cleanLimitedText(message, "未提供", 1200),
        "",
        "本地规则Agent结果：",
        agentRunPromptSummary(run)
      ].join("\n").slice(0, 6000)
    }
  ];
}

function llmMissingConfigReason(modelConfig) {
  if (!modelConfig.apiUrl) return "缺少 API URL";
  if (!modelConfig.model) return "缺少模型名";
  if (!modelConfig.apiKey) return "缺少 API Key";
  return "";
}

function markLlmEnhancementFailure(run, modelConfig, status, error) {
  run.llmEnhancement = {
    status,
    error: cleanLimitedText(error, "LLM增强未完成", 800),
    model: modelConfig.model || "",
    provider: modelConfig.provider || "",
    apiUrl: modelConfig.apiUrl || "",
    source: modelConfig.source || "",
    apiKeyConfigured: Boolean(modelConfig.apiKey),
    createdAt: new Date().toISOString()
  };
  if (run.execution) {
    run.execution.modelInvocation = status;
    run.execution.llmExternalCall = false;
    run.execution.boundary = `${error}；本地规则结果已保留，未触发外呼、短信、企微或CRM动作。`;
  }
}

function markLlmEnhancementSuccess(state, run, customer, agentKey, modelConfig, result) {
  run.llmEnhancement = {
    status: "成功",
    content: cleanLimitedText(result.content, "", 2000),
    model: modelConfig.model,
    provider: modelConfig.provider,
    apiUrl: modelConfig.apiUrl,
    source: modelConfig.source,
    usage: result.usage || null,
    latencyMs: result.latencyMs,
    createdAt: new Date().toISOString()
  };
  if (run.execution) {
    run.execution.engine = "本地规则引擎 + 真实LLM增强";
    run.execution.modelInvocation = "已调用";
    run.execution.llmExternalCall = true;
    run.execution.boundary = "本地规则结果已落库，真实LLM仅用于增强建议和草稿；未触发外呼、短信、企微或CRM动作。";
  }
  const draft = upsertOutboundDraft(state, {
    customerId: customer.id,
    customerName: customer.name,
    sourceAgent: `${run.agent || "Agent"}（LLM增强）`,
    sourceRunId: run.id || "",
    channel: draftChannelForAgent(agentKey),
    draftType: "LLM增强话术",
    content: result.content,
    priority: run.priority || (run.humanRequired ? "高" : "中"),
    note: "由真实LLM根据本地规则结果生成，需人工确认后通过真实渠道处理。"
  });
  if (draft) run.llmDraftId = draft.id;
}

export async function testModelConnectionAction(inputState, payload = {}, options = {}) {
  const state = cloneState(inputState);
  const agentKey = cleanLimitedText(payload.agentKey, "sales", 60);
  const modelConfig = resolveEffectiveAgentModelWithSecret(state, agentKey);
  const missing = llmMissingConfigReason(modelConfig);
  if (missing) {
    return {
      ok: false,
      status: "配置缺失",
      error: missing,
      modelConfig: publicModelInvocationConfig(modelConfig)
    };
  }
  const prompt = cleanLimitedText(payload.prompt, "请用中文回复：模型连接成功。", 500);
  try {
    const result = await invokeChatCompletion(
      {
        ...modelConfig,
        maxTokens: Math.min(Number(modelConfig.maxTokens || 256), 256)
      },
      [
        { role: "system", content: "你是模型连接测试助手，只需简短回复连接是否成功。" },
        { role: "user", content: prompt }
      ],
      {
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs || 20000,
        maxTokens: 256
      }
    );
    return {
      ok: true,
      status: "连接成功",
      content: cleanLimitedText(result.content, "", 1000),
      latencyMs: result.latencyMs,
      usage: result.usage,
      modelConfig: publicModelInvocationConfig(modelConfig)
    };
  } catch (error) {
    return {
      ok: false,
      status: "连接失败",
      error: cleanLimitedText(error.message, "模型连接失败", 1000),
      modelConfig: publicModelInvocationConfig(modelConfig)
    };
  }
}

export async function enhanceLatestAgentRunWithLlmAction(inputState, agentKey, payload = {}, options = {}) {
  const state = cloneState(inputState);
  const run = state.agentRuns[0];
  if (!run) return state;
  const customer = getCustomer(state, payload.customerId || state.selectedCustomerId);
  if (!customer) return state;
  const modelConfig = resolveEffectiveAgentModelWithSecret(state, agentKey);
  const missing = llmMissingConfigReason(modelConfig);
  if (missing) {
    markLlmEnhancementFailure(run, modelConfig, "配置缺失", `LLM增强未执行：${missing}`);
    audit(state, "LLM增强失败", run.agent || agentKey, missing);
    return state;
  }
  try {
    const result = await invokeChatCompletion(
      {
        ...modelConfig,
        maxTokens: Math.min(Number(modelConfig.maxTokens || 1200), 1200)
      },
      buildLlmMessages(state, run, customer, payload.message || ""),
      {
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs || 30000,
        maxTokens: 1200
      }
    );
    markLlmEnhancementSuccess(state, run, customer, agentKey, modelConfig, result);
    audit(state, "LLM增强成功", run.agent || agentKey, `${modelConfig.provider}/${modelConfig.model}，耗时${result.latencyMs}ms`);
  } catch (error) {
    markLlmEnhancementFailure(run, modelConfig, "调用失败", error.message);
    audit(state, "LLM增强失败", run.agent || agentKey, error.message);
  }
  return state;
}

function annotateLatestAgentRun(state, agentKey, customerId = "") {
  ensureModelConfig(state);
  if (!state.agentRuns[0]) return;
  const customer = customerId ? getCustomer(state, customerId) : null;
  if (customer) {
    state.agentRuns[0].customerId = customer.id;
    state.agentRuns[0].customerName = customer.name;
  }
  state.agentRuns[0].modelConfig = resolveEffectiveAgentModel(state, agentKey);
  state.agentRuns[0].execution = buildAgentExecutionReport(state, agentKey);
  createDraftFromLatestAgentRun(state, agentKey, customerId);
}

function slaToMinutes(sla = "2小时") {
  const text = String(sla || "").trim();
  const value = Number(text.match(/\d+(\.\d+)?/)?.[0] || 2);
  if (!Number.isFinite(value)) return 120;
  if (text.includes("天")) return Math.max(1, Math.round(value * 24 * 60));
  if (text.includes("小时")) return Math.max(1, Math.round(value * 60));
  if (text.includes("分钟")) return Math.max(1, Math.round(value));
  return Math.max(1, Math.round(value * 60));
}

function ensureTaskTiming(task, baseDate = new Date()) {
  const fallbackCreatedAt = baseDate.toISOString();
  const existingCreated = new Date(task.createdAt || fallbackCreatedAt);
  const createdAt = Number.isNaN(existingCreated.getTime()) ? fallbackCreatedAt : existingCreated.toISOString();
  const existingDue = new Date(task.dueAt || "");
  const dueAt = Number.isNaN(existingDue.getTime())
    ? new Date(new Date(createdAt).getTime() + slaToMinutes(task.sla) * 60_000).toISOString()
    : existingDue.toISOString();
  task.createdAt = createdAt;
  task.dueAt = dueAt;
  task.escalated = Boolean(task.escalated);
  return task;
}

function hydrateTaskTimings(state) {
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  state.tasks.forEach((task) => ensureTaskTiming(task));
  return state;
}

function getTaskSlaState(task, now = new Date()) {
  ensureTaskTiming(task);
  if (task.status === "已完成") return { state: "已完成", minutesRemaining: 0, overdueMinutes: 0 };
  const due = new Date(task.dueAt).getTime();
  const current = now.getTime();
  const minutesRemaining = Math.ceil((due - current) / 60_000);
  const totalMinutes = slaToMinutes(task.sla);
  if (minutesRemaining < 0) {
    return { state: "已超时", minutesRemaining, overdueMinutes: Math.abs(minutesRemaining) };
  }
  if (minutesRemaining <= Math.max(30, Math.round(totalMinutes * 0.25))) {
    return { state: "临期", minutesRemaining, overdueMinutes: 0 };
  }
  return { state: "正常", minutesRemaining, overdueMinutes: 0 };
}

function parseReferenceDate(value, label = "reference time") {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${label}: ${value}`);
  return date;
}

function ensureCustomerLists(customer) {
  if (!Array.isArray(customer.tags)) customer.tags = [];
  if (!Array.isArray(customer.watchedModels)) customer.watchedModels = [];
}

function requireCustomer(state, customerId) {
  const customer = getCustomer(state, customerId);
  if (!customer) throw new Error(`Customer not found: ${customerId || "empty"}`);
  return customer;
}

function requireTask(state, taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`Task not found: ${taskId || "empty"}`);
  return task;
}

function cleanText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

export function seedState() {
  const state = cloneState(initialState);
  ensureModelConfig(state);
  ensureWecomConfig(state);
  state.auditLog = [
    {
      id: "audit_seed",
      actor: "system",
      action: "初始化本地样例数据",
      target: "state",
      time: new Date().toISOString()
    }
  ];
  return hydrateTaskTimings(state);
}

export function audit(state, action, target, detail = "", actor = "local-operator") {
  state.auditLog = state.auditLog || [];
  state.auditLog.unshift({
    id: `audit_${Math.random().toString(36).slice(2, 9)}`,
    actor,
    action,
    target,
    detail,
    time: new Date().toISOString()
  });
  state.auditLog = state.auditLog.slice(0, 200);
}

export function runAgentAction(inputState, kind, payload = {}) {
  const state = cloneState(inputState);
  ensureModelConfig(state);
  const customerId = payload.customerId || state.selectedCustomerId;
  const message = payload.message || "";
  let output;
  if (kind === "orchestrator") output = runOrchestratorAgent(state);
  if (!output) {
    requireCustomer(state, customerId);
    if (kind === "dialer") output = runDialerAgent(state, customerId);
    if (kind === "nurture") output = runNurtureAgent(state, customerId, message);
    if (kind === "sales") output = runSalesAgent(state, customerId, message);
    if (kind === "vip") output = runVipAgent(state, customerId, message);
    if (kind === "quote") output = runQuoteAgent(state, customerId);
  }
  if (!output) throw new Error(`Unknown agent: ${kind}`);
  if (customerId && output.state.customers.some((customer) => customer.id === customerId)) {
    output.state.selectedCustomerId = customerId;
  }
  annotateLatestAgentRun(output.state, kind, customerId);
  audit(output.state, "运行Agent", output.result.agent, agentRunAuditDetail(output.result));
  return output.state;
}

export function runDemoAction(inputState) {
  let state = cloneState(inputState);
  ensureModelConfig(state);
  for (const customer of [...state.customers]) {
    const watched = customer.watchedModels?.[0] || "关注型号";
    if (customer.stage === "待筛选" || customer.stage === "待外呼") {
      state = runDialerAgent(state, customer.id).state;
      annotateLatestAgentRun(state, "dialer", customer.id);
      continue;
    }
    if (customer.stage === "电销企微培育") {
      state = runNurtureAgent(state, customer.id, `${watched}最近还有稳定报价吗？会员权益我也想了解。`).state;
      annotateLatestAgentRun(state, "nurture", customer.id);
      continue;
    }
    if (customer.stage === "销售企微承接" || customer.stage === "销售跟进") {
      state = runSalesAgent(state, customer.id, `如果${customer.targetCard || "会员卡"}能保证优先报价和稳定货源，我这周可以继续推进。`).state;
      annotateLatestAgentRun(state, "sales", customer.id);
      continue;
    }
    if (customer.stage === "已购会员" || customer.stage === "VIP维护" || customer.stage === "续费/复购" || String(customer.memberStatus || "").includes("卡")) {
      state = runVipAgent(state, customer.id, `@销售 ${watched}今天报价发一下，售后进度也帮我同步。`).state;
      annotateLatestAgentRun(state, "vip", customer.id);
      state = runQuoteAgent(state, customer.id).state;
      annotateLatestAgentRun(state, "quote", customer.id);
    }
  }
  state = runOrchestratorAgent(state).state;
  annotateLatestAgentRun(state, "orchestrator");
  audit(state, "批量运行本地Agent", "agents", "按客户阶段运行本地规则Agent并生成闭环编排");
  return state;
}

export function runWorkflowAction(inputState) {
  const output = runOrchestratorAgent(inputState);
  annotateLatestAgentRun(output.state, "orchestrator");
  audit(output.state, "运行闭环编排", "workflow", `生成${output.result.totalPlans}个客户下一步动作`);
  return output.state;
}

export function updateTaskAction(inputState, taskId, status = "跟进中") {
  requireTask(inputState, taskId);
  const cleanStatus = normalizeTaskStatus(status);
  const state = updateTaskStatus(inputState, taskId, cleanStatus);
  const task = state.tasks.find((item) => item.id === taskId);
  if (task) state.selectedCustomerId = task.customerId;
  audit(state, "更新任务状态", taskId, cleanStatus);
  return state;
}

export function batchUpdateTasksAction(inputState, payload = {}) {
  const taskIds = [...new Set((payload.taskIds || []).map((taskId) => cleanText(taskId)).filter(Boolean))];
  if (!taskIds.length) throw new Error("Task ids are required");
  const cleanStatus = normalizeTaskStatus(payload.status, "跟进中");
  for (const taskId of taskIds) {
    requireTask(inputState, taskId);
  }
  let state = cloneState(inputState);
  const updated = [];
  for (const taskId of taskIds) {
    state = updateTaskStatus(state, taskId, cleanStatus);
    updated.push(taskId);
  }
  const firstTask = state.tasks.find((task) => task.id === updated[0]);
  if (firstTask) state.selectedCustomerId = firstTask.customerId;
  audit(state, "批量更新任务状态", "tasks", `${updated.length}个任务更新为${cleanStatus}：${updated.join("、")}`);
  return state;
}

export function subscribeQuoteAction(inputState, customerId, model) {
  requireCustomer(inputState, customerId);
  const state = subscribeQuote(inputState, customerId, model);
  state.selectedCustomerId = customerId;
  audit(state, "订阅报价型号", customerId, model);
  return state;
}

export function ingestMessageAction(inputState, payload = {}) {
  const stateWithMessage = cloneState(inputState);
  const customerId = payload.customerId || stateWithMessage.selectedCustomerId;
  const channel = payload.channel || "本地渠道";
  appendConversationMessage(stateWithMessage, {
    customerId,
    channel,
    message: payload.message,
    senderRole: payload.senderRole,
    senderName: payload.senderName
  });
  const kind = channel.includes("VIP") ? "vip" : channel.includes("销售") ? "sales" : "nurture";
  const state = runAgentAction(stateWithMessage, kind, {
    customerId,
    message: payload.message
  });
  audit(state, "渠道消息入站", channel, payload.message || "");
  return state;
}

export function createCustomerAction(inputState, payload = {}) {
  const state = cloneState(inputState);
  const watchedModels = listFromInput(payload.watchedModels);
  const tags = listFromInput(payload.tags);
  const risk = normalizeRisk(payload.risk, "低");
  const customer = {
    id: id("c"),
    name: cleanText(payload.name, "未命名客户"),
    contact: cleanText(payload.contact, "待补充"),
    phone: cleanText(payload.phone),
    stage: normalizeStage(payload.stage, "待筛选"),
    owner: cleanText(payload.owner, "待分配"),
    tradeVolume: Math.max(0, finiteNumber(payload.tradeVolume, 0)),
    purchaseFrequency: Math.max(0, finiteNumber(payload.purchaseFrequency, 0)),
    lastTradeDays: Math.max(0, finiteNumber(payload.lastTradeDays, 0)),
    memberStatus: cleanText(payload.memberStatus, "未购卡"),
    targetCard: cleanText(payload.targetCard, "待推荐"),
    tags: tags.length ? tags : ["手动新增"],
    watchedModels,
    intentScore: boundedScore(payload.intentScore, 30),
    risk,
    notes: cleanText(payload.notes, "手动新增客户。")
  };
  state.customers.unshift(customer);
  state.selectedCustomerId = customer.id;
  appendEvent(state, customer.id, {
    channel: "客户管理",
    type: "新增客户",
    text: "运营人员手动新增客户档案。"
  });
  audit(state, "新增客户", customer.id, customer.name);
  return state;
}

export function updateCustomerAction(inputState, customerId, updates = {}) {
  const state = cloneState(inputState);
  const customer = requireCustomer(state, customerId);
  ensureCustomerLists(customer);
  state.selectedCustomerId = customerId;
  const editable = ["stage", "owner", "memberStatus", "targetCard", "notes"];
  for (const key of editable) {
    if (updates[key] !== undefined) {
      if (key === "stage") customer.stage = normalizeStage(updates[key], customer.stage);
      else customer[key] = updates[key];
    }
  }
  if (updates.intentScore !== undefined) customer.intentScore = boundedScore(updates.intentScore, customer.intentScore);
  if (updates.risk !== undefined) customer.risk = normalizeRisk(updates.risk, customer.risk || "低");
  if (updates.tags !== undefined) {
    customer.tags = listFromInput(updates.tags);
  }
  if (updates.watchedModels !== undefined) {
    customer.watchedModels = listFromInput(updates.watchedModels);
  }
  appendEvent(state, customer.id, {
    channel: "客户管理",
    type: "档案更新",
    text: "客户档案字段已更新。"
  });
  audit(state, "更新客户档案", customer.id, customer.name);
  return state;
}

export function recordOutcomeAction(inputState, payload = {}) {
  const state = cloneState(inputState);
  const customer = requireCustomer(state, payload.customerId);
  ensureCustomerLists(customer);
  state.selectedCustomerId = customer.id;
  const outcome = normalizeSalesOutcome(payload.outcome, "继续培育");
  if (outcome === "成交") {
    customer.stage = "已购会员";
    customer.memberStatus = payload.memberStatus || customer.targetCard || "已购会员卡";
    customer.intentScore = Math.max(boundedScore(customer.intentScore, 0), 90);
    appendTask(state, customer.id, {
      title: "成交客户建立VIP维护小群",
      ownerRole: "私域",
      owner: "私域队列",
      priority: "高",
      sla: "2小时",
      reason: `客户已成交${customer.memberStatus}，需要建立会员小群并同步销售、客服、售后。`
    });
  }
  if (outcome === "继续培育") {
    customer.stage = "电销企微培育";
    appendTask(state, customer.id, {
      title: "继续培育客户触达",
      ownerRole: "电销",
      owner: "电销队列",
      priority: "中",
      sla: "24小时",
      reason: "销售结果为继续培育，需要回到电销企微培育链路。"
    });
  }
  if (outcome === "无效") {
    customer.stage = "待筛选";
    customer.intentScore = Math.min(boundedScore(customer.intentScore, 30), 30);
    if (!customer.tags.includes("无效")) customer.tags.push("无效");
  }
  if (outcome === "暂缓") {
    customer.stage = "销售企微承接";
    if (!customer.tags.includes("暂缓")) customer.tags.push("暂缓");
  }
  appendEvent(state, customer.id, {
    channel: "销售结果",
    type: outcome,
    text: payload.note || `销售结果记录为：${outcome}。`
  });
  audit(state, "记录销售结果", customer.id, outcome);
  return state;
}

export function createTaskAction(inputState, payload = {}) {
  const state = cloneState(inputState);
  const customerId = payload.customerId || state.selectedCustomerId;
  requireCustomer(state, customerId);
  const task = {
    id: id("t"),
    customerId,
    title: cleanText(payload.title, "人工新增任务"),
    ownerRole: normalizeOwnerRole(payload.ownerRole, "销售"),
    owner: cleanText(payload.owner, "待分配"),
    priority: normalizePriority(payload.priority, "中"),
    status: normalizeTaskStatus(payload.status, "待处理"),
    sla: cleanText(payload.sla, "2小时"),
    reason: cleanText(payload.reason, "人工新增任务。")
  };
  ensureTaskTiming(task);
  state.selectedCustomerId = task.customerId;
  state.tasks.unshift(task);
  appendEvent(state, task.customerId, {
    channel: "任务中心",
    type: "新增任务",
    text: `${task.title} 已创建。`
  });
  audit(state, "新增任务", task.id, task.title);
  return state;
}

export function upsertQuoteAction(inputState, payload = {}) {
  const state = cloneState(inputState);
  const model = cleanText(payload.model);
  const price = Number(payload.price);
  if (!model) throw new Error("Quote model is required");
  if (!Number.isFinite(price) || price < 0) throw new Error("Quote price must be a non-negative number");
  const quote = {
    id: payload.id || id("q"),
    brand: cleanText(payload.brand, "Other"),
    model,
    config: cleanText(payload.config, "标准"),
    price,
    stock: cleanText(payload.stock, "待确认"),
    validUntil: cleanText(payload.validUntil, "待确认")
  };
  const index = state.quotes.findIndex((item) => item.id === quote.id);
  const naturalIndex = state.quotes.findIndex(
    (item) => item.id !== quote.id && item.brand === quote.brand && item.model === quote.model && item.config === quote.config
  );
  if (index >= 0) state.quotes[index] = quote;
  else if (naturalIndex >= 0) state.quotes[naturalIndex] = { ...quote, id: state.quotes[naturalIndex].id };
  else state.quotes.unshift(quote);
  audit(state, index >= 0 || naturalIndex >= 0 ? "更新报价" : "新增报价", quote.id, `${quote.model} ${quote.config}`);
  return state;
}

export function updateTemplateAction(inputState, templateId, updates = {}) {
  const state = cloneState(inputState);
  const template = state.templates.find((item) => item.id === templateId);
  if (!template) throw new Error("Template not found");
  if (updates.allowed !== undefined) {
    template.allowed = updates.allowed === true || updates.allowed === "true";
  }
  if (updates.risk !== undefined) {
    if (!VALID_TEMPLATE_RISKS.has(updates.risk)) throw new Error(`Invalid template risk: ${updates.risk}`);
    template.risk = updates.risk;
  }
  if (updates.content !== undefined) template.content = cleanText(updates.content, template.content);
  if (updates.name !== undefined) template.name = cleanText(updates.name, template.name);
  audit(state, "更新模板", template.id, `${template.name} / ${template.allowed ? "允许" : "禁用"}`);
  return state;
}

export function createSalesSampleAction(inputState, payload = {}) {
  const state = cloneState(inputState);
  state.salesSamples = Array.isArray(state.salesSamples) ? state.salesSamples : [];
  const phrase = cleanText(payload.phrase);
  if (!phrase) throw new Error("Sales sample phrase is required");
  const sample = {
    id: id("ss"),
    scene: cleanText(payload.scene, "销售样本"),
    customerStage: normalizeStage(payload.customerStage, "销售企微承接"),
    targetCard: cleanText(payload.targetCard, "平台会员卡"),
    objection: cleanText(payload.objection, "待归因"),
    outcome: normalizeSampleOutcome(payload.outcome, "成交"),
    qualityScore: boundedScore(payload.qualityScore, 80),
    tags: listFromInput(payload.tags),
    phrase,
    notes: cleanText(payload.notes, "人工录入销售样本。"),
    createdAt: new Date().toISOString()
  };
  state.salesSamples.unshift(sample);
  audit(state, "新增销售样本", sample.id, `${sample.scene} / ${sample.outcome} / ${sample.qualityScore}分`);
  return state;
}

export function buildModelConfigReport(inputState) {
  const state = cloneState(inputState);
  const config = ensureModelConfig(state);
  const agents = MODEL_AGENT_DEFINITIONS.map((definition) => ({
    ...definition,
    override: {
      ...config.agents[definition.key],
      apiKey: "",
      apiKeyConfigured: Boolean(config.agents[definition.key]?.apiKey),
      apiKeyMasked: maskSecret(config.agents[definition.key]?.apiKey)
    },
    effective: resolveEffectiveAgentModel(state, definition.key)
  }));
  return {
    global: {
      ...config.global,
      apiKey: "",
      apiKeyConfigured: Boolean(config.global.apiKey),
      apiKeyMasked: maskSecret(config.global.apiKey)
    },
    voice: {
      asr: {
        ...config.voice.asr,
        apiKey: "",
        apiKeyConfigured: Boolean(config.voice.asr.apiKey),
        apiKeyMasked: maskSecret(config.voice.asr.apiKey)
      },
      tts: {
        ...config.voice.tts,
        apiKey: "",
        apiKeyConfigured: Boolean(config.voice.tts.apiKey),
        apiKeyMasked: maskSecret(config.voice.tts.apiKey)
      }
    },
    agents,
    summary: {
      totalAgents: agents.length,
      overridden: agents.filter((item) => !item.effective.inheritedFromGlobal).length,
      inherited: agents.filter((item) => item.effective.inheritedFromGlobal).length,
      globalApiKeyConfigured: Boolean(config.global.apiKey),
      voiceModelsConfigured: [config.voice.asr, config.voice.tts].filter((item) => item.model && item.apiUrl).length
    }
  };
}

export function updateModelConfigAction(inputState, payload = {}) {
  const state = cloneState(inputState);
  const current = ensureModelConfig(state);
  const nextGlobal = normalizeGlobalModelConfig({
    ...mergeModelConfigWithSecret(current.global, payload.global || {})
  });
  const nextVoice = {
    asr: normalizeVoiceModelConfig(
      mergeModelConfigWithSecret(current.voice.asr, payload.voice?.asr || {}),
      DEFAULT_MODEL_CONFIG.voice.asr
    ),
    tts: normalizeVoiceModelConfig(
      mergeModelConfigWithSecret(current.voice.tts, payload.voice?.tts || {}),
      DEFAULT_MODEL_CONFIG.voice.tts
    )
  };
  const nextAgents = {};
  const payloadAgents = payload.agents || {};
  for (const definition of MODEL_AGENT_DEFINITIONS) {
    if (!MODEL_AGENT_KEYS.has(definition.key)) continue;
    const incoming = payloadAgents[definition.key] || {};
    if (incoming.clear === true || incoming.clear === "true") {
      nextAgents[definition.key] = { provider: "", apiUrl: "", apiKey: "", model: "", temperature: "", maxTokens: "" };
      continue;
    }
    const clearOnly = Object.keys(incoming).length === 1 && Object.prototype.hasOwnProperty.call(incoming, "model") && incoming.model === "";
    const { clear, ...incomingConfig } = incoming;
    nextAgents[definition.key] = normalizeAgentModelOverride(
      clearOnly ? {} : mergeModelConfigWithSecret(current.agents[definition.key], incomingConfig)
    );
  }
  state.modelConfig = {
    global: nextGlobal,
    voice: nextVoice,
    agents: nextAgents
  };
  audit(state, "更新模型配置", "modelConfig", `LLM ${nextGlobal.provider}/${nextGlobal.model}，覆盖${buildModelConfigReport(state).summary.overridden}个Agent，语音模型${buildModelConfigReport(state).summary.voiceModelsConfigured}项`);
  return state;
}

export function buildWecomConfigReport(inputState) {
  const state = cloneState(inputState);
  const config = ensureWecomConfig(state);
  const bindings = ensureWecomBindings(state);
  const routes = config.routes || [];
  return {
    config: publicWecomConfig(config),
    summary: {
      enabled: Boolean(config.enabled),
      sendMode: config.sendMode,
      totalRoutes: routes.length,
      enabledRoutes: routes.filter((route) => route.enabled).length,
      configuredRoutes: routes.filter((route) => route.webhookUrl).length,
      inboundEnabled: Boolean(config.inbound?.enabled),
      aibotEnabled: Boolean(config.aibot?.enabled),
      aibotConfigured: Boolean(config.aibot?.botId && config.aibot?.secret),
      archiveEnabled: Boolean(config.archive?.enabled),
      archiveStatus: config.archive?.status || "未配置",
      archiveCursor: config.archive?.cursor || "",
      bridgeStatus: config.aibot?.bridgeStatus || "未启动",
      boundGroups: bindings.groups.filter((binding) => binding.status === "已绑定").length,
      pendingGroups: bindings.groups.filter((binding) => binding.status !== "已绑定").length,
      defaultRouteId: config.defaultRouteId,
      ...latestWecomSummary(state)
    },
    bindings: bindings.groups.slice(0, 100),
    logs: (state.wecomLogs || []).slice(0, 50)
  };
}

export function buildPersonalWechatReport(inputState) {
  const state = cloneState(inputState);
  const config = ensurePersonalWechat(state);
  const activeJobs = config.sendJobs.filter((job) => ACTIVE_PERSONAL_WECHAT_JOB_STATUSES.has(job.status));
  return {
    config: publicPersonalWechat(config),
    summary: {
      enabled: Boolean(config.enabled),
      accountId: config.account.id,
      accountName: config.account.name,
      accountStatus: config.account.status,
      autoReply: Boolean(config.account.autoReply),
      groups: config.groupContexts.length,
      queuedJobs: config.sendJobs.filter((job) => job.status === "queued").length,
      sentJobs: config.sendJobs.filter((job) => job.status === "sent").length,
      manualJobs: config.sendJobs.filter((job) => job.status === "manual_required").length,
      confirmedJobs: config.sendJobs.filter((job) => job.status === "confirmed").length,
      failedJobs: config.sendJobs.filter((job) => job.status === "failed").length,
      activeJobs: activeJobs.length,
      highRiskDecisions: config.decisions.filter((decision) => decision.riskLevel === "high").length,
      concurrency: config.account.concurrency,
      maxSendsPerMinute: config.account.maxSendsPerMinute,
      lastEventAt: config.account.lastEventAt || config.logs[0]?.createdAt || ""
    }
  };
}

export function updateWecomConfigAction(inputState, payload = {}) {
  const state = cloneState(inputState);
  const current = ensureWecomConfig(state);
  state.wecomConfig = normalizeWecomConfig(payload, current);
  audit(
    state,
    "更新企微配置",
    "wecomConfig",
    `启用${state.wecomConfig.enabled ? "是" : "否"}，路由${state.wecomConfig.routes.length}个，已配置Webhook ${state.wecomConfig.routes.filter((route) => route.webhookUrl).length}个，智能机器人${state.wecomConfig.aibot?.botId && state.wecomConfig.aibot?.secret ? "已配置" : "未配置"}`
  );
  return state;
}

export function updatePersonalWechatConfigAction(inputState, payload = {}) {
  const state = cloneState(inputState);
  const current = ensurePersonalWechat(state);
  state.personalWechat = normalizePersonalWechatConfig({
    ...current,
    enabled: payload.enabled,
    account: {
      ...(current.account || DEFAULT_PERSONAL_WECHAT.account),
      ...(payload.account || {})
    }
  }, current);
  audit(
    state,
    "更新个人微信AccountAgent配置",
    "personalWechat",
    `${state.personalWechat.enabled ? "启用" : "停用"}，账号 ${state.personalWechat.account.name}，自动回复${state.personalWechat.account.autoReply ? "开启" : "关闭"}`
  );
  return state;
}

export function ingestPersonalWechatMessageAction(inputState, payload = {}) {
  const state = cloneState(inputState);
  const config = ensurePersonalWechat(state);
  ensureWecomConfig(state);
  ensureWecomBindings(state);
  if (!config.enabled) throw new Error("Personal WeChat AccountAgent is disabled");
  const inbound = normalizeInboundGroupMessage(payload, payload.source || "personal-wechat");
  if (hasRecentPersonalWechatMessage(state, inbound.messageId)) {
    appendPersonalWechatLog(state, {
      type: "重复入站",
      status: "成功",
      accountId: config.account.id,
      roomId: inbound.roomId,
      roomName: inbound.roomName,
      messageId: inbound.messageId,
      contentPreview: inbound.text
    });
    audit(state, "个人微信重复消息忽略", inbound.roomId, inbound.messageId);
    return state;
  }

  let target = resolveWecomInboundTarget(state, {
    customerId: inbound.customerId,
    chatId: inbound.roomId,
    chatName: inbound.roomName,
    channel: "VIP群",
    source: inbound.source
  }, state.wecomConfig);
  const context = upsertPersonalWechatContext(state, {
    roomId: inbound.roomId,
    roomName: inbound.roomName,
    customerId: target.customerId,
    accountId: config.account.id,
    message: {
      messageId: inbound.messageId,
      senderName: inbound.senderName,
      senderType: inbound.senderType,
      text: inbound.text,
      msgType: inbound.msgType,
      sendAt: inbound.sendAt,
      source: inbound.source
    }
  });
  upsertWecomGroupBinding(state, {
    chatId: inbound.roomId,
    chatName: inbound.roomName,
    customerId: target.customerId,
    channel: "VIP群",
    source: inbound.source,
    status: target.binding?.status || "已绑定",
    lastMessageAt: inbound.sendAt,
    lastSenderId: inbound.senderId || inbound.senderName,
    incrementMessageCount: true
  });

  let nextState = state;
  if (inbound.senderType === "customer") {
    nextState = ingestMessageAction(state, {
      customerId: target.customerId,
      channel: "VIP模拟群",
      message: inbound.text,
      senderRole: "客户",
      senderName: inbound.senderName
    });
  } else {
    appendConversationMessage(nextState, {
      customerId: target.customerId,
      channel: "VIP模拟群",
      message: inbound.text,
      senderRole: ["bot", "managed_account"].includes(inbound.senderType) ? "私域" : "销售",
      senderName: inbound.senderName
    });
    cancelActivePersonalWechatJobsForRoom(ensurePersonalWechat(nextState), inbound.roomId, "群内已有员工或托管号回复，取消自动发送。");
  }

  const decision = createPersonalWechatDecision(nextState, { ...payload, ...inbound }, context);
  const decisionConfig = ensurePersonalWechat(nextState);
  decisionConfig.decisions.unshift(decision);
  decisionConfig.decisions = decisionConfig.decisions.slice(0, 200);
  const job = enqueuePersonalWechatSendJob(nextState, decision);
  const updatedConfig = ensurePersonalWechat(nextState);
  updatedConfig.account.status = "运行中";
  updatedConfig.account.lastEventAt = new Date().toISOString();
  updatedConfig.account.lastError = "";
  appendPersonalWechatLog(nextState, {
    type: "消息入站",
    status: "成功",
    accountId: updatedConfig.account.id,
    roomId: inbound.roomId,
    roomName: inbound.roomName,
    messageId: inbound.messageId,
    sendJobId: job?.jobId || "",
    contentPreview: inbound.text
  });
  audit(nextState, inbound.source === "wecom-archive" ? "会话存档消息入站" : "个人微信消息入站", inbound.roomId, `${inbound.senderName}: ${inbound.text}`);
  return nextState;
}

export function ingestWecomArchiveMessageAction(inputState, payload = {}) {
  const baseState = cloneState(inputState);
  const config = ensureWecomConfig(baseState);
  if (!config.archive?.enabled) throw new Error("WeCom archive gateway is disabled");
  const inbound = normalizeInboundGroupMessage({ ...payload, source: "wecom-archive" }, "wecom-archive");
  let nextState = ingestPersonalWechatMessageAction(baseState, {
    ...inbound,
    customerId: inbound.customerId || config.archive.defaultCustomerId,
    channel: config.archive.defaultChannel || "VIP群"
  });
  const nextConfig = ensureWecomConfig(nextState);
  nextConfig.archive.status = "运行中";
  nextConfig.archive.cursor = cleanLimitedText(payload.cursor || inbound.messageId, nextConfig.archive.cursor || "", 220);
  nextConfig.archive.lastPulledAt = new Date().toISOString();
  nextConfig.archive.lastMessageAt = inbound.sendAt;
  nextConfig.archive.lastError = "";
  appendWecomLog(nextState, {
    type: "会话存档入站",
    status: "成功",
    customerId: inbound.customerId || nextConfig.archive.defaultCustomerId || nextState.selectedCustomerId,
    channel: "VIP模拟群",
    source: "wecom-archive",
    externalMessageId: inbound.messageId,
    chatId: inbound.roomId,
    senderId: inbound.senderId || inbound.senderName,
    contentPreview: inbound.text,
    externalSideEffects: false
  });
  audit(nextState, "企微会话存档入站", inbound.roomId, inbound.messageId);
  return nextState;
}

export function runPersonalWechatSendSchedulerAction(inputState, payload = {}) {
  const state = cloneState(inputState);
  const config = ensurePersonalWechat(state);
  if (!config.enabled) throw new Error("Personal WeChat AccountAgent is disabled");
  const result = dispatchPersonalWechatJobs(state, payload);
  state.personalWechat.schedulerResult = {
    ...result,
    createdAt: new Date(personalWechatNowMs(payload.now)).toISOString()
  };
  return state;
}

export function failPersonalWechatSendJobAction(inputState, jobId = "", payload = {}) {
  const state = cloneState(inputState);
  const config = ensurePersonalWechat(state);
  const normalizedJobId = cleanLimitedText(jobId || payload.jobId, "", 80);
  const job = config.sendJobs.find((item) => item.jobId === normalizedJobId);
  if (!job) throw new Error("Personal WeChat send job not found");
  const nowMs = personalWechatNowMs(payload.now);
  const now = new Date(nowMs).toISOString();
  const backoffSeconds = Math.max(5, Number(config.account.failureBackoffSeconds || 30));
  job.status = "failed";
  job.error = cleanLimitedText(payload.error, "个人微信Gateway发送失败，需退避后重新判断或人工接管。", 400);
  job.retryAfterAt = new Date(nowMs + backoffSeconds * 1000).toISOString();
  job.attempts = Math.max(1, Number(job.attempts || 0));
  config.account.status = "异常";
  config.account.lastEventAt = now;
  config.account.lastError = job.error;
  const context = config.groupContexts.find((item) => item.roomId === job.roomId);
  if (context?.pendingSendJobId === job.jobId) context.pendingSendJobId = "";
  appendPersonalWechatLog(state, {
    type: "发送失败",
    status: "失败",
    accountId: job.accountId,
    roomId: job.roomId,
    roomName: job.roomName,
    sendJobId: job.jobId,
    contentPreview: job.replyText,
    error: job.error,
    externalSideEffects: false
  });
  audit(state, "个人微信发送失败", job.jobId, job.error);
  return state;
}

export function confirmPersonalWechatSendJobAction(inputState, jobId = "", payload = {}) {
  const state = cloneState(inputState);
  const config = ensurePersonalWechat(state);
  const normalizedJobId = cleanLimitedText(jobId || payload.jobId, "", 80);
  const job = config.sendJobs.find((item) => item.jobId === normalizedJobId);
  if (!job) throw new Error("Personal WeChat send job not found");
  const nowMs = personalWechatNowMs(payload.now);
  expirePersonalWechatSendJobs(config, nowMs);
  if (job.status === "cancelled") {
    appendPersonalWechatLog(state, {
      type: "发送过期",
      status: "失败",
      accountId: job.accountId,
      roomId: job.roomId,
      roomName: job.roomName,
      sendJobId: job.jobId,
      contentPreview: job.replyText,
      error: job.error,
      externalSideEffects: false
    });
    audit(state, "个人微信发送过期", job.jobId, job.error || "发送任务已过期");
    return state;
  }
  if (!["queued", "manual_required", "sending", "sent"].includes(job.status)) throw new Error(`Cannot confirm send job in status ${job.status}`);
  const waitSeconds = ["sending", "sent"].includes(job.status) ? 0 : personalWechatThrottleWaitSeconds(config, job, nowMs);
  if (waitSeconds > 0) {
    job.error = `账号发送限频中，请${waitSeconds}秒后再发送。`;
    appendPersonalWechatLog(state, {
      type: "发送限频",
      status: "失败",
      accountId: job.accountId,
      roomId: job.roomId,
      roomName: job.roomName,
      sendJobId: job.jobId,
      contentPreview: job.replyText,
      error: job.error,
      externalSideEffects: false
    });
    audit(state, "个人微信发送限频", job.jobId, job.error);
    return state;
  }
  const context = config.groupContexts.find((item) => item.roomId === job.roomId);
  const binding = findWecomGroupBinding(state, job.roomId);
  const customerId = binding?.customerId || context?.customerId || config.account.defaultCustomerId || state.selectedCustomerId;
  const customer = requireCustomer(state, customerId);
  const now = new Date(nowMs).toISOString();
  job.status = "confirmed";
  job.scheduledAt = job.scheduledAt || now;
  job.sentAt = job.sentAt || now;
  job.confirmedAt = now;
  job.confirmedMessageId = cleanLimitedText(payload.confirmedMessageId, `pwx_echo_${job.jobId}`, 180);
  job.error = "";
  config.account.lastEventAt = now;
  config.account.lastError = "";
  if (context) {
    context.lastReplyAt = now;
    context.pendingSendJobId = "";
  }
  appendConversationMessage(state, {
    customerId: customer.id,
    channel: "VIP模拟群",
    message: job.replyText,
    senderRole: "私域",
    senderName: config.account.displayName || config.account.name
  });
  appendPersonalWechatLog(state, {
    type: "发送确认",
    status: "成功",
    accountId: job.accountId,
    roomId: job.roomId,
    roomName: job.roomName,
    sendJobId: job.jobId,
    messageId: job.confirmedMessageId,
    contentPreview: job.replyText,
    externalSideEffects: false
  });
  appendEvent(state, customer.id, {
    channel: "个人微信托管",
    type: "模拟发送确认",
    text: `AccountAgent已确认发送：${job.replyText}`
  });
  audit(state, "个人微信发送确认", job.jobId, `${job.roomName || job.roomId} / ${job.status}`);
  return state;
}

export function updateWecomGroupBindingAction(inputState, payload = {}) {
  const state = cloneState(inputState);
  ensureWecomConfig(state);
  const customerId = cleanLimitedText(payload.customerId, "", 80);
  if (customerId) requireCustomer(state, customerId);
  const binding = upsertWecomGroupBinding(state, {
    chatId: payload.chatId,
    chatName: payload.chatName,
    customerId,
    channel: payload.channel || "VIP群",
    source: payload.source || "wecom-aibot"
  });
  audit(state, "更新企微群绑定", binding.chatId, `${binding.chatName} -> ${binding.customerId || "待绑定"}`);
  return state;
}

export function testWecomAibotConfigAction(inputState) {
  const state = cloneState(inputState);
  const config = ensureWecomConfig(state);
  const aibot = config.aibot || DEFAULT_WECOM_CONFIG.aibot;
  const missing = [];
  if (!aibot.botId) missing.push("Bot ID");
  if (!aibot.secret) missing.push("Secret");
  return {
    ok: missing.length === 0,
    status: missing.length ? "智能机器人凭据不完整" : "智能机器人凭据已保存",
    missing,
    bridgeReady: missing.length === 0,
    bridgeStatus: aibot.bridgeStatus || "未启动",
    defaultChannel: aibot.defaultChannel || "VIP群",
    autoReply: Boolean(aibot.autoReply),
    note: missing.length
      ? "保存 Bot ID 和 Secret 后，再启动长连接桥接服务。"
      : "配置已满足长连接桥接启动条件；真实连接状态以 bridge 运行日志为准。"
  };
}

export function updateWecomBridgeStatusAction(inputState, payload = {}) {
  const state = cloneState(inputState);
  const config = ensureWecomConfig(state);
  const now = new Date().toISOString();
  config.aibot.bridgeStatus = cleanLimitedText(payload.status, config.aibot.bridgeStatus || "未启动", 40);
  config.aibot.lastEventAt = now;
  if (payload.status === "已连接" || payload.status === "认证成功") config.aibot.lastConnectedAt = now;
  config.aibot.lastError = cleanLimitedText(payload.error, payload.status === "错误" ? "未知错误" : "", 400);
  appendWecomLog(state, {
    type: "桥接状态",
    status: payload.error ? "失败" : "成功",
    source: "wecom-aibot",
    channel: "企微长连接",
    contentPreview: cleanLimitedText(payload.detail || payload.status, "", 180),
    error: payload.error || "",
    externalSideEffects: false
  });
  audit(state, "企微桥接状态", "wecom-aibot", `${config.aibot.bridgeStatus}${config.aibot.lastError ? ` / ${config.aibot.lastError}` : ""}`);
  return state;
}

export async function sendWecomTestAction(inputState, payload = {}, options = {}) {
  const state = cloneState(inputState);
  ensureWecomConfig(state);
  let route = null;
  const content = cleanLimitedText(payload.content, "企微连接测试：客户运营中台已连接测试群机器人。", 1800);
  try {
    route = resolveWecomRoute(state, payload.routeId);
    const result = await sendWecomGroupRobotMessage(
      route,
      {
        content,
        msgtype: payload.msgtype || route.msgtype
      },
      options
    );
    appendWecomLog(state, {
      type: "测试发送",
      status: "成功",
      routeId: route.id,
      routeName: route.name,
      channel: route.channel,
      contentPreview: content,
      latencyMs: result.latencyMs,
      externalSideEffects: true
    });
    audit(state, "企微测试发送成功", route.id, `${route.name} / ${result.latencyMs}ms`);
  } catch (error) {
    appendWecomLog(state, {
      type: "测试发送",
      status: "失败",
      routeId: route?.id || cleanLimitedText(payload.routeId, "", 80),
      routeName: route?.name || "",
      channel: route?.channel || "企微",
      contentPreview: content,
      error: error.message,
      externalSideEffects: false
    });
    audit(state, "企微测试发送失败", route?.id || "wecom", error.message);
  }
  return state;
}

export async function sendOutboundDraftToWecomAction(inputState, draftId, payload = {}, options = {}) {
  const state = cloneState(inputState);
  state.outboundDrafts = Array.isArray(state.outboundDrafts) ? state.outboundDrafts : [];
  const draft = state.outboundDrafts.find((item) => item.id === draftId);
  if (!draft) throw new Error(`Draft not found: ${draftId || "empty"}`);
  const customer = requireCustomer(state, draft.customerId);
  if (draft.status !== "已确认") {
    throw new Error("Only confirmed drafts can be sent to WeCom");
  }
  let route = null;
  try {
    const config = ensureWecomConfig(state);
    if (config.sendMode === "testOnly") throw new Error("WeCom send mode is testOnly; draft sending is disabled");
    route = resolveWecomRoute(state, payload.routeId);
    const result = await sendWecomGroupRobotMessage(
      route,
      {
        content: draft.content,
        msgtype: payload.msgtype || route.msgtype
      },
      options
    );
    const now = new Date().toISOString();
    draft.status = "企微已发送";
    draft.externalSideEffects = true;
    draft.sentAt = now;
    draft.updatedAt = now;
    draft.completedAt = draft.completedAt || now;
    draft.wecomDelivery = {
      routeId: route.id,
      routeName: route.name,
      channel: route.channel,
      provider: result.provider,
      msgtype: result.msgtype,
      latencyMs: result.latencyMs,
      response: result.response,
      sentAt: now
    };
    appendEvent(state, draft.customerId, {
      channel: "企微触达",
      type: "草稿已发送企微",
      text: `${draft.draftType} 已通过${route.name}发送到企微测试群。`
    });
    appendWecomLog(state, {
      type: "草稿发送",
      status: "成功",
      routeId: route.id,
      routeName: route.name,
      customerId: customer.id,
      customerName: customer.name,
      draftId: draft.id,
      channel: route.channel,
      contentPreview: draft.content,
      latencyMs: result.latencyMs,
      externalSideEffects: true
    });
    audit(state, "企微草稿发送成功", draft.id, `${customer.name} / ${route.name} / ${result.latencyMs}ms`);
  } catch (error) {
    appendWecomLog(state, {
      type: "草稿发送",
      status: "失败",
      routeId: route?.id || cleanLimitedText(payload.routeId, "", 80),
      routeName: route?.name || "",
      customerId: customer.id,
      customerName: customer.name,
      draftId: draft.id,
      channel: route?.channel || draft.channel || "企微",
      contentPreview: draft.content,
      error: error.message,
      externalSideEffects: false
    });
    audit(state, "企微草稿发送失败", draft.id, error.message);
  }
  state.selectedCustomerId = draft.customerId;
  return state;
}

export function ingestWecomMessageAction(inputState, payload = {}) {
  const state = cloneState(inputState);
  const config = ensureWecomConfig(state);
  ensureWecomBindings(state);
  if (!config.inbound?.enabled) throw new Error("WeCom inbound adapter is disabled");
  const expectedSecret = config.inbound?.secret || "";
  if (expectedSecret && payload.secret !== expectedSecret) throw new Error("Invalid WeCom inbound secret");
  const externalMessageId = cleanLimitedText(payload.externalMessageId || payload.messageId || payload.msgid, "", 180);
  const requestId = cleanLimitedText(payload.requestId || payload.reqId || payload.req_id, "", 180);
  const chatId = cleanLimitedText(payload.chatId || payload.chatid, "", 180);
  const senderId = cleanLimitedText(payload.senderId || payload.userid || payload.fromUserId, "", 180);
  const source = cleanLimitedText(payload.source, chatId ? "wecom-aibot" : "local-simulator", 60);
  const message = cleanLimitedText(payload.message, "", 4000);
  if (externalMessageId && hasRecentWecomInbound(state, externalMessageId)) {
    appendWecomLog(state, {
      type: "重复入站",
      status: "成功",
      channel: defaultWecomInboundChannel(payload.channel || config.inbound?.defaultChannel || "VIP群"),
      source,
      externalMessageId,
      requestId,
      chatId,
      senderId,
      deduped: true,
      contentPreview: message,
      externalSideEffects: false
    });
    audit(state, "企微重复消息忽略", chatId || "wecom", externalMessageId);
    return state;
  }
  const target = resolveWecomInboundTarget(state, { ...payload, chatId, source }, config);
  const bindingChannel = target.binding?.channel || payload.channel || config.aibot?.defaultChannel || config.inbound?.defaultChannel || "VIP群";
  const channel = defaultWecomInboundChannel(bindingChannel);
  if (chatId) {
    upsertWecomGroupBinding(state, {
      chatId,
      chatName: target.chatName || payload.chatName || payload.groupName,
      customerId: target.customerId,
      channel: bindingChannel,
      source,
      status: target.binding?.status || "已绑定",
      lastMessageAt: new Date().toISOString(),
      lastSenderId: senderId,
      incrementMessageCount: true
    });
  }
  const nextState = ingestMessageAction(state, {
    customerId: target.customerId,
    channel,
    message,
    senderRole: payload.senderRole || "客户",
    senderName: payload.senderName || senderId || ""
  });
  appendWecomLog(nextState, {
    type: "消息入站",
    status: "成功",
    customerId: target.customerId,
    customerName: getCustomer(nextState, target.customerId)?.name || "",
    channel,
    source,
    externalMessageId,
    requestId,
    chatId,
    senderId,
    contentPreview: message,
    externalSideEffects: false
  });
  audit(nextState, "企微消息入站", chatId || channel, message || "");
  return nextState;
}

export function buildOutboundDraftReport(inputState) {
  const state = cloneState(inputState);
  state.outboundDrafts = Array.isArray(state.outboundDrafts) ? state.outboundDrafts : [];
  const customerById = new Map(state.customers.map((customer) => [customer.id, customer]));
  const drafts = state.outboundDrafts.map((draft) => {
    const customer = customerById.get(draft.customerId);
    return {
      ...draft,
      customerName: draft.customerName || customer?.name || "未知客户",
      customerStage: customer?.stage || "",
      customerOwner: customer?.owner || "",
      externalSideEffects: Boolean(draft.externalSideEffects),
      wecomDelivery: draft.wecomDelivery || null
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      total: drafts.length,
      pending: drafts.filter((draft) => draft.status === "待确认").length,
      confirmed: drafts.filter((draft) => draft.status === "已确认").length,
      wecomSent: drafts.filter((draft) => draft.status === "企微已发送").length,
      copied: drafts.filter((draft) => draft.status === "已复制").length,
      completed: drafts.filter((draft) => draft.status === "人工已处理").length,
      discarded: drafts.filter((draft) => draft.status === "已废弃").length
    },
    drafts
  };
}

export function createOutboundDraftAction(inputState, payload = {}) {
  const state = cloneState(inputState);
  const customerId = payload.customerId || state.selectedCustomerId;
  const customer = requireCustomer(state, customerId);
  const draft = upsertOutboundDraft(state, {
    customerId: customer.id,
    customerName: customer.name,
    sourceAgent: "人工创建",
    channel: payload.channel,
    draftType: cleanText(payload.draftType, "人工触达文案"),
    content: payload.content,
    priority: payload.priority,
    status: "待确认",
    note: payload.note
  });
  if (!draft) throw new Error("Draft content is required");
  state.selectedCustomerId = customer.id;
  appendEvent(state, customer.id, {
    channel: "触达草稿",
    type: "新增草稿",
    text: `${draft.channel}草稿已创建，等待人工确认。`
  });
  audit(state, "新增触达草稿", draft.id, `${customer.name} / ${draft.channel}`);
  return state;
}

function applyOutboundDraftStatus(state, draft, status, note = "") {
  const now = new Date().toISOString();
  draft.status = status;
  draft.note = cleanText(note, draft.note || "");
  draft.externalSideEffects = status === "企微已发送" ? Boolean(draft.wecomDelivery) : false;
  draft.updatedAt = now;
  if (status === "已确认" && !draft.confirmedAt) draft.confirmedAt = now;
  if (status === "已复制" && !draft.copiedAt) draft.copiedAt = now;
  if (status === "人工已处理" && !draft.completedAt) draft.completedAt = now;
  if (status === "已废弃" && !draft.discardedAt) draft.discardedAt = now;
  appendEvent(state, draft.customerId, {
    channel: "触达草稿",
    type: "草稿状态更新",
    text: `草稿 ${draft.draftType} 已更新为 ${status}。${draft.note ? `备注：${draft.note}` : ""}`
  });
}

export function updateOutboundDraftStatusAction(inputState, draftId, payload = {}) {
  const state = cloneState(inputState);
  state.outboundDrafts = Array.isArray(state.outboundDrafts) ? state.outboundDrafts : [];
  const draft = state.outboundDrafts.find((item) => item.id === draftId);
  if (!draft) throw new Error(`Draft not found: ${draftId || "empty"}`);
  requireCustomer(state, draft.customerId);
  const status = normalizeDraftStatus(payload.status, draft.status || "待确认");
  if (status === "企微已发送") throw new Error("Use WeCom send action to mark WeCom sent");
  applyOutboundDraftStatus(state, draft, status, payload.note);
  state.selectedCustomerId = draft.customerId;
  audit(state, "更新触达草稿", draft.id, `${draft.draftType} / ${status}`);
  return state;
}

export function batchUpdateOutboundDraftsAction(inputState, payload = {}) {
  const draftIds = [...new Set((payload.draftIds || []).map((draftId) => cleanText(draftId)).filter(Boolean))];
  if (!draftIds.length) throw new Error("Draft ids are required");
  const status = normalizeDraftStatus(payload.status, "待确认");
  if (status === "企微已发送") throw new Error("Use WeCom send action to mark WeCom sent");
  const state = cloneState(inputState);
  state.outboundDrafts = Array.isArray(state.outboundDrafts) ? state.outboundDrafts : [];
  const updated = [];
  for (const draftId of draftIds) {
    const draft = state.outboundDrafts.find((item) => item.id === draftId);
    if (!draft) throw new Error(`Draft not found: ${draftId || "empty"}`);
    requireCustomer(state, draft.customerId);
    applyOutboundDraftStatus(state, draft, status, payload.note);
    updated.push(draft.id);
  }
  const firstDraft = state.outboundDrafts.find((draft) => draft.id === updated[0]);
  if (firstDraft) state.selectedCustomerId = firstDraft.customerId;
  audit(state, "批量更新触达草稿", "outboundDrafts", `${updated.length}条草稿更新为${status}：${updated.join("、")}`);
  return state;
}

export function buildTaskSlaReport(inputState, nowInput) {
  const state = hydrateTaskTimings(cloneState(inputState));
  const now = parseReferenceDate(nowInput, "reference time");
  const tasks = state.tasks.map((task) => {
    const sla = getTaskSlaState(task, now);
    return {
      id: task.id,
      customerId: task.customerId,
      title: task.title,
      ownerRole: task.ownerRole,
      owner: task.owner,
      priority: task.priority,
      status: task.status,
      sla: task.sla,
      createdAt: task.createdAt,
      dueAt: task.dueAt,
      escalated: Boolean(task.escalated),
      completedAt: task.completedAt || "",
      slaState: sla.state,
      minutesRemaining: sla.minutesRemaining,
      overdueMinutes: sla.overdueMinutes
    };
  });
  return {
    generatedAt: now.toISOString(),
    summary: {
      total: tasks.length,
      open: tasks.filter((task) => task.status !== "已完成").length,
      overdue: tasks.filter((task) => task.slaState === "已超时").length,
      dueSoon: tasks.filter((task) => task.slaState === "临期").length,
      escalated: tasks.filter((task) => task.escalated).length,
      completed: tasks.filter((task) => task.status === "已完成").length
    },
    tasks
  };
}

export function escalateOverdueTasksAction(inputState, payload = {}) {
  const state = hydrateTaskTimings(cloneState(inputState));
  const now = parseReferenceDate(payload.now, "reference time");
  const escalated = [];
  for (const task of state.tasks) {
    const sla = getTaskSlaState(task, now);
    if (task.status === "已完成" || task.escalated || sla.state !== "已超时") continue;
    const previousOwnerRole = task.ownerRole;
    const previousOwner = task.owner;
    task.escalated = true;
    task.escalatedAt = now.toISOString();
    task.previousOwnerRole = previousOwnerRole;
    task.previousOwner = previousOwner;
    task.ownerRole = "主管";
    task.owner = "主管队列";
    task.priority = "高";
    task.reason = `${task.reason} [SLA升级] 原负责人${previousOwnerRole}/${previousOwner}，已超时${sla.overdueMinutes}分钟。`;
    appendEvent(state, task.customerId, {
      channel: "SLA监控",
      type: "任务超时升级",
      text: `${task.title} 已从${previousOwnerRole}升级到主管队列，超时${sla.overdueMinutes}分钟。`
    });
    escalated.push(task.id);
  }
  audit(state, "运行SLA巡检", "tasks", escalated.length ? `升级${escalated.length}个任务：${escalated.join("、")}` : "无超时待升级任务");
  return state;
}

function check(name, passed, detail, severity = "失败") {
  return {
    name,
    status: passed ? "通过" : severity,
    detail
  };
}

export function diagnoseState(inputState) {
  const rawState = cloneState(inputState);
  const invalidTaskTiming = rawState.tasks.filter((task) => Number.isNaN(new Date(task.createdAt).getTime()) || Number.isNaN(new Date(task.dueAt).getTime()));
  const state = hydrateTaskTimings(rawState);
  const customerIds = new Set(state.customers.map((customer) => customer.id));
  const customerIdCounts = state.customers.reduce((acc, customer) => {
    acc[customer.id] = (acc[customer.id] || 0) + 1;
    return acc;
  }, {});
  const duplicateCustomers = Object.entries(customerIdCounts).filter(([, count]) => count > 1).map(([customerId]) => customerId);
  const taskIdCounts = state.tasks.reduce((acc, task) => {
    acc[task.id] = (acc[task.id] || 0) + 1;
    return acc;
  }, {});
  const duplicateTasks = Object.entries(taskIdCounts).filter(([, count]) => count > 1).map(([taskId]) => taskId);
  const quoteKeys = new Set();
  const duplicateQuotes = [];

  for (const quote of state.quotes) {
    const key = `${quote.brand}::${quote.model}::${quote.config}`;
    if (quoteKeys.has(key)) duplicateQuotes.push(key);
    quoteKeys.add(key);
  }

  const orphanTasks = state.tasks.filter((task) => !customerIds.has(task.customerId));
  const orphanEvents = state.events.filter((event) => !customerIds.has(event.customerId));
  const orphanPlans = (state.workflowPlans || []).filter((plan) => !customerIds.has(plan.customerId));
  const conversations = Array.isArray(state.conversations) ? state.conversations : [];
  const outboundDrafts = Array.isArray(state.outboundDrafts) ? state.outboundDrafts : [];
  const orphanConversations = conversations.filter((conversation) => !customerIds.has(conversation.customerId));
  const orphanDrafts = outboundDrafts.filter((draft) => !customerIds.has(draft.customerId));
  const invalidDrafts = outboundDrafts.filter(
    (draft) => {
      const sentByWecom =
        draft.status === "企微已发送" &&
        draft.externalSideEffects === true &&
        draft.wecomDelivery?.provider === "wecom-group-robot";
      return (
        !draft.content ||
        !VALID_DRAFT_STATUSES.has(draft.status) ||
        !VALID_DRAFT_CHANNELS.has(draft.channel) ||
        (!sentByWecom && draft.externalSideEffects !== false)
      );
    }
  );
  const invalidConversationMessages = conversations.flatMap((conversation) =>
    (conversation.messages || [])
      .filter((message) => !message.text || !VALID_MESSAGE_ROLES.has(message.senderRole))
      .map((message) => `${conversation.id}:${message.id || "missing"}`)
  );
  const invalidStages = state.customers.filter((customer) => !VALID_STAGES.has(customer.stage));
  const invalidScores = state.customers.filter((customer) => !Number.isFinite(Number(customer.intentScore)) || Number(customer.intentScore) < 0 || Number(customer.intentScore) > 100);
  const invalidTaskStatuses = state.tasks.filter((task) => !VALID_TASK_STATUSES.has(task.status));
  const invalidTaskPriorities = state.tasks.filter((task) => !VALID_PRIORITIES.has(task.priority));
  const invalidTaskOwners = state.tasks.filter((task) => !VALID_OWNER_ROLES.has(task.ownerRole));
  const invalidEvents = state.events.filter((event) => !event.id || !event.channel || !event.type || !event.text);
  const invalidQuotes = state.quotes.filter(
    (quote) => !quote.model || !Number.isFinite(Number(quote.price)) || Number(quote.price) < 0
  );
  const invalidTemplates = state.templates.filter((template) => !template.name || !VALID_TEMPLATE_RISKS.has(template.risk));
  const highRiskAllowed = state.templates.filter((template) => template.risk === "高" && template.allowed);
  const staleSelected = state.selectedCustomerId && !customerIds.has(state.selectedCustomerId);
  const invalidSalesSamples = (state.salesSamples || []).filter(
    (sample) =>
      !sample.phrase ||
      !VALID_SAMPLE_OUTCOMES.has(sample.outcome) ||
      !VALID_STAGES.has(sample.customerStage) ||
      !Number.isFinite(Number(sample.qualityScore)) ||
      Number(sample.qualityScore) < 0 ||
      Number(sample.qualityScore) > 100
  );
  const wecomBindings = ensureWecomBindings(state);
  const chatIdCounts = wecomBindings.groups.reduce((acc, binding) => {
    acc[binding.chatId] = (acc[binding.chatId] || 0) + 1;
    return acc;
  }, {});
  const duplicateWecomChats = Object.entries(chatIdCounts).filter(([, count]) => count > 1).map(([chatId]) => chatId);
  const orphanWecomBindings = wecomBindings.groups.filter((binding) => binding.customerId && !customerIds.has(binding.customerId));
  const personalWechat = ensurePersonalWechat(state);
  const personalRoomCounts = personalWechat.groupContexts.reduce((acc, context) => {
    acc[context.roomId] = (acc[context.roomId] || 0) + 1;
    return acc;
  }, {});
  const duplicatePersonalRooms = Object.entries(personalRoomCounts).filter(([, count]) => count > 1).map(([roomId]) => roomId);
  const orphanPersonalContexts = personalWechat.groupContexts.filter((context) => context.customerId && !customerIds.has(context.customerId));
  const personalActiveRoomCounts = personalWechat.sendJobs
    .filter((job) => ACTIVE_PERSONAL_WECHAT_JOB_STATUSES.has(job.status))
    .reduce((acc, job) => {
      acc[job.roomId] = (acc[job.roomId] || 0) + 1;
      return acc;
    }, {});
  const duplicatePersonalActiveRooms = Object.entries(personalActiveRoomCounts).filter(([, count]) => count > 1).map(([roomId]) => roomId);
  const personalJobsMissingRoom = personalWechat.sendJobs.filter((job) => job.roomId && !personalWechat.groupContexts.some((context) => context.roomId === job.roomId));
  let modelReport = null;
  let modelConfigError = "";
  try {
    modelReport = buildModelConfigReport(state);
  } catch (error) {
    modelConfigError = error.message;
  }
  let wecomReport = null;
  let wecomConfigError = "";
  try {
    wecomReport = buildWecomConfigReport(state);
  } catch (error) {
    wecomConfigError = error.message;
  }
  let personalWechatReport = null;
  let personalWechatError = "";
  try {
    personalWechatReport = buildPersonalWechatReport(state);
  } catch (error) {
    personalWechatError = error.message;
  }
  const agentRunsMissingExecution = state.agentRuns.filter((run) => !run.execution || !run.execution.engine || run.execution.externalSideEffects !== false);

  const checks = [
    check("客户档案存在", state.customers.length > 0, `当前客户数 ${state.customers.length}`),
    check("客户ID唯一", duplicateCustomers.length === 0, duplicateCustomers.length ? `重复客户 ${duplicateCustomers.join("、")}` : "未发现重复客户ID"),
    check("客户阶段有效", invalidStages.length === 0, invalidStages.length ? `异常阶段客户 ${invalidStages.map((customer) => customer.id).join("、")}` : "客户均处于标准生命周期"),
    check("客户意向分有效", invalidScores.length === 0, invalidScores.length ? `异常意向分客户 ${invalidScores.map((customer) => customer.id).join("、")}` : "意向分均在0-100"),
    check("当前客户指针有效", !staleSelected, staleSelected ? `无效客户ID ${state.selectedCustomerId}` : state.selectedCustomerId || "未选择客户"),
    check("任务ID唯一", duplicateTasks.length === 0, duplicateTasks.length ? `重复任务 ${duplicateTasks.join("、")}` : "未发现重复任务ID"),
    check("任务引用客户有效", orphanTasks.length === 0, orphanTasks.length ? `孤儿任务 ${orphanTasks.map((task) => task.id).join("、")}` : `任务数 ${state.tasks.length}`),
    check("任务状态有效", invalidTaskStatuses.length === 0, invalidTaskStatuses.length ? `异常任务状态 ${invalidTaskStatuses.map((task) => task.id).join("、")}` : "任务状态均有效"),
    check("任务优先级有效", invalidTaskPriorities.length === 0, invalidTaskPriorities.length ? `异常任务优先级 ${invalidTaskPriorities.map((task) => task.id).join("、")}` : "任务优先级均有效"),
    check("任务负责人角色有效", invalidTaskOwners.length === 0, invalidTaskOwners.length ? `异常负责人角色 ${invalidTaskOwners.map((task) => task.id).join("、")}` : "任务角色均有效"),
    check("任务SLA时间有效", invalidTaskTiming.length === 0, invalidTaskTiming.length ? `异常SLA任务 ${invalidTaskTiming.map((task) => task.id).join("、")}` : "任务均有创建和截止时间"),
    check("事件引用客户有效", orphanEvents.length === 0, orphanEvents.length ? `孤儿事件 ${orphanEvents.map((event) => event.id).join("、")}` : `事件数 ${state.events.length}`),
    check("事件内容可用", invalidEvents.length === 0, invalidEvents.length ? `异常事件 ${invalidEvents.map((event) => event.id || "missing").join("、")}` : "事件均有渠道、类型和正文"),
    check("会话引用客户有效", orphanConversations.length === 0, orphanConversations.length ? `孤儿会话 ${orphanConversations.map((conversation) => conversation.id).join("、")}` : `会话数 ${conversations.length}`),
    check("会话消息可用", invalidConversationMessages.length === 0, invalidConversationMessages.length ? `异常消息 ${invalidConversationMessages.join("、")}` : `消息数 ${conversations.reduce((sum, conversation) => sum + (conversation.messages || []).length, 0)}`),
    check("触达草稿可用", orphanDrafts.length === 0 && invalidDrafts.length === 0, orphanDrafts.length ? `孤儿草稿 ${orphanDrafts.map((draft) => draft.id).join("、")}` : invalidDrafts.length ? `异常草稿 ${invalidDrafts.map((draft) => draft.id || "missing").join("、")}` : `草稿数 ${outboundDrafts.length}`),
    check("闭环计划引用客户有效", orphanPlans.length === 0, orphanPlans.length ? `孤儿计划 ${orphanPlans.map((plan) => plan.customerId).join("、")}` : `闭环计划 ${(state.workflowPlans || []).length}`),
    check("报价数据可用", invalidQuotes.length === 0, invalidQuotes.length ? `异常报价 ${invalidQuotes.map((quote) => quote.id).join("、")}` : `报价数 ${state.quotes.length}`),
    check("报价无重复型号配置", duplicateQuotes.length === 0, duplicateQuotes.length ? duplicateQuotes.join("、") : "未发现重复报价"),
    check("模板配置可用", invalidTemplates.length === 0, invalidTemplates.length ? `异常模板 ${invalidTemplates.map((template) => template.id).join("、")}` : `模板数 ${state.templates.length}`),
    check("高风险模板默认转人工", highRiskAllowed.length === 0, highRiskAllowed.length ? `高风险仍允许：${highRiskAllowed.map((template) => template.name).join("、")}` : "高风险模板均未自动放行", "警告"),
    check("销售样本可用", invalidSalesSamples.length === 0, invalidSalesSamples.length ? `异常样本 ${invalidSalesSamples.map((sample) => sample.id).join("、")}` : `销售样本 ${(state.salesSamples || []).length}`),
    check("模型配置可用", !modelConfigError, modelConfigError || `LLM ${modelReport.global.provider}/${modelReport.global.model}，API URL ${modelReport.global.apiUrl}，${modelReport.summary.overridden}个Agent独立配置`),
    check("模型API Key已配置", Boolean(modelReport?.summary.globalApiKeyConfigured), modelReport?.summary.globalApiKeyConfigured ? "全局LLM API Key已配置" : "全局LLM API Key为空；配置后可用于连接测试和真实LLM增强", "警告"),
    check("语音模型配置可用", !modelConfigError, modelConfigError || `ASR ${modelReport.voice.asr.model || "未配置"}，TTS ${modelReport.voice.tts.model || "未配置"}`),
    check("企微连接配置可用", !wecomConfigError, wecomConfigError || (wecomReport.summary.archiveEnabled ? `会话存档入口${wecomReport.summary.archiveStatus}，游标${wecomReport.summary.archiveCursor || "未回写"}，群绑定${wecomReport.summary.boundGroups}个` : wecomReport.summary.aibotConfigured ? `智能机器人凭据已配置，桥接状态${wecomReport.summary.bridgeStatus}，群绑定${wecomReport.summary.boundGroups}个` : wecomReport.summary.enabled ? `已启用Webhook路由${wecomReport.summary.configuredRoutes}/${wecomReport.summary.totalRoutes}个，发送成功${wecomReport.summary.sent}次` : "企微连接器未启用；本地功能不受影响"), "警告"),
    check("企微群绑定有效", duplicateWecomChats.length === 0 && orphanWecomBindings.length === 0, duplicateWecomChats.length ? `重复chatid ${duplicateWecomChats.join("、")}` : orphanWecomBindings.length ? `绑定客户不存在 ${orphanWecomBindings.map((binding) => binding.chatId).join("、")}` : `群绑定 ${wecomBindings.groups.length} 个`),
    check("企微群待绑定可见", wecomBindings.groups.filter((binding) => binding.status !== "已绑定").length === 0, wecomBindings.groups.filter((binding) => binding.status !== "已绑定").length ? `待绑定群 ${wecomBindings.groups.filter((binding) => binding.status !== "已绑定").length} 个，需要在企微接入页绑定到客户档案` : "所有企微群均已绑定客户", "警告"),
    check("个人微信AccountAgent可用", !personalWechatError, personalWechatError || (personalWechatReport.summary.enabled ? `单账号 ${personalWechatReport.summary.accountName}，群上下文 ${personalWechatReport.summary.groups} 个，活跃发送任务 ${personalWechatReport.summary.activeJobs} 个` : "个人微信AccountAgent已停用；不影响企微存档回读"), "警告"),
    check("个人微信群上下文有效", duplicatePersonalRooms.length === 0 && orphanPersonalContexts.length === 0, duplicatePersonalRooms.length ? `重复roomId ${duplicatePersonalRooms.join("、")}` : orphanPersonalContexts.length ? `上下文客户不存在 ${orphanPersonalContexts.map((context) => context.roomId).join("、")}` : `上下文 ${personalWechat.groupContexts.length} 个`),
    check("个人微信发送队列串行", duplicatePersonalActiveRooms.length === 0 && personalJobsMissingRoom.length === 0, duplicatePersonalActiveRooms.length ? `同群存在多个活跃发送任务 ${duplicatePersonalActiveRooms.join("、")}` : personalJobsMissingRoom.length ? `发送任务缺少群上下文 ${personalJobsMissingRoom.map((job) => job.jobId).join("、")}` : `发送任务 ${personalWechat.sendJobs.length} 个，并发${personalWechat.account.concurrency}，分钟上限${personalWechat.account.maxSendsPerMinute}`),
    check("Agent执行边界可追踪", agentRunsMissingExecution.length === 0, agentRunsMissingExecution.length ? `缺少执行边界的运行记录 ${agentRunsMissingExecution.map((run) => run.agent || "unknown").join("、")}` : `运行记录 ${state.agentRuns.length} 条均标明本地执行/外部副作用`),
    check("审计日志存在", (state.auditLog || []).length > 0, `审计数 ${(state.auditLog || []).length}`)
  ];

  const failed = checks.filter((item) => item.status === "失败");
  const warnings = checks.filter((item) => item.status === "警告");
  return {
    ok: failed.length === 0,
    generatedAt: new Date().toISOString(),
    summary: {
      customers: state.customers.length,
      tasks: state.tasks.length,
      events: state.events.length,
      conversations: conversations.length,
      outboundDrafts: outboundDrafts.length,
      quotes: state.quotes.length,
      templates: state.templates.length,
      salesSamples: (state.salesSamples || []).length,
      wecomLogs: (state.wecomLogs || []).length,
      wecomGroups: wecomBindings.groups.length,
      personalWechatGroups: personalWechat.groupContexts.length,
      personalWechatJobs: personalWechat.sendJobs.length,
      modelOverrides: modelReport?.summary.overridden || 0,
      agentRuns: state.agentRuns.length,
      workflowPlans: (state.workflowPlans || []).length,
      failed: failed.length,
      warnings: warnings.length
    },
    checks
  };
}

export function buildCapabilityAudit(inputState) {
  const state = hydrateTaskTimings(cloneState(inputState));
  const hasCustomers = state.customers.length > 0;
  const hasTasks = state.tasks.length > 0;
  const hasQuotes = state.quotes.length > 0;
  const hasPlans = (state.workflowPlans || []).length > 0;
  const taskSlaReport = buildTaskSlaReport(state);
  const conversations = Array.isArray(state.conversations) ? state.conversations : [];
  const outboundDrafts = Array.isArray(state.outboundDrafts) ? state.outboundDrafts : [];
  const modelReport = buildModelConfigReport(state);
  const wecomReport = buildWecomConfigReport(state);
  const personalWechatReport = buildPersonalWechatReport(state);
  const wecomReady = wecomReport.summary.enabled && wecomReport.summary.configuredRoutes > 0 && wecomReport.summary.enabledRoutes > 0;
  const wecomAibotReady = wecomReport.summary.aibotEnabled && wecomReport.summary.aibotConfigured;
  const wecomArchiveReady = wecomReport.summary.archiveEnabled;
  const personalWechatReady = personalWechatReport.summary.enabled && personalWechatReport.summary.autoReply;
  const vipConversationMessages = conversations
    .filter((conversation) => conversation.channel === "VIP模拟群")
    .reduce((sum, conversation) => sum + (conversation.messages || []).length, 0);
  const salesSamples = state.salesSamples || [];
  const highQualitySalesSamples = salesSamples.filter((sample) => sample.outcome === "成交" && Number(sample.qualityScore) >= 80);
  const items = [
    {
      area: "客户档案",
      capability: "基于客户交易体量、频次、关注型号建立CustomerProfile",
      status: hasCustomers ? "本地可用" : "不可用",
      evidence: hasCustomers ? `已有${state.customers.length}个本地客户档案，增删改查会真实写入本地状态` : "缺少客户数据",
      gap: "真实交易系统导入、客户去重、企业主数据同步未接入"
    },
    {
      area: "电销筛选",
      capability: "本地意向评分、分层和转交任务生成",
      status: "本地可用",
      evidence: "外呼筛选Agent按客户交易数据打分，会真实更新客户阶段、标签、事件和任务",
      gap: "真实语音外呼、ASR、短信发送、企微活码未接入；当前只生成待执行任务"
    },
    {
      area: "电销培育",
      capability: "本地消息识别、关注型号沉淀和销售升级",
      status: "本地可用",
      evidence: "电销培育Agent能处理本地入站消息，识别报价/会员/售后意图并生成销售任务",
      gap: "批量触达计划、发送频控、真实企微回复会话历史未接入"
    },
    {
      area: "模型连接配置",
      capability: "配置LLM API、API Key、模型名、语音识别和语音合成模型",
      status: "配置可用",
      evidence: `LLM ${modelReport.global.provider}/${modelReport.global.model}，Agent独立配置${modelReport.summary.overridden}个，语音模型已配置${modelReport.summary.voiceModelsConfigured}项`,
      gap: "LLM已支持连接测试和按需增强；ASR/TTS仍只保存连接参数，尚未接入语音执行器"
    },
    {
      area: "销售承接",
      capability: "辅助销售承接客户、生成销售话术和交接包",
      status: "本地可用",
      evidence: "销售承接Agent可真实生成任务、推荐卡种、异议处理、报价建议和handoffPackage",
      gap: "真实LLM可按需增强话术，但销售知识库、成交概率模型和人工审批流未接入"
    },
    {
      area: "销售技巧学习",
      capability: "人工销售样本库驱动话术引用",
      status: salesSamples.length ? "本地可用" : "待建设",
      evidence: salesSamples.length
        ? `已有${salesSamples.length}条销售样本，其中${highQualitySalesSamples.length}条高分成交样本会被销售Agent真实引用`
        : "缺少可引用的销售样本",
      gap: "真实会话自动导入、自动质检评分、A/B策略回流和模型训练未接入"
    },
    {
      area: "VIP群分流",
      capability: "读取本地群消息、识别@对象和处理角色",
      status: "本地可用",
      evidence: vipConversationMessages
        ? `VIP群分流Agent可读取本地会话窗口，当前VIP群消息${vipConversationMessages}条，并能判断@错人、重复问题和未结任务`
        : "VIP群分流Agent可识别售后/投诉/报价/客服并判断@错人",
      gap: "真实企微群历史、文件、图片、撤回、引用回复和长周期多轮追问未接入"
    },
    {
      area: "报价订阅",
      capability: "结构化报价查询、个性化推荐、关注型号回流",
      status: hasQuotes ? "本地可用" : "不可用",
      evidence: hasQuotes ? `已有${state.quotes.length}条结构化报价，订阅会真实回写客户关注型号和事件` : "缺少报价数据",
      gap: "报价图片解析、报价单版本管理、真实访问行为统计未完成"
    },
    {
      area: "任务中心",
      capability: "销售线索、VIP问题、售后分流统一进入任务队列",
      status: hasTasks ? "本地可用" : "待激活",
      evidence: hasTasks
        ? `当前${state.tasks.length}个任务，超时${taskSlaReport.summary.overdue}个，临期${taskSlaReport.summary.dueSoon}个，已升级${taskSlaReport.summary.escalated}个`
        : "暂无任务",
      gap: "真实人员排班、提醒推送和任务关闭质检未接入"
    },
    {
      area: "触达草稿队列",
      capability: "生成、确认、复制和关闭待触达文案",
      status: outboundDrafts.length ? "本地可用" : "可运行",
      evidence: outboundDrafts.length
        ? `当前${outboundDrafts.length}条本地草稿，待确认${outboundDrafts.filter((draft) => draft.status === "待确认").length}条，企微已发送${outboundDrafts.filter((draft) => draft.status === "企微已发送").length}条`
        : "运行Agent或手工新增后可生成本地触达草稿",
      gap: "企微测试群机器人已可接入；短信、外呼、企微私聊和CRM动作仍需后续适配"
    },
    {
      area: "全链路编排",
      capability: "为所有客户生成下一步动作、负责人、触达渠道和成功指标",
      status: hasPlans ? "本地可用" : "可运行",
      evidence: hasPlans ? `已生成${state.workflowPlans.length}个闭环计划，任务中心会同步产生承接任务` : "点击闭环编排后可生成计划",
      gap: "真实企微/外呼/短信执行器未接入，计划只会生成本地任务"
    },
    {
      area: "大模型执行器",
      capability: "按模型配置调用真实LLM生成回复或策略",
      status: modelReport.summary.globalApiKeyConfigured ? "可运行" : "待配置",
      evidence: modelReport.summary.globalApiKeyConfigured
        ? "已支持OpenAI兼容chat/completions连接测试，Agent可勾选真实LLM增强并生成本地增强草稿"
        : "已支持OpenAI兼容chat/completions调用路径，但全局API Key尚未配置",
      gap: "仍需内容安全策略、成本统计、调用日志、知识库版本控制和更细的权限审批"
    },
    {
      area: "企微连接器",
      capability: "会话内容存档主读取、智能机器人辅助读取、测试群Webhook发送和群绑定",
      status: wecomArchiveReady ? "存档入口可用" : wecomAibotReady ? "长连接待运行" : wecomReady ? "Webhook可用" : "待配置",
      evidence: wecomArchiveReady
        ? `会话存档入口${wecomReport.summary.archiveStatus}，游标${wecomReport.summary.archiveCursor || "未回写"}；群绑定${wecomReport.summary.boundGroups}个，待绑定${wecomReport.summary.pendingGroups}个`
        : wecomAibotReady
          ? `智能机器人凭据已配置，桥接状态${wecomReport.summary.bridgeStatus}；群绑定${wecomReport.summary.boundGroups}个，待绑定${wecomReport.summary.pendingGroups}个`
          : wecomReady
            ? `已启用${wecomReport.summary.enabledRoutes}个企微发送路由，成功发送${wecomReport.summary.sent}次，失败${wecomReport.summary.failed}次`
            : "可在企微接入页配置会话存档入口、智能机器人Bot ID/Secret或测试群机器人Webhook",
      gap: "真实存档拉取、解密SDK、客户同意校验、权限审批、消息幂等和失败重试仍需补齐"
    },
    {
      area: "个人微信AccountAgent",
      capability: "单个人微信号加入外部群后，由一个AccountAgent维护多群上下文、风控决策和SendScheduler受控发送",
      status: personalWechatReady ? "Mock可运行" : personalWechatReport.summary.enabled ? "待接Gateway" : "已停用",
      evidence: `账号 ${personalWechatReport.summary.accountName}，群上下文${personalWechatReport.summary.groups}个，队列待发${personalWechatReport.summary.queuedJobs}条，已发送待确认${personalWechatReport.summary.sentJobs}条，人工确认${personalWechatReport.summary.manualJobs}条，并发${personalWechatReport.summary.concurrency}`,
      gap: "真实个人微信登录、收发Gateway、自回显监听、掉线重连、人工审批台和合规策略仍待接入"
    },
    {
      area: "外部触达执行器",
      capability: "真实外呼、短信、企微私聊、企微群消息发送",
      status: wecomArchiveReady || wecomAibotReady || wecomReady ? "半闭环" : "未接入",
      evidence: wecomArchiveReady
        ? "企微会话存档可作为主读取入口；个人微信SendScheduler当前以Mock发送和回读确认验证受控出站"
        : wecomAibotReady
          ? "企微智能机器人长连接可作为辅助消息入口；自动回复默认关闭，出站仍以人工确认和后续执行器为准"
        : wecomReady
          ? "企微测试群机器人可执行人工确认后的群消息发送；其他外部触达仍保持本地任务/草稿"
          : personalWechatReady
            ? "个人微信AccountAgent当前为Mock队列，可演示决策和回显，但尚未接真实发送网关"
            : "当前所有Agent只写本地事件、任务、报价订阅和客户档案",
      gap: "还需要外呼平台、短信服务、企微私聊/群回调、幂等消息、失败重试和人工审批"
    },
    {
      area: "系统集成",
      capability: "企微群、CRM、交易系统、短信、外呼平台接入",
      status: "未接入",
      evidence: "当前明确为本地可运行版，外部系统均未写入",
      gap: "需要真实适配层、权限、回调、消息幂等、审计和数据安全"
    }
  ];
  const summary = items.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    },
    {}
  );
  return {
    generatedAt: new Date().toISOString(),
    summary,
    items
  };
}
