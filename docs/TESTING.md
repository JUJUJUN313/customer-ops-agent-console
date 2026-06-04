# 测试与验收

## 自动化测试

运行：

```bash
npm test
```

GitHub Actions 会在 Pull Request 和 `main` 推送时自动运行同一条 `npm test`，作为 `main` 合并保护的必需检查。

当前覆盖 48 个用例：

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
- 企微配置报告会脱敏Webhook和入站Secret，保存时留空Webhook会保留旧密钥。
- 企微智能机器人 Bot ID/Secret 会脱敏展示，保存时空字段会保留旧凭据。
- 企微测试发送会调用群机器人Webhook格式，并写入成功/失败日志。
- 已确认触达草稿可发送企微测试群，成功后写入 `wecomDelivery`、`externalSideEffects: true` 和客户事件。
- 企微模拟入站会写入本地会话窗口，并按渠道路由到对应Agent。
- 企微长连接入站会按 `chatid` 独立建档，未知群进入待绑定档案。
- 企微长连接入站会按 `msgid/externalMessageId` 去重，不重复生成任务和Agent输出。
- 企微群绑定可以改绑到已有客户并通过系统自检。
- 个人微信 AccountAgent 低风险入站会生成单账号发送队列，并可通过 Mock 自回显确认发送。
- 个人微信 AccountAgent 高风险报价/锁价内容会进入人工确认队列。
- 个人微信 AccountAgent 会对重复 `messageId` 去重，员工回复后取消同群待发。
- 个人微信发送队列会取消超过队列过期秒数的任务，并要求重新判断。
- 个人微信发送队列会执行单账号最小发送间隔，限频期间保留队列并提示等待。
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
23. `POST /api/personal-wechat/send-jobs/:jobId/confirm`
24. `GET /api/outbound-drafts`
25. `POST /api/outbound-drafts`
26. `POST /api/outbound-drafts/:draftId/status`
27. `POST /api/outbound-drafts/:draftId/send-wecom`
28. `POST /api/outbound-drafts/batch-status`
29. `POST /api/tasks/escalate`
30. `POST /api/tasks/:taskId/status`
31. `POST /api/tasks/batch-status`
32. `POST /api/sales-samples`
33. `npm run wecom:bridge -- --check --timeout=20000`
34. 异常输入：非法客户阶段、客户风险、任务状态、任务优先级、负责人角色、消息发送角色、SLA参考时间、空全局模型、非法API URL、非法销售结果、重复报价、非法销售样本、空渠道消息、非法触达草稿渠道、非法触达草稿状态、伪造企微已发送、未确认草稿发送企微、空草稿内容、空批量任务ID、空批量草稿ID、重复个人微信消息ID、未知个人微信群ID

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
- 企微测试发送会写入 `wecomLogs`；已确认草稿发送成功后状态为 `企微已发送`，未确认草稿会被拒绝。
- 企微模拟入站会写入本地会话并生成对应Agent输出。
- 企微长连接认证检查成功时，bridge 状态应记录为 `认证成功`，且不会在终端输出明文 Secret。
- 带 `chatId` 的企微入站会写入 `wecomBindings.groups`，未知群状态为 `待绑定`；重复 `externalMessageId` 不会重复生成任务或Agent输出。
- 个人微信 Mock 入站会写入 `personalWechat.groupContexts`；低风险客户消息生成 `queued` 任务，高风险消息生成 `manual_required` 任务，重复 `messageId` 不会重复生成决策或发送任务。
- 个人微信发送确认后，任务状态应为 `confirmed`，本地 `VIP模拟群` 会话和客户事件应出现 AccountAgent 回复；当前 `externalSideEffects` 保持 `false`。
- 个人微信待发送任务超过 `maxQueueAgeSeconds` 后再次确认会被取消，不能继续发送旧回复。
- 个人微信同账号连续发送未满足 `minSendIntervalSeconds` 时，任务保持 `queued` 并写入限频日志。
- 销售样本写入后，销售承接Agent输出可看到 `learnedTactics` 和 `winningPhrase`。
- 异常输入返回明确错误，不写入脏状态。
- 直接访问 `/data/state.json` 返回 `404`，本地状态文件只能通过受控 API 读取。
- 重复报价更新已有报价，不新增重复卡片。

## 前端验收

本轮使用本地浏览器/CDP 脚本完成真实页面 smoke：

- 打开 `http://127.0.0.1:5175`，检查标题和总览首屏。
- 逐个点击一级业务分组和二级菜单，确认 `#viewTitle` 与页面内容正常；总览、客户管理、电销管理、销售管理、群聊管理和设置均可展开。
- 点击电销客户池、电销任务、销售任务、群触达草稿等二级入口，确认对应业务预设筛选生效。
- 在模型配置页修改全局 LLM API URL/API Key/模型名、ASR/TTS语音模型和销售Agent覆盖模型，确认保存提示、表格生效结果，以及Agent输出中的模型连接和执行边界记录。
- 在模型配置页确认API Key输入框不回填明文，只展示掩码占位；勾选“清空已保存Key”并保存后，接口返回Key未配置。
- 在模型配置页确认“温度（创造性）”旁有解释文案，能说明低温更稳定保守、高温更发散。
- 在企微接入页确认Webhook不回显明文；未配置时发送按钮禁用，配置Webhook并启用后可发送测试消息。
- 在企微接入页发送已确认草稿后，确认草稿状态变为 `企微已发送`，最近企微记录出现成功日志。
- 在企微接入页写入模拟企微入站，确认会话和Agent输出刷新。
- 在企微接入页个人微信区域写入低风险外部群消息，确认出现待自动发送任务；点击“模拟发送回显”后，确认任务变为已确认。
- 在企微接入页个人微信区域写入包含报价/锁价的高风险消息，确认任务停在人工确认；再写入员工回复，确认同群待发被取消。
- 在模型配置页点击“测试全局连接”或“测试销售Agent连接”，确认缺Key时出现配置缺失；配置真实Key后会展示模型返回内容和耗时。
- 在Agent控制台勾选“本次使用真实LLM增强”后运行销售承接，确认右侧出现“真实LLM增强”卡片，并在触达草稿里生成LLM增强草稿。
- 在Agent控制台切换客户，确认右侧只展示当前客户的Agent建议；没有该客户运行记录时显示使用指引。
- 在本地消息页写入某个客户的VIP群消息后切换到其他客户，确认不会展示前一个客户的VIP分流上下文。
- 检查桌面端Agent建议区在长输出下可独立滚动，顶部操作区固定，表格有边界和稳定表头。
- 检查移动端导航为业务分组折叠菜单，蓝图、模型卡片、表格和Agent卡片无横向溢出。
- 在总览确认系统蓝图为页面内结构化流程图，能看到客户池/交易数据、电销筛选、培育沉淀、销售承接、VIP维护、数据回流和模型配置等底层能力。
- 在Agent控制台运行销售承接、VIP分流和报价推荐，确认右侧展示客户判断、建议动作、话术草稿、报价推荐、触达草稿和任务，不展示原始 JSON 或代码块。
- 在销售学习页和本地消息页确认学习结果、VIP分流上下文均为业务卡片，不展示原始 JSON。
- 在客户旅程页和客户管理页搜索客户、手机号、标签和机型，并用阶段/会员/负责人筛选，确认客户池与客户列表结果数量正确变化。
- 在销售学习页录入样本，确认样本卡片展示；运行销售承接Agent后，确认学习结果区出现样本引用。
- 点击“运行系统自检”，确认出现“自检通过”。
- 点击“批量运行本地Agent”，确认提示完成。
- 在本地消息页写入消息，确认提示入站成功。
- 在本地消息页确认会话上下文卡片展示群成员、最近消息和@对象，VIP分流上下文展示重复问题/未结任务判断。
- 在报价订阅页切换品牌为 Apple，确认报价卡片正常展示。
- 在报价订阅页使用型号搜索、品牌、配置、库存、最低价和最高价筛选，确认报价卡片正常变化。
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
- 系统自检按钮、批量本地Agent、本地消息入站、报价订阅、SLA巡检、任务状态更新、任务批量状态、草稿批量状态的真实点击或API验证。

## 本轮P0/P1验收记录

- `npm test`：48 个用例通过。
- `node --check src/app.js`、`src/systemActions.js`、`scripts/serve.mjs` 通过。
- 使用当前已配置的全局LLM完成 `/api/model-config/test`，返回“连接成功”，耗时约1.6秒。
- 使用当前已配置的全局LLM运行销售承接Agent增强，`execution.modelInvocation` 为“已调用”，生成本地LLM增强草稿且 `externalSideEffects=false`。
- API冒烟创建2个P0任务并批量完成，确认 `completedAt` 写入；创建2条P0草稿并批量废弃，确认 `discardedAt` 写入且不触发外部发送。
- 新增企微P1单元验收：Webhook脱敏保留、fake fetch测试发送、已确认草稿发送、自检接受 `企微已发送`、企微模拟入站均通过。
- 新增个人微信单账号 AccountAgent 单元验收：低风险自动队列、高风险人工确认、重复消息去重、员工回复取消待发、发送确认、队列过期取消和单账号限频均通过。
- 浏览器自动化验收：业务分组导航曾完成基础点击验证；本轮最终企微接入页验证被应用内浏览器URL安全策略阻止，已改用 `node --check`、`npm test` 和本地API冒烟验证，待浏览器策略允许后补截图。
- 最终 `/api/diagnostics`：`ok=true`，失败0，警告0。

## 每次更新验收标准

- 文档已同步更新。
- `npm test` 通过。
- 修改过的 JS 文件 `node --check` 通过。
- 服务重启后 `/api/health` 通过。
- 关键 API 冒烟流程通过。
- 若涉及前端交互，补浏览器截图或记录无法执行原因。
