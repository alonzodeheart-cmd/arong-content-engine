# Changelog

本项目遵循语义化版本。日期使用 `YYYY-MM-DD`。

## [1.0.0] - 2026-08-12

### Added

- 选题来源、内容诊断、共同写作和多级人工审批状态机；
- 标题、开头、封面、AI 痕迹、口播流畅度和商业内容风险专项检查；
- 本地 IndexTTS2、词级字幕与 Remotion 9:16 视频生产核心；
- 长任务前台监工、GPU 心跳、重复进程拦截和可恢复状态文件；
- 公众号极简黑白 HTML 与七平台发布包；
- 可移植私人配置、权限边界、结构审计和真实 Remotion 自检；
- 英文介绍、贡献指南、Issue 模板和 GitHub Actions。

### Changed

- 正式流程只生成一版 3–5 分钟 9:16 长视频；
- 删除短测试片、横版主片和三条短切片；
- 暗场封面根据原始亮度决定是否提亮，避免固定遮罩压成纯黑；
- 商业内容缺少发布风险审查时由状态机阻止生产。

[1.0.0]: https://github.com/alonzodeheart-cmd/arong-content-engine/releases/tag/v1.0.0
