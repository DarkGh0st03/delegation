import test from "node:test";
import assert from "node:assert/strict";
import {verifyProtectedScriptedInstallation as check,
  SCRIPTED_INSTALL_ROOT as ROOT}
  from "../r5-scripted-install-integrity.mjs";

const sha="a".repeat(40);
function fixture({rootOwner=true,groupWritable=false,symlink=false,
  head=sha,dirty=false,indexSymlink=false,badRoot=false,
  gitUnavailable=false,uid=1000,mutableImported=false,escapeIndex=false}={}){
  const checked=[];
  const commands=[];
  const lstatFn=async path=>{
    checked.push(path);
    const directory=path==="/opt"||path==="/opt/delegation"||
      path===ROOT||path===ROOT+"/.git"||
      ["/poc","/poc/apps","/poc/apps/orchestrator",
       "/poc/apps/orchestrator/src","/poc/packages",
       "/poc/packages/orchestrator-runtime",
       "/poc/packages/orchestrator-runtime/src","/poc/scripts"]
      .some(p=>path===ROOT+p);
    return {
      uid:rootOwner&&!(!directory&&mutableImported&&
        path.endsWith("imported.mjs"))?0:1000,
      mode:groupWritable?0o100666:0o100644,
      isSymbolicLink:()=>symlink&&
        path.endsWith("hold-private-scripted-github-session.mjs"),
      isDirectory:()=>directory,isFile:()=>!directory
    };
  };
  const gitFn=args=>{
    commands.push(args.join(" "));
    if(gitUnavailable)throw Error("git inaccessible");
    const command=args.join(" ");
    if(command==="rev-parse --show-toplevel")
      return badRoot?"/tmp/evil\n":ROOT+"\n";
    if(command==="rev-parse --verify HEAD")return head+"\n";
    if(command==="status --porcelain=v1 --untracked-files=all")
      return dirty?" M poc/scripts/evil.mjs\n":"";
    if(command==="ls-files --stage -z")
      return (indexSymlink?"120000":"100644")+" "+"b".repeat(40)+
        " 0\tpoc/scripts/r5-scripted-install-integrity.mjs\0"+
        "100644 "+"c".repeat(40)+" 0\t"+
        (escapeIndex?"../escape.mjs":"poc/scripts/imported.mjs")+"\0";
    throw Error("unexpected local Git command");
  };
  return {runnerUid:uid,lstatFn,gitFn,checked,commands};
}
test("R5 only root-owned local immutable installed SHA is eligible for further admission checks",async()=>{
  const f=fixture();
  const got=await check({expectedSourceSha:sha,...f});
  assert.equal(got.status,"local_install_checked_not_r5_go");
  assert.equal(got.source_sha,sha);
  assert.equal(f.commands.length,4);
  assert.equal(f.checked.includes(ROOT+"/poc/scripts/r5-scripted-dispatch-registration.mjs"),true);
  assert.equal(f.checked.includes(ROOT+"/poc/apps/orchestrator/src/hold-private-github-session.mjs"),true);
  assert.equal(f.checked.includes(ROOT+"/poc/apps/orchestrator/src/trusted-private-runner-oidc.mjs"),true);
});
test("R5 refuses unexpected installed SHA and dirty worktree",async()=>{
  for(const overrides of [{head:"b".repeat(40)},{dirty:true},{badRoot:true}])
    await assert.rejects(check({expectedSourceSha:sha,...fixture(overrides)}),
      /protected scripted install denied/);
});
test("R5 refuses root account, writable or untrusted files and local symlink",async()=>{
  for(const overrides of [{uid:0},{rootOwner:false},
    {groupWritable:true},{symlink:true},{mutableImported:true}])
    await assert.rejects(check({expectedSourceSha:sha,...fixture(overrides)}),
      /protected scripted install denied/);
});
test("R5 refuses external gitlink/symlink, malformed SHA and missing Git",async()=>{
  for(const overrides of [{indexSymlink:true},{escapeIndex:true},{gitUnavailable:true}])
    await assert.rejects(check({expectedSourceSha:sha,...fixture(overrides)}));
  await assert.rejects(check({expectedSourceSha:"X",...fixture()}),/pinned Git SHA/);
});

test("paid private runner hold script is guarded by shared immutable-source check before OIDC",async()=>{
  const {verifyProtectedPrivateRunnerInstallation}=await import(
    "../r5-scripted-install-integrity.mjs");
  const f=fixture();
  const r=await verifyProtectedPrivateRunnerInstallation({
    expectedSourceSha:sha,...f
  });
  assert.equal(r.status,"local_install_checked_not_r5_go");
  for(const relative of [
    "/poc/apps/orchestrator/src/hold-private-github-session.mjs",
    "/poc/apps/orchestrator/src/trusted-private-runner-oidc.mjs"
  ])assert.ok(f.checked.includes(ROOT+relative));
  await assert.rejects(verifyProtectedPrivateRunnerInstallation({
    expectedSourceSha:sha,...fixture({dirty:true})
  }),/protected scripted install denied/);
});
