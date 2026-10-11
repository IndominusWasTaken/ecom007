/** Runs once when the server starts: load .env (DOTENV_PATH) before any request. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("@ecom/db/env");
}
