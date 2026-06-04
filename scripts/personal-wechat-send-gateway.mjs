#!/usr/bin/env node
const apiBase = process.env.CUSTOMER_OPS_API || "http://127.0.0.1:5175";
const once = process.argv.includes("--once");
const check = process.argv.includes("--check");
const pollIntervalMs = Number(process.env.PERSONAL_WECHAT_GATEWAY_INTERVAL_MS || 3000);

async function api(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }
  if (!response.ok) throw new Error(payload.error || `API ${path} failed: ${response.status}`);
  return payload;
}

async function sidecarPost(gateway, job) {
  const endpoint = `${String(gateway.sidecarUrl || "").replace(/\/+$/, "")}${gateway.sendEndpoint || "/send"}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jobId: job.jobId,
      accountId: job.accountId,
      roomId: job.roomId,
      roomName: job.roomName,
      text: job.replyText,
      triggerMessageIds: job.triggerMessageIds || [],
      source: job.source || "personal-wechat"
    })
  });
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }
  if (!response.ok) throw new Error(payload.error || `Sidecar send failed: ${response.status}`);
  return payload;
}

async function runOnce() {
  const report = await api("/api/personal-wechat/config");
  const config = report.config || {};
  const gateway = config.gateway || {};
  if (gateway.mode !== "sidecar") {
    const message = `Personal WeChat gateway mode is ${gateway.mode || "unknown"}; sidecar sender is idle.`;
    if (check) console.log(message);
    return { checked: true, dispatched: 0, failed: 0, message };
  }
  if (!gateway.sidecarUrl) throw new Error("Personal WeChat sidecarUrl is required");
  if (gateway.canSend !== true) {
    const message = "Personal WeChat sidecar is reachable only after /health declares canSend=true.";
    if (check) console.log(message);
    return { checked: true, dispatched: 0, failed: 0, message, canSend: false };
  }
  const jobs = (config.sendJobs || []).filter((job) => job.status === "sending");
  if (check) {
    console.log(JSON.stringify({
      ok: true,
      apiBase,
      sidecarUrl: gateway.sidecarUrl,
      sendEndpoint: gateway.sendEndpoint || "/send",
      canSend: Boolean(gateway.canSend),
      sendMode: gateway.sendMode || "proactive",
      supportsConfirm: Boolean(gateway.supportsConfirm),
      supportsRecall: Boolean(gateway.supportsRecall),
      sendingJobs: jobs.length
    }, null, 2));
    return { checked: true, dispatched: 0, failed: 0 };
  }
  let dispatched = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      const result = await sidecarPost(gateway, job);
      await api(`/api/personal-wechat/send-jobs/${encodeURIComponent(job.jobId)}/dispatched`, {
        method: "POST",
        body: JSON.stringify({
          gatewayMode: "sidecar",
          gatewayRequestId: result.gatewayRequestId || result.requestId || result.id || "",
          externalMessageId: result.externalMessageId || result.messageId || result.msgid || "",
          now: new Date().toISOString()
        })
      });
      dispatched += 1;
      console.log(`dispatched ${job.jobId}`);
    } catch (error) {
      failed += 1;
      await api(`/api/personal-wechat/send-jobs/${encodeURIComponent(job.jobId)}/fail`, {
        method: "POST",
        body: JSON.stringify({ error: error.message, now: new Date().toISOString() })
      });
      console.error(`failed ${job.jobId}: ${error.message}`);
    }
  }
  return { checked: false, dispatched, failed };
}

async function main() {
  do {
    const result = await runOnce();
    if (once || check) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(1000, pollIntervalMs)));
  } while (true);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
