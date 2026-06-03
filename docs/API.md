# API 文档

所有接口由 `scripts/serve.mjs` 提供，默认地址为 `http://127.0.0.1:5175`。

## 读取接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 服务健康检查 |
| GET | `/api/state` | 读取前端可用系统状态；模型API Key、企微Webhook、Bot ID 和 Secret 会脱敏为空值，只返回是否已配置和掩码 |
| GET | `/api/diagnostics` | 运行系统自检并返回报告 |
| GET | `/api/capabilities` | 返回当前系统能力审计，标记本地可用、可运行、待建设和未接入能力 |
| GET | `/api/tasks/sla` | 返回任务SLA报表，包含超时、临期、升级和完成统计 |
| GET | `/api/model-config` | 返回全局LLM、ASR/TTS语音模型、Agent覆盖配置和每个Agent的最终生效模型；API Key只返回掩码和是否已配置 |
| GET | `/api/wecom/config` | 返回企微连接配置、智能机器人状态、群绑定、路由、入站设置和最近发送/入站日志；Webhook、Bot ID、Secret和入站Secret只返回掩码和是否已配置 |
| GET | `/api/wecom/aibot/check` | 检查企微智能机器人 Bot ID/Secret 是否完整，返回 bridge 启动条件和当前连接状态 |
| GET | `/api/outbound-drafts` | 返回触达草稿队列、客户信息和待确认/已复制/已处理等统计 |

## 写入接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/reset` | 重置本地样例数据 |
| POST | `/api/demo/run` | 按当前客户阶段批量运行本地规则Agent，并生成闭环编排 |
| POST | `/api/workflow/run` | 运行闭环编排Agent，为全部客户生成下一步动作和任务 |
| POST | `/api/agents/:kind/run` | 运行指定 Agent，`kind` 支持 `dialer`、`nurture`、`sales`、`vip`、`quote`、`orchestrator` |
| POST | `/api/channels/message` | 写入本地渠道消息并运行路由 |
| POST | `/api/outbound-drafts` | 人工新增本地触达草稿，不触发外部发送 |
| POST | `/api/outbound-drafts/:draftId/status` | 更新触达草稿状态，可用于确认、复制、人工已处理或废弃；不能直接标记企微已发送 |
| POST | `/api/outbound-drafts/:draftId/send-wecom` | 将已确认草稿发送到企微测试群机器人；成功后写入 `wecomDelivery` 并标记 `企微已发送` |
| POST | `/api/outbound-drafts/batch-status` | 批量更新触达草稿状态，逐条写入事件并汇总审计 |
| POST | `/api/customers` | 新增客户 |
| POST | `/api/customers/:customerId` | 更新客户档案 |
| POST | `/api/customers/:customerId/outcome` | 记录销售结果 |
| POST | `/api/tasks` | 新增人工任务 |
| POST | `/api/tasks/:taskId/status` | 更新任务状态 |
| POST | `/api/tasks/batch-status` | 批量更新任务状态，支持批量跟进中或已完成 |
| POST | `/api/tasks/escalate` | 运行SLA巡检，将超时未完成任务升级到主管队列 |
| POST | `/api/model-config` | 保存全局LLM、ASR/TTS语音模型和各Agent独立模型连接配置 |
| POST | `/api/model-config/test` | 按全局或指定Agent生效模型配置真实测试OpenAI兼容LLM连接 |
| POST | `/api/wecom/config` | 保存企微测试群机器人Webhook、企微智能机器人Bot ID/Secret、发送模式和本地入站设置 |
| POST | `/api/wecom/aibot/status` | bridge 进程回写长连接启动、认证、断开、错误和最后连接时间 |
| POST | `/api/wecom/group-bindings` | 把企微 `chatid` 绑定到客户档案和业务渠道 |
| POST | `/api/wecom/test-send` | 真实调用企微群机器人Webhook发送测试消息，结果写入 `wecomLogs` |
| POST | `/api/wecom/inbound` | 写入企微模拟或长连接入站消息，按 `chatid` 独立归档并路由到本地Agent |
| POST | `/api/quotes` | 新增或更新报价 |
| POST | `/api/quotes/subscribe` | 订阅报价型号 |
| POST | `/api/sales-samples` | 新增销售话术样本，供销售承接Agent引用 |
| POST | `/api/templates/:templateId` | 更新模板状态或内容 |

## 关键请求示例

运行 Agent：

```json
{
  "customerId": "c001",
  "message": "最近 iPhone 13 还有稳定报价吗？会员卡如果有优惠我想了解。",
  "useLlm": false
}
```

Agent运行结果会附带 `modelConfig` 和 `execution`：

- `modelConfig`：记录本次生效的LLM连接配置。
- `execution.engine`：默认为 `本地规则引擎`；勾选真实LLM增强后为 `本地规则引擎 + 真实LLM增强`。
- `execution.modelInvocation`：默认 `未调用`；`useLlm: true` 且调用成功时为 `已调用`，失败时记录 `调用失败` 或 `配置缺失`。
- `execution.externalSideEffects`：始终为 `false`，表示没有真实外呼、短信、企微或CRM写入。

当前真实LLM增强只用于生成本地建议和草稿，会把客户摘要、当前消息和本地Agent结果发送到你配置的模型供应商。API Key会保存在本地 `data/state.json`，`GET /api/state` 和 `GET /api/model-config` 都不会返回明文Key，只返回掩码和是否已配置。

Agent运行后，如果本次运行面向明确客户且生成了可触达文案，系统会写入本地 `OutboundDraft`。该草稿只进入本地确认队列；只有人工确认后调用企微发送接口，才会真实发送到已配置的企微测试群机器人。短信、外呼、企微私聊和CRM动作仍不会自动执行。

测试模型连接：

```json
{
  "agentKey": "global",
  "prompt": "请用中文简短回复：模型连接成功。"
}
```

`agentKey` 可填 `global`、`sales`、`vip`、`quote` 等。服务端会按全局或Agent生效配置调用OpenAI兼容 `chat/completions`。如果缺少API Key，会返回 `配置缺失`，不会发起外部请求。

新增人工触达草稿：

```json
{
  "customerId": "c001",
  "channel": "短信",
  "draftType": "报价提醒",
  "content": "陈总，iPhone 13报价已更新，人工确认后可发送。",
  "priority": "高",
  "note": "仅生成草稿，不自动发送"
}
```

更新触达草稿状态：

```json
{
  "status": "已确认",
  "note": "人工已确认，等待在真实渠道处理"
}
```

批量更新触达草稿状态：

```json
{
  "draftIds": ["draft_001", "draft_002"],
  "status": "已废弃",
  "note": "人工批量关闭，未触达客户"
}
```

触达草稿合法渠道：`电话外呼`、`短信`、`企微私聊`、`VIP群`、`报价页`、`人工触达`。

触达草稿合法状态：`待确认`、`已确认`、`已复制`、`企微已发送`、`人工已处理`、`已废弃`。普通状态更新不能把草稿改成 `企微已发送`；必须通过 `/api/outbound-drafts/:draftId/send-wecom` 成功发送后由系统写入。未发送草稿保持 `externalSideEffects: false`，企微发送成功草稿会写入 `externalSideEffects: true` 和 `wecomDelivery`。

企微配置：

```json
{
  "enabled": true,
  "sendMode": "manualApproval",
  "defaultRouteId": "wecom_route_default",
  "routes": [
    {
      "id": "wecom_route_default",
      "name": "企微测试群机器人",
      "channel": "VIP群",
      "webhookUrl": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=your-key",
      "msgtype": "markdown",
      "enabled": true
    }
  ],
  "inbound": {
    "enabled": true,
    "defaultChannel": "VIP群",
    "secret": "optional-local-secret"
  },
  "aibot": {
    "enabled": true,
    "botId": "your-bot-id",
    "secret": "your-bot-secret",
    "wsUrl": "",
    "defaultCustomerId": "c003",
    "defaultChannel": "VIP群",
    "autoReply": false,
    "heartbeatInterval": 30000,
    "maxReconnectAttempts": 10
  }
}
```

保存配置时，空的 `webhookUrl`、`aibot.botId` 或 `aibot.secret` 表示保留旧凭据；如需清空，需要分别传 `clearWebhook: true`、`aibot.clearBotId: true` 或 `aibot.clearSecret: true`。`GET /api/state` 和 `GET /api/wecom/config` 不会返回完整Webhook、Bot ID 或 Secret，只返回配置状态和掩码。

启动企微智能机器人长连接 bridge：

```bash
npm run wecom:bridge
```

只做认证检查：

```bash
npm run wecom:bridge -- --check --timeout=20000
```

企微测试发送：

```json
{
  "routeId": "wecom_route_default",
  "content": "企微连接测试：客户运营中台已连接测试群机器人。"
}
```

发送已确认草稿到企微：

```json
{
  "routeId": "wecom_route_default"
}
```

企微模拟入站：

```json
{
  "customerId": "c003",
  "channel": "VIP群",
  "senderRole": "客户",
  "senderName": "周总",
  "message": "@售后 今天报价和维修进度同步一下",
  "chatId": "chat_xxx",
  "externalMessageId": "msg_xxx",
  "requestId": "req_xxx",
  "senderId": "userid_xxx",
  "source": "wecom-aibot"
}
```

`/api/wecom/inbound` 会把 `VIP群` 映射为 `VIP模拟群`，把销售/电销企微映射为对应本地私聊渠道，然后复用本地消息路由和Agent。长连接 bridge 会传入企微消息的 `chatId`、`externalMessageId`、`requestId` 和 `senderId`；系统按 `externalMessageId` 去重，按 `chatId` 查找 `wecomBindings.groups`。未知群会自动创建“企微群待绑定”客户档案和待绑定群记录，避免不同客户群消息混档。

绑定企微群到真实客户：

```json
{
  "chatId": "chat_xxx",
  "customerId": "c003",
  "channel": "VIP群"
}
```

批量更新任务状态：

```json
{
  "taskIds": ["t_001", "t_002"],
  "status": "已完成"
}
```

任务合法状态：`待处理`、`跟进中`、`已完成`。批量完成会为每个任务写入 `completedAt`，并为对应客户写入任务事件。

模型配置：

```json
{
  "global": {
    "provider": "DeepSeek兼容网关",
    "apiUrl": "https://api.deepseek.com",
    "apiKey": "sk-your-key",
    "model": "deepseek-v4-flash",
    "temperature": 0.3,
    "maxTokens": 4096
  },
  "voice": {
    "asr": {
      "provider": "语音识别网关",
      "apiUrl": "https://voice.example.com/asr",
      "apiKey": "asr-key",
      "model": "asr-large",
      "language": "zh-CN"
    },
    "tts": {
      "provider": "语音合成网关",
      "apiUrl": "https://voice.example.com/tts",
      "apiKey": "tts-key",
      "model": "tts-pro",
      "voice": "female-a",
      "speed": 1.1
    }
  },
  "agents": {
    "sales": {
      "provider": "销售专用网关",
      "apiUrl": "https://sales.example.com/v1",
      "apiKey": "sk-sales-key",
      "model": "sales-agent-model",
      "temperature": 0.65,
      "maxTokens": 8192
    },
    "vip": {
      "provider": "",
      "apiUrl": "",
      "apiKey": "",
      "model": "",
      "temperature": "",
      "maxTokens": ""
    }
  }
}
```

Agent独立配置完全留空时继承全局LLM；只填写部分字段时，未填写字段回退全局。模型配置页的测试按钮和Agent运行参数 `useLlm: true` 会真实调用LLM；默认Agent运行不调用外部模型。

保存模型配置时，空的 `apiKey` 表示保留原密钥；如需清空密钥，需要传入 `clearApiKey: true`。Agent独立配置可传 `clear: true` 恢复全局继承。

```json
{
  "global": {
    "clearApiKey": true
  },
  "agents": {
    "sales": {
      "clear": true
    }
  }
}
```

运行闭环编排返回的客户计划示例：

```json
{
  "customerId": "c002",
  "customerName": "杭州锐采科技",
  "stage": "销售企微承接",
  "nextAgent": "销售承接Agent",
  "channel": "本地销售私聊",
  "ownerRole": "销售",
  "priority": "高",
  "objective": "推进平台黑金卡成交",
  "taskTitle": "平台黑金卡销售闭环跟进",
  "successMetric": "记录成交/暂缓/继续培育结果并回写客户阶段"
}
```

渠道消息入站：

```json
{
  "customerId": "c003",
  "channel": "VIP模拟群",
  "senderRole": "客户",
  "senderName": "周总",
  "message": "@销售 有两台售后维修怎么处理？"
}
```

渠道入站会先写入本地 `Conversation`，再路由到对应 Agent。VIP群分流Agent会读取最近会话消息、@对象和未完成任务。

新增报价：

```json
{
  "brand": "Apple",
  "model": "iPhone 16",
  "config": "256G",
  "price": 6999,
  "stock": "少量",
  "validUntil": "2026-06-10"
}
```

新增销售样本：

```json
{
  "scene": "价格敏感黑金卡成交",
  "customerStage": "销售企微承接",
  "targetCard": "平台黑金卡",
  "objection": "价格敏感",
  "outcome": "成交",
  "qualityScore": 92,
  "tags": "价格敏感, 高交易额, 稳定货源",
  "phrase": "先不承诺最低价，先帮客户算稳定供货、优先报价和售后协同节省的采购成本。",
  "notes": "适合高交易额、关注稳定货源但压价明显的客户。"
}
```

任务SLA报表示例：

```json
{
  "summary": {
    "total": 2,
    "open": 2,
    "overdue": 0,
    "dueSoon": 0,
    "escalated": 0,
    "completed": 0
  },
  "tasks": [
    {
      "id": "t001",
      "slaState": "正常",
      "dueAt": "2026-06-02T12:00:00.000Z",
      "minutesRemaining": 120
    }
  ]
}
```

系统自检返回：

```json
{
  "ok": true,
  "generatedAt": "2026-06-02T00:00:00.000Z",
  "summary": {
    "customers": 18,
    "tasks": 2,
    "events": 3,
    "conversations": 1,
    "quotes": 8,
    "outboundDrafts": 0,
    "templates": 5,
    "salesSamples": 3,
    "agentRuns": 0,
    "failed": 0,
    "warnings": 0
  },
  "checks": []
}
```

## 错误行为

服务端会把明显的输入错误返回为 `400`，例如：

- 客户不存在：`Customer not found: missing`
- 任务不存在：`Task not found: missing`
- 报价型号为空：`Quote model is required`
- 报价价格无效：`Quote price must be a non-negative number`
- 渠道消息为空：`Channel message is required`
- 客户风险值无效：`Invalid customer risk: 极高`
- 任务负责人角色无效：`Invalid owner role: 外包`
- 渠道发送角色无效：`Invalid sender role: 访客`
- SLA参考时间无效：`Invalid reference time: 坏时间`
- 全局模型为空：`Global model is required`
- API URL格式无效：`Invalid API URL: ftp://bad-url`
- 触达草稿内容为空：`Draft content is required`
- 触达草稿渠道无效：`Invalid draft channel: 微信群发`
- 触达草稿状态无效：`Invalid draft status: 已发送`
- 直接伪造企微发送状态：`Use WeCom send action to mark WeCom sent`
- 未确认草稿发送企微：`Only confirmed drafts can be sent to WeCom`
- 企微Webhook为空：`WeCom webhook is empty: 企微测试群机器人`
- 企微Webhook格式无效：`WeCom webhook key is required`
- 销售样本话术为空：`Sales sample phrase is required`
- 销售样本结果无效：`Invalid sales sample outcome: 未知`
- 模板风险值无效：`Invalid template risk: 极高`

其他未预期错误返回 `500`。静态文件服务会拒绝直接访问 `data/` 目录和隐藏文件，例如 `/data/state.json` 返回 `404`。
