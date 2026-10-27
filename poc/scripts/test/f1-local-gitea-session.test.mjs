import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtemp,mkdir,rm,stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {URL as NodeURL} from "node:url";
import {F1_ORIGINAL_SHA,runF1OwnerGiteaSession}
  from "../f1-local-gitea-session.mjs";

test("F1 disposable source must be exact original unsolved commit",()=>{
  assert.equal(F1_ORIGINAL_SHA,"405748b1e77992b6bd8630a3ab6f990658d32f6b");
});
test("F1 owner CLI rejects invalid session modes and paths before Docker or Gitea",async()=>{
  for(const [mode,path] of [
    ["--execute","/tmp/not-allowed"],
    ["--start","relative/session"],
    ["--check","/tmp/nonexistent-unguarded-f1"],
    ["--stop","/tmp/nonexistent-unguarded-f1"],
    ["--start","/"],["--start","/tmp/../tmp/other"]
  ])await assert.rejects(runF1OwnerGiteaSession({
    mode,sessionDirectory:path
  }),/NO-GO/);
});
test("F1 start requires a fresh owner path and never deletes existing work",async()=>{
  const root=await mkdtemp(join(tmpdir(),"f1-preserve-"));
  const existing=join(root,"owned");
  try{
    await mkdir(existing,{mode:0o700});
    await assert.rejects(runF1OwnerGiteaSession({
      mode:"--start",sessionDirectory:existing
    }),/NO-GO/);
    assert.equal((await stat(existing)).isDirectory(),true);
  }finally{await rm(root,{recursive:true,force:true});}
});
test("F1 owner CLI denies unknown commands and redacts supplied secrets",()=>{
  const path=new NodeURL("../f1-local-gitea-session.mjs",import.meta.url);
  const child=spawnSync(process.execPath,[
    "--experimental-strip-types",path.pathname,
    "--execute","/tmp/not-a-session","EXTRA"
  ],{encoding:"utf8",timeout:15000,env:{
    PATH:process.env.PATH??"",
    GEMINI_API_KEY:"secret-must-never-leak"
  }});
  assert.notEqual(child.status,0);
  assert.equal(child.stdout,"");
  assert.doesNotMatch(child.stderr,/secret-must-never-leak/);
});
