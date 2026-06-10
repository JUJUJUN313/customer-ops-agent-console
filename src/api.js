async function request(path, options = {}) {
  const response = await fetch(path, {
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
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

export const api = {
  getState() {
    return request("/api/state");
  },
  diagnostics() {
    return request("/api/diagnostics");
  },
  capabilities() {
    return request("/api/capabilities");
  },
  chatSessions() {
    return request("/api/chat/sessions");
  },
  chatSession(sessionId) {
    return request(`/api/chat/sessions/${encodeURIComponent(sessionId)}`);
  },
  reset() {
    return request("/api/reset", { method: "POST" });
  },
  runAgent(kind, payload) {
    return request(`/api/agents/${kind}/run`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  runDemo() {
    return request("/api/demo/run", { method: "POST" });
  },
  runWorkflow() {
    return request("/api/workflow/run", { method: "POST" });
  },
  taskSla() {
    return request("/api/tasks/sla");
  },
  modelConfig() {
    return request("/api/model-config");
  },
  wecomConfig() {
    return request("/api/wecom/config");
  },
  personalWechatConfig() {
    return request("/api/personal-wechat/config");
  },
  wecomClientRealtimeConfig() {
    return request("/api/wecom-client/realtime/config");
  },
  outboundDrafts() {
    return request("/api/outbound-drafts");
  },
  updateModelConfig(payload) {
    return request("/api/model-config", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  testModelConfig(payload) {
    return request("/api/model-config/test", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  updateWecomConfig(payload) {
    return request("/api/wecom/config", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  testWecomSend(payload) {
    return request("/api/wecom/test-send", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  checkWecomAibot() {
    return request("/api/wecom/aibot/check");
  },
  checkWecomArchiveSidecar() {
    return request("/api/wecom/archive/check-sidecar", { method: "POST" });
  },
  checkPersonalWechatGateway() {
    return request("/api/personal-wechat/gateway/check", { method: "POST" });
  },
  checkWecomClientRealtimeWorker() {
    return request("/api/wecom-client/realtime/worker/check", { method: "POST" });
  },
  updateWecomGroupBinding(payload) {
    return request("/api/wecom/group-bindings", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  updateWecomArchiveStatus(payload) {
    return request("/api/wecom/archive/status", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  replyChatSession(sessionId, payload) {
    return request(`/api/chat/sessions/${encodeURIComponent(sessionId)}/reply`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  bindChatSessionCustomer(sessionId, payload) {
    return request(`/api/chat/sessions/${encodeURIComponent(sessionId)}/bind-customer`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  ingestWecomMessage(payload) {
    return request("/api/wecom/inbound", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  ingestWecomArchiveMessage(payload) {
    return request("/api/wecom/archive/inbound", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  updatePersonalWechatConfig(payload) {
    return request("/api/personal-wechat/config", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  updateWecomClientRealtimeConfig(payload) {
    return request("/api/wecom-client/realtime/config", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  updateWecomClientRealtimeStatus(payload) {
    return request("/api/wecom-client/realtime/status", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  updatePersonalWechatGatewayStatus(payload) {
    return request("/api/personal-wechat/gateway/status", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  ingestPersonalWechatMessage(payload) {
    return request("/api/personal-wechat/inbound", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  ingestWecomClientRealtimeMessage(payload) {
    return request("/api/wecom-client/realtime/inbound", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  ingestWecomClientRealtimeMessages(payload) {
    return request("/api/wecom-client/realtime/inbound-batch", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  confirmPersonalWechatSendJob(jobId, payload = {}) {
    return request(`/api/personal-wechat/send-jobs/${jobId}/confirm`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  approvePersonalWechatSendJob(jobId, payload = {}) {
    return request(`/api/personal-wechat/send-jobs/${jobId}/approve`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  markPersonalWechatSendJobDispatched(jobId, payload = {}) {
    return request(`/api/personal-wechat/send-jobs/${jobId}/dispatched`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  runPersonalWechatScheduler(payload = {}) {
    return request("/api/personal-wechat/send-scheduler/run", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  runWecomClientRealtimeScheduler(payload = {}) {
    return request("/api/wecom-client/realtime/send-scheduler/run", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  reconcileWecomClientArchive(payload = {}) {
    return request("/api/wecom-client/realtime/reconcile", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  failPersonalWechatSendJob(jobId, payload = {}) {
    return request(`/api/personal-wechat/send-jobs/${jobId}/fail`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  createOutboundDraft(payload) {
    return request("/api/outbound-drafts", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  updateOutboundDraft(draftId, payload) {
    return request(`/api/outbound-drafts/${draftId}/status`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  sendDraftToWecom(draftId, payload) {
    return request(`/api/outbound-drafts/${draftId}/send-wecom`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  batchUpdateOutboundDrafts(draftIds, status, note = "") {
    return request("/api/outbound-drafts/batch-status", {
      method: "POST",
      body: JSON.stringify({ draftIds, status, note })
    });
  },
  escalateTasks() {
    return request("/api/tasks/escalate", { method: "POST" });
  },
  updateTask(taskId, status) {
    return request(`/api/tasks/${taskId}/status`, {
      method: "POST",
      body: JSON.stringify({ status })
    });
  },
  batchUpdateTasks(taskIds, status) {
    return request("/api/tasks/batch-status", {
      method: "POST",
      body: JSON.stringify({ taskIds, status })
    });
  },
  subscribeQuote(customerId, model) {
    return request("/api/quotes/subscribe", {
      method: "POST",
      body: JSON.stringify({ customerId, model })
    });
  },
  ingestMessage(customerId, channel, message, extra = {}) {
    return request("/api/channels/message", {
      method: "POST",
      body: JSON.stringify({ customerId, channel, message, ...extra })
    });
  },
  createCustomer(payload) {
    return request("/api/customers", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  updateCustomer(customerId, payload) {
    return request(`/api/customers/${customerId}`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  recordOutcome(customerId, payload) {
    return request(`/api/customers/${customerId}/outcome`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  createTask(payload) {
    return request("/api/tasks", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  upsertQuote(payload) {
    return request("/api/quotes", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  createSalesSample(payload) {
    return request("/api/sales-samples", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  updateTemplate(templateId, payload) {
    return request(`/api/templates/${templateId}`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }
};
