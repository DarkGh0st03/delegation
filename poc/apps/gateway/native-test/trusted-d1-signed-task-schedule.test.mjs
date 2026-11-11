import assert from "node:assert/strict";
import test from "node:test";
import {assertSignedD1ScheduledTask as check}
 from "./trusted-d1-signed-task-schedule.mjs";

const editors=new Map([["fix-backend",{role:"backend"}]]);
const source={
 orderedTaskIds:["fix-backend","retest"],
 validatorTaskId:"retest",editors
};
const generated={
 orderedTaskIds:["fix-generated-test","retest"],
 validatorTaskId:"retest",
 editors:new Map([["fix-generated-test",{role:"test"}]])
};
const multi={
 orderedTaskIds:["fix-backend","fix-frontend","retest"],
 validatorTaskId:"retest",
 editors:new Map([
  ["fix-backend",{role:"backend"}],
  ["fix-frontend",{role:"frontend"}]
 ])
};

test("original source editor and downstream Test validator are admitted",()=>{
 assert.doesNotThrow(()=>check({...source,id:"fix-backend",role:"backend",ordinal:0}));
 assert.doesNotThrow(()=>check({...source,id:"retest",role:"test",ordinal:1}));
});
test("signed Test editor followed by distinct Test validator is admitted",()=>{
 assert.doesNotThrow(()=>check({...generated,id:"fix-generated-test",role:"test",ordinal:0}));
 assert.doesNotThrow(()=>check({...generated,id:"retest",role:"test",ordinal:1}));
});
test("signed multi-editor schedule has unique original role bindings",()=>{
 assert.doesNotThrow(()=>check({...multi,id:"fix-backend",role:"backend",ordinal:0}));
 assert.doesNotThrow(()=>check({...multi,id:"fix-frontend",role:"frontend",ordinal:1}));
 assert.doesNotThrow(()=>check({...multi,id:"retest",role:"test",ordinal:2}));
});
test("wrong role or task identity is denied even if other role is test",()=>{
 for(const x of [
  {...generated,id:"fix-generated-test",role:"backend",ordinal:0},
  {...generated,id:"retest",role:"backend",ordinal:1},
  {...source,id:"fix-backend",role:"test",ordinal:0},
  {...source,id:"retest",role:"test",ordinal:0},
  {...source,id:"unknown",role:"test",ordinal:1},
  {...multi,id:"fix-frontend",role:"frontend",ordinal:0}
 ])assert.throws(()=>check(x),/not in admitted topological schedule/);
});
test("malformed or substituted signed schedules are denied",()=>{
 for(const x of [
  {...generated,orderedTaskIds:["fix-generated-test","fix-generated-test"]},
  {...generated,orderedTaskIds:["retest","fix-generated-test"]},
  {...generated,editors:new Map()},
  {...generated,editors:new Map([["retest",{role:"test"}]])},
  {...generated,editors:new Map([["different",{role:"test"}]])},
  {...generated,id:"fix-generated-test",ordinal:2},
  {...generated,id:"fix-generated-test",ordinal:-1}
 ])assert.throws(()=>check({id:"fix-generated-test",role:"test",ordinal:0,...x}),/not in admitted topological schedule/);
});
