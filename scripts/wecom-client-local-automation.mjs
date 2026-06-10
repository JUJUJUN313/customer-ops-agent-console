#!/usr/bin/env node
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const port = Number(portArg?.split("=")[1] || process.env.WECOM_AUTOMATION_PORT || 8791);
const host = process.env.WECOM_AUTOMATION_HOST || "127.0.0.1";
const allowSendByDefault = process.env.WECOM_AUTOMATION_ALLOW_SEND === "true";
const appProcessName = process.env.WECOM_AUTOMATION_PROCESS || "企业微信";
const idleConversationName = process.env.WECOM_AUTOMATION_IDLE_CONVERSATION || "文件传输助手";
const managedSenderNames = new Set([
  "客服助理",
  ...(process.env.WECOM_AUTOMATION_MANAGED_SENDER_NAMES || "")
    .split(/[,\n]/)
    .map((name) => name.trim())
    .filter(Boolean)
]);
const ignoredUnreadConversationNames = new Set([
  idleConversationName,
  "邮件提醒",
  "企业微信团队",
  "客户联系",
  "行业资讯",
  "微信客服"
]);
const ackStateFile = resolve(process.env.WECOM_AUTOMATION_ACK_STATE_FILE || `${tmpdir()}/wecom-client-automation-ack-state.json`);
let automationTail = Promise.resolve();
const ackedMessageIds = new Set();
const lastAckedCursorByRoomId = new Map();
let lastAckedCursor = "";

function runAppleScript(script, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const child = execFile("osascript", ["-e", script], { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || error.message || "osascript failed").trim()));
        return;
      }
      resolve(String(stdout || "").trim());
    });
    child.stdin?.end();
  });
}

function scriptString(value = "") {
  return JSON.stringify(String(value || ""));
}

function hashId(parts = []) {
  return createHash("sha1").update(parts.map((part) => String(part || "")).join("\n")).digest("hex").slice(0, 16);
}

function isoNow() {
  return new Date().toISOString();
}

function loadAckState() {
  try {
    if (!existsSync(ackStateFile)) return;
    const parsed = JSON.parse(readFileSync(ackStateFile, "utf8"));
    for (const messageId of parsed.ackedMessageIds || []) {
      const normalized = String(messageId || "").trim();
      if (normalized) ackedMessageIds.add(normalized);
    }
    for (const [roomId, cursor] of Object.entries(parsed.lastAckedCursorByRoomId || {})) {
      const normalizedRoomId = String(roomId || "").trim();
      const normalizedCursor = String(cursor || "").trim();
      if (normalizedRoomId && normalizedCursor) lastAckedCursorByRoomId.set(normalizedRoomId, normalizedCursor);
    }
    lastAckedCursor = String(parsed.lastAckedCursor || "").trim();
  } catch (error) {
    console.error(`ACK state load failed: ${error.message}`);
  }
}

function persistAckState() {
  try {
    mkdirSync(dirname(ackStateFile), { recursive: true });
    const roomCursors = {};
    for (const [roomId, cursor] of lastAckedCursorByRoomId.entries()) {
      roomCursors[roomId] = cursor;
    }
    writeFileSync(ackStateFile, JSON.stringify({
      updatedAt: isoNow(),
      lastAckedCursor,
      lastAckedCursorByRoomId: roomCursors,
      ackedMessageIds: Array.from(ackedMessageIds).slice(-1500)
    }, null, 2));
  } catch (error) {
    console.error(`ACK state persist failed: ${error.message}`);
  }
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

function errorCodeFromMessage(message = "") {
  const text = String(message || "");
  const prefix = text.match(/^([a-z][a-z0-9_]+):/i)?.[1];
  if (prefix === "screen_locked") return "client_locked";
  if (prefix) return prefix;
  if (text.includes("wecom_not_running")) return "client_locked";
  if (text.includes("screen_locked")) return "client_locked";
  if (text.includes("wecom_window_stale")) return "client_stale";
  if (text.includes("wecom_window_missing")) return "client_stale";
  if (text.includes("search_field")) return "search_failed";
  if (text.includes("search_popup")) return "search_popup_not_visible";
  if (text.includes("input_box")) return "input_box_failed";
  if (text.includes("target")) return "target_not_verified";
  if (text.includes("chat_area")) return "chat_area_not_found";
  return "send_failed";
}

function structuredAutomationError(error, fallbackStatus = "send_failed") {
  const errorCode = errorCodeFromMessage(error?.message || error || fallbackStatus);
  return {
    status: errorCode,
    errorCode,
    error: String(error?.message || error || fallbackStatus),
    noScreenshot: true
  };
}

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 500_000) rejectBody(new Error("Request body too large"));
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

async function appIsRunning() {
  try {
    const result = await runAppleScript(`tell application "System Events" to exists process ${scriptString(appProcessName)}`, 5000);
    return result === "true";
  } catch {
    return false;
  }
}

async function checkWeComInteractivity() {
  try {
    const result = await runAppleScript(`
tell application "System Events"
  if not (exists process ${scriptString(appProcessName)}) then error "wecom_not_running"
  tell process ${scriptString(appProcessName)}
    if (count of windows) = 0 then error "wecom_window_missing"
    set mainWindow to first window whose name contains ${scriptString(appProcessName)}
    try
      set rootRole to role of UI element 1 of mainWindow
    on error
      error "wecom_window_stale"
    end try
    if rootRole is "" then error "wecom_window_stale"
    return "interactive"
  end tell
end tell
`, 3500);
    return { interactive: result === "interactive", errorCode: "", error: "" };
  } catch (error) {
    return {
      interactive: false,
      errorCode: errorCodeFromMessage(error?.message || error),
      error: String(error?.message || error || "wecom_window_stale")
    };
  }
}

async function screenIsLocked() {
  return await new Promise((resolve) => {
    execFile("ioreg", ["-n", "Root", "-d1"], { timeout: 3000 }, (error, stdout) => {
      if (error) {
        resolve(false);
        return;
      }
      const text = String(stdout || "");
      resolve(/CGSSessionScreenIsLocked\"?=Yes/.test(text) || /\"CGSSessionScreenIsLocked\" = Yes/.test(text));
    });
  });
}

async function assertInteractiveSession() {
  if (await screenIsLocked()) {
    throw new Error("screen_locked: macOS console is locked; GUI automation is paused");
  }
  const interactivity = await checkWeComInteractivity();
  if (!interactivity.interactive) {
    throw new Error(`${interactivity.errorCode || "client_stale"}: ${interactivity.error || "WeCom window is not interactive"}`);
  }
}

async function activateWeCom() {
  await assertInteractiveSession();
  await runAppleScript(`
tell application "System Events"
  if not (exists process ${scriptString(appProcessName)}) then error "wecom_not_running"
  tell process ${scriptString(appProcessName)}
    set frontmost to true
  end tell
end tell
`, 8000);
}

async function chooseNextUnread() {
  const result = await runAppleScript(`
tell application "System Events"
  tell process ${scriptString(appProcessName)}
    set frontmost to true
    try
      set unreadItem to menu item "选择下一个未读会话" of menu "窗口" of menu bar 1
      try
        set itemEnabled to enabled of unreadItem
      on error
        set itemEnabled to true
      end try
      if itemEnabled then
        click unreadItem
        return "selected"
      end if
    end try
    return "none"
  end tell
end tell
`, 8000);
  return result === "selected";
}

async function checkUnreadStatus() {
  const startedAt = Date.now();
  if (await screenIsLocked()) {
    throw new Error("screen_locked: macOS console is locked; GUI automation is paused");
  }
  const result = await runAppleScript(`
tell application "System Events"
  if not (exists process ${scriptString(appProcessName)}) then error "wecom_not_running"
  tell process ${scriptString(appProcessName)}
    try
      set unreadItem to menu item "选择下一个未读会话" of menu "窗口" of menu bar 1
      try
        set itemEnabled to enabled of unreadItem
      on error
        set itemEnabled to true
      end try
      if itemEnabled then
        return "has_unread"
      end if
    end try
    return "none"
  end tell
end tell
`, 5000);
  return {
    ok: true,
    hasUnread: result === "has_unread",
    status: result === "has_unread" ? "has_unread" : "none",
    timings: {
      totalMs: Date.now() - startedAt
    },
    noScreenshot: true
  };
}

async function scrapeVisibleText({
  maxItemsPerWindow = 220,
  timeoutMs = 25000,
  windowTitle = "",
  firstMatchingWindowOnly = false,
  closeSearchOverlay = false
} = {}) {
  const normalizedWindowTitle = String(windowTitle || "").trim();
  const output = await runAppleScript(`
tell application "System Events"
  tell process ${scriptString(appProcessName)}
    set frontmost to true
    if ${closeSearchOverlay ? "true" : "false"} then
      try
        key code 53
      end try
      delay 0.2
    end if
    delay 0.2
    set out to ""
    repeat with w in windows
      if ${normalizedWindowTitle ? "true" : "false"} then
        try
          set windowName to name of w
        on error
          set windowName to ""
        end try
        if windowName does not contain ${scriptString(normalizedWindowTitle)} then
          set windowName to ""
        else
          set windowName to ${scriptString(normalizedWindowTitle)}
        end if
      else
        set windowName to "matched"
      end if
      if windowName is not "" then
      set maxItems to 0
      set pending to UI elements of w
      repeat while (count of pending) > 0 and maxItems < ${Math.max(80, Math.min(420, Number(maxItemsPerWindow || 220)))}
        set e to item 1 of pending
        if (count of pending) = 1 then
          set pending to {}
        else
          set pending to items 2 thru -1 of pending
        end if
        set maxItems to maxItems + 1
        try
          set r to role of e
        on error
          set r to ""
        end try
        try
          set n to name of e
        on error
          set n to ""
        end try
        try
          set v to value of e
        on error
          set v to ""
        end try
        if (r is "AXStaticText" or r is "AXTextArea" or r is "AXTextField") then
          if (v is not missing value and v is not "") then
            set out to out & r & tab & v & linefeed
          else if (n is not missing value and n is not "") then
            set out to out & r & tab & n & linefeed
          end if
        end if
        try
          set pending to pending & (UI elements of e)
        end try
      end repeat
      if ${firstMatchingWindowOnly ? "true" : "false"} then
        exit repeat
      end if
      end if
    end repeat
    return out
  end tell
end tell
`, timeoutMs);
  return output.split(/\r?\n/).map((line) => {
    const [role, ...rest] = line.split("\t");
    return { role, text: rest.join("\t").trim() };
  }).filter((item) => item.text);
}

function inferCurrentMessage(items = []) {
  const texts = items.map((item) => item.text).filter(Boolean);
  const roomName = texts.find((text) => text && !/^\d+分钟前$|^\d{1,2}:\d{2}$|^昨天$|^星期/.test(text)) || "企微当前会话";
  const candidates = items
    .filter((item) => item.role === "AXTextArea" || item.text.length > 8)
    .map((item) => item.text)
    .filter((text) =>
      text &&
      !["全员", "外部"].includes(text.replace(/\u200b/g, "")) &&
      !text.includes("将与客户聊天时常用到的内容添加到快捷回复")
    );
  const latestText = candidates.at(-1) || texts.at(-1) || "";
  const now = new Date().toISOString();
  return {
    messageId: `wecom_local_${hashId([roomName, latestText])}`,
    roomId: `wecom_local_${hashId([roomName])}`,
    roomName,
    senderName: roomName,
    senderType: "customer",
    msgType: "text",
    text: latestText,
    sendAt: now,
    source: "wecom-client-realtime",
    confirmSource: "vendor-archive-download"
  };
}

function parseSnapshotLines(output = "") {
  return String(output || "").split(/\r?\n/).map((line) => {
    const [section, role, text, order, x, y, width, height] = line.split("\t");
    const numericOrder = Number(order || 0);
    const numericX = Number(x || 0);
    const numericWidth = Number(width || 0);
    return {
      section,
      role,
      text: String(text || "").trim(),
      order: numericOrder,
      rowOrder: numericOrder >= 1000 ? Math.floor(numericOrder / 1000) : 0,
      x: numericX,
      y: Number(y || 0),
      width: numericWidth,
      height: Number(height || 0),
      centerX: numericX && numericWidth ? numericX + (numericWidth / 2) : 0
    };
  }).filter((item) => item.section && (item.text || item.role === "chatBounds"));
}

function firstHeaderTitle(items = []) {
  return items
    .filter((item) => item.section === "header")
    .map((item) => item.text)
    .find((text) => text && !text.includes("由企业微信用户创建") && !text.includes("群主:")) || "企微当前会话";
}

async function readCurrentConversationSnapshot({ timeoutMs = 8000, maxItems = 6, scrollToBottom = false } = {}) {
  const output = await runAppleScript(`
on snapshotChatText(theElement, rowNo, itemNo)
  try
    tell application "System Events" to set r to role of theElement
  on error
    set r to ""
  end try
  if (r is not "AXTextArea" and r is not "AXStaticText" and r is not "AXButton") then return ""
  try
    tell application "System Events" to set v to value of theElement
  on error
    set v to ""
  end try
  set itemOrdinal to (rowNo * 1000) + itemNo
  set px to 0
  set py to 0
  set pw to 0
  set ph to 0
  try
    tell application "System Events" to set p to position of theElement
    set px to item 1 of p
    set py to item 2 of p
  end try
  try
    tell application "System Events" to set s to size of theElement
    set pw to item 1 of s
    set ph to item 2 of s
  end try
  if (v is not missing value and v is not "") then
    return "chat" & tab & r & tab & v & tab & itemOrdinal & tab & px & tab & py & tab & pw & tab & ph & linefeed
  end if
  try
    tell application "System Events" to set n to name of theElement
  on error
    set n to ""
  end try
  if (n is not missing value and n is not "") then
    return "chat" & tab & r & tab & n & tab & itemOrdinal & tab & px & tab & py & tab & pw & tab & ph & linefeed
  end if
  return ""
end snapshotChatText

tell application "System Events"
  tell process ${scriptString(appProcessName)}
    set frontmost to true
    delay 0.08
    set out to ""
    try
      ${paneScript()}
      set textFieldIndex to 0
      set directIndex to 0
      repeat with e in UI elements of pane
        set directIndex to directIndex + 1
        try
          set r to role of e
        on error
          set r to ""
        end try
        try
          set n to name of e
        on error
          set n to ""
        end try
        try
          set v to value of e
        on error
          set v to ""
        end try
        if r is "AXTextField" then
          set textFieldIndex to textFieldIndex + 1
        end if
        if r is "AXStaticText" or (r is "AXTextField" and textFieldIndex > 1) then
          if (v is not missing value and v is not "") then
            set out to out & "header" & tab & r & tab & v & tab & directIndex & linefeed
          else if (n is not missing value and n is not "") then
            set out to out & "header" & tab & r & tab & n & tab & directIndex & linefeed
          end if
        end if
      end repeat
      set chatRoot to missing value
      repeat with e in UI elements of pane
        try
          set r to role of e
        on error
          set r to ""
        end try
        try
          if r is "AXSplitGroup" then
            set chatRoot to e
          end if
        on error
        end try
      end repeat
      if chatRoot is missing value then
        repeat with e in UI elements of pane
          try
            if role of e is "AXSplitGroup" then
              set chatRoot to e
              exit repeat
            end if
          end try
        end repeat
      end if
      if chatRoot is missing value then error "chat_area_not_found"
      set messageRoot to missing value
      repeat with e in UI elements of chatRoot
        try
          if role of e is "AXSplitGroup" and (count of scroll areas of e) > 0 then
            set messageRoot to e
            exit repeat
          end if
        end try
      end repeat
      if messageRoot is missing value then set messageRoot to chatRoot
      set messageScrollArea to missing value
      try
        set messageScrollArea to scroll area 1 of messageRoot
      end try
      if ${scrollToBottom ? "true" : "false"} then
        try
          repeat with sb in scroll bars of messageScrollArea
            try
              set value of sb to 1.0
            end try
          end repeat
          delay 0.18
        end try
      end if
      try
        if messageScrollArea is not missing value then
          set scrollPosition to position of messageScrollArea
          set scrollSize to size of messageScrollArea
          set out to out & "meta" & tab & "chatBounds" & tab & "messageScrollArea" & tab & 0 & tab & (item 1 of scrollPosition) & tab & (item 2 of scrollPosition) & tab & (item 1 of scrollSize) & tab & (item 2 of scrollSize) & linefeed
        end if
      end try
      set usedTableFastPath to false
      set checkedCount to 0
      if messageScrollArea is not missing value then
        try
          set messageTable to table 1 of messageScrollArea
          set rowsList to rows of messageTable
          set rowCount to count of rowsList
          set startIndex to rowCount - ${Math.max(5, Math.min(40, Number(maxItems || 10)))} + 1
          if startIndex < 1 then set startIndex to 1
          repeat with rowIndex from startIndex to rowCount
            set rowItem to item rowIndex of rowsList
            set rowSequence to 0
            repeat with e in UI elements of rowItem
              set rowSequence to rowSequence + 1
              set out to out & my snapshotChatText(e, rowIndex, rowSequence)
              try
                repeat with childElement in UI elements of e
                  set rowSequence to rowSequence + 1
                  set out to out & my snapshotChatText(childElement, rowIndex, rowSequence)
                  try
                    repeat with grandChildElement in UI elements of childElement
                      set rowSequence to rowSequence + 1
                      set out to out & my snapshotChatText(grandChildElement, rowIndex, rowSequence)
                    end repeat
                  end try
                end repeat
              end try
            end repeat
          end repeat
          set usedTableFastPath to true
        end try
      end if
      if usedTableFastPath is false then
        if messageScrollArea is not missing value then
          set pending to UI elements of messageScrollArea
        else
          set pending to UI elements of messageRoot
        end if
        repeat while (count of pending) > 0
          set e to item 1 of pending
          if (count of pending) = 1 then
            set pending to {}
          else
            set pending to items 2 thru -1 of pending
          end if
          set checkedCount to checkedCount + 1
          if checkedCount > ${Math.max(80, Math.min(220, Number(maxItems || 180)))} then exit repeat
          try
            set r to role of e
          on error
            set r to ""
          end try
          if (r is "AXTextArea" or r is "AXStaticText") then
            try
              set v to value of e
            on error
              set v to ""
            end try
            set px to 0
            set py to 0
            set pw to 0
            set ph to 0
            try
              set p to position of e
              set px to item 1 of p
              set py to item 2 of p
            end try
            try
              set s to size of e
              set pw to item 1 of s
              set ph to item 2 of s
            end try
            if (v is not missing value and v is not "") then
              set out to out & "chat" & tab & r & tab & v & tab & checkedCount & tab & px & tab & py & tab & pw & tab & ph & linefeed
            else
              try
                set n to name of e
              on error
                set n to ""
              end try
              if (n is not missing value and n is not "") then
                set out to out & "chat" & tab & r & tab & n & tab & checkedCount & tab & px & tab & py & tab & pw & tab & ph & linefeed
              end if
            end if
          end if
          try
            set pending to pending & (UI elements of e)
          end try
        end repeat
      end if
    end try
    return out
  end tell
end tell
`, timeoutMs);
  return parseSnapshotLines(output);
}

function isSkippableChatText(text = "", roomName = "") {
  const normalized = String(text || "").replace(/\u200b/g, "").trim();
  return !normalized ||
    normalized === roomName ||
    /^\d{1,2}:\d{2}$/.test(normalized) ||
    /^昨天\s*\d{1,2}:\d{2}$/.test(normalized) ||
    /^星期/.test(normalized) ||
    /^群成员[·:]/.test(normalized) ||
    ["群看板", "边聊边看工作进展", "快捷回复", "客户详情", "自定义"].includes(normalized);
}

function isTimestampText(text = "") {
  const normalized = String(text || "").replace(/\u200b/g, "").trim();
  return /^\d{1,2}:\d{2}$/.test(normalized) ||
    /^昨天\s*\d{1,2}:\d{2}$/.test(normalized) ||
    /^星期/.test(normalized) ||
    /^\d+分钟前$/.test(normalized) ||
    /^今天$/.test(normalized) ||
    /^昨天$/.test(normalized);
}

function isSenderCandidateText(text = "", roomName = "") {
  const normalized = String(text || "").replace(/\u200b/g, "").trim().replace(/[:：]$/, "");
  if (!normalized) return false;
  if (normalized === roomName) return false;
  if (isTimestampText(normalized)) return false;
  if (["BOT", "全员", "外部", "@微信", "微信联系人"].includes(normalized)) return false;
  if (/^群成员[·:]/.test(normalized)) return false;
  if (/由企业微信用户创建|群主:|群看板|快捷回复|客户详情|自定义/.test(normalized)) return false;
  return true;
}

function cleanConversationSenderName(roomName = "") {
  return String(roomName || "")
    .replace(/\s*@微信\s*/g, "")
    .replace(/\s*外部\s*/g, "")
    .trim();
}

function classifySenderType(senderName = "") {
  const normalized = String(senderName || "").replace(/\u200b/g, "").trim();
  if (!normalized || normalized === "未知发送人") return "unknown";
  if (managedSenderNames.has(normalized)) return "staff";
  return "customer";
}

function startOfLocalDay(date = new Date()) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function parseWeComVisibleTimestamp(text = "", observedAt = isoNow()) {
  const normalized = String(text || "").replace(/\u200b/g, "").trim();
  if (!normalized) return "";
  const observedDate = new Date(observedAt);
  if (Number.isNaN(observedDate.getTime())) return "";
  const applyTime = (baseDate, hour, minute) => {
    const date = new Date(baseDate);
    date.setHours(Number(hour), Number(minute), 0, 0);
    return date.toISOString();
  };
  const timeOnly = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (timeOnly) return applyTime(observedDate, timeOnly[1], timeOnly[2]);
  const yesterday = normalized.match(/^昨天\s*(\d{1,2}):(\d{2})$/);
  if (yesterday) {
    const date = startOfLocalDay(observedDate);
    date.setDate(date.getDate() - 1);
    return applyTime(date, yesterday[1], yesterday[2]);
  }
  const weekday = normalized.match(/^星期([日天一二三四五六])\s*(\d{1,2}):(\d{2})$/);
  if (weekday) {
    const weekdayMap = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
    const targetDay = weekdayMap[weekday[1]];
    const date = startOfLocalDay(observedDate);
    let diff = date.getDay() - targetDay;
    if (diff < 0) diff += 7;
    date.setDate(date.getDate() - diff);
    const parsed = new Date(applyTime(date, weekday[2], weekday[3]));
    if (parsed.getTime() > observedDate.getTime() + 60_000) parsed.setDate(parsed.getDate() - 7);
    return parsed.toISOString();
  }
  const monthDay = normalized.match(/^(\d{1,2})[/-](\d{1,2})\s*(\d{1,2}):(\d{2})$/);
  if (monthDay) {
    const date = new Date(observedDate);
    date.setMonth(Number(monthDay[1]) - 1, Number(monthDay[2]));
    date.setHours(Number(monthDay[3]), Number(monthDay[4]), 0, 0);
    if (date.getTime() > observedDate.getTime() + 60_000) date.setFullYear(date.getFullYear() - 1);
    return date.toISOString();
  }
  return "";
}

function classifyVisibleChatText(text = "") {
  const normalized = String(text || "").replace(/\u200b/g, "").trim();
  if (/语音|voice/i.test(normalized)) return { msgType: "voice", text: normalized || "[voice消息]" };
  if (/图片|照片|image/i.test(normalized)) return { msgType: "image", text: normalized || "[image消息]" };
  if (/文件|file/i.test(normalized)) return { msgType: "file", text: normalized || "[file消息]" };
  if (/视频|video/i.test(normalized)) return { msgType: "video", text: normalized || "[video消息]" };
  return { msgType: "text", text: normalized };
}

function visibleMessagesFromSnapshot(items = [], { batchObservedAt = isoNow(), batchStartedAt = "" } = {}) {
  const roomName = firstHeaderTitle(items);
  const chatBounds = items.find((item) => item.section === "meta" && item.role === "chatBounds");
  const chatCenterX = chatBounds?.x && chatBounds?.width ? chatBounds.x + (chatBounds.width / 2) : 0;
  const managedSenderName = Array.from(managedSenderNames).find(Boolean) || "当前企微账号";
  const textCandidates = items
    .filter((item) => item.section === "chat" && item.role === "AXTextArea")
    .map((item) => ({ ...item, text: item.text.replace(/\u200b/g, "").trim() }))
    .filter((item) => !isSkippableChatText(item.text, roomName))
    .map((item) => ({ ...item, ...classifyVisibleChatText(item.text) }));
  const nonTextCandidates = items
    .filter((item) => item.section === "chat" && item.role === "AXStaticText")
    .map((item) => ({ ...item, text: item.text.replace(/\u200b/g, "").trim() }))
    .filter((item) => !isSkippableChatText(item.text, roomName))
    .filter((item) => !/[:：]$/.test(item.text))
    .map((item) => ({ ...item, ...classifyVisibleChatText(item.text) }))
    .filter((item) => item.msgType !== "text");
  const candidates = [...textCandidates, ...nonTextCandidates]
    .sort((a, b) => a.order - b.order);
  const senderHints = items
    .filter((item) => item.section === "chat" && item.role === "AXStaticText")
    .map((item) => ({ ...item, text: item.text.replace(/\u200b/g, "").trim() }))
    .filter((item) => item.text && /[:：]$/.test(item.text))
    .sort((a, b) => a.order - b.order);
  const senderCandidates = items
    .filter((item) => item.section === "chat" && (item.role === "AXStaticText" || item.role === "AXButton"))
    .map((item) => ({ ...item, text: item.text.replace(/\u200b/g, "").trim() }))
    .filter((item) => isSenderCandidateText(item.text, roomName))
    .sort((a, b) => a.order - b.order);
  const timestampCandidates = items
    .filter((item) => item.section === "chat" && item.role === "AXStaticText")
    .map((item) => ({ ...item, text: item.text.replace(/\u200b/g, "").trim() }))
    .filter((item) => isTimestampText(item.text))
    .sort((a, b) => a.order - b.order);
  const roomId = `wecom_local_${hashId([roomName])}`;
  const readBatchId = `wecom_read_${hashId([roomId, batchObservedAt])}`;
  const occurrenceByFingerprint = new Map();
  return candidates.map((message) => {
    const fingerprint = `${message.msgType}:${message.text}`;
    const occurrence = (occurrenceByFingerprint.get(fingerprint) || 0) + 1;
    occurrenceByFingerprint.set(fingerprint, occurrence);
    const sameRowSender = senderCandidates
      .filter((item) => item.rowOrder && item.rowOrder === message.rowOrder && item.order < message.order)
      .at(-1);
    const senderHint = sameRowSender || senderHints.filter((item) => item.order < message.order).at(-1);
    const isOutgoingBubble = Boolean(chatCenterX && message.centerX && message.centerX > chatCenterX + 24 && !sameRowSender);
    const fallbackSenderName = cleanConversationSenderName(roomName);
    const senderName = isOutgoingBubble
      ? managedSenderName
      : (senderHint?.text?.replace(/[:：]$/, "") || fallbackSenderName || "未知发送人");
    const senderType = isOutgoingBubble ? "staff" : classifySenderType(senderName);
    const senderConfidence = isOutgoingBubble
      ? "outgoing_geometry"
      : (senderHint ? "medium" : (fallbackSenderName ? "fallback_room" : "low"));
    const sameRowTimestamp = timestampCandidates
      .filter((item) => item.rowOrder && item.rowOrder === message.rowOrder && item.order < message.order)
      .at(-1);
    const previousTimestamp = timestampCandidates.filter((item) => item.order < message.order).at(-1);
    const visibleTimestamp = sameRowTimestamp || previousTimestamp;
    const parsedSendAt = visibleTimestamp ? parseWeComVisibleTimestamp(visibleTimestamp.text, batchObservedAt) : "";
    const sendAt = parsedSendAt || batchStartedAt || batchObservedAt;
    return {
      messageId: `wecom_local_${hashId([roomName, message.msgType, message.text, occurrence])}`,
      roomId,
      roomName,
      senderName,
      senderType,
      msgType: message.msgType,
      text: message.text,
      sendAt,
      source: "wecom-client-realtime",
      confirmSource: "vendor-archive-download",
      observedAt: batchObservedAt,
      readBatchId,
      visibleOrder: message.order,
      bubbleSide: isOutgoingBubble ? "right" : "left_or_unknown",
      senderConfidence,
      timestampText: visibleTimestamp?.text || "",
      timestampConfidence: parsedSendAt ? "visible" : "read_started",
      readSource: "wecom-client-accessibility"
    };
  });
}

function normalizeAckMessage(item) {
  if (typeof item === "string") return { messageId: item, roomId: "" };
  if (item && typeof item === "object") {
    return {
      messageId: item.messageId || item.msgid || item.id || "",
      roomId: item.roomId || item.chatId || item.chatid || ""
    };
  }
  return { messageId: "", roomId: "" };
}

function rememberAckedMessages(messages = [], fallbackCursor = "") {
  let changed = false;
  for (const item of messages || []) {
    const { messageId, roomId } = normalizeAckMessage(item);
    const normalized = String(messageId || "").trim();
    if (normalized && !ackedMessageIds.has(normalized)) {
      ackedMessageIds.add(normalized);
      changed = true;
    }
    const normalizedRoomId = String(roomId || "").trim();
    if (normalized && normalizedRoomId && lastAckedCursorByRoomId.get(normalizedRoomId) !== normalized) {
      lastAckedCursorByRoomId.set(normalizedRoomId, normalized);
      changed = true;
    }
  }
  const normalizedFallbackCursor = String(fallbackCursor || "").trim();
  if (normalizedFallbackCursor && !ackedMessageIds.has(normalizedFallbackCursor)) {
    ackedMessageIds.add(normalizedFallbackCursor);
    changed = true;
  }
  if (ackedMessageIds.size > 2000) {
    const overflow = ackedMessageIds.size - 1500;
    for (const messageId of Array.from(ackedMessageIds).slice(0, overflow)) {
      ackedMessageIds.delete(messageId);
    }
    changed = true;
  }
  if (changed) persistAckState();
}

function selectNewMessages(messages = [], { roomId = "", cursor = "", knownMessageIds = [], limit = 20 } = {}) {
  const roomCursor = roomId ? lastAckedCursorByRoomId.get(roomId) || "" : "";
  const normalizedCursor = String(cursor || roomCursor || lastAckedCursor || "").trim();
  const known = new Set((Array.isArray(knownMessageIds) ? knownMessageIds : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean));
  for (const messageId of ackedMessageIds) known.add(messageId);
  let selected = messages;
  if (normalizedCursor) {
    const cursorIndex = messages.findIndex((message) => message.messageId === normalizedCursor);
    if (cursorIndex >= 0) {
      selected = messages.slice(cursorIndex + 1);
      if (known.size) selected = selected.filter((message) => !known.has(message.messageId));
    } else if (known.size) {
      selected = messages.filter((message) => !known.has(message.messageId));
    } else {
      selected = messages.slice(-Math.max(1, Number(limit || 20)));
    }
  } else if (known.size) {
    selected = messages.filter((message) => !known.has(message.messageId));
  } else {
    selected = messages.slice(-Math.max(1, Number(limit || 20)));
  }
  return selected.slice(-Math.max(1, Number(limit || 20)));
}

function latestBusinessMessage(messages = []) {
  return messages.filter((message) => message?.messageId && message?.text).at(-1) || null;
}

function textMatchesTrigger(messageText = "", triggerText = "") {
  const left = String(messageText || "").replace(/\s+/g, "").trim();
  const right = String(triggerText || "").replace(/\s+/g, "").trim();
  return Boolean(left && right && left === right);
}

async function runPreSendGuard(command = {}, timings = {}) {
  const triggerLatestMessageId = String(command.triggerLatestMessageId || "").trim();
  const triggerLatestText = String(command.triggerLatestText || "").trim();
  const maxItems = Math.max(3, Math.min(12, Number(command.preSendGuardMaxItems || 3)));
  const guardStartedAt = Date.now();
  const batchStartedAt = new Date(guardStartedAt).toISOString();
  const items = await readCurrentConversationSnapshot({
    timeoutMs: Math.max(3000, Math.min(12000, Number(command.preSendGuardTimeoutMs || 5000))),
    maxItems,
    scrollToBottom: true
  });
  const batchObservedAt = isoNow();
  const visibleMessages = visibleMessagesFromSnapshot(items, { batchObservedAt, batchStartedAt });
  const latest = latestBusinessMessage(visibleMessages);
  timings.preSendGuardMs = Date.now() - guardStartedAt;
  if (!latest) {
    return {
      ok: false,
      status: "target_latest_unverified",
      errorCode: "target_latest_unverified",
      error: "发送前无法确认目标会话最新消息，已取消本次发送。",
      messages: [],
      latestMessageId: "",
      latestText: "",
      preSendGuard: {
        status: "unverified",
        latestMessageId: "",
        latestText: "",
        visibleMessageCount: visibleMessages.length,
        timings: { preSendGuardMs: timings.preSendGuardMs }
      }
    };
  }
  const matchedById = Boolean(triggerLatestMessageId && latest.messageId === triggerLatestMessageId);
  const matchedByText = !triggerLatestMessageId && textMatchesTrigger(latest.text, triggerLatestText);
  if (matchedById || matchedByText) {
    return {
      ok: true,
      latest,
      visibleMessages,
      preSendGuard: {
        status: "matched",
        matchedBy: matchedById ? "messageId" : "text",
        latestMessageId: latest.messageId,
        latestText: latest.text,
        latestSenderType: latest.senderType,
        visibleMessageCount: visibleMessages.length,
        timings: { preSendGuardMs: timings.preSendGuardMs }
      }
    };
  }
  const triggerIndex = visibleMessages.findIndex((message) =>
    (triggerLatestMessageId && message.messageId === triggerLatestMessageId) ||
    textMatchesTrigger(message.text, triggerLatestText)
  );
  const newMessages = triggerIndex >= 0 ? visibleMessages.slice(triggerIndex + 1) : visibleMessages;
  return {
    ok: false,
    status: "aborted_new_messages",
    errorCode: "preflight_room_version_stale",
    error: "发送前发现目标会话已有新消息，已取消本次发送并等待系统重新判断。",
    messages: newMessages,
    latestMessageId: latest.messageId,
    latestText: latest.text,
    preSendGuard: {
      status: "new_messages",
      latestMessageId: latest.messageId,
      latestText: latest.text,
      latestSenderType: latest.senderType,
      triggerLatestMessageId,
      triggerLatestText,
      visibleMessageCount: visibleMessages.length,
      returnedMessageCount: newMessages.length,
      timings: { preSendGuardMs: timings.preSendGuardMs }
    }
  };
}

async function pullMessages({ unreadOnly = true, currentOnly = false, timeoutMs = 8000, maxItems = 6, cursor = "", knownMessageIds = [], limit = 20, includeRaw = false } = {}) {
  const startedAt = Date.now();
  const batchStartedAt = new Date(startedAt).toISOString();
  const timings = {};
  await activateWeCom();
  timings.activateMs = Date.now() - startedAt;
  if (unreadOnly) {
    const unreadStartedAt = Date.now();
    const selectedUnread = await chooseNextUnread();
    timings.chooseUnreadMs = Date.now() - unreadStartedAt;
    if (!selectedUnread) {
      return {
        messages: [],
        cursor: cursor || "",
        nextCursor: cursor || "",
        roomId: "",
        roomName: "",
        readBatchId: `wecom_read_no_unread_${hashId([isoNow()])}`,
        readSource: "wecom-client-accessibility",
        rawTextCount: 0,
        visibleMessageCount: 0,
        returnedMessageCount: 0,
        noUnreadDetected: true,
        timings: {
          ...timings,
          totalMs: Date.now() - startedAt
        }
      };
    }
    const settleStartedAt = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 450));
    timings.settleMs = Date.now() - settleStartedAt;
  }
  const snapshotStartedAt = Date.now();
  const items = await readCurrentConversationSnapshot({
    timeoutMs: Math.max(3000, Math.min(30000, Number(timeoutMs || 8000))),
    maxItems: Math.max(5, Math.min(80, Number(maxItems || 6))),
    scrollToBottom: Boolean(currentOnly && !unreadOnly)
  });
  timings.snapshotMs = Date.now() - snapshotStartedAt;
  const parseStartedAt = Date.now();
  const batchObservedAt = isoNow();
  const visibleMessages = visibleMessagesFromSnapshot(items, { batchObservedAt, batchStartedAt });
  const roomId = visibleMessages.at(-1)?.roomId || "";
  const roomName = visibleMessages.at(-1)?.roomName || firstHeaderTitle(items);
  const ignoredUnreadRoom = (unreadOnly || currentOnly) && Boolean(roomName) && ignoredUnreadConversationNames.has(roomName);
  if (ignoredUnreadRoom) {
    timings.parseMs = Date.now() - parseStartedAt;
    return {
      messages: [],
      cursor: cursor || "",
      nextCursor: cursor || "",
      roomId,
      roomName,
      readBatchId: `wecom_read_ignored_${hashId([roomName, batchObservedAt])}`,
      readSource: "wecom-client-accessibility",
      rawTextCount: items.length,
      visibleMessageCount: visibleMessages.length,
      returnedMessageCount: 0,
      unsupportedUnread: true,
      noUnreadDetected: true,
      ignoredUnreadRoom: true,
      currentOnly: Boolean(currentOnly),
      timings: {
        ...timings,
        totalMs: Date.now() - startedAt
      },
      ...(includeRaw ? { rawItems: items.slice(-120) } : {})
    };
  }
  const messages = selectNewMessages(visibleMessages, {
    roomId,
    cursor,
    knownMessageIds,
    limit: Math.max(1, Math.min(50, Number(limit || 20)))
  });
  timings.parseMs = Date.now() - parseStartedAt;
  const nextCursor = messages.at(-1)?.messageId || visibleMessages.at(-1)?.messageId || cursor || "";
  const readBatchId = visibleMessages.at(-1)?.readBatchId || `wecom_read_${hashId([roomName, isoNow()])}`;
  if (!visibleMessages.length) {
    const unsupportedUnread = unreadOnly && Boolean(roomName) && ignoredUnreadConversationNames.has(roomName);
    return {
      messages: [],
      cursor: nextCursor,
      nextCursor,
      roomId,
      roomName,
      readBatchId,
      readSource: "wecom-client-accessibility",
      rawTextCount: items.length,
      visibleMessageCount: 0,
      returnedMessageCount: 0,
      unsupportedUnread,
      noUnreadDetected: unsupportedUnread,
      currentOnly: Boolean(currentOnly),
      timings: {
        ...timings,
        totalMs: Date.now() - startedAt
      },
      ...(includeRaw ? { rawItems: items.slice(-120) } : {})
    };
  }
  return {
    messages,
    cursor: nextCursor,
    nextCursor,
    roomId,
    roomName,
    readBatchId,
    readSource: "wecom-client-accessibility",
    rawTextCount: items.length,
    visibleMessageCount: visibleMessages.length,
    returnedMessageCount: messages.length,
    visibleMessageIds: visibleMessages.map((message) => message.messageId).slice(-80),
    latestMessageIds: visibleMessages.map((message) => message.messageId).slice(-20),
    currentOnly: Boolean(currentOnly),
    timings: {
      ...timings,
      totalMs: Date.now() - startedAt
    },
    ...(includeRaw ? { rawItems: items.slice(-120) } : {})
  };
}

async function resetToIdleConversation({ roomName = idleConversationName } = {}) {
  const target = String(roomName || "").trim();
  if (!target) {
    return {
      status: "idle_disabled",
      ok: true,
      reset: false,
      noScreenshot: true
    };
  }
  await assertInteractiveSession();
  const previousClipboard = await getClipboard().catch(() => "");
  const startedAt = Date.now();
  try {
    await sidebarSearch(target, { openFirstResult: true, verifyToken: target });
    return {
      status: "idle",
      ok: true,
      reset: true,
      roomName: target,
      timings: {
        totalMs: Date.now() - startedAt
      },
      noScreenshot: true
    };
  } finally {
    await setClipboard(previousClipboard).catch(() => {});
  }
}

async function setClipboard(text = "") {
  await new Promise((resolve, reject) => {
    const child = execFile("pbcopy", [], (error) => (error ? reject(error) : resolve()));
    child.stdin.end(String(text || ""));
  });
}

async function getClipboard() {
  return await new Promise((resolve, reject) => {
    execFile("pbpaste", [], (error, stdout) => (error ? reject(error) : resolve(String(stdout || ""))));
  });
}

function mainWindowScript() {
  return `set mainWindow to first window whose name contains ${scriptString(appProcessName)}`;
}

function paneScript() {
  return `
${mainWindowScript()}
set root to UI element 1 of mainWindow
set pane to missing value
set fallbackPane to missing value
repeat with candidate in UI elements of root
  try
    set candidateRole to role of candidate
  on error
    set candidateRole to ""
  end try
  if candidateRole is "AXSplitGroup" then
    set fallbackPane to candidate
    set hasTextField to false
    set hasScrollArea to false
    set hasNestedSplitGroup to false
    repeat with child in UI elements of candidate
      try
        set childRole to role of child
      on error
        set childRole to ""
      end try
      if childRole is "AXTextField" then set hasTextField to true
      if childRole is "AXScrollArea" then set hasScrollArea to true
      if childRole is "AXSplitGroup" then set hasNestedSplitGroup to true
    end repeat
    if hasTextField and hasScrollArea and hasNestedSplitGroup then
      set pane to candidate
      exit repeat
    end if
  end if
end repeat
if pane is missing value and fallbackPane is not missing value then set pane to fallbackPane
if pane is missing value then error "main_pane_not_found"
`;
}

async function sidebarSearch(query = "", { openFirstResult = false, verifyToken = "" } = {}) {
  await setClipboard(query);
  const output = await runAppleScript(`
tell application "System Events"
  if not (exists process ${scriptString(appProcessName)}) then error "wecom_not_running"
  tell process ${scriptString(appProcessName)}
    set frontmost to true
    try
      keystroke "1" using command down
    end try
    delay 0.05
    try
      key code 53
    end try
    delay 0.03
    try
      keystroke "f" using command down
    end try
    delay 0.12
    try
      ${paneScript()}
      set searchField to missing value
      repeat with e in UI elements of pane
        try
          set r to role of e
        on error
          set r to ""
        end try
        if r is "AXTextField" then
          set searchField to e
          exit repeat
        end if
      end repeat
      if searchField is missing value then error "search_field_not_found"
    on error
      error "search_field_not_found"
    end try
    try
      set searchRole to role of searchField
    on error
      set searchRole to ""
    end try
    if searchRole is not "AXTextField" then error "search_field_not_found"
    set searchReady to false
    set enteredResult to false
    set lastSearchError to "search_not_started"
    repeat with attemptIndex from 1 to ${openFirstResult ? 3 : 1}
      set frontmost to true
      try
        perform action "AXPress" of searchField
      end try
      delay 0.02
      set focused of searchField to true
      delay 0.02
      keystroke "a" using command down
      delay 0.02
      key code 51
      delay 0.02
      keystroke "v" using command down
      delay 0.08
      try
        set appliedSearchValue to value of searchField
      on error
        set appliedSearchValue to ""
      end try
      if appliedSearchValue is not ${scriptString(query)} then
        set lastSearchError to "search_value_not_applied"
      end if
      delay 0.9
      try
        set searchValue to value of searchField
      on error
        set searchValue to ""
      end try
      if searchValue is not ${scriptString(query)} then
        set lastSearchError to "search_value_not_applied"
      else
        set searchReady to true
        if ${openFirstResult ? "true" : "false"} then
          set frontmost to true
          set focused of searchField to true
          delay 0.03
          key code 36
          delay 0.15
          set enteredResult to true
        end if
        exit repeat
      end if
      delay 0.08
    end repeat
    if searchReady is false then error lastSearchError
    if ${openFirstResult ? "true" : "false"} then
      if enteredResult is false then error "search_enter_not_sent"
      if ${verifyToken ? "true" : "false"} then
        set verifiedTarget to false
        set verifyPreview to ""
        repeat with verifyAttempt from 1 to 4
          set verifyPreview to ""
          try
            set textFieldIndex to 0
            repeat with e in UI elements of pane
              try
                set r to role of e
              on error
                set r to ""
              end try
              try
                set n to name of e
              on error
                set n to ""
              end try
              try
                set v to value of e
              on error
                set v to ""
              end try
              if r is "AXTextField" then set textFieldIndex to textFieldIndex + 1
              if r is "AXStaticText" or (r is "AXTextField" and textFieldIndex > 1) then
                if (v is not missing value and v is not "") then
                  set verifyPreview to verifyPreview & v & linefeed
                else if (n is not missing value and n is not "") then
                  set verifyPreview to verifyPreview & n & linefeed
                end if
              end if
            end repeat
          end try
          if verifyPreview contains ${scriptString(verifyToken)} then
            set verifiedTarget to true
            exit repeat
          end if
          delay 0.04
        end repeat
        if verifiedTarget is false then error "target_not_verified:" & verifyPreview
      end if
    end if
    return "ok"
  end tell
end tell
`, 12000);
  return { ok: output === "ok" || output === "", verified: true };
}

async function readConversationHeaderText({ timeoutMs = 5000 } = {}) {
  const output = await runAppleScript(`
tell application "System Events"
  tell process ${scriptString(appProcessName)}
    set frontmost to true
    set out to ""
    try
      ${paneScript()}
      set textFieldIndex to 0
      set directIndex to 0
      repeat with e in UI elements of pane
        set directIndex to directIndex + 1
        try
          set r to role of e
        on error
          set r to ""
        end try
        try
          set n to name of e
        on error
          set n to ""
        end try
        try
          set v to value of e
        on error
          set v to ""
        end try
        if r is "AXTextField" then
          set textFieldIndex to textFieldIndex + 1
        end if
        if r is "AXStaticText" or (r is "AXTextField" and textFieldIndex > 1) then
          if (v is not missing value and v is not "") then
            set out to out & r & tab & v & linefeed
          else if (n is not missing value and n is not "") then
            set out to out & r & tab & n & linefeed
          end if
        end if
      end repeat
    end try
    return out
  end tell
end tell
`, timeoutMs);
  return output.split(/\r?\n/).map((line) => {
    const [role, ...rest] = line.split("\t");
    return { role, text: rest.join("\t").trim() };
  }).filter((item) => item.text);
}

async function verifyCurrentConversation({ roomName = "", expectedTitleToken = "" } = {}) {
  const verifyToken = String(expectedTitleToken || roomName || "").trim();
  if (!verifyToken) {
    return { verified: false, visiblePreview: "", errorCode: "target_token_missing" };
  }
  try {
    const startedAt = Date.now();
    let lastVisibleText = "";
    let lastCount = 0;
    do {
      const items = await readConversationHeaderText({ timeoutMs: 1200 });
      const visibleText = items.map((item) => item.text).join("\n");
      if (visibleText.includes(verifyToken)) {
        return {
          verified: true,
          visiblePreview: visibleText.slice(0, 400),
          rawTextCount: items.length
        };
      }
      lastVisibleText = visibleText;
      lastCount = items.length;
      await new Promise((resolve) => setTimeout(resolve, 120));
    } while (Date.now() - startedAt < 1400);
    return {
      verified: false,
      visiblePreview: lastVisibleText.slice(0, 400),
      rawTextCount: lastCount
    };
  } catch (error) {
    return {
      verified: false,
      visiblePreview: "",
      errorCode: "verification_timeout",
      error: error.message
    };
  }
}

async function sendMessage(command = {}) {
  const roomName = String(command.roomName || command.searchName || command.roomId || "").trim();
  const expectedTitleToken = String(command.expectedTitleToken || command.titleToken || "").trim();
  const text = String(command.text || "").trim();
  const dryRun = command.dryRun === true || command.dryRun === "true";
  const prepareOnly = command.prepareOnly === true || command.prepareOnly === "true";
  const allowSend = dryRun || prepareOnly || allowSendByDefault || command.allowSend === true || command.allowSend === "true";
  if (!roomName) throw new Error("room_not_found: roomName/searchName is required");
  if (!text && !dryRun) throw new Error("send_failed: text is required");
  if (!expectedTitleToken) {
    return {
      status: "target_not_verified",
      verified: false,
      roomName,
      expectedTitleToken,
      errorCode: "target_token_missing",
      error: "expectedTitleToken is required before touching the WeCom client.",
      noScreenshot: true
    };
  }
  if (!dryRun && !prepareOnly && !allowSend) {
    return {
      status: "send_blocked",
      verified: false,
      roomName,
      expectedTitleToken,
      error: "Set WECOM_AUTOMATION_ALLOW_SEND=true or pass allowSend=true to allow UI automation.",
      noScreenshot: true
    };
  }

  const previousClipboard = await getClipboard().catch(() => "");
  const timings = {};
  const startedAt = Date.now();
  try {
    await assertInteractiveSession();
    const searchStartedAt = Date.now();
    let lastSearchException = null;
    for (let searchAttempt = 1; searchAttempt <= 2; searchAttempt += 1) {
      try {
        await sidebarSearch(expectedTitleToken || roomName, { openFirstResult: true, verifyToken: expectedTitleToken });
        lastSearchException = null;
        break;
      } catch (error) {
        lastSearchException = error;
        if (searchAttempt >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }
    if (lastSearchException) throw lastSearchException;
    timings.searchAndVerifyMs = Date.now() - searchStartedAt;
    if (dryRun) {
      return {
        status: "dry_run_verified",
        verified: true,
        roomName,
        expectedTitleToken,
        timings: { ...timings, totalMs: Date.now() - startedAt },
        noScreenshot: true
      };
    }
    if (!allowSend) {
      return {
        status: "send_blocked",
        verified: true,
        roomName,
        expectedTitleToken,
        error: "Set WECOM_AUTOMATION_ALLOW_SEND=true or pass allowSend=true to send."
      };
    }
    const preSendGuard = await runPreSendGuard(command, timings);
    if (!preSendGuard.ok) {
      return {
        status: preSendGuard.status,
        sent: false,
        verified: true,
        roomName,
        expectedTitleToken,
        errorCode: preSendGuard.errorCode,
        error: preSendGuard.error,
        messages: preSendGuard.messages || [],
        latestMessageId: preSendGuard.latestMessageId || "",
        latestText: preSendGuard.latestText || "",
        preSendGuard: preSendGuard.preSendGuard,
        timings: { ...timings, totalMs: Date.now() - startedAt },
        noScreenshot: true
      };
    }
    await setClipboard(text);
    const inputStartedAt = Date.now();
    const inputMode = await runAppleScript(`
tell application "System Events"
  tell process ${scriptString(appProcessName)}
    set frontmost to true
    ${paneScript()}
    set chatRoot to missing value
    repeat with e in UI elements of pane
      try
        set r to role of e
      on error
        set r to ""
      end try
      if r is "AXSplitGroup" then
        set chatRoot to e
      end if
    end repeat
    if chatRoot is missing value then error "chat_area_not_found"
    set inputField to missing value
    set inputLocateMode to "fast_path"
    try
      set chatMain to UI element 1 of chatRoot
      set inputArea to scroll area 2 of chatMain
      set inputField to text area 1 of inputArea
      try
        set inputRole to role of inputField
      on error
        set inputRole to ""
      end try
      if inputRole is not "AXTextArea" then error "fast_input_box_not_found"
    on error
      set inputLocateMode to "fallback_scan"
      set pending to UI elements of chatRoot
      set checkedCount to 0
      repeat while (count of pending) > 0 and checkedCount < 140
        set e to item 1 of pending
        if (count of pending) = 1 then
          set pending to {}
        else
          set pending to items 2 thru -1 of pending
        end if
        set checkedCount to checkedCount + 1
        try
          set r to role of e
        on error
          set r to ""
        end try
        try
          set v to value of e
        on error
          set v to ""
        end try
        if r is "AXTextArea" and (v is missing value or v is "") then
          try
            set focused of e to true
            delay 0.02
            try
              set candidateFocused to focused of e
            on error
              set candidateFocused to false
            end try
            if candidateFocused then
              set inputField to e
              exit repeat
            end if
          end try
        end if
        try
          set pending to pending & (UI elements of e)
        end try
      end repeat
    end try
    if inputField is missing value then error "input_box_not_found"
    set inputReady to false
    set lastInputError to "input_not_started"
    repeat with attemptIndex from 1 to 3
      set frontmost to true
      try
        perform action "AXPress" of inputField
      end try
      delay 0.02
      set focused of inputField to true
      delay 0.02
      try
        set inputFocused to focused of inputField
      on error
        set inputFocused to false
      end try
      try
        set existingText to value of inputField
      on error
        set existingText to ""
      end try
      if existingText is not missing value and existingText is not "" then
        try
          set value of inputField to ""
        end try
        if inputFocused then
          keystroke "a" using command down
          delay 0.02
          key code 51
        end if
        delay 0.03
      end if
      try
        set value of inputField to ${scriptString(text)}
      on error
      end try
      delay 0.08
      try
        set pastedText to value of inputField
      on error
        set pastedText to ""
      end try
      if pastedText does not contain ${scriptString(text)} and inputFocused then
        keystroke "v" using command down
        delay 0.08
        try
          set pastedText to value of inputField
        on error
          set pastedText to ""
        end try
      end if
      if pastedText contains ${scriptString(text)} then
        set inputReady to true
        exit repeat
      else
        set lastInputError to "input_box_not_updated"
      end if
      delay 0.04
    end repeat
    if inputReady is false then error lastInputError
    set frontmost to true
    set focused of inputField to true
    delay 0.03
    if ${prepareOnly ? "true" : "false"} then
      keystroke "a" using command down
      delay 0.02
      key code 51
    else
      key code 36
    end if
    return inputLocateMode
  end tell
end tell
`, 10000);
    timings.inputAndSendMs = Date.now() - inputStartedAt;
    timings.inputMode = inputMode || "unknown";
    if (prepareOnly) {
      return {
	      status: "prepared",
	      verified: true,
	      roomName,
	      expectedTitleToken,
	      preSendGuard: preSendGuard.preSendGuard,
	      timings: { ...timings, totalMs: Date.now() - startedAt },
	      noScreenshot: true
	    };
	  }
    return {
      status: "sent",
      gatewayRequestId: `wecom_local_${Date.now()}`,
      externalMessageId: "",
      verified: true,
      preSendGuard: preSendGuard.preSendGuard,
      timings: { ...timings, totalMs: Date.now() - startedAt },
      noScreenshot: true
    };
  } finally {
    await setClipboard(previousClipboard).catch(() => {});
  }
}

async function handle(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${host}:${port}`);
    if (req.method === "GET" && url.pathname === "/health") {
      const [running, locked] = await Promise.all([appIsRunning(), screenIsLocked()]);
      const interactivity = running && !locked
        ? await checkWeComInteractivity()
        : { interactive: false, errorCode: locked ? "client_locked" : "client_locked", error: running ? "screen_locked" : "wecom_not_running" };
      const interactive = running && !locked && interactivity.interactive;
      return json(res, 200, {
        ok: interactive,
        canReceive: interactive,
        canSend: interactive,
        supportsAck: true,
        supportsConfirm: true,
        loginStatus: locked
          ? "macOS已锁屏，企微前台自动化暂停"
          : interactive
            ? "企微客户端已运行"
            : running
              ? "企微窗口不可交互，建议重启企微"
              : "企微客户端未运行",
        clientLocked: locked,
        clientStale: running && !locked && !interactivity.interactive,
        clientInteractive: interactive,
        errorCode: interactivity.errorCode || "",
        error: interactivity.error || "",
        noScreenshot: true,
        appProcessName,
        ackStateFile,
        ackedMessageCount: ackedMessageIds.size,
        ackedRoomCount: lastAckedCursorByRoomId.size
      });
    }
    if (req.method === "POST" && url.pathname === "/recover") {
      const body = await readBody(req);
      const force = body.force === true || body.force === "true";
      const [running, locked] = await Promise.all([appIsRunning(), screenIsLocked()]);
      if (locked) {
        return json(res, 409, {
          status: "client_locked",
          errorCode: "client_locked",
          error: "macOS console is locked; recovery is paused.",
          noScreenshot: true
        });
      }
      const interactivity = running ? await checkWeComInteractivity() : { interactive: false };
      if (running && interactivity.interactive && !force) {
        return json(res, 200, {
          status: "noop",
          ok: true,
          recovered: false,
          loginStatus: "企微窗口可交互，无需恢复",
          noScreenshot: true
        });
      }
      await runAppleScript(`
tell application ${scriptString(appProcessName)}
  try
    quit
  end try
end tell
delay 1.2
tell application ${scriptString(appProcessName)} to activate
`, 10000);
      await new Promise((resolve) => setTimeout(resolve, 1800));
      const afterRunning = await appIsRunning();
      const afterInteractivity = afterRunning ? await checkWeComInteractivity() : { interactive: false, errorCode: "client_locked", error: "wecom_not_running" };
      return json(res, afterRunning && afterInteractivity.interactive ? 200 : 409, {
        status: afterRunning && afterInteractivity.interactive ? "recovered" : "recover_failed",
        ok: afterRunning && afterInteractivity.interactive,
        recovered: afterRunning && afterInteractivity.interactive,
        canSend: afterRunning && afterInteractivity.interactive,
        canReceive: afterRunning && afterInteractivity.interactive,
        clientInteractive: afterRunning && afterInteractivity.interactive,
        errorCode: afterInteractivity.errorCode || "",
        error: afterInteractivity.error || "",
        noScreenshot: true
      });
    }
    if (req.method === "POST" && url.pathname === "/messages") {
      const body = await readBody(req);
      return json(res, 200, await withAutomationLock(() => pullMessages(body)));
    }
    if (req.method === "POST" && url.pathname === "/unread-status") {
      return json(res, 200, await checkUnreadStatus());
    }
    if (req.method === "POST" && url.pathname === "/idle") {
      const body = await readBody(req);
      try {
        const result = await withAutomationLock(() => resetToIdleConversation(body));
        const failed = [
          "target_not_verified",
          "send_failed",
          "client_locked",
          "client_stale",
          "room_not_found",
          "search_failed",
          "search_popup_not_visible"
        ].includes(result.status);
        return json(res, failed ? 409 : 200, result);
      } catch (error) {
        return json(res, 409, structuredAutomationError(error));
      }
    }
    if (req.method === "POST" && url.pathname === "/send") {
      const body = await readBody(req);
      try {
        const result = await withAutomationLock(() => sendMessage(body));
        const failed = [
          "target_not_verified",
          "send_blocked",
          "send_failed",
          "client_locked",
          "client_stale",
          "room_not_found",
          "input_box_failed",
          "search_failed",
          "search_popup_not_visible",
          "chat_area_not_found"
        ].includes(result.status);
        return json(res, failed ? 409 : 200, result);
      } catch (error) {
        return json(res, 409, structuredAutomationError(error));
      }
    }
	    if (req.method === "POST" && url.pathname === "/ack") {
	      const body = await readBody(req);
	      const ackMessages = Array.isArray(body.messages) && body.messages.length
	        ? body.messages
	        : body.messageIds || [];
	      rememberAckedMessages(ackMessages, body.cursor);
	      if (body.cursor) {
	        lastAckedCursor = String(body.cursor || "").trim();
	        const roomId = String(body.roomId || body.chatId || "").trim();
	        if (roomId) lastAckedCursorByRoomId.set(roomId, lastAckedCursor);
          persistAckState();
	      }
	      return json(res, 200, {
	        ok: true,
	        ackedAt: isoNow(),
	        ackedMessageCount: ackedMessageIds.size,
	        ackedRoomCount: lastAckedCursorByRoomId.size
	      });
	    }
    return json(res, 404, { error: "API not found" });
  } catch (error) {
    return json(res, 500, { error: error.message, noScreenshot: true });
  }
}

loadAckState();

createServer(handle).listen(port, host, () => {
  console.log(`WeCom local automation running at http://${host}:${port}`);
  console.log("Screenshots are disabled; evidence is structural logs only.");
  console.log(`ACK state file: ${ackStateFile}`);
});
