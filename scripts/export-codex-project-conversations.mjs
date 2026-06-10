#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const DEFAULT_SESSIONS_DIR = path.join(process.env.HOME || "", ".codex", "sessions");
const DEFAULT_PROJECT_KEYWORD = "智能客服";
const DEFAULT_OUTPUT_DIR = path.resolve("exports");
const TIME_ZONE = "Asia/Shanghai";

function parseArgs(argv) {
  const args = {
    sessionsDir: DEFAULT_SESSIONS_DIR,
    projectKeyword: DEFAULT_PROJECT_KEYWORD,
    outputDir: DEFAULT_OUTPUT_DIR,
    date: new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date())
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--sessions-dir") args.sessionsDir = argv[++index];
    else if (value === "--project-keyword") args.projectKeyword = argv[++index];
    else if (value === "--output-dir") args.outputDir = argv[++index];
    else if (value === "--date") args.date = argv[++index];
  }
  return args;
}

function listJsonlFiles(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(fullPath);
    }
  }
  return files.sort();
}

function toLocalTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return String(timestamp);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function textFromContent(content = []) {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => item?.text || item?.input_text || item?.output_text || "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function isInternalMessage(role, text) {
  if (!text) return true;
  if (!["user", "assistant"].includes(role)) return true;
  const trimmed = text.trim();
  return [
    "<environment_context>",
    "<permissions instructions>",
    "<collaboration_mode>",
    "<skills_instructions>",
    "<plugins_instructions>",
    "<turn_aborted>",
    "<app-context>"
  ].some((prefix) => trimmed.startsWith(prefix));
}

function compactTitle(text = "") {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "未命名对话";
  return normalized.length > 90 ? `${normalized.slice(0, 90)}...` : normalized;
}

function escapeMarkdown(text = "") {
  return text.replace(/\r\n/g, "\n").trim();
}

function extractPatchFiles(argumentsText = "") {
  if (!argumentsText) return [];
  const files = [];
  const lines = String(argumentsText).split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/);
    if (match) files.push({ type: match[1].toLowerCase(), file: match[2].trim() });
  }
  return files;
}

function recordPatchFile(summary, change) {
  if (!change?.file) return;
  const current = summary.fileChanges.get(change.file) || { count: 0, types: {} };
  current.count += 1;
  current.types[change.type] = (current.types[change.type] || 0) + 1;
  summary.fileChanges.set(change.file, current);
}

async function parseSessionFile(filePath, projectKeyword) {
  const summary = {
    source: filePath,
    id: "",
    forkedFromId: "",
    startedAt: "",
    cwd: "",
    originator: "",
    cliVersion: "",
    title: "",
    messages: [],
    toolCalls: 0,
    toolOutputs: 0,
    patchApplications: 0,
    fileChanges: new Map(),
    rawLines: 0
  };
  let primaryMetaCaptured = false;

  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    summary.rawLines += 1;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = record.payload || {};

    if (record.type === "session_meta" && !primaryMetaCaptured) {
      primaryMetaCaptured = true;
      summary.id = payload.id || "";
      summary.forkedFromId = payload.forked_from_id || "";
      summary.startedAt = payload.timestamp || record.timestamp || "";
      summary.cwd = payload.cwd || "";
      summary.originator = payload.originator || "";
      summary.cliVersion = payload.cli_version || "";
      continue;
    }

    if (record.type === "response_item" && payload.type === "message") {
      const role = payload.role || "";
      const text = textFromContent(payload.content);
      if (isInternalMessage(role, text)) continue;
      const message = {
        timestamp: record.timestamp || "",
        role,
        text: escapeMarkdown(text),
        phase: payload.phase || ""
      };
      if (!summary.title && role === "user") summary.title = compactTitle(text);
      summary.messages.push(message);
      continue;
    }

    if (record.type === "response_item") {
      if (payload.type?.includes("call") && !payload.type?.includes("output")) {
        summary.toolCalls += 1;
      }
      if (payload.type?.includes("output")) {
        summary.toolOutputs += 1;
      }
      if (payload.name === "apply_patch") {
        summary.patchApplications += 1;
        for (const change of extractPatchFiles(payload.arguments || "")) recordPatchFile(summary, change);
      }
    }
  }

  const searchable = `${summary.cwd}\n${summary.title}\n${summary.messages.map((message) => message.text).join("\n")}`;
  if (!searchable.includes(projectKeyword)) return null;
  if (!summary.title) summary.title = compactTitle(summary.messages.find((message) => message.role === "user")?.text || "");
  return summary;
}

function dedupeMessages(sessions) {
  const seen = new Set();
  for (const session of sessions) {
    const unique = [];
    for (const message of session.messages) {
      const key = `${message.timestamp}\n${message.role}\n${message.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(message);
    }
    session.duplicateMessagesRemoved = session.messages.length - unique.length;
    session.messages = unique;
  }
}

function fileChangesForJson(fileChanges) {
  return Object.fromEntries([...fileChanges.entries()].sort((a, b) => b[1].count - a[1].count));
}

function renderMarkdown({ exportedAt, cwd, sessions, projectKeyword }) {
  const lines = [];
  lines.push("# Codex 项目对话导出");
  lines.push("");
  lines.push(`导出时间：${toLocalTime(exportedAt)}（${TIME_ZONE}）`);
  lines.push(`当前工作目录：\`${cwd}\``);
  lines.push(`筛选关键词：\`${projectKeyword}\``);
  lines.push("");
  lines.push("说明：本导出保留用户消息、助手回复、线程元信息和轻量统计；已过滤系统提示词、开发者指令、工具 schema、命令输出和推理密文。原始 JSONL 路径列在每条线程下，后续需要完全审计时可追溯。fork 线程继承的重复消息已跨线程去重。");
  lines.push("");
  lines.push("## 线程总览");
  lines.push("");
  for (const session of sessions) {
    lines.push(`- ${toLocalTime(session.startedAt)} · \`${session.id || "unknown"}\` · ${session.title}`);
    lines.push(`  - 消息：${session.messages.length} 条；去重移除：${session.duplicateMessagesRemoved || 0} 条；工具调用：${session.toolCalls}；工具输出：${session.toolOutputs}；补丁应用：${session.patchApplications}；变更文件数：${session.fileChanges.size}`);
    lines.push(`  - 工作目录：\`${session.cwd || "unknown"}\``);
    if (session.forkedFromId) lines.push(`  - Fork 来源：\`${session.forkedFromId}\``);
    lines.push(`  - 原始记录：\`${session.source}\``);
  }
  lines.push("");
  lines.push("---");

  for (const session of sessions) {
    lines.push("");
    lines.push(`## ${session.title}`);
    lines.push("");
    lines.push(`- 线程 ID：\`${session.id || "unknown"}\``);
    lines.push(`- 开始时间：${toLocalTime(session.startedAt)}`);
    lines.push(`- 工作目录：\`${session.cwd || "unknown"}\``);
    if (session.forkedFromId) lines.push(`- Fork 来源：\`${session.forkedFromId}\``);
    lines.push(`- 原始 JSONL：\`${session.source}\``);
    lines.push(`- 统计：${session.messages.length} 条导出消息，${session.toolCalls} 次工具调用，${session.toolOutputs} 条工具输出，${session.patchApplications} 次补丁应用，${session.fileChanges.size} 个变更文件`);
    if (session.fileChanges.size) {
      lines.push("- 变更文件摘要：");
      for (const [file, info] of [...session.fileChanges.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 40)) {
        const types = Object.entries(info.types).map(([type, count]) => `${type}:${count}`).join(", ");
        lines.push(`  - \`${file}\` × ${info.count}（${types}）`);
      }
    }
    lines.push("");
    lines.push("### 对话正文");
    for (const message of session.messages) {
      const speaker = message.role === "user" ? "用户" : "Codex";
      lines.push("");
      lines.push(`#### ${speaker} · ${toLocalTime(message.timestamp)}`);
      lines.push("");
      lines.push(message.text);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const exportedAt = new Date().toISOString();
  const files = listJsonlFiles(args.sessionsDir);
  const sessions = [];
  for (const file of files) {
    const session = await parseSessionFile(file, args.projectKeyword);
    if (session) sessions.push(session);
  }
  sessions.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
  dedupeMessages(sessions);

  fs.mkdirSync(args.outputDir, { recursive: true });
  const markdownPath = path.join(args.outputDir, `codex-project-conversation-${args.date}.md`);
  const indexPath = path.join(args.outputDir, `codex-project-conversation-index-${args.date}.json`);
  const index = {
    exportedAt,
    cwd: process.cwd(),
    projectKeyword: args.projectKeyword,
    output: path.resolve(markdownPath),
    sessions: sessions.map((session) => ({
      id: session.id,
      forkedFromId: session.forkedFromId,
      startedAt: session.startedAt,
      cwd: session.cwd,
      title: session.title,
      source: session.source,
      messages: session.messages.length,
      duplicateMessagesRemoved: session.duplicateMessagesRemoved || 0,
      toolCalls: session.toolCalls,
      toolOutputs: session.toolOutputs,
      patchApplications: session.patchApplications,
      fileChanges: fileChangesForJson(session.fileChanges)
    }))
  };

  fs.writeFileSync(markdownPath, renderMarkdown({
    exportedAt,
    cwd: process.cwd(),
    sessions,
    projectKeyword: args.projectKeyword
  }));
  fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: true,
    sessions: sessions.length,
    markdownPath: path.resolve(markdownPath),
    indexPath: path.resolve(indexPath)
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
