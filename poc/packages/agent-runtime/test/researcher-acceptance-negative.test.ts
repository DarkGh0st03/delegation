import assert from "node:assert/strict";
import test from "node:test";
import {
  RESEARCHER_NEGATIVE_BASELINE_SHA as baselineSha,
  runResearcherAcceptanceNegative
} from "../scripts/assert-researcher-acceptance-negative.mjs";

const phases=["dependency_install","typecheck","backend_tests",
  "frontend_tests","build","playwright_e2e"].map(phase=>({phase,status:"pass"}));
const acceptance={phase:"researcher_acceptance",status:"fail",
  errors:["researcher acceptance exited with code 1"]};
const acceptanceLog="=== researcher_acceptance ===\n"+
  "researcher acceptance: administrator can suspend an ACTIVE account\n"+
  "Error: expect(received).toContain(expected)\n  5 failed\n";
const config={giteaBaseUrl:"http://127.0.0.1:43123",giteaWriteToken:"fixture-write",
  giteaReadToken:"fixture-read",dockerImage:"local-runner",logDir:"/tmp/runner-logs",
  acceptanceDir:"/workspace/delegation/poc/runner/acceptance",baselineSha};

function fixture({mutateResult=()=>{},log=acceptanceLog,candidatePresent=false}={}){
  const branches=new Map([["main",baselineSha],
    ...(candidatePresent?[["feature/account-suspension","a".repeat(40)]]:[])]);
  const calls=[];
  let runnerConfig;
  const dependencies={
    fetchFn:async(url,options)=>{
      const branchPath=new URL(url).pathname.split("/branches")[1];
      calls.push({method:options.method,path:branchPath});
      if(options.method==="POST"){
        const body=JSON.parse(options.body);
        assert.equal(body.old_ref_name,baselineSha);
        assert.match(body.new_branch_name,/^audit\/acceptance-baseline-/u);
        assert.equal(options.headers.authorization,"token fixture-write");
        branches.set(body.new_branch_name,baselineSha);
        return new Response(JSON.stringify({}),{status:201});
      }
      const branch=decodeURIComponent(branchPath.slice(1));
      if(options.method==="DELETE"){
        assert.match(branch,/^audit\/acceptance-baseline-/u);
        branches.delete(branch);
        return new Response(null,{status:204});
      }
      assert.equal(options.headers.authorization,"token fixture-read");
      return branches.has(branch)?Response.json({commit:{id:branches.get(branch)}}):
        new Response(null,{status:404});
    },
    createExecutor:value=>{
      runnerConfig=value;
      return {run:async request=>{
        assert.equal(branches.get(request.branch),baselineSha);
        const result={...request,tested_commit_sha:request.commit_sha,status:"fail",
          phases:[...structuredClone(phases),structuredClone(acceptance)],
          project_tests:{status:"pass",phases:structuredClone(phases)},
          researcher_acceptance:structuredClone(acceptance),
          acceptance_failure:{failed_checks:["admin_reactivate","admin_suspend",
            "duplicate_transitions","ui_pending_actions","ui_state_actions"],
            timed_out:false,unclassified_failure:false},
          log_reference:"runner-log://00000000-0000-4000-8000-000000000000"};
        mutateResult(result,branches);
        return result;
      }};
    },
    readLog:async path=>{
      assert.equal(path,"/tmp/runner-logs/00000000-0000-4000-8000-000000000000.log");
      return log;
    }
  };
  return {dependencies,branches,calls,get runnerConfig(){return runnerConfig;}};
}

test("baseline negative control separates independent acceptance from all six passing project phases",async()=>{
  const f=fixture({candidatePresent:true});
  const result=await runResearcherAcceptanceNegative(config,f.dependencies);
  assert.equal(result.tested_commit_sha,baselineSha);
  assert.equal(result.project_tests,"pass");
  assert.equal(result.researcher_acceptance,"fail");
  assert.equal(result.overall_status,"fail");
  assert.deepEqual([...f.branches.keys()],["main","feature/account-suspension"]);
  assert.equal(f.runnerConfig.acceptance_enabled,true);
  assert.equal(f.runnerConfig.acceptance_dir,config.acceptanceDir);
  assert.equal(f.runnerConfig.gitea_token,config.giteaReadToken);
  assert.equal(f.calls.filter(call=>call.method==="DELETE").length,1);
});

for(const phase of phases){
  test("a failure in "+phase.phase+" cannot masquerade as an acceptance negative",async()=>{
    const f=fixture({mutateResult:result=>{
      result.project_tests.status="fail";
      result.project_tests.phases.find(item=>item.phase===phase.phase).status="fail";
      result.phases.find(item=>item.phase===phase.phase).status="fail";
    }});
    await assert.rejects(runResearcherAcceptanceNegative(config,f.dependencies),
      /Infrastructure or project-test failures/u);
    assert.deepEqual([...f.branches.keys()],["main"],"temporary branch is removed even after failure");
  });
}

test("aggregate PASS cannot hide a missing project phase",async()=>{
  const f=fixture({mutateResult:result=>{result.project_tests.phases.pop();}});
  await assert.rejects(runResearcherAcceptanceNegative(config,f.dependencies),/All six/u);
});

test("acceptance PASS, skipped, timeout, or missing executable is not the required negative control",async()=>{
  for(const status of ["pass","skipped"]){
    const f=fixture({mutateResult:result=>{result.researcher_acceptance.status=status;}});
    await assert.rejects(runResearcherAcceptanceNegative(config,f.dependencies),/must fail independent/u);
  }
  for(const errors of [["researcher acceptance timed out"],["researcher acceptance exited with code 127"]]){
    const f=fixture({mutateResult:result=>{
      result.researcher_acceptance.errors=errors;
      result.phases.at(-1).errors=errors;
    }});
    await assert.rejects(runResearcherAcceptanceNegative(config,f.dependencies),/Timeouts or startup/u);
  }
  const f=fixture({log:"=== researcher_acceptance ===\nError: Cannot find module @playwright/test"});
  await assert.rejects(runResearcherAcceptanceNegative(config,f.dependencies),/must actually execute/u);
});

test("an acceptance infrastructure failure without assertion evidence is rejected",async()=>{
  const f=fixture({log:"=== researcher_acceptance ===\n"+
    "researcher acceptance: administrator can suspend an ACTIVE account\n"+
    "browserType.launch: Executable does not exist\n  5 failed\n"});
  await assert.rejects(runResearcherAcceptanceNegative(config,f.dependencies),/must fail on acceptance assertions/u);
});

test("colored Playwright assertion output still supplies acceptance evidence",async()=>{
  const f=fixture({log:acceptanceLog.replace("expect(","\u001b[2mexpect(\u001b[22m")});
  assert.equal((await runResearcherAcceptanceNegative(config,f.dependencies)).researcher_acceptance,"fail");
});

test("additional independent acceptance checks do not invalidate the original negative control",async()=>{
  const f=fixture({log:acceptanceLog.replace("5 failed","7 failed\n  1 passed")});
  assert.equal((await runResearcherAcceptanceNegative(config,f.dependencies)).researcher_acceptance,"fail");
  const incomplete=fixture({log:acceptanceLog.replace("5 failed","4 failed")});
  await assert.rejects(runResearcherAcceptanceNegative(config,incomplete.dependencies),
    /At least the five original/u);
});

test("wrong exact SHA and wrong overall verdict are rejected",async()=>{
  for(const [field,value,message] of [
    ["tested_commit_sha","b".repeat(40),/wrong SHA/u],
    ["status","pass",/Overall verdict/u]
  ]){
    const f=fixture({mutateResult:result=>{result[field]=value;}});
    await assert.rejects(runResearcherAcceptanceNegative(config,f.dependencies),message);
  }
});

test("frozen main and feature candidate must remain unchanged",async()=>{
  for(const branch of ["main","feature/account-suspension"]){
    const f=fixture({candidatePresent:true,mutateResult:(_result,branches)=>{
      branches.set(branch,"b".repeat(40));
    }});
    await assert.rejects(runResearcherAcceptanceNegative(config,f.dependencies),
      branch==="main"?/changed frozen main/u:/changed the feature candidate/u);
  }
});

test("negative control cannot target a remote server or a different baseline",async()=>{
  await assert.rejects(runResearcherAcceptanceNegative({...config,
    giteaBaseUrl:"https://github.com"}),/requires disposable loopback/u);
  await assert.rejects(runResearcherAcceptanceNegative({...config,
    baselineSha:"b".repeat(40)}),/immutable pre-suspension baseline/u);
});

test("acceptance negative control requires bounded requirement IDs and rejects timeouts",async()=>{
 for(const diagnostic of [undefined,
  {failed_checks:["admin_suspend"],timed_out:false,unclassified_failure:false},
  {failed_checks:["admin_reactivate","admin_suspend","duplicate_transitions",
    "ui_pending_actions","ui_state_actions"],timed_out:true,unclassified_failure:false}
 ]){
  const f=fixture({mutateResult:result=>{result.acceptance_failure=diagnostic;}});
  await assert.rejects(runResearcherAcceptanceNegative(config,f.dependencies),/fixed researcher check IDs/u);
  assert.deepEqual([...f.branches.keys()],["main"]);
 }
});
