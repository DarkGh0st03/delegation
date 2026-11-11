import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,chmod,symlink,link,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {generateKeyPairSync} from "node:crypto";
import {makeApproval,planDigest,PLAN_SCHEMA_VERSION}
  from "../../packages/plan-contracts/src/plan.mjs";
import {signEngineerApproval}
  from "../../packages/plan-contracts/src/signed-approval.mjs";
import {RUST_OPERATIONS} from "../../apps/gateway/src/operation-catalog.ts";
import {TrustedChildIssuanceJournal}
  from "../../packages/orchestrator-runtime/src/trusted-child-issuance-journal.mjs";
import {spawnSync} from "node:child_process";
import {observeProtectedR5NativeRevocations}
  from "../r5-protected-native-revocation-audit.mjs";

const SHA="a".repeat(40),RUN="40470000098",DID="did:example:engineer";
async function setup(){
  const root=await mkdtemp(join(tmpdir(),"r5-protected-native-audit-"));
  const evidenceDir=join(root,"evidence"),inventoryDir=join(root,"inventory"),
    configDir=join(root,"config"),
    approvalsDir=join(root,"approvals"),
    issuanceDir=join(root,"issuance");
  await Promise.all([evidenceDir,inventoryDir,configDir,approvalsDir,issuanceDir].map(
    p=>mkdir(p,{mode:0o700})));
  const paths={
    receipt:join(evidenceDir,"r5-scripted-run-"+RUN+".json"),
    manifest:join(inventoryDir,"r5-issued-credentials-"+RUN+".json"),
    config:join(configDir,"config.json"),
    token:join(configDir,"gateway.token"),
    publicKey:join(configDir,"engineer.pub"),
    approval:join(approvalsDir,"r5-private-original.json")
  };
  const repo={authority:"gitea.local",owner:"thesis",repository:"iam"};
  const rootUri="gitea://gitea.local/thesis/iam";
  const branchUri=rootUri+"/branches/feature%2Fapproved-r5";
  const fileUri=branchUri+"/files/src/main.ts";
  const rows=[
    ["branch","orchestrator","create_branch",rootUri],
    ["backend","backend","read_file",fileUri],
    ["frontend","frontend","read_file",fileUri],
    ["test","test","run_tests",branchUri],
    ["pr","orchestrator","create_pull_request",rootUri]
  ];
  const signedPlan={
    schema_version:PLAN_SCHEMA_VERSION,plan_id:"r5-original-approval",
    session_id:"r5-private-original",version:1,repository:repo,
    base_revision:SHA,requirement:"Verify originally approved Task credentials",
    candidate_agents:["backend","frontend","test"].map(role=>({
      agent_id:role,did:"did:example:"+role,card_ref:"private:"+role
    })),
    tasks:rows.map(([id,agent_id,,resource],i)=>({
      id,agent_id,title:id,description:"Approved "+id,
      depends_on:i?[rows[i-1][0]]:[],resources:[resource]
    })),
    requested_permissions:rows.map(([task_id,agent_id,operation,resource])=>({
      id:"permit-"+task_id,task_id,agent_id,operation,resource,
      reason:"Signed "+task_id
    })),assumptions:[],uncertainties:[]
  };
  const DIGEST=planDigest(signedPlan);
  const keys=generateKeyPairSync("ed25519");
  const now=new Date().toISOString();
  const approval=makeApproval(signedPlan,{
    allowedOperations:new Set(RUST_OPERATIONS),
    decision_id:"r5-review",approved_by:DID,approved_at:now,
    approved_permission_ids:rows.map(([id])=>"permit-"+id)
  });
  const envelope=signEngineerApproval({
    plan:signedPlan,approval,engineerDid:DID,keyId:"owner-key",
    privateKeyPem:keys.privateKey.export({type:"pkcs8",format:"pem"}).toString(),
    issuedAt:now,expiresAt:new Date(Date.now()+15*60_000).toISOString()
  });
  const evidence={
    schema:"r5-scripted-owner-completion-v1",
    status:"verified_complete_local_owner_observation",
    source_sha:SHA,github_run_id:RUN,
    session_id:"r5-private-original",approved_plan_digest:DIGEST,
    approved_task_ids:["branch","backend","frontend","test","pr"],
    completed_task_ids:["branch","frontend","backend","test","pr"],
    authenticated_engineer_did:DID,
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
    gateway_verifier_bearer_file:paths.token,
    engineer_approval_directory:approvalsDir,
    engineer_public_key_file:paths.publicKey,
    engineer_did:DID,engineer_key_id:"owner-key",
    issuance_journal_directory:issuanceDir
  };
  async function save(path,value){
    await writeFile(path,typeof value==="string"?value:JSON.stringify(value),
      {mode:0o600});
  }
  await Promise.all([
    save(paths.receipt,evidence),save(paths.manifest,inventory),
    save(paths.config,config),save(paths.token,"only-private-gateway-verifier-token"),
    save(paths.publicKey,keys.publicKey.export({type:"spki",format:"pem"}).toString()),
    save(paths.approval,envelope)
  ]);
  const issuanceJournal=new TrustedChildIssuanceJournal({
    directory:issuanceDir,sessionId:evidence.session_id,baseRevision:SHA,
    planDigest:DIGEST,parentCredentialId:inventory.operational_root_id
  });
  for(let i=0;i<inventory.task_children.length;i++){
    const child=inventory.task_children[i];
    const role=child.task_id;
    await issuanceJournal.recordIntent({
      taskId:child.task_id,role,credentialId:child.credential_id,
      statusListCredential:"https://status.example/children",
      statusListIndex:String(1700+i)
    });
    await issuanceJournal.recordVerifiedResponse({
      taskId:child.task_id,credentialId:child.credential_id
    });
  }
  return {
    root,evidenceDir,inventoryDir,configDir,approvalsDir,issuanceDir,
    issuanceJournal,paths,evidence,inventory,config,save,
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
    assert.equal(r.signed_engineer_task_coverage_checked,true);
    assert.equal(r.original_host_child_intents_and_acks_matched,true);
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
test("R5 requires a real valid Engineer Ed25519 signature before touching Gateway bearer",async()=>{
  const f=await setup();
  try{
    const fakeNetwork=fake();
    const denied=async()=>{
      await assert.rejects(ownerCall({...f.args,fetchFn:fakeNetwork.fetchFn}),
        /NO-GO/);
      assert.equal(fakeNetwork.seen.length,0);
    };
    const {readFile}=await import("node:fs/promises");
    const valid=JSON.parse(await readFile(f.paths.approval,"utf8"));
    const tampered=structuredClone(valid);
    tampered.approval.approved_permission_ids.pop();
    await f.save(f.paths.approval,tampered);
    await denied();
    await f.save(f.paths.approval,valid);
    await chmod(f.paths.publicKey,0o644);
    await denied();
    await chmod(f.paths.publicKey,0o600);
    f.inventory.task_children[0].task_id="branch";
    await f.save(f.paths.manifest,f.inventory);
    await denied();
  }finally{await f.cleanup();}
});
test("R5 orphaned, uncertain or mismatched original Host child issuance ledger denies audit before bearer",async()=>{
 const f=await setup();try{
  const fail=async()=>{
    const fakes=fake();
    await assert.rejects(ownerCall({...f.args,fetchFn:fakes.fetchFn}),/NO-GO/);
    assert.equal(fakes.seen.length,0);
  };
  f.inventory.task_children[0].credential_id="urn:forged:backend";
  await f.save(f.paths.manifest,f.inventory);
  await fail();
  f.inventory.task_children[0].credential_id="urn:child:backend";
  await f.save(f.paths.manifest,f.inventory);
  const {readdir,rm:remove}=await import("node:fs/promises");
  const files=await readdir(f.issuanceDir);
  const ack=files.find(x=>x.endsWith(".ack.json"));
  assert.ok(ack);
  await remove(join(f.issuanceDir,ack));
  await fail();
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
