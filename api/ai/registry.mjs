// Skill registry — the aiko idiom adapted to this JS/serverless project.
//
// Scans api/ai/skills/<id>/ for { manifest.json, skill.mjs }, exposes every
// primitive skill to the LLM as a callable tool (toolSpecs), and executes a
// skill body by id (runSkill). The manifest is the contract; the body reads
// inputs and returns the canonical { status, ... } shape. The LLM picks tools
// from manifests alone — same as aiko-core's SKILL_LAW §13.

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(here, 'skills');

let _index = null;

export async function loadRegistry() {
  if (_index) return _index;
  const out = [];
  let entries = [];
  try { entries = await readdir(SKILLS_DIR, { withFileTypes: true }); } catch { entries = []; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      const manifest = JSON.parse(await readFile(join(SKILLS_DIR, e.name, 'manifest.json'), 'utf-8'));
      if (manifest.id !== e.name) continue; // law §1: folder name == manifest.id
      const mod = await import(new URL(`./skills/${e.name}/skill.mjs`, import.meta.url).href);
      if (typeof mod.run !== 'function') continue;
      out.push({ manifest, run: mod.run });
    } catch { /* malformed skill — skip, don't register */ }
  }
  _index = out;
  return out;
}

// Tool schemas for the LLM (primitive skills only). Shape is provider-neutral
// (name + description + JSON-schema input) — adapt to OpenRouter/Anthropic.
export async function toolSpecs() {
  const reg = await loadRegistry();
  return reg
    .filter((s) => s.manifest.primitive === true)
    .map((s) => ({ name: s.manifest.id, description: s.manifest.description, input_schema: manifestSchema(s.manifest) }));
}

// `context` carries the live operating picture the CLIENT already holds (its CSOT
// snapshot: responders, sos, reports, conditions, location). Skills read it so
// the AI reasons over data already in hand — no new upstream calls.
export async function runSkill(id, inputs, context) {
  const reg = await loadRegistry();
  const s = reg.find((x) => x.manifest.id === id);
  if (!s) return { status: 'error', error: `unknown skill: ${id}`, retryable: false, hint: 'call a skill listed in toolSpecs()' };
  try {
    return await s.run(inputs ?? {}, context ?? {});
  } catch (err) {
    return { status: 'error', error: String(err?.message ?? err), retryable: false };
  }
}

// Tool specs filtered to an agent's allowed skill ids ('*' = all primitives).
export async function toolSpecsFor(allowed) {
  const all = await toolSpecs();
  if (!allowed || allowed === '*') return all;
  const set = new Set(allowed);
  return all.filter((t) => set.has(t.name));
}

function manifestSchema(m) {
  const properties = {};
  const required = [];
  for (const i of m.inputs ?? []) {
    const base = i.type === 'number' ? { type: 'number' } : i.type === 'bool' ? { type: 'boolean' } : { type: 'string' };
    if (i.type === 'enum') { base.type = 'string'; base.enum = i.allowed ?? []; }
    base.description = i.description;
    properties[i.name] = base;
    if (i.required) required.push(i.name);
  }
  return { type: 'object', properties, required };
}
