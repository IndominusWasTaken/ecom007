/** Plain structured logging to stdout; the Windows service wrapper writes it to a rotating file. */
type Level = "info" | "warn" | "error";
function line(level: Level, msg: string, extra?: Record<string, unknown>) {
  const out = { t: new Date().toISOString(), level, msg, ...extra };
  (level === "error" ? console.error : console.log)(JSON.stringify(out));
}
export const log = {
  info: (m: string, e?: Record<string, unknown>) => line("info", m, e),
  warn: (m: string, e?: Record<string, unknown>) => line("warn", m, e),
  error: (m: string, e?: Record<string, unknown>) => line("error", m, e),
};
