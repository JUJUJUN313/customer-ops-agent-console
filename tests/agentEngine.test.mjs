import test from "node:test";
import assert from "node:assert/strict";

import {
  buildConversationContext,
  cloneState,
  runDialerAgent,
  runOrchestratorAgent,
  runQuoteAgent,
  runSalesAgent,
  runVipAgent,
  scoreCustomer,
  subscribeQuote,
  updateTaskStatus
} from "../src/agentEngine.js";
import { initialState } from "../src/data.js";

test("外呼筛选Agent会把高价值客户升级到销售链路", () => {
  const state = cloneState(initialState);
  const { state: nextState, result } = runDialerAgent(state, "c002");
  const customer = nextState.customers.find((item) => item.id === "c002");
  assert.equal(result.agent, "外呼筛选Agent");
  assert.equal(customer.stage, "销售企微承接");
  assert.ok(nextState.tasks.some((task) => task.customerId === "c002"));
});

test("VIP群分流Agent能把售后问题路由给售后", () => {
  const state = cloneState(initialState);
  const { result } = runVipAgent(state, "c003", "@销售 上周那批有两台售后维修怎么处理？");
  assert.equal(result.intent, "售后问题");
  assert.equal(result.routeTo, "售后");
  assert.equal(result.mentionMismatch, true);
  assert.equal(result.autoReplyAllowed, true);
  assert.equal(result.repeatedIssue, true);
  assert.ok(result.conversationContext.recentMessages.length >= 2);
  assert.equal(result.pendingTask.id, "t002");
});

test("会话上下文能汇总最近群消息和未完成任务", () => {
  const state = cloneState(initialState);
  const context = buildConversationContext(state, "c003", "VIP模拟群");
  assert.equal(context.messageCount, 2);
  assert.ok(context.recentMessages.some((message) => message.mentions.includes("销售")));
  assert.ok(context.unresolvedTasks.some((task) => task.ownerRole === "售后"));
});

test("报价推荐Agent优先推荐客户关注型号", () => {
  const state = cloneState(initialState);
  const { result } = runQuoteAgent(state, "c001");
  const models = result.recommendations.map((quote) => quote.model);
  assert.ok(models.includes("iPhone 13"));
  assert.ok(result.recommendations.every((quote) => quote.reasons.length > 0));
});

test("外呼筛选Agent不会把低意向客户误标为潜在意向", () => {
  const state = cloneState(initialState);
  const { state: nextState } = runDialerAgent(state, "c004");
  const customer = nextState.customers.find((item) => item.id === "c004");
  assert.equal(customer.stage, "待外呼");
  assert.ok(customer.tags.includes("待回访"));
  assert.equal(customer.tags.includes("潜在意向"), false);
});

test("Agent基础动作会拒绝无效客户、任务和报价型号", () => {
  const state = cloneState(initialState);
  assert.throws(() => runDialerAgent(state, "missing"), /Customer not found/);
  assert.throws(() => runQuoteAgent(state, ""), /Customer not found/);
  assert.throws(() => updateTaskStatus(state, "missing", "已完成"), /Task not found/);
  assert.throws(() => subscribeQuote(state, "c001", ""), /Quote model is required/);
});

test("客户评分对畸形数值保持稳定", () => {
  const score = scoreCustomer({
    tradeVolume: "bad",
    purchaseFrequency: undefined,
    lastTradeDays: "bad",
    memberStatus: "未购卡",
    tags: []
  });
  assert.equal(Number.isFinite(score), true);
  assert.ok(score >= 0 && score <= 100);
});

test("销售承接Agent会输出销售交接包和话术建议", () => {
  const state = cloneState(initialState);
  const { result } = runSalesAgent(state, "c002", "Mate60价格能不能优惠，黑金卡本周可以定");
  assert.equal(result.agent, "销售承接Agent");
  assert.equal(result.handoffPackage.customer, "杭州锐采科技");
  assert.ok(result.playbook.objectionHandling.includes("价格"));
  assert.ok(result.quoteRecommendations.some((quote) => quote.model.includes("Mate60")));
  assert.ok(result.learnedTactics.length > 0);
  assert.match(result.playbook.winningPhrase, /稳定供货|优先报价/);
});

test("Agent消息解析能处理非字符串报价型号和脏意向分", () => {
  const state = cloneState(initialState);
  state.quotes.push({
    id: "q_dirty",
    brand: "Other",
    model: 123,
    config: "标准",
    price: "bad",
    stock: "稳定",
    validUntil: "待确认"
  });
  state.customers.find((item) => item.id === "c002").intentScore = "坏分数";

  const { state: nextState, result } = runSalesAgent(state, "c002", "123价格有吗，黑金卡本周可以定");
  const customer = nextState.customers.find((item) => item.id === "c002");
  assert.equal(result.detectedModels.includes("123"), true);
  assert.equal(Number.isFinite(customer.intentScore), true);
});

test("闭环编排Agent会为每个客户生成下一步动作和任务", () => {
  const state = cloneState(initialState);
  const { state: nextState, result } = runOrchestratorAgent(state);
  assert.equal(result.agent, "闭环编排Agent");
  assert.equal(result.plans.length, nextState.customers.length);
  assert.ok(nextState.workflowPlans.length === nextState.customers.length);
  assert.ok(nextState.tasks.some((task) => task.title === "外呼确认采购计划"));
  assert.ok(nextState.customers.every((customer) => customer.nextBestAction));
});
