import { initialState } from "./data.js";

const COLLECTION_KEYS = [
  "customers",
  "events",
  "tasks",
  "templates",
  "quotes",
  "outboundDrafts",
  "agentRuns",
  "workflowPlans",
  "salesSamples",
  "conversations",
  "wecomLogs",
  "auditLog"
];

export function cloneState(state = initialState) {
  const cloned = structuredClone(state || initialState);
  for (const key of COLLECTION_KEYS) {
    if (!Array.isArray(cloned[key])) cloned[key] = [];
  }
  if (!cloned.selectedCustomerId && cloned.customers[0]?.id) {
    cloned.selectedCustomerId = cloned.customers[0].id;
  }
  return cloned;
}

export function currency(value) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0
  }).format(value);
}

export function nowLabel() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date());
}

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

const KNOWN_MODELS = [
  "iPhone 13",
  "iPhone 14 Pro",
  "iPhone 15",
  "iPhone 16",
  "Mate60",
  "Mate60 Pro",
  "Pura 70",
  "小米14",
  "Redmi K70",
  "AirPods Pro"
];

const ROLE_MENTIONS = [
  ["销售", "销售"],
  ["售后", "售后"],
  ["客服", "客服"],
  ["私域", "私域"],
  ["顾问", "私域"],
  ["主管", "主管"]
];

export function getCustomer(state, customerId) {
  return state.customers.find((customer) => customer.id === customerId);
}

function requireCustomer(state, customerId) {
  const customer = getCustomer(state, customerId);
  if (!customer) throw new Error(`Customer not found: ${customerId || "empty"}`);
  return customer;
}

function appendEvent(state, customerId, event) {
  state.events = Array.isArray(state.events) ? state.events : [];
  const createdAt = new Date().toISOString();
  state.events.unshift({
    id: uid("e"),
    customerId,
    time: nowLabel(),
    createdAt,
    ...event,
    createdAt: event.createdAt || createdAt
  });
  state.events = state.events.slice(0, 500);
}

function appendTask(state, customerId, task) {
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const customer = getCustomer(state, customerId);
  const existing = state.tasks.find(
    (item) => item.customerId === customerId && item.title === task.title && item.status !== "已完成"
  );
  if (existing) {
    existing.reason = task.reason;
    existing.priority = task.priority;
    existing.ownerRole = task.ownerRole || existing.ownerRole;
    existing.owner = task.owner || existing.owner;
    existing.sla = task.sla || existing.sla;
    return ensureTaskTiming(existing);
  }
  const next = {
    id: uid("t"),
    customerId,
    owner: task.owner || customer?.owner || "待分配",
    status: "待处理",
    sla: task.sla || "2小时",
    ...task
  };
  ensureTaskTiming(next);
  state.tasks.unshift(next);
  return next;
}

function pushUnique(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

function safeNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
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

function ensureCustomerLists(customer) {
  if (!Array.isArray(customer.tags)) customer.tags = [];
  if (!Array.isArray(customer.watchedModels)) customer.watchedModels = [];
}

function knownModelsFromState(state) {
  return [
    ...new Set([
      ...KNOWN_MODELS,
      ...(state.quotes || [])
        .map((quote) => String(quote.model || "").trim())
        .filter(Boolean)
    ])
  ];
}

export function extractMessageSignals(text = "", state = initialState) {
  const cleanText = String(text || "");
  const normalized = cleanText.toLowerCase();
  const mentions = ROLE_MENTIONS
    .filter(([keyword]) => cleanText.includes(`@${keyword}`) || cleanText.includes(keyword))
    .map(([, role]) => role);
  const models = knownModelsFromState(state).filter((model) => normalized.includes(model.toLowerCase()));
  const urgency = ["今天", "现在", "马上", "尽快", "本周", "急"].some((word) => normalized.includes(word.toLowerCase()))
    ? "高"
    : "常规";
  const priceSensitive = ["便宜", "优惠", "价格", "多少钱", "锁价"].some((word) => normalized.includes(word.toLowerCase()));
  const quantityMatch = cleanText.match(/(\d+|一|两|二|三|四|五|十)[台件批]/);
  return {
    mentions: [...new Set(mentions)],
    models,
    urgency,
    priceSensitive,
    quantitySignal: quantityMatch?.[0] || ""
  };
}

export function buildConversationContext(state, customerId, channel = "VIP群", limit = 6) {
  const conversations = (state.conversations || []).filter(
    (conversation) => conversation.customerId === customerId && (!channel || conversation.channel === channel)
  );
  const messages = conversations.flatMap((conversation) =>
    (conversation.messages || []).map((message) => ({
      ...message,
      channel: conversation.channel,
      conversationTitle: conversation.title
    }))
  );
  if (!messages.length) {
    messages.push(
      ...(state.events || [])
        .filter((event) => event.customerId === customerId && (!channel || event.channel === channel))
        .map((event) => ({
          id: event.id,
          sender: "客户",
          senderRole: "客户",
          text: event.text,
          mentions: extractMessageSignals(event.text, state).mentions,
          time: event.time,
          channel: event.channel,
          conversationTitle: event.channel
        }))
    );
  }
  const recentMessages = messages.slice(-limit).map((message) => {
    const signal = classifyMessage(message.text, state);
    return {
      id: message.id,
      sender: message.sender || "客户",
      senderRole: message.senderRole || "客户",
      text: String(message.text || ""),
      mentions: message.mentions || signal.mentions,
      time: message.time || "",
      channel: message.channel,
      intent: signal.intent,
      routeTo: signal.role,
      priority: signal.priority
    };
  });
  const intentCounts = recentMessages.reduce((acc, message) => {
    acc[message.intent] = (acc[message.intent] || 0) + 1;
    return acc;
  }, {});
  const unresolvedTasks = (state.tasks || [])
    .filter((task) => task.customerId === customerId && task.status !== "已完成")
    .slice(0, 5)
    .map((task) => ({
      id: task.id,
      title: task.title,
      ownerRole: task.ownerRole,
      priority: task.priority,
      status: task.status
    }));
  return {
    channel,
    messageCount: messages.length,
    recentMessages,
    repeatedIntents: Object.entries(intentCounts)
      .filter(([, count]) => count >= 2)
      .map(([intent, count]) => ({ intent, count })),
    unresolvedTasks
  };
}

export function recommendQuotes(state, customer, limit = 3) {
  const watched = new Set(customer.watchedModels || []);
  const tags = customer.tags || [];
  return (state.quotes || [])
    .map((quote) => {
      const reasons = [];
      const model = String(quote.model || "");
      const brand = String(quote.brand || "");
      if (watched.has(model)) reasons.push("客户已关注型号");
      if (tags.some((tag) => model.includes(tag) || String(tag).includes(model))) reasons.push("客户标签匹配");
      if (tags.some((tag) => brand.includes(tag) || String(tag).includes(brand))) reasons.push("品牌偏好匹配");
      if (String(quote.stock || "").includes("稳定") || String(quote.stock || "").includes("充足")) reasons.push("库存状态可推");
      const score = reasons.length * 20 + (watched.has(model) ? 40 : 0);
      return { ...quote, price: safeNumber(quote.price, 0), matchScore: score, reasons };
    })
    .filter((quote) => quote.matchScore > 0)
    .sort((a, b) => b.matchScore - a.matchScore || a.price - b.price)
    .slice(0, limit);
}

function recommendSalesSamples(customer, signal, samples = [], limit = 2) {
  const tags = new Set(customer.tags || []);
  const watchedModels = new Set(customer.watchedModels || []);
  const objection = signal.priceSensitive || tags.has("价格敏感") ? "价格敏感" : "关注权益稳定性";
  return (samples || [])
    .map((sample) => {
      const sampleTags = Array.isArray(sample.tags) ? sample.tags : [];
      const qualityScore = safeNumber(sample.qualityScore, 0);
      let matchScore = qualityScore;
      if (sample.outcome === "成交") matchScore += 20;
      if (sample.targetCard && customer.targetCard && sample.targetCard === customer.targetCard) matchScore += 18;
      if (sample.customerStage && sample.customerStage === customer.stage) matchScore += 12;
      if (sample.objection && (sample.objection === objection || objection.includes(sample.objection))) matchScore += 12;
      for (const tag of sampleTags) {
        if (tags.has(tag) || watchedModels.has(tag)) matchScore += 6;
      }
      return { ...sample, qualityScore, matchScore };
    })
    .filter((sample) => sample.phrase && sample.matchScore >= 70)
    .sort((a, b) => b.matchScore - a.matchScore || b.qualityScore - a.qualityScore)
    .slice(0, limit);
}

export function buildSalesPlaybook(customer, signal, recommendations = [], samples = []) {
  const watched = customer.watchedModels?.[0] || recommendations[0]?.model || "客户关注型号";
  const recommendedCard = customer.targetCard || "平台会员卡";
  const objection = signal.priceSensitive || customer.tags?.includes("价格敏感") ? "价格敏感" : "关注权益稳定性";
  const learnedSamples = recommendSalesSamples(customer, signal, samples, 2);
  const winningPhrase = learnedSamples[0]?.phrase || "先确认客户采购计划、核心异议和可承诺边界，再由人工销售推进下一步。";
  return {
    recommendedCard,
    primaryNeed: signal.intent,
    objection,
    winningPhrase,
    learnedTactics: learnedSamples.map((sample) => ({
      scene: sample.scene,
      outcome: sample.outcome,
      qualityScore: sample.qualityScore,
      matchScore: sample.matchScore,
      phrase: sample.phrase
    })),
    openingQuestion: `先确认${watched}本周采购量、采购周期和是否需要稳定货源保障。`,
    valueProof: `${recommendedCard}重点说明优先报价、稳定货源、专属售后协同和VIP群响应机制。`,
    objectionHandling:
      objection === "价格敏感"
        ? "先避免直接做价格承诺或最低价承诺，改为对比会员价差、货源稳定性和售后响应成本。"
        : "强调持续采购场景下的供给稳定、报价效率和跨角色协同。",
    closingSuggestion:
      customer.intentScore >= 85
        ? "建议销售在1小时内推进权益确认和付款/开卡节点。"
        : "建议先用报价和权益清单确认兴趣，再预约人工销售跟进。",
    handoffSummary: `${customer.name}关注${watched}，当前阶段${customer.stage}，推荐${recommendedCard}，主要异议为${objection}。${learnedSamples.length ? `可参考样本：${learnedSamples[0].scene}。` : ""}`
  };
}

export function buildCustomerPlan(state, customer) {
  const openTasks = (state.tasks || []).filter((task) => task.customerId === customer.id && task.status !== "已完成");
  const quoteRecommendations = recommendQuotes(state, customer, 2);
  const watched = customer.watchedModels?.[0] || quoteRecommendations[0]?.model || "关注型号";
  const gaps = [];
  if (!customer.phone) gaps.push("缺手机号");
  if (!customer.watchedModels?.length) gaps.push("缺关注型号");
  if (!openTasks.length) gaps.push("缺待办承接");

  if (customer.stage === "待筛选" || customer.stage === "待外呼") {
    return {
      customerId: customer.id,
      customerName: customer.name,
      stage: customer.stage,
      health: customer.intentScore >= 55 ? "可激活" : "需观察",
      nextAgent: "外呼筛选Agent",
      channel: "本地外呼任务",
      ownerRole: "电销",
      priority: customer.intentScore >= 60 ? "高" : "中",
      objective: "确认采购计划并引导添加企微",
      taskTitle: "外呼确认采购计划",
      suggestedMessage: `围绕${watched}确认近期采购计划；若明确意向，生成销售企微添加引导任务，否则进入电销培育任务。`,
      successMetric: "外呼后阶段进入销售企微承接或电销企微培育",
      gaps,
      quoteRecommendations
    };
  }

  if (customer.stage === "电销企微培育") {
    return {
      customerId: customer.id,
      customerName: customer.name,
      stage: customer.stage,
      health: "培育中",
      nextAgent: "电销培育Agent",
      channel: "本地电销私聊",
      ownerRole: "电销",
      priority: customer.intentScore >= 70 ? "高" : "中",
      objective: "生成关注型号触达文案并筛出销售线索",
      taskTitle: "电销企微定向培育",
      suggestedMessage: `生成${watched}报价变化和会员权益触达文案，客户回复报价/会员/库存时升级销售承接。`,
      successMetric: "客户回复后生成销售交接任务",
      gaps,
      quoteRecommendations
    };
  }

  if (customer.stage === "销售企微承接" || customer.stage === "销售跟进") {
    const playbook = buildSalesPlaybook(customer, { intent: "会员卡销售", priceSensitive: customer.tags?.includes("价格敏感") }, quoteRecommendations, state.salesSamples || []);
    return {
      customerId: customer.id,
      customerName: customer.name,
      stage: customer.stage,
      health: customer.intentScore >= 80 ? "高意向" : "销售培育",
      nextAgent: "销售承接Agent",
      channel: "本地销售私聊",
      ownerRole: "销售",
      priority: customer.intentScore >= 80 ? "高" : "中",
      objective: `推进${customer.targetCard}成交`,
      taskTitle: `${customer.targetCard}销售闭环跟进`,
      suggestedMessage: playbook.handoffSummary,
      successMetric: "记录成交/暂缓/继续培育结果并回写客户阶段",
      gaps,
      quoteRecommendations,
      playbook
    };
  }

  if (customer.stage === "已购会员" || customer.stage === "VIP维护" || customer.stage === "续费/复购" || String(customer.memberStatus || "").includes("卡")) {
    return {
      customerId: customer.id,
      customerName: customer.name,
      stage: customer.stage,
      health: customer.risk === "中" || customer.risk === "高" ? "需维护" : "稳定维护",
      nextAgent: "VIP群分流Agent + 报价推荐Agent",
      channel: "本地VIP群/报价页",
      ownerRole: "私域",
      priority: customer.risk === "中" || customer.risk === "高" ? "高" : "中",
      objective: "维护VIP小群、分流问题并生成个性化报价文案",
      taskTitle: "VIP客户周度维护",
      suggestedMessage: `每周生成${quoteRecommendations.map((quote) => quote.model).join("、") || watched}报价触达文案，并由VIP群分流Agent处理售后/报价/客服问题。`,
      successMetric: "VIP问题进入正确角色任务，报价行为回流关注型号",
      gaps,
      quoteRecommendations
    };
  }

  return {
    customerId: customer.id,
    customerName: customer.name,
    stage: customer.stage,
    health: "待判断",
    nextAgent: "闭环编排Agent",
    channel: "人工复核",
    ownerRole: "运营",
    priority: "低",
    objective: "补齐客户信息后重新判断",
    taskTitle: "客户状态人工复核",
    suggestedMessage: "客户状态不在标准链路内，建议运营复核阶段、负责人和关注型号。",
    successMetric: "客户回到标准生命周期状态",
    gaps,
    quoteRecommendations
  };
}

export function scoreCustomer(customer) {
  const tradeVolume = Math.max(0, safeNumber(customer.tradeVolume, 0));
  const purchaseFrequency = Math.max(0, safeNumber(customer.purchaseFrequency, 0));
  const lastTradeDays = Math.max(0, safeNumber(customer.lastTradeDays, 999));
  const valueScore = Math.min(35, Math.round(tradeVolume / 40000));
  const frequencyScore = Math.min(20, purchaseFrequency);
  const recencyScore = lastTradeDays <= 7 ? 18 : lastTradeDays <= 20 ? 12 : 5;
  const memberScore = customer.memberStatus === "未购卡" ? 12 : customer.memberStatus === "试用卡" ? 16 : 8;
  const tags = customer.tags || [];
  const tagScore = tags.includes("明确意向") ? 15 : tags.includes("潜在意向") ? 9 : 3;
  return Math.min(100, valueScore + frequencyScore + recencyScore + memberScore + tagScore);
}

export function classifyMessage(text = "", state = initialState) {
  const cleanText = String(text || "");
  const normalized = cleanText.toLowerCase();
  const messageSignals = extractMessageSignals(cleanText, state);
  const has = (words) => words.some((word) => normalized.includes(word.toLowerCase()));
  const withSignals = (signal) => ({ ...signal, ...messageSignals });
  if (has(["投诉", "退款", "赔", "不满", "生气"])) {
    return withSignals({ intent: "风险/投诉", role: "主管", priority: "高", confidence: 91 });
  }
  if (has(["售后", "坏", "维修", "退换", "少发", "两台"])) {
    return withSignals({ intent: "售后问题", role: "售后", priority: "高", confidence: 88 });
  }
  if (has(["会员", "卡", "权益", "黑金", "金卡", "银卡", "定"])) {
    return withSignals({ intent: "会员卡咨询", role: "销售", priority: "高", confidence: 86 });
  }
  if (has(["报价", "价格", "多少钱", "型号", "库存", "货源"])) {
    return withSignals({ intent: "报价咨询", role: "销售", priority: messageSignals.urgency === "高" ? "高" : "中", confidence: 82 });
  }
  if (has(["发票", "合同", "付款", "对账"])) {
    return withSignals({ intent: "售前/财务信息", role: "客服", priority: "中", confidence: 78 });
  }
  return withSignals({ intent: "一般咨询", role: "客服", priority: "低", confidence: 60 });
}

export function runDialerAgent(inputState, customerId) {
  const state = cloneState(inputState);
  const customer = requireCustomer(state, customerId);
  ensureCustomerLists(customer);
  const score = scoreCustomer(customer);
  const highIntent = score >= 78;
  const nurture = score >= 52 && score < 78;
  customer.intentScore = score;
  customer.stage = highIntent ? "销售企微承接" : nurture ? "电销企微培育" : "待外呼";
  const nextTag = highIntent ? "明确意向" : nurture ? "潜在意向" : "待回访";
  if (!customer.tags.includes(nextTag)) {
    customer.tags.push(nextTag);
  }
  appendEvent(state, customerId, {
    channel: "外呼",
    type: "外呼摘要",
    text: highIntent
      ? "客户表达明确采购计划，适合直接转销售承接会员卡。"
      : nurture
        ? "客户有潜在采购兴趣，建议进入电销企微培育。"
        : "客户暂未表达清晰采购计划，建议保留待回访。"
  });
  if (highIntent) {
    appendTask(state, customerId, {
      title: "外呼高意向转销售",
      ownerRole: "销售",
      owner: "销售队列",
      priority: "高",
      sla: "2小时",
      reason: `外呼评分${score}，建议销售承接${customer.targetCard}。`
    });
  }
  const result = {
    agent: "外呼筛选Agent",
    score,
    nextStage: customer.stage,
    nextAction: highIntent ? "生成销售企微添加引导任务" : nurture ? "生成电销培育添加引导任务" : "进入本地回访名单",
    summary: state.events[0].text
  };
  state.agentRuns.unshift(result);
  return { state, result };
}

export function runNurtureAgent(inputState, customerId, message) {
  const state = cloneState(inputState);
  const customer = requireCustomer(state, customerId);
  ensureCustomerLists(customer);
  const signal = classifyMessage(message, state);
  for (const model of signal.models) {
    pushUnique(customer.watchedModels, model);
    pushUnique(customer.tags, model);
  }
  appendEvent(state, customerId, {
    channel: "电销企微",
    type: "客户回复",
    text: message
  });
  const upgrade = signal.intent === "会员卡咨询" || signal.intent === "报价咨询" || signal.priority === "高";
  if (upgrade) {
    customer.stage = "销售企微承接";
    customer.intentScore = Math.max(safeNumber(customer.intentScore, 0), signal.confidence);
    if (!customer.tags.includes("明确意向")) customer.tags.push("明确意向");
    appendTask(state, customerId, {
      title: "电销培育升级销售",
      ownerRole: "销售",
      owner: "销售队列",
      priority: signal.priority,
      sla: "2小时",
      reason: `客户回复识别为${signal.intent}，置信度${signal.confidence}%。`
    });
  }
  const result = {
    agent: "电销培育Agent",
    intent: signal.intent,
    confidence: signal.confidence,
    detectedModels: signal.models,
    template: upgrade ? "销售接入提醒" : "型号报价提醒",
    nextAction: upgrade ? "生成销售转交任务" : "继续定向培育",
    suggestedReply: upgrade
      ? `已识别客户关注${customer.targetCard}，建议销售接入。`
      : `继续生成${customer.watchedModels[0] || "关注型号"}报价和会员权益内容。`
  };
  state.agentRuns.unshift(result);
  return { state, result };
}

export function runSalesAgent(inputState, customerId, message) {
  const state = cloneState(inputState);
  const customer = requireCustomer(state, customerId);
  ensureCustomerLists(customer);
  const signal = classifyMessage(message, state);
  for (const model of signal.models) {
    pushUnique(customer.watchedModels, model);
    pushUnique(customer.tags, model);
  }
  const recommendations = recommendQuotes(state, customer, 2);
  const playbook = buildSalesPlaybook(customer, signal, recommendations, state.salesSamples || []);
  appendEvent(state, customerId, {
    channel: "销售企微",
    type: "客户回复",
    text: message
  });
  customer.stage = signal.intent === "会员卡咨询" ? "销售跟进" : customer.stage;
  customer.intentScore = Math.max(safeNumber(customer.intentScore, 0), signal.confidence);
  appendTask(state, customerId, {
    title: `${customer.targetCard}销售跟进`,
    ownerRole: "销售",
    owner: String(customer.owner || "").includes("销售") ? customer.owner : "销售队列",
    priority: signal.priority,
    sla: signal.priority === "高" ? "1小时" : "4小时",
    reason: `${playbook.handoffSummary} ${playbook.closingSuggestion}`
  });
  const result = {
    agent: "销售承接Agent",
    need: signal.intent,
    detectedModels: signal.models,
    recommendedCard: customer.targetCard,
    quoteRecommendations: recommendations,
    playbook,
    handoffPackage: {
      customer: customer.name,
      stage: customer.stage,
      intentScore: customer.intentScore,
      watchedModels: customer.watchedModels,
      summary: playbook.handoffSummary
    },
    objection: playbook.objection,
    learnedTactics: playbook.learnedTactics,
    humanRequired: signal.intent === "会员卡咨询" || signal.priority === "高",
    suggestedReply: `${playbook.openingQuestion}${playbook.valueProof} 可参考话术：${playbook.winningPhrase}`
  };
  state.agentRuns.unshift(result);
  return { state, result };
}

export function runVipAgent(inputState, customerId, message) {
  const state = cloneState(inputState);
  const customer = requireCustomer(state, customerId);
  ensureCustomerLists(customer);
  const signal = classifyMessage(message, state);
  const conversationContext = buildConversationContext(state, customerId, "VIP群");
  for (const model of signal.models) {
    pushUnique(customer.watchedModels, model);
  }
  appendEvent(state, customerId, {
    channel: "VIP群",
    type: "群内提问",
    text: message
  });
  customer.stage = "VIP维护";
  const mentionedRole = signal.mentions[0] || "未明确@";
  const mentionMismatch = mentionedRole !== "未明确@" && mentionedRole !== signal.role;
  const sameIntentCount = conversationContext.recentMessages.filter((item) => item.intent === signal.intent).length;
  const pendingSameRoleTask = conversationContext.unresolvedTasks.find((task) => task.ownerRole === signal.role || task.title.includes(signal.intent));
  const repeatedIssue = sameIntentCount >= 2 || Boolean(pendingSameRoleTask);
  const routedPriority = repeatedIssue || signal.priority === "高" ? "高" : signal.priority;
  appendTask(state, customerId, {
    title: `VIP群${signal.intent}分流`,
    ownerRole: signal.role,
    owner: `${signal.role}值班`,
    priority: routedPriority,
    sla: routedPriority === "高" ? "30分钟" : "2小时",
    reason: `群内消息识别为${signal.intent}，${mentionMismatch ? `客户@了${mentionedRole}但应转${signal.role}` : `建议由${signal.role}处理`}${repeatedIssue ? "；结合上下文判断为重复/未结问题，需要优先处理" : ""}。`
  });
  const autoReplyAllowed = signal.intent !== "风险/投诉" && signal.confidence >= 75;
  const result = {
    agent: "VIP群分流Agent",
    intent: signal.intent,
    routeTo: signal.role,
    mentionedRole,
    mentionMismatch,
    detectedModels: signal.models,
    priority: routedPriority,
    confidence: signal.confidence,
    repeatedIssue,
    sameIntentCount,
    pendingTask: pendingSameRoleTask || null,
    conversationContext,
    autoReplyAllowed,
    contextSummary: `客户${customer.name}在VIP群提出${signal.intent}${signal.models.length ? `，涉及${signal.models.join("、")}` : ""}；已读取近${conversationContext.recentMessages.length}条上下文，同类问题${sameIntentCount}次，未完成任务${conversationContext.unresolvedTasks.length}个。`,
    suggestedReply: autoReplyAllowed
      ? `已结合近${conversationContext.recentMessages.length}条上下文识别这是${signal.intent}，${mentionMismatch ? `我会从${mentionedRole}转给${signal.role}` : `我会同步给${signal.role}`}处理${repeatedIssue ? "，该问题已有上下文或未结任务，我会标记优先跟进" : ""}。`
      : "该问题需要人工确认后回复。"
  };
  state.agentRuns.unshift(result);
  return { state, result };
}

export function runQuoteAgent(inputState, customerId) {
  const state = cloneState(inputState);
  const customer = requireCustomer(state, customerId);
  ensureCustomerLists(customer);
  const recommendations = recommendQuotes(state, customer, 3);
  appendEvent(state, customerId, {
    channel: "报价页",
    type: "报价推荐",
    text: recommendations.length
      ? `推荐${recommendations.map((item) => `${item.model} ${item.config}`).join("、")}。`
      : "暂无精确型号推荐，建议查看全部报价。"
  });
  const result = {
    agent: "报价推荐Agent",
    recommendations,
    pushCopy: recommendations.length
      ? `${customer.contact || customer.name}，您关注的${recommendations.map((item) => item.model).join("、")}有新报价，可进入报价页筛选配置。`
      : `${customer.contact || customer.name}，本周报价已更新，可先查看全部报价。`,
    nextAction: recommendations.length ? "生成个性化报价页文案并记录本地推荐事件" : "生成通用报价页文案",
    subscriptionModels: customer.watchedModels
  };
  state.agentRuns.unshift(result);
  return { state, result };
}

export function runOrchestratorAgent(inputState) {
  const state = cloneState(inputState);
  const plans = state.customers.map((customer) => buildCustomerPlan(state, customer));
  for (const plan of plans) {
    const customer = getCustomer(state, plan.customerId);
    customer.nextBestAction = plan.objective;
    customer.recommendedChannel = plan.channel;
    customer.handoffSummary = plan.suggestedMessage;
    customer.health = plan.health;
    appendTask(state, customer.id, {
      title: plan.taskTitle,
      ownerRole: plan.ownerRole,
      owner: `${plan.ownerRole}队列`,
      priority: plan.priority,
      sla: plan.priority === "高" ? "1小时" : "4小时",
      reason: `${plan.objective}；${plan.suggestedMessage}`
    });
    appendEvent(state, customer.id, {
      channel: "闭环编排",
      type: "下一步动作",
      text: `${plan.channel} · ${plan.objective}`
    });
  }
  state.workflowPlans = plans;
  const result = {
    agent: "闭环编排Agent",
    totalPlans: plans.length,
    highPriority: plans.filter((plan) => plan.priority === "高").length,
    nextAction: "生成客户下一步动作、任务和交接摘要",
    plans
  };
  state.agentRuns.unshift(result);
  return { state, result };
}

export function updateTaskStatus(inputState, taskId, status) {
  const state = cloneState(inputState);
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`Task not found: ${taskId || "empty"}`);
  task.status = status;
  ensureTaskTiming(task);
  if (status === "已完成" && !task.completedAt) task.completedAt = new Date().toISOString();
  appendEvent(state, task.customerId, {
    channel: "任务中心",
    type: "任务更新",
    text: `${task.title} 已更新为 ${status}。`
  });
  return state;
}

export function subscribeQuote(inputState, customerId, model) {
  const state = cloneState(inputState);
  const customer = requireCustomer(state, customerId);
  ensureCustomerLists(customer);
  const cleanModel = String(model || "").trim();
  if (!cleanModel) throw new Error("Quote model is required");
  if (!customer.watchedModels.includes(cleanModel)) {
    customer.watchedModels.push(cleanModel);
  }
  if (!customer.tags.includes("报价订阅")) {
    customer.tags.push("报价订阅");
  }
  appendEvent(state, customerId, {
    channel: "报价页",
    type: "型号订阅",
    text: `客户订阅了 ${cleanModel} 报价提醒。`
  });
  return state;
}
