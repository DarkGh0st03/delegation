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
       relevant_paths:["apps/backend/src/users/user.service.ts"]
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
