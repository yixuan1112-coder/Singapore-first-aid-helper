// Render the PROPER live demo's Qwen3-TTS voices from demo/proper-281.json into
// public/demo/voice-proper/. Detached from Codex's ai-demo-voice.mjs / voice/.
//
//   node scripts/proper-demo-voice.mjs                 # preflight only
//   node scripts/proper-demo-voice.mjs --render        # synthesize missing WAVs
//   node scripts/proper-demo-voice.mjs --render --force # re-render all
//   node scripts/proper-demo-voice.mjs --render --scene=resident-intro
import { spawnSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const storyboardPath = path.join(repoRoot, 'demo', 'proper-281.json');
const defaultQwenRoot = path.join(process.env.HOME ?? '', '.aiko-core', 'workspace', 'tmp', 'qwen-tts-basic', 'qwentts.cpp');
const qwenRoot = process.env.AIKO_QWEN_ROOT || defaultQwenRoot;
const outputDir = path.resolve(process.env.KK_PROPER_AUDIO_DIR || path.join(repoRoot, 'public', 'demo', 'voice-proper'));

const args = new Set(process.argv.slice(2));
const sceneArg = process.argv.find((a) => a.startsWith('--scene='));
const selectedScene = sceneArg?.slice('--scene='.length);
const render = args.has('--render');
const force = args.has('--force');
const SEED_BASE = 281;

const paths = {
  binary: path.join(qwenRoot, 'build', 'qwen-tts'),
  model: path.join(qwenRoot, 'models', 'qwen-talker-0.6b-base-Q4_K_M.gguf'),
  codec: path.join(qwenRoot, 'models', 'qwen-tokenizer-12hz-Q4_K_M.gguf'),
};

async function mustExist(label, target) {
  try { await access(target); } catch { throw new Error(`${label} not found: ${target}`); }
}
function run(command, commandArgs, options = {}) {
  const stdio = options.stdinFile
    ? [options.stdinFile, options.capture ? 'pipe' : 'inherit', options.capture ? 'pipe' : 'inherit']
    : ['pipe', options.capture ? 'pipe' : 'inherit', options.capture ? 'pipe' : 'inherit'];
  const result = spawnSync(command, commandArgs, { cwd: repoRoot, encoding: 'utf8', stdio, input: options.input });
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stderr || result.stdout}` : '';
    throw new Error(`${command} exited with ${result.status}${detail}`);
  }
  return result.stdout?.trim() ?? '';
}

const storyboard = JSON.parse(await readFile(storyboardPath, 'utf8'));
const references = Object.fromEntries(
  Object.entries(storyboard.voices).map(([id, voice]) => {
    const base = path.join(qwenRoot, voice.reference);
    return [id, { ...voice, base, wav: `${base}.wav`, text: `${base}.txt` }];
  }),
);

await Promise.all([
  mustExist('Qwen runner', paths.binary),
  mustExist('Qwen talker model', paths.model),
  mustExist('Qwen codec model', paths.codec),
  ...Object.entries(references).flatMap(([id, voice]) => [
    mustExist(`Voice reference WAV (${id})`, voice.wav),
    mustExist(`Voice reference transcript (${id})`, voice.text),
  ]),
]);
run('ffprobe', ['-version'], { capture: true });

const scenes = storyboard.scenes
  .map((scene, storyboardIndex) => ({ scene, storyboardIndex }))
  .filter(({ scene }) => scene.narration && (!selectedScene || scene.id === selectedScene));
if (selectedScene && scenes.length === 0) throw new Error(`Unknown scene: ${selectedScene}`);

console.log(`[proper-voice] qwen root: ${qwenRoot}`);
console.log(`[proper-voice] output: ${outputDir}`);
console.log(`[proper-voice] scenes: ${scenes.map(({ scene }) => scene.id).join(', ')}`);
if (!render) { console.log('[proper-voice] preflight passed; add --render to synthesize'); process.exit(0); }

await mkdir(outputDir, { recursive: true });
const rendered = [];
for (const { scene, storyboardIndex } of scenes) {
  const output = path.join(outputDir, `${scene.id}.wav`);
  const voice = references[scene.voice];
  if (!voice) throw new Error(`Scene ${scene.id} uses unknown voice: ${scene.voice}`);
  if (!force) {
    try { await access(output); console.log(`[proper-voice] keep ${scene.id}.wav`); rendered.push({ scene: scene.id, voice: scene.voice, file: output }); continue; } catch { /* render */ }
  }
  console.log(`[proper-voice] render ${scene.id} (${scene.voice}): ${scene.narration.slice(0, 70)}…`);
  const inputPath = path.join(outputDir, `.${scene.id}.txt`);
  await writeFile(inputPath, `${scene.narration}\n`);
  const fd = openSync(inputPath, 'r');
  run(paths.binary, [
    '--model', paths.model,
    '--codec', paths.codec,
    '--lang', voice.language ?? 'english',
    '--ref-wav', voice.wav,
    '--ref-text', voice.text,
    '--seed', String(SEED_BASE + storyboardIndex),
    '-o', output,
  ], { stdinFile: fd });
  closeSync(fd);
  await unlink(inputPath).catch(() => {});
  const duration = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', output], { capture: true });
  console.log(`[proper-voice]   → ${scene.id}.wav (${Number(duration).toFixed(1)}s)`);
  rendered.push({ scene: scene.id, voice: scene.voice, file: output, durationSeconds: Number(duration) });
}
await writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify({ story: storyboard.id, scenes: rendered.map((r) => ({ scene: r.scene })) }, null, 2)}\n`);
console.log(`[proper-voice] done — ${rendered.length} scenes in ${outputDir}`);
