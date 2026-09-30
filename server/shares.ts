import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { sanitizeShareSnapshot, type ShareSnapshot } from './shareSchema.ts';

const SHARES_DIR = resolve('.data/shares');
const INDEX_PATH = join(SHARES_DIR, 'index.json');

const SHARE_ID_RE = /^[A-Za-z0-9_-]{16}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

interface ShareRecord {
  id: string;
  tokenHash: string;
  manageKeyHash: string;
  createdAt: string;
  updatedAt: string;
  snapshot: ShareSnapshot;
}

interface ShareIndex {
  /** sha256(token) → share id. Only the current token of each share is listed. */
  tokens: Record<string, string>;
}

export class ShareError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface ShareCredentials {
  shareId: string;
  token: string;
  manageKey: string;
}

export interface SharedBinderView {
  snapshot: ShareSnapshot;
  updatedAt: string;
}

function secret(): string {
  return randomBytes(32).toString('base64url');
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

async function writeJsonAtomic(path: string, value: unknown) {
  await mkdir(SHARES_DIR, { recursive: true });
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(value));
  await rename(tmp, path);
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function recordPath(shareId: string) {
  return join(SHARES_DIR, `${shareId}.json`);
}

async function readIndex(): Promise<ShareIndex> {
  return (await readJson<ShareIndex>(INDEX_PATH)) ?? { tokens: {} };
}

let queue: Promise<unknown> = Promise.resolve();

/** Runs store mutations one at a time so the index and record files never interleave. */
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

async function authorizedRecord(shareId: string, manageKey: string): Promise<ShareRecord> {
  if (!SHARE_ID_RE.test(shareId)) throw new ShareError('Share not found.', 404);
  const record = await readJson<ShareRecord>(recordPath(shareId));
  if (!record) throw new ShareError('Share not found.', 404);
  if (!SECRET_RE.test(manageKey) || !sameHash(hash(manageKey), record.manageKeyHash)) {
    throw new ShareError('Not allowed to manage this share.', 403);
  }
  return record;
}

export function createShare(rawSnapshot: unknown): Promise<ShareCredentials> {
  const snapshot = sanitizeShareSnapshot(rawSnapshot);
  return serialized(async () => {
    const shareId = randomBytes(12).toString('base64url');
    const token = secret();
    const manageKey = secret();
    const now = new Date().toISOString();
    const record: ShareRecord = {
      id: shareId,
      tokenHash: hash(token),
      manageKeyHash: hash(manageKey),
      createdAt: now,
      updatedAt: now,
      snapshot,
    };
    await writeJsonAtomic(recordPath(shareId), record);
    const index = await readIndex();
    index.tokens[record.tokenHash] = shareId;
    await writeJsonAtomic(INDEX_PATH, index);
    return { shareId, token, manageKey };
  });
}

export function updateShare(
  shareId: string,
  manageKey: string,
  rawSnapshot: unknown,
): Promise<{ updatedAt: string }> {
  const snapshot = sanitizeShareSnapshot(rawSnapshot);
  return serialized(async () => {
    const record = await authorizedRecord(shareId, manageKey);
    record.snapshot = snapshot;
    record.updatedAt = new Date().toISOString();
    await writeJsonAtomic(recordPath(shareId), record);
    return { updatedAt: record.updatedAt };
  });
}

/** Issues a new guest token; the previous link stops working immediately. */
export function regenerateShareToken(shareId: string, manageKey: string): Promise<{ token: string }> {
  return serialized(async () => {
    const record = await authorizedRecord(shareId, manageKey);
    const token = secret();
    const index = await readIndex();
    delete index.tokens[record.tokenHash];
    record.tokenHash = hash(token);
    index.tokens[record.tokenHash] = shareId;
    await writeJsonAtomic(recordPath(shareId), record);
    await writeJsonAtomic(INDEX_PATH, index);
    return { token };
  });
}

export function deleteShare(shareId: string, manageKey: string): Promise<void> {
  return serialized(async () => {
    const record = await authorizedRecord(shareId, manageKey);
    const index = await readIndex();
    delete index.tokens[record.tokenHash];
    await writeJsonAtomic(INDEX_PATH, index);
    await rm(recordPath(shareId), { force: true });
  });
}

export async function getSharedBinder(token: string): Promise<SharedBinderView | null> {
  if (!SECRET_RE.test(token)) return null;
  const tokenHash = hash(token);
  const shareId = (await readIndex()).tokens[tokenHash];
  if (!shareId || !SHARE_ID_RE.test(shareId)) return null;
  const record = await readJson<ShareRecord>(recordPath(shareId));
  if (!record || !sameHash(record.tokenHash, tokenHash)) return null;
  return { snapshot: record.snapshot, updatedAt: record.updatedAt };
}
