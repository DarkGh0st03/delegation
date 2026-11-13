import test from "node:test";
import assert from "node:assert/strict";
import {giteaPermissionCovers as covers} from "../src/gitea-permission-containment.mjs";

const root="gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension";
const p=(suffix,operation="read_file")=>({resource:root+"/"+suffix,operation});
test("R299 exact permissions stay exact and branch/root operations never gain descendants",()=>{
 assert.equal(covers(p("files/apps/backend/user.ts"),p("files/apps/backend/user.ts")),true);
 assert.equal(covers(p("files/apps/backend/user.ts"),p("files/apps/backend/user2.ts")),false);
 assert.equal(covers({resource:root,operation:"run_tests"},p("files/apps/backend/user.ts","run_tests")),false);
 assert.equal(covers({resource:root,operation:"create_branch"},p("directories","create_branch")),false);
});
test("R299 directory grants cover nested directories/files for the SAME operation",()=>{
 for(const op of ["read_file","update_file","create_file","list_directory"]){
  const parent=p("directories/apps/backend",op);
  assert.equal(covers(parent,p("directories/apps/backend/src",op)),true);
  assert.equal(covers(parent,p("files/apps/backend/src/user.ts",op)),true);
  assert.equal(covers(p("directories",op),p("files/apps/backend/src/user.ts",op)),true);
  assert.equal(covers(parent,p("files/apps/backend-extra/escape.ts",op)),false);
  assert.equal(covers(parent,p("files/apps/backend/src/user.ts","run_tests")),false);
 }
});
test("R299 no prefix, branch/repository crossing, traversal, URI aliases or encoded-path expansion",()=>{
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
 assert.equal(covers(parent,{resource:"gitea://gitea.local/thesis/other/branches/feature%2Faccount-suspension/files/apps/backend/u.ts",operation:"read_file"}),false);
 assert.equal(covers(parent,{resource:"gitea://other.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/apps/backend/u.ts",operation:"read_file"}),false);
 assert.equal(covers(parent,{resource:"gitea://gitea.local/thesis/iam-console-poc/branches/main/files/apps/backend/u.ts",operation:"read_file"}),false);
 assert.equal(covers(parent,{resource:root.replace("feature%2Faccount-suspension","feature%2faccount-suspension")+"/files/apps/backend/u.ts",operation:"read_file"}),false);
 assert.equal(covers(p("files/apps/backend"),p("files/apps/backend/u.ts")),false);
});
test("R299 file grant, unknown operation or malformed input never create implicit authority",()=>{
 assert.equal(covers(null,p("files/apps/backend/u.ts")),false);
 assert.equal(covers(p("directories/apps/backend","read_file"),p("files/apps/backend/u.ts","update_file")),false);
 assert.equal(covers(p("directories/apps/backend","delete_file"),p("files/apps/backend/u.ts","delete_file")),false);
 assert.equal(covers({resource:"not-a-uri",operation:"read_file"},p("files/apps/backend/u.ts")),false);
});

test("read+update grant shape: N distinct exact reads including the edited file, then ONE update",async()=>{
 const {readUpdateGrantShape,MAX_TASK_READS}=await import("../src/gitea-permission-containment.mjs");
 const base="gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Fx/files/";
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
 const base="gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Fx/";
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
 const {readCreateGrantShape,readWriteGrantShape,isProjectTestReadCreateGrant,MAX_TASK_READS}=
  await import("../src/gitea-permission-containment.mjs");
 const base="gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Fs-1/files/";
 const r=path=>({operation:"read_file",resource:base+path});
 const c=path=>({operation:"create_file",resource:base+path});
 const page="apps/frontend/src/pages/UserListPage.tsx",test="tests/frontend/UserListPage.test.tsx";
 assert.deepEqual(readCreateGrantShape([r(page),c(test)]),{create:base+test,reads:[base+page]});
 assert.equal(readWriteGrantShape([r(page),c(test)]).operation,"create_file");
 assert.equal(readWriteGrantShape([r(page),{operation:"update_file",resource:base+page}]).operation,"update_file");
 assert.equal(isProjectTestReadCreateGrant([r(page),c(test)]),true);
 assert.equal(isProjectTestReadCreateGrant([r(page),c("apps/frontend/src/new.ts")]),false,
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
