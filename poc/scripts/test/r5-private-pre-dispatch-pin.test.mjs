import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,readFile,chmod,symlink,rm,readdir,lstat}
  from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {persistR5PreDispatchRunnerPin as persist,
  loadR5PreDispatchRunnerPin as load}
  from "../r5-private-pre-dispatch-pin.mjs";
const SHA="a".repeat(40);
async function fixture(){
  const dir=await mkdtemp(join(tmpdir(),"r5-private-runner-pin-"));
  return {dir,file:join(dir,"r5-pre-dispatch-"+SHA+".json"),
    close:()=>rm(dir,{recursive:true,force:true})};
}
test("R5 pre-dispatch independent runner pin creates exclusive durable 0600 no-GO record",async()=>{
  const f=await fixture();try{
    const result=await persist(f.dir,{sourceSha:SHA,runnerId:17},
      {nowMs:Date.parse("2026-10-26T11:59:00.000Z")});
    assert.equal(result.status,"pre_dispatch_owner_inventory_only");
    assert.equal(result.runner_id,17);
    assert.equal(result.independent_physical_attestation,false);
    assert.equal(result.external_r5_go,false);
    assert.equal(result.observed_at,"2026-10-26T11:59:00.000Z");
    assert.equal((await lstat(f.file)).mode&0o777,0o600);
    assert.deepEqual((await readdir(f.dir)),[
      "r5-pre-dispatch-"+SHA+".json"]);
    assert.deepEqual(await load(f.dir,SHA),result);
    assert.equal(JSON.stringify(result).includes("token"),false);
  }finally{await f.close();}
});
test("R5 independent pre-dispatch runner pin NEVER overwrites already observed source",async()=>{
  const f=await fixture();try{
    await persist(f.dir,{sourceSha:SHA,runnerId:17});
    const first=await readFile(f.file,"utf8");
    await assert.rejects(persist(f.dir,{sourceSha:SHA,runnerId:18}),
      /NO-GO/);
    assert.equal(await readFile(f.file,"utf8"),first);
    assert.deepEqual((await readdir(f.dir)),[
      "r5-pre-dispatch-"+SHA+".json"]);
  }finally{await f.close();}
});
test("R5 owner pin refuses unsafe permissions, symlinks and changed runner claims",async()=>{
  const f=await fixture();try{
    for(const input of [
      {sourceSha:"invalid",runnerId:17},
      {sourceSha:SHA,runnerId:0},
      {sourceSha:SHA,runnerId:1.5},
      {sourceSha:SHA,runnerId:"17"}
    ])await assert.rejects(persist(f.dir,input),/NO-GO/);
    await persist(f.dir,{sourceSha:SHA,runnerId:17});
    await chmod(f.file,0o644);
    await assert.rejects(load(f.dir,SHA),/NO-GO/);
    await chmod(f.file,0o600);
    const damaged=JSON.parse(await readFile(f.file,"utf8"));
    damaged.runner_id=19;
    damaged.unauthorized_model_inference=true;
    await writeFile(f.file,JSON.stringify(damaged),{mode:0o600});
    await assert.rejects(load(f.dir,SHA),/NO-GO/);
    await rm(f.file);
    const target=join(f.dir,"original.json");
    await writeFile(target,"{}",{mode:0o600});
    await symlink(target,f.file);
    await assert.rejects(load(f.dir,SHA),/NO-GO/);
  }finally{await f.close();}
});
test("R5 pre-dispatch pin refuses world/group-readable parent before writing anything",async()=>{
  const f=await fixture();try{
    await chmod(f.dir,0o755);
    await assert.rejects(persist(f.dir,{sourceSha:SHA,runnerId:17}),
      /NO-GO/);
    assert.deepEqual(await readdir(f.dir),[]);
  }finally{await f.close();}
});
test("R5 pre-dispatch pin cannot be forged by malformed timestamp in protected observation",async()=>{
  const f=await fixture();try{
    await persist(f.dir,{sourceSha:SHA,runnerId:17});
    const content=JSON.parse(await readFile(f.file,"utf8"));
    content.observed_at="after-the-run";
    await writeFile(f.file,JSON.stringify(content),{mode:0o600});
    await assert.rejects(load(f.dir,SHA),/NO-GO/);
    await assert.rejects(load(f.dir,"b".repeat(40)),/NO-GO/);
  }finally{await f.close();}
});
