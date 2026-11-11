import test from "node:test";
import assert from "node:assert/strict";
import {enrollFirstNativeD1ChildAtGateway}
 from "../src/trusted-native-d1-child-gateway-bind.ts";
test("R342 native D1 binding refuses missing owner dependencies before any effect",async()=>{
 await assert.rejects(enrollFirstNativeD1ChildAtGateway({} as never),
  /NO-GO/);
});
