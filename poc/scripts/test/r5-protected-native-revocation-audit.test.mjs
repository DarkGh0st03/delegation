import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,chmod,symlink,link,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {observeProtectedR5NativeRevocations}
  from "../r5-protected-native-revocation-audit.mjs";

const SHA="a".repeat(40),RUN="40470000098",DIGEST="b".repeat(64);
async function setup(){
  const root=await mkdtemp(join(tmpdir(),"r5-protected-native-audit-"));
  const evidenceDir=join(root,"evidence"),inventoryDir=join(root,"inventory"),
    configDir=join(root,"config");
  await Promise.all([evidenceDir,inventoryDir,configDir].map(
    p=>mkdir(p,{mode:0o700})));
  const paths={
    receipt:join(evidenceDir,"r5-scripted-run-"+RUN+".json"),
    manifest:join(inventoryDir,"r5-issued-credentials-"+RUN+".json"),
    config:join(configDir,"config.json"),
    token:join(configDir,"gateway.token")
  };
  const evidence={
    schema:"r5-scripted-owner-completion-v1",
    status:"verified_complete_local_owner_observation",
    source_sha:SHA,github_run_id:RUN,
    session_id:"r5-private-original",approved_plan_digest:DIGEST,
    approved_task_ids:["branch","backend","frontend","test","pr"],
    completed_task_ids:["branch","frontend","backend","test","pr"],
    authenticated_engineer_did:"did:example:engineer",
    coordinator_terminal_phase:"closed",
    original_runtime_returned_success:true,
    independently_attested:false,provider_model_calls_verified_here:false,
    external_r5_go:false
  };
  const inventory={
    schema:"r5-credential-issuance-inventory-v1",
    source_sha:SHA,github_run_id:RUN,
    session_id:"r5-private-original",approved_plan_digest:DIGEST,
    preliminary_root_id:"urn:root:planning",operational_root_id:"urn:root:work",
    task_children:["backend","frontend","test"].map(task_id=>({
      task_id,credential_id:"urn:child:"+task_id
    }))
  };
  const config={
    schema:"r5-native-revocation-audit-config-v1",
    source_sha:SHA,github_run_id:RUN,
    adapter_base_url:"http://127.0.0.1:8123",
    gateway_verifier_bearer_file:paths.token
  };
  async function save(path,value){
    await writeFile(path,typeof value==="string"?value:JSON.stringify(value),
      {mode:0o600});
  }
  await Promise.all([
    save(paths.receipt,evidence),save(paths.manifest,inventory),
    save(paths.config,config),save(paths.token,"only-private-gateway-verifier-token")
  ]);
  return {
    root,evidenceDir,inventoryDir,configDir,paths,evidence,inventory,config,save,
    args:{configPath:paths.config,evidenceDirectory:evidenceDir,
      inventoryDirectory:inventoryDir,expectedSourceSha:SHA,expectedRunId:RUN},
    cleanup:()=>rm(root,{recursive:true,force:true})
  };
}
function fake(){
  const seen=[];
  return {seen,fetchFn:async(url,options)=>{
    seen.push({url,options});
    const credential_id=JSON.parse(options.body).credential_id;
    return {status:200,ok:true,text:async()=>JSON.stringify({
      credential_id,status_purpose:"revocation",status_set:true,
      source:"evm_anchored_signed_jwt",anchor_version:5
    })};
  }};
}
async function ownerCall(args){
  // A fresh CI job sets GITHUB_ACTIONS=true. The production guard must
  // remain active; locally test only this owner function with a temporary
  // test-process environment override, never from the workflow itself.
  const was=process.env.GITHUB_ACTIONS;
  delete process.env.GITHUB_ACTIONS;
  try{return await observeProtectedR5NativeRevocations(args);}
  finally{
    if(was===undefined)delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS=was;
  }
}
test("R5 owner-only command reads 0600 original evidence, inventory and bearer then observes every EVM root/child",async()=>{
  const f=await setup();
  try{
    const network=fake();
    const r=await ownerCall({...f.args,fetchFn:network.fetchFn});
    assert.equal(r.status,
      "adapter_reported_evm_revocation_for_supplied_inventory_only");
    assert.equal(r.observed_root_count,2);
    assert.equal(r.observed_task_child_count,3);
    assert.equal(r.external_r5_go,false);
    assert.equal(network.seen.length,5);
    assert.deepEqual(network.seen.map(x=>JSON.parse(x.options.body).credential_id),
      ["urn:root:planning","urn:root:work",
       "urn:child:backend","urn:child:frontend","urn:child:test"]);
    assert.equal(network.seen.every(x=>
      x.url==="http://127.0.0.1:8123/v1/credentials/status/inspect"&&
      x.options.headers.authorization===
        "Bearer only-private-gateway-verifier-token"),true);
    assert.equal(JSON.stringify(r).includes("gateway-verifier-token"),false);
  }finally{await f.cleanup();}
});
test("R5 missing human completion, unsupported task inventory or source drift refuses before bearer/network",async()=>{
  const f=await setup();
  try{
    for(const change of [
      ()=>({expectedRunId:"999"}),
      ()=>({expectedSourceSha:"c".repeat(40)})
    ]){
      const network=fake();
      await assert.rejects(ownerCall({...f.args,...change(),
        fetchFn:network.fetchFn}),/NO-GO/);
      assert.equal(network.seen.length,0);
    }
    f.inventory.task_children.pop();
    await f.save(f.paths.manifest,f.inventory);
    const network=fake();
    await assert.rejects(ownerCall({...f.args,fetchFn:network.fetchFn}),/NO-GO/);
    assert.equal(network.seen.length,0);
  }finally{await f.cleanup();}
});
test("R5 rejects unsafe config, symlink, hardlink, directories and wrong bearer modes",async()=>{
  const f=await setup();
  try{
    const failed=async args=>{
      const network=fake();
      await assert.rejects(ownerCall({...f.args,...args,
        fetchFn:network.fetchFn}),/NO-GO/);
      assert.equal(network.seen.length,0);
    };
    await chmod(f.paths.token,0o644);await failed({});
    await chmod(f.paths.token,0o600);
    await chmod(f.configDir,0o755);await failed({});
    await chmod(f.configDir,0o700);
    const symlinkPath=join(f.configDir,"symlink.json");
    await symlink(f.paths.config,symlinkPath);
    await failed({configPath:symlinkPath});
    const hardlinkPath=join(f.configDir,"hardlink.json");
    await link(f.paths.config,hardlinkPath);
    await failed({});
    await rm(hardlinkPath);
    await chmod(f.paths.receipt,0o666);await failed({});
    await chmod(f.paths.receipt,0o600);
    f.config.extra="unreviewed";
    await f.save(f.paths.config,f.config);await failed({});
  }finally{await f.cleanup();}
});
test("R5 CLI on GitHub job cannot inspect anything and never prints secrets",async()=>{
  const f=await setup();
  try{
    const script=new URL("../r5-protected-native-revocation-audit.mjs",import.meta.url);
    const child=spawnSync(process.execPath,[
      "--experimental-strip-types",script.pathname
    ],{encoding:"utf8",timeout:12000,env:{
      PATH:process.env.PATH??"",GITHUB_ACTIONS:"true",
      DELEGATION_R5_REVOCATION_CONFIG:f.paths.config,
      DELEGATION_R5_EVIDENCE_DIRECTORY:f.evidenceDir,
      DELEGATION_R5_ISSUANCE_INVENTORY_DIRECTORY:f.inventoryDir,
      DELEGATION_R5_EXPECTED_SOURCE_SHA:SHA,
      DELEGATION_R5_EXPECTED_RUN_ID:RUN
    }});
    assert.equal(child.status,1);
    assert.equal(child.stdout,"");
    assert.match(child.stderr,/R5 protected native revocation audit NO-GO/);
    assert.doesNotMatch(child.stderr,/gateway-verifier-token|urn:root|8123/);
  }finally{await f.cleanup();}
});
