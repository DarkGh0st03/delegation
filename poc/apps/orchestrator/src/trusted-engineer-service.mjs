/**
 * Non-billable, persistent Engineer-host BOOTSTRAP for an operator-controlled
 * service machine. Reads only owner-controlled, local protected files.
 * This module never calls Gemini, issues an operational root or supplies a
 * fake signed approval. Actual Gateway IPC + Rust Adapter orphan-root
 * reconciliation is performed by startTrustedEngineerRecoveringHost().
 */
import {open,lstat} from "node:fs/promises";
import {constants} from "node:fs";
import {dirname,isAbsolute,normalize} from "node:path";
import {startTrustedEngineerRecoveringHost,
  startOwnerControlledEngineerReviewHost} from "./trusted-engineer-host.mjs";
import {TrustedOperationalRecoveryStore}
  from "../../../packages/orchestrator-runtime/src/trusted-operational-recovery-store.ts";
import {TrustedReviewedPlanFile}
  from "../../../packages/orchestrator-runtime/src/trusted-reviewed-plan-file.ts";
import {SignedPlanningCheckpointFileStore} from
  "../../../packages/orchestrator-runtime/src/trusted-planning-checkpoint-store.ts";

function denied(){
  throw Error("Trusted Engineer service configuration denied");
}
function record(value){
  return value!==null&&typeof value==="object"&&!Array.isArray(value);
}
// Owner-authored JSON is still data, not executable host policy. Refuse
// unexpected keys rather than silently forwarding newly added authority,
// transport or integration fields into the trusted runtime.
function allowedKeys(value,keys){
  return record(value)&&Object.keys(value).every(k=>keys.includes(k));
}
async function ownedPrivateDir(path){
  if(typeof path!=="string"||!isAbsolute(path)||normalize(path)!==path)
    denied();
  const st=await lstat(path);
  if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0||
     (typeof process.getuid==="function"&&st.uid!==process.getuid()))
    denied();
}
async function protectedText(path,maxLength=131072){
  if(typeof path!=="string"||!isAbsolute(path)||normalize(path)!==path)
    denied();
  await ownedPrivateDir(dirname(path));
  // Don't follow an attacker-replaced final symlink, read the open inode.
  let handle;
  try{
    handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    const st=await handle.stat();
    if(!st.isFile()||(st.mode&0o077)!==0||
       (typeof process.getuid==="function"&&st.uid!==process.getuid())||
       st.size===0||st.size>maxLength)denied();
    return await handle.readFile({encoding:"utf8"});
  }catch{
    // Never leak key paths or filesystem error codes to service logs.
    denied();
  }finally{await handle?.close();}
}
function path(value){
  if(typeof value!=="string"||!isAbsolute(value)||
     normalize(value)!==value)denied();
  return value;
}
/** Fail-closed loader; never accept configuration in GitHub events or HTTP. */
export async function loadTrustedEngineerServiceConfig(configPath,options={}){
  let source;
  try{source=JSON.parse(await protectedText(configPath,32768));}
  catch{denied();}
  if(!record(source)||
     Object.keys(source).some(k=>![
       "approval","oidc","recovery","approvalPort","oidcPort"
     ].includes(k))||
     !record(source.approval)||!record(source.oidc)||
     !record(source.recovery)||!record(source.approval.checkpoint)||
     !record(source.oidc.tls)||
     !record(source.oidc.pinned)||!record(source.oidc.trust))
    denied();
  // Only owner-side Planning preparation may omit plan.json; cold
  // recovering service startup must always verify the already written
  // backend-signed, owner-protected plan. This switch is NOT read from
  // GitHub, a file, UI, model or workflow_dispatch.
  if(!allowedKeys(options,["pendingPlanningOutput"])||
     (options.pendingPlanningOutput!==undefined&&
      options.pendingPlanningOutput!==true))
    denied();
  const pending=options.pendingPlanningOutput===true;
  const approval=source.approval,oidc=source.oidc,recovery=source.recovery;
  if(!allowedKeys(approval,[
       "engineerDid","keyId","expectedSessionId","expectedBaseRevision",
       "repository","receiptDirectory","trustedPlanFile","privateKeyFile",
       "publicKeyPemFile","passwordSaltHex","passwordScryptHex",
       "checkpoint"
     ])||
     !allowedKeys(approval.checkpoint,[
       "directory","backendKeyId","backendPublicKeyPemFile",
       "expectedWorkBranch"
     ])||
     !allowedKeys(oidc,[
       "pinned","trust","replayDirectory","admissionDirectory",
       "bindAddress","githubApiTokenFile","hmacSecretHexFile","tls"
     ])||
     !allowedKeys(recovery,[
       "directory","planningDirectory","gatewaySocketPath",
       "gatewaySecretFile","adapterBaseUrl","adapterTokenFile"
     ])||
     !allowedKeys(oidc.tls,[
       "caFile","certFile","keyFile","expectedClientFingerprint256"
     ])||
     !allowedKeys(oidc.pinned,[
       "repository","ref","workflowPath","sourceSha"
     ])||
     !allowedKeys(oidc.trust,[
       "expectedAudience","expectedSubject",
       "expectedRepositoryId","expectedOwnerId"
     ]))denied();
  const requiredPaths=[
    approval.privateKeyFile,
    approval.publicKeyPemFile,
    approval.checkpoint.backendPublicKeyPemFile,oidc.githubApiTokenFile,
    oidc.hmacSecretHexFile,oidc.tls.caFile,
    oidc.tls.certFile,oidc.tls.keyFile,
    recovery.adapterTokenFile,recovery.gatewaySecretFile
  ];
  if(requiredPaths.some(v=>typeof v!=="string"))denied();
  // Local signing key, plan, approval and recovery journal cannot be
  // replaced by external workflow inputs or a model.
  for(const p of [
    approval.receiptDirectory,approval.checkpoint.directory,
    oidc.replayDirectory,oidc.admissionDirectory,
    recovery.directory,recovery.planningDirectory
  ])await ownedPrivateDir(p);
  if(new Set([
    approval.receiptDirectory,approval.checkpoint.directory,
    oidc.replayDirectory,oidc.admissionDirectory,
    recovery.directory,recovery.planningDirectory
  ]).size!==6)denied();
  // Planning's immutable reviewed plan is created using O_EXCL by
  // TrustedReviewedPlanFile.persist AFTER the backend signs the snapshot.
  // Reject even a valid preexisting plan in fresh-start mode, so this
  // bootstrap cannot silently reuse a stale/attacker-provided plan.
  let trustedPlan;
  if(pending){
    const target=path(approval.trustedPlanFile);
    await ownedPrivateDir(dirname(target));
    try{
      await lstat(target);
      denied(); // any existing entry (including symlink) is unsafe
    }catch(error){
      if(error?.code!=="ENOENT")denied();
    }
  }else{
    trustedPlan=await protectedText(approval.trustedPlanFile);
  }
  const reads=await Promise.all(requiredPaths.map(p=>protectedText(p)));
  const [signingKey,publicKey,backendPublicKey,
    githubApiToken,hmacHex,ca,cert,key,adapterToken,gatewaySecret]=reads;
  // Verify sensitive path ownership before the host opens them itself.
  if((!pending&&!trustedPlan.trim())||!signingKey.trim()||!gatewaySecret.trim()||
     !publicKey.includes("BEGIN PUBLIC KEY")||
     !backendPublicKey.includes("BEGIN PUBLIC KEY")||
     typeof approval.checkpoint.backendKeyId!=="string"||
     !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(
       approval.checkpoint.backendKeyId)||
     typeof approval.checkpoint.expectedWorkBranch!=="string"||
     !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(
       approval.checkpoint.expectedWorkBranch)||
     !/^[0-9a-f]{64,256}$/iu.test(hmacHex.trim())||
     hmacHex.trim().length%2!==0||
     githubApiToken.trim().length<8||
     githubApiToken.trim().length>4096||
     !adapterToken.trim()||adapterToken.trim().length>4096||
     !ca.includes("BEGIN CERTIFICATE")||
     !cert.includes("BEGIN CERTIFICATE")||
     !key.includes("BEGIN")||
     !/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/u
       .test(oidc.tls.expectedClientFingerprint256??"")||
     typeof recovery.adapterBaseUrl!=="string"||
     typeof recovery.gatewaySocketPath!=="string"||
     !isAbsolute(recovery.gatewaySocketPath))
    denied();
  const {publicKeyPemFile,checkpoint,...review}=approval;
  const checkpointStore=new SignedPlanningCheckpointFileStore({
    directory:path(checkpoint.directory),
    trust:{
      trustedKeys:{[checkpoint.backendKeyId]:{
        public_key_pem:backendPublicKey
      }},
      expectedSessionId:approval.expectedSessionId,
      expectedRepository:approval.repository,
      expectedBaseRevision:approval.expectedBaseRevision,
      expectedWorkBranch:checkpoint.expectedWorkBranch
    }
  });
  const {githubApiTokenFile,hmacSecretHexFile,tls,...oidcSettings}=oidc;
  const {adapterTokenFile,...recoverySettings}=recovery;
  return Object.freeze({
    approval:{...review,privateKeyFile:path(approval.privateKeyFile),
      trustedPlanFile:path(approval.trustedPlanFile),
      publicKeyPem:publicKey,planningCheckpointStore:checkpointStore},
    oidc:{...oidcSettings,githubApiToken:githubApiToken.trim(),
      hmacSecret:Buffer.from(hmacHex.trim(),"hex"),
      tls:{ca,cert,key,
        expectedClientFingerprint256:tls.expectedClientFingerprint256}},
    recovery:{...recoverySettings,gatewaySecretFile:
      path(recovery.gatewaySecretFile),adapterToken:adapterToken.trim()},
    approvalPort:source.approvalPort??0,
    oidcPort:source.oidcPort??0
  });
}
export async function startConfiguredTrustedEngineerService(configPath){
  return startTrustedEngineerRecoveringHost(
    await loadTrustedEngineerServiceConfig(configPath));
}

/**
 * Production-oriented, owner-only TWO-STAGE bootstrap. Unlike the
 * cold-recovery CLI, it connects the protected on-disk service settings to
 * the SAME process that constructs the live Planning Coordinator.
 *
 * IMPORTANT: Loading the config must happen BEFORE constructing the
 * Coordinator and BEFORE any Planning root is issued. This ensures the
 * Coordinator and the host use the exact same checkpoint-store INSTANCE,
 * not independent objects with coincidentally equal directory paths.
 *
 * Preparation itself NEVER starts a model, signs an Engineer approval,
 * consumes GitHub OIDC, issues an authority, starts an HTTP listener or
 * invokes any remote service. Only the owner's explicit one-shot start()
 * calls the existing read-only Planning and recovering Engineer bootstrap.
 */
export async function prepareConfiguredOwnerEngineerBootstrap(configPath){
  const config=await loadTrustedEngineerServiceConfig(configPath,{
    pendingPlanningOutput:true
  });
  const checkpoints=config.approval.planningCheckpointStore;
  const operationalRecovery=new TrustedOperationalRecoveryStore(
    config.recovery.directory);
  const reviewFile=new TrustedReviewedPlanFile({
    filePath:config.approval.trustedPlanFile,
    checkpointStore:checkpoints
  });
  let attempted=false;
  return Object.freeze({
    planningCheckpointStore:checkpoints,
    operationalRecovery,
    /**
     * Owner provisions the Coordinator, reviewGate, Gitea snapshot,
     * scoped preliminary root, read-only ADK Planner, Gateway and journals.
     * A paid model MAY be invoked by this explicit start call; operator
     * must separately authorize charges and provide a model/config.
     * Neither workflow_dispatch nor model code can invoke this API.
     */
    start:async planning=>{
      if(attempted)
        throw Error("Configured Engineer owner bootstrap is single-use");
      attempted=true; // reserve before any async Planning or root effect
      if(!planning||typeof planning!=="object"||
         planning.checkpointStore!==checkpoints||
         planning.coordinator?.phase!=="idle"||
         planning.reviewPlanFile!==undefined&&
           planning.reviewPlanFile!==reviewFile)
        throw Error("Configured Engineer owner requires original idle Planning and checkpoint identity");
      // No operator can substitute a different plan.json, backend
      // verification key, or persistent recovery store after the
      // protected configuration has been successfully loaded.
      return startOwnerControlledEngineerReviewHost({
        planning:{...planning,reviewPlanFile:reviewFile},
        host:{...config,operationalRecovery}
      });
    }
  });
}
