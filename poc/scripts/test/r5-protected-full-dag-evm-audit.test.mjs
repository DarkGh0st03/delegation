import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign,createHash} from "node:crypto";
import {gzipSync} from "node:zlib";
import {spawnSync} from "node:child_process";
import {mkdtemp,mkdir,writeFile,readFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {makeApproval,planDigest,PLAN_SCHEMA_VERSION}
  from "../../packages/plan-contracts/src/plan.mjs";
import {signEngineerApproval}
  from "../../packages/plan-contracts/src/signed-approval.mjs";
import {RUST_OPERATIONS} from "../../apps/gateway/src/operation-catalog.ts";
import {TrustedPlanningRecoveryStore}
  from "../../packages/orchestrator-runtime/src/trusted-planning-recovery-store.ts";
import {TrustedOperationalRecoveryStore}
  from "../../packages/orchestrator-runtime/src/trusted-operational-recovery-store.ts";
import {TrustedChildIssuanceJournal}
  from "../../packages/orchestrator-runtime/src/trusted-child-issuance-journal.mjs";
import {keccak256Bytes}
  from "../r5-independent-status-evm-verifier.mjs";
import {observeProtectedR5FullDagEthereum}
  from "../r5-protected-full-dag-evm-audit.mjs";

const SHA="a".repeat(40),RUN="40477010001";
const ENGINEER="did:example:engineer";
const ISSUER_ADDR="0x1234567890abcdef1234567890abcdef12345678";
const ISSUER_DID="did:ethr:0x7a69:"+ISSUER_ADDR;
const REG="0x1111111111111111111111111111111111111111";
const STATUS="https://status.example/r5-all";
const ROOT="gitea://gitea.local/thesis/iam";
const BRANCH=ROOT+"/branches/feature%2Fscope";
const FILE=BRANCH+"/files/src/main.ts";
const TASKS=[
 ["branch","orchestrator","create_branch",ROOT],
 ["backend","backend","read_file",FILE],
 ["frontend","frontend","read_file",FILE],
 ["test","test","run_tests",BRANCH],
 ["pr","orchestrator","create_pull_request",ROOT]
];
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),"r5-owner-full-dag-"));
  const dirs=Object.fromEntries(["config","evidence","inventory","approval",
    "planning","operational","issuance","public"].map(name=>
    [name,join(root,name)]));
  for(const [name,path] of Object.entries(dirs))
    await mkdir(path,{mode:name==="public"?0o755:0o700});
  const statusDir=join(dirs.public,"status-lists");
  await mkdir(statusDir,{mode:0o755});
  async function save(path,value,mode=0o600){
    await writeFile(path,typeof value==="string"?value:JSON.stringify(value),
      {mode});
  }
  const plan={
    schema_version:PLAN_SCHEMA_VERSION,plan_id:"r5-public-proof",
    session_id:"r5-completed",version:1,
    repository:{authority:"gitea.local",owner:"thesis",repository:"iam"},
    base_revision:SHA,requirement:"Verify revocation of all five credentials",
    candidate_agents:["backend","frontend","test"].map(role=>({
      agent_id:role,did:"did:example:"+role,card_ref:"private:"+role
    })),
    tasks:TASKS.map(([id,agent_id,,resource],i)=>({
      id,agent_id,title:id,description:"Signed "+id,
      depends_on:i?[TASKS[i-1][0]]:[],resources:[resource]
    })),
    requested_permissions:TASKS.map(([task_id,agent_id,operation,resource])=>({
      id:"permit-"+task_id,task_id,agent_id,operation,resource,
      reason:"Approved "+task_id
    })),assumptions:[],uncertainties:[]
  };
  const digest=planDigest(plan);
  const engineer=generateKeyPairSync("ed25519");
  const issuer=generateKeyPairSync("ed25519");
  const now=new Date().toISOString();
  const approval=makeApproval(plan,{
    allowedOperations:new Set(RUST_OPERATIONS),
    decision_id:"full-dag-approval",approved_by:ENGINEER,
    approved_at:now,
    approved_permission_ids:TASKS.map(([id])=>"permit-"+id)
  });
  await save(join(dirs.approval,"r5-completed.json"),signEngineerApproval({
    plan,approval,engineerDid:ENGINEER,keyId:"engineer-key",
    privateKeyPem:engineer.privateKey.export({type:"pkcs8",format:"pem"}).toString(),
    issuedAt:now,expiresAt:new Date(Date.now()+15*60_000).toISOString()
  }));
  const engineerPubPath=join(dirs.config,"engineer.pub");
  await save(engineerPubPath,engineer.publicKey.export({
    type:"spki",format:"pem"
  }).toString());
  const issuerPubPath=join(dirs.config,"issuer.jwk");
  await save(issuerPubPath,issuer.publicKey.export({format:"jwk"}));
  const rootPlanning="urn:root:planning",rootOperational="urn:root:execution";
  const inventory={
    schema:"r5-credential-issuance-inventory-v1",source_sha:SHA,
    github_run_id:RUN,session_id:plan.session_id,approved_plan_digest:digest,
    preliminary_root_id:rootPlanning,operational_root_id:rootOperational,
    task_children:["backend","frontend","test"].map(task_id=>({
      task_id,credential_id:"urn:child:"+task_id
    }))
  };
  const evidence={
    schema:"r5-scripted-owner-completion-v1",
    status:"verified_complete_local_owner_observation",
    source_sha:SHA,github_run_id:RUN,session_id:plan.session_id,
    approved_plan_digest:digest,approved_task_ids:TASKS.map(t=>t[0]),
    completed_task_ids:TASKS.map(t=>t[0]),
    authenticated_engineer_did:ENGINEER,
    coordinator_terminal_phase:"closed",original_runtime_returned_success:true,
    independently_attested:false,provider_model_calls_verified_here:false,
    external_r5_go:false
  };
  await save(join(dirs.evidence,"r5-scripted-run-"+RUN+".json"),evidence);
  await save(join(dirs.inventory,"r5-issued-credentials-"+RUN+".json"),inventory);
  const planning=new TrustedPlanningRecoveryStore(dirs.planning);
  const operational=new TrustedOperationalRecoveryStore(dirs.operational);
  await planning.recordIntent({sessionId:plan.session_id,
    baseRevision:SHA,credentialId:rootPlanning});
  await operational.recordIntent({sessionId:plan.session_id,
    baseRevision:SHA,credentialId:rootOperational});
  await planning.markReconciled({sessionId:plan.session_id,
    baseRevision:SHA,credentialId:rootPlanning});
  await operational.markReconciled({sessionId:plan.session_id,
    baseRevision:SHA,credentialId:rootOperational});
  const journal=new TrustedChildIssuanceJournal({
    directory:dirs.issuance,sessionId:plan.session_id,
    baseRevision:SHA,planDigest:digest,parentCredentialId:rootOperational
  });
  for(const [i,child] of inventory.task_children.entries()){
    await journal.recordIntent({taskId:child.task_id,role:child.task_id,
      credentialId:child.credential_id,statusListCredential:STATUS,
      statusListIndex:String(102+i)});
    if(i!==2)await journal.recordVerifiedResponse({
      taskId:child.task_id,credentialId:child.credential_id
    });
  }
  const rootRows=[
    {credential_id:rootPlanning,status_list_credential:STATUS,
      status_list_index:"100"},
    {credential_id:rootOperational,status_list_credential:STATUS,
      status_list_index:"101"}
  ];
  const rootRowsPath=join(dirs.config,"root-rows.json");
  await save(rootRowsPath,rootRows);
  const bits=Buffer.alloc(16384);
  for(let index=100;index<=104;index++)
    bits[index>>3]|=128>>(index%8);
  const doc={
    id:STATUS,issuer:ISSUER_DID,
    type:["VerifiableCredential","BitstringStatusListCredential"],
    credentialSubject:{type:"BitstringStatusList",
      statusPurpose:"revocation",
      encodedList:"u"+gzipSync(bits).toString("base64url")}
  };
  const enc=x=>Buffer.from(JSON.stringify(x)).toString("base64url");
  const unsigned=enc({alg:"EdDSA",typ:"vc+jwt"})+"."+enc(doc);
  const jwt=unsigned+"."+
    sign(null,Buffer.from(unsigned),issuer.privateKey).toString("base64url");
  const sha=createHash("sha256");
  for(const item of [ISSUER_DID,STATUS]){
    const bytes=Buffer.from(item),len=Buffer.alloc(8);
    len.writeBigUInt64BE(BigInt(bytes.length));
    sha.update(len).update(bytes);
  }
  const statusPath=join(statusDir,sha.digest("hex")+".jwt");
  await save(statusPath,jwt,0o644);
  const configPath=join(dirs.config,"audit.json");
  const config={
    schema:"r5-owner-full-dag-public-evm-v1",source_sha:SHA,
    github_run_id:RUN,evidence_directory:dirs.evidence,
    inventory_directory:dirs.inventory,approval_directory:dirs.approval,
    engineer_did:ENGINEER,engineer_key_id:"engineer-key",
    engineer_public_key_file:engineerPubPath,
    planning_recovery_directory:dirs.planning,
    operational_recovery_directory:dirs.operational,
    issuance_journal_directory:dirs.issuance,
    root_status_entries_file:rootRowsPath,public_artifact_root:dirs.public,
    rpc_url:"http://127.0.0.1:8545",expected_chain_id:"0x7a69",
    registry_address:REG,issuer_address:ISSUER_ADDR,issuer_did:ISSUER_DID,
    issuer_public_jwk_file:issuerPubPath
  };
  await save(configPath,config);
  const w=x=>BigInt(x).toString(16).padStart(64,"0");
  const hash="0x"+keccak256Bytes(Buffer.from(jwt)).toString("hex");
  const chainOutput="0x"+w(1)+hash.slice(2)+w(7)+w(1234)+w(1);
  const calls=[];
  const fetchFn=async(_url,options)=>{
    const req=JSON.parse(options.body);
    calls.push(req.method);
    return {ok:true,status:200,text:async()=>JSON.stringify({
      jsonrpc:"2.0",id:1,result:{
        eth_chainId:"0x7a69",eth_blockNumber:"0x9",
        eth_getBlockByNumber:{hash:"0x"+"cc".repeat(32)},
        eth_call:chainOutput
      }[req.method]
    })};
  };
  const args={configPath,expectedSourceSha:SHA,expectedRunId:RUN,
    expectedChainId:"0x7a69",expectedRegistryAddress:REG,
    expectedIssuerDid:ISSUER_DID,fetchFn};
  return {root,dirs,config,configPath,statusPath,calls,args,save,
    cleanup:()=>rm(root,{recursive:true,force:true})};
}
async function owner(input){
  const was=process.env.GITHUB_ACTIONS;
  delete process.env.GITHUB_ACTIONS;
  try{return await observeProtectedR5FullDagEthereum(input);}
  finally{if(was===undefined)delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS=was;}
}
test("R5 protected operator verifies both retired roots and all signed child status bits on one independent EVM block",async()=>{
  const f=await fixture();try{
    const r=await owner(f.args);
    assert.equal(r.observed_root_count,2);
    assert.equal(r.observed_specialized_child_count,3);
    assert.equal(r.uncertain_child_issuance_count,1);
    assert.equal(r.original_host_root_tombstones_matched,true);
    assert.equal(r.public_artifacts_read_directly_from_rust_store,true);
    assert.equal(r.one_block_consistent,true);
    assert.equal(r.external_r5_go,false);
    assert.equal(r.safe_to_retry_child_issuance,false);
    assert.equal(f.calls.filter(x=>x==="eth_call").length,5);
    assert.equal(f.calls.filter(x=>x==="eth_blockNumber").length,1);
  }finally{await f.cleanup();}
});
test("R5 independent operator pins, missing private root tombstone and tampered public JWT fail closed",async()=>{
  const f=await fixture();try{
    const bad=[
      {expectedSourceSha:"b".repeat(40)},
      {expectedRunId:"40470000007"},
      {expectedIssuerDid:"did:ethr:0x1:"+ISSUER_ADDR},
      {expectedRegistryAddress:"0x"+"ff".repeat(20)}
    ];
    for(const mutation of bad){
      await assert.rejects(owner({...f.args,...mutation}),/NO-GO/);
      assert.equal(f.calls.length,0);
    }
    const jwt=await readFile(f.statusPath,"utf8");
    await f.save(f.statusPath,jwt.slice(0,-1)+
      (jwt.at(-1)==="a"?"b":"a"),0o644);
    await assert.rejects(owner(f.args),/NO-GO/);
    assert.equal(f.calls.length,0);
  }finally{await f.cleanup();}
});
test("R5 protected CLI never executes within GitHub Actions or emits credentials",()=>{
  const url=new URL("../r5-protected-full-dag-evm-audit.mjs",import.meta.url);
  const child=spawnSync(process.execPath,[
    "--experimental-strip-types",url.pathname
  ],{encoding:"utf8",timeout:12000,env:{
    PATH:process.env.PATH??"",GITHUB_ACTIONS:"true",
    DELEGATION_R5_FULL_DAG_EVM_CONFIG:"/private/root-secret.json",
    DELEGATION_R5_EXPECTED_SOURCE_SHA:SHA,DELEGATION_R5_EXPECTED_RUN_ID:RUN,
    DELEGATION_R5_EXPECTED_CHAIN_ID:"0x7a69",
    DELEGATION_R5_EXPECTED_REGISTRY_ADDRESS:REG,
    DELEGATION_R5_EXPECTED_ISSUER_DID:ISSUER_DID
  }});
  assert.equal(child.status,1);
  assert.equal(child.stdout,"");
  assert.match(child.stderr,/R5 protected full-DAG EVM audit NO-GO/);
  assert.doesNotMatch(child.stderr,/root-secret|did:ethr|status.example/);
});
