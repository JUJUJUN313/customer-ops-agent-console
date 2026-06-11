#!/usr/bin/env node
const appBaseUrl = (process.env.CUSTOMER_OPS_API || "http://127.0.0.1:5175").replace(/\/+$/, "");
const automationBaseUrl = (process.env.WECOM_ADMIN_AUTOMATION_URL || "http://127.0.0.1:8792").replace(/\/+$/, "");
const pollIntervalMs = Math.max(1000, Number(process.env.WECOM_ADMIN_WORKER_POLL_MS || 3000));
const once = process.argv.includes("--once");
const checkOnly = process.argv.includes("--check");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return body;
}

function taskFromState(state, taskId) {
  return (state.wecomAdminMassSend?.tasks || []).find((task) => task.taskId === taskId) || null;
}

async function updateWorkerStatusFromHealth() {
  const health = await requestJson(`${automationBaseUrl}/health`);
  const payload = {
    ok: health.ok && health.canDispatch,
    status: health.ok && health.canDispatch ? "执行器可用" : "检查失败",
    worker: {
      mode: "chrome-admin",
      sidecarUrl: automationBaseUrl,
      canDispatch: Boolean(health.canDispatch),
      supportsDryRun: health.supportsDryRun !== false,
      supportsSubmit: Boolean(health.supportsSubmit),
      loginStatus: health.loginStatus || health.status || "未知",
      status: health.ok && health.canDispatch ? "执行器可用" : "检查失败",
      lastError: health.ok && health.canDispatch ? "" : health.status || "企微后台执行器不可用"
    },
    log: false,
    detail: `企微后台执行器 ${health.status || "unknown"}，登录态 ${health.loginStatus || "未知"}`
  };
  const state = await requestJson(`${appBaseUrl}/api/wecom-admin/mass-send/status`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return { health, state };
}

async function runOnce() {
  const { health } = await updateWorkerStatusFromHealth();
  if (checkOnly) {
    console.log(JSON.stringify({ ok: health.ok, health }, null, 2));
    return;
  }
  if (!health.canDispatch) {
    console.log(`[${new Date().toISOString()}] skip: automation not ready (${health.status || "unknown"})`);
    return;
  }
  const scheduledState = await requestJson(`${appBaseUrl}/api/wecom-admin/mass-send/scheduler/run`, {
    method: "POST",
    body: JSON.stringify({ maxTasks: 1 })
  });
  const result = scheduledState.wecomAdminMassSend?.lastSchedulerResult;
  const taskId = result?.dispatched?.[0];
  if (!taskId) {
    console.log(`[${new Date().toISOString()}] idle: ${result?.reason || "empty"}`);
    return;
  }
  const task = taskFromState(scheduledState, taskId);
  if (!task) {
    console.log(`[${new Date().toISOString()}] task missing after dispatch: ${taskId}`);
    return;
  }
  console.log(`[${new Date().toISOString()}] dispatch ${task.taskId}: ${task.title}`);
  let automationResult;
  try {
    automationResult = await requestJson(`${automationBaseUrl}/mass-send`, {
      method: "POST",
      body: JSON.stringify({ task })
    });
  } catch (error) {
    automationResult = {
      ok: false,
      status: "failed",
      errorCode: "automation_unreachable",
      error: error.message,
      externalSideEffects: false
    };
  }
  await requestJson(`${appBaseUrl}/api/wecom-admin/mass-send/tasks/${encodeURIComponent(task.taskId)}/result`, {
    method: "POST",
    body: JSON.stringify({
      status: automationResult.status || (automationResult.ok ? "submitted" : "failed"),
      errorCode: automationResult.errorCode || "",
      error: automationResult.error || "",
      externalTaskId: automationResult.externalTaskId || "",
      externalSideEffects: Boolean(automationResult.externalSideEffects),
      detail: automationResult.detail || "",
      result: automationResult
    })
  });
  console.log(`[${new Date().toISOString()}] result ${task.taskId}: ${automationResult.status || "unknown"}`);
}

async function main() {
  console.log(`WeCom admin mass-send worker started. App=${appBaseUrl}, automation=${automationBaseUrl}`);
  while (true) {
    try {
      await runOnce();
    } catch (error) {
      console.error(`[${new Date().toISOString()}] worker error: ${error.message}`);
    }
    if (once || checkOnly) break;
    await sleep(pollIntervalMs);
  }
}

main();
