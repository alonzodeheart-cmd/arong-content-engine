import {existsSync, readFileSync} from 'node:fs';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PROFILE = join(SKILL_DIR, 'config', 'profile.local.json');
const EXAMPLE_PROFILE = join(SKILL_DIR, 'config', 'profile.example.json');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function absolute(value, base = SKILL_DIR) {
  if (!value) return null;
  return isAbsolute(value) ? resolve(value) : resolve(base, value);
}

export function loadProfile({required = false} = {}) {
  const requested = process.env.ARONG_CONTENT_PROFILE
    ? absolute(process.env.ARONG_CONTENT_PROFILE, process.cwd())
    : DEFAULT_PROFILE;
  const profilePath = existsSync(requested)
    ? requested
    : existsSync(EXAMPLE_PROFILE) ? EXAMPLE_PROFILE : null;
  if (!profilePath) {
    if (required) throw new Error('缺少 config/profile.local.json；先复制 profile.example.json 并填写本机配置');
    return {configured: false, path: requested, skill_dir: SKILL_DIR};
  }
  const raw = readJson(profilePath);
  const configured = profilePath !== EXAMPLE_PROFILE
    && Boolean(raw.creator_name && raw.creator_name !== 'YOUR_NAME')
    && Boolean(raw.tasks_root);
  if (required && !configured) {
    throw new Error(`私人配置尚未完成：${requested}`);
  }
  const tts = raw.tts || {};
  return {
    ...raw,
    configured,
    path: profilePath,
    skill_dir: SKILL_DIR,
    content_root: absolute(process.env.ARONG_CONTENT_ROOT || raw.content_root),
    tasks_root: absolute(process.env.ARONG_CONTENT_TASKS_ROOT || raw.tasks_root),
    source_map: absolute(raw.source_map),
    tts: {
      ...tts,
      route_config: absolute(tts.route_config),
      python: absolute(tts.python),
      pronunciation_lexicon: absolute(tts.pronunciation_lexicon),
      alignment_script: absolute(tts.alignment_script),
    },
  };
}

export function profileSummary(profile = loadProfile()) {
  return {
    configured: profile.configured,
    path: profile.path,
    creator_name: profile.creator_name || null,
    content_root: profile.content_root,
    tasks_root: profile.tasks_root,
    source_map: profile.source_map,
    tts: {
      route_config: profile.tts?.route_config || null,
      python: profile.tts?.python || null,
      pronunciation_lexicon: profile.tts?.pronunciation_lexicon || null,
      alignment_script: profile.tts?.alignment_script || null,
    },
  };
}
