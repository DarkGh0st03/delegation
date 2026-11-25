import test from "node:test";
import assert from "node:assert/strict";
import {giteaPermissionCovers as covers} from "../src/gitea-permission-containment.mjs";

const root="gitea://gitea.local/thesis/sample-app/branches/feature%2Fsample-change";
const p=(suffix,operation="read_file")=>({resource:root+"/"+suffix,operation});
test("exact permissions stay exact and branch/root operations never gain descendants",()=>{
 assert.equal(covers(p("files/apps/backend/user.ts"),p("files/apps/backend/user.ts")),true);
 assert.equal(covers(p("files/apps/backend/user.ts"),p("files/apps/backend/user2.ts")),false);
 assert.equal(covers({resource:root,operation:"run_tests"},p("files/apps/backend/user.ts","run_tests")),false);
 assert.equal(covers({resource:root,operation:"create_branch"},p("directories","create_branch")),false);
});
test("directory grants cover nested directories/files for the SAME operation",()=>{
 for(const op of ["read_file","update_file","create_file","list_directory"]){
  const parent=p("directories/apps/backend",op);
  assert.equal(covers(parent,p("directories/apps/backend/src",op)),true);
  assert.equal(covers(parent,p("files/apps/backend/src/user.ts",op)),true);
  assert.equal(covers(p("directories",op),p("files/apps/backend/src/user.ts",op)),true);
  assert.equal(covers(parent,p("files/apps/backend-extra/escape.ts",op)),false);
  assert.equal(covers(parent,p("files/apps/backend/src/user.ts","run_tests")),false);
 }
});
test("no prefix, branch/repository crossing, traversal, URI aliases or encoded-path expansion",()=>{
 const parent=p("directories/apps/backend");
 for(const denied of [
  "files/apps/backend-extra/file.ts",
  "files/apps/backends/file.ts",
  "files/apps/backend/../secret.ts",
  "files/apps/backend/%2E%2E/secret.ts",
  "files/apps/backend/a%2Fb",
  "files/apps/backend/%252E",
  "files/apps/backend//bad.ts",
  "files/apps/backend/evil?query",
  "files/apps/backend/evil#fragment",
  "files/apps/backend/evil\0bad",
  "files/apps/backend/a..b",
  "directories/apps/backend/../../secret",
 ]){
  assert.equal(covers(parent,p(denied)),false,denied);
 }
 assert.equal(covers(parent,{resource:"gitea://gitea.local/thesis/other/branches/feature%2Fsample-change/files/apps/backend/u.ts",operation:"read_file"}),false);
 assert.equal(covers(parent,{resource:"gitea://other.local/thesis/sample-app/branches/feature%2Fsample-change/files/apps/backend/u.ts",operation:"read_file"}),false);
 assert.equal(covers(parent,{resource:"gitea://gitea.local/thesis/sample-app/branches/main/files/apps/backend/u.ts",operation:"read_file"}),false);
 assert.equal(covers(parent,{resource:root.replace("feature%2Fsample-change","feature%2fsample-change")+"/files/apps/backend/u.ts",operation:"read_file"}),false);
 assert.equal(covers(p("files/apps/backend"),p("files/apps/backend/u.ts")),false);
});
test("file grant, unknown operation or malformed input never create implicit authority",()=>{
 assert.equal(covers(null,p("files/apps/backend/u.ts")),false);
 assert.equal(covers(p("directories/apps/backend","read_file"),p("files/apps/backend/u.ts","update_file")),false);
 assert.equal(covers(p("directories/apps/backend","delete_file"),p("files/apps/backend/u.ts","delete_file")),false);
 assert.equal(covers({resource:"not-a-uri",operation:"read_file"},p("files/apps/backend/u.ts")),false);
});

test("read+update grant shape: N distinct exact reads including the edited file, then ONE update",async()=>{
 const {readUpdateGrantShape,MAX_TASK_READS}=await import("../src/gitea-permission-containment.mjs");
 const base="gitea://gitea.local/thesis/sample-app/branches/feature%2Fx/files/";
 const p=(operation,path)=>({operation,resource:base+path});
 const edit="apps/backend/src/a.ts",dep="apps/backend/src/b.ts";
 const ok=readUpdateGrantShape([p("read_file",edit),p("read_file",dep),p("update_file",edit)]);
 assert.equal(ok.edit,base+edit);
 assert.deepEqual([...ok.reads].sort(),[base+edit,base+dep].sort());
 assert.ok(readUpdateGrantShape([p("read_file",edit),p("update_file",edit)]));
 for(const bad of [
  [p("read_file",dep),p("update_file",edit)],
  [p("read_file",edit),p("read_file",edit),p("update_file",edit)],
  [p("read_file",edit),p("update_file",edit),p("update_file",dep)],
  [p("read_file",edit),p("create_file",dep),p("update_file",edit)],
  [p("read_file",edit),p("run_tests",edit),p("update_file",edit)],
  [p("update_file",edit)],
  [p("read_file",edit)],
  [{operation:"read_file",resource:base.replace("/files/","/tree")},p("read_file",edit),p("update_file",edit)],
  [p("read_file",edit),...Array.from({length:MAX_TASK_READS},(_,i)=>p("read_file",`d/${i}.ts`)),p("update_file",edit)]
 ])assert.equal(readUpdateGrantShape(bad),null,JSON.stringify(bad.map(x=>x.operation)));
});

test("readGrantsCoverPath: exact file or containing directory read grants only",async()=>{
 const {readGrantsCoverPath}=await import("../src/gitea-permission-containment.mjs");
 const base="gitea://gitea.local/thesis/sample-app/branches/feature%2Fx/";
 const read=r=>({operation:"read_file",resource:base+r});
 assert.equal(readGrantsCoverPath([read("files/apps/a.ts")],"apps/a.ts"),true);
 assert.equal(readGrantsCoverPath([read("directories/apps")],"apps/sub/a.ts"),true);
 assert.equal(readGrantsCoverPath([read("files/apps/a.ts")],"apps/b.ts"),false);
 assert.equal(readGrantsCoverPath([read("directories/apps")],"appsx/a.ts"),false);
 assert.equal(readGrantsCoverPath([read("directories/apps")],"apps/../secret.ts"),false);
 assert.equal(readGrantsCoverPath([{operation:"update_file",resource:base+"files/apps/a.ts"}],"apps/a.ts"),false);
 assert.equal(readGrantsCoverPath(undefined,"apps/a.ts"),false);
});

test("reads + one create: the new file is created from distinct EXISTING files it is written from", async () => {
 const {readCreateGrantShape,readWriteGrantShape,MAX_TASK_READS}=
  await import("../src/gitea-permission-containment.mjs");
 const {SAMPLE_TEST_SOURCES}=await import("./fixtures/test-sources.mjs");
 const isProjectTestReadCreateGrant=async (perms)=>(await import("../src/gitea-permission-containment.mjs"))
  .isProjectTestReadCreateGrant(perms,SAMPLE_TEST_SOURCES);
 const base="gitea://gitea.local/thesis/sample-app/branches/feature%2Fs-1/files/";
 const r=path=>({operation:"read_file",resource:base+path});
 const c=path=>({operation:"create_file",resource:base+path});
 const page="apps/frontend/src/pages/UserListPage.tsx",test="tests/frontend/UserListPage.test.tsx";
 assert.deepEqual(readCreateGrantShape([r(page),c(test)]),{create:base+test,reads:[base+page]});
 assert.equal(readWriteGrantShape([r(page),c(test)]).operation,"create_file");
 assert.equal(readWriteGrantShape([r(page),{operation:"update_file",resource:base+page}]).operation,"update_file");
 assert.equal(await isProjectTestReadCreateGrant([r(page),c(test)]),true);
 assert.equal(await isProjectTestReadCreateGrant([r(page),c("apps/frontend/src/new.ts")]),false,
  "the Test agent creates only project test sources");
 for(const bad of [
  [c(test)],                                   // no read: a plain single create
  [r(test),c(test)],                           // the new file cannot be read
  [r(page),r(page),c(test)],                   // duplicate read
  [r(page),c(test),c("tests/frontend/b.test.tsx")],      // two creates
  [r(page),c(test),{operation:"update_file",resource:base+page}],
  [...Array.from({length:MAX_TASK_READS+1},(_,i)=>r("src/f"+i+".ts")),c(test)]
 ])assert.equal(readCreateGrantShape(bad),null,JSON.stringify(bad.map(p=>p.operation)));
});

// ---------------------------------------------------------------- Phase W (W1)
test("write-set shape: decision table D1/D2 (<= 8 writes, <= 16 permissions)",async()=>{
 const {readsWriteSetGrantShape,MAX_TASK_WRITES,MAX_TASK_EFFECTS}=await import("../src/gitea-permission-containment.mjs");
 assert.equal(MAX_TASK_WRITES,8);assert.equal(MAX_TASK_EFFECTS,16);
 const base="gitea://gitea.local/thesis/sample-app/branches/feature%2Fx/files/";
 const p=(operation,path)=>({operation,resource:base+path});
 const task=(r,u,c)=>[
  ...Array.from({length:r},(_,i)=>p("read_file",`src/r${String(i).padStart(2,"0")}.ts`)),
  ...Array.from({length:u},(_,i)=>p("update_file",`src/r${String(i).padStart(2,"0")}.ts`)),
  ...Array.from({length:c},(_,i)=>p("create_file",`src/new${i}.ts`))];
 for(const [r,u,c,ok] of [[10,3,0,true],[8,8,0,true],[6,4,4,true],[15,2,0,false],[2,2,7,false],
   [0,0,3,true],[0,0,2,true],[0,0,9,false],[1,1,0,false],[0,0,1,false],[14,2,0,true],[0,0,8,true]]){
  const shape=readsWriteSetGrantShape(task(r,u,c));
  assert.equal(!!shape,ok,`R=${r} U=${u} C=${c}`);
  if(shape){assert.equal(shape.reads.length,r);assert.equal(shape.writes.length,u+c);}
 }
});

test("write-set shape: update only of a read file, create only of an unread file, distinct exact files",async()=>{
 const {readsWriteSetGrantShape}=await import("../src/gitea-permission-containment.mjs");
 const base="gitea://gitea.local/thesis/sample-app/branches/feature%2Fx/files/";
 const other="gitea://gitea.local/thesis/sample-app/branches/feature%2Fy/files/";
 const p=(operation,path,b=base)=>({operation,resource:b+path});
 const a="src/a.ts",b="src/b.ts",n="src/n.ts";
 const ok=readsWriteSetGrantShape([p("read_file",b),p("read_file",a),p("update_file",b),p("create_file",n),p("update_file",a)]);
 // Canonical order (by resource), independent of the grant order.
 assert.deepEqual(ok.writes.map(w=>[w.operation,w.path]),[["update_file",a],["update_file",b],["create_file",n]]);
 assert.deepEqual(ok.reads,[base+a,base+b]);
 for(const [label,bad] of [
  ["update of an unread file",[p("read_file",a),p("update_file",a),p("update_file",b)]],
  ["create of a read file",[p("read_file",a),p("update_file",a),p("create_file",a)]],
  ["two writes on one file",[p("read_file",a),p("update_file",a),p("create_file",a)]],
  ["duplicate read",[p("read_file",a),p("read_file",a),p("update_file",a),p("create_file",n)]],
  ["duplicate create",[p("create_file",n),p("create_file",n)]],
  ["foreign operation",[p("read_file",a),p("update_file",a),p("create_file",n),p("run_tests",a)]],
  ["directory scope",[{operation:"create_file",resource:base.replace("/files/","/directories/")+"src"},p("create_file",n)]],
  ["another branch",[p("create_file",n),p("create_file",b,other)]],
  ["traversal",[p("create_file",n),p("create_file","src/../x.ts")]],
  ["encoded path",[p("create_file",n),p("create_file","src/%2E%2E/x.ts")]],
  ["extra key",[p("create_file",n),{...p("create_file",b),extra:1}]],
  ["single write (baseline shape)",[p("read_file",a),p("update_file",a)]],
  ["not an array",null]
 ])assert.equal(readsWriteSetGrantShape(bad),null,label);
});

test("write-set shape: the single-write baseline shapes are unchanged and disjoint",async()=>{
 const m=await import("../src/gitea-permission-containment.mjs");
 const base="gitea://gitea.local/thesis/sample-app/branches/feature%2Fx/files/";
 const p=(operation,path)=>({operation,resource:base+path});
 const single=[p("read_file","src/a.ts"),p("update_file","src/a.ts")];
 assert.ok(m.readWriteGrantShape(single));
 assert.equal(m.readsWriteSetGrantShape(single),null);
 const multi=[p("read_file","src/a.ts"),p("update_file","src/a.ts"),p("create_file","src/n.ts")];
 assert.equal(m.readWriteGrantShape(multi),null);
 assert.ok(m.readsWriteSetGrantShape(multi));
});

test("Test-agent write-set: every write must be a project test source",async()=>{
 const {isProjectTestWriteSetGrant}=await import("../src/gitea-permission-containment.mjs");
 const {SAMPLE_TEST_SOURCES}=await import("./fixtures/test-sources.mjs");
 const base="gitea://gitea.local/thesis/sample-app/branches/feature%2Fx/files/";
 const p=(operation,path)=>({operation,resource:base+path});
 assert.ok(isProjectTestWriteSetGrant([p("read_file","apps/backend/a.ts"),
  p("read_file","tests/backend/a.test.ts"),p("update_file","tests/backend/a.test.ts"),
  p("create_file","tests/backend/b.test.ts")],SAMPLE_TEST_SOURCES));
 assert.equal(isProjectTestWriteSetGrant([p("read_file","apps/backend/a.ts"),
  p("update_file","apps/backend/a.ts"),p("create_file","tests/backend/b.test.ts")],SAMPLE_TEST_SOURCES),false);
 assert.equal(isProjectTestWriteSetGrant([p("create_file","tests/backend/b.test.ts"),
  p("create_file","tests/backend/c.test.ts")],undefined),false);
});
