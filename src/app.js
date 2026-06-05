import { STAGES } from "./data.js";
import { api } from "./api.js";
import {
  currency,
  getCustomer
} from "./agentEngine.js";

const viewTitles = {
  overview: "总览",
  journey: "客户旅程",
  customers: "客户管理",
  chat: "会话工作台",
  agents: "Agent控制台",
  modelConfig: "模型配置",
  wecom: "企微接入",
  learning: "销售学习",
  channels: "本地消息",
  drafts: "触达草稿",
  tasks: "任务中心",
  quotes: "报价订阅",
  workflow: "闭环编排",
  templates: "模板与风控",
  system: "系统自检"
};

const scenarios = {
  nurture: "最近 iPhone 13 还有稳定报价吗？会员卡如果有优惠我想了解。",
  sales: "如果黑金卡能保证优先报价和稳定货源，我这周可以定。",
  vip: "@销售 上周那批 Mate60 有两台售后维修怎么处理？顺便今天报价发一下。",
  risk: "这次售后太慢了，我要投诉并要求赔偿。"
};

const modelAgentDefinitions = [
  { key: "dialer", agentName: "外呼筛选Agent", scene: "电销外呼筛选" },
  { key: "nurture", agentName: "电销培育Agent", scene: "电销企微培育" },
  { key: "sales", agentName: "销售承接Agent", scene: "会员卡销售承接" },
  { key: "vip", agentName: "VIP群分流Agent", scene: "VIP小群分流" },
  { key: "quote", agentName: "报价推荐Agent", scene: "报价推荐" },
  { key: "orchestrator", agentName: "闭环编排Agent", scene: "全链路编排" }
];

const defaultModelConfig = {
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
      provider: "语音识别服务",
      apiUrl: "",
      apiKey: "",
      model: "",
      language: "zh-CN"
    },
    tts: {
      provider: "语音合成服务",
      apiUrl: "",
      apiKey: "",
      model: "",
      voice: "默认",
      speed: 1
    }
  },
  agents: Object.fromEntries(modelAgentDefinitions.map((item) => [
    item.key,
    { provider: "", apiUrl: "", apiKey: "", model: "", temperature: "", maxTokens: "" }
  ]))
};

const defaultWecomConfig = {
  enabled: false,
  sendMode: "manualApproval",
  defaultRouteId: "wecom_route_default",
  routes: [
    {
      id: "wecom_route_default",
      name: "企微测试群机器人",
      channel: "VIP群",
      webhookUrl: "",
      webhookConfigured: false,
      webhookMasked: "",
      msgtype: "markdown",
      enabled: false
    }
  ],
  inbound: {
    enabled: true,
    defaultChannel: "VIP群",
    secret: "",
    secretConfigured: false,
    secretMasked: ""
  },
  aibot: {
    enabled: false,
    botId: "",
    secret: "",
    botIdConfigured: false,
    botIdMasked: "",
    secretConfigured: false,
    secretMasked: "",
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
    corpId: "",
    archiveSecret: "",
    archiveSecretConfigured: false,
    archiveSecretMasked: "",
    privateKey: "",
    privateKeyConfigured: false,
    privateKeyMasked: "",
    privateKeyVersion: "",
    cursor: "",
    seq: 0,
    pollIntervalSeconds: 10,
    limit: 100,
    gatewayMode: "sidecar",
    sidecarUrl: "",
    trustedStatus: "未验证",
    lastPulledAt: "",
    lastMessageAt: "",
    status: "未配置",
    lastError: "",
    defaultCustomerId: "c003",
    defaultChannel: "VIP群"
  }
};

const defaultPersonalWechatState = {
  enabled: true,
  gateway: {
    mode: "mock",
    sidecarUrl: "",
    sendEndpoint: "/send",
    receiveEndpoint: "/messages",
    ackEndpoint: "/ack",
    canSend: false,
    canReceive: false,
    sendMode: "proactive",
    supportsConfirm: false,
    supportsRecall: false,
    supportsAck: false,
    loginStatus: "未连接",
    loginQrCodeUrl: "",
    loginQrCodeText: "",
    cursor: "",
    status: "Mock待接",
    lastConnectedAt: "",
    lastEventAt: "",
    lastPulledAt: "",
    lastAckAt: "",
    lastError: ""
  },
  account: {
    id: "personal_wx_default",
    name: "个人微信托管号",
    displayName: "VIP群AccountAgent",
    defaultCustomerId: "c003",
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

let state = await loadState();
let activeView = "overview";
let activeNavGroup = "overview";
let selectedScenario = scenarios.nurture;
let lastDiagnostics = null;
let lastCapabilities = null;
let lastModelTest = null;
let quoteBrandFilter = "全部";
let quoteSearchQuery = "";
let quoteConfigFilter = "全部";
let quoteStockFilter = "全部";
let quoteMinPrice = "";
let quoteMaxPrice = "";
let customerSearchQuery = "";
let customerStageFilter = "全部";
let customerStageSetFilter = [];
let customerBusinessScope = "all";
let customerPanelMode = "list";
let customerMemberFilter = "全部";
let customerOwnerFilter = "全部";
let taskSearchQuery = "";
let taskRoleFilter = "全部";
let taskOwnerFilter = "全部";
let taskStatusFilter = "全部";
let taskPriorityFilter = "全部";
let taskSlaFilter = "全部";
let draftSearchQuery = "";
let draftStatusFilter = "全部";
let draftChannelFilter = "全部";
let draftPriorityFilter = "全部";
let draftRiskFilter = "全部";
let chatSearchQuery = "";
let chatSourceFilter = "全部真实";
let chatStatusFilter = "全部";
let chatBusinessScope = "vip";
let activeChatSessionId = "";
let wecomBindingSearchQuery = "";
let wecomLogTypeFilter = "全部";
let selectedTaskIds = new Set();
let selectedDraftIds = new Set();
let busyAction = null;
let customerFilterTimer = null;

const viewRoot = document.querySelector("#viewRoot");
const viewTitle = document.querySelector("#viewTitle");
const toast = document.querySelector("#toast");

const defaultNavGroupByView = {
  overview: "overview",
  workflow: "overview",
  journey: "customer",
  customers: "customer",
  quotes: "groupchat",
  chat: "groupchat",
  channels: "settings",
  wecom: "settings",
  drafts: "groupchat",
  tasks: "sales",
  agents: "sales",
  learning: "sales",
  modelConfig: "settings",
  templates: "settings",
  system: "settings"
};

const customerScopeDefinitions = {
  all: {
    key: "all",
    navTitle: "客户管理",
    title: "客户档案",
    subtitle: "查看和维护全量客户基础信息、交易数据、标签、关注型号和事件流。",
    stages: []
  },
  telemarketing: {
    key: "telemarketing",
    navTitle: "电销客户池",
    title: "电销客户池",
    subtitle: "只看待筛选、待外呼和电销企微培育阶段客户，用于外呼筛选和企微培育。",
    stages: ["待筛选", "待外呼", "电销企微培育"]
  },
  sales: {
    key: "sales",
    navTitle: "销售客户",
    title: "销售客户档案",
    subtitle: "只看销售企微承接和销售跟进阶段客户，用于会员卡承接、异议处理和成交推进。",
    stages: ["销售企微承接", "销售跟进"]
  },
  vip: {
    key: "vip",
    navTitle: "VIP客户",
    title: "VIP客户档案",
    subtitle: "只看已购会员、VIP维护和续费复购阶段客户，用于群维护、报价订阅和复购运营。",
    stages: ["已购会员", "VIP维护", "续费/复购"]
  }
};

const chatScopeDefinitions = {
  telemarketing: {
    key: "telemarketing",
    navTitle: "电销会话",
    title: "电销会话工作台",
    label: "电销培育",
    subtitle: "只展示电销沉淀企微和托管号真实会话，用于继续筛选意向并转交销售。",
    emptyTitle: "暂无电销会话",
    emptyDetail: "电销企微、企微机器人或托管号消息入站后，会在这里形成独立聊天窗口。",
    channels: ["电销企微", "电销企微培育", "电销模拟私聊"],
    stages: ["待筛选", "待外呼", "电销企微培育"],
    keywords: ["电销", "外呼", "培育", "待筛选", "待外呼"]
  },
  sales: {
    key: "sales",
    navTitle: "销售会话",
    title: "销售会话工作台",
    label: "销售承接",
    subtitle: "只展示销售企微和托管号真实会话，用于判断意图、沉淀话术并推进成交。",
    emptyTitle: "暂无销售会话",
    emptyDetail: "销售企微或托管号消息入站后，会在这里形成独立聊天窗口。",
    channels: ["销售企微", "销售企微承接", "销售模拟私聊", "企微私聊"],
    stages: ["销售企微承接", "销售跟进"],
    keywords: ["销售", "会员卡", "承接"]
  },
  vip: {
    key: "vip",
    navTitle: "VIP会话",
    title: "VIP会话工作台",
    label: "VIP群维护",
    subtitle: "只展示已购会员和VIP小群相关会话，用于售前、售后、报价、投诉和群内问题分流。",
    emptyTitle: "暂无VIP会话",
    emptyDetail: "VIP群、会话存档或个人微信托管号入站后，会在这里形成独立聊天窗口。",
    channels: ["VIP群", "VIP模拟群"],
    stages: ["VIP维护"],
    memberStatuses: ["金卡", "黑金卡", "已购卡"],
    keywords: ["VIP", "会员", "群", "售后", "报价", "投诉"]
  },
  all: {
    key: "all",
    navTitle: "会话工作台",
    title: "全量会话工作台",
    label: "全部业务",
    subtitle: "展示全部企微会话存档、智能机器人和个人微信/Sidecar会话；本地模拟只在调试来源中查看。",
    emptyTitle: "暂无会话",
    emptyDetail: "会话存档、个人微信或本地消息入站后，会在这里形成独立聊天窗口。",
    channels: [],
    stages: [],
    keywords: []
  }
};

async function loadState() {
  try {
    return normalizeState(await api.getState());
  } catch (error) {
    return normalizeState({
      selectedCustomerId: "c001",
      customers: [],
      events: [],
      tasks: [],
      templates: [],
      quotes: [],
      agentRuns: [],
      outboundDrafts: [],
      workflowPlans: [],
      salesSamples: [],
      conversations: [],
      modelConfig: defaultModelConfig,
      wecomConfig: defaultWecomConfig,
      wecomBindings: { groups: [] },
      wecomLogs: [],
      personalWechat: defaultPersonalWechatState,
      auditLog: [],
      loadError: error.message
    });
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function normalizeState(nextState = {}) {
  const normalized = {
    selectedCustomerId: "",
    customers: [],
    events: [],
    tasks: [],
    templates: [],
    quotes: [],
    agentRuns: [],
    outboundDrafts: [],
    workflowPlans: [],
    salesSamples: [],
    conversations: [],
    modelConfig: defaultModelConfig,
    wecomConfig: defaultWecomConfig,
    wecomBindings: { groups: [] },
    wecomLogs: [],
    personalWechat: defaultPersonalWechatState,
    auditLog: [],
    ...nextState
  };
  for (const key of ["customers", "events", "tasks", "templates", "quotes", "outboundDrafts", "agentRuns", "auditLog", "workflowPlans", "salesSamples", "conversations", "wecomLogs"]) {
    if (!Array.isArray(normalized[key])) normalized[key] = [];
  }
  if (normalized.customers.length && !normalized.customers.some((customer) => customer.id === normalized.selectedCustomerId)) {
    normalized.selectedCustomerId = normalized.customers[0].id;
  }
  if (!normalized.customers.length) normalized.selectedCustomerId = "";
  normalized.modelConfig = normalizeModelConfigState(normalized.modelConfig);
  normalized.wecomConfig = normalizeWecomConfigState(normalized.wecomConfig);
  normalized.wecomBindings = {
    groups: Array.isArray(normalized.wecomBindings?.groups) ? normalized.wecomBindings.groups : []
  };
  normalized.personalWechat = normalizePersonalWechatState(normalized.personalWechat);
  return normalized;
}

function setBusy(action) {
  busyAction = action;
  document.body.classList.toggle("is-busy", Boolean(action));
  if (!action) {
    render();
    return;
  }
  document.querySelectorAll("[data-action-button]").forEach((button) => {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  });
}

async function withBusy(action, work) {
  if (busyAction) return;
  setBusy(action);
  try {
    await work();
  } finally {
    setBusy(null);
  }
}

function actionAttrs(action) {
  return `data-action-button data-action="${escapeHtml(action)}" ${busyAction ? "disabled aria-busy=\"true\"" : ""}`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDateTime(value, fallback = "未记录") {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(fallback || value || "未记录");
  return date.toLocaleString("zh-CN");
}

function normalizeModelConfigState(config = {}) {
  const global = {
    ...defaultModelConfig.global,
    ...(config.global || {})
  };
  const voice = {
    asr: {
      ...defaultModelConfig.voice.asr,
      ...(config.voice?.asr || {})
    },
    tts: {
      ...defaultModelConfig.voice.tts,
      ...(config.voice?.tts || {})
    }
  };
  const agents = {};
  for (const definition of modelAgentDefinitions) {
    agents[definition.key] = {
      ...defaultModelConfig.agents[definition.key],
      ...(config.agents?.[definition.key] || {})
    };
  }
  return { global, voice, agents };
}

function normalizeWecomConfigState(config = {}) {
  const routes = Array.isArray(config.routes) && config.routes.length
    ? config.routes
    : defaultWecomConfig.routes;
  const normalizedRoutes = routes.map((route, index) => ({
    ...defaultWecomConfig.routes[0],
    id: route.id || defaultWecomConfig.routes[index]?.id || `wecom_route_${index + 1}`,
    name: route.name || defaultWecomConfig.routes[index]?.name || `企微路由${index + 1}`,
    channel: route.channel || "VIP群",
    webhookUrl: "",
    webhookConfigured: Boolean(route.webhookConfigured),
    webhookMasked: route.webhookMasked || "",
    msgtype: route.msgtype === "text" ? "text" : "markdown",
    enabled: Boolean(route.enabled)
  }));
  return {
    ...defaultWecomConfig,
    ...config,
    routes: normalizedRoutes,
    defaultRouteId: config.defaultRouteId || normalizedRoutes[0]?.id || defaultWecomConfig.defaultRouteId,
    inbound: {
      ...defaultWecomConfig.inbound,
      ...(config.inbound || {}),
      secret: "",
      secretConfigured: Boolean(config.inbound?.secretConfigured),
      secretMasked: config.inbound?.secretMasked || ""
    },
    aibot: {
      ...defaultWecomConfig.aibot,
      ...(config.aibot || {}),
      botId: "",
      secret: "",
      botIdConfigured: Boolean(config.aibot?.botIdConfigured),
      botIdMasked: config.aibot?.botIdMasked || "",
      secretConfigured: Boolean(config.aibot?.secretConfigured),
      secretMasked: config.aibot?.secretMasked || ""
    },
    archive: {
      ...defaultWecomConfig.archive,
      ...(config.archive || {}),
      archiveSecret: "",
      privateKey: "",
      archiveSecretConfigured: Boolean(config.archive?.archiveSecretConfigured),
      archiveSecretMasked: config.archive?.archiveSecretMasked || "",
      privateKeyConfigured: Boolean(config.archive?.privateKeyConfigured),
      privateKeyMasked: config.archive?.privateKeyMasked || "",
      seq: Number(config.archive?.seq || 0),
      pollIntervalSeconds: Number(config.archive?.pollIntervalSeconds || defaultWecomConfig.archive.pollIntervalSeconds),
      limit: Number(config.archive?.limit || defaultWecomConfig.archive.limit)
    }
  };
}

function normalizePersonalWechatState(config = {}) {
  const account = {
    ...defaultPersonalWechatState.account,
    ...(config.account || {})
  };
  const gateway = {
    ...defaultPersonalWechatState.gateway,
    ...(config.gateway || {})
  };
  return {
    ...defaultPersonalWechatState,
    ...config,
    enabled: config.enabled === undefined ? defaultPersonalWechatState.enabled : Boolean(config.enabled),
    gateway: {
      ...gateway,
      canSend: Boolean(gateway.canSend),
      canReceive: Boolean(gateway.canReceive),
      sendMode: gateway.sendMode === "reply_window" ? "reply_window" : "proactive",
      supportsConfirm: Boolean(gateway.supportsConfirm),
      supportsRecall: Boolean(gateway.supportsRecall),
      supportsAck: Boolean(gateway.supportsAck)
    },
    account: {
      ...account,
      autoReply: Boolean(account.autoReply),
      requireApprovalForRisk: account.requireApprovalForRisk === undefined ? true : Boolean(account.requireApprovalForRisk),
      minSendIntervalSeconds: Number(account.minSendIntervalSeconds || defaultPersonalWechatState.account.minSendIntervalSeconds),
      concurrency: Number(account.concurrency || defaultPersonalWechatState.account.concurrency),
      maxSendsPerMinute: Number(account.maxSendsPerMinute || defaultPersonalWechatState.account.maxSendsPerMinute),
      maxQueueAgeSeconds: Number(account.maxQueueAgeSeconds || defaultPersonalWechatState.account.maxQueueAgeSeconds),
      failureBackoffSeconds: Number(account.failureBackoffSeconds || defaultPersonalWechatState.account.failureBackoffSeconds),
      mergeWindowSeconds: Number(account.mergeWindowSeconds || defaultPersonalWechatState.account.mergeWindowSeconds)
    },
    groupContexts: Array.isArray(config.groupContexts) ? config.groupContexts : [],
    sendJobs: Array.isArray(config.sendJobs) ? config.sendJobs : [],
    decisions: Array.isArray(config.decisions) ? config.decisions : [],
    logs: Array.isArray(config.logs) ? config.logs : [],
    schedulerResult: config.schedulerResult || null
  };
}

function wecomRoutes() {
  const config = normalizeWecomConfigState(state.wecomConfig);
  return config.routes.length ? config.routes : defaultWecomConfig.routes;
}

function wecomRouteOptions(selectedRouteId = "") {
  const routes = wecomRoutes();
  return routes.map((route) => `
    <option value="${escapeHtml(route.id)}" ${route.id === selectedRouteId ? "selected" : ""}>
      ${escapeHtml(route.name)} · ${escapeHtml(route.channel)}${route.webhookConfigured ? " · 已配置" : " · 未配置"}
    </option>
  `).join("");
}

function wecomPrimaryRoute() {
  const config = normalizeWecomConfigState(state.wecomConfig);
  return wecomRoutes().find((route) => route.id === config.defaultRouteId) || wecomRoutes()[0];
}

function wecomLatestLog() {
  return (state.wecomLogs || [])[0] || null;
}

function effectiveModelFor(agentKey) {
  const config = normalizeModelConfigState(state.modelConfig);
  const definition = modelAgentDefinitions.find((item) => item.key === agentKey) || modelAgentDefinitions[0];
  const override = config.agents[definition.key] || {};
  const inherited = !(
    override.provider ||
    override.apiUrl ||
    override.apiKey ||
    override.model ||
    override.temperature !== "" ||
    override.maxTokens !== ""
  );
  const globalKeyConfigured = Boolean(config.global.apiKey || config.global.apiKeyConfigured);
  const overrideKeyConfigured = Boolean(override.apiKey || override.apiKeyConfigured);
  return {
    ...definition,
    provider: inherited ? config.global.provider : override.provider || config.global.provider,
    apiUrl: inherited ? config.global.apiUrl : override.apiUrl || config.global.apiUrl,
    model: inherited ? config.global.model : override.model || config.global.model,
    temperature: inherited ? config.global.temperature : override.temperature === "" ? config.global.temperature : override.temperature,
    maxTokens: inherited ? config.global.maxTokens : override.maxTokens === "" ? config.global.maxTokens : override.maxTokens,
    apiKeyConfigured: inherited ? globalKeyConfigured : overrideKeyConfigured || globalKeyConfigured,
    source: inherited ? "全局默认" : "Agent独立配置",
    inheritedFromGlobal: inherited
  };
}

function modelConfigPayload(form) {
  const data = formData(form);
  const agents = {};
  const currentConfig = normalizeModelConfigState(state.modelConfig);
  for (const definition of modelAgentDefinitions) {
    const override = {
      provider: data[`agents.${definition.key}.provider`] || "",
      apiUrl: data[`agents.${definition.key}.apiUrl`] || "",
      model: data[`agents.${definition.key}.model`] || "",
      temperature: data[`agents.${definition.key}.temperature`] || "",
      maxTokens: data[`agents.${definition.key}.maxTokens`] || ""
    };
    const apiKey = data[`agents.${definition.key}.apiKey`] || "";
    if (apiKey) override.apiKey = apiKey;
    if (data[`agents.${definition.key}.clearApiKey`]) override.clearApiKey = true;
    const currentOverride = currentConfig.agents[definition.key] || {};
    const allVisibleFieldsEmpty =
      Object.values(override).every((value) => String(value || "").trim() === "") &&
      !apiKey &&
      !currentOverride.apiKeyConfigured;
    agents[definition.key] = allVisibleFieldsEmpty ? { clear: true } : override;
  }
  const global = {
    provider: data["global.provider"] || "",
    apiUrl: data["global.apiUrl"] || "",
    model: data["global.model"] || "",
    temperature: data["global.temperature"] || "",
    maxTokens: data["global.maxTokens"] || ""
  };
  if (data["global.apiKey"]) global.apiKey = data["global.apiKey"];
  if (data["global.clearApiKey"]) global.clearApiKey = true;
  const voice = {
    asr: {
      provider: data["voice.asr.provider"] || "",
      apiUrl: data["voice.asr.apiUrl"] || "",
      model: data["voice.asr.model"] || "",
      language: data["voice.asr.language"] || "zh-CN"
    },
    tts: {
      provider: data["voice.tts.provider"] || "",
      apiUrl: data["voice.tts.apiUrl"] || "",
      model: data["voice.tts.model"] || "",
      voice: data["voice.tts.voice"] || "默认",
      speed: data["voice.tts.speed"] || "1"
    }
  };
  if (data["voice.asr.apiKey"]) voice.asr.apiKey = data["voice.asr.apiKey"];
  if (data["voice.tts.apiKey"]) voice.tts.apiKey = data["voice.tts.apiKey"];
  if (data["voice.asr.clearApiKey"]) voice.asr.clearApiKey = true;
  if (data["voice.tts.clearApiKey"]) voice.tts.clearApiKey = true;
  return {
    global,
    voice,
    agents
  };
}

function apiKeyPlaceholder(configItem = {}, fallback = "sk-...") {
  if (configItem.apiKeyConfigured) return `已配置：${configItem.apiKeyMasked || "********"}，留空保持不变`;
  return fallback;
}

function apiKeyHelp(configItem = {}) {
  return configItem.apiKeyConfigured
    ? `<small class="field-help">已保存密钥；输入新 Key 会覆盖，留空保持当前 Key。</small>`
    : `<small class="field-help">未配置 Key；需要真实LLM连接测试或增强时填写。</small>`;
}

function clearApiKeyOption(name, configItem = {}) {
  if (!configItem.apiKeyConfigured) return "";
  return `
    <label class="inline-check compact-check">
      <input name="${escapeHtml(name)}" type="checkbox" value="true">
      <span>清空已保存Key</span>
    </label>
  `;
}

function agentApiKeyPlaceholder(override = {}, config = {}) {
  if (override.apiKeyConfigured) return `已配置：${override.apiKeyMasked || "********"}，留空保持不变`;
  if (config.global.apiKeyConfigured) return "留空使用全局Key";
  return "未配置Key";
}

function agentApiKeyHelp(override = {}, config = {}) {
  if (override.apiKeyConfigured) return `<small class="field-help">该Agent已有独立Key；留空保持不变，清空整张卡片可恢复全局默认。</small>`;
  if (config.global.apiKeyConfigured) return `<small class="field-help">未填写时使用全局Key。</small>`;
  return `<small class="field-help">全局Key未配置；如需该Agent真实调用，请填写Key。</small>`;
}

function selectedCustomer() {
  return getCustomer(state, state.selectedCustomerId) || state.customers[0] || null;
}

function eventsFor(customerId) {
  if (!customerId) return [];
  return state.events.filter((event) => event.customerId === customerId);
}

function tasksFor(customerId) {
  if (!customerId) return [];
  return state.tasks.filter((task) => task.customerId === customerId);
}

function conversationsFor(customerId) {
  if (!customerId) return [];
  return (state.conversations || []).filter((conversation) => conversation.customerId === customerId);
}

function priorityClass(priority) {
  if (priority === "高") return "high";
  if (priority === "中") return "mid";
  return "low";
}

function priorityClassFromLevel(level) {
  if (level === "high") return "high";
  if (level === "mid") return "mid";
  return "low";
}

function checkClass(status) {
  if (status === "失败") return "fail";
  if (status === "警告") return "warn";
  return "pass";
}

function statusClass(status) {
  if (status === "可用" || status === "本地可用" || status === "配置可用") return "ready";
  if (status === "可运行") return "simulated";
  if (status === "半闭环" || status === "待激活" || status === "待建设" || status === "待配置") return "partial";
  return "blocked";
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

function taskDueAt(task) {
  const createdCandidate = new Date(task.createdAt || Date.now());
  const created = Number.isNaN(createdCandidate.getTime()) ? new Date() : createdCandidate;
  const due = new Date(task.dueAt || created.getTime() + slaToMinutes(task.sla) * 60_000);
  return Number.isNaN(due.getTime()) ? new Date(created.getTime() + slaToMinutes(task.sla) * 60_000) : due;
}

function taskSlaMeta(task) {
  if (task.status === "已完成") return { label: "已完成", className: "done", detail: task.completedAt ? `完成于 ${formatDateTime(task.completedAt)}` : "已关闭" };
  const due = taskDueAt(task);
  const remaining = Math.ceil((due.getTime() - Date.now()) / 60_000);
  const threshold = Math.max(30, Math.round(slaToMinutes(task.sla) * 0.25));
  if (remaining < 0) return { label: "已超时", className: "overdue", detail: `超时 ${Math.abs(remaining)} 分钟` };
  if (remaining <= threshold) return { label: "临期", className: "soon", detail: `剩余 ${remaining} 分钟` };
  return { label: "正常", className: "normal", detail: `剩余 ${remaining} 分钟` };
}

function tagPill(value) {
  return `<span class="tag">${escapeHtml(value)}</span>`;
}

function setState(nextState, message) {
  state = normalizeState(nextState);
  pruneSelections();
  lastDiagnostics = null;
  lastCapabilities = null;
  render();
  if (message) showToast(message);
}

function pruneSelections() {
  const taskIds = new Set(state.tasks.map((task) => task.id));
  selectedTaskIds = new Set([...selectedTaskIds].filter((taskId) => taskIds.has(taskId)));
  const draftIds = new Set((state.outboundDrafts || []).map((draft) => draft.id));
  selectedDraftIds = new Set([...selectedDraftIds].filter((draftId) => draftIds.has(draftId)));
}

function navPanelContainsView(group, view) {
  return Boolean(document.querySelector(`.nav-subitems[data-nav-panel="${group}"] [data-view="${view}"]`));
}

function defaultNavGroupForView(view) {
  return defaultNavGroupByView[view] || "overview";
}

function resetCustomerFilters() {
  customerSearchQuery = "";
  customerStageFilter = "全部";
  customerStageSetFilter = [];
  customerMemberFilter = "全部";
  customerOwnerFilter = "全部";
}

function customerScopeDefinition(scope = customerBusinessScope) {
  return customerScopeDefinitions[scope] || customerScopeDefinitions.all;
}

function ensureSelectedCustomerInVisibleScope() {
  const visibleCustomers = filteredCustomers();
  if (visibleCustomers.length && !visibleCustomers.some((customer) => customer.id === state.selectedCustomerId)) {
    state.selectedCustomerId = visibleCustomers[0].id;
  }
}

function applyCustomerScope(scope = "all") {
  const definition = customerScopeDefinition(scope);
  customerBusinessScope = definition.key;
  customerPanelMode = "list";
  resetCustomerFilters();
  customerStageSetFilter = [...(definition.stages || [])];
  ensureSelectedCustomerInVisibleScope();
}

function customerScopeForStage(stage = "") {
  if (customerScopeDefinitions.telemarketing.stages.includes(stage)) return "telemarketing";
  if (customerScopeDefinitions.sales.stages.includes(stage)) return "sales";
  if (customerScopeDefinitions.vip.stages.includes(stage)) return "vip";
  return "all";
}

function resetTaskFilters() {
  taskSearchQuery = "";
  taskRoleFilter = "全部";
  taskOwnerFilter = "全部";
  taskStatusFilter = "全部";
  taskPriorityFilter = "全部";
  taskSlaFilter = "全部";
  selectedTaskIds.clear();
}

function resetDraftFilters() {
  draftSearchQuery = "";
  draftStatusFilter = "全部";
  draftChannelFilter = "全部";
  draftPriorityFilter = "全部";
  draftRiskFilter = "全部";
  selectedDraftIds.clear();
}

function chatScopeDefinition(scope = chatBusinessScope) {
  return chatScopeDefinitions[scope] || chatScopeDefinitions.vip;
}

function customerForChatSession(session) {
  if (!session?.customerId) return null;
  return state.customers.find((item) => item.id === session.customerId) || null;
}

function chatSessionTextBundle(session, customer) {
  return [
    session?.title,
    session?.channel,
    session?.sourceLabel,
    session?.customerName,
    session?.lastMessageText,
    customer?.stage,
    customer?.memberStatus,
    ...(customer?.tags || []),
    ...(customer?.watchedModels || [])
  ].filter(Boolean).join(" ");
}

function textContainsAny(text, keywords = []) {
  return keywords.some((keyword) => text.includes(keyword));
}

function sessionMatchesChatScope(session) {
  const scope = chatScopeDefinition();
  if (scope.key === "all") return true;
  const customer = customerForChatSession(session);
  const text = chatSessionTextBundle(session, customer);
  const channel = String(session?.channel || "");
  const stage = String(customer?.stage || "");
  const memberStatus = String(customer?.memberStatus || "");
  const channelMatch = (scope.channels || []).some((item) => channel === item || channel.includes(item));
  const stageMatch = (scope.stages || []).includes(stage);
  const isOtherBusinessChannel = (scope.key === "telemarketing" && (channel.includes("销售") || channel.includes("VIP")))
    || (scope.key === "sales" && (channel.includes("电销") || channel.includes("VIP")))
    || (scope.key === "vip" && (channel.includes("电销") || channel.includes("销售")));

  if (scope.key === "vip") {
    const memberMatch = (scope.memberStatuses || []).includes(memberStatus);
    return channelMatch || stageMatch || memberMatch || (!isOtherBusinessChannel && text.includes("VIP"));
  }

  if (isOtherBusinessChannel) return stageMatch;
  return channelMatch || stageMatch || textContainsAny(text, scope.keywords || []);
}

function resetChatFilters(scope = "vip") {
  chatBusinessScope = scope;
  chatSearchQuery = "";
  chatSourceFilter = "全部";
  chatStatusFilter = "全部";
  activeChatSessionId = "";
}

function applyNavPreset(preset) {
  if (!preset) return;
  if (preset === "allCustomers") {
    applyCustomerScope("all");
  }
  if (preset === "telemarketingCustomers") {
    applyCustomerScope("telemarketing");
  }
  if (preset === "telemarketingChat") {
    resetChatFilters("telemarketing");
  }
  if (preset === "telemarketingTasks") {
    resetTaskFilters();
    taskRoleFilter = "电销";
    taskStatusFilter = "全部";
  }
  if (preset === "salesChat") {
    resetChatFilters("sales");
  }
  if (preset === "salesCustomers") {
    applyCustomerScope("sales");
  }
  if (preset === "salesTasks") {
    resetTaskFilters();
    taskRoleFilter = "销售";
    taskStatusFilter = "全部";
  }
  if (preset === "vipCustomers") {
    applyCustomerScope("vip");
  }
  if (preset === "vipChat") {
    resetChatFilters("vip");
  }
  if (preset === "vipQuotes") {
    applyCustomerScope("vip");
  }
  if (preset === "vipTasks") {
    resetTaskFilters();
    taskRoleFilter = "售后";
    taskStatusFilter = "全部";
    taskSearchQuery = "VIP 售后 报价 群";
  }
  if (preset === "vipDrafts") {
    resetDraftFilters();
    draftChannelFilter = "VIP群";
  }
  if (preset === "vipChannels") {
    selectedScenario = scenarios.vip;
  }
  if (preset === "settingsChannels") {
    selectedScenario = scenarios.nurture;
  }
}

function viewTitleForCurrentContext() {
  if (activeView === "customers") return customerScopeDefinition().navTitle;
  if (activeView === "chat") return chatScopeDefinition().navTitle;
  if (activeView === "quotes") return "报价订阅";
  if (activeView === "channels") {
    if (activeNavGroup === "telemarketing") return "电销消息";
    return "消息入站";
  }
  return viewTitles[activeView];
}

function renderEmptyState(title, detail, action = "") {
  return `
    <div class="empty-state">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(detail)}</span>
      ${action ? `<span class="empty-action">${escapeHtml(action)}</span>` : ""}
    </div>
  `;
}

function renderTruthPanel() {
  const llmStatus = state.modelConfig?.global?.apiKeyConfigured
    ? "真实LLM已配置，可在模型配置页测试，也可在Agent控制台勾选增强后调用；调用结果只写本地增强草稿。"
    : "真实LLM调用路径已接好，但需要先在模型配置页保存API Key后才能测试或增强。";
  const wecomConfig = normalizeWecomConfigState(state.wecomConfig);
  const wecomReady = wecomConfig.enabled && wecomRoutes().some((route) => route.enabled && route.webhookConfigured);
  const archive = wecomConfig.archive || {};
  const archiveConfigured = archive.enabled && archive.gatewayMode === "sidecar" && archive.sidecarUrl && archive.corpId && archive.archiveSecretConfigured && archive.privateKeyConfigured;
  const personalGateway = normalizePersonalWechatState(state.personalWechat).gateway;
  const outboundReady = personalGateway.mode === "sidecar" && personalGateway.canSend === true;
  const wecomStatus = archiveConfigured
    ? "企微会话存档主读取链路已配置，可通过Sidecar拉取和ACK真实会话消息。"
    : "企微会话存档主读取链路已接好，需要补齐CorpID、Secret、RSA私钥和Sidecar后才能真实拉取。";
  const outboundStatus = outboundReady
    ? "个人微信连接器已声明canSend=true，低风险回复可进入真实出站调度，仍需回读确认。"
    : "个人微信连接器未声明canSend=true，回复只会入队、人工确认或保存草稿，不会伪装已发送。";
  const testSendStatus = wecomReady
    ? "测试群机器人可发送人工确认后的草稿。"
    : "测试群机器人需配置Webhook后才能发送测试消息。";
  return `
    <section class="truth-panel">
      <div>
        <strong>当前真实可用</strong>
        <span>客户档案、任务队列、报价维护、销售样本、本地消息、规则Agent、闭环编排、自检和审计都会真实写入本地状态。${llmStatus}${wecomStatus}${outboundStatus}${testSendStatus}</span>
      </div>
      <div>
        <strong>当前未接入</strong>
        <span>真实外呼、短信发送、企微私聊读取、CRM/交易系统同步尚未接入；会话存档SDK/协议拉取、解密、客户同意、个人微信登录态和主动发送由外部连接器生产化承接。</span>
      </div>
    </section>
  `;
}

function listText(values = [], fallback = "暂无") {
  const list = values.filter((item) => String(item || "").trim()).map((item) => String(item).trim());
  return list.length ? list.join("、") : fallback;
}

function summarizeAgentRun(run) {
  if (!run) return "暂无Agent运行记录。";
  if (run.summary) return run.summary;
  if (run.contextSummary) return run.contextSummary;
  if (run.pushCopy) return run.pushCopy;
  if (run.suggestedReply) return run.suggestedReply;
  if (run.playbook?.handoffSummary) return run.playbook.handoffSummary;
  if (Array.isArray(run.recommendations) && run.recommendations.length) {
    return `推荐 ${listText(run.recommendations.map((item) => `${item.model}${item.config ? ` ${item.config}` : ""}`))}`;
  }
  if (Array.isArray(run.quoteRecommendations) && run.quoteRecommendations.length) {
    return `可优先沟通 ${listText(run.quoteRecommendations.map((item) => `${item.model}${item.config ? ` ${item.config}` : ""}`))}`;
  }
  if (Array.isArray(run.plans)) return `已为 ${run.totalPlans || run.plans.length} 个客户生成下一步运营动作。`;
  return run.nextAction || `${run.agent || "Agent"}已完成本地分析。`;
}

function summarizeAuditDetail(detail) {
  const text = String(detail || "").trim();
  if (!text) return "";
  if (!text.startsWith("{") && !text.startsWith("[")) return text;
  try {
    return summarizeAgentRun(JSON.parse(text));
  } catch {
    return text;
  }
}

function renderSystemBlueprint() {
  const stages = [
    { title: "客户池/交易数据", detail: "交易额、关注型号、会员状态进入统一客户档案", tone: "data" },
    { title: "电销筛选", detail: "外呼评分，区分直转销售、企微培育和待回访", tone: "dialer" },
    { title: "培育沉淀", detail: "本地消息识别型号、意向和回复，沉淀标签", tone: "nurture" },
    { title: "销售承接", detail: "会员卡推荐、异议处理、销售任务和话术草稿", tone: "sales" },
    { title: "VIP维护", detail: "群问题分流、售后/客服/销售协作与报价推荐", tone: "vip" },
    { title: "数据回流优化", detail: "点击、订阅、成交、任务结果回写档案和策略", tone: "loop" }
  ];
  const layers = [
    ["统一客户档案", "阶段、标签、关注型号、交易额、会员状态"],
    ["任务中心", "销售线索、VIP分流、SLA、人工处理状态"],
    ["触达草稿", "所有外呼/企微/报价文案先本地待确认"],
    ["报价库", "结构化型号、配置、库存、有效期和订阅"],
    ["模型配置", "全局LLM、语音模型与Agent独立覆盖"]
  ];
  return `
    <div class="system-blueprint">
      <div class="blueprint-stage-row">
        ${stages.map((stage, index) => `
          <div class="blueprint-stage ${stage.tone}">
            <span class="blueprint-index">${index + 1}</span>
            <strong>${escapeHtml(stage.title)}</strong>
            <span>${escapeHtml(stage.detail)}</span>
          </div>
          ${index < stages.length - 1 ? `<div class="blueprint-arrow" aria-hidden="true">&rarr;</div>` : ""}
        `).join("")}
      </div>
      <div class="blueprint-feedback">
        <span>客户回复、报价订阅、任务完成、成交/售后结果会持续回流到客户档案，下一轮Agent再基于新档案判断。</span>
      </div>
      <div class="blueprint-layer-row">
        ${layers.map(([title, detail]) => `
          <div class="blueprint-layer">
            <strong>${escapeHtml(title)}</strong>
            <span>${escapeHtml(detail)}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderMiniMetric(label, value, detail = "") {
  return `
    <div class="mini-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
    </div>
  `;
}

function customerAgentSummary(customer) {
  return `
    <div class="agent-customer-summary">
      <div class="agent-customer-head">
        <div>
          <strong>${escapeHtml(customer.name)}</strong>
          <span>${escapeHtml(customer.contact)} ${escapeHtml(customer.phone || "")}</span>
        </div>
        <span class="status-pill">${escapeHtml(customer.stage)}</span>
      </div>
      <div class="profile-grid">
        ${renderMiniMetric("意向分", customer.intentScore || 0, "越高越适合销售承接")}
        ${renderMiniMetric("会员状态", customer.memberStatus || "未记录")}
        ${renderMiniMetric("交易额", currency(customer.tradeAmount || customer.tradeVolume || 0))}
        ${renderMiniMetric("负责人", customer.owner || "待分配")}
      </div>
      <div class="tag-list">
        ${(customer.tags || []).slice(0, 6).map(tagPill).join("") || tagPill("暂无标签")}
        ${(customer.watchedModels || []).slice(0, 4).map((model) => tagPill(model)).join("")}
      </div>
    </div>
  `;
}

function renderAgentActionGroup(title, detail, buttons) {
  return `
    <div class="agent-tool-group">
      <div>
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(detail)}</span>
      </div>
      <div class="split-actions">
        ${buttons}
      </div>
    </div>
  `;
}

function renderExecutionNotice(run) {
  const execution = run?.execution;
  const model = run?.modelConfig;
  if (execution) {
    return `
      <div class="execution-inline">
        <span class="status-pill">${escapeHtml(execution.engine)}</span>
        <strong>模型调用：${escapeHtml(execution.modelInvocation)}</strong>
        <span class="muted">${escapeHtml(execution.boundary)}</span>
        <span class="muted">外部动作：${execution.externalSideEffects ? "已触发" : "未触发"}</span>
      </div>
    `;
  }
  if (!model) return "";
  return `
    <div class="model-inline">
      <span class="status-pill">LLM连接配置</span>
      <strong>${escapeHtml(model.provider)} / ${escapeHtml(model.model)}</strong>
      <span class="muted">Key${model.apiKeyConfigured ? "已配置" : "未配置"} · 温度 ${escapeHtml(model.temperature)} · 最大输出 ${escapeHtml(model.maxTokens)}</span>
    </div>
  `;
}

function renderModelTestResult() {
  if (!lastModelTest) {
    return renderEmptyState("尚未测试模型连接", "保存API URL、API Key和模型名后，可点击测试按钮真实调用一次模型。");
  }
  return `
    <div class="business-card ${lastModelTest.ok ? "success-card" : "warning-card"}">
      <div class="agent-customer-head">
        <div>
          <strong>${escapeHtml(lastModelTest.status || (lastModelTest.ok ? "连接成功" : "连接失败"))}</strong>
          <span>${escapeHtml(lastModelTest.modelConfig?.provider || "")} / ${escapeHtml(lastModelTest.modelConfig?.model || "")}</span>
        </div>
        <span class="status-pill">${lastModelTest.ok ? "可调用" : "需处理"}</span>
      </div>
      <p class="event-text">${escapeHtml(lastModelTest.content || lastModelTest.error || "暂无返回内容")}</p>
      <div class="tag-list">
        <span class="tag">${escapeHtml(lastModelTest.modelConfig?.source || "模型配置")}</span>
        <span class="tag">Key${lastModelTest.modelConfig?.apiKeyConfigured ? "已配置" : "未配置"}</span>
        ${lastModelTest.latencyMs ? `<span class="tag">${escapeHtml(lastModelTest.latencyMs)}ms</span>` : ""}
      </div>
    </div>
  `;
}

function renderAgentOutputSummary(run, customer) {
  if (!run) {
    return `
      <div class="agent-usage-card">
        <h3>${escapeHtml(customer.name)} 暂无Agent建议</h3>
        <ol class="usage-steps">
          <li>先选择客户，确认客户当前阶段、意向分、会员状态和关注型号。</li>
          <li>把客户最新一句话填到“客户最新消息/需求”，或直接点下方常用场景。</li>
          <li>按当前工作选择电销、销售、VIP分流或报价推荐按钮。</li>
          <li>右侧会给出判断、建议动作和可复制草稿；真实触达前仍需人工确认。</li>
        </ol>
      </div>
    `;
  }

  const recommendedQuotes = run.recommendations || run.quoteRecommendations || [];
  const draft = state.outboundDrafts.find((item) => item.id === run.outboundDraftId);
  const relatedTasks = tasksFor(customer.id).slice(0, 3);
  const detectedModels = run.detectedModels?.length ? run.detectedModels : run.subscriptionModels || [];
  const decisionItems = [
    run.score !== undefined ? ["外呼评分", String(run.score), run.nextStage || ""] : null,
    run.intent ? ["识别意图", run.intent, run.confidence ? `置信度 ${run.confidence}%` : ""] : null,
    run.need ? ["客户需求", run.need, run.humanRequired ? "需要销售人工跟进" : "可先由系统承接"] : null,
    run.routeTo ? ["建议处理人", run.routeTo, run.priority ? `优先级 ${run.priority}` : ""] : null,
    run.recommendedCard ? ["推荐卡种", run.recommendedCard, run.objection ? `异议点：${run.objection}` : ""] : null,
    detectedModels.length ? ["关注型号", listText(detectedModels), "已回写客户关注"] : null
  ].filter(Boolean);

  return `
    <div class="agent-result-stack">
      ${renderExecutionNotice(run)}
      <div class="agent-result-hero">
        <div>
          <span class="agent-meta">${escapeHtml(run.agent || "Agent输出")}</span>
          <h3>${escapeHtml(run.nextAction || run.need || run.intent || "本地分析已完成")}</h3>
          <p>${escapeHtml(summarizeAgentRun(run))}</p>
        </div>
        <span class="status-pill">${escapeHtml(customer.name)}</span>
      </div>

      ${decisionItems.length ? `
        <div class="insight-grid">
          ${decisionItems.map(([label, value, detail]) => renderMiniMetric(label, value, detail)).join("")}
        </div>
      ` : ""}

      ${run.playbook ? `
        <div class="business-card">
          <h3>销售承接重点</h3>
          <div class="event-list compact">
            <div class="event-item"><div class="event-meta">开场问题</div><div class="event-text">${escapeHtml(run.playbook.openingQuestion || "暂无")}</div></div>
            <div class="event-item"><div class="event-meta">价值证明</div><div class="event-text">${escapeHtml(run.playbook.valueProof || "暂无")}</div></div>
            <div class="event-item"><div class="event-meta">成交推进</div><div class="event-text">${escapeHtml(run.playbook.closingSuggestion || "暂无")}</div></div>
          </div>
        </div>
      ` : ""}

      ${run.suggestedReply || run.pushCopy ? `
        <div class="business-card">
          <h3>可发送草稿</h3>
          <div class="draft-content">${escapeHtml(run.pushCopy || run.suggestedReply)}</div>
          <p class="muted">这只是本地草稿，不会自动发短信、企微或群消息。</p>
        </div>
      ` : ""}

      ${run.llmEnhancement ? `
        <div class="business-card ${run.llmEnhancement.status === "成功" ? "success-card" : "warning-card"}">
          <h3>真实LLM增强</h3>
          ${run.llmEnhancement.status === "成功" ? `
            <div class="draft-content">${escapeHtml(run.llmEnhancement.content)}</div>
            <p class="muted">${escapeHtml(run.llmEnhancement.provider || "")} / ${escapeHtml(run.llmEnhancement.model || "")} · ${escapeHtml(run.llmEnhancement.latencyMs || "")}ms · 已生成本地增强草稿，仍需人工确认。</p>
          ` : `
            <p class="event-text">${escapeHtml(run.llmEnhancement.error || "LLM增强未完成")}</p>
            <p class="muted">本地规则结果已保留，未触发外呼、短信、企微或CRM动作。</p>
          `}
        </div>
      ` : ""}

      ${recommendedQuotes.length ? `
        <div class="business-card">
          <h3>推荐报价</h3>
          <div class="quote-mini-list">
            ${recommendedQuotes.map((quote) => `
              <div class="quote-mini-item">
                <strong>${escapeHtml(quote.brand)} ${escapeHtml(quote.model)}</strong>
                <span>${escapeHtml(quote.config)} · ${currency(quote.price)} · ${escapeHtml(quote.stock || "库存未记录")}</span>
                <small>${escapeHtml(listText(quote.reasons || [], "匹配客户关注"))}</small>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}

      ${run.contextSummary ? `
        <div class="business-card">
          <h3>VIP群分流判断</h3>
          <div class="profile-grid">
            ${renderMiniMetric("客户@对象", run.mentionedRole || "未明确")}
            ${renderMiniMetric("应转角色", run.routeTo || "待判断")}
            ${renderMiniMetric("是否@错人", run.mentionMismatch ? "是" : "否")}
            ${renderMiniMetric("重复/未结", run.repeatedIssue ? "需要优先处理" : "暂无重复")}
          </div>
          <p class="event-text">${escapeHtml(run.contextSummary)}</p>
        </div>
      ` : ""}

      <div class="business-card">
        <h3>已生成的后续事项</h3>
        <div class="event-list compact">
          ${draft ? `<div class="event-item"><div class="event-meta">触达草稿 · ${escapeHtml(draft.channel)} · ${escapeHtml(draft.status)}</div><div class="event-text">${escapeHtml(draft.content)}</div></div>` : `<div class="event-item"><div class="event-text">暂无新的触达草稿。</div></div>`}
          ${relatedTasks.map((task) => `<div class="event-item"><div class="event-meta">${escapeHtml(task.ownerRole || "负责人")} · ${escapeHtml(task.priority || "中")} · ${escapeHtml(task.status)}</div><div class="event-text">${escapeHtml(task.title)}：${escapeHtml(task.reason || "待跟进")}</div></div>`).join("")}
        </div>
      </div>
    </div>
  `;
}

function renderSalesLearningResult(run) {
  if (!run?.playbook?.learnedTactics?.length) {
    return renderEmptyState("尚未产生销售学习输出", "在 Agent 控制台运行销售承接Agent后，这里会展示本次引用的样本和推荐话术。");
  }
  return `
    <div class="agent-result-stack">
      <div class="insight-grid">
        ${renderMiniMetric("客户", run.handoffPackage?.customer || "未记录", run.handoffPackage?.stage || "")}
        ${renderMiniMetric("推荐卡种", run.recommendedCard || "未判断")}
        ${renderMiniMetric("核心异议", run.objection || "未识别")}
        ${renderMiniMetric("引用样本", run.playbook.learnedTactics.length, "高质量销售样本")}
      </div>
      <div class="business-card">
        <h3>推荐成交表达</h3>
        <div class="draft-content">${escapeHtml(run.playbook.winningPhrase || "暂无推荐话术")}</div>
      </div>
      <div class="business-card">
        <h3>本次引用的销售技巧</h3>
        <div class="event-list compact">
          ${run.playbook.learnedTactics.map((item) => `
            <div class="event-item">
              <div class="event-meta">${escapeHtml(item.scene || "销售样本")} · 质检 ${escapeHtml(item.qualityScore || "未记录")}</div>
              <div class="event-text">${escapeHtml(item.tactic || item.phrase || "暂无内容")}</div>
            </div>
          `).join("")}
        </div>
      </div>
    </div>
  `;
}

function renderVipContextResult(run) {
  if (!run?.conversationContext) return "";
  return `
    <h3 style="margin-top:16px">最近VIP分流上下文</h3>
    <div class="business-card">
      <div class="insight-grid">
        ${renderMiniMetric("识别意图", run.intent || "未识别", run.confidence ? `置信度 ${run.confidence}%` : "")}
        ${renderMiniMetric("应转角色", run.routeTo || "待判断")}
        ${renderMiniMetric("同类问题", `${run.sameIntentCount || 0} 次`, run.repeatedIssue ? "需要优先处理" : "暂无重复")}
        ${renderMiniMetric("未结任务", run.pendingTask ? run.pendingTask.title : "暂无")}
      </div>
      <p class="event-text">${escapeHtml(run.contextSummary || "暂无上下文摘要。")}</p>
    </div>
  `;
}

function renderLoadError() {
  if (!state.loadError) return "";
  return `
    <section class="panel warning-panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">本地服务连接异常</h2>
          <p class="panel-subtitle">${escapeHtml(state.loadError)}</p>
        </div>
      </div>
      ${renderEmptyState("无法读取系统状态", "请确认本地服务已经启动，然后刷新页面或点击重置数据。")}
    </section>
  `;
}

function customerOptions(currentCustomer = selectedCustomer(), customers = state.customers) {
  if (!customers.length) return `<option value="" disabled selected>暂无客户</option>`;
  return customers.map((item) => `
    <option value="${escapeHtml(item.id)}" ${currentCustomer?.id === item.id ? "selected" : ""}>
      ${escapeHtml(item.name)} · ${escapeHtml(item.stage || "待筛选")}
    </option>
  `).join("");
}

function uniqueCustomerValues(field) {
  return [...new Set(state.customers.map((customer) => String(customer[field] || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function customerSearchText(customer) {
  return [
    customer.name,
    customer.contact,
    customer.phone,
    customer.stage,
    customer.owner,
    customer.memberStatus,
    customer.targetCard,
    customer.risk,
    customer.notes,
    ...(customer.tags || []),
    ...(customer.watchedModels || [])
  ].join(" ").toLowerCase();
}

function filteredCustomers() {
  const query = customerSearchQuery.trim().toLowerCase();
  return state.customers.filter((customer) => {
    const matchesSearch = !query || customerSearchText(customer).includes(query);
    const matchesStageSet = !customerStageSetFilter.length || customerStageSetFilter.includes(customer.stage);
    const matchesStage = matchesStageSet && (customerStageFilter === "全部" || customer.stage === customerStageFilter);
    const matchesMember = customerMemberFilter === "全部" || customer.memberStatus === customerMemberFilter;
    const matchesOwner = customerOwnerFilter === "全部" || customer.owner === customerOwnerFilter;
    return matchesSearch && matchesStage && matchesMember && matchesOwner;
  });
}

function customerFilterControls(scope) {
  const currentScope = customerScopeDefinition();
  const availableStages = currentScope.stages?.length ? currentScope.stages : STAGES;
  const stages = ["全部", ...availableStages];
  const members = ["全部", ...uniqueCustomerValues("memberStatus")];
  const owners = ["全部", ...uniqueCustomerValues("owner")];
  return `
    <div class="filter-bar" data-filter-scope="${escapeHtml(scope)}">
      <div class="field search-field">
        <label for="${scope}CustomerSearch">搜索</label>
        <input id="${scope}CustomerSearch" data-customer-filter="search" value="${escapeHtml(customerSearchQuery)}" placeholder="客户名、联系人、手机号、标签、机型">
      </div>
      <div class="field">
        <label for="${scope}StageFilter">阶段</label>
        <select id="${scope}StageFilter" data-customer-filter="stage">
          ${stages.map((stage) => `<option value="${escapeHtml(stage)}" ${stage === customerStageFilter ? "selected" : ""}>${escapeHtml(stage)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label for="${scope}MemberFilter">会员</label>
        <select id="${scope}MemberFilter" data-customer-filter="member">
          ${members.map((member) => `<option value="${escapeHtml(member)}" ${member === customerMemberFilter ? "selected" : ""}>${escapeHtml(member)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label for="${scope}OwnerFilter">负责人</label>
        <select id="${scope}OwnerFilter" data-customer-filter="owner">
          ${owners.map((owner) => `<option value="${escapeHtml(owner)}" ${owner === customerOwnerFilter ? "selected" : ""}>${escapeHtml(owner)}</option>`).join("")}
        </select>
      </div>
      <button class="small-button filter-reset" type="button" data-reset-customer-filters>重置筛选</button>
    </div>
    ${customerStageSetFilter.length ? `<div class="filter-note">当前业务入口已限定阶段：${customerStageSetFilter.map(escapeHtml).join("、")}</div>` : ""}
  `;
}

function customerName(customerId) {
  return getCustomer(state, customerId)?.name || "未知客户";
}

function sortedUnique(values = []) {
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function taskSearchText(task) {
  const customer = getCustomer(state, task.customerId);
  return [
    task.title,
    task.reason,
    task.ownerRole,
    task.owner,
    task.priority,
    task.status,
    task.sla,
    customer?.name,
    customer?.contact,
    customer?.phone,
    customer?.stage,
    customer?.owner,
    ...(customer?.tags || []),
    ...(customer?.watchedModels || [])
  ].join(" ").toLowerCase();
}

function taskOwnerValue(task) {
  return task.owner || getCustomer(state, task.customerId)?.owner || "待分配";
}

function filteredTasks() {
  const query = taskSearchQuery.trim().toLowerCase();
  return [...state.tasks]
    .sort((a, b) => {
      const doneA = a.status === "已完成" ? 1 : 0;
      const doneB = b.status === "已完成" ? 1 : 0;
      if (doneA !== doneB) return doneA - doneB;
      return taskDueAt(a).getTime() - taskDueAt(b).getTime();
    })
    .filter((task) => {
      const sla = taskSlaMeta(task);
      const matchesSearch = !query || taskSearchText(task).includes(query);
      const matchesRole = taskRoleFilter === "全部" || task.ownerRole === taskRoleFilter;
      const matchesOwner = taskOwnerFilter === "全部" || taskOwnerValue(task) === taskOwnerFilter;
      const matchesStatus = taskStatusFilter === "全部" || task.status === taskStatusFilter;
      const matchesPriority = taskPriorityFilter === "全部" || task.priority === taskPriorityFilter;
      const matchesSla = taskSlaFilter === "全部" || (taskSlaFilter === "已升级" ? task.escalated : sla.label === taskSlaFilter);
      return matchesSearch && matchesRole && matchesOwner && matchesStatus && matchesPriority && matchesSla;
    });
}

function taskFilterControls(visibleTasks) {
  const roles = ["全部", ...sortedUnique(state.tasks.map((task) => task.ownerRole))];
  const owners = ["全部", ...sortedUnique(state.tasks.map(taskOwnerValue))];
  const statuses = ["全部", "待处理", "跟进中", "已完成"];
  const priorities = ["全部", "高", "中", "低"];
  const slaStates = ["全部", "已超时", "临期", "正常", "已完成", "已升级"];
  const selectedVisible = visibleTasks.filter((task) => selectedTaskIds.has(task.id)).length;
  return `
    <div class="filter-bar dense-filter-bar" data-filter-scope="tasks">
      <div class="field search-field">
        <label for="taskSearch">搜索</label>
        <input id="taskSearch" data-task-filter="search" value="${escapeHtml(taskSearchQuery)}" placeholder="客户、任务、原因、型号、负责人">
      </div>
      <div class="field">
        <label for="taskRoleFilter">角色</label>
        <select id="taskRoleFilter" data-task-filter="role">${roles.map((role) => `<option value="${escapeHtml(role)}" ${role === taskRoleFilter ? "selected" : ""}>${escapeHtml(role)}</option>`).join("")}</select>
      </div>
      <div class="field">
        <label for="taskOwnerFilter">负责人</label>
        <select id="taskOwnerFilter" data-task-filter="owner">${owners.map((owner) => `<option value="${escapeHtml(owner)}" ${owner === taskOwnerFilter ? "selected" : ""}>${escapeHtml(owner)}</option>`).join("")}</select>
      </div>
      <div class="field">
        <label for="taskStatusFilter">状态</label>
        <select id="taskStatusFilter" data-task-filter="status">${statuses.map((status) => `<option value="${escapeHtml(status)}" ${status === taskStatusFilter ? "selected" : ""}>${escapeHtml(status)}</option>`).join("")}</select>
      </div>
      <div class="field">
        <label for="taskPriorityFilter">优先级</label>
        <select id="taskPriorityFilter" data-task-filter="priority">${priorities.map((priority) => `<option value="${escapeHtml(priority)}" ${priority === taskPriorityFilter ? "selected" : ""}>${escapeHtml(priority)}</option>`).join("")}</select>
      </div>
      <div class="field">
        <label for="taskSlaFilter">SLA</label>
        <select id="taskSlaFilter" data-task-filter="sla">${slaStates.map((sla) => `<option value="${escapeHtml(sla)}" ${sla === taskSlaFilter ? "selected" : ""}>${escapeHtml(sla)}</option>`).join("")}</select>
      </div>
      <button class="small-button filter-reset" type="button" data-reset-task-filters>重置</button>
    </div>
    <div class="batch-toolbar">
      <label class="inline-check compact-check">
        <input id="taskSelectAll" type="checkbox" ${visibleTasks.length && selectedVisible === visibleTasks.length ? "checked" : ""} ${visibleTasks.length ? "" : "disabled"}>
        <span>选择当前结果</span>
      </label>
      <span class="muted">已选 ${selectedTaskIds.size} / 当前结果 ${visibleTasks.length}</span>
      <button class="small-button" type="button" data-task-batch-status="跟进中" ${selectedTaskIds.size ? "" : "disabled"}>批量跟进中</button>
      <button class="small-button" type="button" data-task-batch-status="已完成" ${selectedTaskIds.size ? "" : "disabled"}>批量完成</button>
      <button class="small-button" type="button" data-clear-task-selection ${selectedTaskIds.size ? "" : "disabled"}>清空选择</button>
    </div>
  `;
}

function draftRiskMeta(draft) {
  const text = [draft.content, draft.note, draft.draftType, draft.channel].join(" ");
  if (/投诉|赔偿|退款|最低价|锁价|承诺|合同|付款|转账|发票|质量|坏了|投诉/.test(text)) {
    return { label: "高风险", className: "high", batchConfirmBlocked: true };
  }
  if (/售后|维修|补偿|优惠|价格|折扣|欠款|催/.test(text)) {
    return { label: "需注意", className: "mid", batchConfirmBlocked: false };
  }
  return { label: "常规", className: "low", batchConfirmBlocked: false };
}

function draftSearchText(draft) {
  const customer = getCustomer(state, draft.customerId);
  return [
    draft.customerName,
    draft.channel,
    draft.draftType,
    draft.sourceAgent,
    draft.content,
    draft.priority,
    draft.status,
    draft.note,
    draftRiskMeta(draft).label,
    customer?.name,
    customer?.contact,
    customer?.owner,
    ...(customer?.tags || []),
    ...(customer?.watchedModels || [])
  ].join(" ").toLowerCase();
}

function sortedDrafts() {
  return [...(state.outboundDrafts || [])].sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
}

function filteredDrafts() {
  const query = draftSearchQuery.trim().toLowerCase();
  return sortedDrafts().filter((draft) => {
    const risk = draftRiskMeta(draft);
    const matchesSearch = !query || draftSearchText(draft).includes(query);
    const matchesStatus = draftStatusFilter === "全部" || draft.status === draftStatusFilter;
    const matchesChannel = draftChannelFilter === "全部" || draft.channel === draftChannelFilter;
    const matchesPriority = draftPriorityFilter === "全部" || draft.priority === draftPriorityFilter;
    const matchesRisk = draftRiskFilter === "全部" || risk.label === draftRiskFilter;
    return matchesSearch && matchesStatus && matchesChannel && matchesPriority && matchesRisk;
  });
}

function draftFilterControls(visibleDrafts) {
  const statuses = ["全部", "待确认", "已确认", "已复制", "企微已发送", "人工已处理", "已废弃"];
  const channels = ["全部", ...sortedUnique((state.outboundDrafts || []).map((draft) => draft.channel))];
  const priorities = ["全部", "高", "中", "低"];
  const risks = ["全部", "高风险", "需注意", "常规"];
  const selectedVisible = visibleDrafts.filter((draft) => selectedDraftIds.has(draft.id)).length;
  return `
    <div class="filter-bar dense-filter-bar" data-filter-scope="drafts">
      <div class="field search-field">
        <label for="draftSearch">搜索</label>
        <input id="draftSearch" data-draft-filter="search" value="${escapeHtml(draftSearchQuery)}" placeholder="客户、渠道、文案、风险词、Agent">
      </div>
      <div class="field">
        <label for="draftStatusFilter">状态</label>
        <select id="draftStatusFilter" data-draft-filter="status">${statuses.map((status) => `<option value="${escapeHtml(status)}" ${status === draftStatusFilter ? "selected" : ""}>${escapeHtml(status)}</option>`).join("")}</select>
      </div>
      <div class="field">
        <label for="draftChannelFilter">渠道</label>
        <select id="draftChannelFilter" data-draft-filter="channel">${channels.map((channel) => `<option value="${escapeHtml(channel)}" ${channel === draftChannelFilter ? "selected" : ""}>${escapeHtml(channel)}</option>`).join("")}</select>
      </div>
      <div class="field">
        <label for="draftPriorityFilter">优先级</label>
        <select id="draftPriorityFilter" data-draft-filter="priority">${priorities.map((priority) => `<option value="${escapeHtml(priority)}" ${priority === draftPriorityFilter ? "selected" : ""}>${escapeHtml(priority)}</option>`).join("")}</select>
      </div>
      <div class="field">
        <label for="draftRiskFilter">风险</label>
        <select id="draftRiskFilter" data-draft-filter="risk">${risks.map((risk) => `<option value="${escapeHtml(risk)}" ${risk === draftRiskFilter ? "selected" : ""}>${escapeHtml(risk)}</option>`).join("")}</select>
      </div>
      <button class="small-button filter-reset" type="button" data-reset-draft-filters>重置</button>
    </div>
    <div class="batch-toolbar">
      <label class="inline-check compact-check">
        <input id="draftSelectAll" type="checkbox" ${visibleDrafts.length && selectedVisible === visibleDrafts.length ? "checked" : ""} ${visibleDrafts.length ? "" : "disabled"}>
        <span>选择当前结果</span>
      </label>
      <span class="muted">已选 ${selectedDraftIds.size} / 当前结果 ${visibleDrafts.length}</span>
      <button class="small-button" type="button" data-draft-batch-status="已确认" ${selectedDraftIds.size ? "" : "disabled"}>批量确认</button>
      <button class="small-button" type="button" data-draft-batch-status="人工已处理" ${selectedDraftIds.size ? "" : "disabled"}>批量已处理</button>
      <button class="danger-button" type="button" data-draft-batch-status="已废弃" ${selectedDraftIds.size ? "" : "disabled"}>批量废弃</button>
      <button class="small-button" type="button" data-clear-draft-selection ${selectedDraftIds.size ? "" : "disabled"}>清空选择</button>
    </div>
  `;
}

function quoteSearchText(quote) {
  return [quote.brand, quote.model, quote.config, quote.stock, quote.validUntil].join(" ").toLowerCase();
}

function filteredQuotes() {
  const query = quoteSearchQuery.trim().toLowerCase();
  const min = quoteMinPrice === "" ? null : Number(quoteMinPrice);
  const max = quoteMaxPrice === "" ? null : Number(quoteMaxPrice);
  return state.quotes.filter((quote) => {
    const price = Number(quote.price || 0);
    const matchesBrand = quoteBrandFilter === "全部" || quote.brand === quoteBrandFilter;
    const matchesSearch = !query || quoteSearchText(quote).includes(query);
    const matchesConfig = quoteConfigFilter === "全部" || quote.config === quoteConfigFilter;
    const matchesStock = quoteStockFilter === "全部" || quote.stock === quoteStockFilter;
    const matchesMin = min === null || !Number.isFinite(min) || price >= min;
    const matchesMax = max === null || !Number.isFinite(max) || price <= max;
    return matchesBrand && matchesSearch && matchesConfig && matchesStock && matchesMin && matchesMax;
  });
}

function quoteFilterControls(brands, configs, stocks) {
  return `
    <div class="filter-bar quote-filter-bar" data-filter-scope="quotes">
      <div class="field search-field">
        <label for="quoteSearch">搜索</label>
        <input id="quoteSearch" data-quote-filter="search" value="${escapeHtml(quoteSearchQuery)}" placeholder="品牌、型号、配置、库存">
      </div>
      <div class="field">
        <label for="quoteBrand">品牌</label>
        <select id="quoteBrand" data-quote-filter="brand">
          ${brands.map((brand) => `<option value="${escapeHtml(brand)}" ${brand === quoteBrandFilter ? "selected" : ""}>${escapeHtml(brand)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label for="quoteConfigFilter">配置</label>
        <select id="quoteConfigFilter" data-quote-filter="config">
          ${configs.map((config) => `<option value="${escapeHtml(config)}" ${config === quoteConfigFilter ? "selected" : ""}>${escapeHtml(config)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label for="quoteStockFilter">库存</label>
        <select id="quoteStockFilter" data-quote-filter="stock">
          ${stocks.map((stock) => `<option value="${escapeHtml(stock)}" ${stock === quoteStockFilter ? "selected" : ""}>${escapeHtml(stock)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label for="quoteMinPrice">最低价</label>
        <input id="quoteMinPrice" data-quote-filter="minPrice" type="number" min="0" value="${escapeHtml(quoteMinPrice)}" placeholder="不限">
      </div>
      <div class="field">
        <label for="quoteMaxPrice">最高价</label>
        <input id="quoteMaxPrice" data-quote-filter="maxPrice" type="number" min="0" value="${escapeHtml(quoteMaxPrice)}" placeholder="不限">
      </div>
      <button class="small-button filter-reset" type="button" data-reset-quote-filters>重置</button>
    </div>
  `;
}

function cardKpi(label, value, detail) {
  return `
    <article class="kpi-card">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${value}</div>
      <div class="kpi-detail">${detail}</div>
    </article>
  `;
}

function workbenchCustomers(role) {
  if (role === "telemarketing") {
    return state.customers
      .filter((customer) => ["待筛选", "待外呼", "电销企微培育"].includes(customer.stage))
      .sort((a, b) => Number(b.intentScore || 0) - Number(a.intentScore || 0))
      .slice(0, 5);
  }
  return state.customers
    .filter((customer) => ["销售企微承接", "销售跟进"].includes(customer.stage) || Number(customer.intentScore || 0) >= 80)
    .sort((a, b) => Number(b.intentScore || 0) - Number(a.intentScore || 0))
    .slice(0, 5);
}

function workbenchTasks(role) {
  const ownerRole = role === "telemarketing" ? "电销" : "销售";
  return state.tasks
    .filter((task) => task.ownerRole === ownerRole && task.status !== "已完成")
    .sort((a, b) => taskDueAt(a).getTime() - taskDueAt(b).getTime())
    .slice(0, 5);
}

function renderRoleWorkbenchCard(role) {
  const isTelemarketing = role === "telemarketing";
  const title = isTelemarketing ? "电销工作台" : "销售工作台";
  const detail = isTelemarketing ? "先筛意向、生成培育草稿、转交销售企微。" : "承接高意向客户、推进会员卡成交、处理销售任务。";
  const customers = workbenchCustomers(role);
  const tasks = workbenchTasks(role);
  const taskRole = isTelemarketing ? "电销" : "销售";
  const stageFilter = isTelemarketing ? "待外呼" : "销售企微承接";
  return `
    <article class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">${title}</h2>
          <p class="panel-subtitle">${detail}</p>
        </div>
        <div class="toolbar">
          <button class="small-button" type="button" data-workbench-task-role="${taskRole}">看任务</button>
          <button class="small-button" type="button" data-workbench-customer-stage="${stageFilter}">看客户</button>
        </div>
      </div>
      <div class="workbench-grid">
        <div>
          <div class="section-label">优先客户</div>
          <div class="mini-list">
            ${customers.map((customer) => `
              <button class="mini-row" type="button" data-customer="${escapeHtml(customer.id)}">
                <span><strong>${escapeHtml(customer.name)}</strong><small>${escapeHtml(customer.stage)} · ${escapeHtml(customer.owner || "待分配")}</small></span>
                <b>${escapeHtml(customer.intentScore)}</b>
              </button>
            `).join("") || `<div class="muted">暂无匹配客户。</div>`}
          </div>
        </div>
        <div>
          <div class="section-label">待办任务</div>
          <div class="mini-list">
            ${tasks.map((task) => `
              <div class="mini-row static-row">
                <span><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(customerName(task.customerId))} · ${escapeHtml(taskSlaMeta(task).label)}</small></span>
                <b>${escapeHtml(task.priority)}</b>
              </div>
            `).join("") || `<div class="muted">暂无未完成任务。</div>`}
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderOverview() {
  const highIntent = state.customers.filter((customer) => customer.intentScore >= 75).length;
  const vip = state.customers.filter((customer) => customer.stage === "VIP维护" || String(customer.memberStatus || "").includes("卡")).length;
  const pendingTasks = state.tasks.filter((task) => task.status !== "已完成").length;
  const subscribed = state.customers.filter((customer) => (customer.tags || []).includes("报价订阅")).length;

  return `
    ${renderLoadError()}
    ${renderTruthPanel()}
    <section class="grid four">
      ${cardKpi("客户档案", state.customers.length, "统一CustomerProfile本地数据")}
      ${cardKpi("高意向客户", highIntent, "意向分不低于75")}
      ${cardKpi("待处理任务", pendingTasks, "销售线索、VIP分流、报价咨询")}
      ${cardKpi("报价订阅客户", subscribed, "客户关注型号已回流档案")}
    </section>

    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">总体闭环链路</h2>
          <p class="panel-subtitle">本地客户数据进入客户池，经电销、销售、VIP维护流转，结果真实回写客户档案、任务、报价和审计。</p>
        </div>
      </div>
      <div class="flow-row">
        ${["客户数据", "电销筛选", "本地消息沉淀", "销售承接", "VIP维护", "数据回流"].map((node, index) => `
          <div class="flow-node">
            <strong>${node}</strong>
            <span>${["客户基础池", "生成外呼任务", "标签培育", "会员卡转化", "问题分流/报价", "策略优化"][index]}</span>
          </div>
        `).join("")}
      </div>
    </section>

    <section class="grid two">
      ${renderRoleWorkbenchCard("telemarketing")}
      ${renderRoleWorkbenchCard("sales")}
    </section>

    <details class="panel advanced-debug-panel">
      <summary>高级调试：模拟入站工具</summary>
      <p class="panel-subtitle">这些工具只用于本地验证路由、去重和队列状态，不代表已经接入真实企微或个人微信。</p>
      <section class="grid two">
      <article class="panel subtle-panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">系统蓝图</h2>
            <p class="panel-subtitle">客户、Agent、任务、草稿、报价和模型配置作为一个系统协同流转。</p>
          </div>
        </div>
        ${renderSystemBlueprint()}
      </article>
      <article class="panel subtle-panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">最近Agent输出</h2>
            <p class="panel-subtitle">每次运行Agent都会写入事件流和任务中心。</p>
          </div>
        </div>
        <div class="agent-log">
          ${state.agentRuns.slice(0, 6).map((run) => `
            <div class="agent-item">
              <div class="agent-meta">${escapeHtml(run.agent)} · ${escapeHtml(run.nextAction || run.intent || run.need || "策略输出")}</div>
              <div class="agent-text">${escapeHtml(summarizeAgentRun(run))}</div>
            </div>
          `).join("") || `<div class="muted">暂无Agent运行记录。</div>`}
        </div>
      </article>
    </section>

    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">系统审计日志</h2>
          <p class="panel-subtitle">服务端记录所有关键动作，后续可对接权限、合规和运营复盘。</p>
        </div>
      </div>
      <div class="event-list">
        ${(state.auditLog || []).slice(0, 8).map((item) => `
            <div class="event-item">
              <div class="event-meta">${escapeHtml(formatDateTime(item.time, item.time))} · ${escapeHtml(item.actor)} · ${escapeHtml(item.action)}</div>
            <div class="event-text">${escapeHtml(item.target)}${item.detail ? `：${escapeHtml(summarizeAuditDetail(item.detail))}` : ""}</div>
            </div>
          `).join("") || `<div class="muted">暂无审计记录。</div>`}
      </div>
    </section>
  `;
}

function renderJourney() {
  const customer = selectedCustomer();
  if (!customer) {
    return `
      ${renderLoadError()}
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">客户生命周期状态</h2>
            <p class="panel-subtitle">当前没有可展示的客户档案。</p>
          </div>
        </div>
        ${renderEmptyState("暂无客户数据", "请先在客户管理中新增客户，或点击顶部重置数据恢复本地样例客户。", "新增客户后，客户旅程、Agent控制台和报价订阅会自动恢复可用。")}
      </section>
    `;
  }
  const visibleCustomers = filteredCustomers();
  const stageGroups = STAGES.map((stage) => ({
    stage,
    customers: visibleCustomers.filter((item) => item.stage === stage)
  })).filter((group) => group.customers.length || ["待外呼", "电销企微培育", "销售企微承接", "VIP维护"].includes(group.stage));

  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">客户生命周期状态</h2>
          <p class="panel-subtitle">所有客户在同一套状态机中流转，当前筛选结果 ${visibleCustomers.length}/${state.customers.length} 个。</p>
        </div>
      </div>
      <div class="journey-board">
        ${stageGroups.map((group) => `
          <div class="stage-card">
            <strong>${group.stage} · ${group.customers.length}</strong>
            ${group.customers.slice(0, 3).map((item) => `
              <div class="mini-customer">${escapeHtml(item.name)}<br><span class="muted">${item.intentScore || 0}分 · ${escapeHtml(item.owner || "待分配")}</span></div>
            `).join("") || `<div class="muted">暂无客户</div>`}
          </div>
        `).join("")}
      </div>
    </section>

    <section class="grid two">
      </section>
    </details>

    <section class="grid two">
      <article class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">客户池</h2>
            <p class="panel-subtitle">点击客户后，右侧档案、事件和任务同步切换；搜索和筛选只影响当前展示。</p>
          </div>
        </div>
        ${customerFilterControls("journey")}
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>客户</th><th>阶段</th><th>意向</th><th>交易额</th><th>负责人</th></tr>
            </thead>
            <tbody>
              ${visibleCustomers.map((item) => `
                <tr class="customer-row ${item.id === customer.id ? "active" : ""}" data-customer="${item.id}">
                  <td><strong>${escapeHtml(item.name)}</strong><br><span class="muted">${escapeHtml(item.contact)}</span></td>
                  <td><span class="status-pill">${escapeHtml(item.stage)}</span></td>
                  <td>${item.intentScore || 0}</td>
                  <td>${currency(Number(item.tradeVolume || 0))}</td>
                  <td>${escapeHtml(item.owner || "待分配")}</td>
                </tr>
              `).join("") || `<tr><td colspan="5">${renderEmptyState("没有匹配客户", "请调整搜索词或筛选条件。")}</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>

      <article class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">${escapeHtml(customer.name)}</h2>
            <p class="panel-subtitle">${escapeHtml(customer.notes)}</p>
          </div>
        </div>
        <div class="profile-grid">
          <div class="profile-item"><span>会员状态</span><strong>${escapeHtml(customer.memberStatus)}</strong></div>
          <div class="profile-item"><span>推荐卡种</span><strong>${escapeHtml(customer.targetCard)}</strong></div>
          <div class="profile-item"><span>采购频次</span><strong>${customer.purchaseFrequency || 0}次</strong></div>
          <div class="profile-item"><span>最近交易</span><strong>${customer.lastTradeDays || 0}天前</strong></div>
        </div>
        <h3 style="margin-top:14px">标签</h3>
        <div class="tag-list">${(customer.tags || []).map(tagPill).join("") || `<span class="muted">暂无标签</span>`}</div>
        <h3 style="margin-top:14px">事件流</h3>
        <div class="event-list">
          ${eventsFor(customer.id).map((event) => `
            <div class="event-item">
              <div class="event-meta">${escapeHtml(event.time)} · ${escapeHtml(event.channel)} · ${escapeHtml(event.type)}</div>
              <div class="event-text">${escapeHtml(event.text)}</div>
            </div>
          `).join("") || `<div class="muted">暂无事件。</div>`}
        </div>
      </article>
    </section>
  `;
}

function renderCustomerCreatePage(scope) {
  const defaultStage = scope.stages?.[0] || STAGES[0];
  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">${escapeHtml(scope.title)} · 新增档案</h2>
          <p class="panel-subtitle">${escapeHtml(scope.subtitle)} 新增客户会真实写入本地客户池。</p>
        </div>
        <button class="small-button" type="button" data-customer-page="list">返回客户列表</button>
      </div>
      <form id="newCustomerForm" class="form-grid">
        <div class="field"><label>客户名称</label><input name="name" required placeholder="例：苏州云启通讯"></div>
        <div class="field"><label>联系人</label><input name="contact" placeholder="例：张总"></div>
        <div class="field"><label>手机号</label><input name="phone" placeholder="138****0000"></div>
        <div class="field"><label>当前阶段</label><select name="stage">${STAGES.map((stage) => `<option value="${stage}" ${stage === defaultStage ? "selected" : ""}>${stage}</option>`).join("")}</select></div>
        <div class="field"><label>负责人</label><input name="owner" placeholder="待分配"></div>
        <div class="field"><label>交易额</label><input name="tradeVolume" type="number" value="300000"></div>
        <div class="field"><label>采购频次</label><input name="purchaseFrequency" type="number" value="6"></div>
        <div class="field"><label>最近交易天数</label><input name="lastTradeDays" type="number" value="15"></div>
        <div class="field"><label>会员状态</label><input name="memberStatus" value="未购卡"></div>
        <div class="field"><label>推荐卡种</label><input name="targetCard" value="平台银卡"></div>
        <div class="field full-span"><label>标签</label><input name="tags" placeholder="iPhone 13, 潜在意向, 高频采购"></div>
        <div class="field full-span"><label>关注型号</label><input name="watchedModels" placeholder="iPhone 13, Mate60"></div>
        <div class="field full-span"><label>备注</label><textarea name="notes" placeholder="补充客户背景、采购偏好或运营判断。"></textarea></div>
        <button class="primary-button full-span" type="submit" ${actionAttrs("create-customer")}>新增客户</button>
      </form>
    </section>
  `;
}

function renderCustomerDetailPage(scope, customer) {
  if (!customer) {
    customerPanelMode = "list";
    return renderCustomerListPage(scope, filteredCustomers());
  }
  return `
    <section class="grid two">
      <article class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">${escapeHtml(customer.name)}</h2>
            <p class="panel-subtitle">${escapeHtml(customer.contact)} ${escapeHtml(customer.phone)} · ${escapeHtml(customer.stage)}</p>
          </div>
          <button class="small-button" type="button" data-customer-page="list">返回客户列表</button>
        </div>
        <div class="profile-grid">
          <div class="profile-item"><span>会员状态</span><strong>${escapeHtml(customer.memberStatus)}</strong></div>
          <div class="profile-item"><span>推荐卡种</span><strong>${escapeHtml(customer.targetCard)}</strong></div>
          <div class="profile-item"><span>意向分</span><strong>${customer.intentScore || 0}</strong></div>
          <div class="profile-item"><span>负责人</span><strong>${escapeHtml(customer.owner || "待分配")}</strong></div>
        </div>
        <h3 style="margin-top:14px">标签</h3>
        <div class="tag-list">${(customer.tags || []).map(tagPill).join("") || `<span class="muted">暂无标签</span>`}</div>
        <h3 style="margin-top:14px">事件流</h3>
        <div class="event-list">
          ${eventsFor(customer.id).map((event) => `
            <div class="event-item">
              <div class="event-meta">${escapeHtml(event.time)} · ${escapeHtml(event.channel)} · ${escapeHtml(event.type)}</div>
              <div class="event-text">${escapeHtml(event.text)}</div>
            </div>
          `).join("") || `<div class="muted">暂无事件。</div>`}
        </div>
      </article>

      <article class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">维护客户档案</h2>
            <p class="panel-subtitle">${escapeHtml(scope.title)}内的客户维护会同步回写事件流、任务和会话上下文。</p>
          </div>
        </div>
        <form id="updateCustomerForm" class="form-grid">
          <div class="field"><label>阶段</label><select name="stage">${STAGES.map((stage) => `<option value="${stage}" ${stage === customer.stage ? "selected" : ""}>${stage}</option>`).join("")}</select></div>
          <div class="field"><label>负责人</label><input name="owner" value="${escapeHtml(customer.owner)}"></div>
          <div class="field"><label>会员状态</label><input name="memberStatus" value="${escapeHtml(customer.memberStatus)}"></div>
          <div class="field"><label>推荐卡种</label><input name="targetCard" value="${escapeHtml(customer.targetCard)}"></div>
          <div class="field"><label>意向分</label><input name="intentScore" type="number" value="${customer.intentScore}"></div>
          <div class="field"><label>风险</label><select name="risk">${["低", "中", "高"].map((risk) => `<option value="${risk}" ${risk === customer.risk ? "selected" : ""}>${risk}</option>`).join("")}</select></div>
          <div class="field full-span"><label>标签</label><input name="tags" value="${escapeHtml(customer.tags.join(", "))}"></div>
          <div class="field full-span"><label>关注型号</label><input name="watchedModels" value="${escapeHtml(customer.watchedModels.join(", "))}"></div>
          <div class="field full-span"><label>备注</label><textarea name="notes">${escapeHtml(customer.notes)}</textarea></div>
          <button class="primary-button full-span" type="submit" ${actionAttrs("update-customer")}>保存档案</button>
        </form>

        <div class="divider"></div>
        <form id="outcomeForm" class="form-grid">
          <div class="field"><label>销售结果</label><select name="outcome"><option>成交</option><option>继续培育</option><option>暂缓</option><option>无效</option></select></div>
          <div class="field"><label>成交/会员状态</label><input name="memberStatus" value="${escapeHtml(customer.targetCard)}"></div>
          <div class="field full-span"><label>结果备注</label><input name="note" placeholder="例：客户确认购买金卡，待安排VIP小群。"></div>
          <button class="small-button full-span" type="submit" ${actionAttrs("record-outcome")}>记录销售结果</button>
        </form>
      </article>
    </section>
  `;
}

function renderCustomerListPage(scope, visibleCustomers) {
  const currentCustomer = selectedCustomer();
  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">${escapeHtml(scope.title)} · 客户列表</h2>
          <p class="panel-subtitle">单击客户只切换当前选中对象，双击客户行进入详情维护。当前筛选结果 ${visibleCustomers.length}/${state.customers.length} 个。</p>
        </div>
        <button class="primary-button" type="button" data-customer-page="new">新增档案</button>
      </div>
      ${customerFilterControls("customers")}
      <div class="table-wrap">
        <table>
          <thead><tr><th>客户</th><th>阶段</th><th>标签</th><th>会员</th><th>意向</th><th>负责人</th></tr></thead>
          <tbody>
            ${visibleCustomers.map((item) => `
              <tr class="customer-row ${item.id === currentCustomer?.id ? "active" : ""}" data-customer="${item.id}" title="双击进入客户详情">
                <td><strong>${escapeHtml(item.name)}</strong><br><span class="muted">${escapeHtml(item.contact)} ${escapeHtml(item.phone)}</span></td>
                <td><span class="status-pill">${escapeHtml(item.stage)}</span></td>
                <td>${(item.tags || []).slice(0, 3).map(tagPill).join(" ")}</td>
                <td>${escapeHtml(item.memberStatus)}</td>
                <td>${item.intentScore || 0}</td>
                <td>${escapeHtml(item.owner)}</td>
              </tr>
            `).join("") || `<tr><td colspan="6">${renderEmptyState("没有匹配客户", "请调整搜索词或筛选条件，或点击右上角新增档案。")}</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderCustomers() {
  const scope = customerScopeDefinition();
  const visibleCustomers = filteredCustomers();
  const currentCustomer = selectedCustomer();
  if (customerPanelMode === "new") return renderCustomerCreatePage(scope);
  if (customerPanelMode === "detail") return renderCustomerDetailPage(scope, currentCustomer);
  return renderCustomerListPage(scope, visibleCustomers);
}

function renderAgents() {
  const customer = selectedCustomer();
  if (!customer) {
    return `
      ${renderLoadError()}
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">Agent运行台</h2>
            <p class="panel-subtitle">Agent需要先选择一个客户档案。</p>
          </div>
        </div>
        ${renderEmptyState("暂无客户可运行Agent", "请先新增客户或点击重置数据恢复本地样例客户。")}
      </section>
    `;
  }
  const latestRun = state.agentRuns.find((run) => run.customerId === customer.id) || null;
  return `
    <section class="grid two agent-console-grid">
      <article class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">Agent工作台</h2>
            <p class="panel-subtitle">选择客户和当前问题，系统会给出判断、下一步动作和待确认草稿。</p>
          </div>
        </div>
        <div class="toolbar">
          <div class="field">
            <label for="agentCustomer">客户</label>
            <select id="agentCustomer">
              ${customerOptions(customer)}
            </select>
          </div>
        </div>
        ${customerAgentSummary(customer)}
        <div style="height:14px"></div>
        <div class="field">
          <label for="scenarioText">客户最新消息/需求</label>
          <textarea id="scenarioText">${escapeHtml(selectedScenario)}</textarea>
          <small class="field-help">这里用于模拟客户在电话、私聊或VIP群里的最新一句话；不同按钮会按不同业务场景解读。</small>
        </div>
        <div style="height:10px"></div>
        <div class="scenario-grid">
          ${Object.entries(scenarios).map(([key, value]) => `
            <button class="scenario-button" data-scenario="${key}">${escapeHtml(value)}</button>
          `).join("")}
        </div>
        <label class="inline-check">
          <input id="useLlmEnhancement" type="checkbox">
          <span>本次使用真实LLM增强</span>
        </label>
        <p class="field-help">勾选后会把客户摘要、当前消息和本地Agent结果发送到你在“模型配置”里设置的模型供应商，用于生成更自然的话术和建议；不会自动触达客户。</p>
        <div style="height:14px"></div>
        <div class="agent-tool-list">
          ${renderAgentActionGroup(
            "电销判断",
            "用于判断客户该直转销售、继续培育还是回访。",
            `<button class="primary-button" data-agent="dialer" ${actionAttrs("agent-dialer")}>运行电销评分</button>
             <button class="small-button" data-agent="nurture" ${actionAttrs("agent-nurture")}>分析电销回复</button>`
          )}
          ${renderAgentActionGroup(
            "销售承接",
            "用于会员卡销售沟通，生成承接重点、异议处理和话术草稿。",
            `<button class="small-button" data-agent="sales" ${actionAttrs("agent-sales")}>生成销售承接建议</button>`
          )}
          ${renderAgentActionGroup(
            "VIP维护与报价",
            "用于会员小群问题分流、报价推荐和客户档案回流。",
            `<button class="small-button" data-agent="vip" ${actionAttrs("agent-vip")}>分流VIP群问题</button>
             <button class="small-button" data-agent="quote" ${actionAttrs("agent-quote")}>生成报价推荐</button>`
          )}
        </div>
      </article>

      <article class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">Agent建议</h2>
            <p class="panel-subtitle">这里展示销售可直接理解的判断、草稿和待办；不会展示代码或原始数据结构。</p>
          </div>
        </div>
        ${renderAgentOutputSummary(latestRun, customer)}
      </article>
    </section>
  `;
}

function renderModelConfig() {
  const config = normalizeModelConfigState(state.modelConfig);
  const effectiveModels = modelAgentDefinitions.map((definition) => effectiveModelFor(definition.key));
  const overridden = effectiveModels.filter((item) => !item.inheritedFromGlobal);
  const latestRun = state.agentRuns[0];
  const voiceConfigured = [config.voice.asr, config.voice.tts].filter((item) => item.model && item.apiUrl).length;
  return `
    <section class="panel warning-panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">模型连接边界</h2>
          <p class="panel-subtitle">这里可以保存真实 LLM、语音识别 ASR、语音合成 TTS 的 API URL、API Key 和模型名。默认Agent仍先由本地规则引擎稳定执行；点击测试连接或在Agent控制台勾选真实LLM增强时，会调用配置的LLM。API Key保存在本地状态文件，页面只显示是否已配置。</p>
        </div>
      </div>
    </section>

    <section class="grid four">
      ${cardKpi("全局LLM", escapeHtml(config.global.model), escapeHtml(config.global.provider))}
      ${cardKpi("独立配置", overridden.length, "已覆盖全局的Agent")}
      ${cardKpi("语音模型", voiceConfigured, "ASR/TTS已配置项")}
      ${cardKpi("最近执行", latestRun?.execution ? escapeHtml(latestRun.execution.engine) : "暂无", latestRun?.execution?.modelInvocation || "运行Agent后记录")}
    </section>

    <form id="modelConfigForm" class="model-config-form">
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">全局LLM大模型</h2>
            <p class="panel-subtitle">所有Agent默认继承这套LLM连接；Agent不填独立配置时自动跟随全局。</p>
          </div>
          <div class="split-actions">
            <button class="small-button" type="button" data-model-test="global" ${actionAttrs("test-model-global")}>测试全局连接</button>
            <button class="small-button" type="button" data-model-test="sales" ${actionAttrs("test-model-sales")}>测试销售Agent连接</button>
            <button class="primary-button" type="submit" ${actionAttrs("save-model-config")}>保存模型配置</button>
          </div>
        </div>
        <div class="form-grid compact-form">
          <div class="field"><label>供应商/网关</label><input name="global.provider" value="${escapeHtml(config.global.provider)}" placeholder="例：DeepSeek / OpenAI兼容网关"></div>
          <div class="field"><label>API URL</label><input name="global.apiUrl" value="${escapeHtml(config.global.apiUrl)}" required placeholder="https://api.deepseek.com"></div>
          <div class="field"><label>API Key</label><input name="global.apiKey" type="password" value="" placeholder="${escapeHtml(apiKeyPlaceholder(config.global))}">${apiKeyHelp(config.global)}${clearApiKeyOption("global.clearApiKey", config.global)}</div>
          <div class="field"><label>模型名</label><input name="global.model" value="${escapeHtml(config.global.model)}" required placeholder="deepseek-v4-flash"></div>
          <div class="field">
            <label>温度（创造性）</label>
            <input name="global.temperature" type="number" min="0" max="2" step="0.01" value="${escapeHtml(config.global.temperature)}">
            <small class="field-help">控制模型回答的稳定程度：越低越稳定保守，越高越发散。客服、销售建议先用 0.2-0.6。</small>
          </div>
          <div class="field"><label>最大输出Token</label><input name="global.maxTokens" type="number" min="256" max="200000" step="1" value="${escapeHtml(config.global.maxTokens)}"></div>
        </div>
        <div class="model-test-result">
          ${renderModelTestResult()}
        </div>
      </section>

      <section class="grid two">
        <article class="panel">
          <div class="panel-header">
            <div>
              <h2 class="panel-title">语音识别 ASR</h2>
              <p class="panel-subtitle">用于后续智能外呼录音转写、电话意图识别和质检。</p>
            </div>
          </div>
          <div class="form-grid compact-form">
            <div class="field"><label>供应商</label><input name="voice.asr.provider" value="${escapeHtml(config.voice.asr.provider)}" placeholder="例：OpenAI Whisper兼容 / 火山语音"></div>
            <div class="field"><label>API URL</label><input name="voice.asr.apiUrl" value="${escapeHtml(config.voice.asr.apiUrl)}" placeholder="https://..."></div>
            <div class="field"><label>API Key</label><input name="voice.asr.apiKey" type="password" value="" placeholder="${escapeHtml(apiKeyPlaceholder(config.voice.asr, "ASR API Key"))}">${apiKeyHelp(config.voice.asr)}${clearApiKeyOption("voice.asr.clearApiKey", config.voice.asr)}</div>
            <div class="field"><label>模型名</label><input name="voice.asr.model" value="${escapeHtml(config.voice.asr.model)}" placeholder="例：whisper-large / asr-model"></div>
            <div class="field"><label>语言</label><input name="voice.asr.language" value="${escapeHtml(config.voice.asr.language)}" placeholder="zh-CN"></div>
          </div>
        </article>

        <article class="panel">
          <div class="panel-header">
            <div>
              <h2 class="panel-title">语音合成 TTS</h2>
              <p class="panel-subtitle">用于后续外呼助手播报话术和语音客服回复。</p>
            </div>
          </div>
          <div class="form-grid compact-form">
            <div class="field"><label>供应商</label><input name="voice.tts.provider" value="${escapeHtml(config.voice.tts.provider)}" placeholder="例：OpenAI TTS兼容 / 火山语音"></div>
            <div class="field"><label>API URL</label><input name="voice.tts.apiUrl" value="${escapeHtml(config.voice.tts.apiUrl)}" placeholder="https://..."></div>
            <div class="field"><label>API Key</label><input name="voice.tts.apiKey" type="password" value="" placeholder="${escapeHtml(apiKeyPlaceholder(config.voice.tts, "TTS API Key"))}">${apiKeyHelp(config.voice.tts)}${clearApiKeyOption("voice.tts.clearApiKey", config.voice.tts)}</div>
            <div class="field"><label>模型名</label><input name="voice.tts.model" value="${escapeHtml(config.voice.tts.model)}" placeholder="例：tts-1 / voice-model"></div>
            <div class="field"><label>音色</label><input name="voice.tts.voice" value="${escapeHtml(config.voice.tts.voice)}" placeholder="默认"></div>
            <div class="field"><label>语速</label><input name="voice.tts.speed" type="number" min="0" max="2" step="0.01" value="${escapeHtml(config.voice.tts.speed)}"></div>
          </div>
        </article>
      </section>

      <section class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">Agent独立LLM配置</h2>
            <p class="panel-subtitle">只需要填写要覆盖的Agent；完全留空时继承全局LLM。可只覆盖模型名，也可覆盖API URL/API Key。</p>
          </div>
        </div>
        <div class="model-grid">
          ${modelAgentDefinitions.map((definition) => {
            const override = config.agents[definition.key] || {};
            const effective = effectiveModelFor(definition.key);
            return `
              <article class="model-card">
                <div class="model-card-head">
                  <div>
                    <strong>${escapeHtml(definition.agentName)}</strong>
                    <div class="muted">${escapeHtml(definition.scene)}</div>
                  </div>
                  <span class="status-pill">${escapeHtml(effective.source)}</span>
                </div>
                <div class="model-effective">
                  <span>${escapeHtml(effective.provider)} / ${escapeHtml(effective.model)}</span>
                  <small>${escapeHtml(effective.apiUrl)} · Key${effective.apiKeyConfigured ? "已配置" : "未配置"} · 温度 ${escapeHtml(effective.temperature)} · 最大输出 ${escapeHtml(effective.maxTokens)}</small>
                </div>
                <div class="form-grid compact-form">
                  <div class="field"><label>覆盖供应商</label><input name="agents.${definition.key}.provider" value="${escapeHtml(override.provider || "")}" placeholder="留空跟随全局"></div>
                  <div class="field"><label>覆盖API URL</label><input name="agents.${definition.key}.apiUrl" value="${escapeHtml(override.apiUrl || "")}" placeholder="${escapeHtml(config.global.apiUrl)}"></div>
                  <div class="field"><label>覆盖API Key</label><input name="agents.${definition.key}.apiKey" type="password" value="" placeholder="${escapeHtml(agentApiKeyPlaceholder(override, config))}">${agentApiKeyHelp(override, config)}${clearApiKeyOption(`agents.${definition.key}.clearApiKey`, override)}</div>
                  <div class="field"><label>覆盖模型名</label><input name="agents.${definition.key}.model" value="${escapeHtml(override.model || "")}" placeholder="${escapeHtml(config.global.model)}"></div>
                  <div class="field">
                    <label>覆盖温度（创造性）</label>
                    <input name="agents.${definition.key}.temperature" type="number" min="0" max="2" step="0.01" value="${escapeHtml(override.temperature ?? "")}" placeholder="${escapeHtml(config.global.temperature)}">
                    <small class="field-help">留空跟随全局；销售承接可略高，风控/分流建议偏低。</small>
                  </div>
                  <div class="field"><label>覆盖Token</label><input name="agents.${definition.key}.maxTokens" type="number" min="256" max="200000" step="1" value="${escapeHtml(override.maxTokens ?? "")}" placeholder="${escapeHtml(config.global.maxTokens)}"></div>
                </div>
              </article>
            `;
          }).join("")}
        </div>
      </section>
    </form>

    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">当前生效结果</h2>
          <p class="panel-subtitle">这里展示每个Agent最终生效的LLM连接。测试连接和Agent真实LLM增强会按这里的配置调用模型。</p>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Agent</th><th>来源</th><th>供应商</th><th>API URL</th><th>模型名</th><th>Key</th><th>温度</th><th>最大输出</th></tr></thead>
          <tbody>
            ${effectiveModels.map((item) => `
              <tr>
                <td><strong>${escapeHtml(item.agentName)}</strong><br><span class="muted">${escapeHtml(item.scene)}</span></td>
                <td><span class="status-pill">${escapeHtml(item.source)}</span></td>
                <td>${escapeHtml(item.provider)}</td>
                <td>${escapeHtml(item.apiUrl)}</td>
                <td>${escapeHtml(item.model)}</td>
                <td>${item.apiKeyConfigured ? "已配置" : "未配置"}</td>
                <td>${escapeHtml(item.temperature)}</td>
                <td>${escapeHtml(item.maxTokens)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function wecomConfigPayload(form) {
  const data = formData(form);
  const currentConfig = normalizeWecomConfigState(state.wecomConfig);
  const currentRoute = wecomPrimaryRoute();
  const route = {
    id: data["route.id"] || currentRoute.id,
    name: data["route.name"] || currentRoute.name,
    channel: data["route.channel"] || currentRoute.channel,
    msgtype: data["route.msgtype"] || currentRoute.msgtype,
    enabled: Boolean(data["route.enabled"]),
    webhookUrl: data["route.webhookUrl"] || ""
  };
  if (data["route.clearWebhook"]) route.clearWebhook = true;
  const inbound = {
    enabled: Boolean(data["inbound.enabled"]),
    defaultChannel: data["inbound.defaultChannel"] || currentConfig.inbound.defaultChannel,
    secret: data["inbound.secret"] || ""
  };
  if (data["inbound.clearSecret"]) inbound.clearSecret = true;
  const aibot = {
    enabled: Boolean(data["aibot.enabled"]),
    botId: data["aibot.botId"] || "",
    secret: data["aibot.secret"] || "",
    wsUrl: data["aibot.wsUrl"] || currentConfig.aibot.wsUrl || "",
    defaultCustomerId: data["aibot.defaultCustomerId"] || currentConfig.aibot.defaultCustomerId || "",
    defaultChannel: data["aibot.defaultChannel"] || currentConfig.aibot.defaultChannel || "VIP群",
    autoReply: Boolean(data["aibot.autoReply"]),
    welcomeText: data["aibot.welcomeText"] || currentConfig.aibot.welcomeText,
    heartbeatInterval: data["aibot.heartbeatInterval"] || currentConfig.aibot.heartbeatInterval,
    maxReconnectAttempts: data["aibot.maxReconnectAttempts"] || currentConfig.aibot.maxReconnectAttempts
  };
  if (data["aibot.clearBotId"]) aibot.clearBotId = true;
  if (data["aibot.clearSecret"]) aibot.clearSecret = true;
  const archive = {
    enabled: Boolean(data["archive.enabled"]),
    provider: data["archive.provider"] || currentConfig.archive.provider,
    corpId: data["archive.corpId"] || currentConfig.archive.corpId || "",
    archiveSecret: data["archive.archiveSecret"] || "",
    privateKey: data["archive.privateKey"] || "",
    privateKeyVersion: data["archive.privateKeyVersion"] || currentConfig.archive.privateKeyVersion || "",
    cursor: data["archive.cursor"] || currentConfig.archive.cursor || "",
    seq: data["archive.seq"] || currentConfig.archive.seq || 0,
    pollIntervalSeconds: data["archive.pollIntervalSeconds"] || currentConfig.archive.pollIntervalSeconds || 10,
    limit: data["archive.limit"] || currentConfig.archive.limit || 100,
    gatewayMode: data["archive.gatewayMode"] || currentConfig.archive.gatewayMode || "sidecar",
    sidecarUrl: data["archive.sidecarUrl"] || currentConfig.archive.sidecarUrl || "",
    trustedStatus: currentConfig.archive.trustedStatus || "未验证",
    defaultCustomerId: data["archive.defaultCustomerId"] || currentConfig.archive.defaultCustomerId || state.selectedCustomerId || "",
    defaultChannel: data["archive.defaultChannel"] || currentConfig.archive.defaultChannel || "VIP群"
  };
  if (data["archive.clearArchiveSecret"]) archive.clearArchiveSecret = true;
  if (data["archive.clearPrivateKey"]) archive.clearPrivateKey = true;
  return {
    enabled: Boolean(data.enabled),
    sendMode: data.sendMode || "manualApproval",
    defaultRouteId: route.id,
    routes: [route],
    inbound,
    aibot,
    archive
  };
}

function wecomWebhookPlaceholder(route = {}) {
  if (route.webhookConfigured) return `已配置：${route.webhookMasked || "********"}，留空保持不变`;
  return "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...";
}

function wecomSecretPlaceholder(inbound = {}) {
  if (inbound.secretConfigured) return `已配置：${inbound.secretMasked || "********"}，留空保持不变`;
  return "可选，用于模拟入站校验";
}

function wecomAibotCredentialPlaceholder(config = {}, field = "botId") {
  const configured = field === "botId" ? config.botIdConfigured : config.secretConfigured;
  const masked = field === "botId" ? config.botIdMasked : config.secretMasked;
  if (configured) return `已配置：${masked || "********"}，留空保持不变`;
  return field === "botId" ? "企业微信智能机器人 Bot ID" : "企业微信智能机器人 Secret";
}

function wecomArchiveCredentialPlaceholder(config = {}, field = "archiveSecret") {
  const configured = field === "privateKey" ? config.privateKeyConfigured : config.archiveSecretConfigured;
  const masked = field === "privateKey" ? config.privateKeyMasked : config.archiveSecretMasked;
  if (configured) return `已配置：${masked || "********"}，留空保持不变`;
  return field === "privateKey" ? "会话存档RSA私钥" : "会话存档Secret";
}

function personalWechatConfigPayload(form) {
  const data = formData(form);
  return {
    enabled: Boolean(data.enabled),
    gateway: {
      mode: data["gateway.mode"] || defaultPersonalWechatState.gateway.mode,
      sidecarUrl: data["gateway.sidecarUrl"] || "",
      sendEndpoint: data["gateway.sendEndpoint"] || defaultPersonalWechatState.gateway.sendEndpoint,
      receiveEndpoint: data["gateway.receiveEndpoint"] || defaultPersonalWechatState.gateway.receiveEndpoint,
      ackEndpoint: data["gateway.ackEndpoint"] || defaultPersonalWechatState.gateway.ackEndpoint
    },
    account: {
      id: data["account.id"] || defaultPersonalWechatState.account.id,
      name: data["account.name"] || defaultPersonalWechatState.account.name,
      displayName: data["account.displayName"] || defaultPersonalWechatState.account.displayName,
      defaultCustomerId: data["account.defaultCustomerId"] || state.selectedCustomerId || "",
      autoReply: Boolean(data["account.autoReply"]),
      requireApprovalForRisk: Boolean(data["account.requireApprovalForRisk"]),
      minSendIntervalSeconds: Number(data["account.minSendIntervalSeconds"] || defaultPersonalWechatState.account.minSendIntervalSeconds),
      concurrency: Number(data["account.concurrency"] || defaultPersonalWechatState.account.concurrency),
      maxSendsPerMinute: Number(data["account.maxSendsPerMinute"] || defaultPersonalWechatState.account.maxSendsPerMinute),
      maxQueueAgeSeconds: Number(data["account.maxQueueAgeSeconds"] || defaultPersonalWechatState.account.maxQueueAgeSeconds),
      failureBackoffSeconds: Number(data["account.failureBackoffSeconds"] || defaultPersonalWechatState.account.failureBackoffSeconds),
      mergeWindowSeconds: Number(data["account.mergeWindowSeconds"] || defaultPersonalWechatState.account.mergeWindowSeconds)
    }
  };
}

function personalWechatJobLabel(status = "") {
  const labels = {
    queued: "待自动发送",
    sending: "发送中",
    sent: "已提交待回读",
    sent_pending_confirm: "已提交待回读",
    confirmed: "已确认",
    failed: "失败",
    cancelled: "已取消",
    manual_required: "需人工确认"
  };
  return labels[status] || status || "未知";
}

function personalWechatJobClass(status = "") {
  if (status === "confirmed") return "success-card";
  if (status === "manual_required") return "warning-card";
  if (status === "failed" || status === "cancelled") return "warning-card";
  return "";
}

function renderPersonalWechatJob(job) {
  const canApprove = job.status === "manual_required";
  const canConfirm = ["sent", "sent_pending_confirm", "sending"].includes(job.status);
  const canFail = ["queued", "sent", "sent_pending_confirm", "sending"].includes(job.status);
  return `
    <div class="business-card ${personalWechatJobClass(job.status)}">
      <div class="agent-customer-head">
        <div>
          <strong>${escapeHtml(job.roomName || job.roomId || "未命名外部群")}</strong>
          <span>${escapeHtml(job.jobId)} · ${escapeHtml(job.reason || "AccountAgent发送队列")}</span>
        </div>
        <span class="status-pill">${escapeHtml(personalWechatJobLabel(job.status))}</span>
      </div>
      <p class="event-text">${escapeHtml(job.replyText || "无回复内容")}</p>
      ${job.error ? `<p class="event-text">队列提示：${escapeHtml(job.error)}</p>` : ""}
      <div class="tag-list">
        <span class="tag">${job.riskLevel === "high" ? "高风险" : "低风险"}</span>
        <span class="tag">账号 ${escapeHtml(job.accountId || "")}</span>
        <span class="tag">来源 ${escapeHtml(job.source || "personal-wechat")}</span>
        ${(job.triggerMessageIds || []).length ? `<span class="tag">触发 ${(job.triggerMessageIds || []).length} 条</span>` : ""}
        ${job.attempts ? `<span class="tag">尝试 ${escapeHtml(job.attempts)}</span>` : ""}
        ${job.createdAt ? `<span class="tag">创建 ${escapeHtml(formatDateTime(job.createdAt))}</span>` : ""}
        ${job.approvedAt ? `<span class="tag">放行 ${escapeHtml(formatDateTime(job.approvedAt))}</span>` : ""}
        ${job.gatewayMode ? `<span class="tag">网关 ${escapeHtml(job.gatewayMode)}</span>` : ""}
        <span class="tag">${job.gatewayMode === "sidecar" ? "真实出站待回读" : "Mock/未真实外发"}</span>
        ${job.gatewayRequestId ? `<span class="tag">请求 ${escapeHtml(job.gatewayRequestId)}</span>` : ""}
        ${job.sentAt ? `<span class="tag">已发 ${escapeHtml(formatDateTime(job.sentAt))}</span>` : ""}
        ${job.confirmedAt ? `<span class="tag">确认 ${escapeHtml(formatDateTime(job.confirmedAt))}</span>` : ""}
      </div>
      <div class="button-row">
        ${canApprove ? `<button class="small-button" type="button" data-personal-wechat-approve-job="${escapeHtml(job.jobId)}" ${actionAttrs(`pwx-approve-${job.jobId}`)}>人工放行</button>` : ""}
        ${canConfirm ? `<button class="small-button" type="button" data-personal-wechat-confirm-job="${escapeHtml(job.jobId)}" ${actionAttrs(`pwx-confirm-${job.jobId}`)}>回读确认</button>` : ""}
        ${canFail ? `<button class="ghost-button" type="button" data-personal-wechat-fail-job="${escapeHtml(job.jobId)}" ${actionAttrs(`pwx-fail-${job.jobId}`)}>标记失败</button>` : ""}
      </div>
    </div>
  `;
}

function renderPersonalWechatContext(context) {
  const lastMessage = (context.messages || []).at(-1);
  return `
    <div class="business-card">
      <div class="agent-customer-head">
        <div>
          <strong>${escapeHtml(context.roomName || context.roomId)}</strong>
          <span>${escapeHtml(context.roomId)} · ${escapeHtml(customerName(context.customerId))}</span>
        </div>
        <span class="status-pill">${escapeHtml(context.pendingSendJobId ? "有待发" : "空闲")}</span>
      </div>
      ${lastMessage ? `<p class="event-text">${escapeHtml(lastMessage.senderName)}：${escapeHtml(lastMessage.text)}</p>` : ""}
      <div class="tag-list">
        <span class="tag">消息 ${escapeHtml(context.messageCount || 0)} 条</span>
        ${context.lastMessageAt ? `<span class="tag">最近 ${escapeHtml(formatDateTime(context.lastMessageAt))}</span>` : ""}
        ${context.lastReplyAt ? `<span class="tag">回复 ${escapeHtml(formatDateTime(context.lastReplyAt))}</span>` : ""}
      </div>
    </div>
  `;
}

function renderWecomLog(log) {
  const className = log.status === "成功" ? "success-card" : "warning-card";
  return `
    <div class="business-card ${className}">
      <div class="agent-customer-head">
        <div>
          <strong>${escapeHtml(log.type || "企微记录")} · ${escapeHtml(log.status || "未知")}</strong>
          <span>${escapeHtml(log.routeName || log.channel || "企微")} ${log.customerName ? `· ${escapeHtml(log.customerName)}` : ""}</span>
        </div>
        <span class="status-pill">${escapeHtml(formatDateTime(log.createdAt))}</span>
      </div>
      ${log.contentPreview ? `<p class="event-text">${escapeHtml(log.contentPreview)}</p>` : ""}
      ${log.error ? `<p class="event-text">失败原因：${escapeHtml(log.error)}</p>` : ""}
      <div class="tag-list">
        <span class="tag">${log.externalSideEffects ? "已触发企微外部发送" : "未触发外部发送"}</span>
        ${log.source ? `<span class="tag">${escapeHtml(log.source)}</span>` : ""}
        ${log.chatId ? `<span class="tag">chatid ${escapeHtml(log.chatId)}</span>` : ""}
        ${log.externalMessageId ? `<span class="tag">msg ${escapeHtml(log.externalMessageId)}</span>` : ""}
        ${log.deduped ? `<span class="tag">已去重</span>` : ""}
        ${log.latencyMs ? `<span class="tag">${escapeHtml(log.latencyMs)}ms</span>` : ""}
        ${log.draftId ? `<span class="tag">草稿 ${escapeHtml(log.draftId)}</span>` : ""}
      </div>
    </div>
  `;
}

function sendableWecomDrafts() {
  return sortedDrafts().filter((draft) => draft.status === "已确认" && ["VIP群", "企微私聊", "人工触达"].includes(draft.channel));
}

function renderIntegrationCard({ title, subtitle, status, tone = "", body = "", tags = [], action = "" }) {
  const className = tone === "success" ? "success-card" : tone === "warning" ? "warning-card" : "";
  return `
    <article class="integration-card ${className}">
      <div class="agent-customer-head">
        <div>
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(subtitle || "")}</span>
        </div>
        <span class="status-pill">${escapeHtml(status || "待配置")}</span>
      </div>
      ${body ? `<p class="event-text">${escapeHtml(body)}</p>` : ""}
      <div class="tag-list">
        ${tags.filter(Boolean).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
      </div>
      ${action ? `<div class="button-row">${action}</div>` : ""}
    </article>
  `;
}

function personalWechatLoginGuide(gateway = {}, enabled = true) {
  const mode = gateway.mode || "mock";
  const hasSidecarUrl = Boolean(gateway.sidecarUrl);
  const hasQr = Boolean(gateway.loginQrCodeUrl || gateway.loginQrCodeText);
  const loggedIn = /已登录|online|logged/i.test(gateway.loginStatus || "");
  const sidecarMode = mode === "sidecar";
  const endpointReady = Boolean(gateway.sendEndpoint && gateway.receiveEndpoint && gateway.ackEndpoint);
  const healthReady = sidecarMode && hasSidecarUrl && endpointReady;
  const receiveReady = healthReady && gateway.canReceive === true;
  const sendReady = healthReady && gateway.canSend === true;
  const steps = [
    {
      title: "1. 启动个人微信连接器",
      ok: enabled && sidecarMode && hasSidecarUrl && endpointReady,
      detail: sidecarMode
        ? hasSidecarUrl
          ? "连接器地址和端点已填写，可以检查 /health。"
          : "还没有填写个人微信连接器URL，当前无法进入扫码登录。"
        : "当前是Mock本地演练模式，不能登录真实微信。"
    },
    {
      title: "2. 扫码登录个人微信",
      ok: loggedIn,
      pending: healthReady && hasQr && !loggedIn,
      detail: loggedIn
        ? `登录态：${gateway.loginStatus}`
        : hasQr
          ? "连接器已返回二维码，请用测试微信扫码后重新检查。"
          : healthReady
            ? "连接器可检查，但暂未返回二维码；需要连接器 /health 提供 loginQrCodeUrl 或 loginQrCodeText。"
            : "等待连接器配置完成后再获取二维码。"
    },
    {
      title: "3. 开启收发能力",
      ok: receiveReady && sendReady,
      pending: receiveReady || sendReady,
      detail: receiveReady && sendReady
        ? "已声明 canReceive=true 和 canSend=true，可以做真实接收与出站联调。"
        : receiveReady
          ? "已可读取消息，但未声明 canSend=true，回复不会真实外发。"
          : sendReady
            ? "已可发送，但未声明 canReceive=true，无法验证真实入站和回读。"
            : "连接器 /health 还未声明 canReceive=true 或 canSend=true。"
    }
  ];
  return `
    <div class="login-guide">
      ${steps.map((step) => `
        <div class="login-step ${step.ok ? "step-ok" : step.pending ? "step-pending" : ""}">
          <strong>${escapeHtml(step.title)}</strong>
          <span>${escapeHtml(step.ok ? "完成" : step.pending ? "待处理" : "未就绪")}</span>
          <p>${escapeHtml(step.detail)}</p>
        </div>
      `).join("")}
    </div>
  `;
}

function personalWechatConnectionNotice(gateway = {}, enabled = true) {
  const mode = gateway.mode || "mock";
  const realMode = mode === "sidecar";
  const hasUrl = Boolean(gateway.sidecarUrl);
  const hasQr = Boolean(gateway.loginQrCodeUrl || gateway.loginQrCodeText);
  const canReceive = realMode && gateway.canReceive === true;
  const canSend = realMode && gateway.canSend === true;
  const loggedIn = /已登录|online|logged/i.test(gateway.loginStatus || "");
  const status = !enabled
    ? "个人微信托管已停用"
    : !realMode
      ? "未接入真实个人微信"
      : !hasUrl
        ? "等待填写连接器地址"
        : hasQr && !loggedIn
          ? "等待扫码登录"
          : loggedIn && (canReceive || canSend)
            ? "真实连接器可用"
            : "连接器未就绪";
  const detail = !enabled
    ? "先启用个人微信托管账号。"
    : !realMode
      ? "当前是Mock本地演练，只能测试队列和Agent，不能登录微信。要登录测试微信，请切换为“真实连接器接入”。"
      : !hasUrl
        ? "请填写个人微信连接器URL。连接器是一个单独运行的微信协议服务，负责扫码、收消息、发消息和自回显监听。"
        : hasQr && !loggedIn
          ? "二维码已经由连接器返回，请在下方二维码区域扫码。"
          : loggedIn && (canReceive || canSend)
            ? "可以运行个人微信Gateway脚本拉取消息或处理发送队列。"
            : "连接器已配置但还没声明收发能力，检查 /health 返回值里的 canReceive/canSend。";
  return { status, detail };
}

function renderWecom() {
  const config = normalizeWecomConfigState(state.wecomConfig);
  const aibot = config.aibot;
  const archive = config.archive;
  const route = wecomPrimaryRoute();
  const bindings = Array.isArray(state.wecomBindings?.groups) ? state.wecomBindings.groups : [];
  const logs = state.wecomLogs || [];
  const readyRoutes = wecomRoutes().filter((item) => item.enabled && item.webhookConfigured);
  const sentLogs = logs.filter((log) => log.status === "成功" && log.externalSideEffects);
  const failedLogs = logs.filter((log) => log.status === "失败");
  const drafts = sendableWecomDrafts();
  const routeOptions = wecomRouteOptions(route.id);
  const aibotReady = aibot.enabled && aibot.botIdConfigured && aibot.secretConfigured;
  const archiveReady = archive.enabled;
  const boundGroups = bindings.filter((binding) => binding.status === "已绑定");
  const pendingGroups = bindings.filter((binding) => binding.status !== "已绑定");
  const defaultAibotCustomer = state.customers.find((customer) => customer.id === aibot.defaultCustomerId) || selectedCustomer();
  const defaultArchiveCustomer = state.customers.find((customer) => customer.id === archive.defaultCustomerId) || selectedCustomer();
  const personalWechat = normalizePersonalWechatState(state.personalWechat);
  const personalAccount = personalWechat.account;
  const personalJobs = personalWechat.sendJobs || [];
  const personalContexts = personalWechat.groupContexts || [];
  const personalGateway = personalWechat.gateway || defaultPersonalWechatState.gateway;
  const personalQueuedJobs = personalJobs.filter((job) => job.status === "queued");
  const personalSendingJobs = personalJobs.filter((job) => job.status === "sending");
  const personalSentJobs = personalJobs.filter((job) => ["sent", "sent_pending_confirm"].includes(job.status));
  const personalManualJobs = personalJobs.filter((job) => job.status === "manual_required");
  const personalConfirmedJobs = personalJobs.filter((job) => job.status === "confirmed");
  const personalFailedJobs = personalJobs.filter((job) => job.status === "failed");
  const personalDefaultCustomer = state.customers.find((customer) => customer.id === personalAccount.defaultCustomerId) || selectedCustomer();
  const archiveConfigured = archive.enabled && archive.gatewayMode === "sidecar" && archive.sidecarUrl && archive.corpId && archive.archiveSecretConfigured && archive.privateKeyConfigured;
  const routeReady = config.enabled && readyRoutes.length > 0;
  const personalGatewayConfigured = personalGateway.mode === "sidecar" && personalGateway.sidecarUrl && personalGateway.sendEndpoint;
  const personalGatewayCanSend = personalGatewayConfigured && personalGateway.canSend === true;
  const personalGatewayCanReceive = personalGatewayConfigured && personalGateway.canReceive === true;
  const personalConnection = personalWechatConnectionNotice(personalGateway, personalWechat.enabled);
  const normalizedBindingSearch = wecomBindingSearchQuery.trim().toLowerCase();
  const filteredBindings = bindings.filter((binding) => {
    if (!normalizedBindingSearch) return true;
    const haystack = [
      binding.chatName,
      binding.chatId,
      binding.source,
      binding.status,
      binding.channel,
      customerName(binding.customerId)
    ].join(" ").toLowerCase();
    return haystack.includes(normalizedBindingSearch);
  });
  const wecomLogTypes = ["全部", ...new Set(logs.map((log) => log.type).filter(Boolean))];
  const filteredWecomLogs = logs.filter((log) => wecomLogTypeFilter === "全部" || log.type === wecomLogTypeFilter);
  return `
    <section class="grid four">
      ${cardKpi("会话存档", archive.status || (archiveReady ? "已启用" : "未启用"), archiveReady ? "外部群主读取入口" : "等待配置")}
      ${cardKpi("群聊归档", boundGroups.length, `待绑定 ${pendingGroups.length} 个`)}
      ${cardKpi("发送待确认", personalQueuedJobs.length + personalSendingJobs.length + personalSentJobs.length, `人工 ${personalManualJobs.length} 条`)}
      ${cardKpi("失败记录", failedLogs.length + personalFailedJobs.length, "配置、Webhook或Gateway错误")}
    </section>

    <section class="panel warning-panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">企微接入方式</h2>
          <p class="panel-subtitle">生产主读取入口是企微会话内容存档；智能机器人长连接保留为测试/辅助读取；测试群Webhook只用于发送测试消息和已确认草稿，不能读取群聊。</p>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">接入总控</h2>
          <p class="panel-subtitle">先看这里判断企微/个微当前能做什么：读取、归档、测试发送、个微出站是否具备运行条件。</p>
        </div>
      </div>
      <div class="integration-grid">
        ${renderIntegrationCard({
          title: "企微会话存档",
          subtitle: "生产外部群主读取入口",
          status: archiveConfigured ? archive.trustedStatus || "配置可检查" : "配置未完成",
          tone: archiveConfigured ? "success" : "warning",
          body: archiveConfigured ? "配置已满足Sidecar拉取条件，可检查Sidecar /health；真实消息由Gateway写入标准入站。" : "需要启用存档入口，并补齐CorpID、Secret、RSA私钥和Sidecar URL。",
          tags: [
            archive.enabled ? "已启用" : "未启用",
            `模式 ${archive.gatewayMode || "sidecar"}`,
            archive.sidecarUrl ? "Sidecar URL已填" : "缺Sidecar URL",
            archive.archiveSecretConfigured ? "Secret已保存" : "缺Secret",
            archive.privateKeyConfigured ? "私钥已保存" : "缺私钥",
            archive.cursor ? `游标 ${archive.cursor}` : "无游标"
          ],
          action: `<button class="small-button" id="checkWecomArchiveSidecar" type="button" ${actionAttrs("wecom-archive-check")} ${archive.enabled ? "" : "disabled"}>检查存档Sidecar</button>`
        })}
        ${renderIntegrationCard({
          title: "企微智能机器人",
          subtitle: "测试/辅助读取入口",
          status: aibotReady ? aibot.bridgeStatus || "凭据已配置" : "凭据未完成",
          tone: aibotReady ? "success" : "warning",
          body: aibotReady ? "Bot ID 和 Secret 已保存，可运行长连接bridge读取机器人可见消息。" : "保存Bot ID和Secret后，再运行 npm run wecom:bridge。",
          tags: [
            aibot.enabled ? "已启用" : "未启用",
            aibot.botIdConfigured ? "Bot ID已保存" : "缺Bot ID",
            aibot.secretConfigured ? "Secret已保存" : "缺Secret",
            aibot.autoReply ? "自动回复开启" : "只读分流"
          ],
          action: `<button class="small-button" id="checkWecomAibotTop" type="button" ${actionAttrs("wecom-aibot-check-top")}>检查机器人配置</button>`
        })}
        ${renderIntegrationCard({
          title: "企微测试群发送",
          subtitle: "Webhook只负责发送测试消息",
          status: routeReady ? "可发送测试群" : "发送未配置",
          tone: routeReady ? "success" : "warning",
          body: routeReady ? "已确认草稿和测试消息可发送到测试群机器人；这不是群消息读取链路。" : "需要启用企微连接、启用路由并保存Webhook。",
          tags: [
            config.enabled ? "连接器已启用" : "连接器未启用",
            `${readyRoutes.length} 个可用路由`,
            `模式 ${config.sendMode}`,
            drafts.length ? `${drafts.length} 条可发送草稿` : "无已确认草稿"
          ],
          action: `<button class="small-button" type="button" data-jump-wecom-section="wecom-send-test">查看发送测试</button>`
        })}
        ${renderIntegrationCard({
          title: "个人微信连接器",
          subtitle: "登录、接收、发送和回读确认出口",
          status: personalConnection.status,
          tone: personalGatewayCanSend || personalGatewayCanReceive ? "success" : "warning",
          body: personalConnection.detail,
          tags: [
            personalWechat.enabled ? "已启用" : "已停用",
            `模式 ${personalGateway.mode || "mock"}`,
            personalGateway.sidecarUrl ? "连接器URL已填" : "无连接器URL",
            personalGateway.canSend ? "canSend=true" : "canSend=false",
            personalGateway.canReceive ? "canReceive=true" : "canReceive=false",
            `登录 ${personalGateway.loginStatus || "未连接"}`,
            `发送模式 ${personalGateway.sendMode || "proactive"}`,
            personalGateway.supportsConfirm ? "支持回读确认" : "未声明回读",
            `待发 ${personalQueuedJobs.length}`,
            `发送中 ${personalSendingJobs.length}`,
            `待回读 ${personalSentJobs.length}`,
            `人工 ${personalManualJobs.length}`
          ],
          action: `<button class="small-button" id="checkPersonalWechatGateway" type="button" ${actionAttrs("personal-wechat-gateway-check")}>检查个人微信连接器</button>`
        })}
      </div>
    </section>

    <section class="panel ${personalGatewayCanSend || personalGatewayCanReceive ? "success-card" : "warning-panel"}" id="personal-wechat-connector">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">连接个人微信</h2>
          <p class="panel-subtitle">这里才是真实个人微信接入入口。要登录测试微信，必须先启动一个“个人微信连接器”程序；系统会从连接器获取二维码并展示在下方。</p>
        </div>
        <button class="small-button" id="checkPersonalWechatGatewayInline" type="button" ${actionAttrs("personal-wechat-gateway-check-inline")}>检查连接器</button>
      </div>
      <div class="connector-status-grid">
        <div><span>当前状态</span><strong>${escapeHtml(personalConnection.status)}</strong></div>
        <div><span>登录位置</span><strong>${personalGateway.loginQrCodeUrl || personalGateway.loginQrCodeText ? "下方二维码区域" : "等待连接器返回二维码"}</strong></div>
        <div><span>连接器地址</span><strong>${escapeHtml(personalGateway.sidecarUrl || "未填写")}</strong></div>
        <div><span>真实收发</span><strong>${personalGatewayCanReceive || personalGatewayCanSend ? "部分就绪" : "未就绪"}</strong></div>
      </div>
      <p class="panel-subtitle">${escapeHtml(personalConnection.detail)}</p>
    </section>

    <section class="grid four">
      ${cardKpi("个人微信账号", personalAccount.status || "未连接", personalWechat.enabled ? "单账号单Agent" : "已停用")}
      ${cardKpi("外部群上下文", personalContexts.length, "按roomId隔离")}
      ${cardKpi("待发送队列", personalQueuedJobs.length, `发送中 ${personalSendingJobs.length}，待回读 ${personalSentJobs.length}`)}
      ${cardKpi("已确认回显", personalConfirmedJobs.length, "自回显/存档回读确认")}
    </section>

    <form id="personalWechatConfigForm">
    <section class="grid two">
      <article class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">个人微信连接器与AccountAgent</h2>
            <p class="panel-subtitle">真实登录、读取、发送和回读确认都通过个人微信连接器接入；Mock只做本地演练，不代表真实发回群。</p>
          </div>
        </div>
        <div class="form-grid compact-form">
          <label class="inline-check full-span">
            <input name="enabled" type="checkbox" value="true" ${personalWechat.enabled ? "checked" : ""}>
            <span>启用个人微信托管账号</span>
          </label>
          <div class="field"><label>账号ID</label><input name="account.id" value="${escapeHtml(personalAccount.id)}"></div>
          <div class="field"><label>账号名称</label><input name="account.name" value="${escapeHtml(personalAccount.name)}"></div>
          <div class="field"><label>群内显示名</label><input name="account.displayName" value="${escapeHtml(personalAccount.displayName)}"></div>
          <div class="field"><label>默认客户</label><select name="account.defaultCustomerId">${customerOptions(personalDefaultCustomer)}</select></div>
          <div class="field"><label>接入模式</label><select name="gateway.mode"><option value="mock" ${personalGateway.mode === "mock" ? "selected" : ""}>Mock本地演练</option><option value="sidecar" ${personalGateway.mode === "sidecar" ? "selected" : ""}>真实连接器接入</option><option value="disabled" ${personalGateway.mode === "disabled" ? "selected" : ""}>停用连接器</option></select></div>
          <div class="field"><label>连接器URL</label><input name="gateway.sidecarUrl" value="${escapeHtml(personalGateway.sidecarUrl || "")}" placeholder="http://127.0.0.1:8788"></div>
          <div class="field"><label>发送端点</label><input name="gateway.sendEndpoint" value="${escapeHtml(personalGateway.sendEndpoint || "/send")}"></div>
          <div class="field"><label>拉取端点</label><input name="gateway.receiveEndpoint" value="${escapeHtml(personalGateway.receiveEndpoint || "/messages")}"></div>
          <div class="field"><label>ACK端点</label><input name="gateway.ackEndpoint" value="${escapeHtml(personalGateway.ackEndpoint || "/ack")}"></div>
          <div class="field"><label>连接器状态</label><input value="${escapeHtml(personalGateway.status || "未配置")}" disabled></div>
          <div class="field"><label>发送能力</label><input value="${personalGateway.canSend ? "canSend=true，可交给真实连接器" : "canSend=false，不能真实发送"}" disabled></div>
          <div class="field"><label>接收能力</label><input value="${personalGateway.canReceive ? "canReceive=true，可读取消息" : "canReceive=false，不能真实读取"}" disabled></div>
          <div class="field"><label>登录状态</label><input value="${escapeHtml(personalGateway.loginStatus || "未连接")}" disabled></div>
          <div class="field"><label>扫码登录</label><input value="${personalGateway.loginQrCodeUrl || personalGateway.loginQrCodeText ? "连接器已返回二维码，请扫码登录" : "暂无二维码"}" disabled></div>
          <div class="field"><label>发送模式</label><input value="${escapeHtml(personalGateway.sendMode || "proactive")}" disabled></div>
          <div class="field"><label>ACK/回读/撤回</label><input value="${personalGateway.supportsAck ? "支持ACK" : "未声明ACK"} / ${personalGateway.supportsConfirm ? "支持回读" : "未声明回读"} / ${personalGateway.supportsRecall ? "支持撤回" : "未声明撤回"}" disabled></div>
          <label class="inline-check compact-check"><input name="account.autoReply" type="checkbox" value="true" ${personalAccount.autoReply ? "checked" : ""}><span>低风险自动排队</span></label>
          <label class="inline-check compact-check"><input name="account.requireApprovalForRisk" type="checkbox" value="true" ${personalAccount.requireApprovalForRisk ? "checked" : ""}><span>高风险人工确认</span></label>
          <div class="field"><label>最小发送间隔秒</label><input name="account.minSendIntervalSeconds" type="number" min="1" max="60" value="${escapeHtml(personalAccount.minSendIntervalSeconds)}"></div>
          <div class="field"><label>账号并发</label><input name="account.concurrency" type="number" min="1" max="3" value="${escapeHtml(personalAccount.concurrency)}"></div>
          <div class="field"><label>分钟发送上限</label><input name="account.maxSendsPerMinute" type="number" min="1" max="60" value="${escapeHtml(personalAccount.maxSendsPerMinute)}"></div>
          <div class="field"><label>队列过期秒</label><input name="account.maxQueueAgeSeconds" type="number" min="15" max="600" value="${escapeHtml(personalAccount.maxQueueAgeSeconds)}"></div>
          <div class="field"><label>失败退避秒</label><input name="account.failureBackoffSeconds" type="number" min="5" max="600" value="${escapeHtml(personalAccount.failureBackoffSeconds)}"></div>
          <div class="field"><label>连续消息合并秒</label><input name="account.mergeWindowSeconds" type="number" min="5" max="300" value="${escapeHtml(personalAccount.mergeWindowSeconds)}"></div>
          <button class="primary-button full-span" type="submit" ${actionAttrs("save-personal-wechat-config")}>保存个人微信连接配置</button>
        </div>
        <div class="info-box">
          <strong>真实个人微信登录条件</strong>
          <p>主系统不能直接登录微信；只有外部个人微信连接器运行并在 /health 返回登录二维码或已登录状态后，才能进入扫码测试。连接器就是单独负责微信扫码登录和收发消息的本地/服务器程序。</p>
          ${personalWechatLoginGuide(personalGateway, personalWechat.enabled)}
        </div>
        ${personalGateway.loginQrCodeUrl || personalGateway.loginQrCodeText ? `<div class="info-box qr-login-box">
          <strong>需要扫码登录个人微信</strong>
          <p>${personalGateway.loginQrCodeUrl ? `二维码链接：${escapeHtml(personalGateway.loginQrCodeUrl)}` : "连接器已返回二维码文本，请在连接器控制台或二维码工具中扫码。"}</p>
          ${personalGateway.loginQrCodeUrl ? `<img class="qr-preview" src="${escapeHtml(personalGateway.loginQrCodeUrl)}" alt="个人微信登录二维码">` : ""}
          ${personalGateway.loginQrCodeText ? `<textarea readonly>${escapeHtml(personalGateway.loginQrCodeText)}</textarea>` : ""}
          <p>扫码后点击“检查个人微信连接器”，确认登录态变成已登录，并且连接器声明 canReceive=true 或 canSend=true。</p>
        </div>` : ""}
      </article>

      <article class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">运行边界</h2>
            <p class="panel-subtitle">Mock模式只做本地验证；真实连接器模式会等待外部网关回调，回调前不会标记真实已发送。</p>
          </div>
        </div>
        <div class="event-list">
          <div class="business-card ${personalWechat.enabled ? "success-card" : "warning-card"}">
            <div class="agent-customer-head">
              <div>
                <strong>${escapeHtml(personalAccount.name)}</strong>
                <span>${escapeHtml(personalAccount.displayName)} · ${escapeHtml(personalAccount.id)}</span>
              </div>
              <span class="status-pill">${personalAccount.autoReply ? "低风险自动" : "全部人工确认"}</span>
            </div>
            <p class="event-text">发消息由SendScheduler受控调度：同群FIFO、账号限频、超过队列时效重判；只有个人微信连接器声明canSend=true时才会真实外发。</p>
            <div class="tag-list">
              <span class="tag">连接器 ${escapeHtml(personalGateway.mode)}</span>
              ${personalGateway.sidecarUrl ? `<span class="tag">${escapeHtml(personalGateway.sidecarUrl)}${escapeHtml(personalGateway.sendEndpoint || "/send")}</span>` : ""}
              <span class="tag">${escapeHtml(personalGateway.status || "未配置")}</span>
              <span class="tag">${personalGateway.canSend ? "可真实发送" : "不可真实发送"}</span>
              <span class="tag">${personalGateway.canReceive ? "可真实读取" : "不可真实读取"}</span>
              <span class="tag">登录 ${escapeHtml(personalGateway.loginStatus || "未连接")}</span>
              ${personalGateway.loginQrCodeUrl || personalGateway.loginQrCodeText ? `<span class="tag warning-tag">待扫码</span>` : ""}
              <span class="tag">模式 ${escapeHtml(personalGateway.sendMode || "proactive")}</span>
              <span class="tag">${personalGateway.supportsConfirm ? "支持回读" : "未声明回读"}</span>
              <span class="tag">${personalGateway.supportsAck ? "支持ACK" : "未声明ACK"}</span>
              ${personalGateway.cursor ? `<span class="tag">游标 ${escapeHtml(personalGateway.cursor)}</span>` : ""}
              <span class="tag">限频 ${escapeHtml(personalAccount.minSendIntervalSeconds)} 秒</span>
              <span class="tag">并发 ${escapeHtml(personalAccount.concurrency)}</span>
              <span class="tag">分钟 ${escapeHtml(personalAccount.maxSendsPerMinute)} 条</span>
              <span class="tag">过期 ${escapeHtml(personalAccount.maxQueueAgeSeconds)} 秒重判</span>
              <span class="tag">退避 ${escapeHtml(personalAccount.failureBackoffSeconds)} 秒</span>
              ${personalAccount.lastEventAt ? `<span class="tag">最近 ${escapeHtml(formatDateTime(personalAccount.lastEventAt))}</span>` : ""}
            </div>
          </div>
          ${personalAccount.lastError ? `<div class="business-card warning-card"><p class="event-text">最近错误：${escapeHtml(personalAccount.lastError)}</p></div>` : ""}
          ${personalGateway.lastError ? `<div class="business-card warning-card"><p class="event-text">Gateway错误：${escapeHtml(personalGateway.lastError)}</p></div>` : ""}
        </div>
      </article>
    </section>
    </form>

    <details class="advanced-debug-panel">
      <summary>高级调试：模拟入站工具</summary>
      <section class="grid two">
      <article class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">模拟个人微信外部群入站</h2>
            <p class="panel-subtitle">仅用于研发验证消息格式、上下文和回复队列，不代表真实个人微信接入。</p>
          </div>
        </div>
        <div class="form-grid compact-form">
          <div class="field"><label>绑定客户</label><select id="personalWechatInboundCustomer">${customerOptions(personalDefaultCustomer)}</select></div>
          <div class="field"><label>发送人类型</label><select id="personalWechatSenderType"><option value="customer">客户</option><option value="staff">员工</option><option value="bot">托管号</option><option value="unknown">未知</option></select></div>
          <div class="field"><label>外部群roomId</label><input id="personalWechatRoomId" value="${escapeHtml(`pwx_room_${state.selectedCustomerId || "default"}`)}"></div>
          <div class="field"><label>外部群名称</label><input id="personalWechatRoomName" value="${escapeHtml(`${selectedCustomer()?.name || "客户"}VIP外部群`)}"></div>
          <div class="field"><label>发送人</label><input id="personalWechatSenderName" value="${escapeHtml(selectedCustomer()?.contact || selectedCustomer()?.name || "客户")}"></div>
          <div class="field"><label>消息ID</label><input id="personalWechatMessageId" placeholder="留空自动生成"></div>
          <div class="field full-span"><label>消息内容</label><textarea id="personalWechatInboundText">收到，我把资料补一下，流程怎么走？</textarea></div>
          <button class="primary-button full-span" id="ingestPersonalWechatMessage" type="button" ${actionAttrs("personal-wechat-inbound")} ${state.customers.length ? "" : "disabled"}>写入个人微信入站</button>
        </div>
      </article>

      <article class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">模拟企微会话存档入站</h2>
            <p class="panel-subtitle">仅用于研发验证标准入站、去重和风控；真实读取请运行会话存档Sidecar。</p>
          </div>
        </div>
        <div class="form-grid compact-form">
          <div class="field"><label>绑定客户</label><select id="wecomArchiveInboundCustomer">${customerOptions(defaultArchiveCustomer)}</select></div>
          <div class="field"><label>发送人类型</label><select id="wecomArchiveSenderType"><option value="customer">客户</option><option value="staff">员工</option><option value="managed_account">托管号</option><option value="unknown">未知</option></select></div>
          <div class="field"><label>群roomId/chatId</label><input id="wecomArchiveRoomId" value="${escapeHtml(`archive_room_${state.selectedCustomerId || "default"}`)}"></div>
          <div class="field"><label>群名称</label><input id="wecomArchiveRoomName" value="${escapeHtml(`${selectedCustomer()?.name || "客户"}企微外部群`)}"></div>
          <div class="field"><label>发送人</label><input id="wecomArchiveSenderName" value="${escapeHtml(selectedCustomer()?.contact || selectedCustomer()?.name || "客户")}"></div>
          <div class="field"><label>存档msgid</label><input id="wecomArchiveMessageId" placeholder="留空自动生成"></div>
          <div class="field full-span"><label>消息内容</label><textarea id="wecomArchiveInboundText">今天售后进度和报价可以同步一下吗？</textarea></div>
          <button class="primary-button full-span" id="ingestWecomArchiveMessage" type="button" ${actionAttrs("wecom-archive-inbound")} ${archive.enabled && state.customers.length ? "" : "disabled"}>写入会话存档入站</button>
        </div>
      </article>
      </section>
    </details>

    <section class="grid two">
      <article class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">单账号发送队列</h2>
            <p class="panel-subtitle">低风险回复会自动排队，高风险回复停在人工确认；SendScheduler负责按账号并发和限流调度发送。</p>
          </div>
          <button class="small-button" id="runPersonalWechatScheduler" type="button" ${actionAttrs("personal-wechat-scheduler")} ${personalQueuedJobs.length ? "" : "disabled"}>运行发送调度</button>
        </div>
        ${personalWechat.schedulerResult ? `<div class="business-card success-card">
          <p class="event-text">最近调度：发送 ${escapeHtml(personalWechat.schedulerResult.dispatched?.length || 0)} 条，跳过 ${escapeHtml(personalWechat.schedulerResult.skipped?.length || 0)} 条，过期 ${escapeHtml(personalWechat.schedulerResult.expired?.length || 0)} 条。</p>
        </div>` : ""}
        <div class="event-list">
          ${personalJobs.slice(0, 8).map(renderPersonalWechatJob).join("") || renderEmptyState("暂无发送任务", "写入客户消息后，AccountAgent会按风险生成队列任务。")}
        </div>
      </article>
    </section>

    <section class="grid two">
      <article class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">个人微信群上下文</h2>
            <p class="panel-subtitle">每个外部群按roomId独立保存最近消息、客户绑定、最近回复和待发送任务。</p>
          </div>
        </div>
        <div class="event-list">
          ${personalContexts.slice(0, 6).map(renderPersonalWechatContext).join("") || renderEmptyState("暂无个人微信群上下文", "写入第一条个人微信外部群消息后会自动创建。")}
        </div>
      </article>

      <article class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">个人微信运行日志</h2>
            <p class="panel-subtitle">自动回复会记录触发消息、判断理由、回复内容、发送队列和确认结果。</p>
          </div>
        </div>
        <div class="event-list">
          ${(personalWechat.logs || []).slice(0, 6).map((log) => `
            <div class="business-card ${log.status === "成功" ? "success-card" : "warning-card"}">
              <div class="agent-customer-head">
                <div>
                  <strong>${escapeHtml(log.type || "个人微信记录")} · ${escapeHtml(log.status || "未知")}</strong>
                  <span>${escapeHtml(log.roomName || log.roomId || "个人微信外部群")}</span>
                </div>
                <span class="status-pill">${escapeHtml(formatDateTime(log.createdAt))}</span>
              </div>
              ${log.contentPreview ? `<p class="event-text">${escapeHtml(log.contentPreview)}</p>` : ""}
              <div class="tag-list">
                <span class="tag">${log.externalSideEffects ? "已触发外部发送" : "Mock/未触发外部发送"}</span>
                ${log.messageId ? `<span class="tag">msg ${escapeHtml(log.messageId)}</span>` : ""}
                ${log.sendJobId ? `<span class="tag">job ${escapeHtml(log.sendJobId)}</span>` : ""}
              </div>
            </div>
          `).join("") || renderEmptyState("暂无个人微信日志", "保存配置、写入消息或确认发送后会记录在这里。")}
        </div>
      </article>
    </section>

    <form id="wecomConfigForm">
    <section class="grid two">
      <article class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">企微会话内容存档</h2>
            <p class="panel-subtitle">生产外部群主读取入口。主服务保存配置、游标和审计；真实拉取、解密和客户同意校验由Sidecar完成。</p>
          </div>
        </div>
        <div class="form-grid compact-form">
          <label class="inline-check full-span">
            <input name="archive.enabled" type="checkbox" value="true" ${archive.enabled ? "checked" : ""}>
            <span>启用会话存档入站</span>
          </label>
          <div class="field"><label>存档服务</label><input name="archive.provider" value="${escapeHtml(archive.provider || "企微会话内容存档")}"></div>
          <div class="field"><label>企业ID CorpID</label><input name="archive.corpId" value="${escapeHtml(archive.corpId || "")}" placeholder="ww..."></div>
          <div class="field"><label>Secret</label><input name="archive.archiveSecret" type="password" value="" placeholder="${escapeHtml(wecomArchiveCredentialPlaceholder(archive, "archiveSecret"))}"></div>
          <div class="field"><label>私钥版本</label><input name="archive.privateKeyVersion" value="${escapeHtml(archive.privateKeyVersion || "")}" placeholder="公钥版本号"></div>
          <div class="field"><label>Gateway模式</label><select name="archive.gatewayMode"><option value="sidecar" ${archive.gatewayMode === "sidecar" ? "selected" : ""}>Sidecar拉取</option><option value="manual" ${archive.gatewayMode === "manual" ? "selected" : ""}>手动标准入站</option><option value="disabled" ${archive.gatewayMode === "disabled" ? "selected" : ""}>停用</option></select></div>
          <div class="field full-span"><label>Sidecar URL</label><input name="archive.sidecarUrl" value="${escapeHtml(archive.sidecarUrl || "")}" placeholder="http://127.0.0.1:8787"></div>
          <div class="field full-span"><label>RSA私钥</label><textarea name="archive.privateKey" placeholder="${escapeHtml(wecomArchiveCredentialPlaceholder(archive, "privateKey"))}"></textarea></div>
          ${(archive.archiveSecretConfigured || archive.privateKeyConfigured) ? `
            <label class="inline-check compact-check"><input name="archive.clearArchiveSecret" type="checkbox" value="true"><span>清空已保存Secret</span></label>
            <label class="inline-check compact-check"><input name="archive.clearPrivateKey" type="checkbox" value="true"><span>清空已保存私钥</span></label>
          ` : ""}
          <div class="field"><label>默认客户</label><select name="archive.defaultCustomerId">${customerOptions(defaultArchiveCustomer)}</select></div>
          <div class="field"><label>默认渠道</label><select name="archive.defaultChannel"><option ${archive.defaultChannel === "VIP群" ? "selected" : ""}>VIP群</option><option ${archive.defaultChannel === "销售企微" ? "selected" : ""}>销售企微</option><option ${archive.defaultChannel === "电销企微" ? "selected" : ""}>电销企微</option></select></div>
          <div class="field"><label>读取游标</label><input name="archive.cursor" value="${escapeHtml(archive.cursor || "")}" placeholder="由存档Gateway回写"></div>
          <div class="field"><label>Seq</label><input name="archive.seq" type="number" min="0" value="${escapeHtml(archive.seq || 0)}"></div>
          <div class="field"><label>轮询间隔秒</label><input name="archive.pollIntervalSeconds" type="number" min="3" max="300" value="${escapeHtml(archive.pollIntervalSeconds || 10)}"></div>
          <div class="field"><label>单次上限</label><input name="archive.limit" type="number" min="1" max="1000" value="${escapeHtml(archive.limit || 100)}"></div>
          <div class="business-card full-span ${archive.enabled ? "success-card" : "warning-card"}">
            <div class="agent-customer-head">
              <div>
                <strong>${escapeHtml(archive.status || (archive.enabled ? "已启用" : "未启用"))}</strong>
                <span>${archive.lastPulledAt ? `最近拉取 ${escapeHtml(formatDateTime(archive.lastPulledAt))}` : "等待会话存档Gateway接入"} · ${archive.lastAckAt ? `最近ACK ${escapeHtml(formatDateTime(archive.lastAckAt))} · ` : ""}${escapeHtml(archive.trustedStatus || "未验证")}</span>
              </div>
              <span class="status-pill">${archive.enabled ? "主读取入口" : "未启用"}</span>
            </div>
            ${archive.lastError ? `<p class="event-text">最近错误：${escapeHtml(archive.lastError)}</p>` : ""}
          </div>
        </div>
      </article>

      <article class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">智能机器人长连接</h2>
            <p class="panel-subtitle">用于读取真实企微机器人消息。Bot ID和Secret只保存在本地状态，页面不回显明文。</p>
          </div>
        </div>
        <div class="form-grid compact-form">
          <label class="inline-check full-span">
            <input name="aibot.enabled" type="checkbox" value="true" ${aibot.enabled ? "checked" : ""}>
            <span>启用智能机器人长连接</span>
          </label>
          <div class="field"><label>Bot ID</label><input name="aibot.botId" type="password" value="" placeholder="${escapeHtml(wecomAibotCredentialPlaceholder(aibot, "botId"))}"></div>
          <div class="field"><label>Secret</label><input name="aibot.secret" type="password" value="" placeholder="${escapeHtml(wecomAibotCredentialPlaceholder(aibot, "secret"))}"></div>
          <div class="field"><label>长连接地址</label><input name="aibot.wsUrl" value="${escapeHtml(aibot.wsUrl || "")}" placeholder="默认 wss://openws.work.weixin.qq.com"></div>
          <div class="field"><label>默认客户</label><select name="aibot.defaultCustomerId">${customerOptions(defaultAibotCustomer)}</select></div>
          <div class="field"><label>默认入站渠道</label><select name="aibot.defaultChannel"><option ${aibot.defaultChannel === "VIP群" ? "selected" : ""}>VIP群</option><option ${aibot.defaultChannel === "销售企微" ? "selected" : ""}>销售企微</option><option ${aibot.defaultChannel === "电销企微" ? "selected" : ""}>电销企微</option></select></div>
          <label class="inline-check compact-check"><input name="aibot.autoReply" type="checkbox" value="true" ${aibot.autoReply ? "checked" : ""}><span>允许自动回复</span></label>
          <div class="field"><label>心跳间隔ms</label><input name="aibot.heartbeatInterval" type="number" min="5000" step="1000" value="${escapeHtml(aibot.heartbeatInterval)}"></div>
          <div class="field"><label>重连次数</label><input name="aibot.maxReconnectAttempts" type="number" min="-1" max="100" value="${escapeHtml(aibot.maxReconnectAttempts)}"></div>
          <div class="field full-span"><label>进入会话欢迎语</label><textarea name="aibot.welcomeText">${escapeHtml(aibot.welcomeText || "")}</textarea></div>
          ${(aibot.botIdConfigured || aibot.secretConfigured) ? `
            <label class="inline-check compact-check"><input name="aibot.clearBotId" type="checkbox" value="true"><span>清空已保存Bot ID</span></label>
            <label class="inline-check compact-check"><input name="aibot.clearSecret" type="checkbox" value="true"><span>清空已保存Secret</span></label>
          ` : ""}
          <button class="small-button full-span" id="checkWecomAibot" type="button" ${actionAttrs("wecom-aibot-check")}>检查长连接配置</button>
          <div class="business-card full-span ${aibotReady ? "success-card" : "warning-card"}">
            <div class="agent-customer-head">
              <div>
                <strong>${aibotReady ? "凭据已保存" : "等待凭据"}</strong>
                <span>桥接状态：${escapeHtml(aibot.bridgeStatus || "未启动")}${aibot.lastConnectedAt ? ` · 最近连接 ${escapeHtml(formatDateTime(aibot.lastConnectedAt))}` : ""}</span>
              </div>
              <span class="status-pill">${aibot.autoReply ? "自动回复开启" : "只读分流"}</span>
            </div>
            ${aibot.lastError ? `<p class="event-text">最近错误：${escapeHtml(aibot.lastError)}</p>` : ""}
          </div>
        </div>
      </article>

      <article class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">企微测试群路由</h2>
            <p class="panel-subtitle">Webhook只能发送，不能读取群消息；适合测试通知和已确认草稿灰度推送。</p>
          </div>
        </div>
        <div class="form-grid compact-form">
          <label class="inline-check full-span">
            <input name="enabled" type="checkbox" value="true" ${config.enabled ? "checked" : ""}>
            <span>启用测试群发送连接器</span>
          </label>
          <input name="route.id" type="hidden" value="${escapeHtml(route.id)}">
          <div class="field"><label>路由名称</label><input name="route.name" value="${escapeHtml(route.name)}" placeholder="企微测试群机器人"></div>
          <div class="field"><label>业务渠道</label><select name="route.channel"><option ${route.channel === "VIP群" ? "selected" : ""}>VIP群</option><option ${route.channel === "企微私聊" ? "selected" : ""}>企微私聊</option><option ${route.channel === "电销企微培育" ? "selected" : ""}>电销企微培育</option></select></div>
          <div class="field"><label>消息格式</label><select name="route.msgtype"><option value="markdown" ${route.msgtype === "markdown" ? "selected" : ""}>Markdown</option><option value="text" ${route.msgtype === "text" ? "selected" : ""}>文本</option></select></div>
          <label class="inline-check compact-check"><input name="route.enabled" type="checkbox" value="true" ${route.enabled ? "checked" : ""}><span>启用这个路由</span></label>
          <div class="field full-span">
            <label>Webhook URL</label>
            <input name="route.webhookUrl" type="password" value="" placeholder="${escapeHtml(wecomWebhookPlaceholder(route))}">
            <small class="field-help">留空会保持已保存Webhook；测试群机器人Webhook通常以 qyapi.weixin.qq.com/cgi-bin/webhook/send?key= 开头。</small>
          </div>
          ${route.webhookConfigured ? `
            <label class="inline-check compact-check full-span">
              <input name="route.clearWebhook" type="checkbox" value="true">
              <span>清空已保存Webhook</span>
            </label>
          ` : ""}
          <div class="field"><label>发送模式</label><select name="sendMode"><option value="manualApproval" ${config.sendMode === "manualApproval" ? "selected" : ""}>人工确认后发送</option><option value="testOnly" ${config.sendMode === "testOnly" ? "selected" : ""}>仅测试发送</option></select></div>
          <label class="inline-check compact-check"><input name="inbound.enabled" type="checkbox" value="true" ${config.inbound.enabled ? "checked" : ""}><span>启用本地入站适配器</span></label>
          <div class="field"><label>默认入站渠道</label><select name="inbound.defaultChannel"><option ${config.inbound.defaultChannel === "VIP群" ? "selected" : ""}>VIP群</option><option ${config.inbound.defaultChannel === "销售企微" ? "selected" : ""}>销售企微</option><option ${config.inbound.defaultChannel === "电销企微" ? "selected" : ""}>电销企微</option></select></div>
          <div class="field"><label>入站Secret</label><input name="inbound.secret" type="password" value="" placeholder="${escapeHtml(wecomSecretPlaceholder(config.inbound))}"></div>
          ${config.inbound.secretConfigured ? `
            <label class="inline-check compact-check full-span">
              <input name="inbound.clearSecret" type="checkbox" value="true">
              <span>清空入站Secret</span>
            </label>
          ` : ""}
        </div>
      </article>
    </section>
    <section class="panel">
      <button class="primary-button full-span" type="submit" ${actionAttrs("save-wecom-config")}>保存企微配置</button>
    </section>
    </form>

    <section class="grid two">
      <article class="panel" id="wecom-send-test">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">发送测试</h2>
            <p class="panel-subtitle">会真实调用已配置的企微群机器人Webhook；发送结果写入日志。</p>
          </div>
        </div>
        <div class="form-grid compact-form">
          <div class="field full-span"><label>发送路由</label><select id="wecomTestRoute">${routeOptions}</select></div>
          <div class="field full-span"><label>测试内容</label><textarea id="wecomTestContent">企微连接测试：客户运营中台已连接测试群机器人。</textarea></div>
          <button class="primary-button full-span" id="sendWecomTest" type="button" ${actionAttrs("wecom-test-send")} ${config.enabled && readyRoutes.length ? "" : "disabled"}>发送测试消息</button>
        </div>
        <div class="divider"></div>
        <div class="panel-header compact-header">
          <div>
            <h2 class="panel-title">发送已确认草稿</h2>
            <p class="panel-subtitle">只允许发送已确认草稿；成功后草稿会标记为企微已发送。</p>
          </div>
        </div>
        <div class="form-grid compact-form">
          <div class="field full-span"><label>草稿</label><select id="wecomDraftId">${drafts.map((draft) => `<option value="${escapeHtml(draft.id)}">${escapeHtml(draft.customerName || customerName(draft.customerId))} · ${escapeHtml(draft.channel)} · ${escapeHtml(draft.draftType)}</option>`).join("") || `<option value="" disabled selected>暂无已确认草稿</option>`}</select></div>
          <div class="field full-span"><label>发送路由</label><select id="wecomDraftRoute">${routeOptions}</select></div>
          <button class="small-button full-span" id="sendDraftWecom" type="button" ${actionAttrs("wecom-draft-send")} ${config.enabled && readyRoutes.length && drafts.length ? "" : "disabled"}>发送草稿到企微测试群</button>
        </div>
      </article>

      <article class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">群聊归档绑定</h2>
            <p class="panel-subtitle">真实企微入站会按chatid生成或更新绑定；每个群只归档到一个客户档案。</p>
          </div>
        </div>
        <div class="filter-bar compact-filter">
          <div class="field">
            <label>搜索群/客户/chatid</label>
            <input id="wecomBindingSearch" value="${escapeHtml(wecomBindingSearchQuery)}" placeholder="输入群名、客户名、chatid、来源">
          </div>
          <div class="filter-summary">显示 ${escapeHtml(filteredBindings.length)} / ${escapeHtml(bindings.length)} 个群</div>
        </div>
        <div class="event-list">
          ${filteredBindings.slice(0, 8).map((binding) => {
            const currentCustomer = state.customers.find((customer) => customer.id === binding.customerId) || selectedCustomer();
            return `
              <div class="business-card ${binding.status === "已绑定" ? "success-card" : "warning-card"}" data-wecom-binding-card>
                <div class="agent-customer-head">
                  <div>
                    <strong>${escapeHtml(binding.chatName || "未命名企微群")}</strong>
                    <span>${escapeHtml(binding.chatId)} · ${escapeHtml(binding.source || "wecom-aibot")}</span>
                  </div>
                  <span class="status-pill">${escapeHtml(binding.status || "待绑定")}</span>
                </div>
                <div class="form-grid compact-form">
                  <input type="hidden" data-wecom-bind-chat value="${escapeHtml(binding.chatId)}">
                  <div class="field"><label>绑定客户</label><select data-wecom-bind-customer>${customerOptions(currentCustomer)}</select></div>
                  <div class="field"><label>业务渠道</label><select data-wecom-bind-channel><option ${binding.channel === "VIP群" ? "selected" : ""}>VIP群</option><option ${binding.channel === "销售企微" ? "selected" : ""}>销售企微</option><option ${binding.channel === "电销企微" ? "selected" : ""}>电销企微</option></select></div>
                  <button class="small-button full-span" type="button" data-save-wecom-binding ${actionAttrs(`wecom-bind-${binding.chatId}`)}>保存群绑定</button>
                </div>
                <div class="tag-list">
                  <span class="tag">消息 ${escapeHtml(binding.messageCount || 0)} 条</span>
                  ${binding.lastMessageAt ? `<span class="tag">最近 ${escapeHtml(formatDateTime(binding.lastMessageAt))}</span>` : ""}
                  ${binding.lastSenderId ? `<span class="tag">发送人 ${escapeHtml(binding.lastSenderId)}</span>` : ""}
                </div>
              </div>
            `;
          }).join("") || renderEmptyState("暂无匹配企微群", bindings.length ? "调整搜索条件后再查看。" : "启动长连接桥接并收到群消息后，这里会出现待绑定群。")}
        </div>
      </article>
    </section>

    <section class="grid two">
      <details class="panel advanced-debug-panel">
        <summary>高级调试：本地企微入站适配器</summary>
        <div class="panel-header">
          <div>
            <h2 class="panel-title">模拟企微入站</h2>
            <p class="panel-subtitle">用于在未接官方回调前测试群消息分流、客户档案回写和任务生成。</p>
          </div>
        </div>
        <div class="form-grid compact-form">
          <div class="field"><label>客户</label><select id="wecomInboundCustomer">${customerOptions()}</select></div>
          <div class="field"><label>入站渠道</label><select id="wecomInboundChannel"><option value="VIP群">VIP群</option><option value="销售企微">销售企微</option><option value="电销企微">电销企微</option></select></div>
          <div class="field"><label>发送角色</label><select id="wecomInboundRole"><option>客户</option><option>销售</option><option>私域</option><option>客服</option><option>售后</option></select></div>
          <div class="field"><label>发送人</label><input id="wecomInboundSender" value="${escapeHtml(selectedCustomer()?.contact || selectedCustomer()?.name || "客户")}"></div>
          <div class="field"><label>模拟chatid</label><input id="wecomInboundChatId" placeholder="群聊测试可填 chat_xxx"></div>
          <div class="field"><label>模拟msgid</label><input id="wecomInboundMessageId" placeholder="留空自动生成"></div>
          <div class="field full-span"><label>消息内容</label><textarea id="wecomInboundMessage">${escapeHtml(scenarios.vip)}</textarea></div>
          <button class="primary-button full-span" id="ingestWecomMessage" type="button" ${actionAttrs("wecom-inbound")} ${state.customers.length ? "" : "disabled"}>写入企微模拟入站</button>
        </div>
      </details>

      <article class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">最近企微记录</h2>
            <p class="panel-subtitle">发送测试、草稿发送和模拟入站都会写入这里，方便排查配置与Webhook返回。</p>
          </div>
        </div>
        <div class="filter-bar compact-filter">
          <div class="field">
            <label>日志类型</label>
            <select id="wecomLogTypeFilter">${wecomLogTypes.map((type) => `<option value="${escapeHtml(type)}" ${wecomLogTypeFilter === type ? "selected" : ""}>${escapeHtml(type)}</option>`).join("")}</select>
          </div>
          <div class="filter-summary">显示 ${escapeHtml(filteredWecomLogs.length)} / ${escapeHtml(logs.length)} 条记录</div>
        </div>
        <div class="event-list">
          ${filteredWecomLogs.slice(0, 8).map(renderWecomLog).join("") || renderEmptyState("暂无匹配企微记录", logs.length ? "调整日志类型筛选后再查看。" : "保存Webhook后先发送一条测试消息，或使用模拟入站验证分流。")}
        </div>
      </article>
    </section>
  `;
}

function salesSampleCard(sample) {
  return `
    <article class="sample-card">
      <div class="sample-head">
        <div>
          <strong>${escapeHtml(sample.scene)}</strong>
          <div class="muted">${escapeHtml(sample.customerStage)} · ${escapeHtml(sample.targetCard)} · ${escapeHtml(sample.objection)}</div>
        </div>
        <span class="score-badge">${Number(sample.qualityScore || 0)}分</span>
      </div>
      <div class="sample-phrase">${escapeHtml(sample.phrase)}</div>
      <div class="sample-meta">
        <span class="status-pill">${escapeHtml(sample.outcome)}</span>
        ${(sample.tags || []).map(tagPill).join("")}
      </div>
      <div class="muted">${escapeHtml(sample.notes || "")}</div>
    </article>
  `;
}

function renderLearning() {
  const samples = state.salesSamples || [];
  const wonSamples = samples.filter((sample) => sample.outcome === "成交");
  const highQuality = wonSamples.filter((sample) => Number(sample.qualityScore || 0) >= 80);
  const averageScore = samples.length
    ? Math.round(samples.reduce((sum, sample) => sum + Number(sample.qualityScore || 0), 0) / samples.length)
    : 0;
  const coveredCards = new Set(samples.map((sample) => sample.targetCard).filter(Boolean)).size;
  const sortedSamples = [...samples].sort((a, b) => Number(b.qualityScore || 0) - Number(a.qualityScore || 0));
  const latestSalesRun = state.agentRuns.find((run) => run.agent === "销售承接Agent");
  return `
    <section class="grid four">
      ${cardKpi("销售样本", samples.length, "人工沉淀话术")}
      ${cardKpi("高分成交", highQuality.length, "成交且质检不低于80")}
      ${cardKpi("平均质检", averageScore, "样本质量分")}
      ${cardKpi("覆盖卡种", coveredCards, "可复用销售场景")}
    </section>

    <section class="grid two">
      <article class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">录入销售话术样本</h2>
            <p class="panel-subtitle">把成交、暂缓和继续培育场景沉淀为可被销售Agent引用的样本。</p>
          </div>
        </div>
        <form id="salesSampleForm" class="form-grid">
          <div class="field"><label>场景</label><input name="scene" required placeholder="例：价格敏感黑金卡成交"></div>
          <div class="field"><label>客户阶段</label><select name="customerStage">${STAGES.map((stage) => `<option value="${stage}" ${stage === "销售企微承接" ? "selected" : ""}>${stage}</option>`).join("")}</select></div>
          <div class="field"><label>推荐卡种</label><input name="targetCard" value="平台黑金卡"></div>
          <div class="field"><label>核心异议</label><input name="objection" value="价格敏感"></div>
          <div class="field"><label>结果</label><select name="outcome"><option>成交</option><option>继续培育</option><option>暂缓</option><option>无效</option></select></div>
          <div class="field"><label>质检分</label><input name="qualityScore" type="number" min="0" max="100" value="85"></div>
          <div class="field full-span"><label>标签</label><input name="tags" placeholder="价格敏感, 高交易额, 稳定货源"></div>
          <div class="field full-span"><label>样本话术</label><textarea name="phrase" required placeholder="写入销售真实有效的话术、处理顺序或关键表达。"></textarea></div>
          <div class="field full-span"><label>复盘备注</label><input name="notes" placeholder="适用客户、风险边界或后续改进点"></div>
          <button class="primary-button full-span" type="submit" ${actionAttrs("create-sales-sample")}>保存销售样本</button>
        </form>
      </article>

      <article class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">Agent学习结果</h2>
            <p class="panel-subtitle">销售承接Agent会优先引用高质量、同卡种、同异议、同标签样本。</p>
          </div>
        </div>
        ${renderSalesLearningResult(latestSalesRun)}
      </article>
    </section>

    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">样本库</h2>
          <p class="panel-subtitle">样本越接近真实成交复盘，销售Agent给出的承接建议越有业务味道。</p>
        </div>
      </div>
      <div class="sample-grid">
        ${sortedSamples.map(salesSampleCard).join("") || renderEmptyState("暂无销售样本", "先录入一条样本，再运行销售承接Agent验证引用效果。")}
      </div>
    </section>
  `;
}

function renderConversationCard(conversation) {
  const messages = (conversation.messages || []).slice(-8);
  return `
    <article class="conversation-card">
      <div class="conversation-head">
        <div>
          <strong>${escapeHtml(conversation.title || conversation.channel)}</strong>
          <div class="muted">${escapeHtml(conversation.channel)} · ${messages.length}/${(conversation.messages || []).length}条消息</div>
        </div>
        <span class="status-pill">${escapeHtml((conversation.members || []).length)}人</span>
      </div>
      <div class="member-row">
        ${(conversation.members || []).map((member) => `<span class="tag">${escapeHtml(member.role)}:${escapeHtml(member.name)}</span>`).join("")}
      </div>
      <div class="message-list">
        ${messages.map((message) => `
          <div class="message-item ${message.senderRole === "客户" ? "customer-message" : ""}">
            <div class="event-meta">${escapeHtml(message.time || "")} · ${escapeHtml(message.senderRole || "未知")} · ${escapeHtml(message.sender || "匿名")}</div>
            <div class="event-text">${escapeHtml(message.text)}</div>
            <div class="member-row">${(message.mentions || []).map((mention) => `<span class="status-pill">@${escapeHtml(mention)}</span>`).join("") || `<span class="muted">无明确@对象</span>`}</div>
          </div>
        `).join("") || `<div class="muted">暂无消息。</div>`}
      </div>
    </article>
  `;
}

function channelsPageMeta() {
  if (activeNavGroup === "telemarketing") {
    return {
      title: "电销消息入口",
      subtitle: "用于本地模拟电销私聊入站，验证电销培育Agent、客户阶段和任务流转。"
    };
  }
  return {
    title: "消息入站测试",
    subtitle: "用于模拟电销、销售和VIP群消息入站，验证路由、会话上下文、Agent分流和任务闭环；真实企微读取请在企微接入中配置Gateway。"
  };
}

function renderChannels() {
  const meta = channelsPageMeta();
  const customer = selectedCustomer();
  if (!customer) {
    return `
      ${renderLoadError()}
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">${escapeHtml(meta.title)}</h2>
            <p class="panel-subtitle">${escapeHtml(meta.subtitle)} 渠道消息需要绑定到一个客户档案。</p>
          </div>
        </div>
        ${renderEmptyState("暂无客户可写入消息", "请先新增客户或重置本地样例数据，再验证电销、销售和VIP群消息入站。")}
      </section>
    `;
  }
  const conversations = conversationsFor(customer.id);
  const latestVipRun = state.agentRuns.find((run) => run.agent === "VIP群分流Agent" && run.customerId === customer.id);
  return `
    <section class="grid two">
      <article class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">${escapeHtml(meta.title)}</h2>
            <p class="panel-subtitle">${escapeHtml(meta.subtitle)} 这里会真实写入本地会话、事件、任务和Agent结果；不会读取或发送真实企微消息。</p>
          </div>
        </div>
        <div class="toolbar">
          <div class="field">
            <label for="channelCustomer">客户</label>
            <select id="channelCustomer">
              ${customerOptions(customer)}
            </select>
          </div>
          <div class="field">
            <label for="channelType">渠道</label>
            <select id="channelType">
              <option value="电销模拟私聊">电销私聊（本地）</option>
              <option value="销售模拟私聊">销售私聊（本地）</option>
              <option value="VIP模拟群">VIP群（本地）</option>
            </select>
          </div>
          <div class="field">
            <label for="senderRole">发送角色</label>
            <select id="senderRole">
              <option>客户</option>
              <option>销售</option>
              <option>私域</option>
              <option>客服</option>
              <option>售后</option>
            </select>
          </div>
          <div class="field">
            <label for="senderName">发送人</label>
            <input id="senderName" value="${escapeHtml(customer.contact || customer.name)}">
          </div>
        </div>
        <div style="height:14px"></div>
        <div class="field">
          <label for="channelMessage">入站消息</label>
          <textarea id="channelMessage">${escapeHtml(selectedScenario)}</textarea>
        </div>
        <div style="height:10px"></div>
        <div class="scenario-grid">
          ${Object.entries(scenarios).map(([key, value]) => `
            <button class="scenario-button" data-channel-scenario="${key}">${escapeHtml(value)}</button>
          `).join("")}
        </div>
        <div style="height:14px"></div>
        <button class="primary-button" id="ingestMessage" ${actionAttrs("ingest-message")}>写入本地消息并路由</button>
      </article>
      <article class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">本地路由规则</h2>
            <p class="panel-subtitle">当前按本地消息渠道选择Agent，后续接企微时可替换为真实会话回调。</p>
          </div>
        </div>
        <div class="flow-row" style="grid-template-columns:1fr">
          <div class="flow-node"><strong>电销私聊（本地）</strong><span>进入电销培育Agent，识别是否升级销售。</span></div>
          <div class="flow-node"><strong>销售私聊（本地）</strong><span>进入销售承接Agent，识别会员卡兴趣、异议点和人工跟进任务。</span></div>
          <div class="flow-node"><strong>VIP群（本地）</strong><span>进入VIP群分流Agent，读取本地会话窗口，识别问题类型、@对象、重复问题和未结任务。</span></div>
        </div>
        <h3 style="margin-top:16px">会话上下文</h3>
        <div class="conversation-list">
          ${conversations.map(renderConversationCard).join("") || renderEmptyState("暂无会话上下文", "写入一条本地消息后，系统会自动创建本地会话窗口。")}
        </div>
        ${renderVipContextResult(latestVipRun)}
        <h3 style="margin-top:16px">当前客户事件</h3>
        <div class="event-list">
          ${eventsFor(customer.id).map((event) => `
            <div class="event-item">
              <div class="event-meta">${escapeHtml(event.time)} · ${escapeHtml(event.channel)} · ${escapeHtml(event.type)}</div>
              <div class="event-text">${escapeHtml(event.text)}</div>
            </div>
          `).join("") || `<div class="muted">暂无事件。</div>`}
        </div>
      </article>
    </section>
  `;
}

function chatSessionIdForRoom(roomId = "") {
  return `room:${String(roomId || "")}`;
}

function chatSessionIdForConversation(conversationId = "") {
  return `conv:${String(conversationId || "")}`;
}

function chatSourceMeta(messages = []) {
  const sources = new Set(messages.map((message) => message.source).filter(Boolean));
  if (sources.has("wecom-archive")) return { source: "wecom-archive", label: "企微会话存档" };
  if ([...sources].some((source) => source.includes("wecom-aibot") || source.includes("local-chatid"))) return { source: "wecom-aibot", label: "企微机器人" };
  if (sources.has("personal-wechat")) return { source: "personal-wechat", label: "个人微信/Sidecar" };
  return { source: "external", label: "外部会话" };
}

function chatMessageDirection(senderType = "", senderRole = "") {
  if (senderType === "system" || senderRole === "系统") return "system";
  if (senderType === "customer" || senderRole === "客户") return "inbound";
  return "outbound";
}

function chatMessageTime(value = "") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function chatSessionsFromState() {
  const personal = normalizePersonalWechatState(state.personalWechat);
  const bindings = Array.isArray(state.wecomBindings?.groups) ? state.wecomBindings.groups : [];
  const bindingByRoom = new Map(bindings.map((binding) => [binding.chatId, binding]));
  const sessions = [];
  const roomIds = new Set();

  for (const context of personal.groupContexts || []) {
    const binding = bindingByRoom.get(context.roomId);
    const customer = state.customers.find((item) => item.id === (binding?.customerId || context.customerId));
    const messages = (context.messages || []).map((message) => ({
      id: message.messageId,
      messageId: message.messageId,
      senderName: message.senderName || "未知发送人",
      senderRole: message.senderType === "customer" ? "客户" : message.senderType === "managed_account" || message.senderType === "bot" ? "托管号" : message.senderType === "staff" ? "员工" : "未知",
      senderType: message.senderType || "unknown",
      text: message.text || "",
      msgType: message.msgType || "text",
      source: message.source || "external",
      createdAt: message.sendAt || "",
      direction: chatMessageDirection(message.senderType)
    }));
    const jobs = (personal.sendJobs || []).filter((job) => job.roomId === context.roomId);
    const activeJobs = jobs.filter((job) => ["queued", "sending", "sent", "sent_pending_confirm", "manual_required"].includes(job.status));
    const failedJobs = jobs.filter((job) => job.status === "failed");
    const lastDecision = (personal.decisions || []).find((decision) => decision.roomId === context.roomId) || null;
    const source = chatSourceMeta(context.messages || []);
    const placeholder = customer?.tags?.includes("企微群待绑定");
    const bound = Boolean(customer && !placeholder && (!binding || binding.status === "已绑定"));
    const riskLevel = activeJobs.some((job) => job.riskLevel === "high" || job.status === "manual_required") || lastDecision?.riskLevel === "high" ? "high" : "low";
    const lastMessage = messages.at(-1);
    sessions.push({
      sessionId: chatSessionIdForRoom(context.roomId),
      kind: "room",
      roomId: context.roomId,
      title: context.roomName || binding?.chatName || `外部群 ${String(context.roomId).slice(-6)}`,
      source: source.source,
      sourceLabel: source.label,
      customerId: customer?.id || "",
      customerName: customer?.name || "待绑定客户",
      bound,
      channel: binding?.channel || "VIP群",
      binding,
      messages,
      activeJobs,
      failedJobs,
      lastDecision,
      riskLevel,
      needsReply: activeJobs.length > 0,
      lastMessageAt: context.lastMessageAt || lastMessage?.createdAt || "",
      lastMessageText: lastMessage?.text || "",
      messageCount: context.messageCount || messages.length
    });
    roomIds.add(context.roomId);
  }

  for (const binding of bindings) {
    if (roomIds.has(binding.chatId)) continue;
    const customer = state.customers.find((item) => item.id === binding.customerId);
    sessions.push({
      sessionId: chatSessionIdForRoom(binding.chatId),
      kind: "room",
      roomId: binding.chatId,
      title: binding.chatName || `外部群 ${String(binding.chatId).slice(-6)}`,
      source: binding.source || "wecom-archive",
      sourceLabel: String(binding.source || "").includes("aibot") ? "企微机器人" : "企微会话存档",
      customerId: customer?.id || "",
      customerName: customer?.name || "待绑定客户",
      bound: Boolean(customer && binding.status === "已绑定" && !customer.tags?.includes("企微群待绑定")),
      channel: binding.channel || "VIP群",
      binding,
      messages: [],
      activeJobs: [],
      lastDecision: null,
      riskLevel: "low",
      needsReply: false,
      lastMessageAt: binding.lastMessageAt || "",
      lastMessageText: "",
      messageCount: binding.messageCount || 0
    });
  }

  for (const conversation of state.conversations || []) {
    const customer = state.customers.find((item) => item.id === conversation.customerId);
    const messages = (conversation.messages || []).map((message) => ({
      id: message.id,
      messageId: message.id,
      senderName: message.sender || "匿名",
      senderRole: message.senderRole || "未知",
      senderType: message.senderRole === "客户" ? "customer" : "staff",
      text: message.text || "",
      msgType: "text",
      source: "local",
      createdAt: message.createdAt || message.time || "",
      direction: chatMessageDirection("", message.senderRole),
      mentions: message.mentions || []
    }));
    const lastMessage = messages.at(-1);
    sessions.push({
      sessionId: chatSessionIdForConversation(conversation.id),
      kind: "conversation",
      conversationId: conversation.id,
      title: conversation.title || conversation.channel,
      source: "local",
      sourceLabel: "本地模拟",
      customerId: customer?.id || "",
      customerName: customer?.name || "未知客户",
      bound: Boolean(customer),
      channel: conversation.channel || "",
      members: conversation.members || [],
      messages,
      activeJobs: [],
      lastDecision: null,
      riskLevel: "low",
      needsReply: false,
      lastMessageAt: lastMessage?.createdAt || "",
      lastMessageText: lastMessage?.text || "",
      messageCount: messages.length
    });
  }

  return sessions.sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0));
}

function filteredChatSessions() {
  const query = chatSearchQuery.trim().toLowerCase();
  return chatSessionsFromState().filter((session) => {
    const matchesScope = sessionMatchesChatScope(session);
    const matchesSearch = !query || [session.title, session.customerName, session.lastMessageText, session.roomId, session.channel]
      .some((value) => String(value || "").toLowerCase().includes(query));
    const normalizedSourceFilter = chatSourceFilter === "全部" ? "全部真实" : chatSourceFilter;
    const matchesSource = normalizedSourceFilter === "全部真实"
      ? session.source !== "local"
      : normalizedSourceFilter === "本地调试"
        ? session.source === "local"
        : session.sourceLabel === normalizedSourceFilter;
    const matchesStatus = chatStatusFilter === "全部"
      || (chatStatusFilter === "待绑定" && !session.bound)
      || (chatStatusFilter === "待回复" && session.needsReply)
      || (chatStatusFilter === "高风险" && session.riskLevel === "high")
      || (chatStatusFilter === "待回读" && (session.activeJobs || []).some((job) => ["sending", "sent", "sent_pending_confirm"].includes(job.status)))
      || (chatStatusFilter === "发送失败" && (session.failedJobs || []).length > 0);
    return matchesScope && matchesSearch && matchesSource && matchesStatus;
  });
}

function renderChatMessage(message) {
  return `
    <div class="chat-message ${escapeHtml(message.direction || "inbound")}">
      <div class="chat-bubble">
        <div class="chat-meta">${escapeHtml(message.senderName || "未知")} · ${escapeHtml(message.senderRole || "未知")} · ${escapeHtml(chatMessageTime(message.createdAt))}</div>
        <div class="chat-text">${escapeHtml(message.text || "")}</div>
        ${(message.mentions || []).length ? `<div class="chat-tags">${message.mentions.map((mention) => `<span>@${escapeHtml(mention)}</span>`).join("")}</div>` : ""}
      </div>
    </div>
  `;
}

function renderChatSessionRow(session) {
  const active = session.sessionId === activeChatSessionId;
  const statusTags = [
    !session.bound ? "待绑定" : "",
    session.needsReply ? `待回复 ${session.activeJobs?.length || 0}` : "",
    session.riskLevel === "high" ? "高风险" : "",
    (session.activeJobs || []).some((job) => ["sending", "sent", "sent_pending_confirm"].includes(job.status)) ? "待回读" : "",
    (session.failedJobs || []).length ? "发送失败" : ""
  ].filter(Boolean);
  return `
    <button class="chat-session ${active ? "active" : ""}" data-chat-session="${escapeHtml(session.sessionId)}" type="button">
      <div class="chat-avatar">${escapeHtml((session.title || "?").slice(0, 1))}</div>
      <div class="chat-session-main">
        <div class="chat-session-title"><strong>${escapeHtml(session.title)}</strong><span>${escapeHtml(chatMessageTime(session.lastMessageAt))}</span></div>
        <div class="chat-session-preview">${escapeHtml(session.lastMessageText || "暂无消息")}</div>
        ${statusTags.length ? `<div class="chat-session-tags">${statusTags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
      </div>
    </button>
  `;
}

function chatSessionTasks(session) {
  if (!session?.customerId) return [];
  return (state.tasks || []).filter((task) => task.customerId === session.customerId && task.status !== "已完成").slice(0, 5);
}

function chatSessionQuotes(session) {
  const customer = state.customers.find((item) => item.id === session?.customerId);
  if (!customer) return [];
  const watched = customer.watchedModels || [];
  return (state.quotes || []).filter((quote) => watched.some((model) => quote.model.includes(model) || model.includes(quote.model))).slice(0, 5);
}

function renderChatSidePanel(session) {
  const customer = state.customers.find((item) => item.id === session?.customerId);
  const tasks = chatSessionTasks(session);
  const quotes = chatSessionQuotes(session);
  const latestRun = session?.customerId ? state.agentRuns.find((run) => run.customerId === session.customerId) : null;
  const personal = normalizePersonalWechatState(state.personalWechat);
  const gateway = personal.gateway || defaultPersonalWechatState.gateway;
  return `
    <aside class="chat-detail-panel">
      <section>
        <h3>客户档案</h3>
        ${customer ? `
          <div class="detail-list">
            <div><span>客户</span><strong>${escapeHtml(customer.name)}</strong></div>
            <div><span>阶段</span><strong>${escapeHtml(customer.stage)}</strong></div>
            <div><span>会员</span><strong>${escapeHtml(customer.memberStatus || "未记录")}</strong></div>
            <div><span>负责人</span><strong>${escapeHtml(customer.owner || "待分配")}</strong></div>
          </div>
          <div class="tag-list">${(customer.tags || []).slice(0, 8).map(tagPill).join("")}</div>
        ` : renderEmptyState("未绑定客户", "选择客户后，这个会话才会进入客户档案和任务闭环。")}
      </section>
      ${session?.kind === "room" ? `
        <section>
          <h3>群绑定</h3>
          <div class="field"><label>绑定客户</label><select id="chatBindCustomer">${customerOptions(customer || selectedCustomer())}</select></div>
          <div class="field"><label>业务渠道</label><select id="chatBindChannel"><option ${session.channel === "VIP群" ? "selected" : ""}>VIP群</option><option ${session.channel === "销售企微" ? "selected" : ""}>销售企微</option><option ${session.channel === "电销企微" ? "selected" : ""}>电销企微</option></select></div>
          <button class="small-button full-span" data-chat-bind-customer="${escapeHtml(session.sessionId)}" type="button" ${actionAttrs(`chat-bind-${session.sessionId}`)}>保存绑定</button>
        </section>
      ` : ""}
      <section>
        <h3>连接状态</h3>
        <div class="detail-list">
          <div><span>最近来源</span><strong>${escapeHtml(session?.sourceLabel || "未知")}</strong></div>
          <div><span>出站模式</span><strong>${escapeHtml(gateway.mode || "mock")}</strong></div>
          <div><span>发送能力</span><strong>${gateway.mode === "sidecar" && gateway.canSend ? "可真实发送" : "不可真实发送"}</strong></div>
          <div><span>回读确认</span><strong>${gateway.supportsConfirm ? "连接器声明支持" : "依赖自回显/存档回读"}</strong></div>
        </div>
      </section>
      <section>
        <h3>Agent判断</h3>
        ${latestRun ? `
          <div class="business-card">
            <strong>${escapeHtml(latestRun.agent || "Agent")}</strong>
            <p class="event-text">${escapeHtml(summarizeAgentRun(latestRun))}</p>
          </div>
        ` : renderEmptyState("暂无判断", "会话入站后会自动生成客户判断和任务建议。")}
      </section>
      <section>
        <h3>发送队列</h3>
        <div class="event-list">
          ${(session?.activeJobs || []).map(renderPersonalWechatJob).join("") || renderEmptyState("暂无待发送", "低风险回复会排队，高风险回复会停在人工确认。")}
        </div>
      </section>
      <section>
        <h3>未完成任务</h3>
        <div class="event-list">
          ${tasks.map((task) => `<div class="event-item"><div class="event-meta">${escapeHtml(task.ownerRole)} · ${escapeHtml(task.priority)} · ${escapeHtml(task.status)}</div><div class="event-text">${escapeHtml(task.title)}</div></div>`).join("") || `<div class="muted">暂无未完成任务。</div>`}
        </div>
      </section>
      <section>
        <h3>关注报价</h3>
        <div class="event-list">
          ${quotes.map((quote) => `<div class="event-item"><div class="event-meta">${escapeHtml(quote.brand)} · ${escapeHtml(quote.stock)}</div><div class="event-text">${escapeHtml(quote.model)} ${escapeHtml(quote.config)} · ${currency(quote.price)}</div></div>`).join("") || `<div class="muted">暂无匹配报价。</div>`}
        </div>
      </section>
    </aside>
  `;
}

function renderChatWorkbench() {
  const scope = chatScopeDefinition();
  const scopedSessions = chatSessionsFromState().filter(sessionMatchesChatScope);
  const sessions = filteredChatSessions();
  if (!sessions.some((session) => session.sessionId === activeChatSessionId)) {
    activeChatSessionId = sessions[0]?.sessionId || "";
  }
  const activeSession = sessions.find((session) => session.sessionId === activeChatSessionId) || sessions[0];
  const sources = ["全部真实", "企微会话存档", "企微机器人", "个人微信/Sidecar", "本地调试"];
  const statuses = ["全部", "待绑定", "待回复", "高风险", "待回读", "发送失败"];
  const gateway = normalizePersonalWechatState(state.personalWechat).gateway || defaultPersonalWechatState.gateway;
  const canRealSend = gateway.mode === "sidecar" && gateway.canSend === true;
  return `
    <section class="panel chat-workbench-panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">${escapeHtml(scope.title)}</h2>
          <p class="panel-subtitle">${escapeHtml(scope.subtitle)} 回复先进入发送队列或人工确认，不会伪造成已发送。</p>
        </div>
      </div>
      <div class="chat-scope-strip">
        <span><strong>${escapeHtml(scope.label)}</strong></span>
        <span>当前范围 ${sessions.length}/${scopedSessions.length} 个会话</span>
        <span>来源：企微会话存档 / 企微机器人 / 个人微信/Sidecar</span>
      </div>
      <div class="chat-workbench">
        <aside class="chat-list-panel">
          <div class="chat-search">
            <input id="chatSearchInput" value="${escapeHtml(chatSearchQuery)}" placeholder="搜索会话、客户、消息">
            <select id="chatSourceFilter">${sources.map((source) => `<option value="${escapeHtml(source)}" ${(source === chatSourceFilter || (chatSourceFilter === "全部" && source === "全部真实")) ? "selected" : ""}>${escapeHtml(source)}</option>`).join("")}</select>
            <select id="chatStatusFilter">${statuses.map((status) => `<option value="${escapeHtml(status)}" ${status === chatStatusFilter ? "selected" : ""}>${escapeHtml(status)}</option>`).join("")}</select>
          </div>
          <div class="chat-session-list">
            ${sessions.map(renderChatSessionRow).join("") || renderEmptyState(scope.emptyTitle, scope.emptyDetail)}
          </div>
        </aside>

        <main class="chat-main-panel">
          ${activeSession ? `
            <header class="chat-room-header">
              <div>
                <h2>${escapeHtml(activeSession.title)}</h2>
                <p>${escapeHtml(activeSession.sourceLabel)} · ${escapeHtml(activeSession.customerName)} · ${escapeHtml(activeSession.bound ? "已绑定" : "待绑定")}</p>
              </div>
              <div class="tag-list">
                <span class="tag">${escapeHtml(activeSession.channel || "会话")}</span>
                ${activeSession.needsReply ? `<span class="tag">待回复 ${escapeHtml(activeSession.activeJobs.length)}</span>` : ""}
                ${activeSession.riskLevel === "high" ? `<span class="tag">高风险</span>` : ""}
                ${(activeSession.activeJobs || []).some((job) => ["sending", "sent", "sent_pending_confirm"].includes(job.status)) ? `<span class="tag">待回读</span>` : ""}
                ${(activeSession.failedJobs || []).length ? `<span class="tag">发送失败</span>` : ""}
              </div>
            </header>
            <div class="chat-message-stream">
              ${(activeSession.messages || []).map(renderChatMessage).join("") || `<div class="chat-empty">${renderEmptyState("暂无消息", "这个会话只有绑定记录，还没有消息内容。")}</div>`}
            </div>
            <footer class="chat-composer">
              <textarea id="chatReplyText" placeholder="输入回复。低风险会进入发送队列，高风险会进入人工确认。"></textarea>
              <div class="chat-composer-actions">
                <span>${activeSession.kind === "room" ? canRealSend ? "外部会话回复会进入SendScheduler，Sidecar发送后仍需回读确认。" : "真实出站未就绪，回复只会入队或进入人工确认，不会显示已发送。" : "本地调试会话回复会保存为触达草稿。"}</span>
                <button class="primary-button" id="sendChatReply" data-chat-reply-session="${escapeHtml(activeSession.sessionId)}" type="button" ${actionAttrs(`chat-reply-${activeSession.sessionId}`)}>发送/入队</button>
              </div>
            </footer>
          ` : renderEmptyState("暂无可处理会话", "先接入会话存档或写入本地消息。")}
        </main>

        ${activeSession ? renderChatSidePanel(activeSession) : `<aside class="chat-detail-panel">${renderEmptyState("暂无详情", "选择一个会话查看客户档案和队列。")}</aside>`}
      </div>
    </section>
  `;
}

function draftStatusClass(status) {
  if (status === "待确认") return "soon";
  if (status === "已确认") return "normal";
  if (status === "已复制") return "escalated";
  if (status === "企微已发送") return "done";
  if (status === "人工已处理") return "done";
  return "overdue";
}

function renderDraftCard(draft) {
  const terminal = draft.status === "人工已处理" || draft.status === "已废弃" || draft.status === "企微已发送";
  const wecomReady = normalizeWecomConfigState(state.wecomConfig).enabled && wecomRoutes().some((route) => route.enabled && route.webhookConfigured);
  const risk = draftRiskMeta(draft);
  return `
    <article class="draft-card">
      <div class="draft-head">
        <label class="select-line">
          <input type="checkbox" data-draft-select="${escapeHtml(draft.id)}" ${selectedDraftIds.has(draft.id) ? "checked" : ""}>
          <div>
          <strong>${escapeHtml(draft.customerName || "未知客户")}</strong>
          <div class="muted">${escapeHtml(draft.channel)} · ${escapeHtml(draft.draftType)} · ${escapeHtml(draft.sourceAgent || "人工创建")}</div>
          </div>
        </label>
        <div class="pill-group">
          <span class="priority-pill ${priorityClassFromLevel(risk.className)}">${escapeHtml(risk.label)}</span>
          <span class="sla-pill ${draftStatusClass(draft.status)}">${escapeHtml(draft.status)}</span>
        </div>
      </div>
      <div class="draft-content">${escapeHtml(draft.content)}</div>
      <div class="draft-meta">
        <span class="priority-pill ${priorityClass(draft.priority)}">${escapeHtml(draft.priority)}</span>
        <span class="status-pill">${draft.externalSideEffects ? "已触发外部动作" : "未触发外部动作"}</span>
        ${draft.wecomDelivery ? `<span class="status-pill">企微 ${escapeHtml(draft.wecomDelivery.routeName || "已发送")}</span>` : ""}
        <span class="muted">更新 ${escapeHtml(formatDateTime(draft.updatedAt || draft.createdAt))}</span>
      </div>
      ${draft.note ? `<div class="muted">${escapeHtml(draft.note)}</div>` : ""}
      <div class="split-actions">
        <button class="small-button" data-draft-copy="${escapeHtml(draft.id)}" ${actionAttrs(`draft-copy-${draft.id}`)} ${terminal ? "disabled" : ""}>复制文案</button>
        <button class="small-button" data-draft-status="${escapeHtml(draft.id)}" data-status="已确认" ${actionAttrs(`draft-confirm-${draft.id}`)} ${terminal || draft.status === "已确认" ? "disabled" : ""}>确认草稿</button>
        <button class="small-button" data-draft-wecom-send="${escapeHtml(draft.id)}" ${actionAttrs(`draft-wecom-${draft.id}`)} ${draft.status === "已确认" && wecomReady ? "" : "disabled"}>发送企微测试群</button>
        <button class="small-button" data-draft-status="${escapeHtml(draft.id)}" data-status="人工已处理" ${actionAttrs(`draft-complete-${draft.id}`)} ${terminal ? "disabled" : ""}>人工已处理</button>
        <button class="danger-button" data-draft-status="${escapeHtml(draft.id)}" data-status="已废弃" ${actionAttrs(`draft-discard-${draft.id}`)} ${terminal ? "disabled" : ""}>废弃</button>
      </div>
    </article>
  `;
}

function renderDrafts() {
  const drafts = sortedDrafts();
  const visibleDrafts = filteredDrafts();
  const openDrafts = drafts.filter((draft) => !["人工已处理", "已废弃"].includes(draft.status));
  const hasCustomers = state.customers.length > 0;
  return `
    <section class="grid four">
      ${cardKpi("全部草稿", drafts.length, "本地OutboundDraft")}
      ${cardKpi("待确认", drafts.filter((draft) => draft.status === "待确认").length, "需人工审核")}
      ${cardKpi("企微已发送", drafts.filter((draft) => draft.status === "企微已发送").length, "测试群机器人真实发送")}
      ${cardKpi("待外部处理", drafts.filter((draft) => draft.externalSideEffects === false && !["人工已处理", "已废弃"].includes(draft.status)).length, "仍需确认或处理")}
    </section>

    <section class="panel warning-panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">草稿执行边界</h2>
          <p class="panel-subtitle">确认草稿后可以发送到已配置的企微测试群机器人；短信、电话外呼、企微私聊和CRM仍不会自动执行，需要人工或后续执行器处理。</p>
        </div>
      </div>
    </section>

    <section class="grid two">
      <article class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">手工新增草稿</h2>
            <p class="panel-subtitle">用于把运营人员整理的触达文案纳入同一套本地审计和客户事件。</p>
          </div>
        </div>
        <form id="draftForm" class="form-grid">
          <div class="field"><label>客户</label><select name="customerId">${customerOptions()}</select></div>
          <div class="field"><label>渠道</label><select name="channel"><option>企微私聊</option><option>电话外呼</option><option>短信</option><option>VIP群</option><option>报价页</option><option>人工触达</option></select></div>
          <div class="field"><label>优先级</label><select name="priority"><option>中</option><option>高</option><option>低</option></select></div>
          <div class="field"><label>类型</label><input name="draftType" value="人工触达文案"></div>
          <div class="field full-span"><label>草稿内容</label><textarea name="content" required placeholder="写入待人工确认的触达文案。系统只保存草稿，不会自动发送。"></textarea></div>
          <div class="field full-span"><label>备注</label><input name="note" placeholder="适用场景、确认边界或人工处理说明"></div>
          <button class="primary-button full-span" type="submit" ${actionAttrs("create-draft")} ${hasCustomers ? "" : "disabled"}>新增触达草稿</button>
        </form>
        ${hasCustomers ? "" : renderEmptyState("暂无客户可创建草稿", "请先新增客户或重置本地样例数据。")}
      </article>

      <article class="panel">
        <div class="panel-header">
          <div>
          <h2 class="panel-title">草稿使用方式</h2>
          <p class="panel-subtitle">Agent生成草稿后，需要人工判断是否可用；企微测试群发送会真实调用Webhook并写入发送日志。</p>
          </div>
        </div>
        <div class="flow-row" style="grid-template-columns:1fr">
          <div class="flow-node"><strong>生成</strong><span>运行本地Agent或手工新增，草稿写入客户事件和审计。</span></div>
          <div class="flow-node"><strong>确认</strong><span>确认只表示本地审核通过，不表示已触达客户。</span></div>
          <div class="flow-node"><strong>发送/处理</strong><span>可发送企微测试群，其他渠道由人工去真实系统执行后标记处理。</span></div>
        </div>
      </article>
    </section>

    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">草稿队列</h2>
          <p class="panel-subtitle">当前未关闭草稿 ${openDrafts.length} 条，筛选结果 ${visibleDrafts.length} 条。只有企微发送成功的草稿会标记外部动作已触发。</p>
        </div>
      </div>
      ${draftFilterControls(visibleDrafts)}
      <div class="draft-list">
        ${visibleDrafts.map(renderDraftCard).join("") || renderEmptyState("暂无匹配草稿", "可以调整搜索、状态、渠道或风险筛选，或运行Agent生成新草稿。")}
      </div>
    </section>
  `;
}

function taskCard(task) {
  const sla = taskSlaMeta(task);
  const dueAt = taskDueAt(task);
  return `
    <div class="task-card">
      <label class="select-line task-select-line">
        <input type="checkbox" data-task-select="${escapeHtml(task.id)}" ${selectedTaskIds.has(task.id) ? "checked" : ""}>
        <div>
        <p class="task-title">${escapeHtml(task.title)}</p>
        <div class="muted">${escapeHtml(customerName(task.customerId))} · ${escapeHtml(task.reason)}</div>
        <div style="margin-top:8px">
          <span class="priority-pill ${priorityClass(task.priority)}">${escapeHtml(task.priority)}</span>
          <span class="status-pill">${escapeHtml(task.ownerRole)}</span>
          <span class="status-pill">${escapeHtml(taskOwnerValue(task))}</span>
          <span class="status-pill">${escapeHtml(task.status)}</span>
          <span class="sla-pill ${sla.className}">${escapeHtml(sla.label)}</span>
          ${task.escalated ? `<span class="sla-pill escalated">已升级</span>` : ""}
          <span class="muted">SLA ${escapeHtml(task.sla)} · 截止 ${escapeHtml(formatDateTime(dueAt))} · ${escapeHtml(sla.detail)}</span>
        </div>
        </div>
      </label>
      <div class="split-actions">
        <button class="small-button" data-task="${escapeHtml(task.id)}" data-status="跟进中" ${actionAttrs(`task-${task.id}-doing`)} ${task.status === "跟进中" ? "disabled" : ""}>跟进</button>
        <button class="small-button" data-task="${escapeHtml(task.id)}" data-status="已完成" ${actionAttrs(`task-${task.id}-done`)} ${task.status === "已完成" ? "disabled" : ""}>完成</button>
      </div>
    </div>
  `;
}

function renderTasks() {
  const openTasks = state.tasks.filter((task) => task.status !== "已完成");
  const visibleTasks = filteredTasks();
  const hasCustomers = state.customers.length > 0;
  const slaMeta = state.tasks.map((task) => taskSlaMeta(task));
  return `
    <section class="grid four">
      ${cardKpi("全部任务", state.tasks.length, "统一HandoffTask")}
      ${cardKpi("未完成", openTasks.length, "待处理和跟进中")}
      ${cardKpi("超时任务", slaMeta.filter((item) => item.label === "已超时").length, "需主管升级")}
      ${cardKpi("临期任务", slaMeta.filter((item) => item.label === "临期").length, "建议提前介入")}
    </section>
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">任务队列</h2>
          <p class="panel-subtitle">销售线索、VIP问题、报价咨询、售后分流进入同一任务中心，并按SLA巡检升级。当前筛选结果 ${visibleTasks.length} 条。</p>
        </div>
        <button class="primary-button" id="escalateTasks" ${actionAttrs("escalate-tasks")}>运行SLA巡检升级</button>
      </div>
      <form id="newTaskForm" class="form-grid compact-form">
        <div class="field"><label>客户</label><select name="customerId">${customerOptions()}</select></div>
        <div class="field"><label>标题</label><input name="title" placeholder="例：销售回访"></div>
        <div class="field"><label>角色</label><select name="ownerRole"><option>销售</option><option>私域</option><option>客服</option><option>售后</option><option>主管</option></select></div>
        <div class="field"><label>优先级</label><select name="priority"><option>中</option><option>高</option><option>低</option></select></div>
        <div class="field"><label>SLA</label><input name="sla" value="2小时" placeholder="30分钟 / 2小时 / 1天"></div>
        <div class="field full-span"><label>原因</label><input name="reason" placeholder="任务触发原因"></div>
        <button class="small-button full-span" type="submit" ${actionAttrs("create-task")} ${hasCustomers ? "" : "disabled"}>新增人工任务</button>
      </form>
      ${hasCustomers ? "" : renderEmptyState("暂无客户可创建任务", "请先新增客户或重置本地样例数据。")}
      <div class="divider"></div>
      ${taskFilterControls(visibleTasks)}
      <div class="task-list">
        ${visibleTasks.map((task) => taskCard(task)).join("") || renderEmptyState("暂无匹配任务", "可以调整搜索、角色、负责人、状态、优先级或SLA筛选。")}
      </div>
    </section>
  `;
}

function renderQuotes() {
  const quoteCustomers = activeNavGroup === "groupchat"
    ? state.customers.filter((item) => customerScopeDefinitions.vip.stages.includes(item.stage))
    : state.customers;
  const customer = quoteCustomers.find((item) => item.id === state.selectedCustomerId) || quoteCustomers[0] || null;
  if (!customer) {
    return `
      ${renderLoadError()}
      ${renderQuoteForm()}
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">报价查询与订阅</h2>
            <p class="panel-subtitle">报价可以维护，但订阅和推荐需要绑定客户。</p>
          </div>
        </div>
        ${renderEmptyState("暂无客户可订阅报价", "请先新增客户或重置本地样例数据，再测试个性化报价推荐。")}
      </section>
    `;
  }
  const brands = ["全部", ...new Set(state.quotes.map((quote) => quote.brand))];
  if (!brands.includes(quoteBrandFilter)) quoteBrandFilter = "全部";
  const configs = ["全部", ...sortedUnique(state.quotes.map((quote) => quote.config))];
  const stocks = ["全部", ...sortedUnique(state.quotes.map((quote) => quote.stock))];
  if (!configs.includes(quoteConfigFilter)) quoteConfigFilter = "全部";
  if (!stocks.includes(quoteStockFilter)) quoteStockFilter = "全部";
  const visibleQuotes = filteredQuotes();
  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">报价查询与订阅</h2>
          <p class="panel-subtitle">报价页以结构化数据运行，客户订阅和咨询行为会回流客户档案。当前筛选结果 ${visibleQuotes.length} 条。</p>
        </div>
        <div class="toolbar">
          <div class="field">
            <label for="quoteCustomer">客户</label>
            <select id="quoteCustomer">
              ${customerOptions(customer, quoteCustomers)}
            </select>
          </div>
        </div>
      </div>
      ${quoteFilterControls(brands, configs, stocks)}
      <div class="quote-grid" id="quoteGrid">
        ${visibleQuotes.map((quote) => quoteCard(quote, customer)).join("") || renderEmptyState("暂无匹配报价", "可以调整型号、品牌、配置、库存或价格范围，或在下方新增报价。")}
      </div>
    </section>
    ${renderQuoteForm()}
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">${escapeHtml(customer.name)} · 已关注型号</h2>
          <p class="panel-subtitle">${escapeHtml((customer.watchedModels || []).join("、") || "暂无关注型号")}</p>
        </div>
        <button class="primary-button" data-agent="quote" ${actionAttrs("agent-quote")}>运行报价推荐Agent</button>
      </div>
      <div class="event-list">
        ${eventsFor(customer.id).filter((event) => event.channel === "报价页").map((event) => `
          <div class="event-item">
            <div class="event-meta">${escapeHtml(event.time)} · ${escapeHtml(event.type)}</div>
            <div class="event-text">${escapeHtml(event.text)}</div>
          </div>
        `).join("") || `<div class="muted">暂无报价行为。</div>`}
      </div>
    </section>
  `;
}

function renderQuoteForm() {
  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">新增/更新报价</h2>
          <p class="panel-subtitle">用于维护每周报价单的结构化数据。</p>
        </div>
      </div>
      <form id="quoteForm" class="form-grid compact-form">
        <div class="field"><label>品牌</label><input name="brand" placeholder="Apple"></div>
        <div class="field"><label>型号</label><input name="model" required placeholder="iPhone 15"></div>
        <div class="field"><label>配置</label><input name="config" placeholder="256G"></div>
        <div class="field"><label>价格</label><input name="price" required type="number" min="0" placeholder="5200"></div>
        <div class="field"><label>库存</label><input name="stock" placeholder="稳定"></div>
        <div class="field"><label>有效期</label><input name="validUntil" placeholder="2026-06-09"></div>
        <button class="small-button full-span" type="submit" ${actionAttrs("save-quote")}>保存报价</button>
      </form>
    </section>
  `;
}

function quoteCard(quote, customer) {
  const watched = (customer.watchedModels || []).includes(quote.model);
  const brand = escapeHtml(quote.brand);
  const model = escapeHtml(quote.model);
  return `
    <article class="quote-card" data-brand="${brand}">
      <div>
        <div class="muted">${brand} · ${escapeHtml(quote.config)}</div>
        <div class="quote-model">${model}</div>
        <div class="quote-price">${currency(quote.price)}</div>
        <div class="muted">库存：${escapeHtml(quote.stock)} · 有效期：${escapeHtml(quote.validUntil)}</div>
      </div>
      <button class="${watched ? "ghost-button" : "primary-button"}" ${watched ? "disabled" : `data-subscribe="${model}" ${actionAttrs(`subscribe-${quote.id}`)}`}>
        ${watched ? "已订阅" : "订阅型号"}
      </button>
    </article>
  `;
}

function renderWorkflow() {
  const plans = state.workflowPlans || [];
  const capabilities = lastCapabilities;
  const actionable = plans.filter((plan) => plan.priority === "高" || plan.gaps?.length);
  const latestWorkflowRun = state.agentRuns.find((run) => run.agent === "闭环编排Agent");
  return `
    <section class="grid four">
      ${cardKpi("闭环计划", plans.length, "客户下一步动作")}
      ${cardKpi("高优先级", plans.filter((plan) => plan.priority === "高").length, "需优先承接")}
      ${cardKpi("能力审计项", capabilities?.items?.length || "未加载", "本地可用/未接入")}
      ${cardKpi("需补齐客户", actionable.length, "缺口或高优先级")}
    </section>

    <section class="grid two">
      <article class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">系统能力审计</h2>
            <p class="panel-subtitle">把当前能力拆成本地可用、可运行、待建设和未接入，避免把配置或样例能力误认为生产接入。</p>
          </div>
          <button class="small-button" id="loadCapabilities" ${actionAttrs("capabilities")}>刷新审计</button>
        </div>
        <div class="capability-list">
          ${(capabilities?.items || []).map((item) => `
            <div class="capability-card">
              <div class="capability-head">
                <strong>${escapeHtml(item.area)}</strong>
                <span class="capability-status ${statusClass(item.status)}">${escapeHtml(item.status)}</span>
              </div>
              <div class="capability-title">${escapeHtml(item.capability)}</div>
              <div class="muted">${escapeHtml(item.evidence)}</div>
              <div class="gap-text">${escapeHtml(item.gap)}</div>
            </div>
          `).join("") || renderEmptyState("尚未加载能力审计", "点击“刷新审计”查看当前系统哪些能力本地可用，哪些仍未接入。")}
        </div>
      </article>

      <article class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">闭环编排Agent</h2>
            <p class="panel-subtitle">为所有客户生成下一步动作、负责人、触达渠道、任务标题、推荐话术和成功指标。</p>
          </div>
          <button class="primary-button" id="runWorkflow" ${actionAttrs("workflow")}>运行闭环编排</button>
        </div>
        ${plans.length ? `
          <div class="flow-row" style="grid-template-columns:1fr">
            <div class="flow-node"><strong>已生成计划</strong><span>${plans.length}个客户已有下一步动作，任务中心会同步生成承接任务。</span></div>
            <div class="flow-node"><strong>当前限制</strong><span>计划只会生成本地任务；企微测试群发送仍需进入草稿队列人工确认。</span></div>
          </div>
          <div class="workflow-summary">
            <div class="profile-item"><span>生成计划</span><strong>${latestWorkflowRun?.totalPlans || plans.length}</strong></div>
            <div class="profile-item"><span>高优先级</span><strong>${latestWorkflowRun?.highPriority || plans.filter((plan) => plan.priority === "高").length}</strong></div>
            <div class="profile-item"><span>下一动作</span><strong>${escapeHtml(latestWorkflowRun?.nextAction || "生成客户下一步动作")}</strong></div>
          </div>
        ` : renderEmptyState("尚未运行闭环编排", "点击“运行闭环编排”后，系统会把客户池转成可执行的运营任务和客户下一步动作。")}
      </article>
    </section>

    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">客户下一步动作</h2>
          <p class="panel-subtitle">这张表用于判断“流程是否真的往下走”：每个客户必须有渠道、负责人、任务、成功指标和推荐话术。</p>
        </div>
      </div>
      <div class="workflow-grid">
        ${plans.map((plan) => workflowCard(plan)).join("") || renderEmptyState("暂无闭环计划", "先运行闭环编排Agent。")}
      </div>
    </section>
  `;
}

function workflowCard(plan) {
  return `
    <article class="workflow-card">
      <div class="workflow-card-head">
        <div>
          <strong>${escapeHtml(plan.customerName)}</strong>
          <div class="muted">${escapeHtml(plan.stage)} · ${escapeHtml(plan.health)}</div>
        </div>
        <span class="priority-pill ${priorityClass(plan.priority)}">${escapeHtml(plan.priority)}</span>
      </div>
      <div class="workflow-main">${escapeHtml(plan.objective)}</div>
      <div class="profile-grid">
        <div class="profile-item"><span>渠道</span><strong>${escapeHtml(plan.channel)}</strong></div>
        <div class="profile-item"><span>负责人</span><strong>${escapeHtml(plan.ownerRole)}</strong></div>
        <div class="profile-item"><span>下一Agent</span><strong>${escapeHtml(plan.nextAgent)}</strong></div>
        <div class="profile-item"><span>任务</span><strong>${escapeHtml(plan.taskTitle)}</strong></div>
      </div>
      <div class="event-text">${escapeHtml(plan.suggestedMessage)}</div>
      <div class="muted">成功指标：${escapeHtml(plan.successMetric)}</div>
      <div class="tag-list">
        ${(plan.gaps || []).map(tagPill).join("") || `<span class="tag">资料完整</span>`}
        ${(plan.quoteRecommendations || []).map((quote) => tagPill(`${quote.model} ${quote.config}`)).join("")}
      </div>
    </article>
  `;
}

function renderTemplates() {
  return `
    <section class="grid two">
      <article class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">模板中心</h2>
            <p class="panel-subtitle">本地版按“审核模板 + 变量填充”管理可生成的自动触达文案。</p>
          </div>
        </div>
        <div class="template-grid">
          ${state.templates.map((template) => `
            <div class="template-card ${template.allowed ? "" : "blocked"}">
              <div>
                <strong>${escapeHtml(template.name)}</strong>
                <span class="status-pill">${escapeHtml(template.scene)}</span>
                <span class="priority-pill ${template.risk === "高" ? "high" : template.risk === "中" ? "mid" : "low"}">${escapeHtml(template.risk)}</span>
              </div>
              <div class="muted">${escapeHtml(template.content)}</div>
              <div class="split-actions">
                <span class="status-pill">${template.allowed ? "允许生成文案" : "禁止自动触达"}</span>
                <button class="small-button" data-template="${escapeHtml(template.id)}" data-allowed="${template.allowed ? "false" : "true"}" ${actionAttrs(`template-${template.id}`)}>${template.allowed ? "禁用" : "启用"}</button>
              </div>
            </div>
          `).join("") || renderEmptyState("暂无模板", "模板数据为空时，自动触达会保持停用。")}
        </div>
      </article>
      <article class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">风控边界</h2>
            <p class="panel-subtitle">当前系统只生成本地文案和任务，高风险动作一律转人工。</p>
          </div>
        </div>
        <div class="flow-row" style="grid-template-columns:1fr">
          <div class="flow-node"><strong>可自动</strong><span>欢迎语、报价提醒、型号订阅提醒、VIP群标准分流提示。</span></div>
          <div class="flow-node"><strong>需确认</strong><span>价格承诺、合同、付款、退款、售后争议、投诉、低置信度内容。</span></div>
          <div class="flow-node"><strong>可审计</strong><span>每次Agent输出都会保留事件、任务和最近运行记录。</span></div>
        </div>
      </article>
    </section>
  `;
}

function renderSystem() {
  const diagnostics = lastDiagnostics;
  return `
    <section class="grid four">
      ${cardKpi("客户", state.customers.length, "CustomerProfile")}
      ${cardKpi("任务", state.tasks.length, "HandoffTask")}
      ${cardKpi("报价", state.quotes.length, "QuoteItem")}
      ${cardKpi("审计", (state.auditLog || []).length, "AuditLog")}
    </section>

    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">系统健康自检</h2>
          <p class="panel-subtitle">检查客户指针、任务/事件引用、报价数据、模板风控和审计日志，适合每次功能更新后快速验收。</p>
        </div>
        <button class="primary-button" id="runDiagnosticsInView" ${actionAttrs("diagnostics")}>运行自检</button>
      </div>
      ${diagnostics ? `
        <div class="diagnostic-summary ${diagnostics.ok ? "pass" : "fail"}">
          <strong>${diagnostics.ok ? "自检通过" : "自检未通过"}</strong>
          <span>失败 ${diagnostics.summary.failed} 项 · 警告 ${diagnostics.summary.warnings} 项 · ${escapeHtml(formatDateTime(diagnostics.generatedAt))}</span>
        </div>
        <div class="check-list">
          ${diagnostics.checks.map((item) => `
            <div class="check-item ${checkClass(item.status)}">
              <span class="check-status">${escapeHtml(item.status)}</span>
              <div>
                <strong>${escapeHtml(item.name)}</strong>
                <div class="muted">${escapeHtml(item.detail)}</div>
              </div>
            </div>
          `).join("")}
        </div>
      ` : `
        <div class="empty-state">
          <strong>尚未运行自检</strong>
          <span>点击“运行自检”后会生成当前状态报告。每次重置、批量运行或编辑数据后，建议重新运行一次。</span>
        </div>
      `}
    </section>

    <section class="grid two">
      <article class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">本地验收范围</h2>
            <p class="panel-subtitle">当前自检覆盖系统内部一致性，接口级冒烟测试由测试脚本补充。</p>
          </div>
        </div>
        <div class="flow-row" style="grid-template-columns:1fr">
          <div class="flow-node"><strong>客户链路</strong><span>当前客户有效、阶段流转后能继续进入Agent和任务中心。</span></div>
          <div class="flow-node"><strong>任务链路</strong><span>任务必须指向真实客户，任务状态更新会写回事件流。</span></div>
          <div class="flow-node"><strong>报价链路</strong><span>报价型号和价格必须有效，订阅会回写客户关注型号。</span></div>
        </div>
      </article>
      <article class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">更新约束</h2>
            <p class="panel-subtitle">每次新增功能或修改链路，都需要同步更新项目文档和测试说明。</p>
          </div>
        </div>
        <div class="event-list">
          <div class="event-item">
            <div class="event-meta">文档</div>
            <div class="event-text">README、docs/PROJECT.md、docs/API.md、docs/TESTING.md、docs/CHANGELOG.md 需要跟随功能变化维护。</div>
          </div>
          <div class="event-item">
            <div class="event-meta">测试</div>
            <div class="event-text">至少运行 npm test、node --check，并通过关键 API 冒烟流程。</div>
          </div>
        </div>
      </article>
    </section>
  `;
}

function render() {
  if (!viewTitles[activeView]) activeView = "overview";
  if (!navPanelContainsView(activeNavGroup, activeView)) {
    activeNavGroup = defaultNavGroupForView(activeView);
  }
  viewTitle.textContent = viewTitleForCurrentContext();
  document.querySelectorAll(".nav-group").forEach((button) => {
    button.classList.toggle("active", button.dataset.navGroup === activeNavGroup);
  });
  document.querySelectorAll(".nav-subitems").forEach((panel) => {
    panel.classList.toggle("expanded", panel.dataset.navPanel === activeNavGroup);
  });
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === activeView && button.dataset.navGroup === activeNavGroup);
  });
  const map = {
    overview: renderOverview,
    journey: renderJourney,
    customers: renderCustomers,
    chat: renderChatWorkbench,
    agents: renderAgents,
    modelConfig: renderModelConfig,
    wecom: renderWecom,
    learning: renderLearning,
    channels: renderChannels,
    drafts: renderDrafts,
    tasks: renderTasks,
    quotes: renderQuotes,
    workflow: renderWorkflow,
    templates: renderTemplates,
    system: renderSystem
  };
  viewRoot.innerHTML = (map[activeView] || renderOverview)();
}

async function runAgent(kind) {
  const customer = selectedCustomer();
  if (!customer) {
    showToast("请先新增客户或重置本地样例数据");
    return;
  }
  const message = document.querySelector("#scenarioText")?.value || selectedScenario;
  const useLlm = document.querySelector("#useLlmEnhancement")?.checked || false;
  await withBusy(`agent-${kind}`, async () => {
    try {
      const nextState = await api.runAgent(kind, { customerId: customer.id, message, useLlm });
      setState(nextState, useLlm ? "Agent已运行，LLM增强已处理" : "Agent已运行");
    } catch (error) {
      showToast(`Agent运行失败：${error.message}`);
    }
  });
}

async function testModelConnection(agentKey) {
  await withBusy(`test-model-${agentKey}`, async () => {
    try {
      lastModelTest = await api.testModelConfig({
        agentKey,
        prompt: "请用中文简短回复：模型连接成功。"
      });
      render();
      showToast(lastModelTest.ok ? "模型连接测试成功" : `模型连接测试未通过：${lastModelTest.error || "请检查配置"}`);
    } catch (error) {
      showToast(`模型连接测试失败：${error.message}`);
    }
  });
}

async function runEndToEndDemo() {
  await withBusy("demo", async () => {
    try {
      const nextState = await api.runDemo();
      setState(nextState, "本地Agent批量运行完成");
    } catch (error) {
      showToast(`批量运行失败：${error.message}`);
    }
  });
}

async function runDiagnostics() {
  await withBusy("diagnostics", async () => {
    try {
      lastDiagnostics = await api.diagnostics();
      activeView = "system";
      activeNavGroup = "settings";
      render();
      showToast(lastDiagnostics.ok ? "系统自检通过" : "系统自检发现问题");
    } catch (error) {
      showToast(`系统自检失败：${error.message}`);
    }
  });
}

async function loadCapabilities() {
  await withBusy("capabilities", async () => {
    try {
      lastCapabilities = await api.capabilities();
      activeView = "workflow";
      activeNavGroup = "overview";
      render();
      showToast("能力审计已刷新");
    } catch (error) {
      showToast(`能力审计失败：${error.message}`);
    }
  });
}

async function runWorkflow() {
  await withBusy("workflow", async () => {
    try {
      const nextState = await api.runWorkflow();
      setState(nextState, "闭环编排已生成");
      lastCapabilities = await api.capabilities();
      activeView = "workflow";
      activeNavGroup = "overview";
      render();
    } catch (error) {
      showToast(`闭环编排失败：${error.message}`);
    }
  });
}

function showWecomMutationResult(nextState, successMessage) {
  const log = (nextState.wecomLogs || [])[0];
  if (log?.status === "失败") {
    showToast(`企微操作失败：${log.error || "请检查配置和Webhook"}`);
    return;
  }
  showToast(successMessage);
}

function jumpToSection(sectionId) {
  const target = document.getElementById(sectionId);
  if (!target) return false;
  const topbarHeight = document.querySelector(".topbar")?.offsetHeight || 0;
  const targetTop = Math.max(0, Math.round(target.getBoundingClientRect().top + window.scrollY - topbarHeight - 12));
  window.scrollTo(0, targetTop);
  document.documentElement.scrollTop = targetTop;
  document.body.scrollTop = targetTop;
  window.requestAnimationFrame(() => {
    window.scrollTo(0, targetTop);
    document.documentElement.scrollTop = targetTop;
    document.body.scrollTop = targetTop;
  });
  if (window.history?.replaceState) {
    window.history.replaceState(null, "", `#${sectionId}`);
  }
  target.classList.remove("section-jump-highlight");
  void target.offsetWidth;
  target.classList.add("section-jump-highlight");
  window.setTimeout(() => target.classList.remove("section-jump-highlight"), 1600);
  return true;
}

document.addEventListener("click", (event) => {
  const navGroupButton = event.target.closest(".nav-group[data-nav-group]");
  if (navGroupButton) {
    activeNavGroup = navGroupButton.dataset.navGroup;
    const firstItem = document.querySelector(`.nav-subitems[data-nav-panel="${activeNavGroup}"] [data-view]`);
    if (firstItem) {
      activeView = firstItem.dataset.view;
      applyNavPreset(firstItem.dataset.navPreset);
    }
    render();
    if (activeView === "workflow" && !lastCapabilities) void loadCapabilities();
    return;
  }
  const nav = event.target.closest("[data-view]");
  if (nav) {
    activeView = nav.dataset.view;
    activeNavGroup = nav.dataset.navGroup || defaultNavGroupForView(activeView);
    applyNavPreset(nav.dataset.navPreset);
    render();
    if (activeView === "workflow" && !lastCapabilities) void loadCapabilities();
    return;
  }
  const customerPageButton = event.target.closest("[data-customer-page]");
  if (customerPageButton) {
    customerPanelMode = customerPageButton.dataset.customerPage || "list";
    render();
    return;
  }
  const row = event.target.closest("[data-customer]");
  if (row) {
    state.selectedCustomerId = row.dataset.customer;
    if (activeView === "customers" && customerPanelMode === "list") {
      if (event.detail >= 2) {
        customerPanelMode = "detail";
        render();
      } else {
        document.querySelectorAll(".customer-row").forEach((item) => {
          item.classList.toggle("active", item.dataset.customer === state.selectedCustomerId);
        });
      }
      return;
    }
    render();
    return;
  }
  const chatSessionButton = event.target.closest("[data-chat-session]");
  if (chatSessionButton) {
    activeChatSessionId = chatSessionButton.dataset.chatSession;
    render();
    return;
  }
  const chatBindButton = event.target.closest("[data-chat-bind-customer]");
  if (chatBindButton) {
    const sessionId = chatBindButton.dataset.chatBindCustomer;
    const customerId = document.querySelector("#chatBindCustomer")?.value || state.selectedCustomerId;
    const channel = document.querySelector("#chatBindChannel")?.value || "VIP群";
    void withBusy(`chat-bind-${sessionId}`, async () => {
      try {
        const nextState = await api.bindChatSessionCustomer(sessionId, { customerId, channel });
        activeChatSessionId = sessionId;
        setState(nextState, "会话已绑定客户");
      } catch (error) {
        showToast(`会话绑定失败：${error.message}`);
      }
    });
    return;
  }
  if (event.target.closest("#sendChatReply")) {
    const sessionId = event.target.closest("#sendChatReply")?.dataset.chatReplySession || activeChatSessionId;
    const text = document.querySelector("#chatReplyText")?.value || "";
    if (!text.trim()) {
      showToast("请输入回复内容");
      return;
    }
    void withBusy(`chat-reply-${sessionId}`, async () => {
      try {
        const nextState = await api.replyChatSession(sessionId, { text });
        activeChatSessionId = sessionId;
        const latestJob = nextState.personalWechat?.sendJobs?.[0];
        setState(nextState, latestJob?.status === "manual_required" ? "高风险回复已进入人工确认" : "回复已进入发送队列或草稿");
      } catch (error) {
        showToast(`回复处理失败：${error.message}`);
      }
    });
    return;
  }
  if (event.target.closest("[data-reset-customer-filters]")) {
    applyCustomerScope(customerBusinessScope);
    render();
    return;
  }
  if (event.target.closest("[data-reset-task-filters]")) {
    resetTaskFilters();
    render();
    return;
  }
  if (event.target.closest("[data-reset-draft-filters]")) {
    resetDraftFilters();
    render();
    return;
  }
  if (event.target.closest("[data-reset-quote-filters]")) {
    quoteSearchQuery = "";
    quoteBrandFilter = "全部";
    quoteConfigFilter = "全部";
    quoteStockFilter = "全部";
    quoteMinPrice = "";
    quoteMaxPrice = "";
    render();
    return;
  }
  const workbenchTaskButton = event.target.closest("[data-workbench-task-role]");
  if (workbenchTaskButton) {
    taskRoleFilter = workbenchTaskButton.dataset.workbenchTaskRole;
    taskStatusFilter = "全部";
    taskPriorityFilter = "全部";
    taskSlaFilter = "全部";
    taskSearchQuery = "";
    selectedTaskIds.clear();
    activeView = "tasks";
    activeNavGroup = taskRoleFilter === "电销" ? "telemarketing" : "sales";
    render();
    return;
  }
  const workbenchCustomerButton = event.target.closest("[data-workbench-customer-stage]");
  if (workbenchCustomerButton) {
    const nextStage = workbenchCustomerButton.dataset.workbenchCustomerStage;
    const nextScope = customerScopeForStage(nextStage);
    applyCustomerScope(nextScope);
    customerStageFilter = nextStage;
    activeView = "customers";
    activeNavGroup = nextScope === "telemarketing" ? "telemarketing" : nextScope === "sales" ? "sales" : nextScope === "vip" ? "groupchat" : "customer";
    render();
    return;
  }
  const scenarioButton = event.target.closest("[data-scenario]");
  if (scenarioButton) {
    selectedScenario = scenarios[scenarioButton.dataset.scenario];
    const textarea = document.querySelector("#scenarioText");
    if (textarea) textarea.value = selectedScenario;
    return;
  }
  const channelScenarioButton = event.target.closest("[data-channel-scenario]");
  if (channelScenarioButton) {
    selectedScenario = scenarios[channelScenarioButton.dataset.channelScenario];
    const textarea = document.querySelector("#channelMessage");
    if (textarea) textarea.value = selectedScenario;
    return;
  }
  if (event.target.closest("#ingestMessage")) {
    const customer = selectedCustomer();
    if (!customer) {
      showToast("请先新增客户或重置本地样例数据");
      return;
    }
    const channel = document.querySelector("#channelType")?.value || "电销模拟私聊";
    const message = document.querySelector("#channelMessage")?.value || selectedScenario;
    const senderRole = document.querySelector("#senderRole")?.value || "客户";
    const senderName = document.querySelector("#senderName")?.value || customer.contact || customer.name;
    void withBusy("ingest-message", async () => {
      try {
        const nextState = await api.ingestMessage(customer.id, channel, message, { senderRole, senderName });
        setState(nextState, "渠道消息已入站");
      } catch (error) {
        showToast(`消息入站失败：${error.message}`);
      }
    });
    return;
  }
  const agentButton = event.target.closest("[data-agent]");
  if (agentButton) {
    void runAgent(agentButton.dataset.agent);
    return;
  }
  const modelTestButton = event.target.closest("[data-model-test]");
  if (modelTestButton) {
    void testModelConnection(modelTestButton.dataset.modelTest);
    return;
  }
  const draftCopyButton = event.target.closest("[data-draft-copy]");
  if (draftCopyButton) {
    const draftId = draftCopyButton.dataset.draftCopy;
    const draft = state.outboundDrafts.find((item) => item.id === draftId);
    if (!draft) {
      showToast("草稿不存在");
      return;
    }
    void withBusy(`draft-copy-${draftId}`, async () => {
      try {
        await navigator.clipboard.writeText(draft.content);
        const nextState = await api.updateOutboundDraft(draftId, { status: "已复制", note: "文案已复制，等待人工在真实渠道处理。" });
        setState(nextState, "草稿文案已复制");
      } catch (error) {
        showToast(`复制失败：${error.message}`);
      }
    });
    return;
  }
  const draftWecomSendButton = event.target.closest("[data-draft-wecom-send]");
  if (draftWecomSendButton) {
    const draftId = draftWecomSendButton.dataset.draftWecomSend;
    const routeId = wecomPrimaryRoute()?.id || "";
    void withBusy(`draft-wecom-${draftId}`, async () => {
      try {
        const nextState = await api.sendDraftToWecom(draftId, { routeId });
        setState(nextState);
        showWecomMutationResult(nextState, "草稿已发送到企微测试群");
      } catch (error) {
        showToast(`企微草稿发送失败：${error.message}`);
      }
    });
    return;
  }
  const draftStatusButton = event.target.closest("[data-draft-status]");
  if (draftStatusButton) {
    const draftId = draftStatusButton.dataset.draftStatus;
    const status = draftStatusButton.dataset.status;
    const noteMap = {
      已确认: "人工已确认草稿可用于后续外部触达。",
      人工已处理: "人工已在外部渠道处理，系统未自动发送。",
      已废弃: "人工废弃草稿，未触达客户。"
    };
    void withBusy(`draft-${draftId}-${status}`, async () => {
      try {
        const nextState = await api.updateOutboundDraft(draftId, { status, note: noteMap[status] || "" });
        setState(nextState, `草稿已更新为${status}`);
      } catch (error) {
        showToast(`草稿更新失败：${error.message}`);
      }
    });
    return;
  }
  const draftBatchButton = event.target.closest("[data-draft-batch-status]");
  if (draftBatchButton) {
    const status = draftBatchButton.dataset.draftBatchStatus;
    const draftIds = [...selectedDraftIds];
    if (!draftIds.length) {
      showToast("请先选择草稿");
      return;
    }
    const selectedDrafts = draftIds.map((draftId) => state.outboundDrafts.find((draft) => draft.id === draftId)).filter(Boolean);
    if (status === "已确认" && selectedDrafts.some((draft) => draftRiskMeta(draft).batchConfirmBlocked)) {
      showToast("包含高风险草稿，请单条复核后确认");
      return;
    }
    const noteMap = {
      已确认: "批量人工确认草稿可用于后续外部触达。",
      人工已处理: "批量标记为人工已在外部渠道处理，系统未自动发送。",
      已废弃: "批量废弃草稿，未触达客户。"
    };
    void withBusy(`draft-batch-${status}`, async () => {
      try {
        const nextState = await api.batchUpdateOutboundDrafts(draftIds, status, noteMap[status] || "");
        selectedDraftIds.clear();
        setState(nextState, `${draftIds.length}条草稿已更新为${status}`);
      } catch (error) {
        showToast(`批量更新草稿失败：${error.message}`);
      }
    });
    return;
  }
  if (event.target.closest("[data-clear-draft-selection]")) {
    selectedDraftIds.clear();
    render();
    return;
  }
  const taskButton = event.target.closest("[data-task]");
  if (taskButton) {
    void withBusy(`task-${taskButton.dataset.task}`, async () => {
      try {
        const nextState = await api.updateTask(taskButton.dataset.task, taskButton.dataset.status);
        setState(nextState, "任务状态已更新");
      } catch (error) {
        showToast(`任务更新失败：${error.message}`);
      }
    });
    return;
  }
  const taskBatchButton = event.target.closest("[data-task-batch-status]");
  if (taskBatchButton) {
    const status = taskBatchButton.dataset.taskBatchStatus;
    const taskIds = [...selectedTaskIds];
    if (!taskIds.length) {
      showToast("请先选择任务");
      return;
    }
    void withBusy(`task-batch-${status}`, async () => {
      try {
        const nextState = await api.batchUpdateTasks(taskIds, status);
        selectedTaskIds.clear();
        setState(nextState, `${taskIds.length}个任务已更新为${status}`);
      } catch (error) {
        showToast(`批量更新任务失败：${error.message}`);
      }
    });
    return;
  }
  if (event.target.closest("[data-clear-task-selection]")) {
    selectedTaskIds.clear();
    render();
    return;
  }
  const subscribeButton = event.target.closest("[data-subscribe]");
  if (subscribeButton) {
    const customer = selectedCustomer();
    if (!customer) {
      showToast("请先选择客户");
      return;
    }
    const model = subscribeButton.dataset.subscribe;
    void withBusy(`subscribe-${model}`, async () => {
      try {
        const nextState = await api.subscribeQuote(customer.id, model);
        setState(nextState, `${model}已加入关注`);
      } catch (error) {
        showToast(`订阅失败：${error.message}`);
      }
    });
    return;
  }
  const templateButton = event.target.closest("[data-template]");
  if (templateButton) {
    void withBusy(`template-${templateButton.dataset.template}`, async () => {
      try {
        const nextState = await api.updateTemplate(templateButton.dataset.template, { allowed: templateButton.dataset.allowed === "true" });
        setState(nextState, "模板状态已更新");
      } catch (error) {
        showToast(`模板更新失败：${error.message}`);
      }
    });
    return;
  }
  if (event.target.closest("#escalateTasks")) {
    void withBusy("escalate-tasks", async () => {
      try {
        const nextState = await api.escalateTasks();
        setState(nextState, "SLA巡检已完成");
      } catch (error) {
        showToast(`SLA巡检失败：${error.message}`);
      }
    });
    return;
  }
  if (event.target.closest("#runDiagnosticsInView")) {
    void runDiagnostics();
    return;
  }
  if (event.target.closest("#loadCapabilities")) {
    void loadCapabilities();
    return;
  }
  if (event.target.closest("#runWorkflow")) {
    void runWorkflow();
    return;
  }
  const jumpTarget = event.target.closest("[data-jump-wecom-section]");
  if (jumpTarget) {
    jumpToSection(jumpTarget.dataset.jumpWecomSection);
    return;
  }
  if (event.target.closest("#checkWecomArchiveSidecar")) {
    void withBusy("wecom-archive-check", async () => {
      try {
        const result = await api.checkWecomArchiveSidecar();
        if (result.state) setState(result.state);
        showToast(result.ok ? "会话存档Sidecar检查通过" : `会话存档Sidecar检查未通过：${(result.missing || []).join("、") || result.error || "请查看状态"}`);
      } catch (error) {
        showToast(`会话存档Sidecar检查失败：${error.message}`);
      }
    });
    return;
  }
  if (event.target.closest("#checkPersonalWechatGateway") || event.target.closest("#checkPersonalWechatGatewayInline")) {
    void withBusy("personal-wechat-gateway-check", async () => {
      try {
        const result = await api.checkPersonalWechatGateway();
        if (result.state) setState(result.state);
        const message = result.ok
          ? "个人微信连接器已就绪"
          : result.mode === "mock"
            ? "当前是Mock本地演练，未接入真实个人微信；请切换为真实连接器接入并填写连接器URL。"
            : `个人微信连接器未就绪：${(result.missing || []).join("、") || result.error || result.nextStep || "请查看状态"}`;
        showToast(message);
      } catch (error) {
        showToast(`个人微信连接器检查失败：${error.message}`);
      }
    });
    return;
  }
  if (event.target.closest("#sendWecomTest")) {
    const routeId = document.querySelector("#wecomTestRoute")?.value || wecomPrimaryRoute()?.id || "";
    const content = document.querySelector("#wecomTestContent")?.value || "";
    void withBusy("wecom-test-send", async () => {
      try {
        const nextState = await api.testWecomSend({ routeId, content });
        setState(nextState);
        showWecomMutationResult(nextState, "企微测试消息已发送");
      } catch (error) {
        showToast(`企微测试发送失败：${error.message}`);
      }
    });
    return;
  }
  if (event.target.closest("#sendDraftWecom")) {
    const draftId = document.querySelector("#wecomDraftId")?.value || "";
    const routeId = document.querySelector("#wecomDraftRoute")?.value || wecomPrimaryRoute()?.id || "";
    if (!draftId) {
      showToast("暂无可发送草稿");
      return;
    }
    void withBusy("wecom-draft-send", async () => {
      try {
        const nextState = await api.sendDraftToWecom(draftId, { routeId });
        setState(nextState);
        showWecomMutationResult(nextState, "草稿已发送到企微测试群");
      } catch (error) {
        showToast(`企微草稿发送失败：${error.message}`);
      }
    });
    return;
  }
  if (event.target.closest("#checkWecomAibot") || event.target.closest("#checkWecomAibotTop")) {
    void withBusy("wecom-aibot-check", async () => {
      try {
        const result = await api.checkWecomAibot();
        showToast(result.ok ? `长连接配置可用：${result.bridgeStatus || "待启动"}` : `长连接配置不完整：${(result.missing || []).join("、")}`);
      } catch (error) {
        showToast(`长连接配置检查失败：${error.message}`);
      }
    });
    return;
  }
  const saveWecomBindingButton = event.target.closest("[data-save-wecom-binding]");
  if (saveWecomBindingButton) {
    const card = saveWecomBindingButton.closest("[data-wecom-binding-card]");
    const chatId = card?.querySelector("[data-wecom-bind-chat]")?.value || "";
    const customerId = card?.querySelector("[data-wecom-bind-customer]")?.value || "";
    const channel = card?.querySelector("[data-wecom-bind-channel]")?.value || "VIP群";
    if (!chatId || !customerId) {
      showToast("请选择要绑定的企微群和客户");
      return;
    }
    void withBusy(`wecom-bind-${chatId}`, async () => {
      try {
        const nextState = await api.updateWecomGroupBinding({ chatId, customerId, channel });
        setState(nextState, "企微群绑定已保存");
      } catch (error) {
        showToast(`保存企微群绑定失败：${error.message}`);
      }
    });
    return;
  }
  const personalWechatApproveButton = event.target.closest("[data-personal-wechat-approve-job]");
  if (personalWechatApproveButton) {
    const jobId = personalWechatApproveButton.dataset.personalWechatApproveJob;
    void withBusy(`pwx-approve-${jobId}`, async () => {
      try {
        const nextState = await api.approvePersonalWechatSendJob(jobId);
        setState(nextState, "高风险回复已人工放行，等待发送调度");
      } catch (error) {
        showToast(`人工放行失败：${error.message}`);
      }
    });
    return;
  }
  const personalWechatConfirmButton = event.target.closest("[data-personal-wechat-confirm-job]");
  if (personalWechatConfirmButton) {
    const jobId = personalWechatConfirmButton.dataset.personalWechatConfirmJob;
    void withBusy(`pwx-confirm-${jobId}`, async () => {
      try {
        const nextState = await api.confirmPersonalWechatSendJob(jobId);
        const nextJob = nextState.personalWechat?.sendJobs?.find((item) => item.jobId === jobId);
        setState(nextState);
        if (nextJob?.status === "confirmed") {
          showToast("个人微信发送已确认回显");
        } else if (nextJob?.status === "cancelled") {
          showToast(nextJob.error || "个人微信发送任务已取消");
        } else if (nextJob?.error) {
          showToast(nextJob.error);
        } else {
          showToast("个人微信发送任务已更新");
        }
      } catch (error) {
        showToast(`个人微信发送确认失败：${error.message}`);
      }
    });
    return;
  }
  const personalWechatFailButton = event.target.closest("[data-personal-wechat-fail-job]");
  if (personalWechatFailButton) {
    const jobId = personalWechatFailButton.dataset.personalWechatFailJob;
    void withBusy(`pwx-fail-${jobId}`, async () => {
      try {
        const nextState = await api.failPersonalWechatSendJob(jobId, { error: "模拟Gateway发送失败，等待退避或人工接管。" });
        setState(nextState, "个人微信发送任务已标记失败");
      } catch (error) {
        showToast(`标记发送失败失败：${error.message}`);
      }
    });
    return;
  }
  if (event.target.closest("#runPersonalWechatScheduler")) {
    void withBusy("personal-wechat-scheduler", async () => {
      try {
        const nextState = await api.runPersonalWechatScheduler();
        const result = nextState.personalWechat?.schedulerResult;
        setState(nextState, `发送调度完成：发送${result?.dispatched?.length || 0}条`);
      } catch (error) {
        showToast(`发送调度失败：${error.message}`);
      }
    });
    return;
  }
  if (event.target.closest("#ingestPersonalWechatMessage")) {
    const customerId = document.querySelector("#personalWechatInboundCustomer")?.value || state.selectedCustomerId;
    const roomId = document.querySelector("#personalWechatRoomId")?.value || `pwx_room_${customerId || "default"}`;
    const roomName = document.querySelector("#personalWechatRoomName")?.value || "个人微信外部群";
    const senderType = document.querySelector("#personalWechatSenderType")?.value || "customer";
    const senderName = document.querySelector("#personalWechatSenderName")?.value || "";
    const text = document.querySelector("#personalWechatInboundText")?.value || "";
    const messageId = document.querySelector("#personalWechatMessageId")?.value || `pwx_${roomId}_${Date.now()}`;
    void withBusy("personal-wechat-inbound", async () => {
      try {
        const nextState = await api.ingestPersonalWechatMessage({
          customerId,
          roomId,
          roomName,
          senderType,
          senderName,
          msgType: "text",
          text,
          messageId
        });
        setState(nextState, "个人微信外部群消息已写入");
      } catch (error) {
        showToast(`个人微信入站失败：${error.message}`);
      }
    });
    return;
  }
  if (event.target.closest("#ingestWecomArchiveMessage")) {
    const customerId = document.querySelector("#wecomArchiveInboundCustomer")?.value || state.selectedCustomerId;
    const roomId = document.querySelector("#wecomArchiveRoomId")?.value || `archive_room_${customerId || "default"}`;
    const roomName = document.querySelector("#wecomArchiveRoomName")?.value || "企微外部群";
    const senderType = document.querySelector("#wecomArchiveSenderType")?.value || "customer";
    const senderName = document.querySelector("#wecomArchiveSenderName")?.value || "";
    const text = document.querySelector("#wecomArchiveInboundText")?.value || "";
    const messageId = document.querySelector("#wecomArchiveMessageId")?.value || `archive_${roomId}_${Date.now()}`;
    void withBusy("wecom-archive-inbound", async () => {
      try {
        const nextState = await api.ingestWecomArchiveMessage({
          customerId,
          roomId,
          roomName,
          senderType,
          senderName,
          msgType: "text",
          text,
          messageId
        });
        setState(nextState, "企微会话存档消息已写入");
      } catch (error) {
        showToast(`会话存档入站失败：${error.message}`);
      }
    });
    return;
  }
  if (event.target.closest("#ingestWecomMessage")) {
    const customerId = document.querySelector("#wecomInboundCustomer")?.value || state.selectedCustomerId;
    const channel = document.querySelector("#wecomInboundChannel")?.value || "VIP群";
    const senderRole = document.querySelector("#wecomInboundRole")?.value || "客户";
    const senderName = document.querySelector("#wecomInboundSender")?.value || "";
    const message = document.querySelector("#wecomInboundMessage")?.value || "";
    const chatId = document.querySelector("#wecomInboundChatId")?.value || "";
    const externalMessageId = document.querySelector("#wecomInboundMessageId")?.value || (chatId ? `mock_${chatId}_${Date.now()}` : "");
    void withBusy("wecom-inbound", async () => {
      try {
        const nextState = await api.ingestWecomMessage({ customerId, channel, senderRole, senderName, message, chatId, externalMessageId, source: chatId ? "local-chatid-simulator" : "local-simulator" });
        setState(nextState, "企微模拟入站已写入");
      } catch (error) {
        showToast(`企微入站失败：${error.message}`);
      }
    });
  }
});

document.addEventListener("dblclick", (event) => {
  const row = event.target.closest("[data-customer]");
  if (!row || activeView !== "customers") return;
  state.selectedCustomerId = row.dataset.customer;
  customerPanelMode = "detail";
  render();
});

document.addEventListener("change", (event) => {
  if (event.target.id === "agentCustomer" || event.target.id === "quoteCustomer" || event.target.id === "channelCustomer" || event.target.id === "wecomInboundCustomer" || event.target.id === "personalWechatInboundCustomer" || event.target.id === "wecomArchiveInboundCustomer") {
    state.selectedCustomerId = event.target.value;
    render();
  }
  if (event.target.id === "taskSelectAll") {
    const visibleIds = filteredTasks().map((task) => task.id);
    if (event.target.checked) {
      visibleIds.forEach((taskId) => selectedTaskIds.add(taskId));
    } else {
      visibleIds.forEach((taskId) => selectedTaskIds.delete(taskId));
    }
    render();
    return;
  }
  if (event.target.id === "draftSelectAll") {
    const visibleIds = filteredDrafts().map((draft) => draft.id);
    if (event.target.checked) {
      visibleIds.forEach((draftId) => selectedDraftIds.add(draftId));
    } else {
      visibleIds.forEach((draftId) => selectedDraftIds.delete(draftId));
    }
    render();
    return;
  }
  const taskSelection = event.target.dataset.taskSelect;
  if (taskSelection) {
    if (event.target.checked) selectedTaskIds.add(taskSelection);
    else selectedTaskIds.delete(taskSelection);
    render();
    return;
  }
  const draftSelection = event.target.dataset.draftSelect;
  if (draftSelection) {
    if (event.target.checked) selectedDraftIds.add(draftSelection);
    else selectedDraftIds.delete(draftSelection);
    render();
    return;
  }
  const filter = event.target.dataset.customerFilter;
  if (filter) {
    if (filter === "stage") customerStageFilter = event.target.value;
    if (filter === "member") customerMemberFilter = event.target.value;
    if (filter === "owner") customerOwnerFilter = event.target.value;
    if (filter === "search") customerSearchQuery = event.target.value;
    render();
  }
  const taskFilter = event.target.dataset.taskFilter;
  if (taskFilter) {
    if (taskFilter === "role") taskRoleFilter = event.target.value;
    if (taskFilter === "owner") taskOwnerFilter = event.target.value;
    if (taskFilter === "status") taskStatusFilter = event.target.value;
    if (taskFilter === "priority") taskPriorityFilter = event.target.value;
    if (taskFilter === "sla") taskSlaFilter = event.target.value;
    selectedTaskIds.clear();
    render();
    return;
  }
  const draftFilter = event.target.dataset.draftFilter;
  if (draftFilter) {
    if (draftFilter === "status") draftStatusFilter = event.target.value;
    if (draftFilter === "channel") draftChannelFilter = event.target.value;
    if (draftFilter === "priority") draftPriorityFilter = event.target.value;
    if (draftFilter === "risk") draftRiskFilter = event.target.value;
    selectedDraftIds.clear();
    render();
    return;
  }
  const quoteFilter = event.target.dataset.quoteFilter;
  if (quoteFilter) {
    if (quoteFilter === "brand") quoteBrandFilter = event.target.value;
    if (quoteFilter === "config") quoteConfigFilter = event.target.value;
    if (quoteFilter === "stock") quoteStockFilter = event.target.value;
    render();
    return;
  }
  if (event.target.id === "chatSourceFilter") {
    chatSourceFilter = event.target.value;
    activeChatSessionId = "";
    render();
    return;
  }
  if (event.target.id === "chatStatusFilter") {
    chatStatusFilter = event.target.value;
    activeChatSessionId = "";
    render();
    return;
  }
  if (event.target.id === "wecomLogTypeFilter") {
    wecomLogTypeFilter = event.target.value;
    render();
    return;
  }
});

document.addEventListener("input", (event) => {
  if (event.target.dataset.customerFilter === "search") {
    customerSearchQuery = event.target.value;
    window.clearTimeout(customerFilterTimer);
    customerFilterTimer = window.setTimeout(render, 180);
  }
  if (event.target.dataset.taskFilter === "search") {
    taskSearchQuery = event.target.value;
    selectedTaskIds.clear();
    window.clearTimeout(customerFilterTimer);
    customerFilterTimer = window.setTimeout(render, 180);
  }
  if (event.target.dataset.draftFilter === "search") {
    draftSearchQuery = event.target.value;
    selectedDraftIds.clear();
    window.clearTimeout(customerFilterTimer);
    customerFilterTimer = window.setTimeout(render, 180);
  }
  const quoteFilter = event.target.dataset.quoteFilter;
  if (quoteFilter) {
    if (quoteFilter === "search") quoteSearchQuery = event.target.value;
    if (quoteFilter === "minPrice") quoteMinPrice = event.target.value;
    if (quoteFilter === "maxPrice") quoteMaxPrice = event.target.value;
    window.clearTimeout(customerFilterTimer);
    customerFilterTimer = window.setTimeout(render, 180);
  }
  if (event.target.id === "chatSearchInput") {
    chatSearchQuery = event.target.value;
    activeChatSessionId = "";
    window.clearTimeout(customerFilterTimer);
    customerFilterTimer = window.setTimeout(render, 180);
  }
  if (event.target.id === "wecomBindingSearch") {
    wecomBindingSearchQuery = event.target.value;
    window.clearTimeout(customerFilterTimer);
    customerFilterTimer = window.setTimeout(render, 180);
  }
});

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

document.addEventListener("submit", (event) => {
  if (event.target.id === "newCustomerForm") {
    event.preventDefault();
    void withBusy("create-customer", async () => {
      try {
        const nextState = await api.createCustomer(formData(event.target));
        customerPanelMode = "list";
        setState(nextState, "客户已新增");
      } catch (error) {
        showToast(`新增客户失败：${error.message}`);
      }
    });
    return;
  }
  if (event.target.id === "updateCustomerForm") {
    event.preventDefault();
    const customer = selectedCustomer();
    if (!customer) {
      showToast("请先选择客户");
      return;
    }
    void withBusy("update-customer", async () => {
      try {
        const nextState = await api.updateCustomer(customer.id, formData(event.target));
        customerPanelMode = "detail";
        setState(nextState, "客户档案已保存");
      } catch (error) {
        showToast(`保存客户失败：${error.message}`);
      }
    });
    return;
  }
  if (event.target.id === "outcomeForm") {
    event.preventDefault();
    const customer = selectedCustomer();
    if (!customer) {
      showToast("请先选择客户");
      return;
    }
    void withBusy("record-outcome", async () => {
      try {
        const nextState = await api.recordOutcome(customer.id, formData(event.target));
        customerPanelMode = "detail";
        setState(nextState, "销售结果已记录");
      } catch (error) {
        showToast(`记录结果失败：${error.message}`);
      }
    });
    return;
  }
  if (event.target.id === "newTaskForm") {
    event.preventDefault();
    void withBusy("create-task", async () => {
      try {
        const nextState = await api.createTask(formData(event.target));
        setState(nextState, "任务已创建");
      } catch (error) {
        showToast(`创建任务失败：${error.message}`);
      }
    });
    return;
  }
  if (event.target.id === "modelConfigForm") {
    event.preventDefault();
    void withBusy("save-model-config", async () => {
      try {
        const nextState = await api.updateModelConfig(modelConfigPayload(event.target));
        lastModelTest = null;
        setState(nextState, "模型配置已保存");
      } catch (error) {
        showToast(`保存模型配置失败：${error.message}`);
      }
    });
    return;
  }
  if (event.target.id === "wecomConfigForm") {
    event.preventDefault();
    void withBusy("save-wecom-config", async () => {
      try {
        const nextState = await api.updateWecomConfig(wecomConfigPayload(event.target));
        setState(nextState, "企微配置已保存");
      } catch (error) {
        showToast(`保存企微配置失败：${error.message}`);
      }
    });
    return;
  }
  if (event.target.id === "personalWechatConfigForm") {
    event.preventDefault();
    void withBusy("save-personal-wechat-config", async () => {
      try {
        const nextState = await api.updatePersonalWechatConfig(personalWechatConfigPayload(event.target));
        setState(nextState, "个人微信配置已保存");
      } catch (error) {
        showToast(`保存个人微信配置失败：${error.message}`);
      }
    });
    return;
  }
  if (event.target.id === "draftForm") {
    event.preventDefault();
    void withBusy("create-draft", async () => {
      try {
        const nextState = await api.createOutboundDraft(formData(event.target));
        setState(nextState, "触达草稿已新增");
      } catch (error) {
        showToast(`新增草稿失败：${error.message}`);
      }
    });
    return;
  }
  if (event.target.id === "salesSampleForm") {
    event.preventDefault();
    void withBusy("create-sales-sample", async () => {
      try {
        const nextState = await api.createSalesSample(formData(event.target));
        setState(nextState, "销售样本已保存");
      } catch (error) {
        showToast(`保存样本失败：${error.message}`);
      }
    });
    return;
  }
  if (event.target.id === "quoteForm") {
    event.preventDefault();
    void withBusy("save-quote", async () => {
      try {
        const nextState = await api.upsertQuote(formData(event.target));
        setState(nextState, "报价已保存");
      } catch (error) {
        showToast(`保存报价失败：${error.message}`);
      }
    });
  }
});

document.querySelector("#resetDemo").addEventListener("click", async () => {
  await withBusy("reset", async () => {
    try {
      const nextState = await api.reset();
      quoteBrandFilter = "全部";
      quoteSearchQuery = "";
      quoteConfigFilter = "全部";
      quoteStockFilter = "全部";
      quoteMinPrice = "";
      quoteMaxPrice = "";
      customerSearchQuery = "";
      customerStageFilter = "全部";
      customerStageSetFilter = [];
      customerBusinessScope = "all";
      customerPanelMode = "list";
      customerMemberFilter = "全部";
      customerOwnerFilter = "全部";
      taskSearchQuery = "";
      taskRoleFilter = "全部";
      taskOwnerFilter = "全部";
      taskStatusFilter = "全部";
      taskPriorityFilter = "全部";
      taskSlaFilter = "全部";
      draftSearchQuery = "";
      draftStatusFilter = "全部";
      draftChannelFilter = "全部";
      draftPriorityFilter = "全部";
      draftRiskFilter = "全部";
      selectedTaskIds.clear();
      selectedDraftIds.clear();
      setState(nextState, "本地样例数据已重置");
    } catch (error) {
      showToast(`重置失败：${error.message}`);
    }
  });
});

document.querySelector("#runDemo").addEventListener("click", () => void runEndToEndDemo());
document.querySelector("#runDiagnostics").addEventListener("click", () => void runDiagnostics());

render();
