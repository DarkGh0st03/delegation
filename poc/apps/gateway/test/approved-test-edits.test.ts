import test from "node:test";
import assert from "node:assert/strict";
import {analyzeApprovedTestEdits} from "../native-test/approved-test-edits.mjs";

const root="gitea://example.test/thesis/app/branches/feature%2Fwork/files/";
const grant=(task_id:string,operation:string,path:string)=>({
  task_id,operation,resource:root+path
});
test("Runner-only Test grant does not invent a mandatory file mutation",()=>{
  const shape=analyzeApprovedTestEdits({
    creates:[],updates:[],reads:[],
    testGrants:[{task_id:"test-final",operation:"run_tests",
      resource:"gitea://example.test/thesis/app/branches/feature%2Fwork"}]
  });
  assert.equal(shape.expectedWriteKeys.size,0);
  assert.deepEqual(shape.createdTestFiles,[]);
  assert.deepEqual(shape.updatedTestFiles,[]);
});
test("Single signed create remains supported",()=>{
  const shape=analyzeApprovedTestEdits({
    creates:["tests/new.test.ts"],updates:[],reads:[],
    testGrants:[grant("test","create_file","tests/new.test.ts")]
  });
  assert.equal(shape.expectedWriteKeys.size,1);
  assert.deepEqual(shape.createdTestFiles,["tests/new.test.ts"]);
});
test("Several separately scoped Test file changes and existing test updates are valid",()=>{
  const grants=[
    grant("test-prep","create_file","tests/feature.test.ts"),
    grant("test-prep","read_file","tests/base.test.ts"),
    grant("test-prep","update_file","tests/base.test.ts"),
    grant("test-followup","read_file","tests/feature.test.ts"),
    grant("test-followup","update_file","tests/feature.test.ts"),
    grant("test-followup","create_file","tests/extra.test.ts")
  ];
  const shape=analyzeApprovedTestEdits({
    creates:["tests/feature.test.ts","tests/extra.test.ts"],
    updates:["tests/base.test.ts","tests/feature.test.ts"],
    reads:["tests/base.test.ts","tests/feature.test.ts"],
    testGrants:grants
  });
  assert.equal(shape.expectedWriteKeys.size,4);
  assert.equal(shape.createdTestFiles.length,2);
  assert.equal(shape.updatedTestFiles.length,2);
});
test("Repeated updates to one path in distinct signed Tasks remain separate obligations",()=>{
  const p="tests/feature.test.ts";
  const grants=[grant("first","read_file",p),grant("first","update_file",p),
    grant("second","read_file",p),grant("second","update_file",p)];
  const shape=analyzeApprovedTestEdits({
    creates:[],updates:[p,p],reads:[p,p],testGrants:grants
  });
  assert.deepEqual(shape.updatedTestFiles,[p]);
  assert.equal(shape.expectedWriteKeys.size,2);
});
test("Missing same-Task read, duplicate creation, or duplicate write are rejected",()=>{
  const p="tests/regression.test.ts";
  assert.throws(()=>analyzeApprovedTestEdits({
    creates:[],updates:[p],reads:[p],
    testGrants:[grant("first","read_file",p),
      grant("second","update_file",p)]
  }),/same-Task read/u);
  assert.throws(()=>analyzeApprovedTestEdits({
    creates:[p,p],updates:[],reads:[],
    testGrants:[grant("first","create_file",p),
      grant("second","create_file",p)]
  }),/Duplicate Test creation/u);
  assert.throws(()=>analyzeApprovedTestEdits({
    creates:[],updates:[p,p],reads:[p],
    testGrants:[grant("first","read_file",p),
      grant("first","update_file",p),grant("first","update_file",p)]
  }),/Duplicate Test write grant/u);
});
