#!/usr/bin/env node

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {basename, dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadProfile} from '../scripts/profile.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, '..');
const PROFILE = loadProfile();
const PROJECT_ROOT = PROFILE.content_root || SKILL_DIR;
const CREATOR_NAME = PROFILE.creator_name || '创作者';
const WECHAT_HTML_RENDERER = join(SKILL_DIR, 'scripts', 'wechat-html-render.mjs');
const TASKS_ROOT = resolve(
  process.env.ARONG_CONTENT_TASKS_ROOT
    || PROFILE.tasks_root
    || join(SKILL_DIR, 'content-tasks'),
);
const PLATFORMS = JSON.parse(readFileSync(join(HERE, 'platforms.json'), 'utf8'));
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
const REQUIRED_DIRS = [
  '04-平台文章',
  '05-视频文案',
  '06-媒体成品',
  '07-发布包',
  '08-数据复盘',
];
const REQUIRED_FILES = [
  'manifest.json',
  '00-选题与来源.md',
  '01-访谈原话.md',
  '02-文章主稿.md',
  '03-联动方案.md',
  'feishu.json',
];
const FINAL_MEDIA = [
  'main-9x16.mp4',
];
const FINAL_COVERS = Object.keys(PLATFORMS.unique_covers);
const VIDEO_JOBS = [
  {id: 'main', script: 'main.md', storyboard: 'storyboard.json'},
];
const CTA_PATTERNS = [
  /关注(我|公众号|账号)/u,
  /(点赞|收藏|转发|评论区)(一下|告诉我|见)/u,
  /(私信|加微信|扫码)(我|咨询|领取)/u,
  /(立即|马上)(购买|报名|下单)/u,
];

function now() {
  return new Date().toISOString();
}

function dateInShanghai() {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}${get('month')}${get('day')}`;
}

function parseArgs(argv) {
  const [command = 'help', ...rest] = argv;
  const args = {_: []};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = rest[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return {command, args};
}

function die(message, code = 1) {
  console.error(`错误：${message}`);
  process.exit(code);
}

function ensureDir(path) {
  mkdirSync(path, {recursive: true});
}

function writeText(path, text) {
  ensureDir(dirname(path));
  writeFileSync(path, text.replace(/\r\n/g, '\n'), 'utf8');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function resolveTask(args) {
  if (!args.task) die('缺少 --task <任务目录>');
  const task = resolve(args.task);
  if (!existsSync(join(task, 'manifest.json'))) die(`不是有效任务目录：${task}`);
  return task;
}

function loadManifest(task) {
  return readJson(join(task, 'manifest.json'));
}

function saveManifest(task, manifest) {
  manifest.updated_at = now();
  writeJson(join(task, 'manifest.json'), manifest);
}

function safeSlug(value) {
  const slug = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    die('slug 只能使用小写英文字母、数字和连字符，并以字母或数字开头');
  }
  return slug;
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

function hasIndependentVideoInputs(manifest) {
  return Boolean(
    manifest.approvals?.title?.id
    && manifest.approvals?.opening?.id
    && manifest.approvals?.cover?.id
    && manifest.selected_title?.text
    && manifest.selected_opening?.text
    && manifest.selected_cover?.short_title,
  );
}

function hasConfirmedVideoInputs(manifest) {
  return Boolean(manifest.approvals?.hook) || Boolean(manifest.approvals?.video_inputs);
}

function setState(task, manifest, target) {
  if (!STATES.includes(target)) die(`未知状态：${target}`);
  manifest.workflow_state = target;
  saveManifest(task, manifest);
}

function approvalActor(args, manifest) {
  const actor = String(args.actor || 'user');
  if (actor === 'user') return actor;
  const guardedSelfTest = (
    actor === 'automated_selftest'
    && manifest.settings?.test_mode === true
    && manifest.settings?.publishable === false
  );
  if (guardedSelfTest) return actor;
  die('非用户审批只允许用于 test_mode=true 且 publishable=false 的自动化自检任务');
}

function validateTopicSelection(args) {
  const origin = String(args['topic-origin'] || '').trim();
  const evidence = String(args['topic-evidence'] || '').trim();
  const testMode = args['test-mode'] === true;
  if (!['user_provided', 'library_selected', 'automated_selftest'].includes(origin)) {
    die('创建任务前必须使用 --topic-origin user_provided|library_selected；自动化自检只能用 automated_selftest');
  }
  if (origin === 'library_selected' && !evidence) {
    die('从思考库选题时，必须用 --topic-evidence 登记用户选中的候选来源');
  }
  if (origin === 'automated_selftest' && !testMode) {
    die('automated_selftest 选题来源只允许用于 --test-mode');
  }
  if (testMode && origin !== 'automated_selftest') {
    die('--test-mode 必须登记 --topic-origin automated_selftest');
  }
  return {
    status: 'selected',
    origin,
    evidence: evidence || 'current-user-message',
    selected_by: origin === 'automated_selftest' ? 'automated_selftest' : 'user',
    selected_at: now(),
  };
}

function topicPreflight(args) {
  const topicSelection = validateTopicSelection(args);
  console.log(JSON.stringify({status: 'PASS', topic_selection: topicSelection}, null, 2));
}

function createTask(args) {
  const title = String(args.title || '').trim();
  if (!title) die('缺少 --title');
  const slug = safeSlug(args.slug);
  const lane = args.lane;
  if (!['thought', 'project_sop'].includes(lane)) {
    die('--lane 只能是 thought 或 project_sop');
  }
  const topicSelection = validateTopicSelection(args);
  const date = String(args.date || dateInShanghai()).replaceAll('-', '');
  if (!/^\d{8}$/.test(date)) die('--date 必须为 YYYYMMDD 或 YYYY-MM-DD');
  const task = join(TASKS_ROOT, `${date}-${slug}`);
  if (existsSync(task)) die(`任务已存在：${task}`);

  ensureDir(task);
  for (const dir of REQUIRED_DIRS) ensureDir(join(task, dir));
  ensureDir(join(task, '08-数据复盘', '原始截图'));

  const manifest = {
    schema_version: 4,
    task_id: `${date}-${slug}`,
    title,
    slug,
    lane,
    workflow_state: 'content_diagnosis',
    created_at: now(),
    updated_at: now(),
    source: {
      local_markdown: '02-文章主稿.md',
      origin: args.source ? resolve(args.source) : null,
      provenance_labels: ['本人原话', '外部材料', 'AI整理', '待确认'],
    },
    topic_selection: topicSelection,
    approvals: {
      diagnosis: null,
      article: null,
      hook: null,
      script: null,
      publish: null,
    },
    selected_hook: null,
    settings: {
      xhs_graphic_enabled: lane === 'project_sop',
      wechat_style: 'minimal',
      creator_name: CREATOR_NAME,
      tts_voice_id: PROFILE.tts?.voice_id || 'local-voice',
      tts_playback_speed: Number(PROFILE.tts?.playback_speed || 1),
      tts_fallback_allowed: false,
      manual_publish_only: true,
      cta_allowed: false,
      test_mode: args['test-mode'] === true,
      publishable: args['test-mode'] === true ? false : true,
    },
    outputs: {
      diagnosis: '00-内容诊断.md',
      article: '02-文章主稿.md',
      linked_options: '03-联动方案.md',
      video_script: '05-视频文案/main.md',
      storyboard: '05-视频文案/storyboard.json',
      media_dir: '06-媒体成品',
      package_dir: '07-发布包',
      metrics_dir: '08-数据复盘',
    },
    migrations: [],
  };
  writeJson(join(task, 'manifest.json'), manifest);
  writeText(
    join(task, '00-选题与来源.md'),
    `# 选题与来源\n\n- 任务：${title}\n- 内容线：${lane === 'thought' ? '思想观点 / IP' : '项目案例 / SOP'}\n- 选题入口：${topicSelection.origin}\n- 用户选定证据：${topicSelection.evidence}\n- 原始来源：${manifest.source.origin || '待确认'}\n- 当前边界：本地 Markdown 是正文事实源；外部材料不得伪装为本人原话。\n\n## 来源登记\n\n- [待确认] 补充来源、日期、链接或本地路径。\n`,
  );
  writeText(
    join(task, '00-内容诊断.md'),
    `# 内容诊断：${title}\n\n> 这不是文章草稿。选题确认后，先通过一次一问把方向说清楚；用户明确确认前，不整篇代写。\n\n## 谁会看\n\n- [待确认]\n\n## 他正在面对的具体问题\n\n- [待确认]\n\n## 核心冲突或认知落差\n\n- [待确认]\n\n## 和 ${CREATOR_NAME} IP / 现有产品的真实关系\n\n- [待确认]\n\n## 推荐内容形式与主平台\n\n- [待确认]\n\n## 可用证据与表达边界\n\n- [待确认]\n\n## 方向确认\n\n- [待确认] 只有用户明确确认以上方向后，才能进入共同写作。\n`,
  );
  writeText(
    join(task, '01-访谈原话.md'),
    '# 访谈原话\n\n> 一次只问一个问题；本文件仅记录用户原话，不润色。\n\n- [本人原话] 待补充。\n',
  );
  if (args.source) {
    copyFileSync(resolve(args.source), join(task, '02-文章主稿.md'));
  } else {
    writeText(
      join(task, '02-文章主稿.md'),
      `# ${title}\n\n> [待确认] 文章尚未定稿。\n`,
    );
  }
  writeText(
    join(task, '03-联动方案.md'),
    `# 3 套文字联动方案\n\n> 只在这里讨论文字。选定后再生成封面与视频。\n\n## A\n\n- 核心标题方向：[待确认]\n- 前 5 秒视频开头：[待确认]\n- 封面短钩子：[待确认]\n- 封面构图：[待确认]\n- 公式来源：[待确认]\n\n## B\n\n- 核心标题方向：[待确认]\n- 前 5 秒视频开头：[待确认]\n- 封面短钩子：[待确认]\n- 封面构图：[待确认]\n- 公式来源：[待确认]\n\n## C\n\n- 核心标题方向：[待确认]\n- 前 5 秒视频开头：[待确认]\n- 封面短钩子：[待确认]\n- 封面构图：[待确认]\n- 公式来源：[待确认]\n`,
  );
  if (lane === 'project_sop') {
    writeJson(join(task, '04-平台文章', 'cards.json'), {
      schema_version: 1,
      cards: [
        {type: 'evidence', title: '[待确认]', asset: null, note: '[待确认]'},
        {type: 'data', title: '[待确认]', values: []},
        {type: 'checklist', title: '[待确认]', items: []},
        {type: 'process', title: '[待确认]', steps: []},
        {type: 'checklist', title: '[待确认]', items: []},
      ],
    });
  }
  writeJson(join(task, '04-平台文章', 'platform-copy.json'), {
    schema_version: 1,
    generated_from: '02-文章主稿.md + 03-联动方案.md',
    reviewed: false,
    bilibili_search_keyword: '[待确认]',
    titles: {
      wechat: '[待确认]',
      zhihu: '[待确认]',
      xiaohongshu_graphic: '[待确认]',
      xiaohongshu_video: '[待确认]',
      douyin: '[待确认]',
      channels: '[待确认]',
      bilibili: '[待确认]',
    },
    captions: {
      xiaohongshu_graphic: '[待确认]',
      xiaohongshu_video: '[待确认]',
      douyin: '[待确认]',
      channels: '[待确认]',
      bilibili: '[待确认]',
    },
    tags: [],
    cta: null,
  });
  writeText(
    join(task, '05-视频文案', 'main.md'),
    `# 主视频文案\n\n> [待确认] 文章批准、联动方案选定后再确认本稿。\n`,
  );
  for (const job of VIDEO_JOBS) {
    writeJson(join(task, '05-视频文案', job.storyboard), {
      schema_version: 2,
      job_id: job.id,
      motion_thesis: '[待确认：整条视频最重要的可见变化是什么]',
      rule: '只使用真实证据、图解、数据、流程、相关AI场景或有授权素材；不得用无关库存图填充。',
      scenes: [
        {
          start_ratio: 0,
          end_ratio: 1,
          type: 'diagram',
          text: '[待确认：本段核心视觉]',
          asset: null,
          source: null,
          motion_kind: '[待确认]',
          main_moving_object: '[待确认]',
          state_change: '[待确认]',
          camera_motion: '[待确认]',
          text_role: '[待确认]',
          asset_need: '[待确认]',
          ppt_risk: '[待确认]',
        },
      ],
    });
  }
  writeJson(join(task, 'feishu.json'), {
    schema_version: 1,
    url: null,
    document_id: null,
    remote_revision: null,
    last_pushed_sha256: null,
    last_fetched_at: null,
    local_source: '02-文章主稿.md',
  });
  writeText(join(task, '08-数据复盘', 'metrics.csv'), readFileSync(join(HERE, 'metrics-template.csv'), 'utf8'));
  writeText(
    join(task, '08-数据复盘', '复盘.md'),
    '# 数据复盘\n\n## 24 小时\n\n- [待确认]\n\n## 7 天\n\n- [待确认]\n\n## 30 天\n\n- [待确认]\n\n## 候选规律\n\n> 只有相同规律跨两个选题重复出现，并经用户确认，才可升级为全局规则。\n',
  );
  console.log(task);
}

function showStatus(args) {
  const task = resolveTask(args);
  const manifest = loadManifest(task);
  console.log(JSON.stringify({
    task: task,
    task_id: manifest.task_id,
    title: manifest.title,
    lane: manifest.lane,
    state: manifest.workflow_state,
    approvals: manifest.approvals,
    selected_hook: manifest.selected_hook,
  }, null, 2));
}

function transition(args) {
  const task = resolveTask(args);
  const manifest = loadManifest(task);
  const target = args.to;
  const states = workflowStates(manifest);
  if (!states.includes(target)) die(`未知状态：${target}`);
  const currentIndex = states.indexOf(manifest.workflow_state);
  const targetIndex = states.indexOf(target);
  if (targetIndex !== currentIndex + 1) {
    die(`只允许相邻推进：${manifest.workflow_state} → ${states[currentIndex + 1] || '已结束'}`);
  }
  if (target === 'article_approved' && !manifest.approvals.article) die('必须先运行 approve-article');
  if (target === 'co_writing' && !manifest.approvals.diagnosis) die('必须先运行 approve-diagnosis');
  if (target === 'hook_selected' && !hasConfirmedVideoInputs(manifest)) {
    die('必须先运行 select-hook，或用 confirm-video-inputs 确认分别选定的标题、开头和封面');
  }
  if (target === 'script_approved' && !manifest.approvals.script) die('必须先运行 approve-script');
  setState(task, manifest, target);
  console.log(`${manifest.task_id}: ${target}`);
}

function approveArticle(args) {
  const task = resolveTask(args);
  const manifest = loadManifest(task);
  if (!stateAtLeast(manifest, 'article_review')) {
    die(`当前状态为 ${manifest.workflow_state}，应先推进到 article_review`);
  }
  const article = readFileSync(join(task, '02-文章主稿.md'));
  manifest.approvals.article = {
    approved_at: now(),
    sha256: createHash('sha256').update(article).digest('hex'),
    by: approvalActor(args, manifest),
  };
  setState(task, manifest, 'article_approved');
  console.log('文章已锁定；后续修改会在 validate 中显示哈希不一致。');
}

function approveDiagnosis(args) {
  const task = resolveTask(args);
  const manifest = loadManifest(task);
  if (manifest.workflow_state !== 'content_diagnosis') {
    die(`当前状态为 ${manifest.workflow_state}，应先停留在 content_diagnosis 完成方向确认`);
  }
  const diagnosis = readFileSync(join(task, '00-内容诊断.md'));
  if (diagnosis.includes('[待确认]')) {
    die('内容诊断仍有待确认项；先通过一次一问把方向说清楚，再由用户确认');
  }
  manifest.approvals.diagnosis = {
    approved_at: now(),
    sha256: createHash('sha256').update(diagnosis).digest('hex'),
    by: approvalActor(args, manifest),
  };
  setState(task, manifest, 'co_writing');
  console.log('内容方向已锁定；现在进入共同写作，一次只问一个问题。');
}

function reaffirmDiagnosis(args) {
  const task = resolveTask(args);
  const manifest = loadManifest(task);
  if (!manifest.approvals?.diagnosis) die('内容诊断尚未有过用户确认记录');
  if (!stateAtLeast(manifest, 'co_writing')) die(`当前状态为 ${manifest.workflow_state}，尚未进入共同写作`);
  const diagnosis = readFileSync(join(task, '00-内容诊断.md'));
  if (diagnosis.includes('[待确认]')) die('内容诊断仍有待确认项，不能重新锁定');
  manifest.approvals.diagnosis = {
    approved_at: now(),
    sha256: createHash('sha256').update(diagnosis).digest('hex'),
    by: approvalActor(args, manifest),
    reaffirmed: true,
  };
  saveManifest(task, manifest);
  console.log('内容诊断已按既有用户确认重新锁定。');
}

function parseHookOption(markdown, id) {
  const block = markdown
    .split(/^##\s+/mu)
    .find((section) => section.match(new RegExp(`^${id}\\s*(?:\\r?\\n|$)`, 'u'))) || '';
  const field = (name) => block.match(new RegExp(`^-\\s*${name}：(.+)$`, 'mu'))?.[1]?.trim() || null;
  return {
    id,
    core_title: field('核心标题方向'),
    video_hook: field('前 5 秒视频开头'),
    cover_hook: field('封面短钩子'),
    cover_composition: field('封面构图'),
    formula_source: field('公式来源'),
  };
}

function selectHook(args) {
  const task = resolveTask(args);
  const id = String(args.id || '').toUpperCase();
  if (!['A', 'B', 'C'].includes(id)) die('--id 只能是 A、B 或 C');
  const manifest = loadManifest(task);
  if (!manifest.approvals.article) die('文章尚未批准');
  const markdown = readFileSync(join(task, '03-联动方案.md'), 'utf8');
  const selected = parseHookOption(markdown, id);
  if (!selected.cover_hook || selected.cover_hook.includes('待确认')) {
    die(`${id} 方案尚未填写完整`);
  }
  manifest.selected_hook = selected;
  manifest.approvals.hook = {approved_at: now(), by: approvalActor(args, manifest), id};
  setState(task, manifest, 'hook_selected');
  console.log(JSON.stringify(selected, null, 2));
}

function confirmVideoInputs(args) {
  const task = resolveTask(args);
  const manifest = loadManifest(task);
  if (!manifest.approvals.article) die('文章尚未批准');
  if (!hasIndependentVideoInputs(manifest)) {
    die('缺少独立确认的标题、开头或封面；不能用一个旧套餐编号替代它们');
  }
  const cover = manifest.approvals.cover;
  if (!['generated_pending_review', 'approved'].includes(String(cover.visual_status || ''))) {
    die('封面尚未生成或审阅');
  }
  const approvedAt = now();
  manifest.approvals.video_inputs = {
    approved_at: approvedAt,
    by: approvalActor(args, manifest),
    title_id: manifest.approvals.title.id,
    opening_id: manifest.approvals.opening.id,
    cover_id: cover.id,
  };
  manifest.approvals.cover = {...cover, visual_status: 'approved', approved_at: approvedAt};
  // 兼容旧渲染器：此对象只是聚合已独立确认的输入，不再代表 A/B/C 联动方案。
  manifest.selected_hook = {
    id: 'independent',
    core_title: manifest.selected_title.text,
    video_hook: manifest.selected_opening.text,
    cover_hook: manifest.selected_cover.short_title,
    cover_composition: null,
    formula_source: 'separate-title-opening-cover-confirmations',
  };
  manifest.approvals.hook = {
    approved_at: approvedAt,
    by: approvalActor(args, manifest),
    id: 'independent',
    compatibility_only: true,
  };
  if (manifest.workflow_state === 'article_approved') setState(task, manifest, 'hook_selected');
  if (manifest.workflow_state === 'hook_selected') setState(task, manifest, 'script_review');
  console.log('标题、开头、封面已按独立工序汇总确认；现在进入视频稿审阅。');
}

function approveScript(args) {
  const task = resolveTask(args);
  const manifest = loadManifest(task);
  if (!hasConfirmedVideoInputs(manifest)) die('尚未确认视频输入');
  if (manifest.workflow_state !== 'script_review') die(`当前状态为 ${manifest.workflow_state}，应先进入 script_review`);
  const files = [
    'main.md',
  ];
  const hashes = {};
  for (const name of files) {
    const path = join(task, '05-视频文案', name);
    if (!existsSync(path)) die(`缺少视频文案：${name}`);
    const text = readFileSync(path);
    if (text.toString('utf8').includes('[待确认]')) die(`${name} 仍含 [待确认]`);
    hashes[name] = createHash('sha256').update(text).digest('hex');
  }
  manifest.approvals.script = {approved_at: now(), by: approvalActor(args, manifest), hashes};
  setState(task, manifest, 'script_approved');
  console.log('竖版长视频文案已锁定，可直接正式渲染。');
}

function extractFirstParagraph(markdown) {
  const paragraphs = markdown
    .replace(/^---[\s\S]*?---\s*/u, '')
    .split(/\n\s*\n/u)
    .map((value) => value.replace(/^#+\s*/u, '').replace(/^>\s*/u, '').trim())
    .filter((value) => value && !value.startsWith('![') && !value.startsWith('- '));
  return paragraphs[1] || paragraphs[0] || '';
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/gu, '<strong>$1</strong>')
    .replace(/`(.+?)`/gu, '<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/gu, '<a href="$2" style="color:#635bff;text-decoration:none;">$1</a>');
}

function wechatStyle(styleId) {
  if (styleId === 'stripe') {
    return {
      body: 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:16px;line-height:1.78;color:#2a2f45;max-width:760px;margin:0 auto;padding:24px 22px;background-color:#fbfcff;',
      h1: 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:27px;line-height:1.32;font-weight:850;text-align:left;margin:36px 0 24px;color:#0a2540;',
      h2: 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:27px;line-height:1.35;font-weight:820;margin:42px 0 14px;color:#0a2540;padding:10px 12px;background-color:#f1f5ff;border-left:4px solid #635bff;',
      h3: 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:18px;line-height:1.5;font-weight:780;margin:30px 0 10px;color:#425466;',
      p: 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:16px;line-height:1.78;color:#2a2f45;margin:12px 0;',
      quote: 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:16px;line-height:1.78;margin:20px 0;padding:14px 16px;background-color:#fff;border:1px solid #d9e2f3;border-left:4px solid #635bff;color:#3c4257;font-style:normal;',
      li: 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:16px;line-height:1.76;color:#2a2f45;margin:8px 0;padding:9px 10px;background-color:#fff;border:1px solid #e5ebf5;',
      hr: 'border:none;border-top:1px solid #d9e2f3;margin:32px 0;',
    };
  }
  return {
    body: 'font-family:Georgia,"Times New Roman","Songti SC",SimSun,serif;font-size:16px;line-height:1.92;color:#242424;max-width:680px;margin:0 auto;padding:34px 24px;background-color:#fff;',
    h1: 'font-family:Georgia,"Times New Roman","Songti SC",SimSun,serif;font-size:28px;line-height:1.28;font-weight:700;text-align:left;margin:42px 0 28px;color:#111;',
    h2: 'font-family:Georgia,"Times New Roman","Songti SC",SimSun,serif;font-size:27px;line-height:1.35;font-weight:700;margin:52px 0 18px;color:#111;',
    h3: 'font-family:Georgia,"Times New Roman","Songti SC",SimSun,serif;font-size:18px;line-height:1.45;font-weight:700;margin:34px 0 12px;color:#333;',
    p: 'font-family:Georgia,"Times New Roman","Songti SC",SimSun,serif;font-size:16px;line-height:1.92;color:#242424;margin:15px 0;',
    quote: 'font-family:Georgia,"Times New Roman","Songti SC",SimSun,serif;font-size:17px;line-height:1.86;margin:28px 0;padding:0 0 0 22px;border-left:3px solid #242424;color:#444;font-style:italic;',
    li: 'font-family:Georgia,"Times New Roman","Songti SC",SimSun,serif;font-size:16px;line-height:1.9;color:#242424;margin:8px 0;',
    hr: 'border:none;border-top:1px solid #d8d8d8;margin:40px auto;width:34%;',
  };
}

function markdownToWechat(markdown, styleId) {
  const style = wechatStyle(styleId);
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out = [`<!doctype html><html><head><meta charset="utf-8"><title>微信公众号预览</title></head><body><main style="${style.body}">`];
  let list = null;
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const text = raw.trim();
    if (!text) {
      closeList();
      continue;
    }
    if (/^---+$/u.test(text)) {
      closeList();
      out.push(`<hr style="${style.hr}">`);
      continue;
    }
    const image = text.match(/^!\[(.*?)\]\((.*?)\)$/u);
    if (image) {
      closeList();
      const source = isAbsolute(image[2]) ? `file:///${image[2].replaceAll('\\', '/')}` : image[2];
      out.push(`<p style="${style.p}"><img src="${escapeHtml(source)}" alt="${escapeHtml(image[1])}" style="display:block;max-width:100%;height:auto;margin:22px auto;"></p>`);
      continue;
    }
    const heading = text.match(/^(#{1,3})\s+(.+)$/u);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level} style="${style[`h${level}`]}">${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const quote = text.match(/^>\s*(.+)$/u);
    if (quote) {
      closeList();
      out.push(`<blockquote style="${style.quote}">${inlineMarkdown(quote[1])}</blockquote>`);
      continue;
    }
    const item = text.match(/^[-*]\s+(.+)$/u);
    const ordered = text.match(/^\d+[.)]\s+(.+)$/u);
    if (item || ordered) {
      const desired = ordered ? 'ol' : 'ul';
      if (list !== desired) {
        closeList();
        list = desired;
        out.push(`<${list} style="margin:12px 0;padding-left:${ordered ? '24px' : '20px'};">`);
      }
      out.push(`<li style="${style.li}">${inlineMarkdown((item || ordered)[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p style="${style.p}">${inlineMarkdown(text)}</p>`);
  }
  closeList();
  out.push('</main></body></html>');
  return out.join('\n');
}

function defaultPlatformCopy(task, manifest, article) {
  const first = extractFirstParagraph(article).slice(0, 110);
  const title = manifest.selected_hook?.core_title || manifest.title;
  const xhsTitle = [...(manifest.selected_hook?.cover_hook || title)].slice(0, 20).join('');
  const tags = manifest.lane === 'thought'
    ? ['大学生', '职场', '个人成长']
    : ['副业复盘', '项目拆解', '真实经历'];
  return {
    schema_version: 1,
    generated_from: '02-文章主稿.md',
    reviewed: false,
    bilibili_search_keyword: null,
    titles: {
      wechat: title,
      zhihu: title,
      xiaohongshu_graphic: xhsTitle,
      xiaohongshu_video: xhsTitle,
      douyin: title,
      channels: title,
      bilibili: title,
    },
    captions: {
      xiaohongshu_graphic: first,
      xiaohongshu_video: first,
      douyin: first,
      channels: first,
      bilibili: first,
    },
    tags,
    cta: null,
  };
}

function writePlatformNote(path, title, caption, tags, media) {
  writeText(
    path,
    `# 发布信息\n\n- 标题：${title}\n- 媒体：${media || '无'}\n- 发布方式：当天人工发布\n\n## 正文\n\n${caption || ''}\n\n## 标签\n\n${tags.map((tag) => `#${tag}`).join(' ')}\n\n## CTA\n\n无\n`,
  );
}

function packageTask(args) {
  const task = resolveTask(args);
  const manifest = loadManifest(task);
  if (!manifest.approvals.article) die('文章尚未批准，不能打发布包');
  const articlePath = join(task, '02-文章主稿.md');
  const article = readFileSync(articlePath, 'utf8');
  const copyPath = join(task, '04-平台文章', 'platform-copy.json');
  const platformCopy = existsSync(copyPath) && !args['refresh-copy']
    ? readJson(copyPath)
    : defaultPlatformCopy(task, manifest, article);
  if (platformCopy.reviewed !== true) {
    die('platform-copy.json 尚未完成语义审查；先定稿各平台标题、简介和 B 站搜索关键词');
  }
  writeJson(copyPath, platformCopy);

  const packageDir = join(task, '07-发布包');
  ensureDir(packageDir);
  const longTitle = platformCopy.titles.wechat;
  if (platformCopy.titles.zhihu !== longTitle) {
    die('公众号与知乎必须共用同一个标题');
  }
  const xhsTitles = [
    platformCopy.titles.xiaohongshu_graphic,
    platformCopy.titles.xiaohongshu_video,
  ];
  for (const title of xhsTitles) {
    if ([...title].length > 20) die(`小红书标题超过 20 字：${title}`);
  }

  const wechatDir = join(packageDir, '01-微信公众号');
  ensureDir(wechatDir);
  if (!existsSync(WECHAT_HTML_RENDERER)) die(`缺少公众号 HTML 渲染器：${WECHAT_HTML_RENDERER}`);
  const wechatRender = spawnSync(
    process.execPath,
    [WECHAT_HTML_RENDERER, '--input', articlePath, '--output', wechatDir, '--style', manifest.settings.wechat_style || 'minimal', '--name', '正文.html'],
    {encoding: 'utf8'},
  );
  if (wechatRender.status !== 0) {
    die(`公众号 HTML 生成失败：${wechatRender.stderr || wechatRender.stdout || '未知错误'}`);
  }
  writeText(join(wechatDir, '正文.md'), article);
  writePlatformNote(
    join(wechatDir, '发布信息.md'),
    longTitle,
    '正文见同目录 HTML；复制到公众号后台后人工检查图片与段落。',
    platformCopy.tags,
    '../../06-媒体成品/wechat-header.jpg + wechat-share.jpg',
  );

  const zhihuDir = join(packageDir, '02-知乎');
  ensureDir(zhihuDir);
  writeText(join(zhihuDir, '正文.md'), article);
  writePlatformNote(
    join(zhihuDir, '发布信息.md'),
    longTitle,
    '正文与公众号完全相同，仅平台格式不同。',
    platformCopy.tags,
    '../../06-媒体成品/cover-16x9.jpg',
  );

  const xhsGraphicDir = join(packageDir, '03-小红书图文');
  ensureDir(xhsGraphicDir);
  if (manifest.settings.xhs_graphic_enabled) {
    writePlatformNote(
      join(xhsGraphicDir, '发布信息.md'),
      platformCopy.titles.xiaohongshu_graphic,
      platformCopy.captions.xiaohongshu_graphic,
      platformCopy.tags,
      '../../06-媒体成品/cover-3x4.jpg + card-01..06.jpg',
    );
  } else {
    writeText(
      join(xhsGraphicDir, '未启用.md'),
      '# 本题不发小红书图文\n\n思想观点默认只发视频；只有内容天然具备框架、对比或清单时才开启图文。\n',
    );
  }

  const videoPlatforms = [
    ['04-小红书视频', 'xiaohongshu_video', '../../06-媒体成品/main-9x16.mp4（第一帧为封面）'],
    ['05-抖音', 'douyin', '../../06-媒体成品/main-9x16.mp4'],
    ['06-视频号', 'channels', '../../06-媒体成品/main-9x16.mp4'],
    ['07-哔哩哔哩', 'bilibili', '../../06-媒体成品/main-9x16.mp4'],
  ];
  for (const [folder, id, media] of videoPlatforms) {
    const dir = join(packageDir, folder);
    ensureDir(dir);
    writePlatformNote(
      join(dir, '发布信息.md'),
      platformCopy.titles[id],
      platformCopy.captions[id],
      platformCopy.tags,
      media,
    );
  }
  writeText(
    join(packageDir, '00-发布总表.md'),
    `# 七平台发布总表\n\n- 发布时间：同一天，人工发布\n- 公众号 / 知乎：同标题、同开头、同正文\n- 小红书：图文与视频是两篇独立笔记\n- 所有视频平台共用唯一一份无水印 9:16 竖版长视频\n- B 站沿用同一竖版视频，并使用搜索型标题\n- CTA：无\n\n## 共享媒体\n\n${FINAL_MEDIA.map((name) => `- ../06-媒体成品/${name}`).join('\n')}\n\n## 唯一静态封面\n\n${FINAL_COVERS.map((name) => `- ../06-媒体成品/${name}`).join('\n')}\n`,
  );

  if (stateAtLeast(manifest, 'rendered')) {
    setState(task, manifest, 'package_ready');
  } else {
    saveManifest(task, manifest);
  }
  console.log(packageDir);
}

function probeMedia(path) {
  const result = spawnSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,codec_name,width,height,sample_rate,channels:format=duration',
    '-of', 'json',
    path,
  ], {encoding: 'utf8'});
  if (result.status !== 0) return {ok: false, error: result.stderr.trim()};
  const parsed = JSON.parse(result.stdout);
  const streams = parsed.streams || [];
  const video = streams.find((stream) => stream.codec_type === 'video') || null;
  const audio = streams.find((stream) => stream.codec_type === 'audio') || null;
  const primary = video || audio || {};
  return {
    ok: true,
    has_video: Boolean(video),
    has_audio: Boolean(audio),
    width: video?.width ?? null,
    height: video?.height ?? null,
    codec_name: primary.codec_name ?? null,
    video_codec: video?.codec_name ?? null,
    audio_codec: audio?.codec_name ?? null,
    sample_rate: audio?.sample_rate ? Number(audio.sample_rate) : null,
    channels: audio?.channels ?? null,
    duration: parsed.format?.duration ? Number(parsed.format.duration) : null,
  };
}

function collectFiles(root) {
  if (!existsSync(root)) return [];
  const out = [];
  for (const entry of readdirSync(root, {withFileTypes: true})) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(path));
    else out.push(path);
  }
  return out;
}

function validateTask(args) {
  const task = resolveTask(args);
  const manifest = loadManifest(task);
  const errors = [];
  const warnings = [];
  for (const dir of REQUIRED_DIRS) {
    if (!existsSync(join(task, dir))) errors.push(`缺少目录：${dir}`);
  }
  for (const file of REQUIRED_FILES) {
    if (!existsSync(join(task, file))) errors.push(`缺少文件：${file}`);
  }
  if (!workflowStates(manifest).includes(manifest.workflow_state)) {
    errors.push(`当前任务版本不允许该状态：${manifest.workflow_state}`);
  }
  if (Number(manifest.schema_version) >= 3) {
    const topic = manifest.topic_selection;
    if (topic?.status !== 'selected') errors.push('选题尚未由用户选定');
    if (!['user_provided', 'library_selected', 'automated_selftest'].includes(topic?.origin)) {
      errors.push('选题入口无效');
    }
    if (topic?.origin === 'library_selected' && !String(topic?.evidence || '').trim()) {
      errors.push('思考库选题缺少用户选中候选的来源证据');
    }
    if (topic?.selected_by !== 'user' && topic?.origin !== 'automated_selftest') {
      errors.push('正式选题没有登记为用户选择');
    }
    if (topic?.origin === 'automated_selftest' && manifest.settings?.test_mode !== true) {
      errors.push('正式任务不得使用自动化选题');
    }
  }
  if (Number(manifest.schema_version) >= 4 && stateAtLeast(manifest, 'co_writing')) {
    if (!manifest.approvals?.diagnosis) errors.push('状态已过 co_writing，但没有内容诊断确认记录');
    else {
      const diagnosisPath = join(task, '00-内容诊断.md');
      const actual = existsSync(diagnosisPath)
        ? createHash('sha256').update(readFileSync(diagnosisPath)).digest('hex')
        : null;
      if (actual !== manifest.approvals.diagnosis.sha256) {
        errors.push('内容诊断在确认后发生了修改，必须重新确认方向');
      }
    }
  }
  if (stateAtLeast(manifest, 'article_approved')) {
    if (!manifest.approvals.article) errors.push('状态已过 article_approved，但没有文章审批记录');
    else {
      const actual = createHash('sha256').update(readFileSync(join(task, '02-文章主稿.md'))).digest('hex');
      if (actual !== manifest.approvals.article.sha256) errors.push('文章在批准后发生了修改，必须重新批准');
    }
  }
  if (stateAtLeast(manifest, 'hook_selected') && !hasConfirmedVideoInputs(manifest)) {
    errors.push('状态已过 hook_selected，但没有标题、开头、封面的确认记录');
  }
  if (stateAtLeast(manifest, 'script_review')) {
    const allowedSceneTypes = new Set([
      'evidence',
      'diagram',
      'data',
      'process',
      'ai_scene',
      'licensed_external',
    ]);
    for (const job of VIDEO_JOBS) {
      const storyboardPath = join(task, '05-视频文案', job.storyboard);
      if (!existsSync(storyboardPath)) {
        errors.push(`缺少分镜：${job.storyboard}`);
        continue;
      }
      const storyboard = readJson(storyboardPath);
      if (!Array.isArray(storyboard.scenes) || !storyboard.scenes.length) {
        errors.push(`${job.storyboard} 没有分镜`);
        continue;
      }
      let previousEnd = 0;
      let visibleStateChanges = 0;
      let repeatedMotionKinds = 1;
      let previousMotionKind = null;
      const motionFirst = Number(storyboard.schema_version) >= 2;
      if (motionFirst && (!String(storyboard.motion_thesis || '').trim() || String(storyboard.motion_thesis).includes('[待确认]'))) {
        errors.push(`${job.storyboard} 缺少整条视频的运动命题`);
      }
      for (const [index, scene] of storyboard.scenes.entries()) {
        const start = Number(scene.start_ratio);
        const end = Number(scene.end_ratio);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 1 || end <= start) {
          errors.push(`${job.storyboard} 第 ${index + 1} 段比例无效`);
        }
        if (Math.abs(start - previousEnd) > 0.001) {
          errors.push(`${job.storyboard} 第 ${index + 1} 段与上一段存在空档或重叠`);
        }
        if (!allowedSceneTypes.has(scene.type)) {
          errors.push(`${job.storyboard} 第 ${index + 1} 段类型无效：${scene.type}`);
        }
        if (!String(scene.text || '').trim() || String(scene.text).includes('[待确认]')) {
          errors.push(`${job.storyboard} 第 ${index + 1} 段文案未完成`);
        }
        if (scene.asset) {
          const asset = isAbsolute(scene.asset) ? scene.asset : resolve(task, scene.asset);
          if (!existsSync(asset)) errors.push(`${job.storyboard} 素材不存在：${scene.asset}`);
        }
        if (scene.type === 'licensed_external' && !scene.source) {
          errors.push(`${job.storyboard} 外部授权素材缺少来源`);
        }
        if (motionFirst) {
          const requiredMotionFields = [
            'motion_kind',
            'main_moving_object',
            'state_change',
            'camera_motion',
            'text_role',
            'asset_need',
            'ppt_risk',
          ];
          for (const field of requiredMotionFields) {
            if (!String(scene[field] || '').trim() || String(scene[field]).includes('[待确认]')) {
              errors.push(`${job.storyboard} 第 ${index + 1} 段缺少 ${field}`);
            }
          }
          if (String(scene.state_change || '').trim() && !String(scene.state_change).includes('[待确认]')) {
            visibleStateChanges += 1;
          }
          if (scene.type === 'ai_scene' && !scene.asset) {
            errors.push(`${job.storyboard} 第 ${index + 1} 段是无素材 ai_scene，属于 Anti-PPT 硬失败`);
          }
          if (scene.motion_kind === previousMotionKind) repeatedMotionKinds += 1;
          else repeatedMotionKinds = 1;
          if (repeatedMotionKinds >= 3) {
            errors.push(`${job.storyboard} 第 ${index + 1} 段连续三次重复 ${scene.motion_kind}，需更换视觉语法`);
          }
          previousMotionKind = scene.motion_kind;
          if (end - start > 0.075 && !String(scene.secondary_state_change || '').trim()) {
            errors.push(`${job.storyboard} 第 ${index + 1} 段时长占比较高但没有 secondary_state_change`);
          }
        }
        previousEnd = end;
      }
      if (Math.abs(previousEnd - 1) > 0.001) errors.push(`${job.storyboard} 没有覆盖完整时长`);
      if (motionFirst && visibleStateChanges / storyboard.scenes.length < 0.8) {
        errors.push(`${job.storyboard} 可见状态变化覆盖率低于 80%`);
      }
    }
  }
  if (stateAtLeast(manifest, 'script_approved')) {
    if (!manifest.approvals.script) errors.push('状态已过 script_approved，但没有视频文案审批记录');
    else {
      for (const [name, expected] of Object.entries(manifest.approvals.script.hashes || {})) {
        const path = join(task, '05-视频文案', name);
        const actual = existsSync(path)
          ? createHash('sha256').update(readFileSync(path)).digest('hex')
          : null;
        if (actual !== expected) errors.push(`视频文案批准后发生修改：${name}`);
      }
    }
  }
  const platformCopyPath = join(task, '04-平台文章', 'platform-copy.json');
  if (stateAtLeast(manifest, 'script_approved') && !existsSync(platformCopyPath)) {
    errors.push('缺少 04-平台文章/platform-copy.json');
  } else if (stateAtLeast(manifest, 'script_approved') && existsSync(platformCopyPath)) {
    const platformCopy = readJson(platformCopyPath);
    if (platformCopy.reviewed !== true) errors.push('platform-copy.json 尚未完成人工/Agent 语义审查');
    if (platformCopy.titles?.wechat !== platformCopy.titles?.zhihu) {
      errors.push('公众号与知乎标题不一致');
    }
    const requiredTitleKeys = [
      'wechat', 'zhihu', 'xiaohongshu_graphic', 'xiaohongshu_video',
      'douyin', 'channels', 'bilibili',
    ];
    for (const key of requiredTitleKeys) {
      if (!String(platformCopy.titles?.[key] || '').trim()) errors.push(`${key} 缺少平台标题`);
    }
    const requiredCaptionKeys = [
      'xiaohongshu_graphic', 'xiaohongshu_video', 'douyin', 'channels', 'bilibili',
    ];
    for (const key of requiredCaptionKeys) {
      if (!String(platformCopy.captions?.[key] || '').trim()) errors.push(`${key} 缺少平台正文/简介`);
    }
    const searchKeyword = String(platformCopy.bilibili_search_keyword || '').trim();
    if (!searchKeyword) errors.push('B 站缺少 bilibili_search_keyword');
    else if (!String(platformCopy.titles?.bilibili || '').includes(searchKeyword)) {
      errors.push('B 站标题未包含已登记的搜索关键词');
    }
    for (const key of ['xiaohongshu_graphic', 'xiaohongshu_video']) {
      const title = platformCopy.titles?.[key] || '';
      if ([...title].length > 20) errors.push(`${key} 标题超过 20 字`);
    }
  }

  for (const path of collectFiles(join(task, '07-发布包'))) {
    if (!/\.(md|html|txt)$/iu.test(path)) continue;
    const text = readFileSync(path, 'utf8');
    for (const pattern of CTA_PATTERNS) {
      if (pattern.test(text)) errors.push(`检测到 CTA：${relative(task, path)} / ${pattern}`);
    }
  }

  for (const name of FINAL_COVERS) {
    const path = join(task, '06-媒体成品', name);
    if (!existsSync(path)) {
      if (stateAtLeast(manifest, 'hook_selected')) warnings.push(`尚未生成封面：${name}`);
      continue;
    }
    const probe = probeMedia(path);
    const expected = PLATFORMS.unique_covers[name];
    if (!probe.ok) errors.push(`封面无法解码：${name}`);
    else if (probe.width !== expected.width || probe.height !== expected.height) {
      errors.push(`封面尺寸错误：${name} ${probe.width}x${probe.height}，应为 ${expected.width}x${expected.height}`);
    }
  }
  if (manifest.settings?.xhs_graphic_enabled) {
    const cardContractPath = join(task, '04-平台文章', 'cards.json');
    if (!existsSync(cardContractPath)) {
      errors.push('项目/SOP 任务缺少 04-平台文章/cards.json');
    } else {
      const cardContract = readJson(cardContractPath);
      const cardSpecs = cardContract.cards;
      if (!Array.isArray(cardSpecs) || cardSpecs.length < 4 || cardSpecs.length > 6) {
        errors.push('cards.json 必须包含 4–6 张卡片');
      } else if (JSON.stringify(cardSpecs).includes('[待确认]')) {
        errors.push('cards.json 仍含 [待确认]');
      }
    }
    const cards = collectFiles(join(task, '06-媒体成品'))
      .filter((path) => /^card-\d{2}\.jpg$/iu.test(basename(path)));
    if (cards.length < 4 || cards.length > 6) {
      errors.push(`小红书图文必须有 4–6 张内容卡片，当前 ${cards.length} 张`);
    }
    for (const card of cards) {
      const probe = probeMedia(card);
      if (!probe.ok || probe.width !== 1080 || probe.height !== 1440) {
        errors.push(`内容卡片尺寸错误：${basename(card)}`);
      }
    }
  }

  if (stateAtLeast(manifest, 'rendered')) {
    const unexpectedVideos = collectFiles(join(task, '06-媒体成品'))
      .filter((path) => /\.mp4$/iu.test(path))
      .filter((path) => basename(path) !== 'main-9x16.mp4')
      .map((path) => relative(task, path));
    if (unexpectedVideos.length) {
      errors.push(`检测到多余视频成品：${unexpectedVideos.join(', ')}`);
    }
    for (const name of FINAL_MEDIA) {
      const path = join(task, '06-媒体成品', name);
      if (!existsSync(path)) {
        errors.push(`缺少正式视频：${name}`);
        continue;
      }
      const probe = probeMedia(path);
      if (!probe.ok || !probe.duration || !probe.has_video) errors.push(`视频无法解码：${name}`);
      if (probe.width !== 1080 || probe.height !== 1920) {
        errors.push(`竖版长视频尺寸错误：${name} ${probe.width}x${probe.height}，应为 1080x1920`);
      }
      if (!probe.has_audio) errors.push(`竖版长视频缺少声音：${name}`);
      if (probe.duration < 180 || probe.duration > 330) {
        errors.push(`竖版长视频时长错误：${name} ${probe.duration?.toFixed(2)} 秒，应为 180–330 秒`);
      }
    }
    const voiceManifest = join(task, '06-媒体成品', 'voice_manifest.json');
    if (!existsSync(voiceManifest)) errors.push('缺少 voice_manifest.json');
    else {
      const voice = readJson(voiceManifest);
      if (!['IndexTTS2', 'indextts2-local'].includes(voice.provider)) errors.push('配音提供方不是 IndexTTS2');
      if (voice.voice_id !== manifest.settings.tts_voice_id) errors.push('配音音色与本任务锁定的音色不一致');
      if (voice.used_fallback !== false) errors.push('配音发生了 fallback');
      if (Number(voice.playback_speed) !== Number(manifest.settings.tts_playback_speed)) errors.push('配音倍速与本任务锁定值不一致');
      if (!['fp16', 'fp32'].includes(voice.inference_precision)) errors.push('配音未登记推理精度');
      const mainVoiceJob = voice.jobs?.main;
      if (!mainVoiceJob || mainVoiceJob.pronunciation_contract?.validated !== true) {
        errors.push('配音未登记已验证的发音契约');
      }
      if (!Number.isInteger(mainVoiceJob?.segment_count) || mainVoiceJob.segment_count < 1) {
        errors.push('配音未登记有效的分段契约');
      }
    }
    const captionQc = join(task, '06-媒体成品', 'caption-qc.json');
    if (!existsSync(captionQc)) errors.push('缺少 caption-qc.json');
    else if (readJson(captionQc).status !== 'PASS') errors.push('caption-qc 未通过');
  }
  if (manifest.settings?.manual_publish_only !== true) errors.push('发布模式不是人工发布');
  if (manifest.settings?.tts_fallback_allowed !== false) errors.push('TTS fallback 未被关闭');

  const report = {
    task: manifest.task_id,
    state: manifest.workflow_state,
    status: errors.length ? 'FAIL' : 'PASS',
    errors,
    warnings,
  };
  writeJson(join(task, 'validation-report.json'), report);
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exitCode = 2;
}

function runCover(args) {
  const task = resolveTask(args);
  const manifest = loadManifest(task);
  if (!hasConfirmedVideoInputs(manifest)) die('未确认标题、开头、封面，不能生成封面');
  const selectedSuite = String(manifest.selected_cover?.suite || '').trim();
  if (selectedSuite) {
    const sourceRoot = resolve(task, selectedSuite, 'outputs');
    const mediaDir = join(task, '06-媒体成品');
    const mappings = [
      ['xiaohongshu-3x4.png', 'cover-3x4.jpg'],
      ['bilibili-16x9.png', 'cover-16x9.jpg'],
      ['wechat-header-2.35x1.png', 'wechat-header.jpg'],
      ['wechat-share-1x1.png', 'wechat-share.jpg'],
    ];
    for (const [sourceName, targetName] of mappings) {
      const source = join(sourceRoot, sourceName);
      if (!existsSync(source)) die(`已选封面套图缺少：${source}`);
      copyFileSync(source, join(mediaDir, targetName));
    }
    writeJson(join(mediaDir, 'cover-manifest.json'), {
      schema_version: 1,
      source: 'dbs-cover-selected-suite',
      suite: selectedSuite.replaceAll('\\', '/'),
      selected_cover_id: manifest.selected_cover.id,
      outputs: Object.fromEntries(mappings.map(([sourceName, targetName]) => [targetName, sourceName])),
    });
    console.log('已复用用户选定的 dbs-cover 封面套图；未生成替代封面。');
    return;
  }
  const pythonCandidates = [
    PROFILE.tts?.python,
    join(PROJECT_ROOT, '.venv-tts', 'Scripts', 'python.exe'),
    'python',
  ].filter(Boolean);
  const python = pythonCandidates.find((path) => path === 'python' || existsSync(path));
  const result = spawnSync(python, [join(HERE, 'cover_generator.py'), '--task', task], {
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.status !== 0) die('封面生成失败');
}

function runCards(args) {
  const task = resolveTask(args);
  const manifest = loadManifest(task);
  if (!manifest.settings?.xhs_graphic_enabled) die('本任务未启用小红书图文卡片');
  const cardContractPath = join(task, '04-平台文章', 'cards.json');
  if (!existsSync(cardContractPath)) die('缺少 04-平台文章/cards.json，先生成 4–6 张卡片的文字与视觉契约');
  const cardContract = readJson(cardContractPath);
  if (
    !Array.isArray(cardContract.cards)
    || cardContract.cards.length < 4
    || cardContract.cards.length > 6
    || JSON.stringify(cardContract.cards).includes('[待确认]')
  ) {
    die('cards.json 必须包含 4–6 张已定稿卡片，且不能含 [待确认]');
  }
  const pythonCandidates = [
    PROFILE.tts?.python,
    join(PROJECT_ROOT, '.venv-tts', 'Scripts', 'python.exe'),
    'python',
  ].filter(Boolean);
  const python = pythonCandidates.find((path) => path === 'python' || existsSync(path));
  const result = spawnSync(
    python,
    [join(HERE, 'cover_generator.py'), '--task', task, '--cards-only'],
    {encoding: 'utf8', stdio: 'inherit'},
  );
  if (result.status !== 0) die('图文卡片生成失败');
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const string = String(value);
  return /[",\n]/u.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

function metricsImport(args) {
  const task = resolveTask(args);
  if (!args.input) die('缺少 --input <结构化数据.json>');
  const manifest = loadManifest(task);
  const input = readJson(resolve(args.input));
  const records = Array.isArray(input) ? input : input.records;
  if (!Array.isArray(records) || !records.length) die('输入必须包含 records 数组');
  const allowedWindows = ['24h', '7d', '30d'];
  const headers = readFileSync(join(HERE, 'metrics-template.csv'), 'utf8').trim().split(',');
  const rawDir = join(task, '08-数据复盘', '原始截图');
  const recordsPath = join(task, '08-数据复盘', 'metrics-records.json');
  const stored = existsSync(recordsPath) ? readJson(recordsPath) : [];
  const allRecords = Array.isArray(stored) ? stored : [];
  ensureDir(rawDir);
  let furthest = manifest.workflow_state;
  for (const record of records) {
    if (!PLATFORMS.platforms[record.platform]) die(`未知平台：${record.platform}`);
    if (!allowedWindows.includes(record.window)) die(`未知复盘窗口：${record.window}`);
    let screenshot = null;
    const screenshotValue = record.source_screenshot || record.raw_screenshot;
    if (screenshotValue) {
      const source = resolve(screenshotValue);
      if (!existsSync(source)) die(`截图不存在：${source}`);
      const dest = join(rawDir, basename(source));
      if (resolve(source) !== resolve(dest)) copyFileSync(source, dest);
      screenshot = relative(task, dest).replaceAll('\\', '/');
    }
    const normalized = {
      task_id: manifest.task_id,
      platform: record.platform,
      window: record.window,
      captured_at: record.captured_at || now(),
      source_screenshot: screenshot,
      exposure: record.exposure ?? null,
      reads: record.reads ?? null,
      plays: record.plays ?? null,
      completion_rate: record.completion_rate ?? null,
      average_watch_seconds: record.average_watch_seconds ?? null,
      likes: record.likes ?? null,
      comments: record.comments ?? null,
      saves: record.saves ?? null,
      shares: record.shares ?? null,
      follower_delta: record.follower_delta ?? null,
      notes: record.notes ?? record.note ?? null,
    };
    const existingIndex = allRecords.findIndex((item) => (
      item.platform === normalized.platform
      && item.window === normalized.window
      && item.captured_at === normalized.captured_at
    ));
    if (existingIndex >= 0) allRecords[existingIndex] = normalized;
    else allRecords.push(normalized);
    const state = `metrics_${record.window}`;
    if (STATES.indexOf(state) > STATES.indexOf(furthest)) furthest = state;
  }
  allRecords.sort((a, b) => (
    String(a.captured_at).localeCompare(String(b.captured_at))
    || String(a.platform).localeCompare(String(b.platform))
  ));
  const out = [
    headers.join(','),
    ...allRecords.map((record) => headers.map((header) => csvEscape(record[header])).join(',')),
  ];
  writeJson(recordsPath, allRecords);
  writeText(join(task, '08-数据复盘', 'metrics.csv'), `${out.join('\n')}\n`);
  if (stateAtLeast(manifest, 'published') && STATES.includes(furthest)) {
    setState(task, manifest, furthest);
  } else {
    saveManifest(task, manifest);
  }
  console.log(`已导入 ${records.length} 条；缺失字段保持为空（null）。`);
}

function review(args) {
  const task = resolveTask(args);
  const manifest = loadManifest(task);
  const csvPath = join(task, '08-数据复盘', 'metrics.csv');
  if (!existsSync(csvPath)) die('没有 metrics.csv');
  const rows = readFileSync(csvPath, 'utf8').trim().split('\n');
  const recordsPath = join(task, '08-数据复盘', 'metrics-records.json');
  const records = existsSync(recordsPath) ? readJson(recordsPath) : [];
  const fieldLabels = {
    exposure: '曝光',
    reads: '阅读',
    plays: '播放',
    completion_rate: '完播率',
    average_watch_seconds: '平均观看秒数',
    likes: '点赞',
    comments: '评论',
    saves: '收藏',
    shares: '分享',
    follower_delta: '涨粉',
  };
  const report = [
    '# 数据复盘',
    '',
    `- 任务：${manifest.title}`,
    `- 当前状态：${manifest.workflow_state}`,
    `- 数据行数：${Math.max(0, rows.length - 1)}`,
    '',
    '## 结论边界',
    '',
    '- 本报告只登记事实，不把单个选题的结果升级为全局规律。',
    '- 缺失项保持 null，不根据其他字段倒推。',
    '- 只有同一规律跨两个选题重复出现，并由用户明确确认，才写入全局规则。',
    '',
    '## 已登记事实',
    '',
    ...(records.length
      ? records.flatMap((record) => [
          `### ${record.platform} / ${record.window} / ${record.captured_at}`,
          '',
          ...Object.entries(fieldLabels).map(([key, label]) => (
            `- ${label}：${record[key] === null || record[key] === undefined ? 'null' : record[key]}`
          )),
          `- 原始截图：${record.source_screenshot || 'null'}`,
          `- 备注：${record.notes || '无'}`,
          '',
        ])
      : ['- 暂无结构化数据。', '']),
    '## 候选规律',
    '',
    '- [待确认] 由人工结合 24h / 7d / 30d 数据填写。',
    '',
  ];
  writeText(join(task, '08-数据复盘', '复盘.md'), report.join('\n'));
  if (stateAtLeast(manifest, 'metrics_30d')) setState(task, manifest, 'reviewed');
  console.log(join(task, '08-数据复盘', '复盘.md'));
}

function markPublished(args) {
  const task = resolveTask(args);
  const manifest = loadManifest(task);
  if (!stateAtLeast(manifest, 'package_ready')) die('尚未形成通过校验的发布包');
  manifest.approvals.publish = {
    confirmed_at: now(),
    by: 'user',
    mode: 'manual',
  };
  setState(task, manifest, 'published');
  console.log('已登记为人工发布；系统没有执行自动发布。');
}

function ttsRoutePath() {
  const routeCandidates = [
    PROFILE.tts?.route_config,
    join(PROJECT_ROOT, 'automation', 'config', 'tts-routing.json'),
    join(SKILL_DIR, 'config', 'tts-routing.local.json'),
  ].filter(Boolean);
  return routeCandidates.find(existsSync) || null;
}

function inspectTtsRoute() {
  const routePath = ttsRoutePath();
  const checks = {
    repository: false,
    model_dir: false,
    python: Boolean(PROFILE.tts?.python && existsSync(PROFILE.tts.python)),
    cli: false,
    routing_config: Boolean(routePath),
    canonical_reference: false,
    canonical_sha256: false,
    provider: false,
    voice_id: false,
    playback_speed: false,
    reference_pcm: false,
  };
  let route = null;
  if (routePath) {
    route = readJson(routePath);
    const local = route.local_video || {};
    checks.repository = Boolean(local.repository && existsSync(local.repository));
    checks.model_dir = Boolean(local.model_dir && existsSync(local.model_dir));
    checks.cli = Boolean(local.repository && existsSync(join(local.repository, '.venv', 'Scripts', 'indextts2.exe')));
    checks.provider = local.provider === 'indextts2-local';
    checks.voice_id = Boolean(local.voice_id);
    checks.playback_speed = Number(local.default_delivery?.playback_speed) > 0;
    const reference = local.reference_wav;
    checks.canonical_reference = Boolean(reference && existsSync(reference) && /\.wav$/iu.test(reference));
    if (checks.canonical_reference && local.reference_sha256) {
      const actual = createHash('sha256').update(readFileSync(reference)).digest('hex').toUpperCase();
      checks.canonical_sha256 = actual === String(local.reference_sha256).toUpperCase();
      try {
        checks.reference_pcm = String(probeMedia(reference).codec_name || '').startsWith('pcm_');
      } catch {
        checks.reference_pcm = false;
      }
    }
  }
  const status = Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL';
  return {
    status,
    provider: 'IndexTTS2',
    voice_id: route?.local_video?.voice_id || null,
    playback_speed: Number(route?.local_video?.default_delivery?.playback_speed || 0) || null,
    fallback_allowed: false,
    route_path: routePath || null,
    checks,
    repair: status === 'PASS'
      ? null
      : `复制 ${join(SKILL_DIR, 'config', 'tts-routing.example.json')} 为 ${join(SKILL_DIR, 'config', 'tts-routing.local.json')}，填写本机 IndexTTS2、无损 WAV 绝对路径与 SHA-256。`,
  };
}

function ttsPreflight() {
  const report = inspectTtsRoute();
  writeJson(join(HERE, 'tts-preflight-report.json'), {
    ...report,
    checked_at: now(),
  });
  console.log(JSON.stringify(report, null, 2));
  const status = report.status;
  if (status !== 'PASS') process.exitCode = 2;
}

function ttsRegisterReference(args) {
  if (!args.wav) die('缺少 --wav <无损PCM WAV路径>');
  const wav = resolve(args.wav);
  if (!existsSync(wav) || !/\.wav$/iu.test(wav)) die(`参考音频必须是现有 WAV：${wav}`);
  const probe = probeMedia(wav);
  const errors = [];
  if (!probe.ok) errors.push(`无法解码：${probe.error || '未知错误'}`);
  if (!String(probe.codec_name || '').startsWith('pcm_')) errors.push(`不是 PCM WAV：${probe.codec_name || 'unknown'}`);
  if (!probe.duration || probe.duration < 8 || probe.duration > 90) {
    errors.push(`建议母版时长为 8–90 秒，当前 ${probe.duration ?? 'unknown'} 秒`);
  }
  if (!probe.sample_rate || probe.sample_rate < 16000) {
    errors.push(`采样率必须至少 16000 Hz，当前 ${probe.sample_rate ?? 'unknown'}`);
  }
  if (![1, 2].includes(probe.channels)) errors.push(`声道数只能是 1 或 2，当前 ${probe.channels ?? 'unknown'}`);
  const nullOutput = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const volumeProbe = spawnSync('ffmpeg', [
    '-hide_banner',
    '-nostats',
    '-i', wav,
    '-af', 'volumedetect',
    '-f', 'null',
    nullOutput,
  ], {encoding: 'utf8'});
  const volumeLog = `${volumeProbe.stdout || ''}\n${volumeProbe.stderr || ''}`;
  const meanVolume = Number(volumeLog.match(/mean_volume:\s*(-?[\d.]+)\s*dB/iu)?.[1]);
  const maxVolume = Number(volumeLog.match(/max_volume:\s*(-?[\d.]+)\s*dB/iu)?.[1]);
  if (!Number.isFinite(meanVolume) || !Number.isFinite(maxVolume)) {
    errors.push('无法读取音量信息');
  } else {
    if (meanVolume < -45) errors.push(`录音接近静音，平均音量 ${meanVolume} dB`);
    if (maxVolume > -0.1) errors.push(`录音存在削波风险，峰值 ${maxVolume} dB`);
  }
  const sha256 = createHash('sha256').update(readFileSync(wav)).digest('hex').toUpperCase();
  const report = {
    status: errors.length ? 'FAIL' : 'PASS',
    checked_at: now(),
    candidate: wav,
    sha256,
    probe,
    volume: {
      mean_db: Number.isFinite(meanVolume) ? meanVolume : null,
      max_db: Number.isFinite(maxVolume) ? maxVolume : null,
    },
    errors,
    writes_config: Boolean(args.confirm && !errors.length),
  };
  writeJson(join(HERE, 'tts-reference-candidate-report.json'), report);
  if (errors.length) {
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 2;
    return;
  }
  if (!args.confirm) {
    console.log(JSON.stringify(report, null, 2));
    console.log('只完成检查，未写配置。确认这是最终母版后追加 --confirm。');
    return;
  }
  const template = readJson(join(SKILL_DIR, 'config', 'tts-routing.example.json'));
  template.local_video.reference_wav = wav.replaceAll('\\', '/');
  template.local_video.reference_sha256 = sha256;
  const configPath = PROFILE.tts?.route_config || join(SKILL_DIR, 'config', 'tts-routing.local.json');
  writeJson(configPath, template);
  console.log(`已登记正式无损母版：${configPath}`);
}

function cleanNarrationText(markdown) {
  return markdown
    .replace(/^---[\s\S]*?---\s*/u, '')
    .split(/\r?\n/u)
    .filter((line) => !/^#\s+/u.test(line.trim()))
    .filter((line) => !/^>\s*\[/u.test(line.trim()))
    .map((line) => line
      .replace(/^>\s*/u, '')
      .replace(/^[-*]\s+/u, '')
      .replace(/\*\*(.+?)\*\*/gu, '$1')
      .replace(/`(.+?)`/gu, '$1')
      .replace(/\[(.+?)\]\(.+?\)/gu, '$1')
      .trim())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function splitNarrationParagraph(paragraph, maxLength = 34) {
  const output = [];
  let remaining = paragraph.trim();
  while ([...remaining].length > maxLength) {
    const chars = [...remaining];
    let cut = maxLength;
    for (let index = maxLength; index >= Math.floor(maxLength * 0.55); index -= 1) {
      if ('。！？；，：、,.!?;'.includes(chars[index - 1])) {
        cut = index;
        break;
      }
    }
    output.push(chars.slice(0, cut).join('').trim());
    remaining = chars.slice(cut).join('').trim();
  }
  if (remaining) output.push(remaining);
  return output.filter(Boolean);
}

function packNarrationSegments(parts, targetLength = 120, maxLength = 160) {
  const output = [];
  let current = '';
  for (const part of parts) {
    const normalized = String(part || '').trim();
    if (!normalized) continue;
    const candidate = current ? `${current}${normalized}` : normalized;
    if (current && [...candidate].length > maxLength) {
      output.push(current);
      current = normalized;
      continue;
    }
    current = candidate;
    if ([...current].length >= targetLength && /[。！？!?]$/u.test(current)) {
      output.push(current);
      current = '';
    }
  }
  if (current) output.push(current);
  return output;
}

function ttsContract(args) {
  const task = resolveTask(args);
  const manifest = loadManifest(task);
  if (!manifest.approvals.hook) die('尚未选择联动方案，不能生成配音契约');
  const ttsDir = join(task, '05-视频文案', 'tts');
  const displayDir = join(ttsDir, 'display');
  ensureDir(displayDir);
  const report = [];
  for (const job of VIDEO_JOBS) {
    const scriptPath = join(task, '05-视频文案', job.script);
    if (!existsSync(scriptPath)) die(`缺少视频文案：${job.script}`);
    const cleaned = cleanNarrationText(readFileSync(scriptPath, 'utf8'));
    if (!cleaned || cleaned.includes('[待确认]')) die(`${job.script} 仍含待确认内容`);
    const sentenceParts = cleaned
      .split(/\n\s*\n/u)
      .flatMap((paragraph) => splitNarrationParagraph(paragraph));
    const segments = packNarrationSegments(sentenceParts);
    writeText(join(displayDir, `${job.id}.txt`), `${segments.join('\n')}\n`);
    writeText(
      join(ttsDir, `${job.id}.jsonl`),
      `${segments.map((text) => JSON.stringify({
        text,
        silence_after_ms: /[。！？!?]$/u.test(text) ? 220 : 120,
      })).join('\n')}\n`,
    );
    report.push({job: job.id, segments: segments.length, characters: [...cleaned].length});
  }
  writeJson(join(ttsDir, 'contract-report.json'), {
    schema_version: 1,
    generated_at: now(),
    voice_id: manifest.settings.tts_voice_id,
    playback_speed: manifest.settings.tts_playback_speed,
    fallback_allowed: false,
    segmentation: {
      strategy: 'pack-adjacent-sentences',
      target_characters: 120,
      maximum_characters: 160,
    },
    jobs: report,
  });
  console.log(JSON.stringify(report, null, 2));
}

function makeVerticalCaptionCues(timeline, {maxChars = 36, maxCharsPerLine = 18} = {}) {
  const formatTwoLines = (chunk) => {
    const letters = [...chunk];
    if (letters.length <= maxCharsPerLine) return chunk;
    const target = maxCharsPerLine;
    const min = Math.max(8, Math.floor(letters.length / 2) - 5);
    const max = Math.min(letters.length - 8, Math.ceil(letters.length / 2) + 5);
    const boundaryScore = (index) => {
      const before = letters[index - 1] || '';
      const after = letters[index] || '';
      if (/\s/u.test(before) || /\s/u.test(after)) return 0;
      if (/[，。！？；、：]/u.test(before) || /[，。！？；、：]/u.test(after)) return 1;
      if (/[0-9A-Za-z.]/u.test(before) && /[0-9A-Za-z.]/u.test(after)) return 100;
      return 3;
    };
    let best = target;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let index = min; index <= max; index += 1) {
      const score = boundaryScore(index) * 100 + Math.abs(index - target);
      if (score < bestScore) {
        best = index;
        bestScore = score;
      }
    }
    return `${letters.slice(0, best).join('').trimEnd()}\n${letters.slice(best).join('').trimStart()}`;
  };
  const cues = [];
  for (const item of timeline) {
    const text = String(item.text || '').replace(/\s+/gu, ' ').trim();
    if (!text || !(Number(item.end) > Number(item.start))) continue;
    const sentences = text.match(/[^。！？；…]+[。！？；…]?/gu) || [text];
    const chunks = [];
    let buffer = '';
    const flush = () => {
      if (buffer) chunks.push(buffer);
      buffer = '';
    };
    for (const sentence of sentences) {
      if (buffer && [...buffer, ...sentence].length > maxChars) flush();
      if ([...sentence].length <= maxChars) {
        buffer += sentence;
        continue;
      }
      flush();
      const letters = [...sentence];
      for (let offset = 0; offset < letters.length; offset += maxChars) {
        chunks.push(letters.slice(offset, offset + maxChars).join(''));
      }
    }
    flush();
    const weights = chunks.map((chunk) => Math.max(1, [...chunk].length));
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    let cursor = Number(item.start);
    chunks.forEach((chunk, index) => {
      const end = index === chunks.length - 1
        ? Number(item.end)
        : cursor + ((Number(item.end) - Number(item.start)) * weights[index] / totalWeight);
      const formatted = formatTwoLines(chunk);
      cues.push({start: cursor, end, text: formatted, source_segment_index: item.index ?? null});
      cursor = end;
    });
  }
  return cues;
}

function buildRenderConfigs(task, manifest) {
  const configDir = join(task, '05-视频文案', 'render-config');
  const timelineDir = join(configDir, 'timeline');
  ensureDir(configDir);
  for (const job of VIDEO_JOBS) {
    const audioPath = join(configDir, 'audio', `${job.id}.wav`);
    const timelinePath = join(timelineDir, `${job.id}.json`);
    const storyboardPath = join(task, '05-视频文案', job.storyboard);
    if (!existsSync(audioPath) || !existsSync(timelinePath) || !existsSync(storyboardPath)) {
      die(`缺少 ${job.id} 的音频、精确字幕时间轴或分镜`);
    }
    const duration = probeMedia(audioPath).duration;
    const storyboard = readJson(storyboardPath);
    if (!Array.isArray(storyboard.scenes) || !storyboard.scenes.length) {
      die(`${job.storyboard} 没有分镜`);
    }
    const scenes = storyboard.scenes.map((scene, index) => {
      if (String(scene.text || '').includes('[待确认]')) die(`${job.storyboard} 第 ${index + 1} 段仍待确认`);
      const start = scene.start ?? Number(scene.start_ratio ?? 0) * duration;
      const end = scene.end ?? Number(scene.end_ratio ?? 1) * duration;
      let asset = null;
      if (scene.asset) {
        const resolvedAsset = isAbsolute(scene.asset)
          ? scene.asset
          : resolve(task, scene.asset);
        if (!existsSync(resolvedAsset)) die(`${job.storyboard} 素材不存在：${resolvedAsset}`);
        asset = relative(configDir, resolvedAsset).replaceAll('\\', '/');
      }
      return {...scene, start, end, asset};
    });
    const timeline = readJson(timelinePath);
    const captions = makeVerticalCaptionCues(timeline);
    if (!captions.length) die(`${job.id} 没有可用的竖版字幕`);
    writeJson(join(configDir, `${job.id}.json`), {
      schema_version: Number(storyboard.schema_version) >= 2 ? 2 : 1,
      title: manifest.selected_hook?.core_title || manifest.title,
      creatorName: manifest.settings.creator_name || CREATOR_NAME,
      lane: manifest.lane,
      duration,
      audio: `audio/${job.id}.wav`,
      motion_thesis: storyboard.motion_thesis || null,
      scenes,
      captions,
      subtitle_contract: {y_ratio: 0.68, max_lines: 2, source: 'exact-final-wav'},
    });
  }
}

function ttsGenerate(args) {
  const task = resolveTask(args);
  const manifest = loadManifest(task);
  if (!manifest.approvals.script || !stateAtLeast(manifest, 'script_approved')) {
    die('视频文案未获用户批准；不能生成正式配音');
  }
  const preflight = inspectTtsRoute();
  if (preflight.status !== 'PASS') {
    console.error(JSON.stringify(preflight, null, 2));
    die('TTS 预检失败；不允许 fallback');
  }
  ttsContract({task});
  const routePath = preflight.route_path;
  const helper = join(HERE, 'scripts', 'generate_strict_indextts2.py');
  const python = PROFILE.tts?.python;
  const lexicon = PROFILE.tts?.pronunciation_lexicon;
  const alignmentScript = PROFILE.tts?.alignment_script;
  if (!python || !existsSync(python)) die('私人配置缺少可用的 tts.python');
  if (!lexicon || !existsSync(lexicon)) die('私人配置缺少 pronunciation_lexicon');
  if (!alignmentScript || !existsSync(alignmentScript)) die('私人配置缺少 alignment_script');
  const configDir = join(task, '05-视频文案', 'render-config');
  const audioDir = join(configDir, 'audio');
  const timelineDir = join(configDir, 'timeline');
  const individualManifestDir = join(task, '06-媒体成品', 'voice-manifests');
  ensureDir(audioDir);
  ensureDir(timelineDir);
  ensureDir(individualManifestDir);
  const outputs = {};
  const jobAudits = {};
  for (const job of VIDEO_JOBS) {
    const output = join(audioDir, `${job.id}.wav`);
    const individualManifest = join(individualManifestDir, `${job.id}.json`);
    const command = [
      helper,
      '--batch-file', join(task, '05-视频文案', 'tts', `${job.id}.jsonl`),
      '--output', output,
      '--manifest', individualManifest,
      '--config', routePath,
      '--pronunciation-lexicon', lexicon,
      '--force',
    ];
    if (args['dry-run']) command.push('--dry-run');
    const generated = spawnSync(python, command, {cwd: PROJECT_ROOT, stdio: 'inherit'});
    if (generated.status !== 0) die(`IndexTTS2 生成失败：${job.id}`);
    if (args['dry-run']) continue;
    const align = spawnSync(python, [
      alignmentScript,
      '--audio', output,
      '--script', join(task, '05-视频文案', 'tts', 'display', `${job.id}.txt`),
      '--output', join(timelineDir, `${job.id}.json`),
      '--asr-output', join(timelineDir, `${job.id}-asr.json`),
    ], {cwd: PROJECT_ROOT, stdio: 'inherit'});
    if (align.status !== 0) die(`精确字幕对齐失败：${job.id}`);
    const item = readJson(individualManifest);
    outputs[job.id] = {
      path: relative(task, output).replaceAll('\\', '/'),
      sha256: item.output_sha256,
      duration: Number(item.output_probe?.format?.duration || probeMedia(output).duration),
    };
    jobAudits[job.id] = {
      individual_manifest: relative(task, individualManifest).replaceAll('\\', '/'),
      inference_precision: item.inference_precision,
      segment_count: Array.isArray(item.segments) ? item.segments.length : null,
      pronunciation_contract: item.pronunciation_contract,
    };
  }
  if (args['dry-run']) {
    console.log('竖版长视频配音契约 dry-run：PASS');
    return;
  }
  const route = readJson(routePath).local_video;
  writeJson(join(task, '06-媒体成品', 'voice_manifest.json'), {
    provider: 'IndexTTS2',
    provider_route: 'indextts2-local',
    voice_id: route.voice_id,
    model: route.model,
    inference_precision: route.inference_precision,
    reference: {
      path: route.reference_wav,
      sha256: route.reference_sha256,
      lossless: true,
    },
    playback_speed: Number(route.default_delivery?.playback_speed),
    used_fallback: false,
    captions_from_exact_final_wav: true,
    jobs: jobAudits,
    outputs,
  });
  buildRenderConfigs(task, manifest);
  console.log('指定音色 WAV、精确字幕和竖版长视频渲染配置已生成。');
}

function validateVoiceManifest(task, audioPaths) {
  const path = join(task, '06-媒体成品', 'voice_manifest.json');
  if (!existsSync(path)) die('缺少 06-媒体成品/voice_manifest.json');
  const voice = readJson(path);
  if (!['IndexTTS2', 'indextts2-local'].includes(voice.provider)) die('配音提供方必须是 IndexTTS2');
  if (voice.voice_id !== PROFILE.tts?.voice_id && PROFILE.tts?.voice_id) die('配音音色与私人配置不一致');
  if (voice.used_fallback !== false) die('配音 manifest 显示发生过 fallback');
  if (Number(voice.playback_speed) !== Number(PROFILE.tts?.playback_speed || voice.playback_speed)) die('配音倍速与私人配置不一致');
  if (!['fp16', 'fp32'].includes(voice.inference_precision)) die('配音 manifest 未登记推理精度');
  const mainVoiceJob = voice.jobs?.main;
  if (!mainVoiceJob || mainVoiceJob.pronunciation_contract?.validated !== true) {
    die('配音 manifest 未登记已验证的发音契约');
  }
  if (!Number.isInteger(mainVoiceJob.segment_count) || mainVoiceJob.segment_count < 1) {
    die('配音 manifest 未登记有效的分段契约');
  }
  const expected = new Set(
    Object.values(voice.outputs || {}).map((item) => String(item?.sha256 || '').toLowerCase()).filter(Boolean),
  );
  for (const audio of audioPaths) {
    const actual = createHash('sha256').update(readFileSync(audio)).digest('hex').toLowerCase();
    if (!expected.has(actual)) die(`音频不在 voice_manifest 输出中：${audio}`);
  }
  return voice;
}

function runVideoRender(args) {
  const task = resolveTask(args);
  const manifest = loadManifest(task);
  if (!manifest.approvals.script) die('视频文案尚未批准');
  if (!stateAtLeast(manifest, 'script_approved')) die(`当前状态 ${manifest.workflow_state} 尚未到 script_approved`);
  const configDir = join(task, '05-视频文案', 'render-config');
  const renderJobs = [
    {
      config: 'main.json',
      composition: 'ContentVideo9x16',
      output: 'main-9x16.mp4',
    },
  ];
  const configs = new Map();
  const audioPaths = [];
  for (const job of renderJobs) {
    const path = join(configDir, job.config);
    if (!existsSync(path)) die(`缺少渲染配置：${job.config}`);
    if (!configs.has(job.config)) {
      const config = readJson(path);
      if (!Array.isArray(config.scenes) || !config.scenes.length) die(`${job.config} 没有分镜`);
      if (!Array.isArray(config.captions) || !config.captions.length) die(`${job.config} 没有字幕时间轴`);
      const audio = resolve(configDir, config.audio);
      if (!existsSync(audio)) die(`${job.config} 音频不存在：${audio}`);
      configs.set(job.config, {path, config, audio});
      audioPaths.push(audio);
    }
  }
  validateVoiceManifest(task, audioPaths);
  const captionReports = [];
  for (const [name, item] of configs) {
    const duration = probeMedia(item.audio).duration;
    const errors = [];
    let previousEnd = 0;
    for (const [index, caption] of item.config.captions.entries()) {
      if (!(caption.start >= previousEnd - 0.03)) errors.push(`字幕 ${index + 1} 与上一条重叠`);
      if (!(caption.end > caption.start)) errors.push(`字幕 ${index + 1} 时间无效`);
      if (caption.end > duration + 0.1) errors.push(`字幕 ${index + 1} 超出最终 WAV`);
      if (String(caption.text || '').split('\n').length > 2) errors.push(`字幕 ${index + 1} 超过 2 行`);
      if ([...String(caption.text || '').replaceAll('\n', '')].length > 38) {
        errors.push(`字幕 ${index + 1} 超过 38 字，可能在竖屏溢出两行`);
      }
      previousEnd = caption.end;
    }
    captionReports.push({
      config: name,
      audio: relative(task, item.audio).replaceAll('\\', '/'),
      audio_sha256: createHash('sha256').update(readFileSync(item.audio)).digest('hex'),
      duration,
      subtitle_y_ratio: 0.68,
      max_lines: 2,
      status: errors.length ? 'FAIL' : 'PASS',
      errors,
    });
  }
  const captionQc = {
    schema_version: 1,
    generated_at: now(),
    source_rule: 'exact-final-wav',
    status: captionReports.every((item) => item.status === 'PASS') ? 'PASS' : 'FAIL',
    reports: captionReports,
  };
  writeJson(join(task, '06-媒体成品', 'caption-qc.json'), captionQc);
  if (captionQc.status !== 'PASS') die('字幕 QC 未通过，已停止正式渲染');

  const renderer = join(HERE, 'remotion', 'render.mjs');
  for (const job of renderJobs) {
    const result = spawnSync(process.execPath, [
      renderer,
      '--config', join(configDir, job.config),
      '--output', join(task, '06-媒体成品', job.output),
      '--composition', job.composition,
    ], {cwd: join(HERE, 'remotion'), stdio: 'inherit'});
    if (result.status !== 0) die(`渲染失败：${job.output}`);
  }
  setState(task, manifest, 'rendered');
  console.log('唯一一份 9:16 竖版长视频已渲染完成。');
}

function runLark(args, input = null) {
  const command = process.platform === 'win32'
    ? process.execPath
    : 'lark-cli';
  const effectiveArgs = process.platform === 'win32'
    ? [
        join(
          process.env.APPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Roaming'),
          'npm',
          'node_modules',
          '@larksuite',
          'cli',
          'scripts',
          'run.js',
        ),
        ...args,
      ]
    : args;
  const result = spawnSync(command, effectiveArgs, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
      LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
    },
    input,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) die(`无法启动飞书 CLI：${result.error.message}`);
  const payload = result.stdout?.trim() || result.stderr?.trim() || '';
  let parsed = null;
  try {
    parsed = JSON.parse(payload);
  } catch {
    die(`飞书命令未返回有效 JSON：${payload.slice(0, 500) || '(空输出)'}`);
  }
  if (result.status !== 0 || parsed.ok !== true) {
    const hint = parsed.error?.hint ? `\n${parsed.error.hint}` : '';
    die(`飞书命令失败：${parsed.error?.message || payload}${hint}`);
  }
  return parsed;
}

function fetchFeishuMarkdown(url) {
  const response = runLark([
    'docs', '+fetch',
    '--doc', url,
    '--doc-format', 'markdown',
    '--detail', 'simple',
    '--as', 'user',
  ]);
  const document = response.data?.document;
  if (!document) die('飞书返回中缺少 document');
  return {
    documentId: document.document_id,
    revisionId: document.revision_id,
    markdown: String(document.content || '').replace(/\r\n/g, '\n'),
  };
}

function compactDiff(localText, remoteText) {
  const local = localText.split('\n');
  const remote = remoteText.split('\n');
  let start = 0;
  while (start < local.length && start < remote.length && local[start] === remote[start]) start += 1;
  let localEnd = local.length - 1;
  let remoteEnd = remote.length - 1;
  while (localEnd >= start && remoteEnd >= start && local[localEnd] === remote[remoteEnd]) {
    localEnd -= 1;
    remoteEnd -= 1;
  }
  const before = local.slice(Math.max(0, start - 3), start);
  const after = local.slice(localEnd + 1, Math.min(local.length, localEnd + 4));
  const localChanged = local.slice(start, localEnd + 1);
  const remoteChanged = remote.slice(start, remoteEnd + 1);
  return [
    '# 本地与飞书差异',
    '',
    `- 本地行数：${local.length}`,
    `- 飞书行数：${remote.length}`,
    `- 首个差异行：${start + 1}`,
    '',
    '```diff',
    ...before.map((line) => ` ${line}`),
    ...remoteChanged.map((line) => `-${line}`),
    ...localChanged.map((line) => `+${line}`),
    ...after.map((line) => ` ${line}`),
    '```',
    '',
  ].join('\n');
}

function feishuPush(args) {
  const task = resolveTask(args);
  const configPath = join(task, 'feishu.json');
  const config = readJson(configPath);
  if (!config.url) die('feishu.json 尚未填写文档 URL');
  const localPath = join(task, config.local_source || '02-文章主稿.md');
  const local = readFileSync(localPath, 'utf8').replace(/\r\n/g, '\n');
  const remote = fetchFeishuMarkdown(config.url);
  const localSha = createHash('sha256').update(local).digest('hex');
  const remoteSha = createHash('sha256').update(remote.markdown).digest('hex');
  const cacheDir = join(task, '.feishu-cache');
  ensureDir(cacheDir);
  writeText(join(cacheDir, 'remote-latest.md'), remote.markdown);
  writeText(join(cacheDir, 'local-latest.md'), local);
  writeText(join(cacheDir, 'push-diff.md'), compactDiff(local, remote.markdown));
  config.document_id = remote.documentId;
  config.remote_revision = remote.revisionId;
  config.last_fetched_at = now();
  config.last_remote_sha256 = remoteSha;
  writeJson(configPath, config);
  if (args['dry-run']) {
    console.log(join(cacheDir, 'push-diff.md'));
    return;
  }
  if (!args.confirm) {
    die(`先查看 ${join(cacheDir, 'push-diff.md')}，确认后追加 --confirm`);
  }
  if (
    config.last_pushed_remote_sha256
    && config.last_pushed_remote_sha256 !== remoteSha
    && config.last_pushed_local_sha256 !== remoteSha
  ) {
    die('飞书自上次推送后被修改，已停止覆盖；先运行 feishu-pull --dry-run 查看差异');
  }
  const response = runLark([
    'docs', '+update',
    '--doc', config.url,
    '--command', 'overwrite',
    '--doc-format', 'markdown',
    '--content', '-',
    '--revision-id', String(remote.revisionId),
    '--as', 'user',
  ], local);
  config.remote_revision = response.data?.document?.revision_id ?? remote.revisionId + 1;
  config.last_pushed_at = now();
  config.last_pushed_sha256 = localSha;
  config.last_pushed_local_sha256 = localSha;
  config.last_pushed_remote_sha256 = localSha;
  writeJson(configPath, config);
  writeText(join(cacheDir, 'last-pushed.md'), local);
  console.log(`飞书镜像已更新到 revision ${config.remote_revision}`);
}

function feishuPull(args) {
  const task = resolveTask(args);
  const configPath = join(task, 'feishu.json');
  const config = readJson(configPath);
  if (!config.url) die('feishu.json 尚未填写文档 URL');
  const localPath = join(task, config.local_source || '02-文章主稿.md');
  const local = readFileSync(localPath, 'utf8').replace(/\r\n/g, '\n');
  const remote = fetchFeishuMarkdown(config.url);
  const localSha = createHash('sha256').update(local).digest('hex');
  const remoteSha = createHash('sha256').update(remote.markdown).digest('hex');
  const cacheDir = join(task, '.feishu-cache');
  ensureDir(cacheDir);
  writeText(join(cacheDir, 'remote-latest.md'), remote.markdown);
  writeText(join(cacheDir, 'local-latest.md'), local);
  writeText(join(cacheDir, 'pull-diff.md'), compactDiff(remote.markdown, local));
  config.document_id = remote.documentId;
  config.remote_revision = remote.revisionId;
  config.last_fetched_at = now();
  config.last_remote_sha256 = remoteSha;
  writeJson(configPath, config);
  if (args['dry-run'] || !args.confirm) {
    console.log(join(cacheDir, 'pull-diff.md'));
    if (!args['dry-run']) console.log('未覆盖本地；确认后使用 --confirm。');
    return;
  }
  if (
    config.last_pushed_local_sha256
    && config.last_pushed_local_sha256 !== localSha
    && localSha !== remoteSha
  ) {
    die('本地文章自上次推送后也被修改，已停止覆盖；请人工合并 pull-diff.md');
  }
  const backup = join(cacheDir, `local-backup-${Date.now()}.md`);
  writeText(backup, local);
  writeText(localPath, remote.markdown);
  config.last_pulled_at = now();
  config.last_pulled_sha256 = remoteSha;
  config.last_pushed_local_sha256 = remoteSha;
  writeJson(configPath, config);
  console.log(`已从飞书拉回；本地备份：${backup}`);
}

function help() {
  console.log(`阿荣多平台内容生产流水线

命令：
  topic-preflight --topic-origin <user_provided|library_selected|automated_selftest> [--topic-evidence <来源>] [--test-mode]
  init --title <标题> --slug <英文slug> --lane <thought|project_sop> --topic-origin <user_provided|library_selected> [--topic-evidence <来源>] [--source <md>]
  status --task <任务目录>
  transition --task <任务目录> --to <相邻状态>
  approve-diagnosis --task <任务目录> [--actor automated_selftest（仅不可发布测试任务）]
  reaffirm-diagnosis --task <任务目录>
  approve-article --task <任务目录> [--actor automated_selftest（仅不可发布测试任务）]
  select-hook --task <任务目录> --id <A|B|C> [--actor automated_selftest（仅不可发布测试任务）]
  confirm-video-inputs --task <任务目录>
  approve-script --task <任务目录> [--actor automated_selftest（仅不可发布测试任务）]
  cover --task <任务目录>
  cards --task <任务目录>
  package --task <任务目录>
  validate --task <任务目录>
  mark-published --task <任务目录>
  metrics-import --task <任务目录> --input <json>
  review --task <任务目录>
  tts-preflight
  tts-register-reference --wav <PCM WAV> [--confirm]
  tts-contract --task <任务目录>
  tts-generate --task <任务目录> [--dry-run]
  video-render --task <任务目录>
  feishu-push --task <任务目录> --dry-run
  feishu-push --task <任务目录> --confirm
  feishu-pull --task <任务目录> --dry-run
  feishu-pull --task <任务目录> --confirm
`);
}

const {command, args} = parseArgs(process.argv.slice(2));
switch (command) {
  case 'topic-preflight': topicPreflight(args); break;
  case 'init': createTask(args); break;
  case 'status': showStatus(args); break;
  case 'transition': transition(args); break;
  case 'approve-diagnosis': approveDiagnosis(args); break;
  case 'reaffirm-diagnosis': reaffirmDiagnosis(args); break;
  case 'approve-article': approveArticle(args); break;
  case 'select-hook': selectHook(args); break;
  case 'confirm-video-inputs': confirmVideoInputs(args); break;
  case 'approve-script': approveScript(args); break;
  case 'cover': runCover(args); break;
  case 'cards': runCards(args); break;
  case 'package': packageTask(args); break;
  case 'validate': validateTask(args); break;
  case 'mark-published': markPublished(args); break;
  case 'metrics-import': metricsImport(args); break;
  case 'review': review(args); break;
  case 'tts-preflight': ttsPreflight(); break;
  case 'tts-register-reference': ttsRegisterReference(args); break;
  case 'tts-contract': ttsContract(args); break;
  case 'tts-generate': ttsGenerate(args); break;
  case 'video-render': runVideoRender(args); break;
  case 'feishu-push': feishuPush(args); break;
  case 'feishu-pull': feishuPull(args); break;
  case 'help':
  case '--help':
  case '-h':
    help();
    break;
  default:
    die(`未知命令：${command}`);
}
