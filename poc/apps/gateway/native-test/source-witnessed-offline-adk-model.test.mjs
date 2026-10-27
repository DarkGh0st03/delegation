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
