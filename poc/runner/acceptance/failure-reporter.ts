import {basename} from "node:path";
import type {Reporter, FullConfig, Suite, FullResult} from "@playwright/test/reporter";
import {ACCEPTANCE_CHECKS, ACCEPTANCE_FAILURE_PREFIX} from "./failure-catalog.mjs";

/** Runs from the read-only researcher mount, alongside the normal line reporter. */
export default class AcceptanceFailureReporter implements Reporter {
  #suite?: Suite;
  onBegin(_config: FullConfig, suite: Suite): void { this.#suite = suite; }
  onEnd(result: FullResult): void {
    if (result.status === "passed") return;
    const failed = new Set<string>();
    let timedOut = result.status === "timedout";
    let unclassified = result.status === "interrupted";
    for (const test of this.#suite?.allTests() ?? []) {
      const status = test.results.at(-1)?.status;
      if (status !== "failed" && status !== "timedOut" && status !== "interrupted") continue;
      timedOut ||= status === "timedOut";
      const check = ACCEPTANCE_CHECKS.find(([file, title]) =>
        basename(test.location.file) === file && test.title === title);
      if (check) failed.add(check[2]); else unclassified = true;
    }
    if (failed.size === 0) unclassified = true;
    process.stdout.write(ACCEPTANCE_FAILURE_PREFIX + JSON.stringify({
      failed_checks: [...failed].sort(), timed_out: timedOut,
      unclassified_failure: unclassified
    }) + "\n");
  }
}
