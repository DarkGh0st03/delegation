import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureBackendEvidence } from "../capture-gemini-backend-evidence.mjs";
import { BACKEND_LIVE_PROBE_PATHS } from "../../packages/agent-runtime/src/adk-backend-live-probe.ts";

const BASE="405748b1e77992b6bd8630a3ab6f990658d32f6b";
const NEXT="abcdef0123456789abcdef0123456789abcdef01";
const CONTENT={};
for(const [i,path] of BACKEND_LIVE_PROBE_PATHS.entries()) {
  CONTENT[path]=["// baseline file "+i+"\n","// generated implementation "+i+"\n"];
}
function gitBlob(s) {
  const buf=Buffer.from(s);
  return createHash("sha1").update("blob "+buf.length+"\0").update(buf).digest("hex");
}
function mockFetch(url,options,missingBranch=false) {
  assert.equal(options.method,"GET");
  assert.equal(options.headers.authorization,"token fake-read-token");
  const u=new URL(url);
  const p=decodeURIComponent(u.pathname);
  if(p.endsWith("/branches/main")) {
    return Promise.resolve({ok:true,json:async()=>({commit:{id:BASE}})});
  }
  if(p.endsWith("/branches/feature/account-suspension")) {
    return Promise.resolve(missingBranch?{ok:false,status:404}:
      {ok:true,json:async()=>({commit:{id:NEXT}})});
  }
  const marker="/contents/";
  const i=p.indexOf(marker);
  if(i<0)return Promise.resolve({ok:false,status:404});
  const path=p.slice(i+marker.length);
  const ref=u.searchParams.get("ref");
  const pair=CONTENT[path];
  if(!pair)return Promise.resolve({ok:false,status:404});
  const content=pair[ref===BASE?0:1];
  const record={type:"file",encoding:"base64",
    sha:gitBlob(content),content:Buffer.from(content).toString("base64")};
  return Promise.resolve({ok:true,json:async()=>record});
}
async function runCapture(outputDir,missingBranch=false) {
  return captureBackendEvidence({
    baseUrl:"http://127.0.0.1:3000",owner:"thesis",repository:"iam-console-poc",
    readToken:"fake-read-token",outputDir,expectedBaselineSha:BASE,
    fetchFn:(url,options)=>mockFetch(url,options,missingBranch),
    runId:"offline-test",protectedValues:["NEVER_EXPOSE_TEST_SECRET"]
  });
}
test("Backend evidence records actual changes, pinned revisions and four readable diffs",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"backend-evidence-test-"));
  try {
    const manifest=await runCapture(dir);
    assert.equal(manifest.capture_status,"complete");
    assert.equal(manifest.main_sha,BASE);
    assert.equal(manifest.feature_sha,NEXT);
    assert.deepEqual(manifest.changed_paths,[...BACKEND_LIVE_PROBE_PATHS]);
    assert.equal(manifest.files.length,4);
    assert.ok(manifest.files.every(file=>file.changed));
    const patch=await readFile(join(dir,"changes.patch"),"utf8");
    for(const path of BACKEND_LIVE_PROBE_PATHS) {
      const produced=await readFile(join(dir,"generated",path),"utf8");
      assert.ok(produced.includes("generated implementation"));
      assert.ok(patch.includes("a/"+path));
      assert.ok(patch.includes("b/"+path));
    }
    const disk=JSON.parse(await readFile(join(dir,"manifest.json"),"utf8"));
    assert.equal(disk.capture_status,"complete");
    assert.ok(!patch.includes("fake-read-token"));
    assert.ok(!JSON.stringify(disk).includes("fake-read-token"));
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test("Missing feature branch is captured as evidence without inventing modifications",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"backend-evidence-missing-"));
  try {
    const manifest=await runCapture(dir,true);
    assert.equal(manifest.capture_status,"feature_branch_missing");
    assert.equal(manifest.changed_paths.length,0);
    const disk=JSON.parse(await readFile(join(dir,"manifest.json"),"utf8"));
    assert.equal(disk.capture_status,"feature_branch_missing");
  } finally { await rm(dir,{recursive:true,force:true}); }
});