import test from "node:test";
import assert from "node:assert/strict";
import {readFile,stat} from "node:fs/promises";
import {randomBytes} from "node:crypto";
import {startTrustedBackendDiscoveryHost} from "../src/trusted-backend-discovery-host.ts";
import {TrustedBackendDiscoveryTaskBindingSocketClient} from "../src/trusted-backend-discovery-task-binding-ipc.ts";

test("native discovery bootstrap separates secrets and fences the holder on idempotent close",async t=>{
 let presentations=0;
 const branch="feature/invoice-approval",path="src/invoices.ts";
 const resource="gitea://gitea.local/sample/invoice-service/branches/feature%2Finvoice-approval/files/"+path;
 const host=await startTrustedBackendDiscoveryHost({
  planTaskId:"discovery",childCredentialId:"urn:child:discovery",
  presenterId:"did:example:backend",branch,path,resource,
  repository:{authority:"gitea.local",owner:"sample",repository:"invoice-service"},
  audience:"cloud-access-gateway",adapterBaseUrl:"http://adapter.local",
  backendToken:"private-backend-only",isTaskActive:()=>true,
  fetchFn:async()=>{presentations++;throw Error("bootstrap must not sign");}
 });
 t.after(()=>host.close());
 const ownerSecret=await readFile(host.ownerBinding.secretFile,"utf8");
 const signerSecret=await readFile(host.gatewaySigner.secretFile,"utf8");
 assert.notEqual(ownerSecret,signerSecret);
 assert.equal((await stat(host.ownerBinding.secretFile)).mode&0o777,0o600);
 assert.equal((await stat(host.gatewaySigner.secretFile)).mode&0o777,0o600);
 const owner=await TrustedBackendDiscoveryTaskBindingSocketClient.connect(host.ownerBinding);
 const pins={runtime_task_id:"dispatch_"+randomBytes(16).toString("base64url"),
  plan_task_id:"discovery",credential_id:"urn:child:discovery",
  presenter_id:"did:example:backend",branch,path,resource,
  audience:"cloud-access-gateway" as const};
 const receipt=await owner.prepare(pins);
 assert.equal(receipt.source_read,false);
 assert.equal(presentations,0);
 await Promise.all([host.close(),host.close()]);
 await assert.rejects(stat(host.ownerBinding.secretFile),{code:"ENOENT"});
 await assert.rejects(stat(host.gatewaySigner.socketPath),{code:"ENOENT"});
 await assert.rejects(host.slot.prepare(pins),/already consumed/);
 assert.equal(presentations,0);
});
