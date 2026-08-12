#!/usr/bin/env node

import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(repo, '.ci-fixture');
const modelRepo = join(target, 'IndexTTS2');
const modelDir = join(modelRepo, 'checkpoints');
const cli = join(modelRepo, '.venv', 'Scripts', 'indextts2.exe');
const tasks = join(target, 'tasks');
const reference = join(repo, 'runtime', 'remotion', 'test-fixture', 'test.wav');
const lexicon = join(target, 'pronunciation-lexicon.json');
const alignment = join(target, 'align_narration_timeline.py');
const sourceMap = join(target, 'source-map.md');
const route = join(target, 'tts-route.json');
const profile = join(target, 'profile.json');

if (!existsSync(reference)) throw new Error(`缺少公开 PCM 测试音频：${reference}`);
for (const dir of [target, modelDir, dirname(cli), tasks]) mkdirSync(dir, {recursive: true});

const write = (path, value) => writeFileSync(path, value, 'utf8');
write(cli, 'portable contract fixture; not an executable model\n');
write(lexicon, '{}\n');
write(alignment, '# portable contract fixture\n');
write(sourceMap, '# CI fixture source map\n');

const sha256 = createHash('sha256').update(readFileSync(reference)).digest('hex').toUpperCase();
write(route, `${JSON.stringify({
  schema_version: 1,
  local_video: {
    provider: 'indextts2-local',
    voice_id: 'portable-ci-fixture',
    model: 'IndexTTS2 contract fixture',
    repository: modelRepo,
    model_dir: modelDir,
    device: 'cpu',
    inference_precision: 'fp32',
    minimum_free_gpu_mb: 1000,
    reference_wav: reference,
    reference_sha256: sha256,
    fallback_allowed: false,
    default_delivery: {
      playback_speed: 1.12,
      output_sample_rate: 24000,
      output_channels: 1,
      output_codec: 'pcm_s16le',
    },
  },
}, null, 2)}\n`);

write(profile, `${JSON.stringify({
  schema_version: 1,
  creator_name: 'CI Fixture',
  content_root: repo,
  tasks_root: tasks,
  source_map: sourceMap,
  specialist_skills: [],
  tts: {
    voice_id: 'portable-ci-fixture',
    playback_speed: 1.12,
    route_config: route,
    python: process.execPath,
    pronunciation_lexicon: lexicon,
    alignment_script: alignment,
  },
}, null, 2)}\n`);

console.log(profile);
