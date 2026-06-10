#!/usr/bin/env node
import { spawn } from "node:child_process";
import net from "node:net";

const host = process.env.WECOM_START_HOST || "127.0.0.1";
const apiPort = Number(process.env.WECOM_START_API_PORT || 5175);
const localPort = Number(process.env.WECOM_START_LOCAL_PORT || 8791);
const apiBase = process.env.CUSTOMER_OPS_API || `http://${host}:${apiPort}`;
const children = [];

function prefixed(name, stream, chunk) {
  const text = String(chunk || "");
  for (const line of text.split(/\r?\n/)) {
    if (line.trim()) stream.write(`[${name}] ${line}\n`);
  }
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(800, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function start(name, args, env = {}) {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.push(child);
  child.stdout.on("data", (chunk) => prefixed(name, process.stdout, chunk));
  child.stderr.on("data", (chunk) => prefixed(name, process.stderr, chunk));
  child.on("exit", (code, signal) => {
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    process.stdout.write(`[${name}] exited with ${reason}\n`);
  });
  return child;
}

function stopAll() {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
}

process.on("SIGINT", () => {
  stopAll();
  setTimeout(() => process.exit(130), 300).unref();
});
process.on("SIGTERM", () => {
  stopAll();
  setTimeout(() => process.exit(143), 300).unref();
});

const apiRunning = await isPortOpen(apiPort);
if (apiRunning) {
  console.log(`[start] API already listening at ${apiBase}`);
} else {
  start("api", ["scripts/serve.mjs", "--host", host, "--port", String(apiPort)]);
}

const localRunning = await isPortOpen(localPort);
if (localRunning) {
  console.log(`[start] WeCom local automation already listening at http://${host}:${localPort}`);
} else {
  start("wecom-local", ["scripts/wecom-client-local-automation.mjs", `--port=${localPort}`]);
}

start("worker", ["scripts/wecom-client-realtime-worker.mjs"], {
  CUSTOMER_OPS_API: apiBase,
  WECOM_CLIENT_REALTIME_INTERVAL_MS: process.env.WECOM_CLIENT_REALTIME_INTERVAL_MS || "1000"
});

console.log("[start] WeCom realtime stack is starting.");
console.log("[start] Keep this terminal open while testing. Press Ctrl+C to stop started processes.");

setInterval(() => {}, 60_000);
