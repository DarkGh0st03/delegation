import test from "node:test";
import assert from "node:assert/strict";
import {D1GatewayOperationAudit} from "./d1-gateway-operation-audit.mjs";
const make=()=>{const audit=new D1GatewayOperationAudit();
 const binding={role:"frontend",taskId:"repair-ui",runtimeTaskId:"dispatch_"+ "A".repeat(22)};
 audit.begin(binding);return {audit,binding};};
const snapshot=(audit,binding,writes=0,headChanged=false)=>
 audit.snapshot({...binding,taskWriteCount:writes,headChanged});
test("D1 audit distinguishes model no-write from denied and unconfirmed operations",()=>{
 const a=make();assert.equal(snapshot(a.audit,a.binding).d1_operation_status,"no_update_attempted");
 assert.equal(a.audit.attempt({role:"frontend",runtimeTaskId:a.binding.runtimeTaskId,tool:"read_file"}),true);
 a.audit.prepared({runtimeTaskId:a.binding.runtimeTaskId,tool:"read_file",requestId:"r1"});
 assert.equal(a.audit.confirmed({requestId:"r1",effect:{provider:"gitea",tool:"read_file"}}),true);
 assert.equal(snapshot(a.audit,a.binding).read_confirmed,1);
 assert.equal(a.audit.attempt({role:"frontend",runtimeTaskId:a.binding.runtimeTaskId,tool:"update_file"}),true);
 a.audit.rejectedPrepare({runtimeTaskId:a.binding.runtimeTaskId,tool:"update_file"});
 assert.deepEqual([snapshot(a.audit,a.binding).update_attempts,snapshot(a.audit,a.binding).update_denied],[1,1]);
 assert.equal(snapshot(a.audit,a.binding).d1_operation_status,"update_denied");
 const b=make();b.audit.attempt({role:"frontend",runtimeTaskId:b.binding.runtimeTaskId,tool:"update_file"});
 assert.equal(snapshot(b.audit,b.binding).d1_operation_status,"update_not_confirmed");
 b.audit.prepared({runtimeTaskId:b.binding.runtimeTaskId,tool:"update_file",requestId:"w1"});
 assert.equal(b.audit.confirmed({requestId:"w1",effect:{provider:"gitea",tool:"update_file"}}),true);
 assert.equal(snapshot(b.audit,b.binding).d1_operation_status,"effect_correlation_failure");
 assert.equal(snapshot(b.audit,b.binding,1,true).d1_operation_status,"confirmed");
});
test("Denied execution and mismatched provider effect cannot be reclassified as a confirmed edit",()=>{
 const {audit,binding}=make();
 audit.attempt({role:"frontend",runtimeTaskId:binding.runtimeTaskId,tool:"update_file"});
 audit.prepared({runtimeTaskId:binding.runtimeTaskId,tool:"update_file",requestId:"w2"});
 assert.equal(audit.rejectedExecute("w2"),true);
 assert.equal(snapshot(audit,binding).update_denied,1);
 assert.equal(audit.rejectedExecute("w2"),false);
 audit.prepared({runtimeTaskId:binding.runtimeTaskId,tool:"update_file",requestId:"w3"});
 assert.throws(()=>audit.confirmed({requestId:"w3",effect:{provider:"runner",tool:"update_file"}}));
 assert.equal(snapshot(audit,binding).update_provider_confirmed,0);
});
test("Only fresh exact runtime Task bindings contribute to private counters",()=>{
 const {audit,binding}=make();
 assert.equal(audit.attempt({role:"backend",runtimeTaskId:binding.runtimeTaskId,tool:"update_file"}),false);
 assert.equal(audit.attempt({role:"frontend",runtimeTaskId:"dispatch_"+ "B".repeat(22),tool:"update_file"}),false);
 assert.equal(snapshot(audit,binding).update_attempts,0);
 assert.throws(()=>audit.begin(binding));
 assert.throws(()=>snapshot(audit,{...binding,taskId:"other"}));
 assert.ok(!JSON.stringify(snapshot(audit,binding)).includes(binding.runtimeTaskId));
});
