#!/usr/bin/env node

import {existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync, appendFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {spawn, spawnSync} from 'node:child_process';

function parseArgs(argv) {
  const [command = 'status', ...rest] = argv;
  const args = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) continue;
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

function isAlive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function isoNow() {
  return new Date().toISOString();
}

function atomicWrite(path, value) {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temp, path);
}

function readState(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function gpuSnapshot() {
  const result = spawnSync('nvidia-smi', [
    '--query-gpu=utilization.gpu,memory.used,memory.free',
    '--format=csv,noheader,nounits',
  ], {encoding: 'utf8', windowsHide: true});
  if (result.status !== 0) return null;
  const [utilization, memoryUsed, memoryFree] = String(result.stdout).trim().split(',').map((item) => Number(item.trim()));
  return {
    utilization_percent: Number.isFinite(utilization) ? utilization : null,
    memory_used_mb: Number.isFinite(memoryUsed) ? memoryUsed : null,
    memory_free_mb: Number.isFinite(memoryFree) ? memoryFree : null,
  };
}

function mediaSnapshot(task) {
  const path = join(task, '06-媒体成品', 'main-9x16.mp4');
  if (!existsSync(path)) return {path, exists: false, bytes: 0, modified_at: null};
  const stat = statSync(path);
  return {path, exists: true, bytes: stat.size, modified_at: stat.mtime.toISOString()};
}

function inferStage(text, current = 'starting') {
  const matches = [...String(text).matchAll(/\[arong-stage\]\s+([a-z0-9_-]+)(?:\s+([^\r\n]+))?/giu)];
  if (!matches.length) return current;
  return matches.at(-1)[1];
}

function printStatus(state) {
  const elapsed = state.started_at
    ? Math.max(0, Math.round((Date.now() - Date.parse(state.started_at)) / 1000))
    : null;
  console.log(JSON.stringify({
    status: state.status,
    health: state.health,
    stage: state.stage,
    task: state.task,
    supervisor_pid: state.supervisor_pid,
    child_pid: state.child_pid,
    child_alive: isAlive(state.child_pid),
    elapsed_seconds: elapsed,
    last_heartbeat_at: state.last_heartbeat_at,
    last_output_at: state.last_output_at,
    gpu: state.gpu,
    media: state.media,
    log_path: state.log_path,
    exit_code: state.exit_code,
  }, null, 2));
}

function showStatus(task) {
  const statePath = join(task, '08-运行状态', 'long-task.json');
  const state = readState(statePath);
  if (!state) {
    console.log(JSON.stringify({status: 'NOT_STARTED', task, state_path: statePath}, null, 2));
    return;
  }
  if (state.status === 'running' && !isAlive(state.child_pid)) {
    state.status = 'stale';
    state.health = 'process_missing';
    state.last_heartbeat_at = isoNow();
    atomicWrite(statePath, state);
  }
  printStatus(state);
}

async function runMonitored(args) {
  const task = resolve(String(args.task || ''));
  const engine = resolve(String(args.engine || ''));
  if (!task || !existsSync(task)) throw new Error('缺少有效的 --task');
  if (!engine || !existsSync(engine)) throw new Error('缺少有效的 --engine');
  const heartbeatSeconds = Math.max(1, Number(args.heartbeat || 60));
  const stateDir = join(task, '08-运行状态');
  const statePath = join(stateDir, 'long-task.json');
  const logPath = join(stateDir, 'run-safe.log');
  mkdirSync(stateDir, {recursive: true});

  const previous = readState(statePath);
  if (previous?.status === 'running' && isAlive(previous.child_pid)) {
    printStatus(previous);
    throw new Error(`已有生产进程仍在运行，拒绝重复启动：PID ${previous.child_pid}`);
  }

  writeFileSync(logPath, '', 'utf8');
  const startedAt = isoNow();
  const state = {
    schema_version: 1,
    status: 'running',
    health: 'starting',
    stage: 'starting',
    task,
    supervisor_pid: process.pid,
    child_pid: null,
    started_at: startedAt,
    last_heartbeat_at: startedAt,
    last_output_at: startedAt,
    quiet_heartbeats: 0,
    gpu: gpuSnapshot(),
    media: mediaSnapshot(task),
    log_path: logPath,
    exit_code: null,
  };
  atomicWrite(statePath, state);

  const childArgs = [engine, 'run-safe', '--task', task];
  if (args['dry-run']) childArgs.push('--dry-run');
  const child = spawn(process.execPath, childArgs, {
    cwd: process.cwd(),
    env: {...process.env, ARONG_MONITORED_RUN: '1'},
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  state.child_pid = child.pid;
  state.health = 'active';
  atomicWrite(statePath, state);

  let outputTail = '';
  let outputVersion = 0;
  let heartbeatOutputVersion = 0;
  const onData = (stream, chunk) => {
    const text = chunk.toString('utf8');
    appendFileSync(logPath, text, 'utf8');
    stream.write(text);
    outputTail = `${outputTail}${text}`.slice(-16000);
    outputVersion += 1;
    state.stage = inferStage(text, state.stage);
    state.last_output_at = isoNow();
    state.health = 'active';
  };
  child.stdout.on('data', (chunk) => onData(process.stdout, chunk));
  child.stderr.on('data', (chunk) => onData(process.stderr, chunk));

  const heartbeat = () => {
    const hasNewOutput = outputVersion !== heartbeatOutputVersion;
    heartbeatOutputVersion = outputVersion;
    state.quiet_heartbeats = hasNewOutput ? 0 : state.quiet_heartbeats + 1;
    state.health = state.quiet_heartbeats >= 3 ? 'quiet_check_required' : 'active';
    state.last_heartbeat_at = isoNow();
    state.gpu = gpuSnapshot();
    state.media = mediaSnapshot(task);
    atomicWrite(statePath, state);
    const elapsed = Math.round((Date.now() - Date.parse(startedAt)) / 1000);
    console.log(`[arong-heartbeat] stage=${state.stage} elapsed=${elapsed}s pid=${state.child_pid} health=${state.health} gpu=${state.gpu?.utilization_percent ?? 'n/a'}% log=${logPath}`);
  };
  const timer = setInterval(heartbeat, heartbeatSeconds * 1000);

  const stop = (signal) => {
    state.status = 'interrupted';
    state.health = `signal_${signal}`;
    state.last_heartbeat_at = isoNow();
    atomicWrite(statePath, state);
    child.kill(signal);
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));

  const exitCode = await new Promise((resolveExit) => {
    child.once('exit', (code, signal) => resolveExit({code: code ?? 1, signal}));
    child.once('error', (error) => {
      appendFileSync(logPath, `\n${error.stack || error.message}\n`, 'utf8');
      resolveExit({code: 1, signal: null});
    });
  });
  clearInterval(timer);
  heartbeat();
  const waiting = /"status"\s*:\s*"WAITING_(?:USER|AGENT)"/u.test(outputTail);
  state.status = waiting ? 'waiting' : exitCode.code === 0 ? 'completed' : 'failed';
  state.health = waiting ? 'needs_input' : exitCode.code === 0 ? 'finished' : 'error';
  state.exit_code = exitCode.code;
  state.signal = exitCode.signal;
  state.finished_at = isoNow();
  state.last_heartbeat_at = state.finished_at;
  state.gpu = gpuSnapshot();
  state.media = mediaSnapshot(task);
  atomicWrite(statePath, state);
  printStatus(state);
  process.exitCode = exitCode.code;
}

const {command, args} = parseArgs(process.argv.slice(2));
const task = args.task ? resolve(String(args.task)) : null;

try {
  if (command === 'status') {
    if (!task) throw new Error('缺少 --task');
    showStatus(task);
  } else if (command === 'run') {
    await runMonitored(args);
  } else {
    throw new Error(`未知命令：${command}`);
  }
} catch (error) {
  console.error(`错误：${error.message}`);
  process.exitCode = 1;
}
