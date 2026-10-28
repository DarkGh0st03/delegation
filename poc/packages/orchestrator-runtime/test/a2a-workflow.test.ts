import assert from "node:assert/strict";
import test from "node:test";
import { TaskState } from "@a2a-js/sdk";
import {
  DelegatedA2ARoleRunner,
  type ChildAuthorityIssuerPort,
  type ProtectedA2AClientPort
} from "../src/index.ts";

const revision = "b".repeat(40);

function credential(role: "backend" | "frontend" | "test") {
  return {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiableCredential", "DelegationCredential"],
    id: `urn:phase9b:${role}`,
    issuer: "did:thesis:orchestrator",
    validFrom: "2026-10-05T00:00:00Z",
    credentialSubject: {
      sub: `did:thesis:${role}-agent`,
      per: []
    }
  };
}

function completedTask(
  role: "backend" | "frontend" | "test",
  artifactRevision = revision
) {
  return {
    id: `task-${role}`,
    contextId: "context-1",
    status: {
      state: TaskState.TASK_STATE_COMPLETED,
      timestamp: "2026-10-05T00:00:00Z",
      message: undefined
    },
    artifacts: [
      {
        artifactId: `artifact-${role}`,
        name: `${role}-result`,
        description: "",
        parts: [
          {
            content: {
              $case: "data" as const,
              value: {
                role,
                summary: `${role} completed`,
                files_modified: [],
                files_created: [],
                branch: "feature/account-suspension",
                revision: artifactRevision,
                commit_sha: artifactRevision,
                test_outcome: role === "test" ? "pass" : "not_run",
                errors: []
              }
            },
            metadata: undefined,
            filename: "",
            mediaType: "application/json"
          }
        ],
        metadata: undefined,
        extensions: []
      }
    ],
    history: [],
    metadata: undefined
  };
}

test("child authority is issued immediately before the protected Backend A2A task", async () => {
  const events: string[] = [];
  let issuedInput: unknown;
  let a2aRequest: unknown;

  const issuer: ChildAuthorityIssuerPort = {
    async issueSpecializedChild(input) {
      events.push("issue");
      issuedInput = structuredClone(input);
      return {
        role: "backend",
        credential: credential("backend")
      };
    }
  };

  const a2a: ProtectedA2AClientPort = {
    async sendProtectedTask(request) {
      events.push("send");
      a2aRequest = structuredClone(request);
      return {
        card: { name: "Backend Development Agent" },
        task: completedTask("backend") as never
      };
    }
  };

  const runner = new DelegatedA2ARoleRunner({
    authorityIssuer: issuer,
    a2a
  });

  const result = await runner.issueAndRun({
    role: "backend",
    parent_credential_id: "urn:phase9b:root",
    credential_id: "urn:phase9b:backend",
    valid_from: "2026-10-05T00:00:00Z",
    validity_seconds: 1800,
    credential_status: {
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "9301",
      statusListCredential:
        "https://status.example/lists/phase9b"
    },
    agent_base_url: "http://backend.local",
    subtask: {
      subtask_id: "backend-task",
      instruction: "Validate Backend delegation.",
      branch: "feature/account-suspension",
      relevant_paths: [
        "apps/backend/src/users/user.service.ts"
      ]
    },
  });

  assert.deepEqual(events, ["issue", "send"]);
  assert.deepEqual(
    (issuedInput as { selection: unknown }).selection,
    { role: "backend" }
  );
  assert.equal(
    (a2aRequest as {
      delegation_evidence: { credential_id: string };
    }).delegation_evidence.credential_id,
    "urn:phase9b:backend"
  );
  assert.match(
    (a2aRequest as {
      delegation_evidence: { credential: string };
    }).delegation_evidence.credential,
    /DelegationCredential/u
  );
  assert.equal(result.artifact.role, "backend");
  assert.equal(result.artifact.revision, revision);
  assert.equal(
    result.remote_agent_name,
    "Backend Development Agent"
  );
});

test("role runner accepts a newer Artifact revision produced by the delegated task", async () => {
  const issuer: ChildAuthorityIssuerPort = {
    async issueSpecializedChild() {
      return {
        role: "backend",
        credential: credential("backend")
      };
    }
  };
  const a2a: ProtectedA2AClientPort = {
    async sendProtectedTask() {
      return {
        card: { name: "Backend Development Agent" },
        task: completedTask(
          "backend",
          "c".repeat(40)
        ) as never
      };
    }
  };

  const runner = new DelegatedA2ARoleRunner({
    authorityIssuer: issuer,
    a2a
  });

  const result = await runner.issueAndRun({
    role: "backend",
    parent_credential_id: "urn:phase9b:root",
    credential_id: "urn:phase9b:backend",
    valid_from: "2026-10-05T00:00:00Z",
    validity_seconds: 1800,
    credential_status: {
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "9301",
      statusListCredential:
        "https://status.example/lists/phase9b"
    },
    agent_base_url: "http://backend.local",
    subtask: {
      subtask_id: "backend-task",
      instruction: "Validate Backend delegation.",
      branch: "feature/account-suspension",
      relevant_paths: []
    },
  });

  assert.equal(result.artifact.revision, "c".repeat(40));
});

test("role runner rejects a non-completed A2A Task before accepting its Artifact", async () => {
  const issuer: ChildAuthorityIssuerPort = {
    async issueSpecializedChild() {
      return {
        role: "backend",
        credential: credential("backend")
      };
    }
  };
  const a2a: ProtectedA2AClientPort = {
    async sendProtectedTask() {
      const task = completedTask("backend");
      task.status.state = TaskState.TASK_STATE_FAILED;
      return {
        card: { name: "Backend Development Agent" },
        task: task as never
      };
    }
  };

  const runner = new DelegatedA2ARoleRunner({
    authorityIssuer: issuer,
    a2a
  });

  await assert.rejects(
    () =>
      runner.issueAndRun({
        role: "backend",
        parent_credential_id: "urn:phase9b:root",
        credential_id: "urn:phase9b:backend",
        valid_from: "2026-10-05T00:00:00Z",
        validity_seconds: 1800,
        credential_status: {
          type: "BitstringStatusListEntry",
          statusPurpose: "revocation",
          statusListIndex: "9301",
          statusListCredential:
            "https://status.example/lists/phase9b"
        },
        agent_base_url: "http://backend.local",
        subtask: {
          subtask_id: "backend-task",
          instruction: "Validate Backend delegation.",
          branch: "feature/account-suspension",
          relevant_paths: []
        },
          }),
    /is not completed/u
  );
});

test("malformed prebound Gateway Task ID cannot mint a child DC",async()=>{
  let issues=0;
  let sends=0;
  const runner=new DelegatedA2ARoleRunner({
    authorityIssuer:{async issueSpecializedChild(){
      issues++;
      return {role:"backend",credential:credential("backend")};
    }},
    a2a:{async sendProtectedTask(){
      sends++;
      throw Error("Invalid test must never reach A2A");
    }}
  });
  await assert.rejects(runner.issueAndRun({
    role:"backend",parent_credential_id:"urn:trusted:operational-root",
    credential_id:"urn:phase9b:backend",
    valid_from:"2026-10-21T18:00:00Z",validity_seconds:300,
    credential_status:{
      type:"BitstringStatusListEntry",statusPurpose:"revocation",
      statusListIndex:"7101",
      statusListCredential:"https://status.example/preflight"
    },
    agent_base_url:"http://trusted-backend.local",
    trusted_gateway_task_id:"unbound-user-supplied-task",
    subtask:{subtask_id:"backend",instruction:"Approved code edit",
      branch:"feature/account-suspension",relevant_paths:[]}
  }),/Invalid trusted pre-dispatch Gateway Task ID/);
  assert.equal(issues,0);
  assert.equal(sends,0);
});


test("approved A2A task refuses issuer without operational guard before mint/send",async()=>{
  let minted=0,sent=0;
  const runner=new DelegatedA2ARoleRunner({
    authorityIssuer:{
      async issueSpecializedChild(){
        minted++;
        return {role:"backend",credential:credential("backend")};
      }
    },
    a2a:{
      async sendProtectedTask(){
        sent++;
        return {card:{name:"Backend"},task:completedTask("backend") as never};
      }
    }
  });
  await assert.rejects(runner.issueAndRun({
    role:"backend",approved_task_id:"backend",
    parent_credential_id:"urn:trusted:operational-root",
    credential_id:"urn:phase9b:backend",
    valid_from:"2026-10-21T18:00:00Z",validity_seconds:300,
    credential_status:{
      type:"BitstringStatusListEntry",statusPurpose:"revocation",
      statusListIndex:"7201",
      statusListCredential:"https://status.example/approved"
    },
    agent_base_url:"http://trusted-backend.local",
    subtask:{
      subtask_id:"backend",instruction:"Authorized backend task",
      branch:"feature/account-suspension",relevant_paths:[]
    }
  }),/requires operational authority guard/u);
  assert.equal(minted,0);
  assert.equal(sent,0);
});

test("approved A2A task checks operational root before AND after child issuance",async()=>{
  const events:string[]=[];
  const runner=new DelegatedA2ARoleRunner({
    authorityIssuer:{
      assertActiveBeforeA2ASend(){events.push("liveness");},
      async issueSpecializedChild(){
        events.push("mint");
        return {role:"backend",credential:credential("backend")};
      }
    },
    a2a:{
      async sendProtectedTask(){
        events.push("send");
        return {card:{name:"Backend"},task:completedTask("backend") as never};
      }
    }
  });
  const result=await runner.issueAndRun({
    role:"backend",approved_task_id:"backend",
    parent_credential_id:"urn:trusted:operational-root",
    credential_id:"urn:phase9b:backend",
    valid_from:"2026-10-21T18:00:00Z",validity_seconds:300,
    credential_status:{
      type:"BitstringStatusListEntry",statusPurpose:"revocation",
      statusListIndex:"7202",
      statusListCredential:"https://status.example/approved"
    },
    agent_base_url:"http://trusted-backend.local",
    subtask:{
      subtask_id:"backend",instruction:"Authorized backend task",
      branch:"feature/account-suspension",relevant_paths:[]
    }
  });
  assert.equal(result.task_id,"task-backend");
  assert.deepEqual(events,["liveness","mint","liveness","send"]);
});

test("signed two-Test A2A workflow accepts independently scoped preparation but requires final PASS",async()=>{
  const pathsSeen:string[]=[];
  let forgePreparationVerdict=false;
  const runner=new DelegatedA2ARoleRunner({
    authorityIssuer:{
      assertActiveBeforeA2ASend(){},
      async issueSpecializedChild(input){
        assert.equal(input.selection.role,"test");
        return {role:"test",credential:credential("test")};
      }
    },
    a2a:{
      async sendProtectedTask(request){
        const prep=request.subtask.approved_run_tests===false;
        pathsSeen.push(request.subtask.subtask_id);
        const task=completedTask("test") as any;
        task.id="sdk-"+request.subtask.subtask_id;
        const artifact=task.artifacts[0].parts[0].content.value;
        if(prep){
          artifact.files_created=["tests/e2e/approved.spec.ts"];
          artifact.test_outcome=forgePreparationVerdict?"pass":"not_run";
          if(forgePreparationVerdict){
            artifact.tested_commit_sha=revision;
            artifact.runner_profile="poc-default";
            artifact.project_tests="pass";
            artifact.researcher_acceptance="pass";
          }
        }else{
          artifact.test_outcome="pass";
          artifact.tested_commit_sha=revision;
          artifact.runner_profile="poc-default";
          artifact.project_tests="pass";
          artifact.researcher_acceptance="pass";
        }
        return {card:{name:"Test Agent"},task:task as never};
      }
    }
  });
  const common={
    role:"test" as const,
    parent_credential_id:"urn:trusted:operational-root",
    credential_id:"urn:phase9b:test",
    valid_from:"2026-10-28T11:00:00Z",validity_seconds:300,
    credential_status:{
      type:"BitstringStatusListEntry" as const,
      statusPurpose:"revocation" as const,
      statusListIndex:"7311",
      statusListCredential:"https://status.example/approved"
    },
    agent_base_url:"http://trusted-test.local"
  };
  const preparation={
    ...common,approved_task_id:"test-preparation",
    trusted_gateway_task_id:"dispatch_"+"A".repeat(22),
    subtask:{
      subtask_id:"test-preparation",
      instruction:"Prepare signed regression without Runner",
      branch:"feature/account-suspension",
      relevant_paths:["tests/e2e/approved.spec.ts"],
      approved_file_permissions:[{
        operation:"create_file" as const,path:"tests/e2e/approved.spec.ts"
      }],
      approved_run_tests:false
    }
  };
  const acceptance={
    ...common,approved_task_id:"test",
    trusted_gateway_task_id:"dispatch_"+"B".repeat(22),
    subtask:{
      subtask_id:"test",
      instruction:"Run signed final Docker acceptance",
      branch:"feature/account-suspension",
      relevant_paths:[],
      approved_file_permissions:[],
      approved_run_tests:true
    }
  };
  const first=await runner.issueAndRun(preparation);
  assert.equal(first.artifact.test_outcome,"not_run");
  assert.deepEqual(first.artifact.files_created,["tests/e2e/approved.spec.ts"]);
  assert.equal(first.artifact.tested_commit_sha,undefined);
  const second=await runner.issueAndRun(acceptance);
  assert.equal(second.artifact.test_outcome,"pass");
  assert.equal(second.artifact.tested_commit_sha,revision);
  assert.deepEqual(pathsSeen,["test-preparation","test"]);
  forgePreparationVerdict=true;
  await assert.rejects(runner.issueAndRun(preparation),
    /Signed Test preparation Artifact must report not_run/u);
});
test("signed Test preparation rejects forged Runner fields even with not_run outcome",async()=>{
  const {validateWorkflowArtifact}=await import("../src/artifact-validation.ts");
  const artifact={
    role:"test",summary:"Prepared authorized regression",
    branch:"feature/account-suspension",
    revision,commit_sha:revision,files_created:["tests/e2e/approved.spec.ts"],
    files_modified:[],test_outcome:"not_run",errors:[],
    tested_commit_sha:revision,runner_profile:"poc-default",
    project_tests:"pass",researcher_acceptance:"pass"
  };
  assert.throws(()=>validateWorkflowArtifact(artifact,"test",{
    requireTestNotRun:true,
    expectedBranch:"feature/account-suspension"
  }),/must not claim Runner evidence/u);
  assert.throws(()=>validateWorkflowArtifact(artifact,"test",{
    requireTestPass:true,requireTestNotRun:true
  }),/Conflicting signed Test artifact expectations/u);
});
