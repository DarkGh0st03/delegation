import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SPECIALIZED_AGENT_PROFILES } from "../../packages/agent-runtime/src/specialized-agents.ts";
import { captureMultiAgentEvidence } from "../capture-gemini-multi-agent-evidence.mjs";
const MAIN="405748b1e77992b6bd8630a3ab6f990658d32f6b";
const HEAD="abcdef0123456789abcdef0123456789abcdef01";
const created= new Set(SPECIALIZED_AGENT_PROFILES.test.creatable_paths);
const all = [...new Set(["backend","frontend","test"].flatMap(r=>
  [...SPECIALIZED_AGENT_PROFILES[r].writable_paths,
   ...SPECIALIZED_AGENT_PROFILES[r].creatable_paths]))];
const gitSha=s=>{
  const b=Buffer.from(s);
  return createHash("sha1").update("blob "+b.length+"\0").update(b).digest("hex");
};
const source=(path,ref)=>"// "+(ref===MAIN?"before":"after")+" "+path+"\n";
const request=(url,opts,missingTest=false)=>{
  assert.equal(opts.method,"GET");
  assert.equal(opts.headers.authorization,"token audited-read-token");
  const u=new URL(url);
  const p=decodeURIComponent(u.pathname);
  if(p.endsWith("/branches/main"))return Promise.resolve({ok:true,json:async()=>({commit:{id:MAIN}})});
  if(p.endsWith("/branches/feature/account-suspension"))
    return Promise.resolve({ok:true,json:async()=>({commit:{id:HEAD}})});
  const i=p.indexOf("/contents/");
  if(i<0)return Promise.resolve({ok:false,status:404});
  const path=p.slice(i+"/contents/".length);
  const revision=u.searchParams.get("ref");
  if(!all.includes(path)||created.has(path)&&revision===MAIN ||
      missingTest && created.has(path))return Promise.resolve({ok:false,status:404});
  const content=source(path,revision);
  return Promise.resolve({ok:true,json:async()=>({
    type:"file",encoding:"base64",content:Buffer.from(content).toString("base64"),sha:gitSha(content)
  })});
};
const capture=async(dir,missingTest=false)=>captureMultiAgentEvidence({
  baseUrl:"http://localhost:3000",owner:"thesis",repository:"iam-console-poc",
  readToken:"audited-read-token",outputDir:dir,expectedBaselineSha:MAIN,
  mode:"offline_test",runId:"offline",fetchFn:(u,o)=>request(u,o,missingTest)
});
test("captures all role changes and a new e2e test at exact immutable revisions",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"multi-evidence-"));
  try {
    const m=await capture(dir);
    assert.equal(m.capture_status,"complete");
    assert.equal(m.files.length,all.length);
    assert.deepEqual(m.created_paths,[...created]);
    assert.deepEqual(m.changed_paths,all);
    assert.deepEqual(m.role_changes.backend,
      [...SPECIALIZED_AGENT_PROFILES.backend.writable_paths]);
    assert.equal(m.role_changes.frontend.length,3);
    assert.equal(m.role_changes.test.length,4);
    const patch=await readFile(join(dir,"changes.patch"),"utf8");
    const generated=await readFile(join(dir,"generated","tests/e2e/account-suspension.spec.ts"),"utf8");
    assert.match(generated,/after/);
    assert.match(patch,/\/dev\/null/);
    assert.ok(!patch.includes("audited-read-token"));
    assert.equal(JSON.parse(await readFile(join(dir,"manifest.json"),"utf8")).feature_sha,HEAD);
  }finally{await rm(dir,{recursive:true,force:true})}
});
test("a missing agent-created E2E deliverable yields a partial artifact",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"multi-evidence-"));
  try {
    const m=await capture(dir,true);
    assert.equal(m.capture_status,"partial");
    assert.ok(m.files.some(x=>x.status==="file_capture_unavailable"));
    assert.ok(!m.created_paths.includes("tests/e2e/account-suspension.spec.ts"));
  }finally{await rm(dir,{recursive:true,force:true})}
});