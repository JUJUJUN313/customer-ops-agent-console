# 贡献与版本发布规范

本仓库采用 **PR合并 + Tag/Release版本保留**。`main` 永远代表最新稳定版本；任何人不得直接向 `main` 推送业务代码。所有更新必须从独立分支提交，通过Pull Request审核、自动测试和合并检查后进入 `main`。

## 1. 分支规则

分支命名统一使用：

- 新功能：`feature/功能名`
- 修复：`fix/问题名`
- 文档：`docs/说明名`
- Codex协作：`codex/任务名`
- 紧急修复：`hotfix/问题名`

开始工作前必须先同步线上稳定版本：

```bash
git checkout main
git fetch origin
git pull --ff-only origin main
git checkout -b feature/your-task
```

如果本地 `main` 不是干净状态，先处理本地改动，不要直接覆盖。

## 2. 提交前差异核对

提交或推送前必须核对线上和本地差异：

```bash
git fetch origin
git status -sb
git log --oneline HEAD..origin/main
git diff --stat origin/main...HEAD
npm test
```

判断规则：

- `git status -sb` 不能出现未解释的改动。
- `git log --oneline HEAD..origin/main` 有输出，说明线上已经有人更新，必须先同步。
- `git diff --stat origin/main...HEAD` 只能包含本次任务相关文件。
- `npm test` 必须通过。

线上已有新提交时，在自己的功能分支执行：

```bash
git fetch origin
git rebase origin/main
npm test
```

如果出现冲突，只解决自己任务相关冲突；不确定的文件必须找对应提交人确认，禁止凭感觉删除别人的功能。

## 3. 推送与Pull Request

只推送自己的分支：

```bash
git push -u origin feature/your-task
```

然后在GitHub创建Pull Request，目标分支必须是 `main`。

PR描述必须写清：

- 做了什么功能或修复。
- 改了哪些页面、接口或数据结构。
- 是否涉及模型Key、企微、个人微信、外部发送或安全边界。
- 测试结果，例如 `npm test`。
- 是否同步更新文档。

合并前必须确认：

- PR没有冲突。
- 自动测试通过。
- 至少1名维护者Review通过。
- GitHub比较页只包含本次任务相关文件。
- 没有提交 `data/state.json`、`.env`、API Key、企微Secret、Webhook或本地运行日志。
- 如果同时改了 `src/systemActions.js`、`src/app.js` 这类核心文件，Review必须重点看业务闭环、状态写入和界面交互是否被破坏。

默认使用 **Squash and merge** 合并，让一次PR在 `main` 上形成一个清晰提交。大型功能可以保留普通Merge，但PR标题和说明必须清楚。禁止 force push 覆盖别人的分支或 `main`。

## 4. 文档同步

每次功能更新都要同步文档：

- 使用方式、业务流程、模型配置、企微/个人微信接入、Agent能力或外部动作边界变化：更新 `docs/USAGE_GUIDE.md`。
- 架构、数据流、接口、测试或稳定性变化：更新对应 `docs/` 专题文档。
- 所有可见能力变化：更新 `docs/CHANGELOG.md`。
- 新增协作、发布或安全规则：更新 `CONTRIBUTING.md` 和必要的README入口。

文档不是事后补充项；PR没有对应文档说明时，维护者应要求补齐后再合并。

## 5. 敏感信息规则

禁止提交：

- `data/state.json`
- `.env`、`.env.local`、`.env.*`
- API Key、LLM Key、GitHub Token
- 企微Webhook、Bot ID、Secret、入站Secret
- 个人微信真实账号凭据
- 本地测试日志、截图里包含的密钥或客户敏感信息

提交前建议扫描：

```bash
rg -n 'g[h]p_|github[_]pat_|s[k]-[A-Za-z0-9]{20,}|webhook/send[?]key=[A-Za-z0-9_-]{20,}' . -g '!node_modules/**' -g '!data/**' -g '!.git/**'
```

如果密钥已经误提交，立即通知维护者轮换密钥，并用安全流程清理历史，不要继续在同一PR里掩盖。

## 6. 版本发布

`main` 只保留当前最新稳定代码，不在仓库中复制 `v1/v2/v3` 目录。历史版本通过Git Tag和GitHub Release保留。

阶段性版本发布流程：

```bash
git checkout main
git pull --ff-only origin main
git tag -a v0.2.0 -m "v0.2.0: 企微接入与协作规范"
git push origin v0.2.0
```

然后在GitHub Releases中基于该Tag创建Release，写明：

- 新增功能
- 修复问题
- 使用方式变化
- 已知风险
- 回退方式

回到旧版本：

```bash
git checkout v0.2.0
```

如需基于旧版本修复，创建 `hotfix/问题名` 分支并走PR流程，不要直接修改旧Release源码包。

## 7. 维护者职责

维护者负责：

- 维护 `main` 保护规则。
- 审核PR范围和文档同步。
- 确认自动测试通过。
- 合并PR。
- 打Tag和创建Release。
- 处理误提交密钥、冲突升级和紧急回滚。

团队成员负责：

- 基于最新 `main` 创建分支。
- 只提交自己任务相关改动。
- 在PR里说明变更、测试和风险。
- 不覆盖或删除别人的功能。
