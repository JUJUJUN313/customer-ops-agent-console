# 变更记录

## 2026-06-04

### 新增

- 新增企微智能机器人真实联调闭环：普通测试群中通过企微成员选择器真实 @ “测试机器人 1” 后，bridge 已验证可读取真实群消息并按 `chatid` 写入会话工作台；临时开启 `aibot.autoReply` 后，机器人可在企微群内真实回复。
- 新增企微机器人出站回写：bridge 成功调用 `replyStream` 后会把机器人回复以 `direction=outbound` 写入 `/api/wecom/inbound`，会话工作台展示为出站消息，企微日志记录为 `消息出站` 且 `externalSideEffects=true`。
- 增强企微长连接稳定性：bridge 在真实帧缺少 `msgid` 时会生成稳定消息指纹，避免通用事件和类型事件重复入站；机器人出站回写按 `externalMessageId` 幂等处理，重复回写不会在会话里显示两次。
- 增强会话存档Gateway检查：`npm run wecom:archive -- --check` 配置完整后会继续访问 Sidecar `/health`，确认 `canPull/decryptReady`，避免Sidecar未启动时误显示配置可用。
- 增强个人微信Sidecar Gateway：`npm run personal-wechat:gateway` 从单纯发送器升级为接收/ACK/发送/确认循环，支持 `/health` 能力检查、`receiveEndpoint` 拉取消息、`ackEndpoint` 回写游标、`sendEndpoint` 出站发送和自回显 `confirmations`。
- 新增个人微信扫码登录提示：Sidecar `/health` 返回 `loginQrCodeUrl/loginQrCodeText` 时，配置页和 `npm run personal-wechat:gateway -- --check` 会明确提示“请扫码登录”，但在 `canReceive/canSend` 未声明前不会伪装真实可用。
- 优化个人微信接入页登录向导：新增“启动Sidecar、扫码登录、开启收发能力”三步状态，Sidecar返回二维码链接时直接展示二维码预览，避免误以为主系统本身可以登录微信。
- 收敛个人微信接入产品语义：将界面主入口从“Sidecar/Gateway”改为“个人微信连接器”，新增“连接个人微信”入口，Mock检查不再返回真实检查通过，而是明确提示“未接入真实个人微信”。
- 增强个人微信确认回执闭环：Sidecar 只返回 `confirmations`、没有新消息时也会 ACK `confirmationIds/confirmedMessageIds`；同一任务重复回读确认保持幂等，不重复写会话。
- 新增个人微信真实契约联调：使用临时Sidecar验证 `canReceive=true/canSend=true/supportsAck=true` 后，已跑通“拉取客户消息 -> ACK -> SendScheduler进入sending -> Sidecar发送 -> sent_pending_confirm -> 自回显confirmed”完整闭环。
- 新增真实企微/个微接入收敛：企微接入页调整为真实连接中心，突出会话存档主读取、智能机器人测试入口和个人微信Sidecar，模拟入站统一折叠到高级调试区。
- 新增会话存档ACK闭环：`scripts/wecom-archive-gateway.mjs` 成功写入 `/api/wecom/archive/inbound` 后会调用Sidecar `/ack` 回写 `cursor/seq/messageIds`，并把 `lastAckAt` 回写到状态。
- 新增会话存档非文本兜底：图片、文件、语音等无正文消息会以占位文本进入会话，并生成客服人工查看任务，避免真实拉取时丢消息。
- 新增个人微信Sidecar能力门禁：Sidecar `/health` 必须声明 `canReceive=true` 才会拉取消息，声明 `canSend=true` 后SendScheduler才会把任务调度到 `sending`；否则任务保持待处理并写入明确原因。
- 新增业务会话工作台能力层：默认聚合企微会话存档、企微智能机器人和个人微信/统一Sidecar真实来源，提供类企微/微信三栏聊天界面、会话搜索、来源筛选、状态筛选、客户绑定、回复入队、客户档案、任务、报价和发送队列展示；本地模拟只在“本地调试”筛选中出现。
- 导航按业务重新收口：群聊管理改为“VIP群管理”，仅保留VIP客户、VIP会话、报价订阅、群触达草稿和群聊任务；企微接入和消息入站移入设置。
- 客户池改为列表优先：进入客户档案/电销客户池/销售客户/VIP客户时先看到客户列表，右上角“新增档案”进入二级新增页，双击客户行进入二级详情维护页。
- 会话工作台按业务入口拆分：电销管理新增“电销会话”，销售管理新增“销售会话”，VIP群管理提供“VIP会话”；三者复用统一会话能力，但默认按渠道、客户阶段和会员状态过滤，避免业务人员看到不相关群。
- 会话卡片展示优化：左侧会话名称超长省略，卡片标签只保留待绑定、待回复、高风险等行动状态；工作台在桌面端按视口高度约束，左侧列表、中间聊天流和右侧详情各自滚动。
- 新增聊天API：`GET /api/chat/sessions`、`GET /api/chat/sessions/:sessionId`、`POST /api/chat/sessions/:sessionId/reply`、`POST /api/chat/sessions/:sessionId/bind-customer`。
- 新增企微会话内容存档Gateway脚本：`scripts/wecom-archive-gateway.mjs` 和 `npm run wecom:archive`，支持 `--check`、`--once` 和轮询Sidecar `/pull`。
- 扩展 `wecomConfig.archive`：新增 `corpId`、`archiveSecret`、`privateKey`、`privateKeyVersion`、`seq`、`pollIntervalSeconds`、`limit`、`gatewayMode`、`sidecarUrl` 和 `trustedStatus`，并保持Secret/私钥脱敏。
- 新增 `/api/wecom/archive/status`，用于会话存档Gateway回写启动、拉取、Sidecar连接、游标、seq、错误和可信状态。
- 新增 `CONTRIBUTING.md`，正式定义 PR 合并、分支命名、提交前差异核对、文档同步、敏感信息检查、Tag/Release 版本保留和维护者职责。
- 新增 `.github/pull_request_template.md`，要求 PR 填写变更说明、测试结果、文档同步、安全检查和合并前确认。
- 新增 `.github/workflows/ci.yml`，在 Pull Request 和 `main` 推送时自动运行 `npm test`。
- 新增企微会话内容存档标准入站骨架：`wecomConfig.archive` 保存启用状态、服务名、游标、最近拉取时间和错误；`POST /api/wecom/archive/inbound` 接收WeComArchiveGateway标准化后的外部群消息。
- 新增统一入站消息结构：企微会话存档和个人微信Mock消息都会归一为 `InboundGroupMessage`，按 `roomId/chatId` 隔离上下文，并按 `messageId` 去重。
- 新增个人微信 SendScheduler：`POST /api/personal-wechat/send-scheduler/run` 按同群FIFO、账号并发、分钟上限、队列过期重判和失败退避调度低风险 `queued` 任务。
- 新增统一Sidecar调度器：`scripts/personal-wechat-send-gateway.mjs` 和 `npm run personal-wechat:gateway`，支持 `--check`、`--once`、持续轮询接收消息和处理 `sending` 任务。
- 新增个人微信高风险人工放行接口：`POST /api/personal-wechat/send-jobs/:jobId/approve`，`manual_required` 放行后回到 `queued`，仍需SendScheduler调度。
- 新增个人微信Gateway已发送回调接口：`POST /api/personal-wechat/send-jobs/:jobId/dispatched`，外部Sidecar提交发送后进入 `sent_pending_confirm`。
- 新增个人微信发送失败接口：`POST /api/personal-wechat/send-jobs/:jobId/fail` 记录失败次数、失败原因、退避时间和人工接管日志。
- 新增连续客户消息合并：同一群在合并窗口内的连续客户消息会更新同一个活跃发送任务，避免多次排队和旧回复刷屏。
- 新增企微/个人微信接入总控：企微接入页顶部集中展示会话存档、智能机器人、测试群发送和个人微信Sidecar四条链路的配置状态、队列状态和运行边界。
- 新增会话存档Sidecar健康检查接口：`POST /api/wecom/archive/check-sidecar`，检查存档配置完整度并访问 `sidecarUrl/health`，结果回写存档状态和企微日志。
- 新增个人微信Gateway健康检查接口：`POST /api/personal-wechat/gateway/check`，区分 Mock、Sidecar 和停用模式，结果写入Gateway状态、账号状态、运行日志和审计。
- 新增企微群绑定搜索和最近企微记录类型筛选，便于按群名、客户名、`chatid`、来源、状态和日志类型排查接入问题。

### 改进

- 参考企微/微信协议服务能力，将外部通道边界收敛为可替换Sidecar：实例健康、登录态、消息回调、发送文本/群@、标记已读、联系人/群同步和CDN文件处理都由Sidecar适配，系统内部只处理标准化会话、风控、队列和审计。
- 升级 `docs/USAGE_GUIDE.md` 的“多人协作规范”，补齐开始工作、提交前线上线下差异核对、rebase同步、PR合并和版本发布流程。
- README 和项目说明新增贡献与版本发布规范入口。
- 重写 README 为结构化项目首页，补齐业务背景、系统目标、当前能力、业务闭环、系统结构、运行方式、模型与外部连接、当前进度、测试质量、文档协作规则和生产化边界。
- 在 `CONTRIBUTING.md` 和 `docs/PROJECT.md` 中明确 README 同步规则：业务背景、流程、能力、外部连接、运行方式、进度或边界变化时必须同步更新 README。
- 企微接入页调整为“会话存档主读取、智能机器人辅助/测试读取、测试群Webhook发送”的三层结构。
- 个人微信区域新增账号并发、分钟上限、失败退避、消息合并窗口和Gateway模式配置，并把低风险回复从“确认即发送”改成“调度发送、Gateway提交、回读确认”。
- 个人微信任务卡片区分 `queued`、`sending`、`sent_pending_confirm`、`manual_required`、`failed` 等状态；已提交发送任务等待自回显或会话存档回读确认，高风险任务仍需人工确认和人工放行。
- 个人微信确认动作收紧：`queued/manual_required` 任务不能直接确认，避免绕过SendScheduler和人工复核形成假闭环。
- 企微接入页从“复杂配置面板”优化为“接入总控 + 连接配置 + 测试工具 + 群归档 + 日志”的业务排障结构，降低销售/运营理解Gateway状态的成本。
- 会话存档Sidecar检查只验证本地配置和 `/health` 可达性，不上传企微Secret或RSA私钥；个人微信Gateway检查不发送客户消息。
- 会话存档Sidecar检查会读取 `/health` 能力声明，只有Sidecar可达且具备拉取/解密能力才显示通过。
- 个人微信Sidecar检查会读取 `canReceive/canSend/sendMode/supportsAck/supportsConfirm/supportsRecall/loginStatus` 能力声明；Mock模式明确标记为本地演练，不代表真实接入。
- 修复 `npm run wecom:archive -- --check` 失败时只返回退出码、缺少明确终端输出的问题；现在会输出包含 `ok`、`missing`、`gatewayMode`、`sidecarUrl` 和 `message` 的 JSON，方便排障和脚本读取。
- 能力审计、稳定性审计、API文档、架构文档、项目说明、测试文档和完整使用文档同步更新会话存档、AccountAgent和SendScheduler边界。

### 验证

- `npm test`：新增企微机器人出站回写断言；既有企微会话存档入站去重、非文本占位任务、会话工作台投影/绑定/回复、会话存档Gateway状态回写、个人微信Sidecar能力门禁、个人微信Gateway健康检查、同群连续客户消息合并、SendScheduler并发调度/回读确认、人工放行、Sidecar发送回调、分钟上限和发送失败退避断言继续覆盖。
- `node --check src/app.js`
- `node --check src/systemActions.js`
- `node --check src/api.js`
- `node --check scripts/serve.mjs`
- `node --check scripts/wecom-archive-gateway.mjs`
- `node --check scripts/personal-wechat-send-gateway.mjs`
- 本地API冒烟：`/api/health` 正常；`/api/diagnostics` 返回 `ok=true`、失败0、警告0；`/api/personal-wechat/gateway/check` 在Mock模式返回检查通过；`/api/wecom/archive/check-sidecar` 在配置缺失时返回明确缺项并写入日志。
- CLI冒烟：`npm run wecom:archive -- --check` 在缺少 `corpId/archiveSecret/privateKey` 时输出 JSON 缺项并返回退出码1；`npm run personal-wechat:gateway -- --check` 在Mock模式输出 idle 状态且不触发外部发送。
- 浏览器验收：企微接入页接入总控、健康检查按钮、发送测试跳转、群绑定搜索框和企微日志筛选控件渲染正常；当前浏览器插件截图和文本输入受虚拟剪贴板/CDP超时限制，筛选输入需手工补验。

## 2026-06-03

### 新增

- 新增 `docs/USAGE_GUIDE.md` 完整使用文档，覆盖系统定位、启动方式、数据安全、业务闭环、导航结构、各模块实际用法、Agent能力、外部动作边界、LLM/企微/个人微信Mock验收流程、多人协作规范、常见问题和生产化待补足事项。
- 新增业务分组侧边栏：一级菜单包含总览、客户管理、电销管理、销售管理、VIP群管理、设置，页面被收拢到二级菜单；电销、销售、VIP客户和会话入口按业务归属拆分。
- 新增企微接入页面，支持配置企微测试群机器人Webhook、发送测试消息、发送已确认草稿和模拟企微入站。
- 新增企微智能机器人长连接 bridge：`scripts/wecom-aibot-bridge.mjs` 使用 `@wecom/aibot-node-sdk` 通过 WebSocket 读取真实机器人消息。
- 新增 `wecomBindings.groups`，按企微 `chatid` 维护客户群绑定，未知群自动生成待绑定档案，避免不同客户群消息串档。
- 新增企微入站 `externalMessageId/msgid` 去重，重复消息只写去重日志，不重复生成任务或Agent输出。
- 新增个人微信单账号 AccountAgent Mock：`personalWechat` 保存账号、群上下文、回复决策、发送队列和运行日志。
- 新增 `/api/personal-wechat/config`、`/api/personal-wechat/inbound`、`/api/personal-wechat/send-jobs/:jobId/confirm`。
- 新增企微接入页个人微信区域，可配置托管账号、模拟外部群入站、查看群上下文、确认单账号发送队列和运行日志。
- 新增个人微信回复风控：低风险客户消息生成 `queued` 发送任务，高风险报价/锁价/退款/赔偿/付款/合同/承诺类消息生成 `manual_required` 人工确认任务。
- 新增个人微信入站 `messageId` 去重、同群只保留一个活跃待发送任务、员工或托管号回复取消同群待发。
- 新增个人微信发送确认前的队列过期重判和单账号限频，过期任务取消，限频任务保持待发送。
- 新增 `/api/wecom/aibot/check`、`/api/wecom/aibot/status`、`/api/wecom/group-bindings`。
- 新增企微接入页“智能机器人长连接”和“群聊归档绑定”区域，可保存 Bot ID/Secret、查看桥接状态、绑定 `chatid` 到客户档案。
- 新增 `src/wecomClient.js`，封装企微群机器人 `text`/`markdown` 消息发送、Webhook校验、超时控制和响应解析。
- 新增 `wecomConfig` 和 `wecomLogs` 状态，用于保存企微发送路由、入站配置、测试发送/草稿发送/模拟入站日志。
- 新增 `/api/wecom/config`、`/api/wecom/test-send`、`/api/wecom/inbound` 和 `/api/outbound-drafts/:draftId/send-wecom`。
- 新增触达草稿状态 `企微已发送`，成功发送到企微测试群后写入 `wecomDelivery` 和客户事件。
- 新增 `/api/tasks/batch-status`，支持批量更新任务状态，逐条写入客户事件并汇总审计。
- 新增 `/api/outbound-drafts/batch-status`，支持批量更新触达草稿状态，逐条写入状态时间、客户事件和审计。
- 新增总览电销/销售角色工作台，按阶段和任务角色展示优先客户、待办任务，并可跳转到对应筛选页。
- 新增任务中心搜索、角色、负责人、状态、优先级和SLA组合筛选，以及批量跟进中/完成工具条。
- 新增触达草稿搜索、状态、渠道、优先级和风险筛选，以及批量确认/人工已处理/废弃工具条。
- 新增草稿风险识别，高风险文案会阻止批量确认。
- 新增报价订阅页型号搜索、配置、库存、最低价和最高价筛选。
- 新增 `modelConfig` 状态，支持全局系统模型和各Agent独立模型覆盖。
- 新增 `/api/model-config` 读取和保存接口。
- 新增 `/api/model-config/test` 模型连接测试接口，支持按全局或Agent生效配置调用OpenAI兼容 `chat/completions`。
- 新增前端“模型配置”页面，可查看全局模型、Agent覆盖模型和最终生效模型。
- 新增全局LLM连接配置字段：API URL、API Key、模型名、温度和最大输出Token。
- 新增模型配置“清空已保存Key”显式操作，避免空输入框被误解为清空。
- 新增ASR语音识别和TTS语音合成模型配置，可分别保存供应商、API URL、API Key和模型参数。
- 新增客户池搜索和筛选能力，客户旅程与客户管理页支持按搜索词、阶段、会员状态和负责人过滤。
- 新增模型温度解释文案，把温度说明为控制回答稳定/发散程度，并提示客服/销售建议区间。
- 新增 `src/llmClient.js`，封装真实LLM调用、超时控制、OpenAI兼容URL拼接和响应解析。
- 新增Agent真实LLM增强：Agent控制台可勾选按需调用真实LLM，成功后写入 `llmEnhancement` 并生成本地增强草稿。
- 新增 `AgentRun.execution` 执行边界记录，明确本次运行的执行引擎、模型调用状态、外部副作用状态和被阻断的外部动作。
- 新增 `outboundDrafts` 状态，用于保存Agent和人工生成的本地触达草稿。
- 新增 `/api/outbound-drafts` 草稿队列读取、人工新增和状态更新接口。
- 新增前端“触达草稿”页面，可查看待确认文案、人工新增草稿，并把草稿标记为已确认、已复制、人工已处理或已废弃。
- 总览新增“当前真实可用 / 当前未接入”提示，第一屏直接说明本地可用能力和外部未接入边界。

### 改进

- README 和项目说明新增完整使用文档入口，并明确涉及使用方式、业务流程、模型配置、企微/个人微信接入、Agent能力或外部动作边界变化时必须同步更新完整使用文档。
- `/api/state` 新增企微Webhook脱敏，前端只读取是否已配置和掩码，不回显完整Webhook或入站Secret。
- `/api/state` 和 `/api/wecom/config` 新增企微智能机器人 Bot ID/Secret 脱敏，前端只读取是否已配置和掩码。
- 企微接入能力从“测试群Webhook发送 + 本地模拟入站”扩展为“智能机器人长连接读取 + Webhook灰度发送”，自动回复默认关闭。
- 普通草稿状态接口拒绝直接写入 `企微已发送`，必须通过企微发送接口成功后才会标记外部副作用。
- 企微发送模式支持 `manualApproval` 和 `testOnly`；测试模式下禁止业务草稿发送。
- 企微接入入口当前已统一放到设置模块，避免混入VIP群业务菜单。
- 电销客户池二级入口增加业务预设筛选，覆盖待筛选、待外呼和电销企微培育阶段。
- 触达草稿卡片在企微配置可用且草稿已确认时展示“发送企微测试群”按钮。
- 能力审计新增“企微连接器”，外部触达执行器在企微Webhook配置后从未接入推进为半闭环。
- 系统自检新增企微连接配置检查，并允许带 `wecomDelivery` 的 `企微已发送` 草稿通过。
- 系统自检新增个人微信 AccountAgent 配置、`roomId` 群上下文唯一性和单群活跃发送队列检查。
- 能力审计新增“个人微信AccountAgent”，明确当前为 Mock 可运行，真实个人微信 Gateway 仍待接入。
- Agent运行结果新增 `modelConfig` 字段，记录本次实际生效的供应商、API URL、模型名、Key是否配置、温度、最大输出Token和来源。
- Agent运行结果新增生效API URL和Key是否已配置，不暴露明文API Key。
- `/api/state` 返回给前端的模型配置改为脱敏状态，只包含空 `apiKey`、`apiKeyConfigured` 和 `apiKeyMasked`。
- 模型配置保存时空API Key默认保留旧密钥，只有传入 `clearApiKey` 或勾选清空项才会清除。
- Agent独立模型配置完全留空时自动继承全局LLM，只填写部分字段时其余字段回退全局。
- 系统自检新增“模型配置可用”“模型API Key已配置”和“语音模型配置可用”检查。
- 模型配置页改为模型连接配置说明，明确默认本地规则执行，测试连接或勾选真实LLM增强时才会调用外部模型。
- 初始模拟客户池从6个扩充到18个，覆盖更多阶段、会员状态、负责人、交易体量和关注型号。
- 总览系统蓝图从静态方案图改为页面内结构化流程图，展示客户流转链路和客户档案、任务、触达草稿、报价库、模型配置等共享底座。
- 系统蓝图排版改为更适合半屏卡片的三列结构，减少窄列文本挤压。
- Agent控制台改为销售/运营可用的Agent工作台，展示客户摘要、业务动作、客户判断、话术草稿、推荐报价、触达草稿和任务。
- Agent控制台输出按当前客户过滤；AgentRun新增客户归属，切换客户后不会展示其他客户的最近建议。
- 本地消息页VIP分流上下文按当前客户过滤，切换客户后不会展示其他客户的群分流摘要。
- Agent建议区在桌面端固定在可视范围内并独立滚动，长输出不会把操作区冲出视野。
- 表格增加外边界和稳定表头，移动端导航改为横向滚动，模型配置卡片内部表单改为更易读的两列。
- Agent控制台继续展示本地规则引擎、真实LLM是否调用、外部触达副作用未触发，避免把规则Agent或模型增强误解为真实外呼/企微发送。
- 总览、Agent控制台、销售学习、本地消息和审计日志移除原始JSON/代码化输出，统一改为业务摘要或卡片。
- 总览真实能力提示会根据全局LLM Key配置状态展示“真实LLM已配置/待配置”，避免把已配置模型仍显示成未执行能力。
- 任务中心、触达草稿和报价页的新增筛选只影响前端展示，不写入客户档案，避免筛选操作污染业务状态。
- 批量草稿确认增加高风险阻断，投诉、赔偿、退款、锁价、付款等敏感文案需要单条复核。
- Agent运行审计详情改为保存业务摘要，避免后续新审计记录继续出现原始运行对象。
- 顶部批量按钮改为按当前客户阶段批量运行本地规则Agent，不再依赖固定客户脚本。
- 能力审计状态改为“本地可用 / 可运行 / 待建设 / 未接入”，并把“大模型执行器”更新为可运行/待配置，把“外部触达执行器”继续标记为未接入。
- 本地消息、报价、模板和工作流文案统一收口，不再把生成任务或文案描述成已经真实发送。
- 系统自检新增“Agent执行边界可追踪”检查。
- 面向明确客户的Agent运行会自动生成本地触达草稿，并在Agent输出中记录 `outboundDraftId`。
- 系统自检新增“触达草稿可用”检查，会发现孤儿草稿、非法渠道、非法状态、空正文和外部副作用标记异常。
- 能力审计新增“触达草稿队列”，明确当前只支持本地确认和状态管理，不支持真实短信、企微、外呼或CRM发送。
- 修复前端忙碌态结束后统一解除按钮禁用的问题，避免已确认草稿等业务禁用按钮被重新启用。

### 验证

- `npm test`：48 个用例通过，新增批量任务状态、批量草稿状态、真实LLM连接测试、Agent LLM增强、API Key保留/清空、客户归属、企微Webhook脱敏、企微智能机器人凭据脱敏、企微测试发送、企微草稿发送、企微模拟入站、`chatid` 独立建档、群绑定改绑、`msgid` 去重、个人微信低风险队列、高风险人工确认、重复消息去重、队列过期取消和单账号限频断言。
- `node --check src/app.js`
- `node --check src/systemActions.js`
- `node --check src/agentEngine.js`
- `node --check src/api.js`
- `node --check src/wecomClient.js`
- `node --check scripts/serve.mjs`
- `node --check scripts/wecom-aibot-bridge.mjs`
- `npm run wecom:bridge -- --check --timeout=20000`：企微智能机器人 WebSocket 连接建立，Bot认证成功，未输出明文Secret。
- 使用当前已配置的全局LLM完成 `/api/model-config/test`，返回“连接成功”，耗时约1.6秒。
- 使用当前已配置的全局LLM运行销售承接Agent增强，`execution.modelInvocation` 为“已调用”，并生成本地待确认LLM增强草稿，`externalSideEffects=false`。
- API冒烟：2个P0任务批量完成并写入 `completedAt`，2条P0草稿批量废弃并写入 `discardedAt`。
- 浏览器验收：业务分组侧边栏基础点击验证已完成；本轮最终企微接入页自动化验收被应用内浏览器URL安全策略阻止，已用 `node --check`、`npm test`、本地API冒烟和企微长连接真实认证替代，后续可在浏览器策略允许后补截图。

## 2026-06-02

### 新增

- 新增系统自检能力：`/api/diagnostics`。
- 新增前端“系统自检”导航页。
- 新增顶部“运行系统自检”按钮。
- 新增项目文档目录 `docs/`，包含项目说明、架构、API、测试和变更记录。
- 新增界面空状态、加载失败状态、处理中状态和移动端按钮堆叠展示。
- 新增当前系统能力审计文档 `docs/CAPABILITY_AUDIT.md`。
- 新增 `/api/capabilities` 能力审计接口。
- 新增 `/api/workflow/run` 闭环编排接口。
- 新增“闭环编排”前端页面。
- 新增稳定性审计文档 `docs/STABILITY_AUDIT.md`。
- 新增销售样本库数据模型和 `/api/sales-samples` 写入接口。
- 新增“销售学习”前端页面，支持录入销售话术样本、质检分、异议点、适用阶段和卡种。
- 新增离线 `Conversation` 会话上下文模型，保存渠道、群成员、消息、发送角色和@对象。
- 新增任务SLA报表接口 `/api/tasks/sla`，返回任务总量、未完成、临期、超时、升级和完成统计。
- 新增任务SLA巡检接口 `/api/tasks/escalate`，可将超时未完成任务升级到主管队列。

### 改进

- Agent 层增加客户、任务、报价型号存在性校验。
- 系统动作层增加客户、任务、报价、模板等输入边界校验。
- 前端 API 错误解析改为优先展示服务端 `error` 字段。
- 服务端对明显客户端输入错误返回 `400`。
- 报价品牌筛选改为状态驱动，订阅、切换客户或重渲染后会保持筛选值。
- 关键异步操作统一进入 busy 状态，降低重复点击造成的重复写入。
- 销售承接Agent输出销售交接包、playbook、报价推荐和成交建议。
- 销售承接Agent会引用高质量销售样本，输出 `learnedTactics` 和 `winningPhrase`。
- VIP群分流Agent会读取离线会话窗口，识别客户@了谁、应该转谁、是否@错人、是否重复提问和是否已有未完成任务。
- 渠道模拟页新增发送角色、发送人和会话上下文展示。
- 报价推荐Agent输出推荐理由和可推送文案。
- 端到端演示加入闭环编排Agent。
- Agent 层对消息文本、报价字段和客户交易数值做安全归一，避免非预期数据导致运行中断或评分污染。
- 系统动作层增加客户阶段、客户风险、任务状态、任务优先级、销售结果枚举校验。
- 客户档案更新、销售结果和报价订阅会处理畸形意向分、缺失标签列表和缺失关注型号列表。
- 重复报价改为按品牌、型号、配置自然键更新，避免产生重复报价卡片。
- 系统自检扩大到重复客户、非法阶段、非法分数、重复任务、非法任务状态和闭环计划引用。
- 系统自检增加销售样本校验，能力审计中的“销售技巧学习”从假功能推进为离线半闭环。
- 系统自检增加会话引用和会话消息校验，能力审计中的VIP群分流证据会展示离线会话消息数量。
- 人工任务、Agent任务和编排任务会自动补齐 `createdAt`、`dueAt` 和SLA字段。
- 任务中心新增SLA状态标签、截止时间展示、临期/超时KPI和“SLA巡检升级”操作。
- 任务状态更新为已完成时会记录 `completedAt`，SLA报表会把已完成任务从超时统计中排除。
- 状态克隆会自动补齐缺失集合字段，避免旧状态或手工修改导致任务、事件、审计写入崩溃。
- 系统自检新增负责人角色、原始SLA时间和事件内容检查。
- 前端日期展示增加兜底，脏时间不会显示为 `Invalid Date`。
- 静态服务禁止直接访问 `data/` 目录和隐藏文件，`data/state.json` 只能通过受控 API 读取。

### 修复

- 外呼低意向客户不会再被错误打上“潜在意向”标签。
- 任务、报价订阅、客户维护等操作后会保持当前客户选择。
- 模板 `allowed: "false"` 不会被误解析为启用。
- 报价已订阅按钮禁用，避免重复订阅。
- 前端动态文本统一转义，降低模拟数据造成的渲染风险。
- 空客户或加载失败时，客户旅程、Agent、渠道、报价、任务等页面不再因为缺少当前客户而渲染中断。
- 成交后自动创建VIP维护小群任务；继续培育自动回到电销触达任务。
- 闭环编排Agent不再依赖当前选中客户，可在无选中客户时为全量客户生成计划。
- 非法负责人角色、非法渠道发送角色和非法SLA参考时间会被拒绝，不再写入状态。

### 验证

- `npm test`：28 个用例通过。
- `node --check src/app.js`
- `node --check src/systemActions.js`
- `node --check src/agentEngine.js`
- `node --check scripts/serve.mjs`
- 临时 CDP UI smoke：导航、自检、演示、渠道、报价、任务关键点击和SLA展示通过。
- Playwright CLI 截图：桌面与移动端首屏通过人工检查。
