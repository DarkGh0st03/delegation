import assert from "node:assert/strict";
import test from "node:test";
import {setTimeout as sleep} from "node:timers/promises";
import {TaskState} from "@a2a-js/sdk";
import {ClientFactory,ClientFactoryOptions} from "@a2a-js/sdk/client";
import {buildDeterministicArtifactPayload} from "../src/artifact-builder.ts";
import {DeterministicA2AOrchestrator} from "../src/orchestrator.ts";
import {startSpecializedAgentServer} from "../src/server.ts";

const EVIDENCE="SECRET_PRIVATE_DC_ONLY_FOR_TEST";
const request=(url:string)=>({
  agent_base_url:url,
  subtask:{subtask_id:"long-job",instruction:"Work within the allowed Backend file",
    branch:"feature/account-suspension" as const,
    relevant_paths:["apps/backend/src/users/user.service.ts"]},
  delegation_evidence:{credential:EVIDENCE,credential_id:"urn:test:backend",
    presenter_id:"did:thesis:backend"}
});
const clientFor=async(url:string)=>new ClientFactory(ClientFactoryOptions.createFrom(
  ClientFactoryOptions.default,{preferredTransports:["HTTP+JSON"]}
)).createFromUrl(url);

test("A2A polling completes an intentionally slow task, and never persists DC in Task history",async()=>{
  let taskId="";
  const server=await startSpecializedAgentServer({
    role:"backend",host:"127.0.0.1",port:43591,
    taskHandler:async(context)=>{
      taskId=context.task_id;
      await sleep(420);
      return buildDeterministicArtifactPayload("backend",context.subtask);
    }
  });
  try{
    const start=performance.now();
    const result=await new DeterministicA2AOrchestrator({
      deadlineMs:3000,initialIntervalMs:25,maxIntervalMs:100
    }).sendProtectedTask(request(server.baseUrl));
    assert.equal(result.task.status?.state,TaskState.TASK_STATE_COMPLETED);
    assert.ok(performance.now()-start>=350);
    assert.equal(result.task.id,taskId);
    const raw=await (await clientFor(server.baseUrl)).getTask({id:taskId});
    assert.deepEqual(raw.history,[]);
    assert.equal(JSON.stringify(raw).includes(EVIDENCE),false);
    assert.equal(JSON.stringify(result.task).includes(EVIDENCE),false);
    assert.equal(server.executor.taskContexts.get(taskId)?.delegation_evidence.credential,EVIDENCE);
  }finally{await server.close();}
});

test("A2A failed task is terminal and does not disclose thrown provider details",async()=>{
  let id="";
  const server=await startSpecializedAgentServer({
    role:"backend",host:"127.0.0.1",port:43592,
    taskHandler:async(context)=>{
      id=context.task_id;
      await sleep(65);
      throw new Error("NEVER_EXPOSE_PROVIDER_SECRET");
    }
  });
  try{
    await assert.rejects(()=>new DeterministicA2AOrchestrator({
      deadlineMs:1600,initialIntervalMs:20,maxIntervalMs:50
    }).sendProtectedTask(request(server.baseUrl)),/without completion/u);
    const raw=await (await clientFor(server.baseUrl)).getTask({id});
    assert.equal(raw.status?.state,TaskState.TASK_STATE_FAILED);
    assert.equal(JSON.stringify(raw).includes("NEVER_EXPOSE_PROVIDER_SECRET"),false);
    assert.equal(JSON.stringify(raw).includes(EVIDENCE),false);
  }finally{await server.close();}
});

test("A2A deadline cancels slow task and late results cannot produce an Artifact",async()=>{
  let id="";
  let wasAborted=false;
  const server=await startSpecializedAgentServer({
    role:"backend",host:"127.0.0.1",port:43593,
    taskHandler:async(context,signal)=>{
      id=context.task_id;
      signal?.addEventListener("abort",()=>{wasAborted=true;},{once:true});
      await sleep(330);
      return buildDeterministicArtifactPayload("backend",context.subtask);
    }
  });
  try{
    await assert.rejects(()=>new DeterministicA2AOrchestrator({
      deadlineMs:140,initialIntervalMs:20,maxIntervalMs:40
    }).sendProtectedTask(request(server.baseUrl)),/deadline exceeded/u);
    await sleep(360);
    const raw=await (await clientFor(server.baseUrl)).getTask({id});
    assert.equal(raw.status?.state,TaskState.TASK_STATE_CANCELED);
    assert.equal(raw.artifacts.length,0);
    assert.equal(wasAborted,true);
    assert.equal(JSON.stringify(raw).includes(EVIDENCE),false);
  }finally{await server.close();}
});

test("A2A polling config rejects invalid deadline/intervals before network access",()=>{
  assert.throws(()=>new DeterministicA2AOrchestrator({deadlineMs:0}),/positive/u);
  assert.throws(()=>new DeterministicA2AOrchestrator({
    initialIntervalMs:200,maxIntervalMs:20
  }),/not be smaller/u);
});
