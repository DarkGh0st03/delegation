import test from "node:test";
import assert from "node:assert/strict";
import {extractSafeGeminiPilotDockerEvidence as safe}
  from "../scripts/gemini-pilot-safe-docker-evidence.mjs";

const PHASES=["dependency_install","typecheck","backend_tests",
  "frontend_tests","build","playwright_e2e","researcher_acceptance"];
const prefix="[trusted-positive-ci] native_dag_failure ";
function sample(failed){
  let seenFailure=false;
  const phases=PHASES.map(phase=>{
    const status=seenFailure?"skipped":phase===failed?"fail":"pass";
    if(status==="fail")seenFailure=true;
    return {phase,status,secret:"NEVER_SHARE_PRIVATE_SOURCE"};
  });
  return {
    stage:"signed_dag_disposable_docker_acceptance",
    status:failed?"fail":"pass",
    project_tests:failed?"fail":"pass",
    researcher_acceptance:failed?"skipped":"pass",
    first_failed_phase:failed,
    phases,
    gemini_pilot_diagnostic:{model_turns_started:11,
      model_text:"HIDDEN_MODEL_PROMPT"},
    credentials:"HIDDEN_SIGNED_VP"
  };
}
test("Pilot artifact retains sanitized Docker failure with exact first failing phase",()=>{
  const content="GitHub log token HIDDEN_API_KEY\n"+
    "2026-10-28T09:55:31Z "+prefix+JSON.stringify(sample("typecheck"))+"\n"+
    "SECRET SOURCE CODE THAT MUST NEVER BE REPORTED\n";
  const result=safe(content);
  assert.equal(result?.status,"fail");
  assert.equal(result?.first_failed_phase,"typecheck");
  assert.equal(result?.phases.length,7);
  const publicBody=JSON.stringify(result);
  assert.doesNotMatch(publicBody,
    /HIDDEN_API_KEY|HIDDEN_MODEL_PROMPT|HIDDEN_SIGNED_VP|NEVER_SHARE_PRIVATE_SOURCE|SECRET SOURCE CODE/u);
});
test("Pilot diagnostic accepts a genuine passing Docker phase, not model prose",()=>{
  const result=safe(prefix+JSON.stringify(sample(null)));
  assert.equal(result?.status,"pass");
  assert.equal(result?.first_failed_phase,null);
});
test("Pilot artifact carries only verified TypeScript codes across double filtering",()=>{
  const payload={...sample("typecheck"),
    typecheck_error_codes:["TS2304","TS2322"],
    untrusted_compiler_output:"DO_NOT_EXPORT_PRIVATE_SOURCE",
    typecheck_diagnostics:[{path:"private/credentials.ts",line:1}]};
  const actual=safe(prefix+JSON.stringify(payload));
  assert.deepEqual(actual?.typecheck_error_codes,["TS2304","TS2322"]);
  const serialized=JSON.stringify(actual);
  assert.doesNotMatch(serialized,/DO_NOT_EXPORT_PRIVATE_SOURCE|credentials\.ts/u);
  for(const bad of [["TS2304;LEAK"],["TS2304","TS2304"],["TS2322","TS2304"]])
    assert.equal(safe(prefix+JSON.stringify({
      ...payload,typecheck_error_codes:bad
    })),null);
  assert.equal(safe(prefix+JSON.stringify({
    ...sample("frontend_tests"),typecheck_error_codes:["TS2304"]
  })),null);
});
test("Pilot diagnostic fails closed for malformed, forged or absent phase status",()=>{
  const fake=sample("frontend_tests");
  for(const line of [
    "Failed project tests but no structured Docker event",
    prefix+JSON.stringify({...fake,status:"pass"}),
    prefix+JSON.stringify({...fake,phases:[{phase:"forged",status:"fail"}]}),
    prefix+JSON.stringify({...fake,project_tests:"error"}),
    prefix+JSON.stringify({...fake,stage:"signed_test_review"}),
    prefix+JSON.stringify({...fake,status:"fail",phases:fake.phases.map(x=>({...x,status:"pass"}))}),
    prefix+JSON.stringify({...fake,phases:"/run/secrets/VP"})
  ])assert.equal(safe(line),null);
});

test("R81 pilot double filter accepts valid bounded scope counters and rejects injected source",async()=>{
  const {auditTrustedTypecheckPermissionScope}=await import(
    "../scripts/typecheck-permission-scope-audit.mjs");
  const path="apps/backend/a.ts",branch="feature/a";
  const resource="gitea://gitea.local/thesis/iam-console-poc/branches/"+
    encodeURIComponent(branch)+"/files/"+path;
  const rows=[{task_id:"backend",agent_id:"backend",operation:"update_file",
    resource}];
  const audit=auditTrustedTypecheckPermissionScope({
    diagnostics:[{path,line:1,column:1,code:"TS2820"}],
    planningFiles:[path],approvedRows:rows,
    operationalPermissions:[{operation:"update_file",resource}],
    repo:{authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"},
    branch
  });
  const event={...sample("typecheck"),
    typecheck_permission_scope_audit:audit,secret:"HIDDEN_SOURCE"};
  const actual=safe(prefix+JSON.stringify(event));
  assert.deepEqual(actual?.typecheck_permission_scope_audit,audit);
  assert.doesNotMatch(JSON.stringify(actual),/HIDDEN_SOURCE|apps\/backend|gitea:\/\//u);
  assert.equal(safe(prefix+JSON.stringify({...event,
    typecheck_permission_scope_audit:{...audit,secret:"LEAK"}})),null);
});


test("R82 double filter never exports compiler paths or forged provenance",async()=>{
  const {compareTrustedTypecheckRevisions}=await import(
    "../scripts/typecheck-revision-comparison.mjs");
  const baseSha="a".repeat(40),testedSha="b".repeat(40),path="apps/frontend/a.tsx";
  const audit=await compareTrustedTypecheckRevisions({
    diagnostics:[{path,line:1,column:1,code:"TS2820"}],
    planningFiles:[path],createdPaths:[],
    observedWrites:{backend:new Set(),frontend:new Set([path]),test:new Set()},
    branch:"feature/a",baseSha,testedSha,
    reader:{
      async getBranchMetadata(){return {commit_sha:testedSha};},
      async readTextFile(branch,p,revision){
        return {branch,path:p,revision,
          blob_sha:revision===baseSha?"1".repeat(40):"2".repeat(40),
          content:"SECRET_CANNOT_ESCAPE"};
      }
    }
  });
  const raw={...sample("typecheck"),typecheck_revision_comparison:audit,
    source_file:"NEVER_PUBLISH_PATH"};
  const result=safe(prefix+JSON.stringify(raw));
  assert.deepEqual(result.typecheck_revision_comparison,audit);
  assert.doesNotMatch(JSON.stringify(result),/apps\/frontend|SECRET_CANNOT|NEVER_PUBLISH/u);
  assert.equal(safe(prefix+JSON.stringify({...raw,
    typecheck_revision_comparison:{...audit,source:"MALICIOUS"}})),null);
});
