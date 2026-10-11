/**
 * Load .env: DOTENV_PATH when set (Windows services point it at C:\ecom\app\.env),
 * otherwise the repository-root .env when running from source.
 * Variables already in the environment are never overwritten.
 */
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const candidates = [process.env.DOTENV_PATH, ...["../../../.env", "../../.env", "../.env"].map((rel) => {
  try {
    return fileURLToPath(new URL(rel, import.meta.url));
  } catch {
    return undefined;
  }
})];
for (const p of candidates) {
  if (p && existsSync(p)) {
    config({ path: p, quiet: true });
    break;
  }
}
