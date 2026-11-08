/**
 * R385.13 - The 24th Child-consuming Task is the final Test retest.
 * One failed prior Test remains registered but never gateway-completed.
 * This exercises the REAL ADK decision-proposer without native effects,
 * Gitea or model billing; no test claim or Pull Request is fabricated.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {BaseLlm} from "@google/adk";
import {TrustedAuthorityOnlyAdkDecisionProposer as Proposer}
 from "../src/trusted-authority-only-adk-decision-proposer.mjs";

const branch="feature/account-suspension";
const repo="gitea://gitea.local/thesis/iam-console-poc";
const root=repo+"/branches/feature%2Faccount-suspension";
const runner={resource:root,operation:"run_tests"};
const failedTask="r375-test-task",lastCas="r375-functional-file-10";
const digest="f".repeat(64),commit="a".repeat(40);
const candidate=(dep=lastCas,task_id="r375-functional-retest")=>({
 action:"delegate",task:{task_id,agent_id:"test",depends_on:[dep],
 permissions:[runner],
 instruction:"Run independent Docker tests and researcher acceptance on verified latest branch HEAD"}
});
class OneChoice extends BaseLlm{
 constructor(choice){super({model:"r38513-zero-cost-terminal-test-adk"});this.choice=choice;this.calls=0;}
 async *generateContentAsync(){
  this.calls++;
  yield {content:{role:"model",parts:[{text:JSON.stringify(this.choice)}]}};
 }
 connect(){throw Error("No external model connections");}
}
function config(choice){
 // 1 root Branch, 2 D0, and 20 read/CAS Tasks. The genuine
 // first Docker FAIL is in failure history, NEVER in this prior list.
 const previousTasks=[
  {task_id:"r375-original-root-branch",agent_id:"orchestrator"},
  {task_id:"r375-backend-task",agent_id:"backend"},
  {task_id:"r375-frontend-task",agent_id:"frontend"}
 ];
 for(let i=1;i<=10;i++){
  const role=i===1||i===9?"test":i<=6?"backend":"frontend";
  previousTasks.push({task_id:i===1?"r38512-postfail-test-read":
   "r38513-postfail-read-"+i,agent_id:role});
  previousTasks.push({task_id:"r375-functional-file-"+i,agent_id:role});
 }
 assert.equal(previousTasks.length,23);
 const model=new OneChoice(choice);
 return {model,requirement:"Implement account suspension with independent validation",
  branch,rootPermissions:[runner],
  agents:{orchestrator:{capabilities:["create_branch"]},
   backend:{capabilities:["read_file","update_file"]},
   frontend:{capabilities:["read_file","update_file"]},
   test:{capabilities:["read_file","update_file","run_tests"]}},
  previousTasks,nextEpoch:25,
  decisionKind:"adaptive",
  executionProgress:{current_head_sha:commit,
   completed_work:previousTasks.map(p=>({
    ...p,operation:p.task_id==="r375-original-root-branch"?"create_branch":
     p.task_id==="r375-backend-task"||p.task_id==="r375-frontend-task"?
     "update_file":p.task_id.includes("read")?"read_file":"update_file",
    instruction:"Independently completed signed Task"
   }))},
  verifiedFailure:{failed_phase:"researcher_acceptance",source_evidence_sha256:digest},
  verifiedFailureHistory:[{failed_task_id:failedTask,failed_phase:"researcher_acceptance",
   source_evidence_sha256:digest,tested_commit_sha:commit}],
  maxVerifiedFailures:4
 };
}
test("R385.13 final Test retest can depend on last independently completed CAS, not failed Test",async()=>{
 const cfg=config(candidate());
 const out=await new Proposer(cfg).propose();
 assert.equal(cfg.model.calls,1);
 assert.deepEqual(out,candidate());
 assert.ok(!cfg.previousTasks.some(row=>row.task_id===failedTask));
 assert.equal(cfg.previousTasks.at(-1).task_id,lastCas);
});
test("R385.13 cannot reuse failed Test or claim it as a completed prerequisite",async()=>{
 for(const invalid of [candidate(failedTask),
  candidate(lastCas,failedTask),candidate("r375-functional-file-11")]){
  const cfg=config(invalid);
  await assert.rejects(new Proposer(cfg).propose(),/model Task choice denied/u);
 }
});
