import test from "node:test";
import assert from "node:assert/strict";
import {ENVELOPE_SCHEMA_VERSION,validateAuthorizationEnvelope} from "../src/authorization-envelope.mjs";

// The maximum delegation scope: repository, work branch and exact canonical
// resource/operation pairs. No roles, Task IDs or plan structure.
const ops=new Set(["create_branch","read_file","update_file","delete_file","run_tests"]);
const repo={authority:"gitea.local",owner:"sample",repository:"new-invoice-repo"};
const root="gitea://gitea.local/sample/new-invoice-repo";
const branch="feature/invoices",uri=root+"/branches/feature%2Finvoices";
const file=uri+"/files/src/invoices.ts";
function envelope(){return {schema_version:ENVELOPE_SCHEMA_VERSION,repository:{...repo},branch,
 permissions:[{resource:root,operation:"create_branch"},{resource:file,operation:"read_file"},
 {resource:file,operation:"update_file"},{resource:uri,operation:"run_tests"}]};}

test("the scope holds only repository, branch and exact pairs",()=>{
 const e=envelope();
 assert.deepEqual(Object.keys(e).sort(),["branch","permissions","repository","schema_version"]);
 assert.equal(validateAuthorizationEnvelope(e,{allowedOperations:ops}),e);
 assert.throws(()=>validateAuthorizationEnvelope({...e,tasks:[]},{allowedOperations:ops}),/invalid fields/);
});
test("duplicate pairs, noncanonical paths and unknown operations fail closed",()=>{
 const dup=envelope();dup.permissions.push({...dup.permissions[0]});
 assert.throws(()=>validateAuthorizationEnvelope(dup,{allowedOperations:ops}),/duplicate/);
 for(const path of [uri+"/files/src/%2e%2e/secret.ts",uri+"/files/*","gitea://other.local/sample/new-invoice-repo"]){
  const x=envelope();x.permissions[1].resource=path;
  assert.throws(()=>validateAuthorizationEnvelope(x,{allowedOperations:ops}),/outside repository/);
 }
 const unknown=envelope();unknown.permissions[0].operation="nonexistent";
 assert.throws(()=>validateAuthorizationEnvelope(unknown,{allowedOperations:ops}),/trusted catalog/);
 assert.throws(()=>validateAuthorizationEnvelope(envelope(),{}),/catalog/);
});
