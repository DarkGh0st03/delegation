import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {PLAN_SCHEMA_VERSION} from "../src/plan.mjs";
import {ENVELOPE_SCHEMA_VERSION,validateAuthorizationEnvelope,
 signAuthorizationEnvelope,verifyAuthorizationEnvelope,
 assertPlanWithinEnvelope} from "../src/authorization-envelope.mjs";

const ops=new Set(["create_branch","read_file","update_file","delete_file","run_tests"]);
const repo={authority:"gitea.local",owner:"sample",repository:"new-invoice-repo"};
const root="gitea://gitea.local/sample/new-invoice-repo";
const branch="feature/invoices",uri=root+"/branches/feature%2Finvoices";
const file=uri+"/files/src/invoices.ts";
const keys=generateKeyPairSync("ed25519");
const keyId="engineer-key",did="did:example:engineer";
const trustedKeys={[keyId]:{engineer_did:did,public_key_pem:keys.publicKey.export({type:"spki",format:"pem"})}};
function envelope(){return {schema_version:ENVELOPE_SCHEMA_VERSION,repository:{...repo},branch,
 permissions:[{resource:root,operation:"create_branch"},{resource:file,operation:"read_file"},
 {resource:file,operation:"update_file"},{resource:uri,operation:"run_tests"}]};}
function receipt(e=envelope()){return signAuthorizationEnvelope({envelope:e,
 engineerDid:did,keyId,privateKeyPem:keys.privateKey.export({type:"pkcs8",format:"pem"}),
 issuedAt:"2026-10-29T20:00:00Z",expiresAt:"2026-10-29T21:00:00Z",allowedOperations:ops});}
function authenticated(r=receipt(),nowMs=Date.parse("2026-10-29T20:30:00Z")){
 return verifyAuthorizationEnvelope(r,{trustedKeys,expectedEngineerDid:did,allowedOperations:ops,nowMs});}
function makePlan(task,role="backend",operation="update_file",resource=file){
 return {schema_version:PLAN_SCHEMA_VERSION,plan_id:"plan-"+task,
 session_id:"session-"+task,version:1,repository:{...repo},base_revision:"a".repeat(40),
 requirement:"Fix invoices",candidate_agents:[{agent_id:role,did:"did:example:"+role,card_ref:"trusted:"+role}],
 tasks:[{id:"setup",agent_id:"orchestrator",title:"Branch",description:"Create branch",depends_on:[],resources:[root]},
 {id:task,agent_id:role,title:"Implement",description:"Update code",depends_on:["setup"],resources:[resource]}],
 requested_permissions:[
 {id:"p-setup",task_id:"setup",agent_id:"orchestrator",resource:root,operation:"create_branch",reason:"Setup"},
 {id:"p-work",task_id:task,agent_id:role,resource,operation,reason:"Implement"}],
 assumptions:[],uncertainties:[]};
}
test("Engineer only signs repository, branch, exact pairs and expiry, not roles or Task IDs",()=>{
 const e=envelope(),verified=authenticated();
 assert.deepEqual(Object.keys(e).sort(),["branch","permissions","repository","schema_version"]);
 assert.equal(validateAuthorizationEnvelope(e,{allowedOperations:ops}),e);
 assert.equal(verified.authenticated_engineer_did,did);
 assert.equal(verified.expires_at,"2026-10-29T21:00:00Z");
 assert.equal(Object.hasOwn(e,"max_cycles"),false);
});
test("Different plans and agents are contained in the SAME Engineer scope",()=>{
 const signed=authenticated();
 const one=assertPlanWithinEnvelope(makePlan("initial","backend"),signed,{allowedOperations:ops});
 const two=assertPlanWithinEnvelope(makePlan("repair","frontend"),signed,{allowedOperations:ops});
 assert.equal(one.scope_digest,two.scope_digest);
 assert.equal(one.plan_within_scope,true);
 assert.equal(two.execution_authorized,false);
});
test("No escalation, new resource or new repository or branch",()=>{
 const scope=authenticated();
 assert.throws(()=>assertPlanWithinEnvelope(makePlan("bad","backend","delete_file"),scope,{allowedOperations:ops}),/outside granted/);
 const extra=makePlan("different");
 extra.repository.repository="other-repo";
 assert.throws(()=>assertPlanWithinEnvelope(extra,scope,{allowedOperations:ops}),/outside authorized|external repository/);
 const wrong=makePlan("different");
 wrong.requested_permissions[1].resource=root+"/branches/feature%2Fother/files/src/invoices.ts";
 wrong.tasks[1].resources=[wrong.requested_permissions[1].resource];
 assert.throws(()=>assertPlanWithinEnvelope(wrong,scope,{allowedOperations:ops}),/outside authorized/);
});
test("Duplicate pairs and noncanonical paths and unknown operation fail closed",()=>{
 const dup=envelope();dup.permissions.push({...dup.permissions[0]});
 assert.throws(()=>validateAuthorizationEnvelope(dup,{allowedOperations:ops}),/duplicate/);
 for(const path of [uri+"/files/src/%2e%2e/secret.ts",uri+"/files/*","gitea://other.local/sample/new-invoice-repo"]){
  const x=envelope();x.permissions[1].resource=path;
  assert.throws(()=>validateAuthorizationEnvelope(x,{allowedOperations:ops}),/outside repository/);
 }
 const unknown=envelope();unknown.permissions[0].operation="nonexistent";
 assert.throws(()=>validateAuthorizationEnvelope(unknown,{allowedOperations:ops}),/trusted catalog/);
});
test("Signature tampering, wrong key, expiry, missing catalog rejected",()=>{
 const signed=receipt();
 const tampered=structuredClone(signed);
 tampered.envelope.permissions[1].resource=uri+"/files/src/changed.ts";
 assert.throws(()=>authenticated(tampered),/invalid signature/);
 const wrong=structuredClone(signed);wrong.key_id="other-key";
 assert.throws(()=>authenticated(wrong),/untrusted/);
 assert.throws(()=>authenticated(signed,Date.parse("2026-10-29T21:00:00Z")),/expired/);
 assert.throws(()=>validateAuthorizationEnvelope(envelope()),/catalog/);
});
