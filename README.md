# Arong Content Engine

[![CI](https://github.com/alonzodeheart-cmd/arong-content-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/alonzodeheart-cmd/arong-content-engine/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/alonzodeheart-cmd/arong-content-engine)](https://github.com/alonzodeheart-cmd/arong-content-engine/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

dbskill 能检查标题、开头、封面和 AI 痕迹，但它不会告诉你，这些 Skill 应该按什么顺序调用。

更麻烦的是版本。

文章改了一句话，之前确认的标题还算数吗？封面用的是新标题还是旧标题？视频稿交给 AI 检查以后，正文是不是又被改过？

我做 Arong Content Engine，就是为了管这些事。

它把选题、文章、标题、开头、封面、公众号排版、视频稿、配音和渲染接成一条流程。每一步使用哪个版本、调用哪个专项 Skill、什么时候必须等用户确认，都会留下记录。

最后得到的不只是一次生成结果，而是一套能够继续、检查和恢复的内容任务。

[English documentation](docs/README.en.md)

## 它如何整合 dbskill

```text
选题确认
    ↓
内容诊断
    ↓
多轮共创文章
    ↓
dbs-ai-check
    ↓
用户确认文章
    ↓
dbs-xhs-title
    ↓
dbs-hook
    ↓
dbs-cover
    ↓
微信公众号 HTML
    ↓
重新编写视频稿
    ↓
dbs-script-flow + dbs-ai-check
    ↓
商业内容风险检查
    ↓
配音、字幕与视频制作
    ↓
七平台发布包
```

每个专项 Skill 仍然只负责自己擅长的事情。

Arong Content Engine 负责：

1. 判断当前应该调用哪个 Skill；
2. 给专项 Skill 提供正确版本的材料；
3. 保存诊断结果和用户选择；
4. 阻止流程跳过必要的确认；
5. 将上一步已确认的结果传给下一步；
6. 在长任务中记录运行状态；
7. 最终整理为可以人工发布的完整交付包。

## 调用关系

| 内容阶段 | 调用能力 | 负责什么 |
| --- | --- | --- |
| 内容方向 | `dbs-content` | 判断受众、冲突、形式和表达重点 |
| 文章初稿 | `dbs-ai-check` | 识别 AI 写作特征，只诊断、不擅自改稿 |
| 标题 | `dbs-xhs-title` | 根据文章生成标题候选，等待用户选择 |
| 开头 | `dbs-hook` | 分析开头流失风险，生成新的开头候选 |
| 封面 | `dbs-cover` | 根据已确认标题制作平台封面 |
| 视频逐字稿 | `dbs-script-flow` | 检查衔接、密度和口播流畅度 |
| 视频逐字稿 | `dbs-ai-check` | 再次检查视频语言中的 AI 痕迹 |
| 商业内容 | `dbs-content-risk-check` | 检查收益、价格、项目、导流等发布风险 |
| 公众号 | `dbs-wechat-html` | 输出极简黑白微信公众号 HTML，不改正文 |

如果对应 Skill 已安装，流程会在规定节点调用它。

如果没有安装，系统会明确记录“该专项检查未执行”，而不是用普通提示词模拟一次调用，再把结果冒充为正式检查。

## 一次完整任务会得到什么

根据任务类型和本机环境，最终可以形成：

- 一篇经过用户确认的 Markdown 文章；
- AI 痕迹诊断报告；
- 已确认的标题与开头；
- 按平台适配的封面；
- 微信公众号极简黑白 HTML；
- 一版重新编写的视频逐字稿；
- 视频稿逻辑与 AI 痕迹检查记录；
- 商业内容发布风险报告；
- 本地配音与词级字幕；
- 一版 1080×1920、9:16、3–5 分钟竖版长视频；
- 七个平台的标题、简介、封面和媒体文件；
- 24 小时、7 天和 30 天的数据复盘入口。

本地没有配置配音或视频环境时，文章、标题、开头、封面和排版流程仍然可以运行；视频阶段会停止并报告缺失项。

## 它不会做什么

Arong Content Engine 不会：

- 替用户决定选题；
- 因为找到一个“不错的题目”就自动开始写作；
- 把 Agent 推导出的故事写成本人经历；
- 把文章直接压缩成视频稿；
- 在未获确认时采用标题、开头或封面；
- 把专项 Skill 的建议直接改写进正式正文；
- 因为程序退出就假装视频已经完成；
- 自动发布、发消息、投放、收费或购买服务；
- 承诺流量、收益和平台结果。

所有涉及个人经历、正式正文和发布决策的关键节点，都保留用户确认权。

## 工作流

### 1. 确认选题

用户可以直接提供选题。

如果用户要求从私人思考库找题，系统只读搜索用户指定的来源，返回候选、原句和路径，等待用户选择。

搜索资料不等于授权收录、移动或改写资料。

### 2. 内容诊断

选题确认后，先判断：

- 内容写给谁；
- 读者正在经历什么；
- 真正值得表达的冲突是什么；
- 这篇内容更适合文章、视频还是组合形式；
- 哪些内容来自本人经历；
- 哪些事实需要外部核验；
- 是否涉及产品、项目、收益或导流。

诊断的作用是确定文章应该怎么做，不是替用户制造观点。

### 3. 多轮共创文章

Agent 先给出文章结构，再针对会改变内容方向的缺口一次问一个问题。

连续获得足够的有效信息后，主动推进草稿，不让用户逐段口述整篇文章。

资料不足的地方保留待确认，不用空话把文章补得“看起来完整”。

### 4. 检查并确认文章

文章初稿完成后调用 `dbs-ai-check`。

检查结果单独保存。除非用户明确同意，否则诊断报告不会直接改写正文。

用户确认文章后，系统锁定当前版本和哈希。后续标题、封面、公众号排版和视频稿都以这个版本为依据。

### 5. 分别确认标题、开头和封面

标题、开头和封面不是一个同时打包批准的方案。

- 标题由 `dbs-xhs-title` 单独处理；
- 开头由 `dbs-hook` 单独处理；
- 封面由 `dbs-cover` 根据已确认标题制作。

每一步分别保存候选、选择结果和确认状态。

正文发生实质修改后，系统会判断相关结果是否需要重新检查，避免旧标题、旧开头或旧封面继续冒充当前版本。

### 6. 生成微信公众号版本

文章确认后调用 `dbs-wechat-html`，输出极简黑白 HTML。

该阶段只负责排版，不修改 Markdown 正文。内部编辑备注、待确认事项和诊断文字不能混入读者版本。

### 7. 重新编写视频稿

视频稿不是文章摘要，也不是删短后的文章。

系统根据已确认文章，重新组织为适合听觉接收的 3–5 分钟逐字稿，再调用：

- `dbs-script-flow` 检查段落衔接、信息密度和口播流畅度；
- `dbs-ai-check` 检查视频语言中的机器化表达。

如果内容涉及项目、商品、服务、价格、收益或导流，还必须经过 `dbs-content-risk-check`。

### 8. 制作竖版视频

正式视频固定为：

- 1080×1920；
- 9:16；
- 3–5 分钟；
- 一版无水印正式长片。

视频画面必须对应当前段落。真实截图、证据、数据、流程图和相关图解优先，不能用无关的学生、办公室、钞票或豪车素材填空。

至少 80% 的主要节拍需要出现淡入和平移以外的可见状态变化。禁止把整条视频做成纯字幕轮播、重复卡片或循环呼吸缩放。

如安装了 [`rn-motion-director`](https://github.com/Pluviobyte/rnskill/tree/main/skills/rn-motion-director)，视频阶段会调用它设计运动命题并执行 Anti-PPT 检查。

未安装时使用仓库内置的[视觉生产契约](references/visual-production-contract.md)，并明确记录外部检查未执行。

### 9. 生成发布包

正式视频完成后，系统整理七个平台需要的：

- 标题；
- 简介；
- 封面；
- 正文或视频；
- 发布说明；
- 数据回填入口。

系统只生成发布材料，不代替用户发布。

## 审批与版本管理

这条流程最重要的不是“自动生成”，而是知道什么已经确定、什么还没有确定。

典型状态包括：

- 等待选择选题；
- 等待补充真实经历；
- 等待确认文章；
- 等待选择标题；
- 等待确认开头；
- 等待确认封面；
- 等待确认视频稿；
- 配音进行中；
- 字幕生成中；
- 视频渲染中；
- 发布包已完成。

`WAITING_USER` 表示流程正在等待真实决定，不是程序失败。

正式内容会记录审批状态和哈希，防止下游继续使用已经失效的旧版本。

## 长任务与断点恢复

配音、字幕对齐和视频渲染可能需要较长时间。

正式生产使用：

```powershell
node scripts/engine.mjs run-monitored --task "<任务目录>" --heartbeat 45
```

前台监工会持续显示运行日志，并写入：

- `08-运行状态/long-task.json`：阶段、PID、心跳、静默时间、退出码和恢复建议；
- `08-运行状态/run-safe.log`：完整运行日志。

中断或重新打开任务后，先查询：

```powershell
node scripts/engine.mjs monitor-status --task "<任务目录>"
```

如果原进程仍在运行，就继续观察，不重复启动。

如果任务已经失败，状态文件会给出失败阶段和恢复建议。系统不会仅凭“终端没有输出”擅自杀掉进程，也不会重复运行已经完成的 TTS。

## 封面规则

封面以文字为第一视觉主体：

- 使用 2–4 行大字；
- 背景负责交代人物、场景或关键物件；
- 背景不能与标题争夺注意力；
- 明亮背景可以压暗；
- 夜景或暗场需要保留可辨认的阴影和中间调；
- 缩小到手机信息流尺寸后，标题仍应一眼读完。

微信公众号只输出一张 `2.35:1` 封面，并在同一构图中保留可独立成图的 `1:1` 安全裁切区。

## 安装

```bash
npx -y skills add alonzodeheart-cmd/arong-content-engine -g --all
```

也可以克隆仓库，再将整个目录链接或复制到兼容 `SKILL.md` 的 Agent 技能目录。

### dbskill

Arong Content Engine 不包含 dbskill 本体。

如需执行完整专项检查，请另外安装兼容版本的 dbskill。缺少某项依赖时，系统会标记对应检查未执行。

## 首次配置

1. 将 `config/profile.example.json` 复制为 `config/profile.local.json`。
2. 填写创作者名称、内容任务目录和私人来源地图。
3. 如果需要本地视频，配置 TTS、声音参考、发音词典和字幕对齐工具。
4. 在 `runtime/remotion/` 中安装依赖：

```bash
npm install
```

5. 检查运行环境：

```powershell
node scripts/engine.mjs doctor
```

诊断结果：

- `FULL`：文章、配音、字幕和视频环境完整；
- `WRITING_ONLY`：可以完成选题、写作和专项检查，但视频阶段会停止并列出缺失项。

## 使用示例

### 根据已有素材生产内容

```text
使用 $arong-content-engine：
把这段真实经历做成一篇文章和一条 3–5 分钟竖版视频。
```

### 从私人思考库寻找选题

```text
使用 $arong-content-engine：
从我的思考库推荐 5 个选题。
先给出本人原句和来源，等我选择，不要直接开始写文章。
```

### 继续已有任务

```powershell
node scripts/engine.mjs status --task "<任务目录或 task_id>"
```

根据返回的 `next_action` 继续，不跳过用户审批门。

## 验证

```powershell
node scripts/engine.mjs audit-skill
node scripts/engine.mjs self-test
node scripts/engine.mjs verify-case --task "<任务目录>"
```

只有返回 `PASS`，才表示对应检查真正通过。

仓库同时提供：

- [三分钟可复现案例](examples/portable-demo/README.md)
- [Remotion 渲染样片](docs/demo/arong-content-engine-demo.mp4)
- [工作流契约](references/workflow-contract.md)
- [视觉生产契约](references/visual-production-contract.md)
- [权限与证据边界](references/permissions-and-evidence.md)

## 隐私与安全

以下内容默认被 `.gitignore` 排除：

- `profile.local.json`；
- `source-map.local.md`；
- 本地 TTS 路由；
- 声音参考文件；
- 私人知识库路径；
- 正式内容任务；
- 运行日志和本地配置。

仓库公开的是工作流、状态管理和可移植运行接口，不包含作者的私人知识库、账号、密码、声音样本或发布凭据。

## 一句话总结

dbskill 解决“这一环应该怎么检查”。

Arong Content Engine 解决“整篇内容应该按什么顺序完成、每一步使用哪个版本、什么时候必须停下来等用户确认，以及中断以后怎样继续”。

## License

[MIT](LICENSE)
