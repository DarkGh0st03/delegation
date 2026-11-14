#!/usr/bin/env node
/**
 * Archive old console sessions, keeping the most recent N in the console.
 *
 * Sessions are evidence (who approved what, every Gateway decision), so they
 * are MOVED to <state>/sessions-archive, never deleted. A session that may
 * still be running (not finished and started less than 2 hours ago; its
 * operational Root lasts at most about 30 minutes) is always kept.
 *
 *   docker compose exec app node poc/engineer-console/scripts/archive-sessions.mjs --keep 2
 */
import {existsSync, mkdirSync, readFileSync, readdirSync, renameSync} from "node:fs";
import {join} from "node:path";

const SESSION_ID = /^s-[a-f0-9]{12}$/u;
const FINISHED = new Set(["completed", "failed", "stopped", "interrupted"]);
const MAX_RUNNING_MS = 2 * 60 * 60 * 1000;

export function archiveSessions({stateDir, keep, nowMs = Date.now()}) {
  if (!Number.isSafeInteger(keep) || keep < 0) throw Error("--keep must be a whole number >= 0");
  const dir = join(stateDir, "sessions"), archive = join(stateDir, "sessions-archive");
  if (!existsSync(dir)) return {kept: [], archived: []};
  const sessions = readdirSync(dir).filter(id => SESSION_ID.test(id)).map(id => {
    try { const s = JSON.parse(readFileSync(join(dir, id, "session.json"), "utf8"));
      return {id, created_at: String(s.created_at ?? ""), phase: s.phase}; }
    catch { return {id, created_at: "", phase: "unknown"}; }
  }).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const kept = [], archived = [];
  mkdirSync(archive, {recursive: true, mode: 0o700});
  sessions.forEach((s, i) => {
    const mayRun = !FINISHED.has(s.phase) && !(nowMs - Date.parse(s.created_at) > MAX_RUNNING_MS);
    if (i < keep || mayRun) { kept.push(s.id); return; }
    renameSync(join(dir, s.id), join(archive, s.id));
    archived.push(s.id);
  });
  return {kept, archived};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const at = process.argv.indexOf("--keep");
  const keep = at > 0 ? Number(process.argv[at + 1]) : NaN;
  const stateDir = process.env.CONSOLE_STATE_DIR ?? "/state";
  try {
    const {kept, archived} = archiveSessions({stateDir, keep});
    process.stdout.write(`Sessioni mantenute: ${kept.length} (${kept.join(", ") || "nessuna"})\n` +
      `Sessioni archiviate in ${join(stateDir, "sessions-archive")}: ${archived.length}\n`);
  } catch (error) {
    process.stderr.write("Errore: " + error.message + "\nUso: archive-sessions.mjs --keep 2\n");
    process.exit(1);
  }
}
