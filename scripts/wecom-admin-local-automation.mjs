#!/usr/bin/env node
import { createServer } from "node:http";
import { chromium } from "playwright-core";

const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const port = Number(portArg?.split("=")[1] || process.env.WECOM_ADMIN_AUTOMATION_PORT || 8792);
const host = process.env.WECOM_ADMIN_AUTOMATION_HOST || "127.0.0.1";
const allowSubmit = process.env.WECOM_ADMIN_ALLOW_SUBMIT !== "false";
const cdpEndpoint = process.env.WECOM_ADMIN_CDP_ENDPOINT || `http://127.0.0.1:${process.env.WECOM_ADMIN_CDP_PORT || 9222}`;
const defaultGroupSendUrl = process.env.WECOM_ADMIN_GROUP_SEND_URL || "https://work.weixin.qq.com/wework_admin/frame#/customer/config/groupSend";
const navigationTimeoutMs = Math.max(3000, Number(process.env.WECOM_ADMIN_NAVIGATION_TIMEOUT_MS || 20000));
const actionTimeoutMs = Math.max(1000, Number(process.env.WECOM_ADMIN_ACTION_TIMEOUT_MS || 8000));
let automationTail = Promise.resolve();
let browserPromise = null;
let cachedBrowser = null;

function isoNow() {
  return new Date().toISOString();
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

function withAutomationLock(task) {
  const run = automationTail.then(task, task);
  automationTail = run.catch(() => {});
  return run;
}

function parseSelectorMap() {
  const raw = process.env.WECOM_ADMIN_MASS_SEND_SELECTORS || "{}";
  let parsed = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }
  return {
    customerNewMessageButton: process.env.WECOM_ADMIN_CUSTOMER_NEW_MESSAGE_SELECTOR || parsed.customerNewMessageButton || "",
    customerGroupNewMessageButton: process.env.WECOM_ADMIN_CUSTOMER_GROUP_NEW_MESSAGE_SELECTOR || parsed.customerGroupNewMessageButton || "",
    employeePickerOpen: process.env.WECOM_ADMIN_EMPLOYEE_PICKER_OPEN_SELECTOR || parsed.employeePickerOpen || "",
    employeeSearchInput: process.env.WECOM_ADMIN_EMPLOYEE_SEARCH_INPUT_SELECTOR || parsed.employeeSearchInput || "",
    employeeResult: process.env.WECOM_ADMIN_EMPLOYEE_RESULT_SELECTOR || parsed.employeeResult || "",
    employeeConfirmButton: process.env.WECOM_ADMIN_EMPLOYEE_CONFIRM_SELECTOR || parsed.employeeConfirmButton || "",
    customerScopeOpen: process.env.WECOM_ADMIN_CUSTOMER_SCOPE_OPEN_SELECTOR || parsed.customerScopeOpen || "",
    customerSearchInput: process.env.WECOM_ADMIN_CUSTOMER_SEARCH_INPUT_SELECTOR || parsed.customerSearchInput || "",
    customerResult: process.env.WECOM_ADMIN_CUSTOMER_RESULT_SELECTOR || parsed.customerResult || "",
    customerScopeConfirmButton: process.env.WECOM_ADMIN_CUSTOMER_SCOPE_CONFIRM_SELECTOR || parsed.customerScopeConfirmButton || "",
    messageEditor: process.env.WECOM_ADMIN_MESSAGE_EDITOR_SELECTOR || parsed.messageEditor || "",
    submitButton: process.env.WECOM_ADMIN_SUBMIT_BUTTON_SELECTOR || parsed.submitButton || ""
  };
}

function selectorMappingStatus() {
  const selectors = parseSelectorMap();
  const requiredForSubmit = [
    "employeePickerOpen",
    "employeeSearchInput",
    "employeeResult",
    "employeeConfirmButton",
    "customerScopeOpen",
    "customerSearchInput",
    "customerResult",
    "customerScopeConfirmButton",
    "messageEditor",
    "submitButton"
  ];
  const missing = requiredForSubmit.filter((key) => !selectors[key]);
  return {
    ready: missing.length === 0,
    missing,
    selectors: Object.fromEntries(Object.entries(selectors).map(([key, value]) => [key, Boolean(value)]))
  };
}

function safeText(value = "", maxLength = 4000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

async function connectBrowser() {
  if (cachedBrowser?.isConnected?.()) return cachedBrowser;
  if (!browserPromise) {
    browserPromise = chromium.connectOverCDP(cdpEndpoint, { timeout: 5000 })
      .then((browser) => {
        cachedBrowser = browser;
        browser.on("disconnected", () => {
          cachedBrowser = null;
          browserPromise = null;
        });
        return browser;
      })
      .catch((error) => {
        cachedBrowser = null;
        browserPromise = null;
        throw error;
      });
  }
  return browserPromise;
}

async function getDefaultContext(browser) {
  const contexts = browser.contexts();
  if (contexts.length > 0) return contexts[0];
  return browser.newContext();
}

function isGroupSendUrl(url = "") {
  return String(url || "").includes("/customer/config/groupSend");
}

function isCreateMessageUrl(url = "") {
  return String(url || "").includes("#csMessage/create");
}

function isCustomerGroupCreateMessageUrl(url = "") {
  return String(url || "").includes("#customer/qunCsMsg") && !String(url || "").includes("/list");
}

function normalizeAudienceType(value = "") {
  const text = safeText(value, 80).toLowerCase().replaceAll("-", "_");
  if (["customer_group", "group", "groups", "room", "rooms", "客户群", "群聊", "vip_group"].includes(text)) {
    return "customer_group";
  }
  return "customer";
}

function audienceTypeLabel(audienceType = "customer") {
  return audienceType === "customer_group" ? "客户群" : "客户";
}

async function getOrCreateGroupSendPage({ createIfMissing = true, pageUrl = defaultGroupSendUrl } = {}) {
  const browser = await connectBrowser();
  const context = await getDefaultContext(browser);
  const pages = context.pages();
  let page = pages.find((item) => isGroupSendUrl(item.url()))
    || pages.find((item) => String(item.url() || "").includes("work.weixin.qq.com/wework_admin"))
    || null;
  if (!page && createIfMissing) {
    page = await context.newPage();
  }
  if (!page) return { browser, context, page: null };
  if (!isGroupSendUrl(page.url())) {
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
  }
  return { browser, context, page };
}

async function navigateToGroupSendLanding(page, pageUrl = defaultGroupSendUrl) {
  if (!page) return;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!isGroupSendUrl(page.url()) || isCreateMessageUrl(page.url()) || isCustomerGroupCreateMessageUrl(page.url())) {
      await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs }).catch(() => {});
    }
    await dismissUnsavedEditPrompt(page);
    await closeVisibleTransientDialogs(page);
    const ready = await page.waitForFunction(
      () => document.body.innerText.includes("群发消息给客户")
        && document.body.innerText.includes("群发消息到企业的客户群")
        && document.body.innerText.includes("群发工具"),
      null,
      { timeout: attempt === 0 ? 3000 : 5000 }
    ).then(() => true).catch(() => false);
    if (ready) {
      await page.waitForLoadState("domcontentloaded", { timeout: navigationTimeoutMs }).catch(() => {});
      return;
    }
    const bodyText = await readBodyText(page);
    if (/扫码登录|登录企业微信|企业微信登录|请登录|重新登录/.test(bodyText) && !bodyText.includes("群发工具")) {
      throw Object.assign(new Error("后台浏览器中的企微后台需要登录，请先在专用 Chrome 完成登录。"), { errorCode: "needs_login" });
    }
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs }).catch(() => {});
    await dismissUnsavedEditPrompt(page);
  }
  const preflight = await inspectGroupSendPage(page);
  throw Object.assign(new Error("无法回到企微后台群发工具首页，可能仍停在编辑页、登录页或权限页。"), {
    errorCode: preflight.status || "group_send_page_unverified",
    preflight
  });
}

async function dismissUnsavedEditPrompt(page) {
  const clicked = await page.evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const textOf = (el) => (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
    const dialogs = Array.from(document.querySelectorAll(".qui_dialog,.ww_dialog,[role='dialog']"))
      .filter(visible)
      .filter((el) => textOf(el).includes("当前编辑") && textOf(el).includes("未保存"));
    const dialog = dialogs.at(-1);
    if (!dialog) return false;
    const exitButton = Array.from(dialog.querySelectorAll("a,button,[role='button'],.ww_btn,.qui_btn"))
      .filter(visible)
      .find((el) => textOf(el) === "退出");
    if (!exitButton) return false;
    exitButton.click();
    return true;
  }).catch(() => false);
  if (clicked) {
    await page.waitForTimeout(800);
  }
  return clicked;
}

async function closeVisibleTransientDialogs(page, selector = ".multiselect_dialog,.csMessage_create_customerSelector_dialog,.customer_qunSelector_dialog") {
  let closedCount = 0;
  for (let index = 0; index < 6; index += 1) {
    const closed = await page.evaluate((dialogSelector) => {
      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const textOf = (el) => (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
      const dialogs = Array.from(document.querySelectorAll(dialogSelector)).filter(visible);
      const dialog = dialogs.at(-1);
      if (!dialog) return false;
      const closeButton = Array.from(dialog.querySelectorAll(".ww_dialog_close,a,button,[role='button'],.ww_btn,.qui_btn"))
        .filter(visible)
        .find((el) => el.classList.contains("ww_dialog_close") || textOf(el) === "取消" || textOf(el) === "关闭");
      if (!closeButton) return false;
      closeButton.click();
      return true;
    }, selector).catch(() => false);
    if (!closed) break;
    closedCount += 1;
    await page.waitForTimeout(250);
  }
  return closedCount;
}

async function readBodyText(page) {
  try {
    return await page.locator("body").innerText({ timeout: actionTimeoutMs });
  } catch {
    return "";
  }
}

async function inspectGroupSendPage(page) {
  const bodyText = await readBodyText(page);
  const pageInfo = await page.evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const textOf = (el) => (el.innerText || el.textContent || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ");
    const actions = Array.from(document.querySelectorAll("a,button,[role='button'],.ww_btn,.qui_btn"))
      .filter(visible)
      .map((el) => textOf(el))
      .filter(Boolean)
      .slice(0, 80);
    const customerNewMessage = Array.from(document.querySelectorAll("a,button,[role='button'],.ww_btn,.qui_btn"))
      .filter(visible)
      .map((el) => {
        const ownText = textOf(el);
        let parent = el;
        let cardText = ownText;
        for (let i = 0; i < 8 && parent && parent !== document.body; i += 1) {
          cardText = textOf(parent);
          if (cardText.includes("群发消息给客户")) break;
          parent = parent.parentElement;
        }
        return {
          text: ownText,
          cardText: cardText.slice(0, 300),
          matches: ownText === "新建消息" && cardText.includes("群发消息给客户")
        };
      })
      .find((item) => item.matches) || null;
    const customerGroupNewMessage = Array.from(document.querySelectorAll("a,button,[role='button'],.ww_btn,.qui_btn"))
      .filter(visible)
      .map((el) => {
        const ownText = textOf(el);
        let parent = el;
        let cardText = ownText;
        for (let i = 0; i < 8 && parent && parent !== document.body; i += 1) {
          cardText = textOf(parent);
          if (cardText.includes("群发消息到企业的客户群")) break;
          parent = parent.parentElement;
        }
        return {
          text: ownText,
          cardText: cardText.slice(0, 300),
          matches: ownText === "新建消息" && cardText.includes("群发消息到企业的客户群")
        };
      })
      .find((item) => item.matches) || null;
    return {
      href: location.href,
      title: document.title,
      actions,
      customerNewMessage,
      customerGroupNewMessage
    };
  }).catch((error) => ({ error: error.message }));
  const href = String(pageInfo.href || page.url() || "");
  const hasGroupSendTitle = bodyText.includes("群发工具");
  const hasCustomerMassSend = bodyText.includes("群发消息给客户");
  const hasCustomerGroupMassSend = bodyText.includes("群发消息到企业的客户群");
  const hasNewMessage = bodyText.includes("新建消息");
  const needsLogin = /扫码登录|登录企业微信|企业微信登录|请登录|重新登录/.test(bodyText) && !hasGroupSendTitle;
  const noPermission = /无权限|没有权限|暂无权限|未认证/.test(bodyText);
  const customerNewMessageReady = Boolean(pageInfo.customerNewMessage);
  const customerGroupNewMessageReady = Boolean(pageInfo.customerGroupNewMessage);
  const ready = isGroupSendUrl(href) && hasGroupSendTitle && hasCustomerMassSend && hasCustomerGroupMassSend && hasNewMessage && customerNewMessageReady && customerGroupNewMessageReady;
  return {
    ok: ready,
    status: ready ? "group_send_ready" : needsLogin ? "needs_login" : noPermission ? "permission_required" : "group_send_page_unverified",
    loginStatus: ready ? "群发工具页已打开" : needsLogin ? "需要登录企微后台" : noPermission ? "企微后台权限不足" : "企微后台已打开但群发入口未确认",
    page: {
      href,
      title: pageInfo.title || "",
      hasGroupSendTitle,
      hasCustomerMassSend,
      hasCustomerGroupMassSend,
      hasNewMessage,
      customerNewMessageReady,
      customerGroupNewMessageReady,
      visibleActions: pageInfo.actions || [],
      customerNewMessage: pageInfo.customerNewMessage || null,
      customerGroupNewMessage: pageInfo.customerGroupNewMessage || null,
      error: pageInfo.error || ""
    }
  };
}

function buildFailure(errorCode, error, startedAt, extra = {}) {
  return {
    ok: false,
    status: "failed",
    errorCode,
    error,
    externalSideEffects: false,
    noScreenshot: true,
    foregroundSafe: true,
    automationMode: "cdp-dedicated-chrome",
    timings: { totalMs: Date.now() - startedAt },
    ...extra
  };
}

function validateTask(task = {}) {
  const audienceType = normalizeAudienceType(task.audienceType || task.targetType || task.massSendType);
  const employeeNames = Array.isArray(task.employeeNames) ? task.employeeNames.map((item) => safeText(item, 120)).filter(Boolean) : [];
  const targetCustomerIds = Array.isArray(task.targetCustomerIds) ? task.targetCustomerIds.map((item) => safeText(item, 120)).filter(Boolean) : [];
  const targetCustomerNames = Array.isArray(task.targetCustomerNames) ? task.targetCustomerNames.map((item) => safeText(item, 120)).filter(Boolean) : [];
  const targetGroupNames = Array.isArray(task.targetGroupNames) ? task.targetGroupNames.map((item) => safeText(item, 120)).filter(Boolean) : [];
  const knownGroupNames = Array.isArray(task.knownGroupNames) ? task.knownGroupNames.map((item) => safeText(item, 120)).filter(Boolean) : [];
  const messageText = safeText(task.messageText || task.text || task.content, 4000);
  const errors = [];
  if (employeeNames.length === 0) errors.push("employeeNames");
  if (audienceType === "customer_group") {
    if (targetGroupNames.length === 0 && targetCustomerNames.length === 0) errors.push("targetGroupNames");
  } else if (targetCustomerIds.length === 0 && targetCustomerNames.length === 0) {
    errors.push("targetCustomers");
  }
  if (!messageText) errors.push("messageText");
  return {
    ok: errors.length === 0,
    errors,
    audienceType,
    employeeNames,
    targetCustomerIds,
    targetCustomerNames,
    targetGroupNames,
    knownGroupNames,
    messageText
  };
}

function findAmbiguousCustomerGroupKeywords(targetGroupNames = [], knownGroupNames = []) {
  if (!targetGroupNames.length || !knownGroupNames.length) return [];
  const uniqueKnownNames = [...new Set(knownGroupNames.map((item) => safeText(item, 120)).filter(Boolean))];
  return targetGroupNames
    .map((keyword) => {
      const matches = uniqueKnownNames.filter((name) => name.includes(keyword));
      return { keyword, matches };
    })
    .filter((item) => item.matches.length !== 1);
}

function exactCustomerTargetRequiresGuard(task = {}, normalizedTask = {}) {
  if (normalizedTask.audienceType !== "customer") return false;
  if (task.allowEmployeeCustomerScopeSubmit === true || task.allowMemberScopeSubmit === true) return false;
  return normalizedTask.targetCustomerIds.length > 0 || normalizedTask.targetCustomerNames.length > 0;
}

async function clickConfiguredSelector(page, selector, label) {
  const locator = page.locator(selector);
  const count = await locator.count();
  if (count !== 1) {
    throw new Error(`${label}_selector_${count === 0 ? "not_found" : "not_unique"}`);
  }
  await locator.click({ timeout: actionTimeoutMs });
}

function selectorForItem(template = "", item = {}) {
  const value = safeText(item.value || item.name || item.id, 240);
  return String(template || "")
    .replaceAll("{{value}}", value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\""))
    .replaceAll("{{name}}", safeText(item.name || value, 240).replaceAll("\\", "\\\\").replaceAll("\"", "\\\""))
    .replaceAll("{{id}}", safeText(item.id || value, 240).replaceAll("\\", "\\\\").replaceAll("\"", "\\\""));
}

async function fillConfiguredSelector(page, selector, value, label) {
  const locator = page.locator(selector);
  const count = await locator.count();
  if (count !== 1) {
    throw new Error(`${label}_selector_${count === 0 ? "not_found" : "not_unique"}`);
  }
  await locator.fill(value, { timeout: actionTimeoutMs });
}

async function clickNewMessage(page, selectors, audienceType = "customer") {
  const configuredSelector = audienceType === "customer_group"
    ? selectors.customerGroupNewMessageButton
    : selectors.customerNewMessageButton;
  const defaultSelector = audienceType === "customer_group" ? ".js_create_csQun_msg" : ".js_create_cs_message";
  const label = audienceType === "customer_group" ? "customer_group_new_message" : "customer_new_message";
  if (configuredSelector) {
    await clickConfiguredSelector(page, configuredSelector, label);
    return { strategy: "configured_selector", audienceType };
  }
  const defaultCount = await page.locator(defaultSelector).count().catch(() => 0);
  if (defaultCount > 0) {
    await page.locator(defaultSelector).first().click({ timeout: actionTimeoutMs });
    return { strategy: "default_class_selector", selector: defaultSelector, audienceType };
  }
  const result = await page.evaluate((type) => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const textOf = (el) => (el.innerText || el.textContent || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ");
    const targetCardTitle = type === "customer_group" ? "群发消息到企业的客户群" : "群发消息给客户";
    const nodes = Array.from(document.querySelectorAll("a,button,[role='button'],.ww_btn,.qui_btn")).filter(visible);
    const target = nodes.find((el) => {
      if (textOf(el) !== "新建消息") return false;
      let parent = el;
      for (let i = 0; i < 8 && parent && parent !== document.body; i += 1) {
        const cardText = textOf(parent);
        if (cardText.includes(targetCardTitle)) return true;
        parent = parent.parentElement;
      }
      return false;
    });
    if (!target) return { ok: false, errorCode: `${type === "customer_group" ? "customer_group" : "customer"}_new_message_not_found` };
    target.click();
    return { ok: true, strategy: "card_text_match", audienceType: type };
  }, audienceType);
  if (!result.ok) throw new Error(result.errorCode || `${audienceType}_new_message_not_found`);
  return result;
}

async function waitForVisibleSelector(page, selector, label, timeout = actionTimeoutMs) {
  try {
    await page.waitForFunction(
      (targetSelector) => {
        const visible = (el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        };
        return Array.from(document.querySelectorAll(targetSelector)).some(visible);
      },
      selector,
      { timeout }
    );
  } catch {
    throw new Error(`${label}_not_visible`);
  }
}

async function openCreateMessageForm(page, selectors, audienceType = "customer") {
  const openResult = await clickNewMessage(page, selectors, audienceType);
  if (audienceType === "customer_group") {
    await page.waitForFunction(
      () => location.href.includes("#customer/qunCsMsg") || document.body.innerText.includes("通知群主发送"),
      null,
      { timeout: navigationTimeoutMs }
    ).catch(() => {});
  } else {
    await page.waitForFunction(
      () => location.href.includes("#csMessage/create") || document.body.innerText.includes("通知成员，给客户发送以下内容"),
      null,
      { timeout: navigationTimeoutMs }
    ).catch(() => {});
  }
  await waitForVisibleSelector(page, ".js_csMessage_create_textarea", "message_editor");
  return openResult;
}

async function openCustomerSelectorDialog(page) {
  const result = await page.evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const textOf = (el) => (el.innerText || el.textContent || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ");
    const candidates = Array.from(document.querySelectorAll(".js_select_service,a,button,[role='button'],.ww_btn,.qui_btn"))
      .filter(visible);
    const target = candidates.find((el) => el.classList.contains("js_select_service"))
      || candidates.find((el) => textOf(el).includes("选择发送给的客户"))
      || candidates.find((el) => textOf(el) === "修改");
    if (!target) return { ok: false, errorCode: "customer_selector_open_not_found" };
    target.click();
    return { ok: true, text: textOf(target) };
  });
  if (!result.ok) throw new Error(result.errorCode || "customer_selector_open_failed");
  await waitForVisibleSelector(page, ".csMessage_create_customerSelector_dialog", "customer_selector_dialog");
  return result;
}

async function chooseFilteredCustomerScope(page, allowEmployeeAdjustScope = false) {
  const result = await page.evaluate((allowAdjust) => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const dialogs = Array.from(document.querySelectorAll(".csMessage_create_customerSelector_dialog")).filter(visible);
    const dialog = dialogs.at(-1);
    if (!dialog) return { ok: false, errorCode: "customer_selector_dialog_not_found" };
    const radios = Array.from(dialog.querySelectorAll("input.js_send_type_btn"));
    const filtered = radios.find((item) => item.value === "2") || radios[1];
    if (!filtered) return { ok: false, errorCode: "filtered_scope_radio_not_found" };
    if (!filtered.checked) {
      filtered.click();
      filtered.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const adjustCheckbox = dialog.querySelector(".js_csMessage_dialog_checkbox");
    if (adjustCheckbox && adjustCheckbox.checked !== allowAdjust) {
      adjustCheckbox.click();
      adjustCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return { ok: true, allowEmployeeAdjustScope: Boolean(adjustCheckbox?.checked) };
  }, allowEmployeeAdjustScope);
  if (!result.ok) throw new Error(result.errorCode || "filtered_scope_select_failed");
  await page.waitForFunction(
    () => {
      const dialog = Array.from(document.querySelectorAll(".csMessage_create_customerSelector_dialog"))
        .filter((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        })
        .at(-1);
      return dialog && dialog.innerText.includes("发送给") && dialog.innerText.includes("按部门或添加人筛选");
    },
    null,
    { timeout: actionTimeoutMs }
  );
  return result;
}

async function openEmployeeSelectorFromCustomerDialog(page) {
  const result = await page.evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const textOf = (el) => (el.innerText || el.textContent || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ");
    const dialog = Array.from(document.querySelectorAll(".csMessage_create_customerSelector_dialog"))
      .filter(visible)
      .at(-1);
    if (!dialog) return { ok: false, errorCode: "customer_selector_dialog_not_found" };
    const targets = Array.from(dialog.querySelectorAll("a,button,[role='button'],.ww_btn,.qui_btn"))
      .filter(visible)
      .filter((el) => textOf(el).includes("按部门或添加人筛选"));
    const target = targets[0];
    if (!target) return { ok: false, errorCode: "employee_scope_button_not_found" };
    target.click();
    return { ok: true, count: targets.length };
  });
  if (!result.ok) throw new Error(result.errorCode || "employee_selector_open_failed");
  await waitForVisibleSelector(page, ".multiselect_dialog", "employee_selector_dialog");
  await waitForVisibleSelector(page, "#memberSearchInput", "employee_search_input");
  return result;
}

async function selectedEmployeeNames(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const textOf = (el) => (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
    const dialog = Array.from(document.querySelectorAll(".multiselect_dialog")).filter(visible).at(-1);
    if (!dialog) return [];
    const rect = dialog.getBoundingClientRect();
    return Array.from(dialog.querySelectorAll(".member_colRight_cnt_item,.ww_tag,li,a"))
      .filter(visible)
      .filter((el) => el.getBoundingClientRect().x > rect.x + rect.width / 2)
      .map(textOf)
      .filter(Boolean);
  });
}

async function selectEmployee(page, name) {
  const cleanName = safeText(name, 120);
  const fillResult = await page.evaluate((employeeName) => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const dialog = Array.from(document.querySelectorAll(".multiselect_dialog")).filter(visible).at(-1);
    if (!dialog) return { ok: false, errorCode: "employee_selector_dialog_not_found" };
    const input = Array.from(dialog.querySelectorAll("#memberSearchInput,input[placeholder*='搜索成员']"))
      .filter(visible)
      .at(-1);
    if (!input) return { ok: false, errorCode: "employee_search_input_not_found" };
    input.focus();
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.value = employeeName;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  }, cleanName);
  if (!fillResult.ok) throw new Error(`${fillResult.errorCode || "employee_search_fill_failed"}:${cleanName}`);
  await page.waitForTimeout(500);
  const result = await page.evaluate((employeeName) => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const textOf = (el) => (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
    const dialog = Array.from(document.querySelectorAll(".multiselect_dialog")).filter(visible).at(-1);
    if (!dialog) return { ok: false, errorCode: "employee_selector_dialog_not_found" };
    const resultItems = Array.from(dialog.querySelectorAll(".ww_searchResult_item,.js_search_item,a.ww_searchResult_itemTxt"))
      .filter(visible);
    const searchHit = resultItems.find((el) => textOf(el) === employeeName || textOf(el).includes(employeeName));
    const treeHit = Array.from(dialog.querySelectorAll("a.jstree-anchor"))
      .filter(visible)
      .find((el) => textOf(el) === employeeName);
    const target = searchHit || treeHit;
    if (!target) {
      return {
        ok: false,
        errorCode: "employee_not_found",
        employeeName,
        candidates: resultItems.map(textOf).filter(Boolean).slice(0, 20)
      };
    }
    target.click();
    return { ok: true, employeeName, targetText: textOf(target) };
  }, cleanName);
  if (!result.ok) throw new Error(`${result.errorCode || "employee_select_failed"}:${cleanName}`);
  await page.waitForTimeout(500);
  const selected = await selectedEmployeeNames(page);
  if (!selected.some((item) => item.includes(cleanName))) {
    throw new Error(`employee_selected_unverified:${cleanName}`);
  }
  return result;
}

async function confirmVisibleDialog(page, dialogSelector, buttonText, label) {
  const result = await page.evaluate(({ dialogSelector: selector, buttonText: expected }) => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const textOf = (el) => (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
    const dialog = Array.from(document.querySelectorAll(selector)).filter(visible).at(-1);
    if (!dialog) return { ok: false, errorCode: "dialog_not_found" };
    const target = Array.from(dialog.querySelectorAll("a,button,[role='button'],.ww_btn,.qui_btn"))
      .filter(visible)
      .find((el) => textOf(el) === expected);
    if (!target) return { ok: false, errorCode: "dialog_confirm_not_found", text: textOf(dialog).slice(0, 300) };
    target.click();
    return { ok: true, text: textOf(dialog).slice(0, 300) };
  }, { dialogSelector, buttonText });
  if (!result.ok) throw new Error(`${label}_${result.errorCode || "confirm_failed"}`);
  return result;
}

async function configureCustomerScope(page, normalizedTask, task = {}) {
  await openCustomerSelectorDialog(page);
  await chooseFilteredCustomerScope(page, task.allowEmployeeAdjustScope === true);
  await openEmployeeSelectorFromCustomerDialog(page);
  const selectedEmployees = [];
  for (const name of normalizedTask.employeeNames) {
    await selectEmployee(page, name);
    selectedEmployees.push(name);
  }
  await confirmVisibleDialog(page, ".multiselect_dialog", "确认", "employee_selector");
  await page.waitForFunction(
    (names) => {
      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const dialog = Array.from(document.querySelectorAll(".csMessage_create_customerSelector_dialog")).filter(visible).at(-1);
      const text = dialog?.innerText || "";
      return names.every((name) => text.includes(name));
    },
    selectedEmployees,
    { timeout: actionTimeoutMs }
  );
  await closeVisibleTransientDialogs(page, ".multiselect_dialog");
  const customerDialogText = await page.evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const dialog = Array.from(document.querySelectorAll(".csMessage_create_customerSelector_dialog")).filter(visible).at(-1);
    return (dialog?.innerText || "").trim().replace(/\s+/g, " ").slice(0, 500);
  });
  await confirmVisibleDialog(page, ".csMessage_create_customerSelector_dialog", "确定", "customer_selector");
  await closeVisibleTransientDialogs(page, ".csMessage_create_customerSelector_dialog,.multiselect_dialog");
  await page.waitForFunction(
    () => document.body.innerText.includes("分别发送给") || document.body.innerText.includes("修改"),
    null,
    { timeout: actionTimeoutMs }
  );
  return {
    selectedEmployees,
    customerSelectionMode: "member_scope",
    customerDialogText
  };
}

async function openGroupOwnerSelectorFromCustomerGroupDialog(page) {
  const result = await page.evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const textOf = (el) => (el.innerText || el.textContent || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ");
    const dialog = Array.from(document.querySelectorAll(".customer_qunSelector_dialog"))
      .filter(visible)
      .at(-1);
    if (!dialog) return { ok: false, errorCode: "customer_group_selector_dialog_not_found" };
    const target = Array.from(dialog.querySelectorAll(".js_qunMaster_selector_default,a,button,[role='button'],.ww_btn,.qui_btn"))
      .filter(visible)
      .find((el) => el.classList.contains("js_qunMaster_selector_default"))
      || Array.from(dialog.querySelectorAll("a,button,[role='button'],.ww_btn,.qui_btn"))
        .filter(visible)
        .find((el) => textOf(el).includes("按部门或成员筛选"));
    if (!target) return { ok: false, errorCode: "customer_group_owner_selector_open_not_found" };
    target.click();
    return { ok: true, text: textOf(target) };
  });
  if (!result.ok) throw new Error(result.errorCode || "customer_group_owner_selector_open_failed");
  await waitForVisibleSelector(page, ".multiselect_dialog", "customer_group_owner_selector_dialog");
  await waitForVisibleSelector(page, "#memberSearchInput", "customer_group_owner_search_input");
  return result;
}

async function openCustomerGroupSelectorDialog(page) {
  const result = await page.evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const textOf = (el) => (el.innerText || el.textContent || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ");
    const candidates = Array.from(document.querySelectorAll(".js_qunCsMsgMaster_selector,a,button,[role='button'],.ww_btn,.qui_btn"))
      .filter(visible);
    const target = candidates.find((el) => el.classList.contains("js_qunCsMsgMaster_selector") && textOf(el).includes("按条件筛选客户群"))
      || candidates.find((el) => el.classList.contains("js_qunCsMsgMaster_selector") && textOf(el).includes("修改"))
      || candidates.find((el) => textOf(el).includes("按条件筛选客户群"));
    if (!target) return { ok: false, errorCode: "customer_group_selector_open_not_found" };
    target.click();
    return { ok: true, text: textOf(target) };
  });
  if (!result.ok) throw new Error(result.errorCode || "customer_group_selector_open_failed");
  await waitForVisibleSelector(page, ".customer_qunSelector_dialog", "customer_group_selector_dialog");
  return result;
}

async function chooseFilteredCustomerGroupScope(page, allowOwnerAdjustScope = false) {
  const result = await page.evaluate((allowAdjust) => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const dialogs = Array.from(document.querySelectorAll(".customer_qunSelector_dialog")).filter(visible);
    const dialog = dialogs.at(-1);
    if (!dialog) return { ok: false, errorCode: "customer_group_selector_dialog_not_found" };
    const filtered = dialog.querySelector(".js_select_depart_members_radio")
      || Array.from(dialog.querySelectorAll("input[type='radio']")).find((item) => item.value === "0");
    if (!filtered) return { ok: false, errorCode: "customer_group_filtered_radio_not_found" };
    if (!filtered.checked) {
      filtered.click();
      filtered.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const adjustCheckbox = dialog.querySelector(".js_csMessage_dialog_checkbox");
    if (adjustCheckbox && adjustCheckbox.checked !== allowAdjust) {
      adjustCheckbox.click();
      adjustCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return { ok: true, allowOwnerAdjustScope: Boolean(adjustCheckbox?.checked) };
  }, allowOwnerAdjustScope);
  if (!result.ok) throw new Error(result.errorCode || "customer_group_filtered_scope_select_failed");
  await page.waitForFunction(
    () => {
      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const dialog = Array.from(document.querySelectorAll(".customer_qunSelector_dialog")).filter(visible).at(-1);
      return dialog && dialog.innerText.includes("发送给") && Array.from(dialog.querySelectorAll(".js_qunSelector_input")).some(visible);
    },
    null,
    { timeout: actionTimeoutMs }
  );
  return result;
}

async function addCustomerGroupKeywords(page, keywords = []) {
  const added = [];
  for (const keyword of keywords) {
    const cleanKeyword = safeText(keyword, 120);
    if (!cleanKeyword) continue;
    if (cleanKeyword.length > 19) throw new Error(`customer_group_keyword_too_long:${cleanKeyword}`);
    const input = page.locator(".customer_qunSelector_dialog .js_qunSelector_texeareParent .js_qunSelector_input").first();
    await input.click({ timeout: actionTimeoutMs });
    await page.keyboard.type(cleanKeyword);
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      (name) => {
        const visible = (el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        };
        const dialog = Array.from(document.querySelectorAll(".customer_qunSelector_dialog")).filter(visible).at(-1);
        return Boolean(dialog && dialog.innerText.includes(name));
      },
      cleanKeyword,
      { timeout: actionTimeoutMs }
    );
    added.push(cleanKeyword);
  }
  if (added.length === 0) throw new Error("customer_group_keywords_empty");
  const verify = await page.evaluate((expectedKeywords) => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const textOf = (el) => (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
    const dialog = Array.from(document.querySelectorAll(".customer_qunSelector_dialog")).filter(visible).at(-1);
    const confirm = dialog?.querySelector(".js_confirm_btn");
    const dialogText = textOf(dialog);
    return {
      ok: Boolean(dialog) && expectedKeywords.every((item) => dialogText.includes(item)) && !confirm?.hasAttribute("disabled"),
      dialogText: dialogText.slice(0, 700),
      confirmDisabled: Boolean(confirm?.hasAttribute("disabled"))
    };
  }, added);
  if (!verify.ok) {
    throw Object.assign(new Error("customer_group_keywords_unverified"), { detail: verify });
  }
  return { keywords: added, dialogText: verify.dialogText };
}

async function configureCustomerGroupScope(page, normalizedTask, task = {}) {
  const keywords = normalizedTask.targetGroupNames.length
    ? normalizedTask.targetGroupNames
    : normalizedTask.targetCustomerNames;
  await openCustomerGroupSelectorDialog(page);
  await chooseFilteredCustomerGroupScope(page, task.allowGroupOwnerAdjustScope === true || task.allowEmployeeAdjustScope === true);
  await openGroupOwnerSelectorFromCustomerGroupDialog(page);
  const selectedOwners = [];
  for (const name of normalizedTask.employeeNames) {
    await selectEmployee(page, name);
    selectedOwners.push(name);
  }
  await confirmVisibleDialog(page, ".multiselect_dialog", "确认", "customer_group_owner_selector");
  await page.waitForFunction(
    (names) => {
      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const dialog = Array.from(document.querySelectorAll(".customer_qunSelector_dialog")).filter(visible).at(-1);
      const text = dialog?.innerText || "";
      return names.every((name) => text.includes(name));
    },
    selectedOwners,
    { timeout: actionTimeoutMs }
  );
  await closeVisibleTransientDialogs(page, ".multiselect_dialog");
  const keywordResult = await addCustomerGroupKeywords(page, keywords);
  await confirmVisibleDialog(page, ".customer_qunSelector_dialog", "确认", "customer_group_selector");
  await closeVisibleTransientDialogs(page, ".customer_qunSelector_dialog");
  await page.waitForFunction(
    (expectedKeywords) => expectedKeywords.every((item) => document.body.innerText.includes(item)) || document.body.innerText.includes("修改"),
    keywordResult.keywords,
    { timeout: actionTimeoutMs }
  ).catch(() => {});
  return {
    selectedEmployees: selectedOwners,
    customerSelectionMode: "group_name_keyword_scope",
    targetGroupKeywords: keywordResult.keywords,
    customerDialogText: keywordResult.dialogText
  };
}

async function fillMessageText(page, messageText) {
  const editor = page.locator(".js_csMessage_create_textarea").first();
  await editor.fill(messageText, { timeout: actionTimeoutMs });
  const value = await editor.inputValue({ timeout: actionTimeoutMs });
  if (value.trim() !== messageText.trim()) {
    throw new Error("message_editor_value_mismatch");
  }
  return { length: value.length, preview: value.slice(0, 120) };
}

async function prepareMassSendForm(page, task, normalizedTask, selectors) {
  await navigateToGroupSendLanding(page, task.pageUrl || defaultGroupSendUrl);
  await closeVisibleTransientDialogs(page);
  const preflight = await inspectGroupSendPage(page);
  if (!preflight.ok) {
    throw Object.assign(new Error(
      preflight.status === "needs_login"
        ? "后台浏览器中的企微后台需要登录。"
        : "无法确认当前位于客户与上下游 > 客户联系 > 群发工具，或未找到客户/客户群的新建入口。"
    ), { preflight, errorCode: preflight.status });
  }
  const openResult = await openCreateMessageForm(page, selectors, normalizedTask.audienceType);
  const scope = normalizedTask.audienceType === "customer_group"
    ? await configureCustomerGroupScope(page, normalizedTask, task)
    : await configureCustomerScope(page, normalizedTask, task);
  const message = await fillMessageText(page, normalizedTask.messageText);
  const formState = await page.evaluate(() => {
    const textarea = document.querySelector(".js_csMessage_create_textarea");
    return {
      href: location.href,
      hasSubmitButton: Boolean(document.querySelector(".js_csMessage_send")),
      submitButtonText: (document.querySelector(".js_csMessage_send")?.innerText || "").trim(),
      bodySummary: document.body.innerText.trim().replace(/\s+/g, " ").slice(0, 800),
      messageText: textarea?.value || ""
    };
  });
  return { preflight, openResult, scope, message, formState };
}

async function confirmPostSubmitDialogs(page) {
  const confirmed = [];
  for (let index = 0; index < 3; index += 1) {
    const result = await page.evaluate(() => {
      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const textOf = (el) => (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
      const dialogs = Array.from(document.querySelectorAll(".qui_dialog,.ww_dialog,[role='dialog']"))
        .filter(visible)
        .filter((el) => /发送|群发|通知|确认|确定/.test(textOf(el)));
      const dialog = dialogs.at(-1);
      if (!dialog) return { ok: false, reason: "no_dialog" };
      const button = Array.from(dialog.querySelectorAll("a,button,[role='button'],.ww_btn,.qui_btn"))
        .filter(visible)
        .find((el) => ["确认", "确定", "继续", "提交"].includes(textOf(el)));
      if (!button) return { ok: false, reason: "confirm_button_not_found", text: textOf(dialog).slice(0, 300) };
      const text = textOf(dialog).slice(0, 300);
      button.click();
      return { ok: true, text, buttonText: textOf(button) };
    }).catch((error) => ({ ok: false, reason: error.message }));
    if (!result.ok) break;
    confirmed.push(result);
    await page.waitForTimeout(800);
  }
  return confirmed;
}

async function runSubmitFlow(page, task, normalizedTask, selectors) {
  const preparedForm = await prepareMassSendForm(page, task, normalizedTask, selectors);
  await clickConfiguredSelector(page, ".js_csMessage_send", "submit_button");
  const confirmations = await confirmPostSubmitDialogs(page);
  await page.waitForTimeout(1200);
  const postSubmitState = await page.evaluate(() => ({
    href: location.href,
    bodySummary: document.body.innerText.trim().replace(/\s+/g, " ").slice(0, 1000)
  })).catch(() => ({ href: page.url(), bodySummary: "" }));
  return {
    ok: true,
    status: "submitted",
    detail: `已通过后台浏览器提交企微${audienceTypeLabel(normalizedTask.audienceType)}群发任务。`,
    externalSideEffects: true,
    noScreenshot: true,
    foregroundSafe: true,
    preparedForm,
    confirmations,
    postSubmitState,
    externalTaskId: task.taskId || ""
  };
}

async function runMassSendTask(task = {}) {
  const submitMode = task.submitMode === "submit" ? "submit" : "dry-run";
  const startedAt = Date.now();
  const normalizedTask = validateTask(task);
  if (!normalizedTask.ok) {
    return buildFailure(
      "invalid_task",
      `群发任务缺少必要字段：${normalizedTask.errors.join("、")}。`,
      startedAt,
      { missing: normalizedTask.errors }
    );
  }
  if (submitMode === "submit" && normalizedTask.audienceType === "customer_group") {
    const ambiguousKeywords = findAmbiguousCustomerGroupKeywords(
      normalizedTask.targetGroupNames.length ? normalizedTask.targetGroupNames : normalizedTask.targetCustomerNames,
      normalizedTask.knownGroupNames
    );
    if (ambiguousKeywords.length) {
      return buildFailure(
        "ambiguous_customer_group_keyword",
        `客户群关键词无法唯一命中：${ambiguousKeywords.map((item) => `${item.keyword}=>${item.matches.join("、") || "无匹配"}`).join("；")}。请使用唯一群标识后再提交。`,
        startedAt,
        { ambiguousKeywords }
      );
    }
  }
  if (submitMode === "submit" && exactCustomerTargetRequiresGuard(task, normalizedTask)) {
    return buildFailure(
      "customer_scope_not_exact",
      "企微后台“群发消息给客户”入口只能按员工添加客户/标签等范围筛选，当前无法确认只命中指定客户。请补充唯一客户标签或显式允许按员工客户范围提交后再提交。",
      startedAt,
      {
        requestedCustomers: normalizedTask.targetCustomerNames,
        requestedCustomerIds: normalizedTask.targetCustomerIds,
        actualSelectionMode: "member_scope"
      }
    );
  }
  if (submitMode === "submit" && !allowSubmit) {
    return buildFailure(
      "submit_not_allowed",
      "正式提交被保护开关拦截；当前 WECOM_ADMIN_ALLOW_SUBMIT=false，请取消该环境变量或改为非 false 后再提交。",
      startedAt
    );
  }
  const selectorMapping = selectorMappingStatus();

  let page;
  try {
    ({ page } = await getOrCreateGroupSendPage({ createIfMissing: true, pageUrl: task.pageUrl || defaultGroupSendUrl }));
  } catch (error) {
    return buildFailure(
      "cdp_unreachable",
      `无法连接专用Chrome CDP：${error.message}。请先运行 npm run wecom:admin-chrome 并登录企微后台。`,
      startedAt,
      { cdpEndpoint }
    );
  }
  if (!page) {
    return buildFailure("group_send_page_unavailable", "无法打开企微后台群发工具页。", startedAt, { cdpEndpoint });
  }

  const target = {
    title: task.title || task.segmentTitle || "企微客户群发任务",
    audienceType: normalizedTask.audienceType,
    audienceLabel: audienceTypeLabel(normalizedTask.audienceType),
    employeeNames: normalizedTask.employeeNames,
    customerCount: Number(task.customerCount || normalizedTask.targetCustomerIds.length || normalizedTask.targetCustomerNames.length || normalizedTask.targetGroupNames.length),
    customerNames: normalizedTask.targetCustomerNames,
    groupNames: normalizedTask.targetGroupNames,
    knownGroupNames: normalizedTask.knownGroupNames,
    messagePreview: normalizedTask.messageText.slice(0, 120),
    pageUrl: task.pageUrl || defaultGroupSendUrl,
    customerSelectionMode: normalizedTask.audienceType === "customer_group" ? "group_name_keyword_scope" : "member_scope"
  };
  if (submitMode !== "submit") {
    try {
      const preparedForm = await prepareMassSendForm(page, task, normalizedTask, parseSelectorMap());
      return {
        ok: true,
        status: "dry_run_passed",
        detail: `已自动进入企微后台${audienceTypeLabel(normalizedTask.audienceType)}群发入口，配置发送范围并填写群发文案；当前为提交前验证，未点击最终发送。`,
        externalSideEffects: false,
        preparedForm,
        selectorMapping,
        target,
        cdpEndpoint,
        timings: { totalMs: Date.now() - startedAt },
        noScreenshot: true,
        foregroundSafe: true,
        automationMode: "cdp-dedicated-chrome"
      };
    } catch (error) {
      return buildFailure(
        error.errorCode || "dry_run_form_prepare_failed",
        error.message,
        startedAt,
        { preflight: error.preflight || null, selectorMapping, target, cdpEndpoint }
      );
    }
  }

  try {
    const submitResult = await runSubmitFlow(page, task, normalizedTask, parseSelectorMap());
    return {
      ...submitResult,
      selectorMapping,
      target,
      cdpEndpoint,
      timings: { totalMs: Date.now() - startedAt },
      automationMode: "cdp-dedicated-chrome"
    };
  } catch (error) {
    return buildFailure(
      "submit_flow_failed",
      error.message,
      startedAt,
      { preflight: error.preflight || null, selectorMapping, target, cdpEndpoint }
    );
  }
}

async function health() {
  let page;
  const selectorMapping = selectorMappingStatus();
  try {
    ({ page } = await getOrCreateGroupSendPage({ createIfMissing: true, pageUrl: defaultGroupSendUrl }));
  } catch (error) {
    return {
      ok: false,
      canDispatch: false,
      supportsDryRun: true,
      supportsSubmit: allowSubmit,
      loginStatus: "专用Chrome未连接",
      status: "cdp_unreachable",
      error: error.message,
      cdpEndpoint,
      groupSendUrl: defaultGroupSendUrl,
      foregroundSafe: true,
      automationMode: "cdp-dedicated-chrome",
      selectorMapping,
      checkedAt: isoNow()
    };
  }
  const preflight = page ? await inspectGroupSendPage(page) : {
    ok: false,
    status: "group_send_page_unavailable",
    loginStatus: "群发工具页不可用",
    page: null
  };
  if (page && !preflight.ok) {
    await navigateToGroupSendLanding(page, defaultGroupSendUrl).catch(() => {});
  }
  const normalizedPreflight = page ? await inspectGroupSendPage(page) : preflight;
  return {
    ok: Boolean(page),
    canDispatch: Boolean(normalizedPreflight.ok),
    supportsDryRun: true,
    supportsSubmit: allowSubmit,
    loginStatus: normalizedPreflight.loginStatus,
    status: normalizedPreflight.status,
    groupSendUrl: defaultGroupSendUrl,
    cdpEndpoint,
    foregroundSafe: true,
    automationMode: "cdp-dedicated-chrome",
    selectorMapping,
    page: normalizedPreflight.page,
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
      noScreenshot: true,
      foregroundSafe: true,
      automationMode: "cdp-dedicated-chrome"
    });
  }
});

server.listen(port, host, () => {
  console.log(`WeCom admin mass-send automation listening at http://${host}:${port}`);
  console.log(`CDP endpoint: ${cdpEndpoint}`);
  console.log(`Group-send page: ${defaultGroupSendUrl}`);
  console.log(`Submit allowed: ${allowSubmit ? "yes" : "no (submit disabled)"}`);
  console.log("Foreground control: no AppleScript/AX/mouse/keyboard; Chrome is controlled through CDP.");
});
