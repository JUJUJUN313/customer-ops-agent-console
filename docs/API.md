# API 文档

所有接口由 `scripts/serve.mjs` 提供，默认地址为 `http://127.0.0.1:5175`。

## 读取接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 服务健康检查 |
| GET | `/api/state` | 读取前端可用系统状态；模型API Key、企微Webhook、Bot ID 和 Secret 会脱敏为空值，只返回是否已配置和掩码 |
| GET | `/api/diagnostics` | 运行系统自检并返回报告 |
| GET | `/api/capabilities` | 返回当前系统能力审计，标记本地可用、可运行、待建设和未接入能力 |
| GET | `/api/chat/sessions` | 返回会话工作台统一投影，聚合企微会话存档、企微智能机器人、个人微信/Sidecar和本地调试会话；前端按电销、销售、VIP入口过滤，默认只展示真实来源 |
| GET | `/api/chat/sessions/:sessionId` | 返回单个会话详情、消息、客户档案、待发送任务、任务和报价 |
| GET | `/api/tasks/sla` | 返回任务SLA报表，包含超时、临期、升级和完成统计 |
| GET | `/api/model-config` | 返回全局LLM、ASR/TTS语音模型、Agent覆盖配置和每个Agent的最终生效模型；API Key只返回掩码和是否已配置 |
| GET | `/api/wecom/config` | 返回企微连接配置、智能机器人状态、群绑定、路由、入站设置和最近发送/入站日志；Webhook、Bot ID、Secret和入站Secret只返回掩码和是否已配置 |
| GET | `/api/wecom/aibot/check` | 检查企微智能机器人 Bot ID/Secret 是否完整，返回 bridge 启动条件和当前连接状态 |
| GET | `/api/personal-wechat/config` | 返回个人微信Sidecar/AccountAgent 配置、Sidecar能力声明、群上下文、发送队列、决策和运行日志 |
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
| POST | `/api/wecom/archive/check-sidecar` | 检查会话存档Sidecar配置完整度，并尝试访问 `sidecarUrl/health`，结果回写存档状态和企微日志 |
| POST | `/api/wecom/aibot/status` | bridge 进程回写长连接启动、认证、断开、错误和最后连接时间 |
| POST | `/api/wecom/archive/status` | 会话存档Gateway回写启动、拉取、ACK、Sidecar连接、游标、seq、错误和可信状态 |
| POST | `/api/wecom/group-bindings` | 把企微 `chatid` 绑定到客户档案和业务渠道 |
| POST | `/api/chat/sessions/:sessionId/reply` | 在会话工作台回复；外部群低风险进入SendScheduler，高风险进入人工确认，本地会话只保存草稿 |
| POST | `/api/chat/sessions/:sessionId/bind-customer` | 把外部群会话绑定到真实客户档案 |
| POST | `/api/wecom/test-send` | 真实调用企微群机器人Webhook发送测试消息，结果写入 `wecomLogs` |
| POST | `/api/wecom/inbound` | 写入企微模拟或长连接入站消息，按 `chatid` 独立归档并路由到本地Agent |
| POST | `/api/wecom/archive/inbound` | 写入企微会话内容存档标准化入站消息，按 `roomId/chatId` 去重、归档并进入AccountAgent和SendScheduler链路 |
| POST | `/api/personal-wechat/config` | 保存个人微信Sidecar/AccountAgent 配置 |
| POST | `/api/personal-wechat/gateway/check` | 检查个人微信Sidecar模式和配置；Mock模式只记录本地演练，Sidecar模式访问 `sidecarUrl/health` 并读取 `canReceive/canSend/supportsAck/loginStatus` 等能力 |
| POST | `/api/personal-wechat/gateway/status` | Gateway脚本回写游标、最近拉取、ACK、登录态、错误和能力状态 |
| POST | `/api/personal-wechat/inbound` | 写入个人微信外部群入站消息，按 `roomId` 维护群上下文、决策和发送队列 |
| POST | `/api/personal-wechat/send-scheduler/run` | 运行 SendScheduler；Mock模式将 `queued` 调度为 `sent_pending_confirm` 用于本地演练，Sidecar模式必须 `canSend=true` 才会把 `queued` 调度为 `sending` |
| POST | `/api/personal-wechat/send-jobs/:jobId/approve` | 人工放行高风险 `manual_required` 任务，放行后回到 `queued` 等待调度 |
| POST | `/api/personal-wechat/send-jobs/:jobId/dispatched` | 个人微信Sidecar回写“已提交发送”，任务进入 `sent_pending_confirm` 等待回读 |
| POST | `/api/personal-wechat/send-jobs/:jobId/confirm` | 自回显或企微存档回读确认，把 `sent_pending_confirm/sending/sent` 任务标记为 `confirmed` |
| POST | `/api/personal-wechat/send-jobs/:jobId/fail` | 标记个人微信Gateway发送失败，写入失败退避、账号错误和运行日志 |
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
  },
  "archive": {
    "enabled": true,
    "provider": "企微会话内容存档",
    "corpId": "ww-your-corp",
    "archiveSecret": "your-archive-secret",
    "privateKey": "-----BEGIN PRIVATE KEY-----...",
    "privateKeyVersion": "1",
    "gatewayMode": "sidecar",
    "sidecarUrl": "http://127.0.0.1:8787",
    "seq": 0,
    "cursor": "",
    "pollIntervalSeconds": 10,
    "limit": 100,
    "defaultChannel": "VIP群"
  }
}
```

保存配置时，空的 `webhookUrl`、`aibot.botId`、`aibot.secret`、`archive.archiveSecret` 或 `archive.privateKey` 表示保留旧凭据；如需清空，需要分别传 `clearWebhook: true`、`aibot.clearBotId: true`、`aibot.clearSecret: true`、`archive.clearArchiveSecret: true` 或 `archive.clearPrivateKey: true`。`GET /api/state` 和 `GET /api/wecom/config` 不会返回完整Webhook、Bot ID、Secret、会话存档Secret或私钥，只返回配置状态和掩码。

启动企微智能机器人长连接 bridge：

```bash
npm run wecom:bridge
```

只做认证检查：

```bash
npm run wecom:bridge -- --check --timeout=20000
```

启动企微会话内容存档 Gateway：

```bash
npm run wecom:archive
```

只检查会话存档配置：

```bash
npm run wecom:archive -- --check
```

只拉取一轮：

```bash
npm run wecom:archive -- --once
```

`wecom:archive` 默认调用 `archive.sidecarUrl + /pull`。Sidecar 可接官方会话存档SDK，也可接你参考的企微/微信协议服务；Sidecar 必须返回已解密和标准化的消息数组，系统不直接绑定某个协议供应商。入站成功后脚本会调用 `archive.sidecarUrl + /ack` 回写 `cursor/seq/messageIds`，避免外部Sidecar重复推送已经处理的消息。建议 Sidecar 层统一封装实例健康、登录态、消息回调、发送文本/群@、标记已读、联系人/群同步和CDN文件处理。

检查会话存档Sidecar：

```json
{}
```

`/api/wecom/archive/check-sidecar` 不会发送企微Secret或RSA私钥，只检查本地配置完整度，并访问 `archive.sidecarUrl + /health`。配置缺失会返回 `missing`；Sidecar不可达或未声明可拉取/可解密能力时会把会话存档状态写成 `检查失败`。

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

机器人真实回复成功后，bridge 会再次调用 `/api/wecom/inbound` 写入一条出站记录：

```json
{
  "source": "wecom-aibot",
  "direction": "outbound",
  "chatId": "chat_xxx",
  "externalMessageId": "reply_msg_xxx",
  "senderRole": "私域",
  "senderName": "企微机器人",
  "message": "已收到，我先帮您整理需求。"
}
```

`direction=outbound` 会在群上下文和会话工作台中显示为右侧出站消息，并写入 `wecomLogs.type=消息出站`、`externalSideEffects=true`。入站客户消息仍写入 `消息入站`。

个人微信单账号 AccountAgent 配置：

```json
{
  "enabled": true,
  "gateway": {
    "mode": "mock",
    "sidecarUrl": "http://127.0.0.1:8791",
    "sendEndpoint": "/send",
    "receiveEndpoint": "/messages",
    "ackEndpoint": "/ack",
    "canSend": false,
    "canReceive": false,
    "sendMode": "proactive",
    "supportsConfirm": false,
    "supportsRecall": false,
    "supportsAck": false,
    "loginStatus": "未连接",
    "cursor": ""
  },
  "account": {
    "id": "personal_wx_default",
    "name": "个人微信托管号",
    "displayName": "VIP群AccountAgent",
    "defaultCustomerId": "c003",
    "autoReply": true,
    "requireApprovalForRisk": true,
    "minSendIntervalSeconds": 3,
    "maxQueueAgeSeconds": 60
  }
}
```

`gateway.mode` 支持：

- `mock`：本地演练模式，运行SendScheduler后任务进入 `sent_pending_confirm`，不会调用外部服务，不能视为真实发送。
- `sidecar`：真实个人微信Sidecar模式。`/health` 声明 `canReceive=true` 后，`npm run personal-wechat:gateway` 可调用 `sidecarUrl + receiveEndpoint` 拉取消息并调用 `ackEndpoint`；声明 `canSend=true` 后，SendScheduler才会把任务调度为 `sending`，再由Gateway调用 `sidecarUrl + sendEndpoint`。
- `disabled`：停用出站调度，任务保持待处理并写入Gateway停用日志。

个人微信外部群入站：

```json
{
  "customerId": "c003",
  "roomId": "pwx_room_alpha",
  "roomName": "成都VIP外部群",
  "messageId": "pwx-msg-001",
  "senderType": "customer",
  "senderName": "周总",
  "msgType": "text",
  "text": "收到，我把资料补一下，流程怎么走？"
}
```

`/api/personal-wechat/inbound` 会把个人微信外部群消息写入 `personalWechat.groupContexts`，同时复用本地 `VIP模拟群` 会话和VIP分流Agent。低风险客户消息生成 `queued` 发送任务，高风险报价、锁价、退款、赔偿、付款、合同和责任承诺类内容生成 `manual_required` 任务；员工或托管号消息只更新上下文并取消同群待发任务。重复 `messageId` 只写去重日志，不重复生成决策或队列。

企微会话内容存档标准入站：

```json
{
  "messageId": "archive-msg-001",
  "roomId": "archive_room_alpha",
  "roomName": "成都VIP企微外部群",
  "senderId": "external_customer_1",
  "senderName": "周总",
  "senderType": "customer",
  "msgType": "text",
  "text": "今天售后进度同步一下",
  "sendAt": "2026-06-04T10:00:00+08:00",
  "source": "wecom-archive",
  "cursor": "seq-001"
}
```

`/api/wecom/archive/inbound` 是生产会话存档Gateway的主入站入口：主系统不直接执行企微SDK拉取或解密，只接收Sidecar已标准化的存档消息，回写 `wecomConfig.archive.cursor/status/lastPulledAt`，再复用AccountAgent的群上下文、去重、风控和发送调度链路。非文本消息第一版以占位文本入站，并生成客服人工查看任务。

会话工作台列表：

```json
{
  "summary": {
    "total": 4,
    "pendingBind": 1,
    "needsReply": 2,
    "highRisk": 1
  },
  "sessions": [
    {
      "sessionId": "room:archive_room_alpha",
      "kind": "room",
      "sourceLabel": "企微会话存档",
      "title": "成都VIP企微外部群",
      "customerName": "成都华联通讯",
      "bound": true,
      "needsReply": true,
      "riskLevel": "low"
    }
  ]
}
```

会话回复：

```json
{
  "text": "收到，我先帮您整理需求并同步给对应同事。"
}
```

外部群会话回复会进入 `PersonalWechatSendJob`：低风险为 `queued`，高风险为 `manual_required`。本地调试会话没有真实出站通道，因此只生成 `OutboundDraft`，不会标记真实发送。

运行个人微信发送调度：

```json
{
  "now": "2026-06-04T10:10:00.000Z",
  "maxJobs": 2
}
```

`/api/personal-wechat/send-scheduler/run` 只调度 `queued` 低风险任务或已经人工放行的高风险任务。调度会执行同群FIFO、账号并发 `concurrency`、最小发送间隔、分钟发送上限、队列过期重判、Gateway能力声明和失败退避检查。Mock模式通过后任务状态变为 `sent_pending_confirm`，只用于本地演练；Sidecar模式必须 `canSend=true` 才会变为 `sending`，等待出站Gateway真实提交发送。

人工放行高风险任务：

```json
{
  "approvedBy": "local-operator",
  "now": "2026-06-04T10:10:10.000Z"
}
```

`/api/personal-wechat/send-jobs/:jobId/approve` 只允许处理 `manual_required` 任务，放行后任务回到 `queued`。放行本身不会发送消息，仍需运行SendScheduler。

出站Gateway已提交发送回调：

```json
{
  "gatewayMode": "sidecar",
  "gatewayRequestId": "gw_req_001",
  "externalMessageId": "pwx_msg_001",
  "now": "2026-06-04T10:10:12.000Z"
}
```

`/api/personal-wechat/send-jobs/:jobId/dispatched` 由个人微信Sidecar调用，表示外部发送服务已经提交发送。任务会进入 `sent_pending_confirm`，但仍不算闭环完成，必须等待自回显或企微会话存档回读确认。

确认个人微信发送任务：

```json
{
  "confirmedMessageId": "pwx_echo_001"
}
```

`/api/personal-wechat/send-jobs/:jobId/confirm` 用于 Mock 自回显或企微存档回读确认，会把发送任务标记为 `confirmed`，把回复写入本地会话和客户事件。该接口不是发送动作，不能用于把 `queued/manual_required` 任务直接改成已发送。

启动个人微信Sidecar Gateway：

```bash
npm run personal-wechat:gateway
```

只检查Sidecar健康状态，不拉消息、不发送、不ACK：

```bash
npm run personal-wechat:gateway -- --check
```

只处理一轮拉取/发送/确认：

```bash
npm run personal-wechat:gateway -- --once
```

`personal-wechat:gateway` 会先调用 `/api/personal-wechat/gateway/check` 刷新Sidecar能力。`canReceive=true` 时调用 `gateway.sidecarUrl + receiveEndpoint` 拉取消息，写入 `/api/personal-wechat/inbound`，成功后按 `ackEndpoint` 回写游标；`canSend=true` 时处理 `status=sending` 的任务，调用 `gateway.sidecarUrl + sendEndpoint`。Sidecar成功返回后脚本调用 `dispatched`，失败时调用 `fail`；下一轮拉到自回显 `confirmations` 后调用 `confirm`。真实登录态、协议收发、二维码托管、自回显监听和账号风控仍由外部Sidecar承担。

个人微信Sidecar最小接口：

- `GET /health`：返回 `canReceive`、`canSend`、`supportsAck`、`supportsConfirm`、`supportsRecall`、`sendMode`、`loginStatus`；如果需要扫码登录，可返回 `loginQrCodeUrl` 或 `loginQrCodeText`。
- `POST /messages`：接收 `{ accountId, cursor, limit }`，返回 `{ messages, confirmations, nextCursor }`。
- `POST /ack`：接收 `{ accountId, cursor, messageIds }`，确认主系统已处理消息。
- `POST /send`：接收 `{ jobId, accountId, roomId, roomName, text, triggerMessageIds }`，返回 `gatewayRequestId/externalMessageId`。

检查个人微信Gateway：

```json
{}
```

`/api/personal-wechat/gateway/check` 在 `mock` 模式下会记录“Mock检查通过”且 `canSend=false/canReceive=false`；在 `sidecar` 模式下会访问 `gateway.sidecarUrl + /health`，读取 `canReceive`、`canSend`、`sendMode`、`supportsAck`、`supportsConfirm`、`supportsRecall`、`loginStatus`，并把结果写入 `personalWechat.gateway.status`、运行日志和审计。检查不拉取消息、不发送消息，也不携带客户消息内容。

标记个人微信发送失败：

```json
{
  "error": "Gateway掉线",
  "now": "2026-06-04T11:00:10.000Z"
}
```

`/api/personal-wechat/send-jobs/:jobId/fail` 会把任务标记为 `failed`，写入 `retryAfterAt`、账号错误、运行日志和审计。生产Gateway接入后，该接口可由发送网关在失败回调中调用。

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
