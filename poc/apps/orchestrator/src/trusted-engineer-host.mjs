/**
 * Single-process Engineer host for manual OIDC admission and
 * independent human Ed25519 plan approval. No model or operational root is
 * started by this host. Only the OIDC admission listener may use an
 * explicitly configured private IPv4 mTLS interface; the Engineer UI ALWAYS
 * stays on loopback. No network service is deployed by this module.
 *
 * Security boundaries remain separate:
 *  1. Signed GitHub job + live Actions run -> one-use authenticated admission
 *  2. Engineer login + CSRF + protected signing key -> signed plan approval
 *  3. A live trusted Coordinator/checkpoint/receipt -> optional in-process
 *     handoff (never callable over either HTTP service).
 */
import {lstat} from "node:fs/promises";
import {createTrustedReviewedHandoffLifecycle}
  from "./trusted-reviewed-handoff-lifecycle.mjs";
import {resolve} from "node:path";
import {TrustedOperationalRecoveryStore,reconcileOrphanedOperationalRoots}
  from "../../../packages/orchestrator-runtime/src/trusted-operational-recovery-store.ts";
import {TrustedPlanningRecoveryStore,reconcileOrphanedPlanningRoots}
  from "../../../packages/orchestrator-runtime/src/trusted-planning-recovery-store.ts";
import {TrustedExecutionCoordinator}
  from "../../../packages/orchestrator-runtime/src/trusted-execution-coordinator.ts";
import {startOwnerControlledPlanningReview}
  from "../../../packages/orchestrator-runtime/src/trusted-owner-planning-bootstrap.ts";
import {TrustedReviewedPlanFile}
  from "../../../packages/orchestrator-runtime/src/trusted-reviewed-plan-file.ts";
import {TrustedPlanningReviewGate}
  from "../../../packages/orchestrator-runtime/src/trusted-planning-review-gate.ts";
import {TrustedPlanIpcClient}
  from "../../gateway/src/trusted-plan-ipc.ts";
import {SoftwareEngineerAuthorityBootstrap}
  from "../../../packages/orchestrator-runtime/src/authority-client.ts";
import {createAuthenticatedEngineerServer}
  from "./engineer-approval-server.mjs";
import {SignedPlanningCheckpointFileStore}
  from "../../../packages/orchestrator-runtime/src/trusted-planning-checkpoint-store.ts";
import {GithubOidcReplayFileStore}
  from "../../../packages/orchestrator-runtime/src/trusted-github-oidc-replay-store.ts";
import {TrustedGithubAdmissionReceiptStore}
  from "../../../packages/orchestrator-runtime/src/trusted-github-admission-store.ts";
import {startTrustedGithubOidcIntakeServer}
  from "../../../packages/orchestrator-runtime/src/trusted-github-oidc-intake.ts";
import {consumePinnedGithubAdmission,startAdmittedGithubReviewedGeminiHandoff}
  from "../../../packages/orchestrator-runtime/src/trusted-admitted-github-handoff.ts";

function deny(reason){throw Error("Trusted Engineer local host: "+reason);}
async function privateDirectory(path){
  if(typeof path!=="string"||!path.trim())deny("missing persistent directory");
  const stat=await lstat(path);
  if(!stat.isDirectory()||stat.isSymbolicLink()||
     (stat.mode&0o077)!==0||
     (typeof process.getuid==="function"&&stat.uid!==process.getuid()))
    deny("host directories must be owner-owned, non-symlink and mode 0700");
}
function port(value){
  return Number.isSafeInteger(value)&&value>=0&&value<=65535;
}
async function listen(server,selectedPort){
  await new Promise((ok,fail)=>{
    server.once("error",fail);
    server.listen(selectedPort,"127.0.0.1",()=>{
      server.removeListener("error",fail);
      ok();
    });
  });
  const address=server.address();
  if(!address||typeof address==="string")
    deny("Engineer approval listener did not bind to loopback");
  return "http://127.0.0.1:"+address.port;
}
async function shutdown(server){
  if(!server.listening)return;
  await new Promise((ok,fail)=>server.close(error=>error?fail(error):ok()));
}

/**
 * Dependencies can be provided by a trusted in-process bootstrap, never an
 * HTTP request. In production the host must persist the session/root and
 * expose an independently authenticated transport to receive GitHub OIDC;
 * loopback endpoints alone are not reachable by GitHub-hosted runners.
 */
export async function startTrustedEngineerLocalHost(config){
  const approval=config?.approval,oidc=config?.oidc;
  if(!approval||!oidc||!approval.expectedSessionId||
     !oidc.pinned?.sourceSha||!oidc.pinned?.repository||!oidc.pinned?.ref||
     !port(config.approvalPort??0)||!port(config.oidcPort??0)||
     !Buffer.isBuffer(oidc.hmacSecret)||
     oidc.hmacSecret.length<32||oidc.hmacSecret.length>128)
    deny("independently pinned approval/OIDC config and strong secret required");
  // In particular, Gitea Planning base SHA and GitHub workflow source SHA
  // have different identities; neither is derived from the other.
  const recovery=config?.recovery;
  const active=config?.activePlanning;
  if(active!==undefined&&(
     !(active.coordinator instanceof TrustedExecutionCoordinator)||
     !(active.planningRecovery instanceof TrustedPlanningRecoveryStore)||
     !(active.checkpointStore instanceof SignedPlanningCheckpointFileStore)||
     active.checkpointStore!==approval.planningCheckpointStore||
     (active.reviewGate!==undefined&&
       !(active.reviewGate instanceof TrustedPlanningReviewGate))||
     (active.operationalRecovery!==undefined&&
       !(active.operationalRecovery instanceof TrustedOperationalRecoveryStore))||
     !recovery?.planning?.directory))
    deny("live Planning requires same-process Coordinator, journal and signed checkpoint");
  const directories=[
    oidc.replayDirectory,oidc.admissionDirectory,approval.receiptDirectory,
    ...(recovery?[recovery.directory]:[]),
    ...(recovery?.planning?[recovery.planning.directory]:[])
  ];
  if(directories.some(x=>typeof x!=="string"||!x.trim())||
     new Set(directories.map(dir=>resolve(dir))).size!==directories.length)
    deny("separate owner-only replay/admission/Engineer directories required");
  for(const dir of directories)await privateDirectory(dir);
  // Reconcile BEFORE creating/listening on the Engineer UI or GitHub OIDC
  // intake. No old approval may be served while an orphan root is uncertain.
  let operationalRecoveryStore,planningRecoveryStore;
  if(recovery?.planning){
    if(typeof recovery.planning.gateway?.retirePlanning!=="function"||
       typeof recovery.planning.credentials?.revokeRoot!=="function")
      deny("trusted Gateway Planning retirement and Rust revocation required");
    if(active){
      // This path is ONLY for the actual still-active Coordinator in the
      // same process, not a restart. An orphan from a previous process
      // cannot be promoted to active by replaying its journal contents.
      active.coordinator.assertPlanningRecoveryStore(active.planningRecovery);
      active.planningRecovery.assertDirectory(recovery.planning.directory);
      const root=active.coordinator.trustedPlanningAuthority();
      const pending=await active.planningRecovery.pending();
      if(root.session_id!==approval.expectedSessionId||
         root.base_revision!==approval.expectedBaseRevision||
         pending.length!==1||
         pending[0].session_id!==root.session_id||
         pending[0].base_revision!==root.base_revision||
         pending[0].credential_id!==root.credential_id)
        deny("live Planning Coordinator does not match exclusive durable intent");
      // Independently verify the backend signature one more time before UI.
      const signed=await active.checkpointStore.load();
      if(signed.snapshot.session_id!==root.session_id||
         signed.snapshot.base_revision!==root.base_revision||
         JSON.stringify(signed.snapshot.repository)!==
           JSON.stringify(approval.repository))
        deny("active Planning checkpoint disagrees with owner-pinned session");
      planningRecoveryStore=active.planningRecovery;
    }else{
      planningRecoveryStore=new TrustedPlanningRecoveryStore(recovery.planning.directory);
      // Cold restart never resumes old provisional authority or consent.
      await reconcileOrphanedPlanningRoots({
        store:planningRecoveryStore,
        gateway:recovery.planning.gateway,
        credentials:recovery.planning.credentials
      });
      await planningRecoveryStore.assertFreshSession(approval.expectedSessionId);
    }
  }
  if(recovery){
    if(active?.operationalRecovery){
      active.coordinator.assertOperationalRecoveryStore(active.operationalRecovery);
      active.operationalRecovery.assertDirectory(recovery.directory);
    }
    if(typeof recovery.gateway?.retireSession!=="function"||
       typeof recovery.credentials?.revokeRoot!=="function")
      deny("trusted Gateway retirement and Rust Adapter revocation required");
    // An active Coordinator must keep ITS original operational journal:
    // allocating a second instance makes later handoff impossible.
    operationalRecoveryStore=active?.operationalRecovery??
      new TrustedOperationalRecoveryStore(recovery.directory);
    await reconcileOrphanedOperationalRoots({
      store:operationalRecoveryStore,gateway:recovery.gateway,
      credentials:recovery.credentials
    });
    await operationalRecoveryStore.assertFreshSession(approval.expectedSessionId);
  }
  const replayStore=new GithubOidcReplayFileStore(oidc.replayDirectory);
  const admissionStore=new TrustedGithubAdmissionReceiptStore({
    directory:oidc.admissionDirectory,hmacSecret:oidc.hmacSecret,
    expectedSessionId:approval.expectedSessionId
  });
  const engineerServer=await createAuthenticatedEngineerServer({
    ...approval,host:"127.0.0.1"
  });
  let engineerUrl,oidcIntake;
  try{
    engineerUrl=await listen(engineerServer,config.approvalPort??0);
    oidcIntake=await startTrustedGithubOidcIntakeServer({
      pinned:oidc.pinned,trust:oidc.trust,
      githubApiToken:oidc.githubApiToken,
      replayStore,admissionStore,
      githubApiFetchFn:oidc.githubApiFetchFn,
      oidcJwksFetchFn:oidc.oidcJwksFetchFn,
      port:config.oidcPort??0,tls:oidc.tls,
      bindAddress:oidc.bindAddress
    });
  }catch(error){
    await shutdown(engineerServer);
    throw error;
  }
  const fixedPins=Object.freeze({
    sessionId:approval.expectedSessionId,
    sourceSha:oidc.pinned.sourceSha,
    repository:oidc.pinned.repository,
    ref:oidc.pinned.ref
  });
  let closed=false,shutdownPromise;
  const handoff=createTrustedReviewedHandoffLifecycle(trusted=>
    startAdmittedGithubReviewedGeminiHandoff(trusted));
  return Object.freeze({
    engineerUrl,
    oidcAdmissionEndpoint:oidcIntake.endpoint,
    /** Trusted process reference only, never returned by HTTP. */
    operationalRecoveryStore,
    planningRecoveryStore,
    /** Does NOT imply human approval; read-only, one-use status only. */
    consumeAuthenticatedRun(runId){
      if(closed)deny("host closed");
      return consumePinnedGithubAdmission({
        admissionStore,pins:{...fixedPins,runId}
      });
    },
    /** Trusted in-process call ONLY: never registered as an HTTP endpoint. */
    startReviewedHandoff({runId,...trusted}){
      if(closed)deny("host closed");
      if(active&&(trusted.coordinator!==active.coordinator||
         active.coordinator.phase!=="planning"||
         (active.reviewGate&&trusted.reviewGate!==active.reviewGate)||
         trusted.checkpointStore!==active.checkpointStore))
        deny("reviewed Execution must use original active Planning Coordinator, review gate and checkpoint");
      // Legacy test-only Engineer hosts can accept local OIDC, but cannot
      // activate an operational DC without startup crash reconciliation.
      if(!operationalRecoveryStore)
        deny("startup operational recovery mandatory for reviewed handoff");
      if(typeof trusted.coordinator?.assertOperationalRecoveryStore!=="function")
        deny("trusted Coordinator recovery journal required");
      trusted.coordinator.assertOperationalRecoveryStore(operationalRecoveryStore);
      return handoff.start({
        ...trusted,admissionStore,pins:{...fixedPins,runId},
        // Host configuration wins over every in-process caller argument.
        githubApiToken:oidc.githubApiToken,
        githubApiFetchFn:oidc.githubApiFetchFn,
        expectedWorkflowPath:oidc.pinned.workflowPath
      });
    },
    close(){
      if(shutdownPromise)return shutdownPromise;
      closed=true;
      shutdownPromise=(async()=>{
        // Crucial: the host must own the operational root lifetime, even
        // if SIGTERM races ongoing Gemini/A2A server startup. Never report
        // clean shutdown while a delegated root may remain live.
        const results=await Promise.allSettled([
          handoff.close(),oidcIntake.close(),shutdown(engineerServer)
        ]);
        // The signed plan may have been reviewed without an admitted
        // Execution. Closing the host must not leave that read-only root
        // alive. Wait until any concurrently starting handoff finishes
        // before attempting Planning cancellation, avoiding phase races.
        if(active){
          const phase=active.coordinator.phase;
          if(phase==="planning"){
            const result=await Promise.allSettled([
              active.coordinator.closePlanning()
            ]);
            results.push(...result);
          }else if(phase!=="closed"){
            results.push({status:"rejected",reason:Error(
              "live Planning/Execution authority has no confirmed closure")});
          }
        }
        if(results.some(r=>r.status==="rejected"))
          deny("Engineer shutdown incomplete: operational or preliminary root revocation or listener teardown unconfirmed; manual reconciliation required");
      })();
      return shutdownPromise;
    }
  });
}


/**
 * Strict real-service bootstrap. Connect to the owner-only HMAC IPC Gateway,
 * construct the actual Adapter revocation client, reconcile on disk, and
 * ONLY THEN expose Engineer UI (loopback) and the chosen pinned mTLS
 * OIDC admission interface. Private network routing, firewall isolation,
 * persistent deployment and a live Planning root remain prerequisites.
 */
async function strictRecoveringHost(config){
  // The permissive loopback HTTP admission mode exists only for unit
  // fixtures. A recovering Engineer host is an operational entrypoint:
  // require mutually authenticated TLS and one trusted runner leaf pin
  // before connecting Gateway IPC or exposing any host listener.
  if(!config?.oidc?.tls?.cert||!config.oidc.tls.key||
     !config.oidc.tls.ca||
     !/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/u
       .test(config.oidc.tls.expectedClientFingerprint256??""))
    deny("operational Engineer host requires pinned mutual TLS admission");
  // The lower-level recovering bootstrap is also callable directly by an
  // operator process. It MUST enforce the same independent backend Planning
  // provenance as the strict on-disk configuration loader. Never let this
  // path silently fall back to a raw trustedPlanFile or test-only UI mode.
  const checkpointStore=config?.approval?.planningCheckpointStore;
  if(!(checkpointStore instanceof SignedPlanningCheckpointFileStore))
    deny("operational Engineer host requires verified backend-signed Planning checkpoint");
  let verified;
  try{verified=await checkpointStore.load();}
  catch{deny("operational Engineer host requires valid backend-signed Planning checkpoint");}
  if(verified.snapshot.session_id!==config.approval.expectedSessionId||
     verified.snapshot.base_revision!==config.approval.expectedBaseRevision||
     JSON.stringify(verified.snapshot.repository)!==
       JSON.stringify(config.approval.repository))
    deny("backend-signed Planning checkpoint differs from pinned Engineer session");
  const recovery=config?.recovery;
  if(!recovery||typeof recovery.directory!=="string"||
     typeof recovery.planningDirectory!=="string"||
     recovery.planningDirectory===recovery.directory||
     typeof recovery.gatewaySocketPath!=="string"||
     typeof recovery.gatewaySecretFile!=="string"||
     typeof recovery.adapterBaseUrl!=="string"||
     typeof recovery.adapterToken!=="string"||!recovery.adapterToken.trim())
    deny("complete trusted recovery IPC and Adapter configuration required");
  let adapterUrl;
  try{adapterUrl=new URL(recovery.adapterBaseUrl);}
  catch{deny("invalid trusted Adapter URL");}
  if(!((adapterUrl.protocol==="https:"&&!adapterUrl.username&&!adapterUrl.password)||
       (adapterUrl.protocol==="http:"&&
        adapterUrl.hostname==="127.0.0.1"&&
        !adapterUrl.username&&!adapterUrl.password)))
    deny("Adapter must use HTTPS or loopback HTTP");
  await privateDirectory(recovery.planningDirectory);
  const gateway=await TrustedPlanIpcClient.connect({
    socketPath:recovery.gatewaySocketPath,
    secretFile:recovery.gatewaySecretFile
  });
  if(!gateway.operationalLeaseConfigured())
    deny("private Gateway must enforce its own operational lease");
  if(!gateway.planningRetirementConfigured())
    deny("private Gateway must expose actual Planning registry retirement");
  if(!gateway.planningRetirementDurableConfigured())
    deny("private Gateway must persist Planning retirement across restarts");
  const credentials=new SoftwareEngineerAuthorityBootstrap({
    adapterBaseUrl:recovery.adapterBaseUrl,bearerToken:recovery.adapterToken
  });
  return startTrustedEngineerLocalHost({
    ...config,recovery:{
      directory:recovery.directory,gateway,credentials,
      planning:{directory:recovery.planningDirectory,gateway,credentials}
    }
  });
}

/**
 * Production entrypoint for an ALREADY ACTIVE same-process Planning session.
 * Unlike cold recovery, this caller owns a live root and MUST cancel it if
 * host bootstrap fails at any stage (TLS, IPC, checkpoint or listener).
 *
 * A killed process is still recovered through the independent durable
 * Gateway/Engineer journals; no in-memory coordinator is reconstructed
 * from a file or untrusted GitHub input.
 */
/**
 * Preserve the existing cold-recovery API. An explicitly supplied live
 * Coordinator must ALWAYS use the startup-failure cleanup wrapper; no
 * operator code path can accidentally bypass preliminary-root revocation.
 */
export async function startTrustedEngineerRecoveringHost(config){
  return config?.activePlanning
    ?startTrustedEngineerLivePlanningHost(config)
    :strictRecoveringHost(config);
}

export async function startTrustedEngineerLivePlanningHost(config){
  const active=config?.activePlanning;
  if(!(active?.coordinator instanceof TrustedExecutionCoordinator))
    deny("live Planning startup requires the original Coordinator");
  try{
    // Once the trusted caller has passed the ACTUAL live Coordinator,
    // every later validation failure is a startup failure which must
    // revoke that Coordinator's preliminary root. Never check other
    // configuration fields outside the cleanup try/catch.
    if(!(active.planningRecovery instanceof TrustedPlanningRecoveryStore)||
       !(active.checkpointStore instanceof SignedPlanningCheckpointFileStore)||
       active.checkpointStore!==config?.approval?.planningCheckpointStore)
      deny("live Planning startup requires matching journal and signed provenance");
    return await strictRecoveringHost(config);
  }catch(error){
    // The process still owns this root and has not returned a live host.
    // Retire immediately; an uncertain Adapter/Gateway result remains on
    // disk and MUST prevent retries.
    if(active.coordinator.phase==="planning"){
      try{await active.coordinator.closePlanning();}
      catch(revocationError){
        throw Error("Trusted Engineer live Planning startup: preliminary root closure unconfirmed; manual reconciliation required",
          {cause:revocationError});
      }
    }else if(active.coordinator.phase!=="closed"){
      throw Error("Trusted Engineer live Planning startup: root state uncertain; manual reconciliation required",
        {cause:error});
    }
    throw error;
  }
}

/**
 * Owner-only SAME-PROCESS handoff from the real read-only Planning bootstrap
 * to the persistent, authenticated Engineer host.
 *
 * This is a private owner API, never an HTTP/GitHub/A2A/MCP handler.
 * It DOES invoke the caller-supplied ADK model during Planning, so it must
 * only be invoked by the operator after explicitly choosing a model and
 * approving any provider cost. Tests inject a scripted, zero-cost model.
 * There is NO automatic Engineer approval, OIDC admission or Execution.
 *
 * Reject mismatched file paths, journal identities, session/SHA and backend
 * checkpoints BEFORE provisional root issuance. Once Planning starts, every
 * failed service bootstrap must attempt confirmed revocation.
 */
export async function startOwnerControlledEngineerReviewHost({planning,host}={}){
  const snapshot=planning?.snapshot;
  const approval=host?.approval;
  const recovery=host?.recovery;
  const coordinator=planning?.coordinator;
  if(!(coordinator instanceof TrustedExecutionCoordinator)||
     !(planning?.reviewPlanFile instanceof TrustedReviewedPlanFile)||
     !(planning?.reviewGate instanceof TrustedPlanningReviewGate)||
     !(planning?.planningRecovery instanceof TrustedPlanningRecoveryStore)||
     !(planning?.checkpointStore instanceof SignedPlanningCheckpointFileStore)||
     !(host?.operationalRecovery instanceof TrustedOperationalRecoveryStore)||
     host?.activePlanning!==undefined||
     !snapshot||!approval||!recovery||
     approval.planningCheckpointStore!==planning.checkpointStore||
     approval.expectedSessionId!==snapshot.session_id||
     approval.expectedBaseRevision!==snapshot.base_revision||
     JSON.stringify(approval.repository)!==JSON.stringify(snapshot.repository))
    deny("owner Planning and Engineer session pins must be identical");
  // All these validations are synchronous and happen BEFORE calling the
  // owner Planning bootstrap (which would issue the provisional credential).
  planning.reviewPlanFile.assertCheckpointStore(planning.checkpointStore);
  planning.reviewPlanFile.assertFilePath(approval.trustedPlanFile);
  planning.planningRecovery.assertDirectory(recovery.planningDirectory);
  coordinator.assertPlanningRecoveryStore(planning.planningRecovery);
  host.operationalRecovery.assertDirectory(recovery.directory);
  coordinator.assertOperationalRecoveryStore(host.operationalRecovery);
  if(coordinator.phase!=="idle")
    deny("owner Planning Coordinator must be unused");
  // If the Planner fails it invokes closePlanning itself. If it completes
  // and Engineer host startup later fails, the strict wrapper closes it.
  await startOwnerControlledPlanningReview(planning);
  return startTrustedEngineerLivePlanningHost({
    ...host,
    activePlanning:{
      coordinator,
      planningRecovery:planning.planningRecovery,
      operationalRecovery:host.operationalRecovery,
      checkpointStore:planning.checkpointStore,
      reviewGate:planning.reviewGate
    }
  });
}
