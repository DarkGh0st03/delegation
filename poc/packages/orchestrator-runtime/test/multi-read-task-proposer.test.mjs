/**
 * Multi-permission Task: the Orchestrator may give one specialist the signed
 * reads of the file it edits AND of the files that file depends on, plus ONE
 * write. Zero-cost: the real ADK decision proposer with a scripted model.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {BaseLlm} from "@google/adk";
import {TrustedAuthorityOnlyAdkDecisionProposer as Proposer}
 from "../src/trusted-authority-only-adk-decision-proposer.mjs";

const branch="feature/account-suspension";
const root="gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension";
const file=path=>root+"/files/"+path;
const edit="apps/backend/src/users/account.ts",dep="apps/backend/src/users/types.ts";
const testFile="tests/backend/account.test.ts";
const p=(operation,path)=>({operation,resource:file(path)});
const rootPermissions=[p("read_file",edit),p("update_file",edit),p("read_file",dep),
 p("read_file",testFile),p("update_file",testFile),{operation:"run_tests",resource:root}];
class OneChoice extends BaseLlm{
 constructor(choice){super({model:"multi-read-zero-cost-adk"});this.choice=choice;this.calls=0;}
 async *generateContentAsync(request){
  this.calls++;this.request=request;
  yield {content:{role:"model",parts:[{text:JSON.stringify(this.choice)}]}};
 }
 connect(){throw Error("No external model connections");}
}
const decision=(agent_id,permissions)=>({action:"delegate",task:{task_id:"t-"+agent_id+"-1",
 agent_id,depends_on:["root-branch"],permissions,instruction:"Implement the change in the edited file"}});
const config=choice=>({model:new OneChoice(choice),requirement:"Add account suspension",branch,
 rootPermissions,agents:{orchestrator:{capabilities:["create_branch"]},
  backend:{capabilities:["read_file","update_file"]},
  frontend:{capabilities:["read_file","update_file"]},
  test:{capabilities:["read_file","update_file","run_tests"]}},
 previousTasks:[{task_id:"root-branch",agent_id:"orchestrator"}],nextEpoch:2,
 decisionKind:"adaptive",
 executionProgress:{current_head_sha:"a".repeat(40),completed_work:[{task_id:"root-branch",
  agent_id:"orchestrator",operation:"create_branch",instruction:"Create the work branch"}]}});

test("a specialist Task may read the edited file and its dependencies, then make ONE write",async()=>{
 const choice=decision("backend",[p("read_file",edit),p("read_file",dep),p("update_file",edit)]);
 const cfg=config(choice);
 const out=await new Proposer(cfg).propose();
 assert.equal(cfg.model.calls,1);
 assert.deepEqual(out.task.permissions.map(x=>x.operation).sort(),["read_file","read_file","update_file"]);
});
test("the Test agent may read the changed application file while editing a test",async()=>{
 const choice=decision("test",[p("read_file",testFile),p("read_file",edit),p("update_file",testFile)]);
 const out=await new Proposer(config(choice)).propose();
 assert.equal(out.task.agent_id,"test");
});
test("no second write, no write without reading the edited file, no Test write on application code",async()=>{
 for(const choice of [
  decision("backend",[p("read_file",edit),p("update_file",edit),p("update_file",testFile)]),
  decision("backend",[p("read_file",dep),p("update_file",edit)]),
  decision("backend",[p("read_file",edit),p("read_file",dep),p("update_file",edit),
   {operation:"run_tests",resource:root}]),
  decision("test",[p("read_file",edit),p("read_file",testFile),p("update_file",edit)])
 ])await assert.rejects(new Proposer(config(choice)).propose(),undefined,
   JSON.stringify(choice.task.permissions.map(x=>x.operation)));
});

test("the Orchestrator is told to put dependency reads in the edit Task, not in read-only Tasks",async()=>{
 const cfg=config(decision("backend",[p("read_file",edit),p("update_file",edit)]));
 await new Proposer(cfg).propose();
 const text=JSON.stringify(cfg.model.request);
 assert.match(text,/Do NOT delegate a read-only Task to read a file you are about to edit/u);
 assert.match(text,/useful ONLY when no edit Task can carry the read/u);
 assert.doesNotMatch(text,/before development, before writing tests, or after a verified failure/u,
  "the old advice that invited superfluous investigation Tasks is gone");
});
