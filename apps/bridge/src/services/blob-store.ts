import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config.js";
import type { CoreDatabase, CoreDmBlob } from "../core-db.js";

const MAX_BLOB_BYTES = 25 * 1024 * 1024;
const ALLOWED_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);
const ALLOWED_FILE_MIMES = new Set([
  ...ALLOWED_IMAGE_MIMES,
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/json",
]);

export function getBlobsDir(): string {
  const dir = path.join(config.dataDir, "blobs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getDmBlob(
  db: CoreDatabase,
  blobId: string
): CoreDmBlob | null {
  return (
    (db
      .prepare(`SELECT * FROM dm_blobs WHERE id = ?`)
      .get(blobId) as CoreDmBlob | undefined) ?? null
  );
}

export function storeDmBlob(
  db: CoreDatabase,
  opts: {
    ownerUserId: string;
    filename: string;
    mime: string;
    buffer: Buffer;
  }
): CoreDmBlob {
  if (opts.buffer.length > MAX_BLOB_BYTES) {
    throw new BlobStoreError("File exceeds 25MB limit");
  }
  const isImage = opts.mime.startsWith("image/");
  if (isImage && !ALLOWED_IMAGE_MIMES.has(opts.mime)) {
    throw new BlobStoreError(`Unsupported image type: ${opts.mime}`);
  }
  if (!isImage && !ALLOWED_FILE_MIMES.has(opts.mime)) {
    throw new BlobStoreError(`Unsupported file type: ${opts.mime}`);
  }

  const id = uuidv4();
  const ext = path.extname(opts.filename) || (isImage ? ".bin" : ".bin");
  const relPath = path.join(id.slice(0, 2), `${id}${ext}`);
  const absPath = path.join(getBlobsDir(), relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, opts.buffer);

  db.prepare(
    `INSERT INTO dm_blobs (id, owner_user_id, filename, mime, size, path)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, opts.ownerUserId, opts.filename, opts.mime, opts.buffer.length, relPath);

  return getDmBlob(db, id)!;
}

export function readDmBlobBytes(blob: CoreDmBlob): Buffer {
  const absPath = path.join(getBlobsDir(), blob.path);
  if (!fs.existsSync(absPath)) {
    throw new BlobStoreError("Blob file missing on disk");
  }
  return fs.readFileSync(absPath);
}

export function blobHref(blobId: string): string {
  return `/api/dm/blobs/${blobId}`;
}

export class BlobStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlobStoreError";
  }
}
