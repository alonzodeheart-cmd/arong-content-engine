# Contributing

感谢你改进 Arong Content Engine。项目优先接受能提高可恢复性、证据边界、平台适配和真实内容质量的改动。

## 开始之前

1. 搜索现有 Issue，避免重复报告。
2. Bug 请提供最小复现、操作系统、Node/Python 版本、命令和去除隐私后的错误日志。
3. 新功能请先说明它解决哪个真实流程问题，以及为什么不能通过现有配置完成。
4. 不要提交个人知识库、账号信息、API Key、声音参考、未脱敏日志或真实商业数据。

## 本地检查

```bash
npm install --prefix runtime/remotion
node scripts/prepare-ci-fixture.mjs
node scripts/engine.mjs audit-skill
node scripts/engine.mjs self-test
```

在未配置私人音色的环境中，为后两条命令设置：

```bash
export ARONG_CONTENT_PROFILE="$PWD/.ci-fixture/profile.json"
```

Windows PowerShell 使用 `$env:ARONG_CONTENT_PROFILE="$PWD/.ci-fixture/profile.json"`。这个夹具只验证本地 TTS 路由契约，不包含模型或个人声音。

所有检查必须通过。修改状态机时，还应验证：

- 未得到用户批准时不会越过审批门；
- `run-safe` 不能脱离前台监工直接运行；
- 旧任务能够读取或给出明确迁移错误；
- 失败不会破坏原始 Markdown 和已保存审批记录。

## Pull Request

- 一次 PR 只解决一个主题；
- 描述行为变化和验证证据；
- 新增配置必须提供无隐私的 example 文件；
- 新增外部服务不得默认上传私人内容；
- 文档与实现必须同步更新。

维护者会根据安全性、兼容性、可验证性和长期维护成本决定是否合并。
