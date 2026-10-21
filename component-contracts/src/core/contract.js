/**
 * Contract loading, saving, and normalisation.
 *
 * The contract is the source of truth. It is authored through the UI (or by
 * hand) and stored as JSON so that any toolchain can read it.
 */

import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';

/*
 * Every web -> iOS / Android mapping lives in src/core/platform-map.js.
 * Re-exported here so existing importers keep working, but there is only one
 * definition of each table.
 */
export {
  SAFE_ANIMATABLE,
  UNSAFE_ANIMATABLE,
  ANIMATABLE_PROPERTY,
  POINTER_ONLY_STATES,
  A11Y_ROLES,
} from './platform-map.js';

// A re-export does not create a local binding, and this module uses it.
import { POINTER_ONLY_STATES } from './platform-map.js';
import { join } from 'node:path';

export const REDUCED_MOTION_MODES = ['instant', 'fade', 'none'];
export const PLATFORMS = ['ios', 'android'];

/**
 * Size-scoped properties every style row must carry.
 *
 * Kept to what a platform genuinely cannot proceed without. Demanding more
 * would make the tool impose decisions the design never made — if a component
 * never sets a line height, inventing a requirement for one is noise, not
 * rigour.
 *
 * This lives here rather than in the validator because BOTH the validator and
 * the closure gate need it: a key simply absent from a size block would slip
 * through the gate unnoticed, since you cannot iterate a key that is not there.
 */
export const REQUIRED_SIZE_KEYS = ['padX', 'padY', 'radius', 'fontSize'];

/**
 * Worth having, but not worth blocking on. Flagged as a warning, and carried
 * into the spec only when every size defines it, so the generated struct keeps
 * a consistent shape.
 */
export const OPTIONAL_SIZE_KEYS = ['gap', 'fontWeight', 'lineHeight', 'letterSpacing', 'minHeight'];

/* ------------------------------------------------------------------ *
 * Blank contract
 * ------------------------------------------------------------------ */

/**
 * An empty contract.
 *
 * Deliberately bare. Every field a component has must come from reading that
 * component — a seeded `role: button`, a default hit area, or a placeholder
 * state machine would all be claims the source never made, and would be
 * indistinguishable from real findings once the importer filled the rest in.
 */
export function blankContract(id, name) {
  const display = name || id.charAt(0).toUpperCase() + id.slice(1);
  return {
    $schema: '../schema/contract.schema.json',
    id,
    name: display,
    description: '',
    contractVersion: '0.1.0',
    platforms: [...PLATFORMS],
    tokens: {},

    props: {},
    states: [],

    appearance: { roles: [], byVariant: {}, bySize: {} },
    layout: { childOrder: [] },
    composition: { children: {} },
    behavior: { initial: null, guards: {}, states: {} },
    motion: { transitions: [], loops: [] },
    a11y: {},
    adaptable: {},
  };
}

/* ------------------------------------------------------------------ *
 * Normalisation — fill in optional structures so downstream code can
 * assume they exist.
 * ------------------------------------------------------------------ */

export function normalise(contract) {
  const c = structuredClone(contract);

  c.platforms ||= [...PLATFORMS];
  c.tokens ||= {};
  c.states ||= [];
  c.props ||= {};
  c.appearance ||= { roles: [], byVariant: {}, bySize: {} };
  c.appearance.roles ||= [];
  c.appearance.byVariant ||= {};
  c.appearance.bySize ||= {};
  // Layout is recorded only as far as the component states it. Seeding a
  // direction or a hug/fill sizing would be a claim the source never made.
  c.layout ||= { childOrder: [] };
  c.layout.childOrder ||= [];
  c.composition ||= { children: {} };
  c.composition.children ||= {};
  c.behavior ||= { initial: c.states[0] || 'idle', guards: {}, states: {} };
  c.behavior.guards ||= {};
  c.behavior.states ||= {};
  c.motion ||= { transitions: [], loops: [] };
  c.motion.transitions ||= [];
  c.motion.loops ||= [];
  c.a11y ||= {};
  c.a11y.state ||= {};
  c.a11y.focus ||= { focusable: true };
  c.a11y.keyboard ||= [];
  c.adaptable ||= {};

  // A blank role value means "inherit from the resting state", which is what
  // an absent key already means. Keeping it would pin the role to an empty
  // value and fail the closure gate.
  for (const block of Object.values(c.appearance.byVariant)) {
    for (const [stateName, roleMap] of Object.entries(block || {})) {
      if (!roleMap || typeof roleMap !== 'object') continue;
      for (const [role, value] of Object.entries(roleMap)) {
        if (value === '' || value === null) delete roleMap[role];
      }
      void stateName;
    }
  }
  for (const metrics of Object.values(c.appearance.bySize)) {
    for (const [key, value] of Object.entries(metrics || {})) {
      if (value === '' || value === null) delete metrics[key];
    }
  }

  return c;
}

/** Variant / size axis values, derived from props marked `axis: true`. */
export function axesOf(contract) {
  const axes = {};
  for (const [name, def] of Object.entries(contract.props || {})) {
    if (def?.axis && def.kind === 'enum') axes[name] = [...(def.values || [])];
  }
  axes.state = [...(contract.states || [])];
  return axes;
}

/** States applicable to a platform — pointer-only states are stripped on touch. */
export function statesForPlatform(contract, platform) {
  const declared = contract.states || [];
  if (platform === 'web') return [...declared];
  return declared.filter((s) => !POINTER_ONLY_STATES.has(s));
}

/* ------------------------------------------------------------------ *
 * Disk I/O
 * ------------------------------------------------------------------ */

export async function listContracts(dir) {
  let entries = [];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const file of entries) {
    if (!file.endsWith('.contract.json') || file.startsWith('.')) continue;
    try {
      const raw = JSON.parse(await readFile(join(dir, file), 'utf8'));
      out.push({
        id: raw.id,
        name: raw.name || raw.id,
        description: raw.description || '',
        contractVersion: raw.contractVersion || '0.0.0',
        variants: raw.props?.variant?.values?.length || 0,
        states: raw.states?.length || 0,
        file,
      });
    } catch {
      out.push({ id: file.replace('.contract.json', ''), name: file, broken: true, file });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export async function loadContract(dir, id) {
  const raw = await readFile(join(dir, `${id}.contract.json`), 'utf8');
  return normalise(JSON.parse(raw));
}

/** Rough measure of how much decision-making a contract contains. */
export function contentWeight(contract) {
  let n = 0;
  for (const block of Object.values(contract?.appearance?.byVariant || {})) {
    for (const roles of Object.values(block || {})) n += Object.keys(roles || {}).length;
  }
  for (const metrics of Object.values(contract?.appearance?.bySize || {})) {
    n += Object.keys(metrics || {}).length;
  }
  n += (contract?.motion?.transitions || []).length * 3;
  n += Object.keys(contract?.adaptable || {}).length * 3;
  n += Object.keys(contract?.props || {}).length;
  return n;
}

/**
 * Save a contract, keeping a timestamped copy of whatever it replaces.
 *
 * Contracts hold decisions that exist nowhere else — not in the code, not in
 * Figma, not in anyone's head after a fortnight. A stale browser tab, a bad
 * import, or a mistaken overwrite should never be able to destroy them
 * permanently, so the previous version is always kept first.
 *
 * Pass `force` to accept a write that substantially empties an existing
 * contract; otherwise that is treated as a mistake and refused.
 */
export async function saveContract(dir, contract, { force = false } = {}) {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${contract.id}.contract.json`);

  let previous = null;
  try {
    previous = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    /* new contract */
  }

  if (previous) {
    const before = contentWeight(previous);
    const after = contentWeight(contract);

    // Losing more than half the decisions is almost never intentional.
    if (!force && before >= 12 && after < before / 2) {
      throw new Error(
        `Refusing to overwrite "${contract.id}": this would drop it from ${before} ` +
          `resolved values to ${after}. If that is intended, delete the contract explicitly first.`
      );
    }

    await snapshot(dir, contract.id, previous);
  }

  await writeFile(path, JSON.stringify(contract, null, 2) + '\n', 'utf8');
  return path;
}

/** Keep the last few versions of a contract next to it. */
async function snapshot(dir, id, contract) {
  const historyDir = join(dir, '.history');
  await mkdir(historyDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await writeFile(join(historyDir, `${id}.${stamp}.json`), JSON.stringify(contract, null, 2) + '\n', 'utf8');

  // Trim to the 20 most recent for this component.
  try {
    const kept = (await readdir(historyDir))
      .filter((f) => f.startsWith(`${id}.`) && f.endsWith('.json'))
      .sort()
      .reverse();
    for (const stale of kept.slice(20)) await rm(join(historyDir, stale), { force: true });
  } catch {
    /* trimming is best-effort */
  }
}

/** Previous versions of a contract, newest first. */
export async function listHistory(dir, id) {
  try {
    return (await readdir(join(dir, '.history')))
      .filter((f) => f.startsWith(`${id}.`) && f.endsWith('.json'))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export async function deleteContract(dir, id) {
  const path = join(dir, `${id}.contract.json`);
  await rm(path, { force: false });
  return path;
}
