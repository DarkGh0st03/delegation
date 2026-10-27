import test from "node:test";
import assert from "node:assert/strict";
import {buildF1RealGiteaResearchPlanningPort}
  from "../f1-gitea-research-planning-port.mjs";

const SHA="405748b1e77992b6bd8630a3ab6f990658d32f6b";
const URL="http://127.0.0.1:31315";
const TOKEN="disposable-reader-token-verified";
const SOURCES={
  "apps/backend/src/users/user.service.ts":
    "export class UserService {listUsers(){} getUser(id){}}\n",
  "apps/backend/src/users/user.routes.ts":
    'router.get("/", controller.listUsers);\nrouter.get("/:id", controller.getUser);\n',
  "apps/frontend/src/api/users-api.ts":
    "export async function listUsers(){}\n",
  "apps/frontend/src/pages/UserDetailPage.tsx":
    "export function UserDetailPage(){return <div/>;}\n",
  "README.md":"# Not solved, baseline only\n"
};
function entry(name,type,path){
  return {name,path,type,...(type==="file"?{size:100}:{})};
}
function fixture({changed=false,solved=false,duplicate=false}={}){
  let branches=0;
  const seen=[];
  const sources={...SOURCES};
  if(solved)sources["apps/backend/src/users/user.service.ts"]+=
    "\n listUsersByDepartment(";
  const contents={
    "":[entry("apps","dir","apps"),entry("README.md","file","README.md")],
    "apps":[entry("backend","dir","apps/backend"),
      entry("frontend","dir","apps/frontend")],
    "apps/backend":[entry("src","dir","apps/backend/src")],
    "apps/backend/src":[entry("users","dir","apps/backend/src/users")],
    "apps/backend/src/users":[
      entry("user.service.ts","file","apps/backend/src/users/user.service.ts"),
      entry("user.routes.ts","file","apps/backend/src/users/user.routes.ts")
    ],
    "apps/frontend":[entry("src","dir","apps/frontend/src")],
    "apps/frontend/src":[entry("api","dir","apps/frontend/src/api"),
      entry("pages","dir","apps/frontend/src/pages")],
    "apps/frontend/src/api":[entry("users-api.ts","file",
      "apps/frontend/src/api/users-api.ts")],
    "apps/frontend/src/pages":[entry("UserDetailPage.tsx","file",
      "apps/frontend/src/pages/UserDetailPage.tsx")]
  };
  if(duplicate)contents["apps"].push(entry("backend","dir","apps/backend"));
  const response=(value,status=200)=>({
    status,ok:status===200,text:async()=>JSON.stringify(value)
  });
  const fetchFn=async(url,options)=>{
    const u=new URL(url);
    assert.equal(u.origin,URL);
    assert.equal(options.method,"GET");
    assert.equal(options.headers.authorization,"token "+TOKEN);
    seen.push({pathname:u.pathname,ref:u.searchParams.get("ref")});
    const api="/api/v1/repos/thesis/iam-console-poc";
    if(u.pathname===api)return response({owner:{login:"thesis"},
      name:"iam-console-poc",default_branch:"main"});
    if(u.pathname===api+"/branches/main"){
      branches++;
      return response({name:"main",commit:{id:changed&&branches>1?
        "b".repeat(40):SHA}});
    }
    const prefix=api+"/contents";
    assert.ok(u.pathname.startsWith(prefix));
    assert.equal(u.searchParams.get("ref"),SHA);
    const suffix=u.pathname.slice(prefix.length);
    const file=decodeURIComponent(suffix.replace(/^\//u,""));
    if(Object.hasOwn(contents,file))return response(contents[file]);
    if(Object.hasOwn(sources,file))return response({
      type:"file",path:file,encoding:"base64",
      content:Buffer.from(sources[file]).toString("base64"),
      sha:"a".repeat(40),size:Buffer.byteLength(sources[file])
    });
    return response({message:"not found"},404);
  };
  const create=()=>buildF1RealGiteaResearchPlanningPort({
    baseUrl:URL,readToken:TOKEN,expectedMainSha:SHA,
    sessionId:"research-f1-1",fetchFn
  });
  return {create,seen};
}
test("F1 Gitea host independently discovers directories and files without model or golden answer",async()=>{
  const f=fixture();
  const result=await f.create();
  assert.equal(result.research_only_direct_gitea,true);
  assert.equal(result.production_gateway_vp_opa_verification,false);
  assert.equal(result.no_model_calls,true);
  assert.equal(result.snapshot.base_revision,SHA);
  assert.equal(result.snapshot.session_id,"research-f1-1");
  assert.ok(Object.isFrozen(result.snapshot.files));
  assert.deepEqual(result.snapshot.files,[...Object.keys(SOURCES)].sort());
  assert.equal(result.snapshot.directories[0],"");
  assert.ok(result.snapshot.directories.includes("apps/backend/src/users"));
  const rp=result.readPort;
  const meta=await rp.invoke("read_repository",{});
  assert.equal(meta.provider,"gitea");
  assert.equal(meta.revision,SHA);
  const root=await rp.invoke("list_directory",{branch:"main",path:""});
  assert.equal(root.entries.length,2);
  const file=await rp.invoke("read_file",{
    branch:"main",path:"apps/frontend/src/api/users-api.ts"
  });
  assert.equal(file.content,SOURCES["apps/frontend/src/api/users-api.ts"]);
  assert.equal(file.revision,SHA);
  assert.ok(f.seen.every(x=>x.ref===null||x.ref===SHA));
  assert.equal(JSON.stringify(result.snapshot).includes(TOKEN),false);
});
test("F1 readPort refuses writes, main-bypass, out-of-tree paths and canceled Planning",async()=>{
  const result=await fixture().create();
  for(const [tool,args] of [
    ["update_file",{branch:"main",path:"README.md"}],
    ["read_file",{branch:"feature/fake",path:"README.md"}],
    ["read_file",{branch:"main",path:"unknown.ts"}],
    ["list_directory",{branch:"main",path:"nonexistent"}],
    ["read_repository",{arbitrary:"override"}]
  ])await assert.rejects(result.readPort.invoke(tool,args),/NO-GO/);
  const abort=new AbortController();
  abort.abort();
  await assert.rejects(result.readPort.invoke("read_repository",{},abort.signal),
    /NO-GO/);
});
test("F1 refuses already solved source, changed baseline, duplicates and remote address",async()=>{
  await assert.rejects(fixture({solved:true}).create(),/NO-GO/);
  await assert.rejects(fixture({changed:true}).create(),/NO-GO/);
  await assert.rejects(fixture({duplicate:true}).create(),/NO-GO/);
  await assert.rejects(buildF1RealGiteaResearchPlanningPort({
    baseUrl:"http://gitea-remote:3000",readToken:TOKEN,
    expectedMainSha:SHA,sessionId:"research-f1-1",
    fetchFn:async()=>{throw Error("MUST NOT CONNECT");}
  }),/NO-GO/);
});
