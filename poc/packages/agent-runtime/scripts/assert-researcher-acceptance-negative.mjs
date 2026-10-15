/**
 * Independent negative control for the free, disposable-Gitea Docker E2E.
 * The pinned application must pass its own six phases but fail the immutable,
 * read-only mounted Researcher Acceptance suite. No model provider is used.
 */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {stripVTControlCharacters} from "node:util";
import {IsolatedDockerRunnerExecutor} from "../../../apps/test-runner-controller/src/isolated-executor.ts";

export const RESEARCHER_NEGATIVE_BASELINE_SHA="405748b1e77992b6bd8630a3ab6f990658d32f6b";
const projectPhases=["dependency_install","typecheck","backend_tests",
  "frontend_tests","build","playwright_e2e"];

/** The configuration and both tokens belong ONLY to the disposable fixture. */
export async function runResearcherAcceptanceNegative({
  giteaBaseUrl,giteaWriteToken,giteaReadToken,dockerImage,logDir,acceptanceDir,
  baselineSha=RESEARCHER_NEGATIVE_BASELINE_SHA,
  candidateBranch="feature/account-suspension"
}, dependencies={}){
  const url=new URL(giteaBaseUrl);
  if(url.protocol!=="http:"||
    !["127.0.0.1","localhost","[::1]"].includes(url.hostname)||
    url.username||url.password||url.search||url.hash||url.pathname!=="/"){
    throw Error("Researcher negative control requires disposable loopback Gitea");
  }
  assert.equal(baselineSha,RESEARCHER_NEGATIVE_BASELINE_SHA,
    "Negative control must execute the immutable pre-suspension baseline");
  assert.ok(giteaWriteToken&&giteaReadToken,"Disposable Gitea credentials are required");
  assert.ok(acceptanceDir&&logDir&&dockerImage,"Runner configuration is incomplete");
  assert.ok(candidateBranch!=="main","Candidate branch must be separate from main");
  const requestFetch=dependencies.fetchFn??fetch;
  const createExecutor=dependencies.createExecutor??(config=>new IsolatedDockerRunnerExecutor(config));
  const readLog=dependencies.readLog??(path=>readFile(path,"utf8"));
  const base=giteaBaseUrl.replace(/\/$/u,"")+"/api/v1/repos/thesis/iam-console-poc";
  const negativeBranch="audit/acceptance-baseline-"+randomUUID();
  async function api(path,{method="GET",body,allowAbsent=false}={}){
    const response=await requestFetch(base+path,{
      method,
      headers:{accept:"application/json",authorization:"token "+
        (method==="GET"?giteaReadToken:giteaWriteToken),
        ...(body===undefined?{}:{"content-type":"application/json"})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
      redirect:"error",signal:AbortSignal.timeout(15000)
    });
    if(allowAbsent&&response.status===404)return null;
    if(![200,201,204].includes(response.status)){
      throw Error("Disposable Researcher negative-control Gitea "+method+" HTTP "+response.status);
    }
    return response.status===204?null:response.json();
  }
  async function branchSha(branch){
    const result=await api("/branches/"+encodeURIComponent(branch),{allowAbsent:true});
    if(result===null)return null;
    assert.match(result.commit?.id??"",/^[0-9a-f]{40}$/u,"Gitea must return an exact branch SHA");
    return result.commit.id;
  }
  const mainBefore=await branchSha("main");
  assert.equal(mainBefore,baselineSha,"Disposable main must be the frozen full baseline");
  const candidateBefore=await branchSha(candidateBranch);
  let created=false;
  try{
    await api("/branches",{method:"POST",body:{
      new_branch_name:negativeBranch,old_ref_name:baselineSha
    }});
    created=true;
    assert.equal(await branchSha(negativeBranch),baselineSha,
      "Negative-control branch must resolve to the exact frozen baseline");
    const executor=createExecutor({
      gitea_base_url:giteaBaseUrl,gitea_owner:"thesis",gitea_repository:"iam-console-poc",
      gitea_token:giteaReadToken,docker_image:dockerImage,phase_timeout_ms:300000,
      log_dir:logDir,acceptance_enabled:true,acceptance_dir:acceptanceDir
    });
    const result=await executor.run({
      request_id:"researcher-negative-"+randomUUID(),
      repository:"gitea://gitea.local/thesis/iam-console-poc",branch:negativeBranch,
      commit_sha:baselineSha,profile:"poc-default"
    });
    assert.equal(result.tested_commit_sha,baselineSha,"Negative control tested the wrong SHA");
    assert.equal(result.branch,negativeBranch,"Negative control tested the wrong branch");
    assert.equal(result.project_tests?.status,"pass",
      "Infrastructure or project-test failures do not prove an acceptance rejection");
    for(const phases of [result.project_tests?.phases,result.phases?.slice(0,-1)]){
      assert.deepEqual(phases?.map(phase=>({phase:phase.phase,status:phase.status})),
        projectPhases.map(phase=>({phase,status:"pass"})),
        "All six baseline project phases must pass before independent acceptance");
    }
    assert.equal(result.researcher_acceptance?.phase,"researcher_acceptance");
    assert.equal(result.researcher_acceptance.status,"fail",
      "Baseline without Account Suspension must fail independent Researcher Acceptance");
    assert.deepEqual(result.phases.at(-1),result.researcher_acceptance,
      "Researcher Acceptance must be the independent seventh phase");
    assert.deepEqual(result.researcher_acceptance.errors,
      ["researcher acceptance exited with code 1"],
      "Timeouts or startup failures do not prove an acceptance assertion failure");
    assert.equal(result.status,"fail","Overall verdict must include independent acceptance failure");
    const logId=/^runner-log:\/\/([0-9a-f-]{36})$/u.exec(result.log_reference??"")?.[1];
    assert.ok(logId,"Negative control must retain a structured Runner log");
    const log=stripVTControlCharacters(await readLog(join(logDir,logId+".log")));
    const acceptanceLog=log.split("=== researcher_acceptance ===\n")[1]??"";
    assert.match(acceptanceLog,/researcher acceptance: administrator can suspend an ACTIVE account/u,
      "The immutable acceptance tests must actually execute");
    const failedTests=Number(/\b([1-9][0-9]*) failed\b/u.exec(acceptanceLog)?.[1]??0);
    assert.ok(failedTests>=5,
      "At least the five original baseline acceptance assertions must fail; setup errors are insufficient");
    assert.match(acceptanceLog,/Error: expect\(/u,
      "Negative control must fail on acceptance assertions, not a missing tool or browser");
    return {
      event:"researcher_acceptance_negative",tested_commit_sha:baselineSha,
      project_tests:"pass",researcher_acceptance:"fail",overall_status:"fail",
      project_phases:projectPhases,log_reference:result.log_reference
    };
  }finally{
    if(created)await api("/branches/"+encodeURIComponent(negativeBranch),{method:"DELETE"});
    assert.equal(await branchSha("main"),mainBefore,"Negative control changed frozen main");
    assert.equal(await branchSha(candidateBranch),candidateBefore,
      "Negative control changed the feature candidate branch");
  }
}
