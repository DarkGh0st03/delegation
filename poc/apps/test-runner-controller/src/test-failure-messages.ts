/**
 * Failed tests with their error message, as a developer reads them in CI:
 * which test failed and why ("expected 2 to be 3", "Cannot read properties
 * of undefined"). They let the Orchestrator decide whether the test or the
 * application code must be repaired, and the repairing agent fix the cause.
 *
 * The text is produced by code that agents wrote, so it is UNTRUSTED DATA:
 * it is bounded, stripped of colours, control characters, stack traces and
 * code frames, never interpreted, and grants no permission. Every entry
 * belongs to a failing test file that the Runner itself reported.
 */
import {sanitizeVitestFailureFiles} from "./vitest-failure-files.ts";

export interface TestFailureMessage {
  /** Failing test file (relative path, a project test source). */
  readonly file: string;
  /** Full test name (describe blocks + test title). */
  readonly test: string;
  /** First error message, without stack trace or code frame. */
  readonly message: string;
}

export const MAX_TEST_FAILURES = 8;
const MAX_TEST_NAME = 200;
const MAX_MESSAGE = 600;
const MAX_MESSAGE_LINES = 12;

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/gu;
// Every C0/C1 control character except newline (kept between lines).
const CONTROL = new RegExp("[\\u0000-\\u0009\\u000b-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]","gu");
// Stack frames and Vitest code frames: where the message ends.
const STACK_OR_FRAME = /^\s*(?:at\s|❯\s|→\s|\d+\s*\|)/u;

function cleanLine(line: string): string {
  return line.replace(ANSI, "").replace(CONTROL, " ").replace(/\s+$/u, "");
}

function limit(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

/** Test name on one line, bounded. */
export function cleanTestName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return limit(cleanLine(raw).replace(/\s+/gu, " ").trim(), MAX_TEST_NAME);
}

/** Error message without stack trace / code frame, bounded. */
export function cleanFailureMessage(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const lines: string[] = [];
  for (const line of raw.slice(0, 20_000).replace(ANSI, "").split(/\r?\n/u)) {
    if (STACK_OR_FRAME.test(line)) break;
    const clean = cleanLine(line);
    if (clean.trim()) lines.push(limit(clean, 300));
    if (lines.length === MAX_MESSAGE_LINES) break;
  }
  return limit(lines.join("\n").trim(), MAX_MESSAGE);
}

/**
 * Validate (or re-validate at a trust boundary) failure messages: only
 * well-formed entries for files in `failingFiles`, already clean, bounded.
 * Returns [] for anything malformed so a bad field never blocks a FAIL.
 */
export function sanitizeTestFailureMessages(raw: unknown,
  failingFiles: readonly string[]): TestFailureMessage[] {
  if (!Array.isArray(raw) || raw.length > MAX_TEST_FAILURES) return [];
  const files = new Set(sanitizeVitestFailureFiles([...failingFiles]));
  const result: TestFailureMessage[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        Object.keys(entry).sort().join(",") !== "file,message,test") return [];
    const {file, test, message} = entry as Record<string, unknown>;
    if (typeof file !== "string" || !files.has(file) ||
        typeof test !== "string" || !test || cleanTestName(test) !== test ||
        typeof message !== "string" || !message || cleanFailureMessage(message) !== message)
      return [];
    result.push(Object.freeze({file, test, message}));
  }
  return result;
}

/**
 * Runner side: read a Vitest JSON report (written by the Runner to a fixed
 * path inside the throw-away container) and keep, for each failed test of
 * a reported failing file, its name and first cleaned error message.
 */
export function extractTestFailureMessages(rawReport: string,
  failingFiles: readonly string[]): TestFailureMessage[] {
  if (typeof rawReport !== "string" || Buffer.byteLength(rawReport, "utf8") > 4 * 1024 * 1024)
    return [];
  let report: any;
  try { report = JSON.parse(rawReport); } catch { return []; }
  if (!report || !Array.isArray(report.testResults)) return [];
  const files = new Set(sanitizeVitestFailureFiles([...failingFiles]));
  const result: TestFailureMessage[] = [];
  for (const suite of report.testResults.slice(0, 1000)) {
    if (typeof suite?.name !== "string" || !Array.isArray(suite.assertionResults)) continue;
    const file = suite.name.startsWith("/workspace/") ? suite.name.slice(11) : suite.name;
    if (!files.has(file)) continue;
    const failed = suite.assertionResults.slice(0, 1000)
      .filter((a: any) => a?.status === "failed");
    // A file that fails to load (syntax/import error) has no failed test:
    // Vitest reports the reason on the suite itself.
    const rows = failed.length ? failed.map((a: any) => ({
      test: cleanTestName(a.fullName ?? a.title),
      message: cleanFailureMessage(Array.isArray(a.failureMessages) ? a.failureMessages[0] : "")
    })) : [{test: "(file did not run)", message: cleanFailureMessage(suite.message)}];
    for (const row of rows) {
      if (!row.test || !row.message) continue;
      result.push(Object.freeze({file, test: row.test, message: row.message}));
      if (result.length === MAX_TEST_FAILURES) return result;
    }
  }
  return result;
}
