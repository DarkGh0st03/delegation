import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,chmod,readdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {TrustedPlanningRetirementStore}
  from "../src/trusted-planning-retirement-store.ts";
import {TrustedPlanningRevisions} from "../src/planning-revisions.ts";
const SHA="a".repeat(40);
const session="durable-planning-1";
async function setup(){
  const dir=await mkdtemp(join(tmpdir(),"gateway-planning-retired-"));
  return {dir,store:new TrustedPlanningRetirementStore(dir),
    close:()=>rm(dir,{recursive:true,force:true})};
}
const gitea=()=>({
  async readRepository(){
    return {default_branch:"main",revision:SHA};
  }
});

test("durable Gateway retirement blocks the same ID after a cold restart",async()=>{
  const f=await setup();
  try{
    await f.store.assertReady();
    const first=new TrustedPlanningRevisions(gitea(),{
      retirementStore:f.store
    });
    assert.equal((await first.begin(session,300000)).base_revision,SHA);
    await first.retire(session);
    const restarted=new TrustedPlanningRevisions(gitea(),{
      retirementStore:new TrustedPlanningRetirementStore(f.dir)
    });
    await assert.rejects(restarted.begin(session,300000),
      /retired Planning session cannot be registered/);
    await restarted.retire(session); // idempotent durable IPC replay
    await assert.rejects(restarted.begin(session,300000),/already registered/);
    assert.equal((await restarted.begin("new-owner-session",300000))
      .base_revision,SHA);
  }finally{await f.close();}
});

test("unknown Planning session is tombstoned before any future Gitea begin",async()=>{
  const f=await setup();
  try{
    const first=new TrustedPlanningRevisions(gitea(),{
      retirementStore:f.store
    });
    await first.retire(session);
    const restarted=new TrustedPlanningRevisions(gitea(),{
      retirementStore:new TrustedPlanningRetirementStore(f.dir)
    });
    await assert.rejects(restarted.begin(session,1000),
      /retired Planning session cannot be registered/);
  }finally{await f.close();}
});

test("filesystem corruption and shared permissions prevent Gateway startup",async()=>{
  const f=await setup();
  try{
    await f.store.markRetired(session);
    const [name]=await readdir(f.dir);
    const path=join(f.dir,name);
    await writeFile(path,"{");
    await assert.rejects(f.store.assertReady(),/incomplete or unsafe/);
    await writeFile(path,"{"+" ".repeat(100));
    await assert.rejects(f.store.assertReady(),/invalid retirement JSON/);
    await rm(path);
    await writeFile(join(f.dir,"unknown"),"x",{mode:0o600});
    await assert.rejects(f.store.assertReady(),/unexpected retirement journal entry/);
    await rm(join(f.dir,"unknown"));
    await chmod(f.dir,0o755);
    await assert.rejects(f.store.assertReady(),/owner-owned and mode 0700/);
  }finally{await f.close();}
});

test("retirement during in-flight Gitea discovery blocks acceptance after restart",async()=>{
  const f=await setup();
  try{
    let finish:(v:{default_branch:string;revision:string})=>void=()=>{};
    const client={readRepository:()=>new Promise<{default_branch:string;revision:string}>
      (resolve=>{finish=resolve;})};
    const registry=new TrustedPlanningRevisions(client,{
      retirementStore:f.store
    });
    const pending=registry.begin(session,5000);
    // Registration waits for durable-journal check before Gitea discovery.
    // Yield so the scripted Gitea promise is created.
    await new Promise(resolve=>setImmediate(resolve));
    await registry.retire(session);
    finish({default_branch:"main",revision:SHA});
    await assert.rejects(pending,/retired during Gitea discovery/);
    const after=new TrustedPlanningRevisions(gitea(),{
      retirementStore:new TrustedPlanningRetirementStore(f.dir)
    });
    await assert.rejects(after.begin(session,5000),/retired Planning session/);
  }finally{await f.close();}
});
