/** R413: offline retirement witness for historical Signed-DAG wrapper files.
 * The owner implementations and native Rust/OPA security properties remain.
 * No credentials, model inference, file writes, A2A or merge.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {createReviewedApprovedDagExecution as ownerReviewed,
        pinTrustedReviewedAgentEndpoints as corePins}
 from "../../packages/orchestrator-runtime/src/trusted-owner-reviewed-dag-execution.ts";
import {pinTrustedReviewedAgentEndpoints as purePins}
 from "../../packages/orchestrator-runtime/src/trusted-reviewed-agent-endpoint-pins.ts";
import * as ownerPlanner
 from "../../packages/orchestrator-runtime/src/trusted-owner-repair-planning-core.ts";
import {executeTrustedAdmittedRepairDag as ownerDag}
 from "../../packages/orchestrator-runtime/src/trusted-owner-repair-dag-execution.ts";
import {R3854_DAG_BOUNDARIES,auditR3854DagClosure}
 from "../r3854-legacy-dag-closure-audit.mjs";
import {scanR38517} from "../r38517-canonical-route-closure.mjs";
import {collectLegacyReferences,gitTrackedFiles}
 from "../r6-legacy-references.mjs";

const root=fileURLToPath(new URL("../../../",import.meta.url));
const read=file=>readFileSync(resolve(root,file),"utf8");
const native="poc/apps/gateway/native-test/native-planning-read-core-evm-e2e.mjs";
test("R413 existing Owner implementations retain their expected exports",()=>{
 assert.equal(typeof ownerReviewed,"function");
 assert.strictEqual(corePins,purePins);
 assert.equal(typeof ownerPlanner.TrustedOperationalRepairPlanner,"function");
 assert.equal(typeof ownerPlanner.verifyTrustedRepairDiscoverySource,"function");
 assert.equal(typeof ownerDag,"function");
});
test("R413 historical wrappers are absent; original tests target genuine Owner code",()=>{
 for(const {target} of R3854_DAG_BOUNDARIES)
  assert.equal(existsSync(resolve(root,target)),false,target+" must stay retired");
 const src=read(native);
 assert.match(src,/trusted-owner-repair-dag-execution\.ts/u);
 assert.doesNotMatch(src,/from\s+"\.\.\/\.\.\/\.\.\/packages\/orchestrator-runtime\/src\/trusted-repair-dag-controller\.ts";/u);
 assert.match(src,/await executeTrustedAdmittedRepairDag\(/u);
});
test("R413 signed-DAG retirement audit rejects any parsed or configured caller",()=>{
 const tracked=gitTrackedFiles(root);
 const scan=scanR38517(root,tracked);
 assert.equal(scan.status,"R38517_MIGRATION_GATE_PASS",
  JSON.stringify([...scan.routes.issues,...scan.callers.issues]));
 assert.equal(scan.callers.deletionAuthorized,false);
 assert.equal(scan.callers.externalConsumersVerified,false);
 assert.equal(scan.callers.privateMcp.filter(x=>x.present).length,4);
 assert.ok(scan.callers.unresolvedIndirections>0);
 const targets=R3854_DAG_BOUNDARIES.map(x=>x.target);
 const inventory=collectLegacyReferences(root,tracked,{candidates:targets});
 const closure=auditR3854DagClosure(inventory);
 assert.equal(closure.status,"BOUNDARY_PROVENANCE_OK",closure.issues.join("\n"));
 for(const row of inventory.candidates){
  assert.equal(row.exists,false);
  assert.equal(row.runtimeIndirectionHints.length,0);
  assert.equal(row.configuredCallers.length,0);
  assert.equal(row.staticImporters.length,0);
 }
 assert.equal(closure.deletionAuthorized,false);
});
