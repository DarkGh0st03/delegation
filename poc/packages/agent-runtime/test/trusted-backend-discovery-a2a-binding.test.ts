import assert from "node:assert/strict";
import {test} from "node:test";
import {TrustedBackendDiscoveryChildPresenter} from "../src/trusted-backend-discovery-presenter.ts";
import {TrustedBackendDiscoveryCryptoPresentation} from
 "../src/trusted-backend-discovery-crypto-presentation.ts";
import {validateTrustedBackendDiscoveryA2ABinding,
 selectTrustedBackendDiscoveryA2A} from
 "../src/trusted-backend-discovery-a2a-binding.ts";
const repo={authority:"gitea.local",owner:"sample",repository:"invoice-service"};
const path="src/invoices.ts",branch="feature/invoice-approval";
const resource="gitea://gitea.local/sample/invoice-service/branches/feature%2Finvoice-approval/files/src/invoices.ts";
const credential="urn:child:r151-remote-discovery",did="did:example:backend";
function fixture(){
 const holder=new TrustedBackendDiscoveryChildPresenter({
  adapterBaseUrl:"http://adapter.local:8090/",backendToken:"PRIVATE",
  childCredentialId:credential,resource,audience:"cloud-access-gateway",
  isTaskActive:()=>true
 });
 const presentation=new TrustedBackendDiscoveryCryptoPresentation({
  holder,childCredentialId:credential,resource,audience:"cloud-access-gateway",
  isTaskActive:()=>true
 });
 const binding={planTaskId:"r151-child-task",runtimeTaskId:"r151-remote-gateway",
  childCredentialId:credential,presenterId:did,repository:repo,
  branch,path,resource,audience:"cloud-access-gateway" as const,presentation};
 const context={
  task_id:"r151-a2a",context_id:"r151-context",
  trusted_gateway_task_id:"r151-remote-gateway",role:"backend" as const,
  subtask:{subtask_id:"r151-child-task",instruction:"Read source only",branch,
   relevant_paths:[path],approved_run_tests:false,
   approved_file_permissions:[{path,operation:"read_file" as const}]},
  delegation_evidence:{credential:"PRIVATE_CHILD",credential_id:credential,
   presenter_id:did}
 };
 return {binding,context,presentation};
}
test("R151.36 exact signed A2A Backend Task selects private Child holder",()=>{
 const {binding,context,presentation}=fixture();
 validateTrustedBackendDiscoveryA2ABinding(binding);
 assert.equal(selectTrustedBackendDiscoveryA2A(binding,context),presentation);
});
test("R151.36 wrong scope, identity or privilege never selects Backend signer",()=>{
 const {binding,context}=fixture();
 const mismatches=[
  {role:"test"},
  {trusted_gateway_task_id:"foreign"},
  {subtask:{...context.subtask,branch:"feature/foreign"}},
  {subtask:{...context.subtask,approved_run_tests:true}},
  {subtask:{...context.subtask,relevant_paths:[path,"src/secret.ts"]}},
  {subtask:{...context.subtask,approved_file_permissions:[
   {path,operation:"update_file"}]}},
  {subtask:{...context.subtask,approved_file_permissions:[
   {path,operation:"read_file"},{path:"src/secret.ts",operation:"read_file"}]}},
  {delegation_evidence:{...context.delegation_evidence,credential_id:"other"}},
  {delegation_evidence:{...context.delegation_evidence,presenter_id:"did:example:other"}}
 ];
 for(const changed of mismatches)
  assert.throws(()=>selectTrustedBackendDiscoveryA2A(binding,{
   ...context,...changed
  } as typeof context),/Trusted Backend discovery A2A NO-GO/);
});
test("R151.36 other Task remains unchanged; canonical mismatch denied",()=>{
 const {binding,context}=fixture();
 assert.equal(selectTrustedBackendDiscoveryA2A(binding,{
  ...context,trusted_gateway_task_id:"unrelated",
  subtask:{...context.subtask,subtask_id:"unrelated"},
  delegation_evidence:{...context.delegation_evidence,credential_id:"unrelated"}
 }),undefined);
 for(const x of [
  {...binding,resource:resource+"-foreign"},
  {...binding,path:"src/foreign.ts"},
  {...binding,branch:"feature/other"},
  {...binding,childCredentialId:"foreign-child"},
  {...binding,repository:{...repo,owner:"foreign"}}
 ])assert.throws(()=>validateTrustedBackendDiscoveryA2ABinding(x),
  /Trusted Backend discovery A2A NO-GO/);
});
