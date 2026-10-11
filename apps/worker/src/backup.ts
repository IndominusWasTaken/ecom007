import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, stat, unlink, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";
import { log } from "./log";

/**
 * Nightly encrypted backup: pg_dump (custom format) -> gzip -> AES-256-GCM -> BACKUP_DIR.
 * BACKUP_DIR should be storage off the VPS (a mapped network drive, or a folder synced by
 * rclone to S3/Backblaze/Google Drive). Files older than BACKUP_RETENTION_DAYS are removed.
 *
 * File layout: "ECB1" | iv(12) | ciphertext… | tag(16)
 */
const MAGIC = Buffer.from("ECB1");

function backupKey(): Buffer {
  const raw = process.env.BACKUP_ENCRYPTION_KEY;
  if (!raw) throw new Error("BACKUP_ENCRYPTION_KEY is not set");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY must be 32 bytes, base64");
  return k;
}

const pgBin = (name: string) => (process.env.PG_BIN_DIR ? join(process.env.PG_BIN_DIR, name) : name);

export async function runBackup(): Promise<number> {
  const dir = resolve(process.env.BACKUP_DIR ?? "./backups");
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = join(dir, `ecom-${stamp}.dump.gz.enc`);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", backupKey(), iv);
  const out = createWriteStream(file);
  out.write(MAGIC);
  out.write(iv);
  const dump = spawn(pgBin("pg_dump"), ["--format=custom", "--no-owner", "--dbname", process.env.DATABASE_URL!], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  dump.stderr.on("data", (d) => (stderr += d));
  const exited = new Promise<number>((r) => dump.on("close", (code) => r(code ?? 1)));
  // gzip -> cipher -> file, keeping the file open to append the GCM tag afterwards
  const done = new Promise<void>((res, rej) => {
    cipher.on("end", () => out.end(cipher.getAuthTag(), () => res()));
    cipher.on("error", rej);
    out.on("error", rej);
  });
  cipher.pipe(out, { end: false });
  await pipeline(dump.stdout, createGzip(), cipher);
  await done;
  const code = await exited;
  if (code !== 0) throw new Error(`pg_dump failed (${code}): ${stderr.slice(0, 500)}`);
  const size = (await stat(file)).size;
  log.info("backup written", { file, size });
  await prune(dir, Number(process.env.BACKUP_RETENTION_DAYS ?? 30));
  return 1;
}

async function prune(dir: string, days: number) {
  const cutoff = Date.now() - days * 86_400_000;
  for (const f of await readdir(dir)) {
    if (!f.endsWith(".enc")) continue;
    const p = join(dir, f);
    if ((await stat(p)).mtimeMs < cutoff) await unlink(p);
  }
}

/** Decrypt a backup to a plain pg_dump file, then restore with pg_restore (see docs/OPERATIONS.md). */
export async function decryptBackup(file: string, outFile: string) {
  const size = (await stat(file)).size;
  const fh = await open(file, "r");
  const head = Buffer.alloc(16);
  await fh.read(head, 0, 16, 0);
  const tag = Buffer.alloc(16);
  await fh.read(tag, 0, 16, size - 16);
  await fh.close();
  if (!head.subarray(0, 4).equals(MAGIC)) throw new Error("Not an ecom backup file");
  const decipher = createDecipheriv("aes-256-gcm", backupKey(), head.subarray(4, 16));
  decipher.setAuthTag(tag);
  await pipeline(createReadStream(file, { start: 16, end: size - 17 }), decipher, createGunzip(), createWriteStream(outFile));
  return outFile;
}
