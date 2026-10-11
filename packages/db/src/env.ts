/** Load the repository-root .env when running scripts directly (services get env from the host). */
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

for (const rel of ["../../../.env", "../../.env", "../.env"]) {
  const p = fileURLToPath(new URL(rel, import.meta.url));
  if (existsSync(p)) {
    config({ path: p, quiet: true });
    break;
  }
}
