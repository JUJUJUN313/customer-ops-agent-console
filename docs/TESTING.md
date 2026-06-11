# 测试与验收

## 自动化测试

运行：

```bash
npm test
```

GitHub Actions 会在 Pull Request 和 `main` 推送时自动运行同一条 `npm test`，作为 `main` 合并保护的必需检查。

当前覆盖 78 个用例：

- 外呼筛选 Agent 将高价值客户升级到销售链路。
- VIP群分流 Agent 将售后问题路由给售后。
- 会话上下文能汇总最近群消息、@对象和未完成任务。
- 报价推荐 Agent 优先推荐客户关注型号。
- 外呼筛选 Agent 不会把低意向客户误标为潜在意向。
- Agent基础动作会拒绝无效客户、任务和报价型号。
- 系统动作能串起 Agent、渠道消息、任务和报价订阅。
- 批量本地Agent会按客户阶段产生多类 Agent 输出。
- 运营管理动作能维护客户、任务、报价和模板。
- 人工任务会自动补齐 `createdAt`、`dueAt` 和 SLA 截止时间。
- 任务SLA报表能识别正常、临期、超时、已升级和已完成任务。
- 超时任务可被一键升级到主管队列，重复巡检不会重复升级。
- 任务完成会记录 `completedAt`，并在SLA报表中归为已完成。
- 任务中心支持批量状态更新，批量跟进中/完成会写入客户事件和审计。
- 运营动作会校验客户、任务、报价和模板输入。
- 运营动作会拒绝非法负责人角色、非法消息发送角色和非法SLA参考时间。
- 状态集合缺失时，系统动作会补齐数组并保持可恢复。
- 模型配置支持全局LLM API URL/API Key/模型名、ASR/TTS语音模型和Agent独立覆盖，Agent未覆盖时继承全局。
- 模型连接测试会按OpenAI兼容 `chat/completions` 请求真实模型；缺API Key时不会发起外部请求。
- Agent真实LLM增强会在本地规则结果之后写入 `llmEnhancement` 和本地增强草稿，外部触达副作用仍为 `false`。
- Agent运行记录会写入 `customerId/customerName`，Agent控制台按当前客户展示建议，不展示其他客户的最近输出。
- 模型配置会拒绝空全局模型和非法API URL，并允许清空Agent覆盖回到全局继承。
- 模型配置保存时空API Key会保留旧密钥，显式 `clearApiKey` 会清空密钥。
- Agent运行记录会写入 `execution`，明确默认本地规则引擎、默认模型未调用、勾选真实LLM增强后模型已调用、外部触达副作用未触发。
- 触达草稿队列会记录Agent生成草稿、人工草稿、确认/复制/人工已处理/废弃状态，并写入事件和审计。
- 触达草稿队列支持批量确认、批量人工已处理和批量废弃，仍保持 `externalSideEffects: false`。
- 触达草稿输入会拒绝非法渠道、非法状态、空内容和伪造 `企微已发送`，系统诊断会发现孤儿草稿。
- 企微后台群发任务支持从电销分层创建批次、同批次幂等复用、人工审批入队、执行器就绪后调度、dry-run结果回写，并保持 `externalSideEffects: false`。
- 企微后台群发任务会拒绝缺少目标客户、指定员工或文案的请求。
- 企微配置报告会脱敏Webhook和入站Secret，保存时留空Webhook会保留旧密钥。
- 企微智能机器人 Bot ID/Secret 会脱敏展示，保存时空字段会保留旧凭据。
- 企微测试发送会调用群机器人Webhook格式，并写入成功/失败日志。
- 已确认触达草稿可发送企微测试群，成功后写入 `wecomDelivery`、`externalSideEffects: true` 和客户事件。
- 企微长连接或测试企微实时入站会写入会话工作台，并按渠道路由到对应Agent。
- 企微长连接入站会按 `chatid` 独立建档，未知群进入待绑定档案。
- 企微长连接入站会按 `msgid/externalMessageId` 去重，不重复生成任务和Agent输出；机器人回复成功后的出站回写也保持幂等。
- 企微会话内容存档入站会转成统一群消息，进入 `roomId/chatId` 独立上下文并按 `messageId` 去重。
- 统一聊天会话投影会展示企微存档会话，并支持把待绑定群绑定到客户档案。
- 电销/销售/VIP会话工作台会按业务入口过滤会话，回复会按风险进入发送队列或人工确认。
- 本地会话工作台回复只保存草稿，不标记真实发送。
- 企微会话存档配置和Gateway状态回写会脱敏并保留游标。
- 企微群绑定可以改绑到已有客户并通过系统自检。
- 个人微信 AccountAgent 低风险入站会生成单账号发送队列，并可通过 Mock 自回显确认发送。
- 个人微信 AccountAgent 高风险报价/锁价内容会进入人工确认队列。
- 个人微信 AccountAgent 高风险队列必须人工放行后才会进入发送调度。
- 个人微信 AccountAgent 会对重复 `messageId` 去重，员工回复后取消同群待发。
- 个人微信 AccountAgent 会把同一群连续客户消息合并到一个活跃发送任务。
- 个人微信 SendScheduler 会按账号并发、同群FIFO和分钟上限调度低风险 `queued` 任务。
- 个人微信 Sidecar 出站模式只有在 `/health` 声明 `canSend=true` 后才会进入 `sending`，Gateway回调后进入 `sent_pending_confirm`。
- 个人微信 Sidecar 接收模式会保存 `receiveEndpoint/ackEndpoint`、`canReceive`、`supportsAck`、登录态和游标；Gateway可拉取消息、写入入站、ACK并等待自回显确认。
- 个人微信 Sidecar 只有确认回执、没有新消息时也会 ACK `confirmationIds/confirmedMessageIds`；重复回读确认保持幂等，不重复写会话。
- 个人微信 Sidecar 未声明发送能力时，SendScheduler不会伪装发送，会让任务保持待发送并写入错误原因。
- 企微会话存档非文本消息会以占位文本入站，并生成客服人工查看任务。
- 个人微信 Gateway 健康检查会写入Gateway状态、账号状态、运行日志和审计。
- 个人微信 SendScheduler 会取消超过队列过期秒数的任务，并要求重新判断。
- 个人微信发送失败会写入失败退避、错误日志和人工接管提示。
- 企微客户端实时未读入站会复用AccountAgent队列，来源为 `wecom-client-realtime`，并确认状态中不会生成截图路径。
- 企微客户端实时批量未读会保留 `readBatchId/observedAt/visibleOrder/senderConfidence`，同批次连续客户消息合并为一个活跃发送任务，发送任务记录 `triggerReadBatchId`。
- 企微客户端 Worker 在调用本地 `/send` 前会做最终预检，若任务版本落后、员工已回复或静默窗口未结束，会取消旧任务且不进入失败退避重试。
- 本地 `/send` 在进入目标会话后会做发送前快读保护；如果目标会话已出现新消息，返回 `aborted_new_messages`，Worker 先把新消息入站并 ACK，再取消旧任务，避免旧回复误发。
- 本地 `/send` 无法确认目标会话最新消息时返回 `target_latest_unverified`，任务取消且不产生外部副作用。
- 本地读取会按消息气泡左右位置区分客户消息和当前企微员工/托管号自回显，防止自回显再次触发自动回复。
- 常驻 Worker 在无未读且已经停留在 `文件传输助手` 时不会重复调用 `/idle`，减少空轮询耗时和窗口抢占。
- 企微客户端实时员工回复会取消同群自动回复，服务商历史下载补账能把发送任务确认到 `confirmed`。
- 系统诊断能发现正常状态和异常引用。
- 销售承接Agent会输出销售交接包和话术建议。
- 闭环编排Agent会为每个客户生成下一步动作和任务。
- 能力审计会标出本地可用、可运行、待建设和未接入能力。
- 闭环编排动作会生成客户计划并写入审计。
- 客户评分对畸形数值保持稳定，不会产生 `NaN`。
- 闭环编排Agent动作不依赖当前选中客户。
- 重复报价会更新同品牌、型号、配置记录，而不是新增重复脏数据。
- 系统诊断会发现非法阶段、非法任务状态、非法负责人角色、坏SLA时间、异常事件和闭环计划引用。
- 客户档案更新会清洗畸形意向分，避免写入 `NaN`。
- 销售结果和报价订阅能处理缺失 `tags`、`watchedModels` 的脏客户。
- Agent消息解析能处理非字符串报价型号和脏意向分。
- 销售样本能写入并进入能力审计，销售承接Agent会引用高质量样本。
- 销售样本输入和自检会拦截空话术、非法阶段、非法结果和异常质检分。
- 渠道入站会沉淀会话上下文，并拒绝空消息。
- 渠道入站会写入当前客户归属，VIP上下文展示按当前客户隔离。
- 系统诊断会发现孤儿会话和异常会话消息。

## 语法检查

```bash
node --check src/app.js
node --check src/systemActions.js
node --check src/agentEngine.js
node --check scripts/serve.mjs
node --check scripts/wecom-aibot-bridge.mjs
node --check scripts/wecom-archive-gateway.mjs
node --check scripts/wecom-client-realtime-worker.mjs
node --check scripts/wecom-admin-local-automation.mjs
node --check scripts/wecom-admin-mass-send-worker.mjs
node --check scripts/personal-wechat-send-gateway.mjs
```

## API冒烟流程

推荐每次更新后执行：

1. `GET /api/health`
2. `POST /api/reset`
3. `GET /api/diagnostics`
4. `GET /api/capabilities`
5. `POST /api/workflow/run`
6. `POST /api/demo/run`
7. `POST /api/channels/message`
8. `POST /api/quotes/subscribe`
9. `GET /api/tasks/sla`
10. `GET /api/model-config`
11. `POST /api/model-config`
12. `POST /api/model-config/test`
13. `GET /api/wecom/config`
14. `GET /api/wecom/aibot/check`
15. `POST /api/wecom/config`
16. `POST /api/wecom/aibot/status`
17. `POST /api/wecom/group-bindings`
18. `POST /api/wecom/test-send`
19. `POST /api/wecom/inbound`
20. `GET /api/personal-wechat/config`
21. `POST /api/personal-wechat/config`
22. `POST /api/personal-wechat/inbound`
23. `POST /api/wecom/archive/inbound`
24. `POST /api/wecom/archive/status`
25. `POST /api/wecom/archive/check-sidecar`
26. `POST /api/personal-wechat/gateway/check`
27. `GET /api/chat/sessions`
28. `GET /api/chat/sessions/:sessionId`
29. `POST /api/chat/sessions/:sessionId/reply`
30. `POST /api/chat/sessions/:sessionId/bind-customer`
31. `POST /api/personal-wechat/send-scheduler/run`
32. `POST /api/personal-wechat/send-jobs/:jobId/approve`
33. `POST /api/personal-wechat/send-jobs/:jobId/dispatched`
34. `POST /api/personal-wechat/send-jobs/:jobId/confirm`
35. `POST /api/personal-wechat/send-jobs/:jobId/fail`
36. `GET /api/wecom-client/realtime/config`
37. `POST /api/wecom-client/realtime/config`
38. `POST /api/wecom-client/realtime/worker/check`
39. `POST /api/wecom-client/realtime/inbound`
40. `POST /api/wecom-client/realtime/send-scheduler/run`
41. `POST /api/wecom-client/realtime/reconcile`
42. `GET /api/wecom-admin/mass-send`
43. `POST /api/wecom-admin/mass-send/worker/check`
44. `POST /api/wecom-admin/mass-send/tasks`
45. `POST /api/wecom-admin/mass-send/tasks/:taskId/approve`
46. `POST /api/wecom-admin/mass-send/scheduler/run`
47. `POST /api/wecom-admin/mass-send/tasks/:taskId/result`
48. `GET /api/outbound-drafts`
49. `POST /api/outbound-drafts`
50. `POST /api/outbound-drafts/:draftId/status`
51. `POST /api/outbound-drafts/:draftId/send-wecom`
52. `POST /api/outbound-drafts/batch-status`
53. `POST /api/tasks/escalate`
54. `POST /api/tasks/:taskId/status`
55. `POST /api/tasks/batch-status`
56. `POST /api/sales-samples`
57. `npm run wecom:archive -- --check`
58. `npm run wecom:realtime -- --check`
59. `npm run wecom:admin-worker -- --check`
60. `npm run personal-wechat:gateway -- --check`
61. `npm run wecom:bridge -- --check --timeout=20000`
62. 企微客户端实时批量未读：保留读取批次元数据，连续客户消息合并为一个任务，非文本占位不丢失
63. 企微客户端实时静默窗口：客户连续消息只更新系统任务，不占用企微UI；静默到期后才进入 `sending`
64. 企微客户端实时版本过期：发送任务触发版本落后于当前 `roomVersion` 时，系统侧直接取消旧回复
65. 企微后台群发任务：创建、审批、调度和 dry-run 回写均不应影响企微客户端实时收发队列
66. 异常输入：非法客户阶段、客户风险、任务状态、任务优先级、负责人角色、消息发送角色、SLA参考时间、空全局模型、非法API URL、非法销售结果、重复报价、非法销售样本、空渠道消息、非法触达草稿渠道、非法触达草稿状态、伪造企微已发送、未确认草稿发送企微、空草稿内容、空批量任务ID、空批量草稿ID、重复企微会话存档消息ID、重复企微客户端实时消息ID、重复个人微信消息ID、未知个人微信群ID、未知会话ID、无效会话绑定客户、高风险会话回复、未放行高风险任务直接确认、`queued`任务直接确认、Sidecar缺配置调度、企微后台群发缺客户/缺员工/缺文案

期望结果：

- 健康检查返回 `ok: true`。
- 系统自检 `ok: true`。
- 能力审计返回本地可用、可运行、待建设和未接入能力。
- 闭环编排为每个客户生成计划和任务。
- 批量本地Agent产生外呼、培育、销售、VIP、报价五类 Agent 输出，并且每条输出都有执行边界。
- VIP售后消息能生成售后任务。
- VIP售后消息能写入会话窗口，Agent输出包含 `conversationContext`、`repeatedIssue` 和 `pendingTask`。
- 报价订阅能写回客户关注型号。
- 任务状态更新能写入事件流。
- 批量任务状态更新能逐条写入任务事件，批量完成会写入 `completedAt`。
- 任务SLA报表能返回超时、临期、升级和完成统计。
- 超时任务巡检后会升级到主管队列，并写入任务事件和审计日志。
- 模型配置保存后，Agent输出包含本次生效的 `modelConfig`、API URL、Key是否配置和真实执行状态 `execution`；默认 `execution.modelInvocation` 为“未调用”。
- `/api/state` 不返回明文API Key；模型配置页输入框留空会保留旧Key，勾选清空项后才清除。
- `/api/state` 不返回明文企微Webhook；企微接入页Webhook输入框留空会保留旧Webhook，勾选清空项后才清除。
- `/api/state` 不返回明文企微智能机器人 Bot ID/Secret；企微接入页 Bot ID/Secret 输入框留空会保留旧凭据，勾选清空项后才清除。
- 模型连接测试在缺API Key时应返回“配置缺失”且不发起外部请求；配置完整时可真实调用OpenAI兼容模型。
- Agent运行传入 `useLlm: true` 时，成功后 `execution.modelInvocation` 为“已调用”，并生成 `llmEnhancement` 和本地增强草稿；失败时保留本地规则结果并记录错误。
- 面向明确客户运行Agent后，会生成本地触达草稿，草稿 `externalSideEffects` 必须为 `false`。
- 人工新增触达草稿后，队列统计增加；确认、复制、人工已处理和废弃只更新本地状态和事件，不触发外部发送。
- 批量触达草稿状态更新能逐条写入事件和时间戳；外部副作用仍为 `false`。
- 电销企微后台群发任务创建后默认为待审批，审批后进入待派发；本地Chrome执行器 dry-run 通过后状态为 `dry_run_passed`，且 `externalSideEffects=false`。
- 群发执行器未声明 `canDispatch=true` 时，调度不会把任务改成派发中；不会影响企微客户端实时收发 Worker。
- 企微测试发送会写入 `wecomLogs`；已确认草稿发送成功后状态为 `企微已发送`，未确认草稿会被拒绝。
- 企微长连接或测试企微实时入站会写入会话并生成对应Agent输出。
- 企微长连接认证检查成功时，bridge 状态应记录为 `认证成功`，且不会在终端输出明文 Secret。
- 带 `chatId` 的企微入站会写入 `wecomBindings.groups`，未知群状态为 `待绑定`；重复 `externalMessageId` 不会重复生成任务或Agent输出。
- 企微会话存档标准入站会回写 `wecomConfig.archive.cursor/status/lastPulledAt/lastMessageAt`，并复用AccountAgent群上下文、去重、风控和发送队列。
- `npm run wecom:archive -- --check` 在缺少Sidecar或必填凭据时必须明确报错，并通过 `/api/wecom/archive/status` 回写Gateway状态，不能假装连接成功。
- `npm run wecom:archive -- --check` 失败时必须在终端输出结构化 JSON，包含 `ok=false`、`missing` 和 `message`，并返回非0退出码。
- `/api/wecom/archive/check-sidecar` 在配置缺失时应返回 `missing` 并写入 `检查失败`；配置完整但Sidecar不可达时应写入明确错误。
- `/api/personal-wechat/gateway/check` 在Mock模式下应记录本地检查通过但 `canSend=false/canReceive=false`；Sidecar模式缺URL、不可达或未声明 `canSend=true/canReceive=true` 时应写入明确状态，不拉取消息、不触发外部发送。
- 会话工作台默认应展示企微会话存档、企微智能机器人、企微客户端实时链路和其他真实来源；内部调试会话不作为业务默认来源。不同 `roomId/chatId/sessionId` 不得混到同一客户，电销/销售/VIP入口不得互相显示不相关会话。
- 会话工作台绑定客户后，群绑定和客户档案引用应同步更新；未知会话或未知客户应返回明确错误。
- 会话工作台外部群低风险回复应进入SendScheduler队列，高风险回复应进入人工确认；本地会话回复只生成本地草稿，不能显示真实已发送。
- 个人微信 Mock 入站会写入 `personalWechat.groupContexts`；低风险客户消息生成 `queued` 任务，高风险消息生成 `manual_required` 任务，重复 `messageId` 不会重复生成决策或发送任务。
- 同一群连续客户消息会合并到一个活跃任务，`triggerMessageIds` 应包含多条消息。
- 运行 SendScheduler 后，Mock模式下符合并发、同群FIFO和分钟上限的 `queued` 任务应变为 `sent_pending_confirm`，等待自回显或会话存档回读确认。
- Sidecar模式下，运行个人微信Gateway前必须先确认 `/health` 能力；`canReceive=true` 时 `npm run personal-wechat:gateway -- --once` 应拉取消息、调用ACK并更新游标；运行 SendScheduler 前必须确认 `canSend=true`，满足能力后任务应先变为 `sending`，Gateway调用 `dispatched` 后才变为 `sent_pending_confirm`；未声明发送能力时任务必须保持 `queued`。
- 高风险 `manual_required` 任务直接确认应被拒绝，必须先人工放行再调度。
- 个人微信回读确认后，任务状态应为 `confirmed`，本地 `VIP群` 会话和客户事件应出现 AccountAgent 回复；当前 `externalSideEffects` 保持 `false`。
- 个人微信待发送任务超过 `maxQueueAgeSeconds` 后运行调度会被取消，不能继续发送旧回复。
- 个人微信同账号达到 `maxSendsPerMinute` 或存在同群更早活跃任务时，任务保持 `queued` 并写入限流或FIFO等待日志。
- 个人微信发送失败接口会把任务写入 `failed`、记录 `retryAfterAt`，并生成需要人工接管的日志。
- 销售样本写入后，销售承接Agent输出可看到 `learnedTactics` 和 `winningPhrase`。
- 异常输入返回明确错误，不写入脏状态。
- 直接访问 `/data/state.json` 返回 `404`，本地状态文件只能通过受控 API 读取。
- 重复报价更新已有报价，不新增重复卡片。

## 前端验收

本轮使用本地浏览器/CDP 脚本完成真实页面 smoke：

- 打开 `http://127.0.0.1:5175`，检查标题和总览首屏。
- 逐个点击一级业务分组和二级菜单，确认 `#viewTitle` 与页面内容正常；总览、客户管理、电销管理、销售管理、VIP群管理和设置均可展开；企微接入应在设置下；电销会话、销售会话、VIP会话标题和业务范围提示应分别正确。
- 点击电销客户池、电销任务、销售任务、群触达草稿等二级入口，确认对应业务预设筛选生效。
- 在模型配置页修改全局 LLM API URL/API Key/模型名、ASR/TTS语音模型和销售Agent覆盖模型，确认保存提示、表格生效结果，以及Agent输出中的模型连接和执行边界记录。
- 在模型配置页确认API Key输入框不回填明文，只展示掩码占位；勾选“清空已保存Key”并保存后，接口返回Key未配置。
- 在模型配置页确认“温度（创造性）”旁有解释文案，能说明低温更稳定保守、高温更发散。
- 在企微接入页确认Webhook不回显明文；未配置时发送按钮禁用，配置Webhook并启用后可发送测试消息。
- 在企微接入页确认顶部“接入总控”展示会话存档、智能机器人、测试群发送和个人微信Sidecar四张状态卡。
- 在企微接入页点击“检查存档Sidecar”和“检查个人微信Sidecar”，确认结果回写到状态卡和日志；缺配置、不可达或未声明 `canReceive/canSend` 时显示明确原因。
- 在企微接入页发送已确认草稿后，确认草稿状态变为 `企微已发送`，最近企微记录出现成功日志。
- 确认“企微兼容入站”“会话存档兼容入站”“个人微信Mock入站”不再出现在业务界面；消息验证改走测试企微实时链路。
- 通过测试企微实时Worker或真实Sidecar `/pull` 写入消息，确认会话存档状态、群上下文和发送队列刷新；非文本消息应以占位文本进入会话并生成客服人工查看任务。
- 在企微接入页确认群聊归档绑定搜索框唯一渲染，并通过前端状态逻辑支持按群名、客户名、`chatid` 和来源过滤。
- 在企微接入页使用最近企微记录类型筛选，确认日志数量和列表变化。
- 在对应业务会话工作台确认新增入站消息出现在独立会话；左侧搜索、来源筛选和状态筛选可用。
- 确认会话卡片只高亮待绑定、待回复、高风险等行动状态，不展示本地模拟、测试群、客户名等低价值标签；长会话名应省略不撑宽列表。
- 桌面端会话工作台应固定在当前视口剩余高度内，左侧列表、中间消息流和右侧详情各自滚动，右侧内容不能把整个会话窗口撑高。
- 在会话工作台把未绑定群绑定到客户，确认右侧客户档案、群绑定状态和任务/报价信息刷新。
- 在会话工作台输入低风险回复，确认进入待发送队列；输入报价、退款、赔偿、合同等高风险回复，确认进入人工确认。
- 在会话工作台默认“全部真实”下确认不展示内部调试会话；API级内部调试会话回复时，只生成本地触达草稿，不显示真实外发状态。
- 在企微接入页个人微信区域写入低风险外部群消息，确认出现待自动发送任务；点击“运行发送调度”后Mock模式任务变为已提交待回读；点击“回读确认”后，确认任务变为已确认。
- 在企微接入页个人微信区域切换Sidecar模式并保存后，先确认Sidecar `/health` 声明 `canReceive/canSend/supportsAck/loginStatus`；运行 `npm run personal-wechat:gateway -- --once` 拉取真实消息，运行调度后任务应变为发送中；外部Gateway回调后变为已提交待回读，再通过自回显或确认回执变为已确认。未声明 `canSend=true` 时任务必须保持待发送。
- 在企微接入页个人微信区域写入包含报价/锁价的高风险消息，确认任务停在人工确认；点击人工放行后才可进入调度；再写入员工回复，确认同群待发被取消。
- 在模型配置页点击“测试全局连接”或“测试销售Agent连接”，确认缺Key时出现配置缺失；配置真实Key后会展示模型返回内容和耗时。
- 在Agent控制台勾选“本次使用真实LLM增强”后运行销售承接，确认右侧出现“真实LLM增强”卡片，并在触达草稿里生成LLM增强草稿。
- 在Agent控制台切换客户，确认右侧只展示当前客户的Agent建议；没有该客户运行记录时显示使用指引。
- 在测试企微实时入站某个客户的VIP群消息后切换到其他客户，确认不会展示前一个客户的VIP分流上下文。
- 检查桌面端Agent建议区在长输出下可独立滚动，顶部操作区固定，表格有边界和稳定表头。
- 检查移动端导航为业务分组折叠菜单，蓝图、模型卡片、表格和Agent卡片无横向溢出。
- 在总览确认系统蓝图为页面内结构化流程图，能看到客户池/交易数据、电销筛选、培育沉淀、销售承接、VIP维护、数据回流和模型配置等底层能力。
- 在Agent控制台运行销售承接、VIP分流和报价推荐，确认右侧展示客户判断、建议动作、话术草稿、报价推荐、触达草稿和任务，不展示原始 JSON 或代码块。
- 在销售学习页和会话工作台确认学习结果、VIP分流上下文均为业务卡片，不展示原始 JSON。
- 在客户旅程页和客户管理页搜索客户、手机号、标签和机型，并用阶段/会员/负责人筛选，确认客户池与客户列表结果数量正确变化。
- 进入“客户管理 > 客户档案”、“电销管理 > 电销客户池”、“销售管理 > 销售客户”、“VIP群管理 > VIP客户”，默认应只显示客户列表；右上角“新增档案”进入新增二级页；双击客户行进入详情维护二级页；单击客户行只切换选中状态。
- 在销售学习页录入样本，确认样本卡片展示；运行销售承接Agent后，确认学习结果区出现样本引用。
- 点击“运行系统自检”，确认出现“自检通过”。
- 点击“批量运行本地Agent”，确认提示完成。
- 用测试企微实时链路写入消息，确认会话工作台出现新消息。
- 在会话工作台确认会话上下文卡片展示群成员、最近消息和@对象，VIP分流上下文展示重复问题/未结任务判断。
- 在“VIP群管理 > 报价订阅”切换品牌为 Apple，确认报价卡片正常展示。
- 在“VIP群管理 > 报价订阅”使用型号搜索、品牌、配置、库存、最低价和最高价筛选，确认报价卡片正常变化。
- 订阅报价后确认品牌筛选保持为 Apple。
- 在任务中心确认任务卡片展示 SLA 状态、截止时间、升级标记和负责人。
- 在任务中心使用搜索、角色、负责人、状态、优先级和SLA筛选，确认筛选结果变化；勾选任务后批量按钮可用。
- 在任务中心点击“SLA巡检升级”，确认提示完成且页面无异常。
- 在任务中心点击任务状态按钮，确认状态更新提示。
- 在触达草稿页确认Agent生成的草稿出现，可人工新增草稿，并可把草稿更新为已确认、人工已处理或已废弃。
- 在触达草稿页使用搜索、状态、渠道、优先级和风险筛选，确认风险标签展示；勾选草稿后批量确认/处理/废弃按钮可用，高风险草稿不能批量确认。
- 草稿确认后，“确认草稿”按钮应保持禁用，异步忙碌态结束不能把业务禁用按钮重新启用。
- 捕获控制台 error/warning，排除 favicon 后应为空。
- 生成桌面和移动端截图，检查无明显遮挡、空白或文字溢出。

后续扩展浏览器覆盖时，需要补充：

- 桌面视口加载检查。
- 移动视口布局检查。
- 页面无空白、无框架错误覆盖。
- 控制台无关键报错。
- 系统自检按钮、批量本地Agent、测试企微实时入站、报价订阅、SLA巡检、任务状态更新、任务批量状态、草稿批量状态的真实点击或API验证。

## 本轮P0/P1验收记录

- `npm test`：64 个用例通过。
- `node --check src/app.js`、`src/systemActions.js`、`src/api.js`、`scripts/serve.mjs`、`scripts/wecom-archive-gateway.mjs`、`scripts/personal-wechat-send-gateway.mjs` 通过。
- 使用当前已配置的全局LLM完成 `/api/model-config/test`，返回“连接成功”，耗时约1.6秒。
- 使用当前已配置的全局LLM运行销售承接Agent增强，`execution.modelInvocation` 为“已调用”，生成本地LLM增强草稿且 `externalSideEffects=false`。
- API冒烟创建2个P0任务并批量完成，确认 `completedAt` 写入；创建2条P0草稿并批量废弃，确认 `discardedAt` 写入且不触发外部发送。
- 新增企微P1单元验收：Webhook脱敏保留、fake fetch测试发送、已确认草稿发送、自检接受 `企微已发送`、企微入站兼容接口均通过。
- 新增会话存档和个人微信单账号 AccountAgent 单元验收：企微会话存档统一入站、同群连续客户消息合并、低风险自动队列、高风险人工确认/人工放行、重复消息去重、员工回复取消待发、SendScheduler并发调度、同群FIFO、分钟上限、Gateway健康检查、Sidecar发送回调、队列过期取消、失败退避和回读确认均通过。
- 浏览器自动化验收：业务页面完成导航遍历，均可渲染、无框架错误、无重复DOM id、无控制台报错；企微接入页可进入“设置 > 企微接入”；接入总控四张状态卡、两个健康检查按钮、群绑定搜索框和日志筛选控件均唯一渲染；“检查个人微信Sidecar”返回 Mock 本地演练且 `canSend=false/canReceive=false`，“检查存档Sidecar”在缺少 CorpID/Secret/私钥时给出明确缺项；个人微信兼容入站、会话存档兼容入站和企微兼容入站不再作为业务界面入口；“查看发送测试”跳转到发送测试卡片并更新 `#wecom-send-test` hash。
- 本轮真实接入收敛浏览器验收：`VIP群管理 > VIP会话` 默认来源为“全部真实”，来源选项包含企微会话存档、企微机器人、个人微信/Sidecar和本地调试；状态筛选包含待绑定、待回复、高风险、待回读和发送失败；会话卡只展示待回复/高风险等行动标签；右侧面板独立滚动；控制台 error/warning 为空。
- 本轮截图：`/tmp/customer-ops-qa/wecom-connection-center.png`、`/tmp/customer-ops-qa/vip-chat-workbench.png`。
- 最终 `/api/diagnostics`：`ok=true`，失败0，警告0。

## 每次更新验收标准

- 文档已同步更新。
- `npm test` 通过。
- 修改过的 JS 文件 `node --check` 通过。
- 服务重启后 `/api/health` 通过。
- 关键 API 冒烟流程通过。
- 若涉及前端交互，补浏览器截图或记录无法执行原因。
