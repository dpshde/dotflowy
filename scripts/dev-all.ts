/**
 * dev:all — the easy local loop in ONE command.
 *
 * Dotflowy is a static SPA that talks to a Cloudflare Worker over /api/*, so a
 * working local instance needs BOTH servers running: `wrangler dev` (Worker +
 * per-user DO + local D1) and `vite dev` (the UI, proxying /api -> :8787). Run
 * only `vite dev` and every /api call fails, so the app hangs on a blank
 * AuthGate. This spawns both together with combined output and a shared
 * lifecycle, keeping Vite HMR (unlike the production-like `cf:dev`).
 *
 * Auth bypass: if `.dev.vars` sets BYPASS_AUTH, the Worker skips its session
 * gate; this script mirrors that single flag to the Vite process as
 * VITE_BYPASS_AUTH so the client's AuthGate renders straight into the editor —
 * no sign-in, one source of truth. Neither var exists in a production build.
 *
 * For pure UI work you can still run `bun run dev` + `bun run dev:api` in two
 * terminals; this is the same loop, one command.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const DEV_VARS = resolve(ROOT, ".dev.vars");

const log = (msg: string) => console.log(`\x1b[35m[dev:all]\x1b[0m ${msg}`);

/** Read a single key from the dotenv-style .dev.vars (best-effort, no deps). */
function readDevVar(key: string): string | undefined {
  if (!existsSync(DEV_VARS)) return undefined;
  for (const line of readFileSync(DEV_VARS, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() === key) {
      return trimmed.slice(eq + 1).trim();
    }
  }
  return undefined;
}

const bypass = Boolean(readDevVar("BYPASS_AUTH"));
if (bypass) {
  log("BYPASS_AUTH set in .dev.vars -> auth bypassed (Worker + client)");
} else {
  log("no BYPASS_AUTH in .dev.vars -> normal sign-in flow");
}

// 1. wrangler dev (Worker + per-user DO + local D1) on :8787.
log("starting wrangler dev on :8787");
const wrangler = Bun.spawn(["bunx", "wrangler", "dev", "--port", "8787"], {
  cwd: ROOT,
  stdio: ["inherit", "inherit", "inherit"],
});

// 2. vite dev on :3000 (proxies /api -> :8787). Mirror the bypass flag so the
//    client AuthGate matches the Worker.
log("starting vite dev on :3000");
const vite = Bun.spawn(["bunx", "vite", "dev"], {
  cwd: ROOT,
  stdio: ["inherit", "inherit", "inherit"],
  env: bypass ? { ...process.env, VITE_BYPASS_AUTH: "1" } : process.env,
});

let exiting = false;
function teardownAndExit(): void {
  if (exiting) return;
  exiting = true;
  wrangler.kill();
  vite.kill();
  process.exit(0);
}

process.on("SIGINT", teardownAndExit);
process.on("SIGTERM", teardownAndExit);

// If either process dies, stop the other so the script never hangs half-up.
void wrangler.exited.then(teardownAndExit);
void vite.exited.then(teardownAndExit);
