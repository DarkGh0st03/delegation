/**
 * R277 — dedicated ZERO-BILLING F1 entrypoint.
 * Load the native planning script under a pre-import structured diagnostic
 * boundary; never run an external model or publish child stderr.
 */
import {runF1OfflinePlanningEntry}
 from "./f1-offline-planning-entry-runner.mjs";

const ok=await runF1OfflinePlanningEntry({
 load:()=>import("./native-planning-read-core-evm-e2e.mjs")
});
if(!ok)process.exitCode=1;
