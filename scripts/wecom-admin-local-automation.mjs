#!/usr/bin/env node
import { createServer } from "node:http";
import { execFile } from "node:child_process";

const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const port = Number(portArg?.split("=")[1] || process.env.WECOM_ADMIN_AUTOMATION_PORT || 8792);
const host = process.env.WECOM_ADMIN_AUTOMATION_HOST || "127.0.0.1";
const chromeAppName = process.env.WECOM_ADMIN_CHROME_APP || "Google Chrome";
const allowSubmit = process.env.WECOM_ADMIN_ALLOW_SUBMIT === "true";
const defaultGroupSendUrl = process.env.WECOM_ADMIN_GROUP_SEND_URL || "https://work.weixin.qq.com/wework_admin/frame#/customer/config/groupSend";
const tabResultDelimiter = "__WECOM_ADMIN_TAB__";
let automationTail = Promise.resolve();

function scriptString(value = "") {
  return JSON.stringify(String(value || ""));
}

function isoNow() {
  return new Date().toISOString();
}

function runAppleScript(script, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", script], { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || error.message || "osascript failed").trim()));
        return;
      }
      resolve(String(stdout || "").trim());
    });
  });
}

function withAutomationLock(task) {
  const run = automationTail.then(task, task);
  automationTail = run.catch(() => {});
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
      if (raw.length > 1_000_000) rejectBody(new Error("Request body too large"));
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

async function chromeIsRunning() {
  try {
    const output = await runAppleScript(`tell application "System Events" to exists process ${scriptString(chromeAppName)}`, 3000);
    return output === "true";
  } catch {
    return false;
  }
}

async function findWecomAdminTab() {
  const output = await runAppleScript(`
tell application ${scriptString(chromeAppName)}
  set outputDelimiter to ${scriptString(tabResultDelimiter)}
  repeat with wIndex from 1 to count windows
    set currentWindow to window wIndex
    repeat with tIndex from 1 to count tabs of currentWindow
      set currentTab to tab tIndex of currentWindow
      set tabUrl to ""
      set tabTitle to ""
      try
        set tabUrl to URL of currentTab
      end try
      try
        set tabTitle to title of currentTab
      end try
      if tabUrl contains "work.weixin.qq.com/wework_admin" then
        return (wIndex as text) & outputDelimiter & (tIndex as text) & outputDelimiter & tabUrl & outputDelimiter & tabTitle
      end if
    end repeat
  end repeat
  return ""
end tell
`, 5000);
  if (!output) return null;
  const [windowIndex, tabIndex, url = "", title = ""] = output.split(tabResultDelimiter);
  return {
    windowIndex: Number(windowIndex),
    tabIndex: Number(tabIndex),
    url,
    title,
    isGroupSendPage: url.includes("/customer/config/groupSend")
  };
}

async function executeInWecomAdminTab(jsCode, { activate = false, timeoutMs = 10000 } = {}) {
  const tab = await findWecomAdminTab();
  if (!tab) throw new Error("wecom_admin_tab_not_found: 请先在Chrome打开企微后台");
  const output = await runAppleScript(`
tell application ${scriptString(chromeAppName)}
  set currentWindow to window ${tab.windowIndex}
  set active tab index of currentWindow to ${tab.tabIndex}
  set index of currentWindow to 1
  ${activate ? "activate" : ""}
  return execute active tab of currentWindow javascript ${scriptString(jsCode)}
end tell
`, timeoutMs);
  return output;
}

function parseJsonOutput(output, fallback = {}) {
  try {
    return output ? JSON.parse(output) : fallback;
  } catch {
    return { ...fallback, raw: output };
  }
}

async function preflightPage() {
  const tab = await findWecomAdminTab();
  if (!tab) {
    return {
      ok: false,
      status: "admin_tab_not_found",
      loginStatus: "未打开企微后台",
      tab: null
    };
  }
  let page = {};
  try {
    page = parseJsonOutput(await executeInWecomAdminTab(`
(() => {
  const bodyText = document.body ? document.body.innerText : "";
  const links = Array.from(document.querySelectorAll("a,button,[role='button'],span"))
    .map((el) => (el.innerText || el.textContent || "").trim())
    .filter(Boolean)
    .slice(0, 80);
  return JSON.stringify({
    href: location.href,
    title: document.title,
    hasGroupSendTitle: bodyText.includes("群发工具"),
    hasCustomerMassSend: bodyText.includes("群发消息给客户"),
    hasNewMessage: bodyText.includes("新建消息"),
    visibleActions: links
  });
})()
`, { timeoutMs: 5000 }), {});
  } catch (error) {
    page = { error: error.message };
  }
  const pageHref = String(page.href || "");
  const normalizedTab = {
    ...tab,
    url: tab.url || pageHref,
    isGroupSendPage: tab.isGroupSendPage || pageHref.includes("/customer/config/groupSend")
  };
  const groupSendReady = normalizedTab.isGroupSendPage || page.hasGroupSendTitle || page.hasCustomerMassSend;
  return {
    ok: groupSendReady,
    status: groupSendReady ? "group_send_ready" : "wecom_admin_ready",
    loginStatus: groupSendReady ? "群发工具页已打开" : "企微后台已打开",
    tab: normalizedTab,
    page
  };
}

async function runMassSendTask(task = {}) {
  const submitMode = task.submitMode === "submit" ? "submit" : "dry-run";
  if (submitMode === "submit" && !allowSubmit) {
    return {
      ok: false,
      status: "failed",
      errorCode: "submit_not_allowed",
      error: "正式提交被保护开关拦截；需要设置 WECOM_ADMIN_ALLOW_SUBMIT=true 后才允许最终提交。",
      externalSideEffects: false,
      noScreenshot: true
    };
  }
  const pageUrl = task.pageUrl || defaultGroupSendUrl;
  const startedAt = Date.now();
  const preflight = await preflightPage();
  if (!preflight.tab) {
    return {
      ok: false,
      status: "failed",
      errorCode: "admin_tab_not_found",
      error: "没有找到已登录的企微后台Chrome标签页。",
      externalSideEffects: false,
      noScreenshot: true,
      timings: { totalMs: Date.now() - startedAt }
    };
  }
  if (!preflight.ok) {
    return {
      ok: false,
      status: "failed",
      errorCode: "group_send_page_unverified",
      error: "已找到企微后台标签，但无法确认当前位于客户与上下游 > 客户联系 > 群发工具页面；请打开群发工具页后重试。",
      externalSideEffects: false,
      preflight,
      noScreenshot: true,
      timings: { totalMs: Date.now() - startedAt }
    };
  }
  const dryRunResult = {
    ok: true,
    status: "dry_run_passed",
    detail: "已找到企微后台群发工具页；当前为干跑验证，未点击新建、未提交任务。",
    externalSideEffects: false,
    preflight,
    target: {
      title: task.title || task.segmentTitle || "企微客户群发任务",
      employeeNames: task.employeeNames || [],
      customerCount: Number(task.customerCount || task.targetCustomerIds?.length || 0),
      messagePreview: String(task.messageText || "").slice(0, 120),
      pageUrl
    },
    timings: { totalMs: Date.now() - startedAt },
    noScreenshot: true
  };
  if (submitMode !== "submit") return dryRunResult;

  const payloadLiteral = JSON.stringify({
    pageUrl,
    messageText: task.messageText || "",
    employeeNames: task.employeeNames || [],
    title: task.title || task.segmentTitle || "企微客户群发任务"
  });
  const clickResult = parseJsonOutput(await executeInWecomAdminTab(`
(() => {
  const payload = ${payloadLiteral};
  if (!location.href.includes("/customer/config/groupSend")) {
    location.href = payload.pageUrl;
    return JSON.stringify({ ok: false, status: "navigation_started", detail: "已跳转到群发工具页，请稍后重试。" });
  }
  const nodes = Array.from(document.querySelectorAll("a,button,[role='button']"));
  const newMessage = nodes.find((el) => (el.innerText || el.textContent || "").trim() === "新建消息");
  if (!newMessage) {
    return JSON.stringify({ ok: false, status: "new_message_button_not_found", detail: "未找到群发消息给客户的新建消息入口。" });
  }
  newMessage.click();
  return JSON.stringify({ ok: true, status: "new_message_clicked" });
})()
`, { activate: true, timeoutMs: 8000 }), {});

  return {
    ok: false,
    status: "failed",
    errorCode: clickResult.status === "new_message_clicked" ? "selector_mapping_required" : clickResult.status || "selector_mapping_required",
    error: clickResult.status === "new_message_clicked"
      ? "已进入新建消息流程，但客户范围、员工选择和最终提交控件需要在测试后台页面确认后补齐选择器映射；本次未提交。"
      : clickResult.detail || "未能进入企微后台新建消息流程。",
    result: clickResult,
    externalSideEffects: false,
    timings: { totalMs: Date.now() - startedAt },
    noScreenshot: true
  };
}

async function health() {
  const running = await chromeIsRunning();
  if (!running) {
    return {
      ok: false,
      canDispatch: false,
      supportsDryRun: true,
      supportsSubmit: allowSubmit,
      loginStatus: "Chrome未运行",
      status: "chrome_not_running",
      groupSendUrl: defaultGroupSendUrl
    };
  }
  const preflight = await preflightPage();
  return {
    ok: Boolean(preflight.tab),
    canDispatch: Boolean(preflight.ok),
    supportsDryRun: true,
    supportsSubmit: allowSubmit,
    loginStatus: preflight.loginStatus,
    status: preflight.status,
    groupSendUrl: defaultGroupSendUrl,
    tab: preflight.tab,
    page: preflight.page,
    checkedAt: isoNow()
  };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${host}:${port}`);
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, await health());
    }
    if (req.method === "POST" && url.pathname === "/mass-send") {
      const body = await readBody(req);
      const result = await withAutomationLock(() => runMassSendTask(body.task || body));
      return json(res, 200, result);
    }
    return json(res, 404, { error: "Not found" });
  } catch (error) {
    return json(res, 500, {
      ok: false,
      status: "failed",
      errorCode: "automation_error",
      error: error.message,
      externalSideEffects: false,
      noScreenshot: true
    });
  }
});

server.listen(port, host, () => {
  console.log(`WeCom admin mass-send automation listening at http://${host}:${port}`);
  console.log(`Group-send page: ${defaultGroupSendUrl}`);
  console.log(`Submit allowed: ${allowSubmit ? "yes" : "no (dry-run protected)"}`);
});
