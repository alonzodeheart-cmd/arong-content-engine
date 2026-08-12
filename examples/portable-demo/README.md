# 可复现案例：公开核心自检

这个案例验证公开仓库能独立完成核心检查，不读取维护者的私人知识库、声音参考或内容任务。

## 环境

- Node.js 20 或更高版本；
- Python 3.10 或更高版本；
- FFmpeg / FFprobe；
- Windows、macOS 或 Linux。

## 运行

```bash
npm install --prefix runtime/remotion
node scripts/prepare-ci-fixture.mjs
export ARONG_CONTENT_PROFILE="$PWD/.ci-fixture/profile.json"
node scripts/engine.mjs audit-skill
node scripts/engine.mjs self-test
```

Windows PowerShell 将第三行替换为：

```powershell
$env:ARONG_CONTENT_PROFILE="$PWD/.ci-fixture/profile.json"
```

夹具只模拟本地 TTS 路由的文件与校验合同，不包含模型和私人声音；Remotion 视频仍会真实渲染。

## 自检覆盖

1. 缺少选题来源时拒绝创建任务；
2. 从私人资料库选题但缺少来源证据时拒绝创建任务；
3. 只有测试夹具可以使用自动审批身份；
4. 文章、标题/开头/封面和视频稿审批门存在；
5. 私人配置与本地 TTS 依赖不会混入公开核心；
6. 商业内容风险审查是生产硬门；
7. 流程不存在横版主片或三条短切片；
8. Remotion 实际渲染一段 1080×1920、H.264 测试视频；
9. 自动发布、随机库存素材、云端 TTS 回退和静默替用户选择均被列为禁止行为。

成功时最后返回：

```json
{
  "status": "PASS",
  "case_id": "portable-thought-to-vertical-video",
  "skill_audit": "PASS",
  "topic_selection_gate": "PASS",
  "tts_preflight": "PASS",
  "traditional_video_engine": "PASS",
  "probes": {
    "vertical": {
      "ok": true,
      "width": 1080,
      "height": 1920
    }
  }
}
```

机器使用的输入定义在 [`references/self-test-case.json`](../../references/self-test-case.json)，渲染配置在 [`runtime/remotion/test-fixture/render-config.json`](../../runtime/remotion/test-fixture/render-config.json)。样片见 [`docs/demo/arong-content-engine-demo.mp4`](../../docs/demo/arong-content-engine-demo.mp4)。

## 监工协议验证

正式内容生产运行：

```bash
node scripts/engine.mjs run-monitored --task "<任务目录>" --heartbeat 45
```

监工会持续转发子进程日志，并将恢复信息写到任务目录中的 `08-运行状态/long-task.json`。断线后使用：

```bash
node scripts/engine.mjs monitor-status --task "<任务目录>"
```

状态为 `running` 且子进程仍存活时，不会重复启动生产任务。
