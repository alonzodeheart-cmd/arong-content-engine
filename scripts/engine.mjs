#!/usr/bin/env node

import {createHash} from 'node:crypto';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {basename, dirname, isAbsolute, join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {loadProfile, profileSummary} from './profile.mjs';

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE = loadProfile();
const CONTENT_ROOT = PROFILE.content_root || SKILL_DIR;
const PIPELINE_DIR = join(SKILL_DIR, 'runtime');
const PIPELINE = join(PIPELINE_DIR, 'content-pipeline.mjs');
const TASKS_ROOT = PROFILE.tasks_root || join(SKILL_DIR, 'content-tasks');
const TTS_ROUTE = PROFILE.tts?.route_config || join(SKILL_DIR, 'config', 'tts-routing.local.json');
const REMOTION_DIR = join(PIPELINE_DIR, 'remotion');
const FIXTURE_PATH = join(SKILL_DIR, 'references', 'self-test-case.json');
const STATES = [
  'idea',
  'interviewing',
  'content_diagnosis',
  'co_writing',
  'article_review',
  'article_approved',
  'hook_selected',
  'script_review',
  'script_approved',
  'rendered',
  'package_ready',
  'published',
  'metrics_24h',
  'metrics_7d',
  'metrics_30d',
  'reviewed',
];
const FINAL_MEDIA = [
  'main-9x16.mp4',
];

function parseArgs(argv) {
  const [command = 'help', ...rest] = argv;
  const args = {_: []};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return {command, args};
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
}

function commandExists(command) {
  const result = spawnSync('where.exe', [command], {encoding: 'utf8'});
  return result.status === 0;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
    env: {...process.env, ...(options.env || {})},
  });
  if (options.inherit) return result.status ?? 1;
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function runPipeline(args, inherit = true) {
  return run(process.execPath, [PIPELINE, ...args], {
    cwd: PIPELINE_DIR,
    inherit,
    env: {
      ARONG_CONTENT_PROFILE: PROFILE.path,
      ARONG_CONTENT_ROOT: CONTENT_ROOT,
      ARONG_CONTENT_TASKS_ROOT: TASKS_ROOT,
    },
  });
}

function runSupervisor(command, args, inherit = true) {
  const supervisor = join(SKILL_DIR, 'scripts', 'supervise-run.mjs');
  const forwarded = [supervisor, command, '--task', resolveTask(args.task)];
  if (command === 'run') {
    forwarded.push('--engine', join(SKILL_DIR, 'scripts', 'engine.mjs'));
    if (args.heartbeat) forwarded.push('--heartbeat', String(args.heartbeat));
    if (args['dry-run']) forwarded.push('--dry-run');
  }
  return run(process.execPath, forwarded, {cwd: SKILL_DIR, inherit});
}

function resolveTask(value) {
  if (!value) throw new Error('缺少 --task <任务目录或 task_id>');
  const candidate = isAbsolute(value) ? resolve(value) : join(TASKS_ROOT, value);
  if (!existsSync(join(candidate, 'manifest.json'))) {
    throw new Error(`不是有效任务：${candidate}`);
  }
  return candidate;
}

function workflowStates(manifest) {
  return Number(manifest?.schema_version) >= 4
    ? STATES.filter((state) => state !== 'interviewing')
    : STATES.filter((state) => !['content_diagnosis', 'co_writing'].includes(state));
}

function stateAtLeast(manifest, state) {
  const states = workflowStates(manifest);
  return states.indexOf(manifest.workflow_state) >= states.indexOf(state);
}

function nextAction(manifest) {
  const map = {
    idea: {actor: 'agent', action: '登记来源后进入内容诊断；不得直接产出完整文章。'},
    content_diagnosis: {actor: 'agent_and_user', action: '只问尚未明确的大方向，确定受众、核心冲突、产品/IP关系、形式与证据边界；用户确认方向后运行 approve-diagnosis。'},
    co_writing: {actor: 'agent_and_user', action: '先用已有材料给出文章骨架；只为关键经历、证据、立场或大方向提问。连续 2–4 个回答后必须输出提纲或段落草稿，材料充分后再整合文章并推进到 article_review。'},
    interviewing: {actor: 'agent_and_user', action: '旧任务兼容状态：一次只问一个问题补足事实后完成文章并推进到 article_review。'},
    article_review: {actor: 'user', action: '审阅完整文章；明确同意后运行 approve-article。'},
    article_approved: {actor: 'agent_and_user', action: '分别调用 dbs-xhs-title、dbs-hook、dbs-cover：标题、开头、封面各自输出、各自确认，不使用 A/B/C 套餐。'},
    hook_selected: {actor: 'agent', action: '在标题、开头和封面方向均单独确认后，生成竖版长视频文案和分镜，推进到 script_review。'},
    script_review: {actor: manifest.lane === 'thought' ? 'user' : 'agent_and_user', action: manifest.lane === 'thought'
      ? '审阅唯一一版竖版长视频文案；明确同意后运行 approve-script。'
      : '先调用 dbs-content-risk-check 并保存 05-视频文案/发布风险审查.md，再由用户审阅风险处置和唯一一版竖版长视频文案；明确同意后运行 approve-script。'},
    script_approved: {actor: 'automatic', action: '运行 run-monitored，在前台持续监工并完成配音、字幕、唯一一版正式长片和发布包。'},
    rendered: {actor: 'automatic', action: '生成并验证七平台发布包。'},
    package_ready: {actor: 'user', action: '人工发布；不得自动代发。'},
    published: {actor: 'agent_and_user', action: '在 24 小时节点导入真实数据。'},
    metrics_24h: {actor: 'agent_and_user', action: '在 7 天节点导入真实数据。'},
    metrics_7d: {actor: 'agent_and_user', action: '在 30 天节点导入真实数据。'},
    metrics_30d: {actor: 'agent_and_user', action: '复盘并由用户确认是否升级候选规律。'},
    reviewed: {actor: 'none', action: '任务已完成。'},
  };
  return map[manifest.workflow_state] || {
    actor: 'agent',
    action: `检查未知状态：${manifest.workflow_state}`,
  };
}

function doctor({quiet = false} = {}) {
  const checks = {
    profile_configured: PROFILE.configured,
    pipeline: existsSync(PIPELINE),
    tasks_root: existsSync(TASKS_ROOT),
    fixture: existsSync(FIXTURE_PATH),
    topic_selection_contract: existsSync(join(SKILL_DIR, 'references', 'topic-selection-contract.md')),
    remotion_engine: existsSync(join(REMOTION_DIR, 'render.mjs')),
    remotion_dependencies: existsSync(join(REMOTION_DIR, 'node_modules', 'remotion')),
    ffmpeg: commandExists('ffmpeg'),
    ffprobe: commandExists('ffprobe'),
  };
  const ttsChecks = {
    route: existsSync(TTS_ROUTE),
    python: Boolean(PROFILE.tts?.python && existsSync(PROFILE.tts.python)),
    pronunciation_lexicon: Boolean(
      PROFILE.tts?.pronunciation_lexicon && existsSync(PROFILE.tts.pronunciation_lexicon)
    ),
    alignment_script: Boolean(
      PROFILE.tts?.alignment_script && existsSync(PROFILE.tts.alignment_script)
    ),
  };
  if (ttsChecks.route) {
    const route = readJson(TTS_ROUTE).local_video || {};
    const reference = route.reference_wav;
    ttsChecks.provider = route.provider === 'indextts2-local';
    ttsChecks.voice = Boolean(route.voice_id);
    ttsChecks.speed = Number(route.default_delivery?.playback_speed) > 0;
    ttsChecks.precision = ['fp16', 'fp32'].includes(route.inference_precision);
    ttsChecks.gpu_guard = Number(route.minimum_free_gpu_mb) >= 1000;
    ttsChecks.reference = Boolean(reference && existsSync(reference));
    ttsChecks.hash = ttsChecks.reference
      && sha256(reference) === String(route.reference_sha256 || '').toUpperCase();
    ttsChecks.no_fallback = route.fallback_allowed !== true;
  }
  const preflight = checks.pipeline && ttsChecks.route
    ? runPipeline(['tts-preflight'], false)
    : {status: 1, stdout: '', stderr: 'TTS not configured'};
  ttsChecks.preflight = preflight.status === 0;
  const coreStatus = Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL';
  const videoReady = coreStatus === 'PASS' && Object.values(ttsChecks).every(Boolean);
  const report = {
    status: coreStatus,
    mode: videoReady ? 'FULL' : 'WRITING_ONLY',
    profile: profileSummary(PROFILE),
    content_root: CONTENT_ROOT,
    tasks_root: TASKS_ROOT,
    checks,
    tts_checks: ttsChecks,
    tts_preflight: preflight.stdout.trim() || preflight.stderr.trim(),
  };
  if (!quiet) console.log(JSON.stringify(report, null, 2));
  return report;
}

function showStatus(args) {
  const task = resolveTask(args.task);
  const manifest = readJson(join(task, 'manifest.json'));
  console.log(JSON.stringify({
    status: 'PASS',
    task,
    task_id: manifest.task_id,
    title: manifest.title,
    lane: manifest.lane,
    workflow_state: manifest.workflow_state,
    approvals: manifest.approvals,
    next_action: nextAction(manifest),
  }, null, 2));
}

function newTask(args) {
  for (const required of ['title', 'slug', 'lane', 'topic-origin']) {
    if (!args[required]) throw new Error(`缺少 --${required}`);
  }
  if (args['topic-origin'] === 'library_selected' && !args['topic-evidence']) {
    throw new Error('从思考库选题时，缺少 --topic-evidence <用户选中的候选来源>');
  }
  const forwarded = [
    'init',
    '--title', args.title,
    '--slug', args.slug,
    '--lane', args.lane,
    '--topic-origin', args['topic-origin'],
  ];
  if (args['topic-evidence']) forwarded.push('--topic-evidence', args['topic-evidence']);
  if (args.source) forwarded.push('--source', resolve(args.source));
  if (args['test-mode']) forwarded.push('--test-mode');
  const status = runPipeline(forwarded, true);
  if (status !== 0) process.exit(status);
}

function forwardTaskCommand(command, args, optionNames = []) {
  const task = resolveTask(args.task);
  const forwarded = [command, '--task', task];
  for (const name of optionNames) {
    if (args[name] !== undefined && args[name] !== false) {
      forwarded.push(`--${name}`);
      if (args[name] !== true) forwarded.push(String(args[name]));
    }
  }
  const status = runPipeline(forwarded, true);
  if (status !== 0) process.exit(status);
}

function transitionTask(args) {
  if (!args.to) throw new Error('缺少 --to <目标状态>');
  forwardTaskCommand('transition', args, ['to']);
}

function approveDiagnosis(args) {
  forwardTaskCommand('approve-diagnosis', args, ['actor']);
}

function reaffirmDiagnosis(args) {
  forwardTaskCommand('reaffirm-diagnosis', args, ['actor']);
}

function approveArticle(args) {
  forwardTaskCommand('approve-article', args, ['actor']);
}

function confirmVideoInputs(args) {
  forwardTaskCommand('confirm-video-inputs', args, ['actor']);
}

function approveScript(args) {
  const task = resolveTask(args.task);
  const manifest = readJson(join(task, 'manifest.json'));
  const riskReport = join(task, '05-视频文案', '发布风险审查.md');
  if (manifest.lane !== 'thought' && !existsSync(riskReport)) {
    console.log(JSON.stringify({
      status: 'WAITING_AGENT',
      gate: 'content_risk_review',
      required_skill: 'dbs-content-risk-check',
      required_artifact: riskReport,
      next_action: '调用 dbs-content-risk-check 审查视频文案，原样保存诊断并交给用户确认；不得直接改稿或进入配音。',
    }, null, 2));
    return;
  }
  forwardTaskCommand('approve-script', args, ['actor']);
}

function ensureCaseStructure(task) {
  const manifest = readJson(join(task, 'manifest.json'));
  const required = [
    'manifest.json',
    '00-选题与来源.md',
    '01-访谈原话.md',
    '02-文章主稿.md',
    '03-联动方案.md',
    '04-平台文章/platform-copy.json',
    '05-视频文案/main.md',
    '05-视频文案/storyboard.json',
  ];
  if (Number(manifest.schema_version) >= 4) required.push('00-内容诊断.md');
  if (manifest.lane !== 'thought') required.push('05-视频文案/发布风险审查.md');
  if (manifest.settings?.xhs_graphic_enabled === true) {
    required.push('04-平台文章/cards.json');
  }
  const missing = required.filter((item) => !existsSync(join(task, item)));
  return {required, missing};
}

function runSafe(args) {
  if (process.env.ARONG_MONITORED_RUN !== '1') {
    throw new Error('run-safe 只能由 run-monitored 的前台监工内部调用；请改用 run-monitored。');
  }
  const task = resolveTask(args.task);
  let manifest = readJson(join(task, 'manifest.json'));
  const needsDiagnosis = Number(manifest.schema_version) >= 4;
  if ((needsDiagnosis && !manifest.approvals?.diagnosis) || !manifest.approvals?.article || !manifest.approvals?.hook) {
    console.log(JSON.stringify({
      status: 'WAITING_USER',
      gate: needsDiagnosis && !manifest.approvals?.diagnosis
        ? 'diagnosis_approval'
        : !manifest.approvals?.article ? 'article_approval' : 'hook_selection',
      next_action: nextAction(manifest),
    }, null, 2));
    return;
  }

  const coverManifest = join(task, '06-媒体成品', 'cover-manifest.json');
  if (!existsSync(coverManifest)) {
    const status = runPipeline(['cover', '--task', task], true);
    if (status !== 0) process.exit(status);
  }
  const cardsNeeded = manifest.settings?.xhs_graphic_enabled === true;
  const firstCard = join(task, '06-媒体成品', 'card-01.jpg');
  if (cardsNeeded && !existsSync(firstCard)) {
    const status = runPipeline(['cards', '--task', task], true);
    if (status !== 0) process.exit(status);
  }

  manifest = readJson(join(task, 'manifest.json'));
  const riskReport = join(task, '05-视频文案', '发布风险审查.md');
  if (manifest.lane !== 'thought' && !existsSync(riskReport)) {
    console.log(JSON.stringify({
      status: 'WAITING_AGENT',
      gate: 'content_risk_review',
      required_skill: 'dbs-content-risk-check',
      required_artifact: riskReport,
      next_action: '调用 dbs-content-risk-check 审查视频文案，保存原始诊断并由用户确认后再继续。',
    }, null, 2));
    return;
  }
  if (!manifest.approvals?.script) {
    console.log(JSON.stringify({
      status: 'WAITING_USER',
      gate: 'script_approval',
      completed_automatically: ['cover', cardsNeeded ? 'cards' : null].filter(Boolean),
      next_action: nextAction(manifest),
    }, null, 2));
    return;
  }
  console.log('[arong-stage] tts-preflight');
  const preflight = runPipeline(['tts-preflight'], true);
  if (preflight !== 0) process.exit(preflight);
  console.log('[arong-stage] tts-contract');
  const contract = runPipeline(['tts-contract', '--task', task], true);
  if (contract !== 0) process.exit(contract);
  console.log('[arong-stage] tts-generate');
  const ttsArgs = ['tts-generate', '--task', task];
  if (args['dry-run']) ttsArgs.push('--dry-run');
  const tts = runPipeline(ttsArgs, true);
  if (tts !== 0 || args['dry-run']) process.exit(tts);
  console.log('[arong-stage] video-render');
  const render = runPipeline(['video-render', '--task', task], true);
  if (render !== 0) process.exit(render);
  console.log('[arong-stage] package');
  const packageStatus = runPipeline(['package', '--task', task], true);
  if (packageStatus !== 0) process.exit(packageStatus);
  console.log('[arong-stage] validate');
  const validate = runPipeline(['validate', '--task', task], true);
  if (validate !== 0) process.exit(validate);
  console.log('[arong-stage] completed');
}

function verifyCase(args) {
  const task = resolveTask(args.task);
  const manifest = readJson(join(task, 'manifest.json'));
  const structure = ensureCaseStructure(task);
  const validation = runPipeline(['validate', '--task', task], false);
  const health = doctor({quiet: true});
  const media = {};
  for (const name of FINAL_MEDIA) {
    media[name] = existsSync(join(task, '06-媒体成品', name));
  }
  const requiredPackage = [
    '00-发布总表.md',
    '01-微信公众号/发布信息.md',
    '01-微信公众号/正文.html',
    '02-知乎/发布信息.md',
    '02-知乎/正文.md',
    '04-小红书视频/发布信息.md',
    '05-抖音/发布信息.md',
    '06-视频号/发布信息.md',
    '07-哔哩哔哩/发布信息.md',
  ];
  if (manifest.settings?.xhs_graphic_enabled === true) {
    requiredPackage.push('03-小红书图文/发布信息.md');
  }
  const missingPackage = requiredPackage.filter(
    (name) => !existsSync(join(task, '07-发布包', name)),
  );
  const needsDiagnosis = Number(manifest.schema_version) >= 4;
  const waiting = needsDiagnosis && !manifest.approvals?.diagnosis
    ? 'diagnosis_approval'
    : !manifest.approvals?.article
      ? 'article_approval'
    : !manifest.approvals?.hook
      ? 'hook_selection'
      : !manifest.approvals?.script
        ? 'script_approval'
        : !stateAtLeast(manifest, 'rendered')
          ? 'automatic_render'
          : !Object.values(media).every(Boolean)
          ? 'missing_media'
          : !stateAtLeast(manifest, 'package_ready')
            ? 'automatic_package'
            : null;
  const failed = (
    structure.missing.length > 0
    || validation.status !== 0
    || health.status !== 'PASS'
    || waiting === 'missing_media'
    || (stateAtLeast(manifest, 'package_ready') && missingPackage.length > 0)
  );
  const waitingForUser = ['diagnosis_approval', 'article_approval', 'hook_selection', 'script_approval'].includes(waiting);
  const status = failed
    ? 'FAIL'
    : waitingForUser
      ? 'WAITING_USER'
      : waiting
        ? 'INCOMPLETE'
        : 'PASS';
  console.log(JSON.stringify({
    status,
    task,
    workflow_state: manifest.workflow_state,
    missing_structure: structure.missing,
    pipeline_validate: validation.status === 0,
    doctor: health.status,
    waiting_gate: waiting,
    media,
    missing_package: missingPackage,
    next_action: nextAction(manifest),
  }, null, 2));
  if (failed || status === 'INCOMPLETE') process.exit(1);
}

function auditSkill() {
  const requiredFiles = [
    'SKILL.md',
    'agents/openai.yaml',
    'references/topic-selection-contract.md',
    'references/workflow-contract.md',
    'references/permissions-and-evidence.md',
    'references/platform-contract.md',
    'references/visual-production-contract.md',
    'references/self-test-case.json',
    'scripts/engine.mjs',
  ];
  const missing = requiredFiles.filter((item) => !existsSync(join(SKILL_DIR, item)));
  const skill = existsSync(join(SKILL_DIR, 'SKILL.md'))
    ? readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8')
    : '';
  const ui = existsSync(join(SKILL_DIR, 'agents', 'openai.yaml'))
    ? readFileSync(join(SKILL_DIR, 'agents', 'openai.yaml'), 'utf8')
    : '';
  const workflow = existsSync(join(SKILL_DIR, 'references', 'workflow-contract.md'))
    ? readFileSync(join(SKILL_DIR, 'references', 'workflow-contract.md'), 'utf8')
    : '';
  const topicSelection = existsSync(join(SKILL_DIR, 'references', 'topic-selection-contract.md'))
    ? readFileSync(join(SKILL_DIR, 'references', 'topic-selection-contract.md'), 'utf8')
    : '';
  const platform = existsSync(join(SKILL_DIR, 'references', 'platform-contract.md'))
    ? readFileSync(join(SKILL_DIR, 'references', 'platform-contract.md'), 'utf8')
    : '';
  const visual = existsSync(join(SKILL_DIR, 'references', 'visual-production-contract.md'))
    ? readFileSync(join(SKILL_DIR, 'references', 'visual-production-contract.md'), 'utf8')
    : '';
  const pipeline = existsSync(PIPELINE) ? readFileSync(PIPELINE, 'utf8') : '';
  const remotionRootPath = join(REMOTION_DIR, 'src', 'Root.tsx');
  const remotionRoot = existsSync(remotionRootPath) ? readFileSync(remotionRootPath, 'utf8') : '';
  const rendererPath = join(REMOTION_DIR, 'render.mjs');
  const renderer = existsSync(rendererPath) ? readFileSync(rendererPath, 'utf8') : '';
  const ttsHelperPath = join(PIPELINE_DIR, 'scripts', 'generate_strict_indextts2.py');
  const ttsHelper = existsSync(ttsHelperPath) ? readFileSync(ttsHelperPath, 'utf8') : '';
  const auditedText = [skill, topicSelection, workflow, platform, visual].join('\n');
  const checks = {
    required_files: missing.length === 0,
    frontmatter_name: /^name:\s*arong-content-engine$/mu.test(skill),
    trigger_description: /^description:\s*.+/mu.test(skill) && !skill.includes('[TODO'),
    approval_gates: [
      '不得替用户选定、不得创建任务、不得开始写文章',
      '选题确认后，先建立 `00-内容诊断.md`，不直接交付完整文章',
      '用户明确确认内容方向后，进入共同写作',
      '当材料和段落逻辑都由用户确认后，才整合为完整文章并进入文章审阅',
      '用户选定后才生成视觉',
      '视频文案经用户批准后',
    ].every((text) => skill.includes(text)),
    manual_publish: skill.includes('不自动发布'),
    topic_selection_gate: (
      skill.includes('--topic-origin "<user_provided|library_selected>"')
      && topicSelection.includes('Before selection, do not run `new`')
      && topicSelection.includes('Return 3–7 candidates')
      && pipeline.includes('validateTopicSelection')
      && pipeline.includes("topic?.status !== 'selected'")
    ),
    personal_thought_library_routing: (
      topicSelection.includes('private source map')
      && topicSelection.includes('Search is read-only')
      && topicSelection.includes('[本人原话]')
    ),
    configurable_local_tts: (
      skill.includes('config/profile.local.json')
      && ttsHelper.includes('Local voice_id is required')
      && pipeline.includes('PROFILE.tts')
    ),
    text_first_cover: (
      skill.includes('暗背景大字')
      && visual.includes('标题而不是画面设为第一视觉主体')
      && visual.includes('手机信息流尺寸')
    ),
    motion_first_video: (
      skill.includes('Motion-first/Anti-PPT')
      && visual.includes('至少 80%')
      && visual.includes('同一版式连续出现三次')
      && workflow.includes('Anti-PPT')
    ),
    commercial_content_risk_gate: (
      skill.includes('必须调用 `dbs-content-risk-check`')
      && workflow.includes('05-视频文案/发布风险审查.md')
      && readFileSync(join(SKILL_DIR, 'scripts', 'engine.mjs'), 'utf8').includes("gate: 'content_risk_review'")
    ),
    monitored_long_run: (
      skill.includes('长任务前台监工协议')
      && existsSync(join(SKILL_DIR, 'scripts', 'supervise-run.mjs'))
      && readFileSync(join(SKILL_DIR, 'scripts', 'supervise-run.mjs'), 'utf8').includes('long-task.json')
    ),
    one_vertical_long_video: (
      skill.includes('唯一一版 9:16 竖版长视频')
      && workflow.includes('1080×1920、9:16')
      && platform.includes('不额外渲染横版主片或短切片')
      && FINAL_MEDIA.length === 1
      && FINAL_MEDIA[0] === 'main-9x16.mp4'
      && !remotionRoot.includes('ContentVideo16x9')
      && renderer.includes("args.composition !== 'ContentVideo9x16'")
    ),
    no_deprecated_video_derivatives: !/(?:main-16x9|short-0[1-3]|ContentVideo16x9|三个切片|横竖版视频)/u.test(auditedText),
    guarded_selftest_approval: (
      pipeline.includes("actor === 'automated_selftest'")
      && pipeline.includes('manifest.settings?.test_mode === true')
      && pipeline.includes('manifest.settings?.publishable === false')
    ),
    resumable_tts: (
      pipeline.includes('packNarrationSegments')
      && ttsHelper.includes('segment_cache_dir')
      && ttsHelper.includes('recover_concat_temp_segments')
      && ttsHelper.includes('GPU is busy')
    ),
    implicit_invocation: /allow_implicit_invocation:\s*true/u.test(ui),
    no_todo: !skill.includes('TODO'),
  };
  const status = missing.length === 0 && Object.values(checks).every(Boolean)
    ? 'PASS'
    : 'FAIL';
  console.log(JSON.stringify({status, missing, checks}, null, 2));
  if (status !== 'PASS') process.exit(1);
}

function probeVideo(path) {
  const result = run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'json',
    path,
  ]);
  if (result.status !== 0) return {ok: false, error: result.stderr.trim()};
  const stream = JSON.parse(result.stdout).streams?.[0] || {};
  return {ok: true, width: stream.width, height: stream.height};
}

function safeRemoveTemp(path) {
  const tempRoot = resolve(tmpdir());
  const target = resolve(path);
  if (dirname(target) !== tempRoot || !basename(target).startsWith('arong-content-engine-')) {
    throw new Error(`拒绝删除非本 Skill 临时目录：${target}`);
  }
  rmSync(target, {recursive: true, force: true});
}

function selfTest() {
  auditSkill();
  const health = doctor({quiet: true});
  if (health.status !== 'PASS') {
    console.error(JSON.stringify(health, null, 2));
    process.exit(1);
  }
  const fixture = readJson(FIXTURE_PATH);
  const topicGate = {
    missing_origin_rejected: runPipeline(['topic-preflight'], false).status !== 0,
    missing_library_evidence_rejected: runPipeline([
      'topic-preflight', '--topic-origin', 'library_selected',
    ], false).status !== 0,
    user_provided_accepted: runPipeline([
      'topic-preflight', '--topic-origin', 'user_provided',
    ], false).status === 0,
    library_selected_accepted: runPipeline([
      'topic-preflight', '--topic-origin', 'library_selected',
      '--topic-evidence', 'candidate-A|D:/source.md|2026-08-02',
    ], false).status === 0,
    automated_test_guarded: runPipeline([
      'topic-preflight', '--topic-origin', 'automated_selftest', '--test-mode',
    ], false).status === 0,
  };
  if (!Object.values(topicGate).every(Boolean)) {
    console.error(JSON.stringify({status: 'FAIL', stage: 'topic_selection_gate', topicGate}, null, 2));
    process.exit(1);
  }
  const temp = mkdtempSync(join(tmpdir(), 'arong-content-engine-'));
  try {
    const isolatedTasksRoot = join(temp, 'content-tasks');
    const topicTaskId = '20991231-topic-selection-selftest';
    const topicInit = run(process.execPath, [
      PIPELINE,
      'init',
      '--title', '选题选择持久化自检',
      '--slug', 'topic-selection-selftest',
      '--lane', 'thought',
      '--date', '20991231',
      '--topic-origin', 'automated_selftest',
      '--topic-evidence', 'built-in-self-test',
      '--test-mode',
    ], {
      cwd: PIPELINE_DIR,
      env: {ARONG_CONTENT_TASKS_ROOT: isolatedTasksRoot},
    });
    const topicManifestPath = join(isolatedTasksRoot, topicTaskId, 'manifest.json');
    const topicManifest = topicInit.status === 0 && existsSync(topicManifestPath)
      ? readJson(topicManifestPath)
      : null;
    const topicManifestPass = (
      topicManifest?.schema_version === 4
      && topicManifest?.workflow_state === 'content_diagnosis'
      && topicManifest?.topic_selection?.status === 'selected'
      && topicManifest?.topic_selection?.origin === 'automated_selftest'
      && topicManifest?.topic_selection?.selected_by === 'automated_selftest'
      && topicManifest?.topic_selection?.evidence === 'built-in-self-test'
      && topicManifest?.settings?.test_mode === true
      && topicManifest?.settings?.publishable === false
      && existsSync(join(isolatedTasksRoot, topicTaskId, '00-内容诊断.md'))
    );
    if (!topicManifestPass) {
      console.error(JSON.stringify({
        status: 'FAIL',
        stage: 'topic_selection_manifest',
        init_status: topicInit.status,
        stdout: topicInit.stdout,
        stderr: topicInit.stderr,
        manifest: topicManifest,
      }, null, 2));
      process.exit(1);
    }
    const renderConfig = resolve(SKILL_DIR, fixture.engine_fixture);
    const vertical = join(temp, 'case-9x16.mp4');
    const renderScript = join(REMOTION_DIR, 'render.mjs');
    const rendered = run(process.execPath, [
      renderScript,
      '--config', renderConfig,
      '--output', vertical,
      '--composition', 'ContentVideo9x16',
    ], {cwd: REMOTION_DIR, inherit: true});
    if (rendered !== 0) process.exit(rendered);
    const probes = {
      vertical: probeVideo(vertical),
    };
    const videoPass = (
      probes.vertical.ok
      && probes.vertical.width === 1080
      && probes.vertical.height === 1920
    );
    console.log(JSON.stringify({
      status: videoPass ? 'PASS' : 'FAIL',
      case_id: fixture.case_id,
      prompt: fixture.prompt,
      skill_audit: 'PASS',
      doctor: health.status,
      topic_selection_gate: 'PASS',
      topic_gate_checks: topicGate,
      topic_selection_manifest: 'PASS',
      tts_preflight: health.tts_checks?.preflight ? 'PASS' : 'FAIL',
      traditional_video_engine: videoPass ? 'PASS' : 'FAIL',
      probes,
      forbidden_behaviors_checked: fixture.forbidden,
    }, null, 2));
    if (!videoPass) process.exit(1);
  } finally {
    safeRemoveTemp(temp);
  }
}

function help() {
  console.log(`阿荣内容生产引擎

命令：
  doctor
  new --title <标题> --slug <英文slug> --lane <thought|project_sop> --topic-origin <user_provided|library_selected> [--topic-evidence <来源>] [--source <md>]
  status --task <任务目录或 task_id>
  transition --task <任务目录或 task_id> --to <相邻状态>
  approve-diagnosis --task <任务目录或 task_id> [--actor automated_selftest]
  reaffirm-diagnosis --task <任务目录或 task_id> [--actor automated_selftest]
  approve-article --task <任务目录或 task_id> [--actor automated_selftest]
  confirm-video-inputs --task <任务目录或 task_id> [--actor automated_selftest]
  approve-script --task <任务目录或 task_id> [--actor automated_selftest]
  run-safe --task <任务目录或 task_id> [--dry-run]  # 仅供监工内部调用
  run-monitored --task <任务目录或 task_id> [--heartbeat <秒>] [--dry-run]
  monitor-status --task <任务目录或 task_id>
  verify-case --task <任务目录或 task_id>
  audit-skill
  self-test
`);
}

const {command, args} = parseArgs(process.argv.slice(2));

try {
  switch (command) {
    case 'doctor': doctor(); break;
    case 'new': newTask(args); break;
    case 'status': showStatus(args); break;
    case 'transition': transitionTask(args); break;
    case 'approve-diagnosis': approveDiagnosis(args); break;
    case 'reaffirm-diagnosis': reaffirmDiagnosis(args); break;
    case 'approve-article': approveArticle(args); break;
    case 'confirm-video-inputs': confirmVideoInputs(args); break;
    case 'approve-script': approveScript(args); break;
    case 'run-safe': runSafe(args); break;
    case 'run-monitored': {
      const status = runSupervisor('run', args, true);
      if (status !== 0) process.exit(status);
      break;
    }
    case 'monitor-status': {
      const status = runSupervisor('status', args, true);
      if (status !== 0) process.exit(status);
      break;
    }
    case 'verify-case': verifyCase(args); break;
    case 'audit-skill': auditSkill(); break;
    case 'self-test': selfTest(); break;
    case 'help':
    case '--help':
    case '-h':
      help();
      break;
    default:
      throw new Error(`未知命令：${command}`);
  }
} catch (error) {
  console.error(`错误：${error.message}`);
  process.exit(1);
}
