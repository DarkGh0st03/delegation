import test from "node:test";
import assert from "node:assert/strict";
import {safeSignedTaskRef} from "../src/signed-task-diagnostic-ref.mjs";
test("trusted random dispatch has a stable non-authorizing opaque task reference",()=>{
 const t="dispatch_"+Buffer.alloc(16,7).toString("base64url");
 const u="dispatch_"+Buffer.alloc(16,8).toString("base64url");
 assert.match(safeSignedTaskRef(t),/^[a-f0-9]{16}$/u);
 assert.equal(safeSignedTaskRef(t),safeSignedTaskRef(t));
 assert.notEqual(safeSignedTaskRef(t),safeSignedTaskRef(u));
 assert.ok(!safeSignedTaskRef(t).includes(t));
});
test("legacy/predictable or malformed task IDs do not receive a public reference",()=>{
 for(const value of [undefined,null,"backend", "dispatch_private",
   "PRIVATE_SOURCE_SECRET","dispatch_"+"x".repeat(23),
   "dispatch_"+"x".repeat(21)]){
  assert.equal(safeSignedTaskRef(value),null);
 }
});
