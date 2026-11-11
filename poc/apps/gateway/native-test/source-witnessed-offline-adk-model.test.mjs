import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {SourceWitnessedOfflineAdkModel}
  from "./source-witnessed-offline-adk-model.mjs";
const branch="feature/source-witness-test";
const path="src/editor.tsx";
const uri="gitea://gitea.local/thesis/iam-console-poc/branches/"+
  encodeURIComponent(branch)+"/files/"+path;
const context={role:"frontend",approved_permissions:[
  {task_id:"edit",operation:"read_file",resource:uri},
  {task_id:"edit",operation:"update_file",resource:uri}
]};
const calls=[
  {name:"read_file",args:{branch,path}},
  {name:"update_file",args:{branch,path,
    content:"export const feature = 'prepackaged';\n"}}
];
const baseline="export const feature = 'original';\n";
const result={provider:"gitea",performed:true,tool:"read_file",
  branch,path,revision:"b".repeat(40),content:baseline};
const readRequest=(payload)=>({contents:[{
  role:"tool",parts:[{functionResponse:{
    name:"read_file",response:payload
  }}]
}]});
async function response(model,input){
  const values=[];
  for await(const v of model.generateContentAsync(input))values.push(v);
  return values[0].content.parts[0];
}
test("source-witness model uses the real read result to alter one approved script",async()=>{
  for(const payload of [
    {ok:true,result},
    {structuredContent:{ok:true,result}},
    {result:{structuredContent:{ok:true,result}}}
  ]){
    const model=new SourceWitnessedOfflineAdkModel({context,calls});
    const first=await response(model,{contents:[]});
    assert.equal(first.functionCall.name,"read_file");
    assert.deepEqual(first.functionCall.args,{branch,path});
    const second=await response(model,readRequest(payload));
    assert.equal(second.functionCall.name,"update_file");
    const digest=createHash("sha256").update(baseline).digest("hex");
    assert.equal(second.functionCall.args.content,calls[1].args.content+
      "// block-b-source-read-sha256:"+digest+"\n");
    assert.deepEqual(model.sourceWitness,{branch,path,source_sha256:digest});
    assert.equal((await response(model,{})).text.includes("Gateway"),true);
    assert.equal(model.calls,3);
  }
});
test("source-witness model refuses missing/foreign/failed actual source",async()=>{
  for(const bad of [
    {ok:false,result},
    {ok:true,result:{...result,provider:"mock"}},
    {ok:true,result:{...result,path:"src/evil.tsx"}},
    {ok:true,result:{...result,revision:"not-a-sha"}},
    {ok:true,result:{...result,content:99}},
    {structuredContent:{ok:false,result}}
  ]){
    const model=new SourceWitnessedOfflineAdkModel({context,calls});
    await response(model,{contents:[]});
    await assert.rejects(()=>response(model,readRequest(bad)),/NO-GO/);
    assert.equal(model.sourceWitness,null);
  }
  const model=new SourceWitnessedOfflineAdkModel({context,calls});
  await response(model,{contents:[]});
  await assert.rejects(()=>response(model,{contents:[]}),/NO-GO/);
});
test("source-witness model cannot access files missing either approved grant",()=>{
  for(const approved_permissions of [
    context.approved_permissions.slice(0,1),
    context.approved_permissions.slice(1),
    context.approved_permissions.map(p=>({...p,resource:p.resource+"/elsewhere"}))
  ])assert.throws(()=>new SourceWitnessedOfflineAdkModel({
    context:{...context,approved_permissions},calls
  }),/NO-GO/);
});

test("host-injected Frontend ADK model derives API code and preserves independent page witness",async()=>{
  const api="apps/frontend/src/api/users-api.ts";
  const apiUri="gitea://gitea.local/thesis/iam-console-poc/branches/"+
    encodeURIComponent(branch)+"/files/"+api;
  const frontendContext={...context,
    tasks:[{id:"frontend",description:"Account Suspension.\n"+
      "API ACTION suspendUser POST /suspend\n"+
      "API ACTION reactivateUser POST /reactivate"}],
    approved_permissions:[
      {task_id:"frontend",operation:"read_file",resource:apiUri},
      {task_id:"frontend",operation:"update_file",resource:apiUri},
      ...context.approved_permissions
    ]};
  const tick=String.fromCharCode(96);
  const interpolation=String.fromCharCode(36)+"{encodeURIComponent(id)}";
  const original=[
    'import type { ApiError, UserDetails } from "@iam/shared";',
    "const ADMIN_HEADERS = {",
    '  "x-demo-role": "admin"',
    "};",
    "async function parseResponse<T>(response: Response): Promise<T> {",
    "  return (await response.json()) as T;",
    "}",
    "export async function getUser(id: string): Promise<UserDetails> {",
    "  return parseResponse<UserDetails>(",
    "    await fetch("+tick+"/api/users/"+interpolation+tick+", { headers: ADMIN_HEADERS })",
    "  );",
    "}",
    ""
  ].join("\n");
  const script=[
    {name:"read_file",args:{branch,path:api}},
    {name:"update_file",args:{branch,path:api}},
    ...calls
  ];
  const model=new SourceWitnessedOfflineAdkModel({
    context:frontendContext,calls:script
  });
  assert.equal((await response(model,{contents:[]})).functionCall.name,"read_file");
  const first=(await response(model,readRequest({ok:true,result:{
    ...result,path:api,content:original
  }}))).functionCall;
  assert.equal(first.name,"update_file");
  assert.ok(first.args.content.includes("export async function suspendUser("));
  assert.ok(first.args.content.includes("export async function reactivateUser("));
  assert.equal(model.derivedApiProof.path,api);
  assert.equal((await response(model,{contents:[]})).functionCall.name,"read_file");
  const final=(await response(model,readRequest({ok:true,result}))).functionCall;
  assert.equal(final.name,"update_file");
  assert.ok(final.args.content.includes("// block-b-source-read-sha256:"));
  assert.equal(model.sourceWitness.path,path);
});
