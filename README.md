# 智能客服与客户运营中台本地可运行版

这个项目使用本地 API、服务端 JSON 状态、本地消息入口、触达草稿队列、企微智能机器人长连接/测试群机器人连接器、个人微信单账号 AccountAgent Mock 队列和规则型 Agent，把“电销筛选 → 销售承接 → VIP维护 → 报价订阅 → 数据回流”的本地闭环跑起来。当前系统会真实写入本地客户档案、任务、报价、会话、触达草稿、模型连接配置、企微配置/日志/群绑定、个人微信群上下文/发送队列、Agent运行记录和审计日志；不会真实外呼、发短信或同步CRM。默认Agent先由本地规则引擎稳定执行，点击模型连接测试或在Agent控制台勾选真实LLM增强时，会调用你配置的LLM；配置企微Webhook后，已确认草稿可以真实发送到企微测试群机器人；配置企微智能机器人 Bot ID/Secret 并启动 bridge 后，可以读取真实企微智能机器人消息并按 `chatid` 独立归档客户群。

## 运行

```bash
npm run dev
```

默认地址：

```text
http://127.0.0.1:5175
```

本地服务会创建状态文件：

```text
data/state.json
```

该文件用于保存客户档案、事件流、会话上下文、任务、报价、销售样本、触达草稿、LLM/语音模型连接配置、企微Webhook配置、企微智能机器人凭据、企微群绑定、个人微信 AccountAgent 配置/群上下文/发送队列、发送/入站日志、Agent 输出和审计日志，已加入 `.gitignore`。本地静态服务会阻断 `data/` 目录直接访问，状态读取统一走 API；前端状态接口不会返回明文 API Key、企微Webhook、Bot ID 或 Secret，只返回是否已配置和掩码。

企微智能机器人长连接读取需要先启动本地 API，再启动 bridge：

```bash
npm run wecom:bridge
```

只验证 Bot ID/Secret 能否认证成功，不持续读取消息：

```bash
npm run wecom:bridge -- --check --timeout=20000
```

## 测试

```bash
npm test
```

当前测试覆盖：

- 外呼筛选 Agent 将高价值客户升级到销售链路。
- VIP 群分流 Agent 将售后问题路由给售后。
- VIP 群分流 Agent 会读取离线会话上下文、识别 @ 对象、重复问题和未完成任务。
- 报价推荐 Agent 优先推荐客户关注型号。
- 无效客户、任务、报价型号、报价价格和模板风险会被拒绝。
- 非法负责人角色、渠道发送角色和SLA参考时间会被拒绝。
- 系统诊断能识别正常状态和异常引用。
- 系统诊断能发现坏SLA时间、异常事件内容和非法任务负责人角色。
- 模型配置支持全局 LLM API URL/API Key/模型名、语音识别 ASR、语音合成 TTS，以及各Agent独立LLM覆盖。
- 模型配置保存时空 API Key 会保留旧 Key，显式勾选“清空已保存Key”才会清除密钥。
- 模型连接测试和Agent真实LLM增强会走OpenAI兼容 `chat/completions` 请求；缺少API Key时不会发起外部请求。
- 渠道入站和VIP上下文会写入 `customerId/customerName`，切换客户后不会展示其他客户的VIP分流上下文。
- 触达草稿队列会记录Agent生成的待确认文案、人工草稿、确认/复制/处理/废弃状态，并保证不触发外部发送。
- 任务中心支持角色/负责人/状态/优先级/SLA/搜索筛选和批量状态更新，批量动作会写事件与审计。
- 触达草稿队列支持搜索、状态/渠道/优先级/风险筛选和批量确认/处理/废弃；高风险文案会阻止批量确认。
- 触达草稿会拒绝非法渠道、非法状态、空内容和孤儿客户引用。
- 企微配置报告会脱敏Webhook和入站Secret，并保留已保存密钥。
- 企微智能机器人 Bot ID/Secret 会脱敏展示，空字段保存保留旧凭据。
- 企微测试发送会真实调用群机器人Webhook格式并记录发送日志。
- 已确认触达草稿可发送到企微测试群，成功后状态变为 `企微已发送` 且自检通过。
- 企微模拟入站会写入本地会话并路由到对应Agent。
- 企微长连接入站会按 `chatid` 独立建档，按 `msgid` 去重，未知群进入待绑定群档案。
- 非法阶段、风险、任务状态、优先级、销售结果等异常输入不会写入脏状态。
- 畸形数值、缺失客户列表字段和非字符串报价型号不会导致 Agent 或运营动作中断。
- 个人微信单账号 AccountAgent 会按 `roomId` 维护外部群上下文，低风险消息生成自动发送队列，高风险消息进入人工确认，重复消息会去重，员工回复会取消待发，发送确认会执行队列过期重判和账号限频。

## 已实现模块

- 总览：核心指标、总体链路、电销/销售角色工作台、页面内结构化系统蓝图、最近 Agent 输出摘要；左侧导航按总览、客户管理、电销管理、销售管理、群聊管理和设置组织二级菜单。
- 客户旅程：客户状态机、客户池、客户 360 简档、事件流，支持搜索和阶段/会员/负责人筛选。
- 客户管理：新增客户、维护客户阶段/负责人/标签/关注型号、记录销售结果，客户列表支持搜索和筛选。
- Agent 控制台：面向销售和运营的工作台，展示客户摘要、常用场景、业务动作、客户判断、建议话术、报价推荐和待办，不展示原始代码或 JSON。
- 模型配置：配置全局 LLM API URL、API Key、模型名、温度、输出Token，配置ASR/TTS语音模型，并支持各Agent独立覆盖；支持测试LLM连接，Agent控制台可按需勾选真实LLM增强，ASR/TTS当前仍只保存连接参数。
- 企微接入：保存企微智能机器人 Bot ID/Secret、启动长连接 bridge 读取真实消息、按 `chatid` 独立归档客户群、维护群聊绑定；同时保留企微测试群机器人Webhook发送测试消息、已确认草稿灰度推送，以及个人微信单账号 AccountAgent Mock 队列。Webhook、Bot ID、Secret和入站Secret只在服务端状态保存，前端不回显明文。
- 销售学习：录入成交/培育话术样本，销售承接 Agent 会引用高质量匹配样本生成建议。
- 本地消息：写入电销私聊、销售私聊、VIP 群本地消息，沉淀本地会话窗口，并自动路由到对应 Agent。
- 触达草稿：Agent 和人工可生成待确认触达文案，支持搜索筛选、风险识别、确认、复制、发送企微测试群、批量处理、人工已处理和废弃；只有企微发送成功会标记外部动作已触发。
- 任务中心：统一承接销售线索、VIP 问题、报价咨询、售后分流，支持人工新增任务、组合筛选、批量状态更新、SLA截止时间、超时巡检和主管升级。
- 报价订阅：结构化报价查询、型号搜索、品牌/配置/库存/价格范围筛选、型号订阅、报价行为回流，支持新增/更新报价。
- 闭环编排：为所有客户生成下一步动作、触达渠道、负责人、成功指标和任务。
- 模板与风控：审核模板、禁用模板、自动化边界展示，支持模板启停。
- 系统自检：检查客户指针、任务/事件引用、报价、模板、审计日志的状态一致性。
- 界面保护：空数据、加载失败、处理中、防重复提交、报价筛选保持、移动端导航和当前客户Agent输出隔离均有前端状态处理。

## 项目文档

- [完整使用文档](docs/USAGE_GUIDE.md)
- [项目说明](docs/PROJECT.md)
- [系统架构](docs/ARCHITECTURE.md)
- [API 文档](docs/API.md)
- [当前系统能力审计](docs/CAPABILITY_AUDIT.md)
- [稳定性审计](docs/STABILITY_AUDIT.md)
- [测试与验收](docs/TESTING.md)
- [变更记录](docs/CHANGELOG.md)

每次功能更新都需要同步维护上述文档。涉及使用方式、业务流程、模型配置、企微/个人微信接入、Agent能力或外部动作边界变化时，必须同步更新完整使用文档。

## 本地 API

- `GET /api/health`：检查服务状态。
- `GET /api/state`：读取前端可用系统状态；模型 API Key 已脱敏。
- `GET /api/diagnostics`：运行系统自检。
- `GET /api/capabilities`：读取系统能力审计。
- `GET /api/tasks/sla`：读取任务SLA报表。
- `GET /api/model-config`：读取全局 LLM、语音模型和Agent生效模型配置，API Key按掩码返回。
- `GET /api/wecom/config`：读取企微连接配置、智能机器人状态、群绑定和发送/入站日志摘要，Webhook、Bot ID、Secret和入站Secret按掩码返回。
- `GET /api/personal-wechat/config`：读取个人微信单账号 AccountAgent 配置、群上下文、发送队列、决策和运行日志。
- `GET /api/outbound-drafts`：读取触达草稿队列和状态统计。
- `POST /api/reset`：重置本地样例数据。
- `POST /api/demo/run`：按当前客户阶段批量运行本地规则Agent并生成闭环编排。
- `POST /api/workflow/run`：运行闭环编排Agent。
- `POST /api/agents/:kind/run`：运行指定 Agent，`kind` 支持 `dialer`、`nurture`、`sales`、`vip`、`quote`、`orchestrator`。
- `POST /api/model-config/test`：按全局或指定Agent生效模型配置真实测试LLM连接。
- `GET /api/wecom/aibot/check`：检查智能机器人 Bot ID/Secret 是否已保存，返回 bridge 启动条件。
- `POST /api/wecom/config`：保存企微测试群机器人Webhook、智能机器人凭据、发送模式和本地入站设置。
- `POST /api/wecom/aibot/status`：bridge 进程回写长连接启动、认证、断开和错误状态。
- `POST /api/wecom/group-bindings`：把企微 `chatid` 绑定到客户档案和业务渠道。
- `POST /api/wecom/test-send`：真实调用企微群机器人Webhook发送测试消息并写入日志。
- `POST /api/wecom/inbound`：写入企微模拟或长连接入站消息，按 `chatid` 归档并路由到本地Agent。
- `POST /api/personal-wechat/config`：保存个人微信单账号 AccountAgent 配置。
- `POST /api/personal-wechat/inbound`：写入个人微信外部群入站消息，按 `roomId` 更新群上下文、生成风控决策和单账号发送队列。
- `POST /api/personal-wechat/send-jobs/:jobId/confirm`：模拟个人微信发送成功后的自回显/存档确认，写入本地会话、事件和日志。
- `POST /api/channels/message`：写入本地渠道消息并运行路由。
- `POST /api/outbound-drafts`：人工新增本地触达草稿。
- `POST /api/outbound-drafts/:draftId/status`：更新触达草稿状态。
- `POST /api/outbound-drafts/:draftId/send-wecom`：将已确认草稿发送到企微测试群机器人；成功后状态变为 `企微已发送`。
- `POST /api/outbound-drafts/batch-status`：批量更新触达草稿状态。
- `POST /api/customers`：新增客户。
- `POST /api/customers/:customerId`：更新客户档案。
- `POST /api/customers/:customerId/outcome`：记录销售结果。
- `POST /api/tasks`：人工新增任务。
- `POST /api/tasks/:taskId/status`：更新任务状态。
- `POST /api/tasks/batch-status`：批量更新任务状态。
- `POST /api/tasks/escalate`：运行SLA巡检并升级超时任务。
- `POST /api/model-config`：保存全局 LLM、ASR/TTS语音模型和Agent独立模型连接配置。
- `POST /api/quotes`：新增或更新报价。
- `POST /api/quotes/subscribe`：订阅报价型号。
- `POST /api/sales-samples`：新增销售话术样本。
- `POST /api/templates/:templateId`：更新模板状态或内容。

## 当前设计边界

- 已接入企微智能机器人长连接读取和测试群机器人Webhook发送；长连接消息会按 `chatid` 独立归档，未知群会生成待绑定客户群档案。尚未接入客户联系加好友回调、企业通讯录、成员私聊全量同步和生产级权限策略。
- 个人微信单账号 AccountAgent 当前为 Mock Gateway：可以验证多外部群上下文、低风险自动排队、高风险人工确认、单账号串行发送队列、队列过期重判、账号限频和回显确认；尚未接真实个人微信登录、收发、掉线重连和生产合规审批。
- 不接入真实外呼、短信、CRM、交易系统。
- 已支持 LLM连接测试和Agent按需真实LLM增强；默认运行不调用外部模型，勾选增强后 `AgentRun.execution.modelInvocation` 会记录为“已调用”。ASR/TTS语音模型当前仍只保存连接参数。
- API Key会保存在本地 `data/state.json`，前端只读取掩码和配置状态；生产环境需要改为密钥管理服务或环境变量。
- 触达草稿队列只生成和管理本地文案状态；确认、复制、人工已处理和废弃不会真实发送短信、外呼、企微私聊或CRM动作。只有在企微接入页配置Webhook后，点击“发送企微测试群”才会真实调用群机器人Webhook。
- 所有状态保存在本地服务端 JSON，可通过“重置数据”恢复初始本地样例数据。

后续接入生产级企微时，可以保留当前客户档案、事件流、任务中心、企微适配层、`chatid` 群绑定和 Agent 接口，在长连接读取基础上补齐客户联系、通讯录、权限、审计、审批、幂等和失败重试。
