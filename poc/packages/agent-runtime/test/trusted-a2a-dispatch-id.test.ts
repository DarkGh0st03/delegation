import test from "node:test";
import assert from "node:assert/strict";
import {TaskState} from "@a2a-js/sdk";
import {DeterministicA2AOrchestrator} from "../src/orchestrator.ts";
import {startSpecializedAgentServer} from "../src/server.ts";
import {buildDeterministicArtifactPayload} from "../src/artifact-builder.ts";
import {modelVisibleTaskContext} from "../src/agent-controller.ts";

const ID="dispatch_"+"A".repeat(22);
test("real A2A transport retains a prebound Gateway ID privately, distinct from the SDK Task ID",async()=>{
 let context:any;
 const server=await startSpecializedAgentServer({
   role:"backend",host:"127.0.0.1",port:43608,
   taskHandler:async ctx=>{
     context=structuredClone(ctx);
     return buildDeterministicArtifactPayload("backend",ctx.subtask);
   }
 });
 try{
   const client=new DeterministicA2AOrchestrator({
     deadlineMs:4000,initialIntervalMs:20,maxIntervalMs:100
   });
   const request={
     agent_base_url:server.baseUrl,
     trusted_gateway_task_id:ID,
     subtask:{
       subtask_id:"approved-backend",instruction:"Modify only approved file",
       branch:"feature/engineer-approved-42" as const,
       relevant_paths:["apps/backend/src/users/user.service.ts"],
       approved_file_permissions:[
         {operation:"read_file" as const,path:"apps/backend/src/users/user.service.ts"},
         {operation:"update_file" as const,path:"apps/backend/src/users/user.service.ts"}
       ]
     },
     delegation_evidence:{
       credential:"PRIVATE_TEST_DELEGATION_CREDENTIAL",
       credential_id:"urn:trusted:test-backend",presenter_id:"did:thesis:backend"
     }
   };
   const response=await client.sendProtectedTask(request);
   assert.equal(response.task.status?.state,TaskState.TASK_STATE_COMPLETED);
   assert.equal(context.task_id,response.task.id);
   assert.notEqual(response.task.id,ID);
   assert.equal(context.trusted_gateway_task_id,ID);
   assert.equal(context.subtask.branch,"feature/engineer-approved-42");
   assert.deepEqual(context.subtask.approved_file_permissions,
     request.subtask.approved_file_permissions);
   assert.equal(JSON.stringify(response.task).includes("approved_file_permissions"),false);
   const modelVisible=modelVisibleTaskContext(context);
   assert.equal(Object.hasOwn(modelVisible,"trusted_gateway_task_id"),false);
   assert.equal(JSON.stringify(modelVisible).includes(ID),false);
   assert.equal(JSON.stringify(response.task).includes(ID),false);
   assert.equal(JSON.stringify(response.task).includes("PRIVATE_TEST_DELEGATION_CREDENTIAL"),false);
   assert.deepEqual(response.task.history,[]);
   assert.equal(server.executor.taskContexts.get(response.task.id)?.trusted_gateway_task_id,ID);
   await assert.rejects(
     client.sendProtectedTask({...request,trusted_gateway_task_id:"bad-id"}),
     /Invalid trusted Gateway dispatch binding/
   );
 }finally{await server.close();}
});

test("real A2A transport preserves signed Test no-Runner hint across separate Tasks",async()=>{
  const contexts:any[]=[];
  const server=await startSpecializedAgentServer({
    role:"test",host:"127.0.0.1",port:43609,
    taskHandler:async ctx=>{
      contexts.push(structuredClone(ctx));
      const prep=ctx.subtask.approved_run_tests===false;
      return {
        role:"test",summary:"Test Task completed under signed scope",
        branch:ctx.subtask.branch,
        revision:"b".repeat(40),commit_sha:"b".repeat(40),
        files_modified:[],
        files_created:prep?["tests/e2e/signed.spec.ts"]:[],
        test_outcome:prep?"not_run":"pass",
        errors:[],
        ...(!prep?{
          tested_commit_sha:"b".repeat(40),
          runner_profile:"poc-default" as const,
          project_tests:"pass" as const,
          researcher_acceptance:"pass" as const
        }:{})
      };
    }
  });
  try{
    const client=new DeterministicA2AOrchestrator({
      deadlineMs:5000,initialIntervalMs:20,maxIntervalMs:100
    });
    const common={
      agent_base_url:server.baseUrl,
      delegation_evidence:{
        credential:"PRIVATE_SIGNED_TEST_CREDENTIAL",
        credential_id:"urn:trusted:test",presenter_id:"did:thesis:test"
      }
    };
    const prep=await client.sendProtectedTask({
      ...common,trusted_gateway_task_id:"dispatch_"+"C".repeat(22),
      subtask:{
        subtask_id:"test-preparation",instruction:"Create only signed regression",
        branch:"feature/engineer-approved-42",
        relevant_paths:["tests/e2e/signed.spec.ts"],
        approved_file_permissions:[{
          operation:"create_file" as const,path:"tests/e2e/signed.spec.ts"
        }],
        approved_run_tests:false
      }
    });
    const final=await client.sendProtectedTask({
      ...common,trusted_gateway_task_id:"dispatch_"+"D".repeat(22),
      subtask:{
        subtask_id:"test",instruction:"Run final signed acceptance",
        branch:"feature/engineer-approved-42",
        relevant_paths:[],
        approved_file_permissions:[],
        approved_run_tests:true
      }
    });
    assert.equal(prep.task.status?.state,TaskState.TASK_STATE_COMPLETED);
    assert.equal(final.task.status?.state,TaskState.TASK_STATE_COMPLETED);
    assert.equal(contexts.length,2);
    assert.equal(contexts[0].subtask.approved_run_tests,false,
      "A false Runner hint MUST survive the private A2A parsing boundary");
    assert.equal(contexts[1].subtask.approved_run_tests,true);
    assert.notEqual(contexts[0].trusted_gateway_task_id,
      contexts[1].trusted_gateway_task_id);
    for(const task of [prep.task,final.task]){
      assert.equal(JSON.stringify(task).includes("approved_run_tests"),false);
      assert.equal(JSON.stringify(task).includes("PRIVATE_SIGNED_TEST_CREDENTIAL"),false);
    }
    await assert.rejects(client.sendProtectedTask({
      ...common,trusted_gateway_task_id:"dispatch_"+"E".repeat(22),
      subtask:{
        subtask_id:"bad-test",instruction:"Malformed signed Runner hint",
        branch:"feature/engineer-approved-42",
        relevant_paths:[],
        approved_file_permissions:[],
        approved_run_tests:"false" as never
      }
    }),/without completion/u);
    assert.equal(contexts.length,2,
      "Malformed Runner hints must be rejected before Task handler");
  }finally{await server.close();}
});
