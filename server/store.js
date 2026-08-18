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
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

const COLLECTIONS = ['users', 'employees', 'attendance', 'payroll', 'notifications'];

/* ------------------------------------------------------------------ *
 * Low-level file IO
 * ------------------------------------------------------------------ */

const filePathFor = (collection) => path.join(DATA_DIR, `${collection}.json`);

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

async function readFile(collection) {
  assertCollection(collection);
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

async function writeFile(collection, rows) {
  assertCollection(collection);
  const target = filePathFor(collection);
  const tmp = `${target}.${process.pid}.tmp`;
  // Write to a temp file then rename. Rename is atomic on POSIX, so a crash
  // mid-write leaves the previous good file intact rather than a truncated one.
  await fs.writeFile(tmp, JSON.stringify(rows, null, 2), 'utf8');
  await fs.rename(tmp, target);
  return rows;
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
