import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,mkdtempSync,readFileSync as read,existsSync,rmSync,statSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
const workflow=readFileSync(new URL("../../../.github/workflows/gemini-paid-shared-mcp-final.yml",import.meta.url),"utf8");
const name="Configure required private failure evidence (NO provider call)";
const start=workflow.indexOf("      - name: "+name);
const end=workflow.indexOf("      - uses:",start);
const step=workflow.slice(start,end);
const script=step.split("node --input-type=module -e '\n")[1]?.split("\n          '")[0];

test("actual paid workflow evidence preflight precedes any provider access",()=>{
 assert.ok(start>0&&end>start&&script);
 assert.ok(start<workflow.indexOf("      - name: Verify configured Gemini key and model metadata"));
 assert.ok(start<workflow.indexOf("      - name: ONE explicitly authorized real Gemini"));
 assert.ok(!script.includes("fetch(")&&!script.includes("GEMINI_API_KEY"));
});
test("actual workflow script refuses missing or invalid evidence key without exporting configuration",()=>{
 for(const key of [undefined,"","SECRET_INVALID_KEY"]){
  const root=mkdtempSync(join(tmpdir(),"evidence-preflight-"));
  try{
   const env={...process.env,RUNNER_TEMP:root,GITHUB_ENV:join(root,"env"),GITHUB_OUTPUT:join(root,"output")};
   delete env.RUNNER_EVIDENCE_KEY_HEX;if(key!==undefined)env.RUNNER_EVIDENCE_KEY_HEX=key;
   const result=spawnSync(process.execPath,["--input-type=module","-e",script],{env,encoding:"utf8"});
   assert.notEqual(result.status,0);
   assert.equal(existsSync(env.GITHUB_ENV),false);assert.equal(existsSync(env.GITHUB_OUTPUT),false);
   assert.ok(!(result.stdout+result.stderr).includes("SECRET_INVALID_KEY"));
  }finally{rmSync(root,{recursive:true,force:true});}
 }
});
test("actual workflow script exports only private directory and readiness, never the key",()=>{
 const root=mkdtempSync(join(tmpdir(),"evidence-preflight-"));
 try{
  const key=randomBytes(32).toString("hex");
  const env={...process.env,RUNNER_TEMP:root,GITHUB_ENV:join(root,"env"),GITHUB_OUTPUT:join(root,"output"),RUNNER_EVIDENCE_KEY_HEX:key};
  const result=spawnSync(process.execPath,["--input-type=module","-e",script],{env,encoding:"utf8"});
  assert.equal(result.status,0);
  const exported=read(env.GITHUB_ENV,"utf8"),output=read(env.GITHUB_OUTPUT,"utf8");
  assert.equal(exported,"TEST_RUNNER_FAILURE_EVIDENCE_DIR="+join(root,"private-runner-evidence")+"\n");
  assert.equal(output,"enabled=true\n");
  assert.ok(!(exported+output+result.stdout+result.stderr).includes(key));
  if(process.platform!=="win32")assert.equal(statSync(join(root,"private-runner-evidence")).mode&0o777,0o700);
 }finally{rmSync(root,{recursive:true,force:true});}
});
