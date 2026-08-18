/**
 * store.js — Single data-access module.
 *
 * EVERY read/write of persisted data goes through here. No route, controller, or
 * helper touches `fs` directly. That is the whole point: to migrate off flat files
 * onto Postgres you reimplement the exported functions below and change nothing else.
 *
 * Storage model (prototype scale, per the PRD):
 *   - Flat JSON files in data/
 *   - Writes are full-file rewrites: read -> mutate -> write
 *   - No concurrent-write handling; a single in-process mutex serialises writes
 *     just enough to stop one request clobbering another mid-flight.
 *
 * Serverless (Vercel/Lambda) note:
 *   The deployment bundle is mounted READ-ONLY — only /tmp is writable. Writing
 *   straight into the bundled data/ directory fails with EROFS, which is what
 *   turned every "add employee" / "record attendance" / "pay salaries" button
 *   into a 500. So on serverless we treat the bundled data/ as a read-only SEED
 *   and keep the live copy in a writable scratch directory, seeding it lazily on
 *   the first touch of each collection.
 *
 *   Consequence: edits live as long as the warm instance does. A cold start —
 *   or a second concurrent instance — starts again from the seed. That is the
 *   ceiling of a flat-file store on serverless; swap these functions for a real
 *   database (Postgres/KV) when the data needs to outlive the container.
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The dataset shipped with the code. Always readable, not always writable. */
const SEED_DIR = path.join(__dirname, '..', 'data');

/** True on Vercel and other Lambda-backed runtimes with a read-only bundle. */
const IS_SERVERLESS = Boolean(
  process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.LAMBDA_TASK_ROOT
);

/**
 * Where live data actually lives. An explicit DATA_DIR always wins; otherwise
 * serverless gets a writable scratch dir and everything else uses the repo copy.
 */
let DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : IS_SERVERLESS
    ? path.join(os.tmpdir(), 'hr-core-data')
    : SEED_DIR;

const COLLECTIONS = ['users', 'employees', 'attendance', 'payroll', 'notifications'];

/** Errors that mean "this directory is not writable", not "this write is wrong". */
const READ_ONLY_CODES = new Set(['EROFS', 'EACCES', 'EPERM']);

/* ------------------------------------------------------------------ *
 * Low-level file IO
 * ------------------------------------------------------------------ */

const filePathFor = (collection, dir = DATA_DIR) =>
  path.join(dir, `${collection}.json`);

/**
 * Serialises writes per-collection. Without this, two concurrent POSTs both read
 * the file, both mutate their own copy, and the slower write wins — silently
 * dropping a record. A promise chain per collection is enough at this scale.
 */
const writeLocks = new Map();

function withLock(collection, fn) {
  const prev = writeLocks.get(collection) || Promise.resolve();
  const next = prev.then(fn, fn);
  // Keep the chain alive but don't let a rejection poison subsequent writes.
  writeLocks.set(
    collection,
    next.catch(() => {})
  );
  return next;
}

/** Collections already copied out of the seed into DATA_DIR this process. */
const seeded = new Set();

/**
 * Make sure DATA_DIR holds a working copy of `collection` before we read or
 * write it. No-op when DATA_DIR *is* the seed directory (normal local dev).
 */
async function ensureSeeded(collection) {
  if (DATA_DIR === SEED_DIR || seeded.has(collection)) return;

  const target = filePathFor(collection);
  try {
    await fs.access(target);
    seeded.add(collection);
    return;
  } catch {
    /* not copied yet — fall through */
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  let contents = '[]';
  try {
    contents = await fs.readFile(filePathFor(collection, SEED_DIR), 'utf8');
  } catch {
    // No seed file shipped (notifications start empty) — an empty array is the
    // right starting point rather than a hard failure.
  }
  await fs.writeFile(target, contents, 'utf8');
  seeded.add(collection);
}

/**
 * Last-resort recovery: a write blew up because the directory is read-only in a
 * way we did not predict from env vars. Relocate to a writable scratch dir,
 * carrying the current contents across, so the request can be retried once.
 * Returns true if the relocation happened.
 */
async function relocateToWritableDir() {
  const scratch = path.join(os.tmpdir(), 'hr-core-data');
  if (DATA_DIR === scratch) return false;

  const previousDir = DATA_DIR;
  await fs.mkdir(scratch, { recursive: true });
  for (const collection of COLLECTIONS) {
    const dest = path.join(scratch, `${collection}.json`);
    try {
      await fs.access(dest);
      continue; // already relocated by an earlier request
    } catch {
      /* needs copying */
    }
    let contents = '[]';
    try {
      contents = await fs.readFile(filePathFor(collection, previousDir), 'utf8');
    } catch {
      /* missing source — start empty */
    }
    await fs.writeFile(dest, contents, 'utf8');
  }
  DATA_DIR = scratch;
  COLLECTIONS.forEach((c) => seeded.add(c));
  console.warn(
    `[store] ${previousDir} is read-only — live data relocated to ${scratch}. ` +
      'Changes will reset when the instance restarts.'
  );
  return true;
}

async function readFile(collection) {
  assertCollection(collection);
  await ensureSeeded(collection);
  try {
    const raw = await fs.readFile(filePathFor(collection), 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new StoreError(
        `Data file ${collection}.json is not a JSON array.`,
        'ECORRUPT'
      );
    }
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new StoreError(
        `Data file ${collection}.json is missing. Run "npm run seed" to restore it.`,
        'ENOSEED'
      );
    }
    if (err instanceof SyntaxError) {
      throw new StoreError(
        `Data file ${collection}.json contains invalid JSON. Run "npm run reset" to restore the seed.`,
        'ECORRUPT'
      );
    }
    throw err;
  }
}

async function writeOnce(collection, rows) {
  const target = filePathFor(collection);
  const tmp = `${target}.${process.pid}.tmp`;
  // Write to a temp file then rename. Rename is atomic on POSIX, so a crash
  // mid-write leaves the previous good file intact rather than a truncated one.
  await fs.writeFile(tmp, JSON.stringify(rows, null, 2), 'utf8');
  await fs.rename(tmp, target);
  return rows;
}

async function writeFile(collection, rows) {
  assertCollection(collection);
  await ensureSeeded(collection);
  try {
    return await writeOnce(collection, rows);
  } catch (err) {
    if (!READ_ONLY_CODES.has(err.code)) throw err;
    // The target turned out to be read-only. Move the dataset somewhere writable
    // and retry once; if that still fails the environment is genuinely broken.
    const moved = await relocateToWritableDir();
    if (!moved) throw err;
    return writeOnce(collection, rows);
  }
}

function assertCollection(collection) {
  if (!COLLECTIONS.includes(collection)) {
    throw new StoreError(`Unknown collection "${collection}".`, 'EBADCOLLECTION');
  }
}

export class StoreError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------ *
 * Generic collection API — routes use only these
 * ------------------------------------------------------------------ */

export const newId = (prefix) =>
  `${prefix}_${crypto.randomBytes(6).toString('hex')}`;

/** Return every row, optionally filtered by a predicate. */
export async function list(collection, predicate) {
  const rows = await readFile(collection);
  return typeof predicate === 'function' ? rows.filter(predicate) : rows;
}

/** Return a single row by id, or null. */
export async function findById(collection, id) {
  const rows = await readFile(collection);
  return rows.find((r) => r.id === id) || null;
}

/** Return the first row matching a predicate, or null. */
export async function findOne(collection, predicate) {
  const rows = await readFile(collection);
  return rows.find(predicate) || null;
}

/** Append a row. Assigns an id if the caller didn't supply one. */
export async function insert(collection, row) {
  return withLock(collection, async () => {
    const rows = await readFile(collection);
    const record = {
      id: row.id || newId(collection.slice(0, 3)),
      ...row,
      createdAt: row.createdAt || new Date().toISOString(),
    };
    rows.push(record);
    await writeFile(collection, rows);
    return record;
  });
}

/** Shallow-merge `patch` into the row with `id`. Returns the updated row, or null. */
export async function update(collection, id, patch) {
  return withLock(collection, async () => {
    const rows = await readFile(collection);
    const idx = rows.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    // id and createdAt are immutable — a PUT body must not be able to rewrite them.
    const { id: _ignoredId, createdAt: _ignoredCreated, ...safePatch } = patch;
    rows[idx] = {
      ...rows[idx],
      ...safePatch,
      updatedAt: new Date().toISOString(),
    };
    await writeFile(collection, rows);
    return rows[idx];
  });
}

/** Remove the row with `id`. Returns the removed row, or null. */
export async function remove(collection, id) {
  return withLock(collection, async () => {
    const rows = await readFile(collection);
    const idx = rows.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    const [removed] = rows.splice(idx, 1);
    await writeFile(collection, rows);
    return removed;
  });
}

/** Remove every row matching a predicate. Returns the count removed. */
export async function removeWhere(collection, predicate) {
  return withLock(collection, async () => {
    const rows = await readFile(collection);
    const kept = rows.filter((r) => !predicate(r));
    const removedCount = rows.length - kept.length;
    if (removedCount > 0) await writeFile(collection, kept);
    return removedCount;
  });
}

/** Replace an entire collection. Used by the seed script. */
export async function replaceAll(collection, rows) {
  return withLock(collection, () => writeFile(collection, rows));
}

/** Verify every data file is present and parseable. Called once at boot. */
export async function healthCheck() {
  const report = {};
  for (const collection of COLLECTIONS) {
    try {
      const rows = await readFile(collection);
      report[collection] = { ok: true, count: rows.length };
    } catch (err) {
      report[collection] = { ok: false, error: err.message };
    }
  }
  return report;
}

export { COLLECTIONS, DATA_DIR };
