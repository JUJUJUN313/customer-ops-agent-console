#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const chromePath = process.env.WECOM_ADMIN_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const cdpPort = Number(process.env.WECOM_ADMIN_CDP_PORT || 9222);
const profileDir = resolve(process.env.WECOM_ADMIN_CHROME_PROFILE || `${homedir()}/.customer-ops/wecom-admin-chrome-profile`);
const groupSendUrl = process.env.WECOM_ADMIN_GROUP_SEND_URL || "https://work.weixin.qq.com/wework_admin/frame#/customer/config/groupSend";

async function cdpReady() {
  try {
    const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

if (await cdpReady()) {
  console.log(`WeCom admin Chrome CDP is already available at http://127.0.0.1:${cdpPort}`);
  console.log(`Profile: ${profileDir}`);
  process.exit(0);
}

mkdirSync(profileDir, { recursive: true });

const args = [
  `--remote-debugging-port=${cdpPort}`,
  `--user-data-dir=${profileDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--new-window",
  groupSendUrl
];

const child = spawn(chromePath, args, {
  detached: true,
  stdio: "ignore"
});
child.unref();

console.log(`Started dedicated WeCom admin Chrome with CDP at http://127.0.0.1:${cdpPort}`);
console.log(`Profile: ${profileDir}`);
console.log(`Page: ${groupSendUrl}`);
console.log("First run: log in to WeCom admin in this dedicated Chrome profile, then run npm run wecom:admin-local.");
