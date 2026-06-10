import { spawnSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const storyboardPath = path.join(repoRoot, 'demo', 'incident-281.json');
const defaultQwenRoot = path.join(
  process.env.HOME ?? '',
  '.aiko-core',
  'workspace',
  'tmp',
  'qwen-tts-basic',
  'qwentts.cpp',
);

const args = new Set(process.argv.slice(2));
const sceneArg = process.argv.find((arg) => arg.startsWith('--scene='));
const selectedScene = sceneArg?.slice('--scene='.length);
const render = args.has('--render');
const force = args.has('--force');
const qwenRoot = process.env.AIKO_QWEN_ROOT || defaultQwenRoot;
const outputDir = path.resolve(
  process.env.KK_DEMO_AUDIO_DIR || path.join(repoRoot, 'public', 'demo', 'voice'),
);

const paths = {
  binary: path.join(qwenRoot, 'build', 'qwen-tts'),
  model: path.join(qwenRoot, 'models', 'qwen-talker-0.6b-base-Q4_K_M.gguf'),
  codec: path.join(qwenRoot, 'models', 'qwen-tokenizer-12hz-Q4_K_M.gguf'),
};

async function mustExist(label, target) {
  try {
    await access(target);
  } catch {
    throw new Error(`${label} not found: ${target}`);
  }
}

function run(command, commandArgs, options = {}) {
  const stdio = options.stdinFile
    ? [options.stdinFile, options.capture ? 'pipe' : 'inherit', options.capture ? 'pipe' : 'inherit']
    : ['pipe', options.capture ? 'pipe' : 'inherit', options.capture ? 'pipe' : 'inherit'];
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio,
    input: options.input,
  });
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stderr || result.stdout}` : '';
    throw new Error(`${command} exited with ${result.status}${detail}`);
  }
  return result.stdout?.trim() ?? '';
}

const storyboard = JSON.parse(await readFile(storyboardPath, 'utf8'));
const voiceEntries = Object.entries(storyboard.voices ?? {
  default: storyboard.voice,
});
const references = Object.fromEntries(
  voiceEntries.map(([id, voice]) => {
    const base = process.env.KK_QWEN_VOICE
      ? path.resolve(process.env.KK_QWEN_VOICE)
      : path.join(qwenRoot, voice.reference);
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
if (selectedScene && scenes.length === 0) {
  throw new Error(`Unknown or silent scene: ${selectedScene}`);
}

console.log(`[voice] qwen root: ${qwenRoot}`);
console.log(`[voice] references: ${Object.entries(references).map(([id, voice]) => `${id}=${voice.base}`).join(', ')}`);
console.log(`[voice] output: ${outputDir}`);
console.log(`[voice] scenes: ${scenes.map(({ scene }) => scene.id).join(', ')}`);

if (!render) {
  console.log('[voice] preflight passed; add --render to synthesize WAV files');
  process.exit(0);
}

await mkdir(outputDir, { recursive: true });
const manifestPath = path.join(outputDir, 'manifest.json');
let existingManifest = [];
if (selectedScene) {
  try {
    const parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
    existingManifest = Array.isArray(parsed.scenes) ? parsed.scenes : [];
  } catch {
    // A selected render can start without a previous manifest.
  }
}
const renderedScenes = [];

for (const { scene, storyboardIndex } of scenes) {
  const output = path.join(outputDir, `${scene.id}.wav`);
  const voiceId = scene.voice ?? 'default';
  const voice = references[voiceId] ?? references.default;
  if (!voice) throw new Error(`Scene ${scene.id} uses unknown voice: ${voiceId}`);
  if (!force) {
    try {
      await access(output);
      console.log(`[voice] keep existing ${path.basename(output)}`);
      const duration = run(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', output],
        { capture: true },
      );
      renderedScenes.push({ scene: scene.id, voice: voiceId, reference: voice.label ?? voice.base, file: output, durationSeconds: Number(duration) });
      continue;
    } catch {
      // Render missing files.
    }
  }

  console.log(`[voice] render ${scene.id}: ${scene.narration}`);
  const inputPath = path.join(outputDir, `.${scene.id}.txt`);
  await writeFile(inputPath, `${scene.narration}\n`);
  const inputFd = openSync(inputPath, 'r');
  run(
    paths.binary,
    [
      '--model', paths.model,
      '--codec', paths.codec,
      '--lang', voice.language ?? storyboard.voice.language,
      '--ref-wav', voice.wav,
      '--ref-text', voice.text,
      '--seed', String(storyboard.voice.seed + storyboardIndex),
      '-o', output,
    ],
    { stdinFile: inputFd },
  );
  closeSync(inputFd);
  await unlink(inputPath).catch(() => {});
  const duration = run(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', output],
    { capture: true },
  );
  renderedScenes.push({ scene: scene.id, voice: voiceId, reference: voice.label ?? voice.base, file: output, durationSeconds: Number(duration) });
}

const renderedById = new Map(renderedScenes.map((scene) => [scene.scene, scene]));
const manifest = selectedScene
  ? storyboard.scenes
      .map((scene) => renderedById.get(scene.id) ?? existingManifest.find((entry) => entry.scene === scene.id))
      .filter(Boolean)
  : renderedScenes;
await writeFile(manifestPath, `${JSON.stringify({ story: storyboard.id, scenes: manifest }, null, 2)}\n`);
console.log(`[voice] wrote ${manifestPath}`);
