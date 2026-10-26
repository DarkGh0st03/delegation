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
       "approval","oidc","recovery","approvalPort","oidcPort",
       "scriptedOidc","scriptedOidcPort"
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
  const scripted=source.scriptedOidc;
  if(scripted&&(
     !allowedKeys(scripted,[
       "pinned","trust","replayDirectory","admissionDirectory",
       "bindAddress","githubApiTokenFile","hmacSecretHexFile","tls"
     ])||
     !allowedKeys(scripted.tls,[
       "caFile","certFile","keyFile","expectedClientFingerprint256"
     ])||
     !allowedKeys(scripted.pinned,[
       "repository","ref","workflowPath","sourceSha"
     ])||
     !allowedKeys(scripted.trust,[
       "expectedAudience","expectedSubject",
       "expectedRepositoryId","expectedOwnerId"
     ])||
     scripted.pinned.workflowPath!==
       ".github/workflows/trusted-scripted-offline-session-hold.yml"||
     scripted.pinned.repository!==oidc.pinned.repository||
     scripted.pinned.ref!==oidc.pinned.ref||
     scripted.pinned.sourceSha!==oidc.pinned.sourceSha||
     scripted.trust.expectedAudience===oidc.trust.expectedAudience))
    denied();
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
    recovery.adapterTokenFile,recovery.gatewaySecretFile,
    ...(scripted?[scripted.githubApiTokenFile,
      scripted.hmacSecretHexFile,scripted.tls.caFile,
      scripted.tls.certFile,scripted.tls.keyFile]:[])
  ];
  if(requiredPaths.some(v=>typeof v!=="string"))denied();
  // Local signing key, plan, approval and recovery journal cannot be
  // replaced by external workflow inputs or a model.
  const directories=[
    approval.receiptDirectory,approval.checkpoint.directory,
    oidc.replayDirectory,oidc.admissionDirectory,
    recovery.directory,recovery.planningDirectory,
    ...(scripted?[scripted.replayDirectory,scripted.admissionDirectory]:[])
  ];
  for(const p of directories)await ownedPrivateDir(p);
  if(new Set(directories).size!==directories.length)denied();
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
    githubApiToken,hmacHex,ca,cert,key,adapterToken,gatewaySecret,
    scriptedGithubToken,scriptedMacHex,scriptedCa,scriptedCert,
    scriptedKey]=reads;
  if(scripted&&(
     typeof scriptedGithubToken!=="string"||
     scriptedGithubToken.trim().length<8||
     scriptedGithubToken.trim().length>4096||
     !/^[a-f0-9]{64,256}$/iu.test(scriptedMacHex?.trim()??"")||
     scriptedMacHex.trim().length%2!==0||
     scriptedMacHex.trim().toLowerCase()===hmacHex.trim().toLowerCase()||
     !scriptedCa.includes("BEGIN CERTIFICATE")||
     !scriptedCert.includes("BEGIN CERTIFICATE")||
     !scriptedKey.includes("BEGIN")||
     !/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/u
       .test(scripted.tls.expectedClientFingerprint256??"")))
    denied();
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
    // Private owner bootstrap only: signer PUBLIC key and the exact
    // work branch must come from the same 0600 config read as the Host.
    ownerPlanning:{
      backendKeyId:checkpoint.backendKeyId,
      backendPublicKeyPem:backendPublicKey,
      expectedWorkBranch:checkpoint.expectedWorkBranch
    },
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
    oidcPort:source.oidcPort??0,
    ...(scripted?{
      scriptedOidc:{
        pinned:scripted.pinned,trust:scripted.trust,
        replayDirectory:scripted.replayDirectory,
        admissionDirectory:scripted.admissionDirectory,
        ...(scripted.bindAddress?{bindAddress:scripted.bindAddress}:{}),
        githubApiToken:scriptedGithubToken.trim(),
        hmacSecret:Buffer.from(scriptedMacHex.trim(),"hex"),
        tls:{
          ca:scriptedCa,cert:scriptedCert,key:scriptedKey,
          expectedClientFingerprint256:
            scripted.tls.expectedClientFingerprint256
        }
      },
      scriptedOidcPort:source.scriptedOidcPort??0
    }:{})
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
export async function prepareConfiguredOwnerEngineerBootstrap(
  configPath,{operationalRecovery:originalRecovery,
    expectedScriptedSourceSha,expectedLiveSourceSha}={}
){
  const config=await loadTrustedEngineerServiceConfig(configPath,{
    pendingPlanningOutput:true
  });
  // Live-owner source identity must match the same protected settings
  // passed to the Engineer Host, not a separate untrusted preflight read.
  if(expectedLiveSourceSha!==undefined){
    if(expectedScriptedSourceSha!==undefined||
       typeof expectedLiveSourceSha!=="string"||
       !/^[a-f0-9]{40}$/u.test(expectedLiveSourceSha)||
       config.oidc.pinned.sourceSha!==expectedLiveSourceSha)
      throw Error("Configured Gemini owner source SHA does not match protected OIDC pin");
  }
  // R5 must validate the SAME protected config object that this bootstrap
  // hands to the original Coordinator and persistent Engineer Host. An
  // earlier external preflight could have checked a different file version.
  // This is still read-only and happens BEFORE Planning/root issuance.
  if(expectedScriptedSourceSha!==undefined){
    const {verifyR5ScriptedEngineerHostReadiness}=await import(
      "../../../scripts/r5-scripted-host-deployment-preflight.mjs");
    verifyR5ScriptedEngineerHostReadiness(config,{
      expectedSourceSha:expectedScriptedSourceSha
    });
  }
  const checkpoints=config.approval.planningCheckpointStore;
  // When the owner already constructed a Coordinator with a recovery
  // journal, reuse THAT EXACT INSTANCE. A second object pointed at the
  // same on-disk directory is not an authenticated authority handoff.
  const operationalRecovery=originalRecovery===undefined
    ?new TrustedOperationalRecoveryStore(config.recovery.directory)
    :originalRecovery;
  if(!(operationalRecovery instanceof TrustedOperationalRecoveryStore))
    throw Error("Configured Engineer owner requires authentic recovery journal");
  operationalRecovery.assertDirectory(config.recovery.directory);
  const reviewFile=new TrustedReviewedPlanFile({
    filePath:config.approval.trustedPlanFile,
    checkpointStore:checkpoints
  });
  let attempted=false,geminiAssembled=false,geminiPlanning;
  return Object.freeze({
    planningCheckpointStore:checkpoints,
    operationalRecovery,
    ...(expectedScriptedSourceSha===undefined?{
      // Owner-selected, zero-inference assembly. Only the explicit
      // subsequent start(planning) may invoke a potentially billable model.
      // This never consumes a GitHub event or authenticates human approval.
      assembleGeminiPlanning:async input=>{
        if(attempted||geminiAssembled)
          throw Error("Configured Gemini owner Planning assembly is single-use");
        geminiAssembled=true;
        const {assembleProtectedOwnerGeminiPlanning}=await import(
          "./trusted-r5-scripted-owner-assembly.mjs");
        const assembly=await assembleProtectedOwnerGeminiPlanning({
          ...input,config,planningCheckpointStore:checkpoints,
          operationalRecovery
        });
        // Original trusted Coordinator + model provenance cannot be
        // substituted between consented assembly and Planning execution.
        geminiPlanning=assembly.planning;
        return assembly;
      }
    }:{}),
    ...(expectedScriptedSourceSha===undefined?{}:{
      assembleR5Planning:async input=>{
        const {assembleProtectedR5ScriptedOwnerPlanning}=await import(
          "./trusted-r5-scripted-owner-assembly.mjs");
        return assembleProtectedR5ScriptedOwnerPlanning({
          ...input,config,planningCheckpointStore:checkpoints,
          operationalRecovery
        });
      }
    }),
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
      if((geminiAssembled&&planning!==geminiPlanning)||
         !planning||typeof planning!=="object"||
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


/**
 * Dedicated R5 source-pinned owner Planning entrypoint.
 *
 * Unlike the general owner bootstrap, the R5 variant cannot silently omit
 * matching the protected scripted OIDC profile, mTLS and GitHub source SHA.
 * It still does not create a Coordinator, execute Planning, select a model
 * or approve an Engineer plan. The owner must construct the original
 * read-only Planning dependencies and explicitly invoke the returned
 * single-use start(planning) with a non-billable scripted model for R5.
 */
export async function prepareConfiguredR5ScriptedEngineerBootstrap(
  configPath,{expectedSourceSha,operationalRecovery}={}
){
  if(typeof expectedSourceSha!=="string"||
     !/^[a-f0-9]{40}$/u.test(expectedSourceSha))
    throw Error("R5 scripted owner source SHA pin required");
  const prepared=await prepareConfiguredOwnerEngineerBootstrap(configPath,{
    expectedScriptedSourceSha:expectedSourceSha,
    ...(operationalRecovery===undefined?{}:{operationalRecovery})
  });
  // R5 is a ZERO-BILLING infrastructure exercise, not an unrestricted
  // operator-model selection. An arbitrary BaseLlm may silently reach a
  // paid endpoint during Planning BEFORE the Engineer can approve anything.
  // Admit only the dedicated bounded, owner-intent scripted ADK model.
  const {isBoundR5NoProviderPlanningModel}=await import(
    "../../../packages/orchestrator-runtime/src/trusted-r5-scripted-planning-model.ts");
  let attempted=false,assembled=false,assembledPlanning;
  return Object.freeze({
    planningCheckpointStore:prepared.planningCheckpointStore,
    operationalRecovery:prepared.operationalRecovery,
    /** One attempt to assemble the real original Coordinator. No authority
     * is issued; only the authenticated local Gateway capabilities are read. */
    assemblePlanning:async input=>{
      if(assembled||attempted)
        throw Error("R5 scripted owner assembly is single-use");
      assembled=true;
      const bound=await prepared.assembleR5Planning(input);
      assembledPlanning=bound.planning;
      return bound;
    },
    start:async planning=>{
      if(attempted)
        throw Error("R5 scripted owner Planning is single-use");
      attempted=true; // reserve before any possible provider/root effect
      if(!assembledPlanning||planning!==assembledPlanning)
        throw Error("R5 scripted owner requires its original assembled Planning input");
      if(!planning||typeof planning!=="object"||
         !isBoundR5NoProviderPlanningModel(
           planning.planner?.model,planning.snapshot,
           planning.planner?.workBranch
         )||planning.planner?.snapshot!==planning.snapshot)
        throw Error("R5 scripted owner requires bounded no-provider Planning model tied to the original snapshot");
      return prepared.start(planning);
    }
  });
}
