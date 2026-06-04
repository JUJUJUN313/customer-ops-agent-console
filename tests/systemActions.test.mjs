import test from "node:test";
import assert from "node:assert/strict";

import {
  batchUpdateOutboundDraftsAction,
  batchUpdateTasksAction,
  buildCapabilityAudit,
  buildModelConfigReport,
  buildOutboundDraftReport,
  buildPersonalWechatReport,
  buildTaskSlaReport,
  buildWecomConfigReport,
  confirmPersonalWechatSendJobAction,
  createCustomerAction,
  createOutboundDraftAction,
  createSalesSampleAction,
  createTaskAction,
  diagnoseState,
  enhanceLatestAgentRunWithLlmAction,
  escalateOverdueTasksAction,
  failPersonalWechatSendJobAction,
  ingestMessageAction,
  ingestPersonalWechatMessageAction,
  ingestWecomArchiveMessageAction,
  recordOutcomeAction,
  runAgentAction,
  runDemoAction,
  runPersonalWechatSendSchedulerAction,
  runWorkflowAction,
  seedState,
  sendOutboundDraftToWecomAction,
  sendWecomTestAction,
  subscribeQuoteAction,
  testWecomAibotConfigAction,
  testModelConnectionAction,
  updateCustomerAction,
  updateModelConfigAction,
  updateOutboundDraftStatusAction,
  updatePersonalWechatConfigAction,
  updateTaskAction,
  updateTemplateAction,
  updateWecomConfigAction,
  updateWecomGroupBindingAction,
  ingestWecomMessageAction,
  upsertQuoteAction
} from "../src/systemActions.js";

test("系统动作能串起Agent、渠道消息、任务和报价订阅", () => {
  let state = seedState();
  assert.equal(state.customers.length, 18);

  state = runAgentAction(state, "dialer", { customerId: "c002" });
  assert.ok(state.agentRuns.some((run) => run.agent === "外呼筛选Agent"));

  state = ingestMessageAction(state, {
    customerId: "c003",
    channel: "VIP模拟群",
    message: "@销售 有两台售后维修怎么处理？",
    senderRole: "客户",
    senderName: "周总"
  });
  assert.ok(state.tasks.some((task) => task.ownerRole === "售后"));
  const vipConversation = state.conversations.find((conversation) => conversation.customerId === "c003" && conversation.channel === "VIP模拟群");
  assert.ok(vipConversation.messages.some((message) => message.text.includes("售后维修") && message.mentions.includes("销售")));
  assert.equal(state.agentRuns[0].repeatedIssue, true);

  const task = state.tasks[0];
  state = updateTaskAction(state, task.id, "已完成");
  assert.equal(state.tasks.find((item) => item.id === task.id).status, "已完成");

  state = subscribeQuoteAction(state, "c001", "Mate60");
  assert.ok(state.customers.find((customer) => customer.id === "c001").watchedModels.includes("Mate60"));
  assert.ok(state.auditLog.length >= 5);
});

test("任务中心支持批量状态更新并写入事件和审计", () => {
  let state = seedState();
  const taskIds = state.tasks.slice(0, 3).map((task) => task.id);
  state = batchUpdateTasksAction(state, { taskIds, status: "跟进中" });
  for (const taskId of taskIds) {
    assert.equal(state.tasks.find((task) => task.id === taskId).status, "跟进中");
  }
  assert.ok(state.events.some((event) => event.channel === "任务中心" && event.type === "任务更新"));
  assert.ok(state.auditLog.some((item) => item.action === "批量更新任务状态"));

  state = batchUpdateTasksAction(state, { taskIds, status: "已完成" });
  for (const taskId of taskIds) {
    const task = state.tasks.find((item) => item.id === taskId);
    assert.equal(task.status, "已完成");
    assert.ok(task.completedAt);
  }
  assert.throws(() => batchUpdateTasksAction(state, { taskIds: [], status: "已完成" }), /Task ids are required/);
  assert.throws(() => batchUpdateTasksAction(state, { taskIds, status: "关闭" }), /Invalid task status/);
});

test("批量本地Agent会同时产生多类Agent输出并记录执行边界", () => {
  const state = runDemoAction(seedState());
  const agents = new Set(state.agentRuns.map((run) => run.agent));
  assert.ok(agents.has("外呼筛选Agent"));
  assert.ok(agents.has("电销培育Agent"));
  assert.ok(agents.has("销售承接Agent"));
  assert.ok(agents.has("VIP群分流Agent"));
  assert.ok(agents.has("报价推荐Agent"));
  assert.ok(agents.has("闭环编排Agent"));
  assert.equal(state.workflowPlans.length, state.customers.length);
  assert.ok(state.agentRuns.every((run) => run.execution?.engine === "本地规则引擎"));
  assert.ok(state.agentRuns.every((run) => run.execution?.modelInvocation === "未调用"));
  assert.ok(state.agentRuns.every((run) => run.execution?.externalSideEffects === false));
});

test("运营管理动作能维护客户、任务、报价和模板", () => {
  let state = seedState();
  state = createCustomerAction(state, {
    name: "苏州云启通讯",
    contact: "张总",
    tags: "iPhone 15, 潜在意向",
    watchedModels: "iPhone 15",
    tradeVolume: 500000
  });
  const customer = state.customers[0];
  assert.equal(customer.name, "苏州云启通讯");

  state = updateCustomerAction(state, customer.id, {
    stage: "销售企微承接",
    owner: "销售三组",
    intentScore: "77",
    tags: "iPhone 15, 明确意向"
  });
  assert.equal(state.customers[0].owner, "销售三组");
  assert.equal(state.customers[0].intentScore, 77);
  assert.equal(state.selectedCustomerId, customer.id);

  state = recordOutcomeAction(state, {
    customerId: customer.id,
    outcome: "成交",
    memberStatus: "平台金卡"
  });
  assert.equal(state.customers[0].stage, "已购会员");
  assert.equal(state.customers[0].memberStatus, "平台金卡");
  assert.ok(state.tasks.some((task) => task.title === "成交客户建立VIP维护小群"));

  state = createTaskAction(state, {
    customerId: customer.id,
    title: "建立VIP小群",
    ownerRole: "私域",
    priority: "高",
    sla: "30分钟"
  });
  assert.equal(state.tasks[0].title, "建立VIP小群");
  assert.ok(state.tasks[0].createdAt);
  assert.ok(state.tasks[0].dueAt);

  state = upsertQuoteAction(state, {
    brand: "Apple",
    model: "iPhone 16",
    config: "256G",
    price: "6999",
    stock: "少量",
    validUntil: "2026-06-10"
  });
  assert.equal(state.quotes[0].model, "iPhone 16");

  state = updateTemplateAction(state, "tpl_price_commit", { allowed: true });
  assert.equal(state.templates.find((template) => template.id === "tpl_price_commit").allowed, true);

  state = updateTemplateAction(state, "tpl_price_commit", { allowed: "false" });
  assert.equal(state.templates.find((template) => template.id === "tpl_price_commit").allowed, false);
});

test("任务SLA报表能识别超时并执行主管升级", () => {
  let state = seedState();
  state.tasks[0].createdAt = "2026-06-02T00:00:00.000Z";
  state.tasks[0].dueAt = "2026-06-02T00:10:00.000Z";
  state.tasks[0].status = "待处理";
  state.tasks[0].escalated = false;

  let report = buildTaskSlaReport(state, "2026-06-02T01:00:00.000Z");
  assert.equal(report.summary.overdue, 1);
  assert.equal(report.tasks.find((task) => task.id === state.tasks[0].id).slaState, "已超时");

  state = escalateOverdueTasksAction(state, { now: "2026-06-02T01:00:00.000Z" });
  const task = state.tasks[0];
  assert.equal(task.escalated, true);
  assert.equal(task.ownerRole, "主管");
  assert.equal(task.owner, "主管队列");
  assert.equal(task.priority, "高");
  assert.ok(task.reason.includes("SLA升级"));
  assert.ok(state.events.some((event) => event.type === "任务超时升级"));

  const afterSecondRun = escalateOverdueTasksAction(state, { now: "2026-06-02T01:30:00.000Z" });
  assert.equal(afterSecondRun.events.filter((event) => event.type === "任务超时升级").length, state.events.filter((event) => event.type === "任务超时升级").length);

  report = buildTaskSlaReport(afterSecondRun, "2026-06-02T01:30:00.000Z");
  assert.equal(report.summary.escalated, 1);
});

test("任务完成会记录完成时间并保持SLA报表稳定", () => {
  let state = seedState();
  const taskId = state.tasks[0].id;
  state = updateTaskAction(state, taskId, "已完成");
  const task = state.tasks.find((item) => item.id === taskId);
  assert.equal(task.status, "已完成");
  assert.ok(task.completedAt);
  const report = buildTaskSlaReport(state, "2026-06-02T01:00:00.000Z");
  assert.equal(report.tasks.find((item) => item.id === taskId).slaState, "已完成");
  assert.equal(report.summary.completed, 1);
});

test("运营动作会校验客户、任务、报价和模板输入", () => {
  const state = seedState();

  assert.throws(() => runAgentAction(state, "dialer", { customerId: "missing" }), /Customer not found/);
  assert.throws(() => updateTaskAction(state, "missing", "已完成"), /Task not found/);
  assert.throws(() => updateTaskAction(state, "t001", "关闭"), /Invalid task status/);
  assert.throws(() => subscribeQuoteAction(state, "c001", ""), /Quote model is required/);
  assert.throws(() => createTaskAction(state, { customerId: "missing" }), /Customer not found/);
  assert.throws(() => createTaskAction(state, { customerId: "c001", priority: "紧急" }), /Invalid task priority/);
  assert.throws(() => createTaskAction(state, { customerId: "c001", ownerRole: "外包" }), /Invalid owner role/);
  assert.throws(() => createCustomerAction(state, { name: "坏阶段客户", stage: "不存在阶段" }), /Invalid customer stage/);
  assert.throws(() => createCustomerAction(state, { name: "坏风险客户", risk: "极高" }), /Invalid customer risk/);
  assert.throws(() => updateCustomerAction(state, "c001", { stage: "不存在阶段" }), /Invalid customer stage/);
  assert.throws(() => recordOutcomeAction(state, { customerId: "c001", outcome: "未知结果" }), /Invalid sales outcome/);
  assert.throws(() => upsertQuoteAction(state, { model: "Bad", price: "-1" }), /non-negative/);
  assert.throws(() => updateCustomerAction(state, "c001", { risk: "极高" }), /Invalid customer risk/);
  assert.throws(() => updateTemplateAction(state, "tpl_welcome", { risk: "极高" }), /Invalid template risk/);
  assert.throws(() => ingestMessageAction(state, { customerId: "c003", channel: "VIP模拟群", message: "测试", senderRole: "访客" }), /Invalid sender role/);
  assert.throws(() => buildTaskSlaReport(state, "坏时间"), /Invalid reference time/);
  assert.throws(() => escalateOverdueTasksAction(state, { now: "坏时间" }), /Invalid reference time/);
});

test("客户档案更新会清洗意向分并保持列表字段稳定", () => {
  let state = seedState();
  state.customers[0].intentScore = 72;
  delete state.customers[0].tags;
  delete state.customers[0].watchedModels;

  state = updateCustomerAction(state, "c001", {
    intentScore: "不是数字",
    tags: "Mate60, 明确意向",
    watchedModels: "Mate60"
  });

  assert.equal(state.customers[0].intentScore, 72);
  assert.deepEqual(state.customers[0].tags, ["Mate60", "明确意向"]);
  assert.deepEqual(state.customers[0].watchedModels, ["Mate60"]);

  state = updateCustomerAction(state, "c001", { intentScore: "999" });
  assert.equal(state.customers[0].intentScore, 100);
});

test("销售结果和报价订阅能处理缺失标签列表的脏客户", () => {
  let state = seedState();
  delete state.customers[0].tags;
  delete state.customers[0].watchedModels;
  state.customers[0].intentScore = "坏分数";

  state = recordOutcomeAction(state, { customerId: "c001", outcome: "无效" });
  assert.equal(state.customers[0].intentScore, 30);
  assert.ok(state.customers[0].tags.includes("无效"));

  state = subscribeQuoteAction(state, "c001", "Mate60");
  assert.ok(state.customers[0].watchedModels.includes("Mate60"));
  assert.ok(state.customers[0].tags.includes("报价订阅"));
});

test("状态集合缺失时系统动作仍能保持可恢复", () => {
  let state = seedState();
  delete state.events;
  delete state.tasks;
  delete state.auditLog;

  state = createTaskAction(state, {
    customerId: "c001",
    title: "集合缺失恢复任务",
    ownerRole: "销售",
    priority: "中"
  });

  assert.equal(Array.isArray(state.events), true);
  assert.equal(Array.isArray(state.tasks), true);
  assert.equal(Array.isArray(state.auditLog), true);
  assert.equal(state.tasks[0].title, "集合缺失恢复任务");
  assert.ok(state.events[0].createdAt);

  const report = diagnoseState({
    selectedCustomerId: "c001",
    customers: state.customers,
    events: null,
    tasks: null,
    quotes: null,
    templates: null,
    agentRuns: null,
    conversations: null,
    salesSamples: null,
    workflowPlans: null,
    auditLog: null
  });
  assert.equal(report.summary.tasks, 0);
  assert.ok(report.checks.some((item) => item.name === "审计日志存在" && item.status === "失败"));
});

test("模型配置支持全局默认和Agent独立覆盖", () => {
  let state = seedState();
  let report = buildModelConfigReport(state);
  assert.equal(report.summary.inherited, 6);
  assert.equal(report.summary.overridden, 0);
  assert.equal(report.agents.find((item) => item.key === "sales").effective.model, "deepseek-v4-flash");
  assert.equal(report.global.apiKeyConfigured, false);

  state = updateModelConfigAction(state, {
    global: {
      provider: "统一模型网关",
      apiUrl: "https://api.example.com/v1",
      apiKey: "sk-global-secret",
      model: "global-system-model",
      temperature: "0.3",
      maxTokens: "4096"
    },
    voice: {
      asr: {
        provider: "语音识别网关",
        apiUrl: "https://voice.example.com/asr",
        apiKey: "asr-secret",
        model: "asr-large",
        language: "zh-CN"
      },
      tts: {
        provider: "语音合成网关",
        apiUrl: "https://voice.example.com/tts",
        apiKey: "tts-secret",
        model: "tts-pro",
        voice: "female-a",
        speed: "1.2"
      }
    },
    agents: {
      sales: {
        provider: "销售专用网关",
        apiUrl: "https://sales.example.com/v1",
        apiKey: "sk-sales-secret",
        model: "sales-agent-model",
        temperature: "0.65",
        maxTokens: "8192"
      }
    }
  });

  report = buildModelConfigReport(state);
  const salesModel = report.agents.find((item) => item.key === "sales").effective;
  const quoteModel = report.agents.find((item) => item.key === "quote").effective;
  assert.equal(report.summary.overridden, 1);
  assert.equal(report.summary.globalApiKeyConfigured, true);
  assert.equal(report.summary.voiceModelsConfigured, 2);
  assert.equal(salesModel.source, "Agent独立配置");
  assert.equal(salesModel.apiUrl, "https://sales.example.com/v1");
  assert.equal(salesModel.apiKeyConfigured, true);
  assert.equal(salesModel.model, "sales-agent-model");
  assert.equal(salesModel.temperature, 0.65);
  assert.equal(quoteModel.source, "全局默认");
  assert.equal(quoteModel.apiUrl, "https://api.example.com/v1");
  assert.equal(quoteModel.model, "global-system-model");
  assert.equal(report.global.apiKey, "");
  assert.ok(report.global.apiKeyMasked.includes("sk-g"));
  assert.equal(report.voice.asr.model, "asr-large");

  state = runAgentAction(state, "sales", { customerId: "c002", message: "黑金卡本周可以定" });
  assert.equal(state.agentRuns[0].customerId, "c002");
  assert.equal(state.agentRuns[0].customerName, "杭州锐采科技");
  assert.equal(state.agentRuns[0].modelConfig.model, "sales-agent-model");
  assert.equal(state.agentRuns[0].modelConfig.apiUrl, "https://sales.example.com/v1");
  assert.equal(state.agentRuns[0].modelConfig.apiKeyConfigured, true);
  assert.equal(state.agentRuns[0].modelConfig.source, "Agent独立配置");
  assert.equal(state.agentRuns[0].execution.engine, "本地规则引擎");
  assert.equal(state.agentRuns[0].execution.modelInvocation, "未调用");
  assert.equal(state.agentRuns[0].execution.modelRoute.model, "sales-agent-model");
  assert.equal(state.agentRuns[0].execution.modelRoute.apiKeyConfigured, true);
  assert.match(state.agentRuns[0].execution.boundary, /未启用真实LLM增强/);

  state = runAgentAction(state, "quote", { customerId: "c001" });
  assert.equal(state.agentRuns[0].modelConfig.model, "global-system-model");
  assert.equal(state.agentRuns[0].modelConfig.source, "全局默认");
  assert.equal(state.agentRuns[0].execution.externalSideEffects, false);
});

test("模型连接测试和LLM增强会真实走OpenAI兼容请求并保留本地边界", async () => {
  let state = seedState();
  let missing = await testModelConnectionAction(state, { agentKey: "global" }, {
    fetchImpl: async () => {
      throw new Error("should not call fetch without key");
    }
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, "配置缺失");
  assert.match(missing.error, /API Key/);

  state = updateModelConfigAction(state, {
    global: {
      provider: "OpenAI兼容测试网关",
      apiUrl: "https://api.example.com/v1",
      apiKey: "sk-test-key",
      model: "test-chat-model",
      temperature: "0.3",
      maxTokens: "1024"
    }
  });

  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body), auth: options.headers.Authorization });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: "客户判断：高意向。建议下一步：销售确认权益。可发送草稿：我先帮您整理本周报价和会员权益。" } }],
        usage: { prompt_tokens: 20, completion_tokens: 18, total_tokens: 38 }
      })
    };
  };

  const testResult = await testModelConnectionAction(state, { agentKey: "global", prompt: "连接测试" }, { fetchImpl: fakeFetch, timeoutMs: 1000 });
  assert.equal(testResult.ok, true);
  assert.equal(testResult.status, "连接成功");
  assert.equal(calls[0].url, "https://api.example.com/v1/chat/completions");
  assert.equal(calls[0].auth, "Bearer sk-test-key");
  assert.equal(calls[0].body.model, "test-chat-model");
  assert.equal(testResult.modelConfig.apiKeyConfigured, true);

  state = runAgentAction(state, "sales", { customerId: "c002", message: "黑金卡权益和稳定货源可以聊一下" });
  state = await enhanceLatestAgentRunWithLlmAction(state, "sales", {
    customerId: "c002",
    message: "黑金卡权益和稳定货源可以聊一下"
  }, { fetchImpl: fakeFetch, timeoutMs: 1000 });

  assert.equal(state.agentRuns[0].llmEnhancement.status, "成功");
  assert.equal(state.agentRuns[0].execution.modelInvocation, "已调用");
  assert.equal(state.agentRuns[0].execution.llmExternalCall, true);
  assert.equal(state.agentRuns[0].execution.externalSideEffects, false);
  assert.ok(state.agentRuns[0].llmDraftId);
  assert.ok(state.outboundDrafts.some((draft) => draft.id === state.agentRuns[0].llmDraftId && draft.sourceAgent.includes("LLM增强")));
  assert.ok(calls.length >= 2);
});

test("模型配置校验会拒绝空全局模型并允许清空Agent覆盖", () => {
  let state = seedState();
  assert.throws(() => updateModelConfigAction(state, { global: { model: "" } }), /Global model is required/);

  state = updateModelConfigAction(state, {
    global: { provider: "统一模型网关", apiUrl: "https://api.example.com/v1", model: "global-system-model" },
    agents: { vip: { apiUrl: "https://vip.example.com/v1", model: "vip-agent-model", temperature: "9", maxTokens: "1" } }
  });
  let report = buildModelConfigReport(state);
  let vipModel = report.agents.find((item) => item.key === "vip").effective;
  assert.equal(vipModel.model, "vip-agent-model");
  assert.equal(vipModel.apiUrl, "https://vip.example.com/v1");
  assert.equal(vipModel.temperature, 2);
  assert.equal(vipModel.maxTokens, 256);

  state = updateModelConfigAction(state, { agents: { vip: { model: "" } } });
  report = buildModelConfigReport(state);
  vipModel = report.agents.find((item) => item.key === "vip").effective;
  assert.equal(vipModel.model, "global-system-model");
  assert.equal(vipModel.apiUrl, "https://api.example.com/v1");
  assert.equal(vipModel.source, "全局默认");

  const diagnostics = diagnoseState(state);
  assert.ok(diagnostics.checks.some((item) => item.name === "模型配置可用" && item.status === "通过"));
  assert.ok(diagnostics.checks.some((item) => item.name === "模型API Key已配置" && item.status === "警告"));
  assert.throws(() => updateModelConfigAction(state, { global: { apiUrl: "ftp://bad-url" } }), /Invalid API URL/);
});

test("模型配置保存会保留空Key并支持显式清空Agent覆盖", () => {
  let state = seedState();
  state = updateModelConfigAction(state, {
    global: {
      provider: "统一模型网关",
      apiUrl: "https://api.example.com/v1",
      apiKey: "sk-global-secret",
      model: "global-system-model"
    },
    voice: {
      asr: {
        provider: "语音识别网关",
        apiUrl: "https://voice.example.com/asr",
        apiKey: "asr-secret",
        model: "asr-large"
      }
    },
    agents: {
      sales: {
        provider: "销售专用网关",
        apiUrl: "https://sales.example.com/v1",
        apiKey: "sk-sales-secret",
        model: "sales-agent-model"
      }
    }
  });

  state = updateModelConfigAction(state, {
    global: {
      provider: "统一模型网关",
      apiUrl: "https://api.example.com/v1",
      apiKey: "",
      model: "global-system-model-v2"
    },
    voice: {
      asr: {
        apiKey: "",
        model: "asr-large-v2"
      }
    },
    agents: {
      sales: {
        provider: "销售专用网关",
        apiUrl: "https://sales.example.com/v1",
        apiKey: "",
        model: "sales-agent-model-v2"
      }
    }
  });

  let report = buildModelConfigReport(state);
  const salesModel = report.agents.find((item) => item.key === "sales");
  assert.equal(report.summary.globalApiKeyConfigured, true);
  assert.equal(report.global.model, "global-system-model-v2");
  assert.equal(report.voice.asr.apiKeyConfigured, true);
  assert.equal(report.voice.asr.model, "asr-large-v2");
  assert.equal(salesModel.effective.apiKeyConfigured, true);
  assert.equal(salesModel.effective.model, "sales-agent-model-v2");
  assert.equal(report.global.apiKey, "");
  assert.equal(salesModel.override.apiKey, "");

  state = updateModelConfigAction(state, {
    global: { clearApiKey: true },
    voice: { asr: { clearApiKey: true } },
    agents: { sales: { clearApiKey: true } }
  });
  report = buildModelConfigReport(state);
  const keyClearedSalesModel = report.agents.find((item) => item.key === "sales");
  assert.equal(report.summary.globalApiKeyConfigured, false);
  assert.equal(report.voice.asr.apiKeyConfigured, false);
  assert.equal(keyClearedSalesModel.override.apiKeyConfigured, false);
  assert.equal(keyClearedSalesModel.effective.apiKeyConfigured, false);
  assert.equal(keyClearedSalesModel.effective.model, "sales-agent-model-v2");

  state = updateModelConfigAction(state, { agents: { sales: { clear: true } } });
  report = buildModelConfigReport(state);
  const clearedSalesModel = report.agents.find((item) => item.key === "sales");
  assert.equal(clearedSalesModel.effective.source, "全局默认");
  assert.equal(clearedSalesModel.override.apiKeyConfigured, false);
  assert.equal(clearedSalesModel.effective.model, "global-system-model-v2");
});

test("触达草稿队列会记录Agent草稿和人工处理状态", () => {
  let state = seedState();
  state = runAgentAction(state, "sales", { customerId: "c002", message: "黑金卡权益和稳定货源可以聊一下" });
  assert.equal(state.outboundDrafts.length, 1);
  assert.equal(state.outboundDrafts[0].customerId, "c002");
  assert.equal(state.outboundDrafts[0].sourceAgent, "销售承接Agent");
  assert.equal(state.outboundDrafts[0].status, "待确认");
  assert.equal(state.outboundDrafts[0].externalSideEffects, false);
  assert.equal(state.agentRuns[0].outboundDraftId, state.outboundDrafts[0].id);

  let report = buildOutboundDraftReport(state);
  assert.equal(report.summary.pending, 1);
  assert.equal(report.drafts[0].customerName, "杭州锐采科技");

  state = updateOutboundDraftStatusAction(state, state.outboundDrafts[0].id, { status: "已复制", note: "已复制给销售人工处理" });
  assert.equal(state.outboundDrafts[0].status, "已复制");
  assert.ok(state.outboundDrafts[0].copiedAt);
  assert.ok(state.events.some((event) => event.type === "草稿状态更新"));

  state = createOutboundDraftAction(state, {
    customerId: "c001",
    channel: "短信",
    draftType: "报价提醒",
    content: "陈总，iPhone 13报价已更新，您可以安排人工确认后再发送。",
    priority: "高"
  });
  report = buildOutboundDraftReport(state);
  assert.equal(report.summary.total, 2);
  assert.equal(report.drafts[0].channel, "短信");
  const diagnostics = diagnoseState(state);
  assert.ok(diagnostics.checks.some((item) => item.name === "触达草稿可用" && item.status === "通过"));
});

test("触达草稿支持批量确认、关闭并保持无外部副作用", () => {
  let state = seedState();
  state = createOutboundDraftAction(state, {
    customerId: "c001",
    channel: "短信",
    draftType: "报价提醒",
    content: "陈总，iPhone 13报价已更新，人工确认后再发送。",
    priority: "中"
  });
  state = createOutboundDraftAction(state, {
    customerId: "c002",
    channel: "企微私聊",
    draftType: "会员权益跟进",
    content: "李经理，黑金卡权益可安排销售进一步介绍。",
    priority: "高"
  });
  const draftIds = state.outboundDrafts.slice(0, 2).map((draft) => draft.id);

  state = batchUpdateOutboundDraftsAction(state, { draftIds, status: "已确认", note: "批量人工审核通过" });
  for (const draftId of draftIds) {
    const draft = state.outboundDrafts.find((item) => item.id === draftId);
    assert.equal(draft.status, "已确认");
    assert.equal(draft.externalSideEffects, false);
    assert.ok(draft.confirmedAt);
  }
  assert.ok(state.auditLog.some((item) => item.action === "批量更新触达草稿"));

  state = batchUpdateOutboundDraftsAction(state, { draftIds, status: "人工已处理", note: "已由人工外部处理" });
  for (const draftId of draftIds) {
    const draft = state.outboundDrafts.find((item) => item.id === draftId);
    assert.equal(draft.status, "人工已处理");
    assert.ok(draft.completedAt);
  }
  assert.throws(() => batchUpdateOutboundDraftsAction(state, { draftIds: [], status: "已确认" }), /Draft ids are required/);
  assert.throws(() => batchUpdateOutboundDraftsAction(state, { draftIds, status: "已发送" }), /Invalid draft status/);
});

test("触达草稿会拒绝非法渠道、非法状态和空内容", () => {
  const state = seedState();
  assert.throws(() => createOutboundDraftAction(state, { customerId: "c001", channel: "飞书", content: "测试" }), /Invalid draft channel/);
  assert.throws(() => createOutboundDraftAction(state, { customerId: "c001", channel: "短信", content: "" }), /Draft content is required/);
  const withDraft = createOutboundDraftAction(state, { customerId: "c001", channel: "短信", content: "测试草稿" });
  assert.throws(() => updateOutboundDraftStatusAction(withDraft, withDraft.outboundDrafts[0].id, { status: "已发送" }), /Invalid draft status/);
  assert.throws(() => updateOutboundDraftStatusAction(withDraft, withDraft.outboundDrafts[0].id, { status: "企微已发送" }), /Use WeCom send action/);

  const broken = seedState();
  broken.outboundDrafts.push({
    id: "draft_bad",
    customerId: "missing",
    channel: "短信",
    draftType: "坏草稿",
    content: "测试",
    priority: "中",
    status: "待确认",
    externalSideEffects: false
  });
  const diagnostics = diagnoseState(broken);
  assert.equal(diagnostics.ok, false);
  assert.ok(diagnostics.checks.some((item) => item.name === "触达草稿可用" && item.status === "失败"));
});

test("企微配置报告会脱敏Webhook并保留已保存密钥", () => {
  let state = seedState();
  state = updateWecomConfigAction(state, {
    enabled: true,
    sendMode: "manualApproval",
    defaultRouteId: "r1",
    routes: [
      {
        id: "r1",
        name: "测试企微群",
        channel: "VIP群",
        webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd1234efgh5678",
        msgtype: "markdown",
        enabled: true
      }
    ],
    inbound: { enabled: true, defaultChannel: "VIP群", secret: "inbound-secret" }
  });

  let report = buildWecomConfigReport(state);
  assert.equal(report.config.routes[0].webhookUrl, "");
  assert.equal(report.config.routes[0].webhookConfigured, true);
  assert.match(report.config.routes[0].webhookMasked, /abcd/);
  assert.equal(report.config.inbound.secret, "");
  assert.equal(report.config.inbound.secretConfigured, true);

  state = updateWecomConfigAction(state, {
    enabled: true,
    routes: [{ id: "r1", name: "测试企微群二", channel: "VIP群", msgtype: "text", enabled: true }],
    inbound: { enabled: true, defaultChannel: "VIP群" }
  });
  report = buildWecomConfigReport(state);
  assert.equal(report.summary.configuredRoutes, 1);
  assert.equal(report.config.routes[0].name, "测试企微群二");
  assert.equal(report.config.routes[0].msgtype, "text");
});

test("企微智能机器人配置会脱敏并保留已保存凭据", () => {
  let state = updateWecomConfigAction(seedState(), {
    aibot: {
      enabled: true,
      botId: "aibot-test-id-123456",
      secret: "secret-for-test",
      defaultCustomerId: "c003",
      defaultChannel: "VIP群",
      autoReply: false,
      heartbeatInterval: 30000,
      maxReconnectAttempts: 10
    }
  });

  let report = buildWecomConfigReport(state);
  assert.equal(report.config.aibot.botId, "");
  assert.equal(report.config.aibot.secret, "");
  assert.equal(report.config.aibot.botIdConfigured, true);
  assert.equal(report.config.aibot.secretConfigured, true);
  assert.match(report.config.aibot.botIdMasked, /^aibo\*+3456$/);
  assert.equal(testWecomAibotConfigAction(state).ok, true);

  state = updateWecomConfigAction(state, {
    aibot: {
      enabled: true,
      defaultCustomerId: "c004",
      defaultChannel: "销售企微"
    }
  });
  report = buildWecomConfigReport(state);
  assert.equal(report.summary.aibotConfigured, true);
  assert.equal(report.config.aibot.defaultCustomerId, "c004");
  assert.equal(report.config.aibot.defaultChannel, "销售企微");
});

test("企微测试发送会调用群机器人Webhook并记录日志", async () => {
  let state = updateWecomConfigAction(seedState(), {
    enabled: true,
    defaultRouteId: "r1",
    routes: [
      {
        id: "r1",
        name: "测试企微群",
        channel: "VIP群",
        webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd1234efgh5678",
        msgtype: "markdown",
        enabled: true
      }
    ]
  });
  let capturedBody = null;
  const fetchImpl = async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      text: async () => JSON.stringify({ errcode: 0, errmsg: "ok" })
    };
  };

  state = await sendWecomTestAction(state, { routeId: "r1", content: "企微测试" }, { fetchImpl });
  assert.equal(capturedBody.msgtype, "markdown");
  assert.equal(capturedBody.markdown.content, "企微测试");
  assert.equal(state.wecomLogs[0].status, "成功");
  assert.equal(state.wecomLogs[0].externalSideEffects, true);
});

test("已确认触达草稿可发送企微并通过自检", async () => {
  let state = updateWecomConfigAction(seedState(), {
    enabled: true,
    defaultRouteId: "r1",
    routes: [
      {
        id: "r1",
        name: "测试企微群",
        channel: "VIP群",
        webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd1234efgh5678",
        msgtype: "text",
        enabled: true
      }
    ]
  });
  state = createOutboundDraftAction(state, {
    customerId: "c003",
    channel: "VIP群",
    draftType: "群内报价提醒",
    content: "周总，今天Mate60报价已更新，请确认是否需要锁定。",
    priority: "中"
  });
  const draftId = state.outboundDrafts[0].id;
  state = updateOutboundDraftStatusAction(state, draftId, { status: "已确认" });

  let capturedBody = null;
  const fetchImpl = async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      text: async () => JSON.stringify({ errcode: 0, errmsg: "ok" })
    };
  };
  state = await sendOutboundDraftToWecomAction(state, draftId, { routeId: "r1" }, { fetchImpl });
  const draft = state.outboundDrafts.find((item) => item.id === draftId);
  assert.equal(capturedBody.msgtype, "text");
  assert.equal(draft.status, "企微已发送");
  assert.equal(draft.externalSideEffects, true);
  assert.equal(draft.wecomDelivery.provider, "wecom-group-robot");
  assert.ok(state.events.some((event) => event.type === "草稿已发送企微"));
  const report = buildOutboundDraftReport(state);
  assert.equal(report.summary.wecomSent, 1);
  const diagnostics = diagnoseState(state);
  assert.equal(diagnostics.ok, true);
});

test("企微模拟入站会进入本地会话和对应Agent", () => {
  const state = ingestWecomMessageAction(seedState(), {
    customerId: "c003",
    channel: "VIP群",
    message: "@售后 今天报价和维修进度同步一下",
    senderRole: "客户",
    senderName: "周总"
  });
  const conversation = state.conversations.find((item) => item.customerId === "c003" && item.channel === "VIP模拟群");
  assert.ok(conversation.messages.at(-1).text.includes("维修进度"));
  assert.equal(state.agentRuns[0].agent, "VIP群分流Agent");
  assert.equal(state.wecomLogs[0].type, "消息入站");
  assert.equal(state.wecomLogs[0].status, "成功");
});

test("企微长连接入站会按chatid独立建档并对msgid去重", () => {
  let state = updateWecomConfigAction(seedState(), {
    aibot: {
      enabled: true,
      botId: "aibot-test",
      secret: "secret-test",
      defaultChannel: "VIP群"
    }
  });
  state = ingestWecomMessageAction(state, {
    source: "wecom-aibot",
    chatId: "chat_alpha",
    externalMessageId: "msg-001",
    senderId: "user-a",
    channel: "VIP群",
    message: "@售后 iPhone 13维修进度同步一下",
    senderRole: "客户",
    senderName: "user-a"
  });

  const binding = state.wecomBindings.groups.find((item) => item.chatId === "chat_alpha");
  assert.ok(binding);
  assert.equal(binding.status, "待绑定");
  assert.ok(binding.customerId);
  assert.ok(state.customers.find((customer) => customer.id === binding.customerId)?.tags.includes("企微群待绑定"));
  const taskCount = state.tasks.length;
  const runCount = state.agentRuns.length;

  state = ingestWecomMessageAction(state, {
    source: "wecom-aibot",
    chatId: "chat_alpha",
    externalMessageId: "msg-001",
    senderId: "user-a",
    channel: "VIP群",
    message: "@售后 iPhone 13维修进度同步一下",
    senderRole: "客户",
    senderName: "user-a"
  });

  assert.equal(state.tasks.length, taskCount);
  assert.equal(state.agentRuns.length, runCount);
  assert.equal(state.wecomLogs[0].type, "重复入站");
  assert.equal(state.wecomLogs[0].deduped, true);
});

test("企微群绑定可以改绑到已有客户并通过自检", () => {
  let state = ingestWecomMessageAction(seedState(), {
    source: "wecom-aibot",
    chatId: "chat_bind",
    externalMessageId: "msg-bind-001",
    senderId: "user-b",
    channel: "VIP群",
    message: "今天Mate60报价有更新吗？",
    senderRole: "客户",
    senderName: "user-b"
  });
  state = updateWecomGroupBindingAction(state, {
    chatId: "chat_bind",
    customerId: "c003",
    channel: "VIP群"
  });
  const binding = state.wecomBindings.groups.find((item) => item.chatId === "chat_bind");
  assert.equal(binding.customerId, "c003");
  assert.equal(binding.status, "已绑定");
  assert.equal(diagnoseState(state).ok, true);
});

test("个人微信AccountAgent低风险入站会生成单账号发送队列并可确认", () => {
  let state = updatePersonalWechatConfigAction(seedState(), {
    enabled: true,
    account: {
      id: "pwx_a",
      name: "个人微信托管号A",
      displayName: "VIP群助手",
      defaultCustomerId: "c003",
      autoReply: true,
      requireApprovalForRisk: true
    }
  });

  state = ingestPersonalWechatMessageAction(state, {
    customerId: "c003",
    roomId: "pwx_room_alpha",
    roomName: "成都VIP外部群",
    messageId: "pwx-msg-001",
    senderType: "customer",
    senderName: "周总",
    text: "收到，我把资料补一下，流程怎么走？"
  });

  assert.equal(state.personalWechat.decisions[0].action, "auto_reply");
  assert.equal(state.personalWechat.decisions[0].riskLevel, "low");
  assert.equal(state.personalWechat.sendJobs[0].status, "queued");
  assert.equal(state.personalWechat.sendJobs[0].accountId, "pwx_a");
  assert.equal(state.personalWechat.groupContexts[0].roomId, "pwx_room_alpha");

  state = confirmPersonalWechatSendJobAction(state, state.personalWechat.sendJobs[0].jobId);

  assert.equal(state.personalWechat.sendJobs[0].status, "confirmed");
  assert.ok(state.personalWechat.sendJobs[0].confirmedAt);
  assert.equal(state.personalWechat.logs[0].type, "发送确认");
  assert.ok(
    state.conversations
      .find((conversation) => conversation.customerId === "c003" && conversation.channel === "VIP模拟群")
      .messages.some((message) => message.senderRole === "私域" && message.text.includes("整理需求"))
  );
  assert.equal(buildPersonalWechatReport(state).summary.confirmedJobs, 1);
  assert.equal(diagnoseState(state).ok, true);
});

test("个人微信AccountAgent高风险内容进入人工确认队列", () => {
  let state = updatePersonalWechatConfigAction(seedState(), {
    enabled: true,
    account: {
      id: "pwx_risk",
      name: "个人微信托管号B",
      displayName: "VIP群助手",
      defaultCustomerId: "c003",
      autoReply: true,
      requireApprovalForRisk: true
    }
  });

  state = ingestPersonalWechatMessageAction(state, {
    customerId: "c003",
    roomId: "pwx_room_risk",
    roomName: "华南VIP外部群",
    messageId: "pwx-risk-001",
    senderType: "customer",
    senderName: "刘总",
    text: "今天Mate60报价发一下，能不能锁价？"
  });

  assert.equal(state.personalWechat.decisions[0].action, "require_approval");
  assert.equal(state.personalWechat.decisions[0].riskLevel, "high");
  assert.equal(state.personalWechat.sendJobs[0].status, "manual_required");
  assert.ok(state.personalWechat.sendJobs[0].replyText.includes("确认后再回复"));
});

test("个人微信AccountAgent会对重复消息去重并在员工回复后取消待发", () => {
  let state = updatePersonalWechatConfigAction(seedState(), {
    enabled: true,
    account: {
      id: "pwx_dedupe",
      name: "个人微信托管号C",
      displayName: "VIP群助手",
      defaultCustomerId: "c003",
      autoReply: true
    }
  });
  const inbound = {
    customerId: "c003",
    roomId: "pwx_room_dedupe",
    roomName: "华东VIP外部群",
    messageId: "pwx-dedupe-001",
    senderType: "customer",
    senderName: "赵总",
    text: "收到，稍后把数量发你"
  };

  state = ingestPersonalWechatMessageAction(state, inbound);
  const jobId = state.personalWechat.sendJobs[0].jobId;
  const decisionCount = state.personalWechat.decisions.length;
  const jobCount = state.personalWechat.sendJobs.length;

  state = ingestPersonalWechatMessageAction(state, inbound);

  assert.equal(state.personalWechat.decisions.length, decisionCount);
  assert.equal(state.personalWechat.sendJobs.length, jobCount);
  assert.equal(state.personalWechat.logs[0].type, "重复入站");

  state = ingestPersonalWechatMessageAction(state, {
    ...inbound,
    messageId: "pwx-staff-001",
    senderType: "staff",
    senderName: "销售同事",
    text: "我来跟进这条"
  });

  assert.equal(state.personalWechat.sendJobs.find((job) => job.jobId === jobId).status, "cancelled");
  assert.equal(state.personalWechat.decisions[0].action, "ignore");
});

test("个人微信发送队列超过过期时间会取消并要求重新判断", () => {
  let state = updatePersonalWechatConfigAction(seedState(), {
    enabled: true,
    account: {
      id: "pwx_expire",
      name: "个人微信托管号D",
      displayName: "VIP群助手",
      defaultCustomerId: "c003",
      autoReply: true,
      maxQueueAgeSeconds: 15
    }
  });

  state = ingestPersonalWechatMessageAction(state, {
    customerId: "c003",
    roomId: "pwx_room_expire",
    roomName: "过期测试VIP外部群",
    messageId: "pwx-expire-001",
    senderType: "customer",
    senderName: "钱总",
    text: "收到，流程我看一下"
  });

  const jobId = state.personalWechat.sendJobs[0].jobId;
  state.personalWechat.sendJobs[0].createdAt = "2026-06-03T00:00:00.000Z";
  const privateReplyCount = state.conversations
    .flatMap((conversation) => conversation.messages || [])
    .filter((message) => message.senderRole === "私域" && message.text.includes("整理需求"))
    .length;

  state = confirmPersonalWechatSendJobAction(state, jobId, { now: "2026-06-03T00:00:20.000Z" });

  const job = state.personalWechat.sendJobs.find((item) => item.jobId === jobId);
  assert.equal(job.status, "cancelled");
  assert.ok(job.error.includes("重新判断"));
  assert.equal(state.personalWechat.groupContexts.find((context) => context.roomId === "pwx_room_expire").pendingSendJobId, "");
  assert.equal(state.personalWechat.logs[0].type, "发送过期");
  assert.equal(
    state.conversations
      .flatMap((conversation) => conversation.messages || [])
      .filter((message) => message.senderRole === "私域" && message.text.includes("整理需求"))
      .length,
    privateReplyCount
  );
});

test("个人微信发送队列会执行单账号限频", () => {
  let state = updatePersonalWechatConfigAction(seedState(), {
    enabled: true,
    account: {
      id: "pwx_rate",
      name: "个人微信托管号E",
      displayName: "VIP群助手",
      defaultCustomerId: "c003",
      autoReply: true,
      minSendIntervalSeconds: 60
    }
  });

  state = ingestPersonalWechatMessageAction(state, {
    customerId: "c003",
    roomId: "pwx_room_rate_a",
    roomName: "限频测试A群",
    messageId: "pwx-rate-001",
    senderType: "customer",
    senderName: "孙总",
    text: "收到，我补充一下信息"
  });
  state = confirmPersonalWechatSendJobAction(state, state.personalWechat.sendJobs[0].jobId, { now: "2026-06-03T01:00:00.000Z" });

  state = ingestPersonalWechatMessageAction(state, {
    customerId: "c003",
    roomId: "pwx_room_rate_b",
    roomName: "限频测试B群",
    messageId: "pwx-rate-002",
    senderType: "customer",
    senderName: "李总",
    text: "流程我也确认一下"
  });
  const secondJobId = state.personalWechat.sendJobs[0].jobId;

  state = confirmPersonalWechatSendJobAction(state, secondJobId, { now: "2026-06-03T01:00:10.000Z" });
  let secondJob = state.personalWechat.sendJobs.find((job) => job.jobId === secondJobId);
  assert.equal(secondJob.status, "queued");
  assert.ok(secondJob.error.includes("限频"));
  assert.equal(state.personalWechat.logs[0].type, "发送限频");

  state = confirmPersonalWechatSendJobAction(state, secondJobId, { now: "2026-06-03T01:01:01.000Z" });
  secondJob = state.personalWechat.sendJobs.find((job) => job.jobId === secondJobId);
  assert.equal(secondJob.status, "confirmed");
  assert.equal(secondJob.error, "");
});

test("企微会话存档入站会进入统一群上下文并去重", () => {
  let state = updateWecomConfigAction(seedState(), {
    archive: {
      enabled: true,
      provider: "企微会话内容存档",
      defaultCustomerId: "c003",
      defaultChannel: "VIP群"
    }
  });

  state = ingestWecomArchiveMessageAction(state, {
    customerId: "c003",
    roomId: "archive_room_alpha",
    roomName: "成都VIP企微外部群",
    messageId: "archive-msg-001",
    senderId: "external_customer_1",
    senderName: "周总",
    senderType: "customer",
    msgType: "text",
    text: "今天售后进度同步一下",
    sendAt: "2026-06-04T10:00:00+08:00",
    cursor: "seq-001"
  });

  assert.equal(state.wecomConfig.archive.status, "运行中");
  assert.equal(state.wecomConfig.archive.cursor, "seq-001");
  assert.equal(state.personalWechat.groupContexts[0].roomId, "archive_room_alpha");
  assert.equal(state.personalWechat.groupContexts[0].messages[0].source, "wecom-archive");
  assert.equal(state.personalWechat.sendJobs[0].source, "wecom-archive");
  assert.equal(state.wecomLogs[0].type, "会话存档入站");

  const jobCount = state.personalWechat.sendJobs.length;
  const decisionCount = state.personalWechat.decisions.length;
  state = ingestWecomArchiveMessageAction(state, {
    customerId: "c003",
    roomId: "archive_room_alpha",
    messageId: "archive-msg-001",
    senderType: "customer",
    text: "今天售后进度同步一下"
  });

  assert.equal(state.personalWechat.sendJobs.length, jobCount);
  assert.equal(state.personalWechat.decisions.length, decisionCount);
  assert.equal(state.personalWechat.logs[0].type, "重复入站");
  assert.equal(diagnoseState(state).ok, true);
});

test("同一群连续客户消息会合并为一个活跃发送任务", () => {
  let state = updatePersonalWechatConfigAction(seedState(), {
    enabled: true,
    account: {
      id: "pwx_merge",
      name: "个人微信托管号F",
      displayName: "VIP群助手",
      defaultCustomerId: "c003",
      autoReply: true,
      mergeWindowSeconds: 60
    }
  });

  state = ingestPersonalWechatMessageAction(state, {
    customerId: "c003",
    roomId: "pwx_room_merge",
    roomName: "合并测试VIP外部群",
    messageId: "pwx-merge-001",
    senderType: "customer",
    senderName: "周总",
    text: "我先看一下",
    sendAt: "2026-06-04T10:00:00+08:00"
  });
  state = ingestPersonalWechatMessageAction(state, {
    customerId: "c003",
    roomId: "pwx_room_merge",
    roomName: "合并测试VIP外部群",
    messageId: "pwx-merge-002",
    senderType: "customer",
    senderName: "周总",
    text: "另外流程也发我一下",
    sendAt: "2026-06-04T10:00:20+08:00"
  });

  const activeJobs = state.personalWechat.sendJobs.filter((job) => ["queued", "manual_required", "sent"].includes(job.status));
  assert.equal(activeJobs.length, 1);
  assert.equal(activeJobs[0].triggerMessageIds.length, 2);
  assert.ok(activeJobs[0].reason.includes("连续客户消息已合并"));

  state = ingestPersonalWechatMessageAction(state, {
    customerId: "c003",
    roomId: "pwx_room_merge",
    roomName: "合并测试VIP外部群",
    messageId: "pwx-merge-003",
    senderType: "customer",
    senderName: "周总",
    text: "今天报价能不能锁价？",
    sendAt: "2026-06-04T10:00:30+08:00"
  });

  const mergedJob = state.personalWechat.sendJobs.find((job) => job.roomId === "pwx_room_merge" && ["queued", "manual_required"].includes(job.status));
  assert.equal(mergedJob.status, "manual_required");
  assert.equal(mergedJob.riskLevel, "high");
  assert.equal(mergedJob.triggerMessageIds.length, 3);
  assert.equal(diagnoseState(state).ok, true);
});

test("SendScheduler按账号并发调度并等待回读确认", () => {
  let state = updatePersonalWechatConfigAction(seedState(), {
    enabled: true,
    account: {
      id: "pwx_scheduler",
      name: "个人微信托管号G",
      displayName: "VIP群助手",
      defaultCustomerId: "c003",
      autoReply: true,
      concurrency: 2,
      minSendIntervalSeconds: 30,
      maxSendsPerMinute: 10
    }
  });

  for (const suffix of ["a", "b", "c"]) {
    state = ingestPersonalWechatMessageAction(state, {
      customerId: "c003",
      roomId: `pwx_room_scheduler_${suffix}`,
      roomName: `调度测试${suffix}群`,
      messageId: `pwx-scheduler-${suffix}`,
      senderType: "customer",
      senderName: "客户",
      text: "收到，我确认一下流程"
    });
  }
  state.personalWechat.sendJobs.forEach((job, index) => {
    job.createdAt = `2026-06-04T10:09:5${index}.000Z`;
  });

  state = runPersonalWechatSendSchedulerAction(state, { now: "2026-06-04T10:10:00.000Z" });

  assert.equal(state.personalWechat.schedulerResult.dispatched.length, 2);
  assert.equal(state.personalWechat.sendJobs.filter((job) => job.status === "sent").length, 2);
  assert.equal(state.personalWechat.sendJobs.filter((job) => job.status === "queued").length, 1);
  assert.equal(state.personalWechat.logs[0].type, "调度发送");

  const sentJob = state.personalWechat.sendJobs.find((job) => job.status === "sent");
  state = confirmPersonalWechatSendJobAction(state, sentJob.jobId, {
    now: "2026-06-04T10:10:05.000Z",
    confirmedMessageId: "archive-confirm-001"
  });

  const confirmedJob = state.personalWechat.sendJobs.find((job) => job.jobId === sentJob.jobId);
  assert.equal(confirmedJob.status, "confirmed");
  assert.equal(confirmedJob.confirmedMessageId, "archive-confirm-001");
  assert.equal(buildPersonalWechatReport(state).summary.sentJobs, 1);
  assert.equal(diagnoseState(state).ok, true);
});

test("SendScheduler会执行分钟上限并记录发送失败退避", () => {
  let state = updatePersonalWechatConfigAction(seedState(), {
    enabled: true,
    account: {
      id: "pwx_limit",
      name: "个人微信托管号H",
      displayName: "VIP群助手",
      defaultCustomerId: "c003",
      autoReply: true,
      concurrency: 3,
      minSendIntervalSeconds: 1,
      maxSendsPerMinute: 1,
      failureBackoffSeconds: 45
    }
  });

  for (const suffix of ["a", "b"]) {
    state = ingestPersonalWechatMessageAction(state, {
      customerId: "c003",
      roomId: `pwx_room_limit_${suffix}`,
      roomName: `限流测试${suffix}群`,
      messageId: `pwx-limit-${suffix}`,
      senderType: "customer",
      senderName: "客户",
      text: "收到，我看一下"
    });
  }
  state.personalWechat.sendJobs.forEach((job, index) => {
    job.createdAt = `2026-06-04T10:59:5${index}.000Z`;
  });

  state = runPersonalWechatSendSchedulerAction(state, { now: "2026-06-04T11:00:00.000Z" });
  assert.equal(state.personalWechat.schedulerResult.dispatched.length, 1);
  assert.equal(state.personalWechat.schedulerResult.skipped.length, 1);
  assert.equal(state.personalWechat.logs[0].type, "分钟限流");

  const sentJob = state.personalWechat.sendJobs.find((job) => job.status === "sent");
  state = failPersonalWechatSendJobAction(state, sentJob.jobId, {
    now: "2026-06-04T11:00:10.000Z",
    error: "Gateway掉线"
  });
  const failedJob = state.personalWechat.sendJobs.find((job) => job.jobId === sentJob.jobId);
  assert.equal(failedJob.status, "failed");
  assert.equal(failedJob.error, "Gateway掉线");
  assert.ok(failedJob.retryAfterAt);
  assert.equal(state.personalWechat.logs[0].type, "发送失败");
  assert.equal(diagnoseState(state).ok, true);
});

test("销售样本能写入并进入能力审计", () => {
  let state = seedState();
  const before = state.salesSamples.length;
  state = createSalesSampleAction(state, {
    scene: "价格敏感黑金卡成交",
    customerStage: "销售企微承接",
    targetCard: "平台黑金卡",
    objection: "价格敏感",
    outcome: "成交",
    qualityScore: "96",
    tags: "价格敏感, 高交易额",
    phrase: "先确认采购周期，再用稳定货源和优先报价解释黑金卡价值。",
    notes: "测试样本"
  });
  assert.equal(state.salesSamples.length, before + 1);
  assert.equal(state.salesSamples[0].qualityScore, 96);
  assert.ok(state.auditLog.some((item) => item.action === "新增销售样本"));

  const audit = buildCapabilityAudit(state);
  const learning = audit.items.find((item) => item.area === "销售技巧学习");
  assert.equal(learning.status, "本地可用");
  assert.match(learning.evidence, /高分成交样本/);
});

test("销售样本输入和自检会拦截异常样本", () => {
  const state = seedState();
  assert.throws(() => createSalesSampleAction(state, { phrase: "" }), /Sales sample phrase is required/);
  assert.throws(() => createSalesSampleAction(state, { phrase: "话术", outcome: "未知" }), /Invalid sales sample outcome/);
  assert.throws(() => createSalesSampleAction(state, { phrase: "话术", customerStage: "未知阶段" }), /Invalid customer stage/);

  const broken = seedState();
  broken.salesSamples.push({
    id: "ss_bad",
    scene: "坏样本",
    customerStage: "销售企微承接",
    targetCard: "平台金卡",
    objection: "价格敏感",
    outcome: "成交",
    qualityScore: 120,
    tags: [],
    phrase: "",
    notes: "坏数据"
  });
  const report = diagnoseState(broken);
  assert.equal(report.ok, false);
  assert.ok(report.checks.some((item) => item.name === "销售样本可用" && item.status === "失败"));
});

test("渠道入站会沉淀会话上下文并拒绝空消息", () => {
  let state = seedState();
  const before = state.conversations.find((conversation) => conversation.customerId === "c003" && conversation.channel === "VIP模拟群").messages.length;
  state = ingestMessageAction(state, {
    customerId: "c003",
    channel: "VIP模拟群",
    message: "@销售 刚才那两台售后有没有进展？",
    senderRole: "客户",
    senderName: "周总"
  });
  const conversation = state.conversations.find((item) => item.customerId === "c003" && item.channel === "VIP模拟群");
  assert.equal(conversation.messages.length, before + 1);
  assert.equal(conversation.messages.at(-1).senderName, undefined);
  assert.equal(conversation.messages.at(-1).sender, "周总");
  assert.equal(state.agentRuns[0].customerId, "c003");
  assert.equal(state.agentRuns[0].customerName, "成都华联通讯");
  assert.ok(state.agentRuns[0].conversationContext.recentMessages.length >= 3);
  assert.throws(() => ingestMessageAction(state, { customerId: "c003", channel: "VIP模拟群", message: "" }), /Channel message is required/);
});

test("闭环编排Agent动作不依赖当前选中客户", () => {
  const state = seedState();
  state.selectedCustomerId = "missing";
  const nextState = runAgentAction(state, "orchestrator", {});
  assert.equal(nextState.workflowPlans.length, nextState.customers.length);
  assert.equal(nextState.selectedCustomerId, "missing");
});

test("重复报价会更新同品牌型号配置而不是新增脏数据", () => {
  let state = seedState();
  const before = state.quotes.length;
  state = upsertQuoteAction(state, {
    brand: "Apple",
    model: "iPhone 13",
    config: "128G",
    price: "3999",
    stock: "紧张",
    validUntil: "2026-06-20"
  });
  assert.equal(state.quotes.length, before);
  const quote = state.quotes.find((item) => item.brand === "Apple" && item.model === "iPhone 13" && item.config === "128G");
  assert.equal(quote.price, 3999);
  assert.equal(quote.stock, "紧张");
});

test("系统诊断能发现正常状态和异常引用", () => {
  const state = seedState();
  let report = diagnoseState(state);
  assert.equal(report.ok, true);
  assert.equal(report.summary.failed, 0);
  assert.ok(report.checks.some((item) => item.name === "任务引用客户有效" && item.status === "通过"));

  const broken = structuredClone(state);
  broken.tasks.push({
    id: "t_broken",
    customerId: "missing",
    title: "异常任务",
    ownerRole: "销售",
    owner: "销售队列",
    priority: "高",
    status: "待处理",
    sla: "2小时",
    reason: "测试异常引用。"
  });
  report = diagnoseState(broken);
  assert.equal(report.ok, false);
  assert.ok(report.checks.some((item) => item.name === "任务引用客户有效" && item.status === "失败"));
});

test("系统诊断会发现非法阶段、任务状态和闭环计划引用", () => {
  const broken = seedState();
  broken.customers.push({ ...broken.customers[0] });
  broken.customers[0].stage = "坏阶段";
  broken.customers[1].intentScore = 101;
  broken.tasks[0].status = "关闭";
  broken.tasks[0].priority = "紧急";
  broken.tasks[0].ownerRole = "外包";
  broken.tasks[0].createdAt = "坏时间";
  broken.tasks[0].dueAt = "坏时间";
  broken.events[0].text = "";
  broken.workflowPlans = [{ customerId: "missing", objective: "坏计划" }];
  broken.conversations.push({ id: "conv_bad", customerId: "missing", channel: "VIP模拟群", messages: [{ id: "m_bad", text: "", senderRole: "" }] });
  const report = diagnoseState(broken);
  assert.equal(report.ok, false);
  for (const name of ["客户ID唯一", "客户阶段有效", "客户意向分有效", "任务状态有效", "任务优先级有效", "任务负责人角色有效", "任务SLA时间有效", "事件内容可用", "会话引用客户有效", "会话消息可用", "闭环计划引用客户有效"]) {
    assert.ok(report.checks.some((item) => item.name === name && item.status === "失败"));
  }
});

test("能力审计会标出本地可用、待配置和未接入能力", () => {
  const audit = buildCapabilityAudit(seedState());
  const statuses = new Set(audit.items.map((item) => item.status));
  assert.ok(statuses.has("本地可用"));
  assert.ok(statuses.has("未接入"));
  assert.ok(statuses.has("待配置"));
  assert.ok(audit.items.some((item) => item.area === "销售技巧学习" && item.status === "本地可用"));
  assert.ok(audit.items.some((item) => item.area === "大模型执行器" && item.status === "待配置"));
  assert.ok(audit.items.some((item) => item.area === "外部触达执行器" && item.status === "未接入"));
});

test("闭环编排动作会生成客户计划并写入审计", () => {
  const state = runWorkflowAction(seedState());
  assert.equal(state.workflowPlans.length, state.customers.length);
  assert.ok(state.agentRuns[0].agent === "闭环编排Agent");
  assert.ok(state.auditLog.some((item) => item.action === "运行闭环编排"));
});
