import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {extractAcceptanceFailureSummary as extract} from "../src/acceptance-diagnostics.ts";
import {ACCEPTANCE_CHECKS, ACCEPTANCE_FAILURE_PREFIX as prefix}
  from "../../../runner/acceptance/failure-catalog.mjs";
import Reporter from "../../../runner/acceptance/failure-reporter.ts";

const summary={failed_checks:["ui_pending_actions"],timed_out:false,unclassified_failure:false};

test("Acceptance diagnostics retain fixed requirement IDs and reject raw assertions",()=>{
  const result=extract("SOURCE_SECRET\n"+prefix+JSON.stringify(summary),"PRIVATE_TOKEN");
  assert.deepEqual(result,summary);
  assert.doesNotMatch(JSON.stringify(result),/SECRET|TOKEN/u);
  for(const bad of [
    {...summary,failed_checks:["private/file.ts"]},
    {...summary,failed_checks:["ui_pending_actions","ui_pending_actions"]},
    {...summary,error:"secret"}, {...summary,timed_out:"true"},
    {...summary,failed_checks:[]}
  ])assert.equal(extract(prefix+JSON.stringify(bad),""),null);
  assert.equal(extract("No reporter result", ""),null);
  assert.equal(extract(prefix+"{"+"x".repeat(2100),""),null);
});

test("Reporter labels every current researcher test without changing its assertions",async()=>{
  for(const [file,title] of ACCEPTANCE_CHECKS){
    const source=await readFile(new URL("../../../runner/acceptance/"+file,import.meta.url),"utf8");
    assert.ok(source.includes('test("'+title+'"'),title);
  }
});

test("Reporter distinguishes failed checks, timeout and collection failures without raw text",()=>{
  const reporter=new Reporter();
  const output:string[]=[];
  const original=process.stdout.write;
  process.stdout.write=((chunk: string)=>{output.push(String(chunk));return true;}) as typeof original;
  try{
    reporter.onBegin({} as any,{allTests:()=>[{
      location:{file:"/private/account-suspension.spec.ts"},
      title:ACCEPTANCE_CHECKS[4][1],results:[{status:"failed",error:"SECRET"}]
    }]} as any);
    reporter.onEnd({status:"failed"} as any);
    reporter.onEnd({status:"passed"} as any);
    assert.equal(output.length,1);
    assert.deepEqual(extract(output[0],""),summary);
    reporter.onBegin({} as any,{allTests:()=>[]} as any);
    reporter.onEnd({status:"timedout"} as any);
    assert.deepEqual(extract(output[1],""),{
      failed_checks:[],timed_out:true,unclassified_failure:true
    });
    assert.doesNotMatch(output.join(""),/SECRET|private|spec\.ts/u);
  }finally{process.stdout.write=original;}
});
