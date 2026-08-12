import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function die(message) {
  console.error(`错误：${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    args[token.slice(2)] = argv[i + 1];
    i += 1;
  }
  return args;
}

function probeDuration(path) {
  const result = spawnSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1',
    path,
  ], {encoding: 'utf8'});
  if (result.status !== 0) die(`无法读取音频：${path}`);
  return Number(result.stdout.trim());
}

const args = parseArgs(process.argv.slice(2));
if (!args.config || !args.output || !args.composition) {
  die('用法：node render.mjs --config <json> --output <mp4> --composition <ContentVideo9x16> [--max-duration <秒>]');
}
if (args.composition !== 'ContentVideo9x16') {
  die('本引擎只输出一个竖版长视频：ContentVideo9x16');
}
const configPath = resolve(args.config);
const outputPath = resolve(args.output);
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const runtime = join(HERE, 'public', 'runtime');
rmSync(runtime, {recursive: true, force: true});
mkdirSync(join(runtime, 'assets'), {recursive: true});

const audioPath = resolve(dirname(configPath), config.audio);
if (!existsSync(audioPath)) die(`音频不存在：${audioPath}`);
copyFileSync(audioPath, join(runtime, 'narration.wav'));
config.audio = 'runtime/narration.wav';
const fullDuration = probeDuration(audioPath);
const requestedMaxDuration = Number(args['max-duration']);
config.duration = Number.isFinite(requestedMaxDuration) && requestedMaxDuration > 0
  ? Math.min(fullDuration, requestedMaxDuration)
  : fullDuration;
if (config.duration < fullDuration) {
  config.scenes = (config.scenes || [])
    .filter((scene) => Number(scene.start) < config.duration)
    .map((scene) => ({...scene, end: Math.min(Number(scene.end), config.duration)}));
  config.captions = (config.captions || [])
    .filter((caption) => Number(caption.start) < config.duration)
    .map((caption) => ({...caption, end: Math.min(Number(caption.end), config.duration)}));
}

for (const scene of config.scenes || []) {
  if (!scene.asset) continue;
  const source = resolve(dirname(configPath), scene.asset);
  if (!existsSync(source)) die(`分镜素材不存在：${source}`);
  const name = `${String((config.scenes || []).indexOf(scene)).padStart(3, '0')}-${basename(source)}`;
  copyFileSync(source, join(runtime, 'assets', name));
  scene.asset = `runtime/assets/${name}`;
}

const propsPath = join(runtime, 'props.json');
writeFileSync(propsPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
mkdirSync(dirname(outputPath), {recursive: true});
const cli = process.platform === 'win32'
  ? process.execPath
  : join(HERE, 'node_modules', '.bin', 'remotion');
const cliArgs = process.platform === 'win32'
  ? [join(HERE, 'node_modules', '@remotion', 'cli', 'remotion-cli.js')]
  : [];
const result = spawnSync(cli, [
  ...cliArgs,
  'render',
  'src/index.ts',
  args.composition,
  outputPath,
  '--props', propsPath,
  '--codec', 'h264',
  '--audio-codec', 'aac',
  '--crf', '17',
  '--pixel-format', 'yuv420p',
  '--overwrite',
], {
  cwd: HERE,
  stdio: 'inherit',
});
if (result.status !== 0) process.exit(result.status || 1);
console.log(outputPath);
