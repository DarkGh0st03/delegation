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
import {TrustedPlanIpcClient}
  from "../../gateway/src/trusted-plan-ipc.ts";
import {SoftwareEngineerAuthorityBootstrap}
  from "../../../packages/orchestrator-runtime/src/authority-client.ts";
import {createAuthenticatedEngineerServer}
  from "./engineer-approval-server.mjs";
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
  const directories=[
    oidc.replayDirectory,oidc.admissionDirectory,approval.receiptDirectory,
    ...(recovery?[recovery.directory]:[])
  ];
  if(directories.some(x=>typeof x!=="string"||!x.trim())||
     new Set(directories.map(dir=>resolve(dir))).size!==directories.length)
    deny("separate owner-only replay/admission/Engineer directories required");
  for(const dir of directories)await privateDirectory(dir);
  // Reconcile BEFORE creating/listening on the Engineer UI or GitHub OIDC
  // intake. No old approval may be served while an orphan root is uncertain.
  let operationalRecoveryStore;
  if(recovery){
    if(typeof recovery.gateway?.retireSession!=="function"||
       typeof recovery.credentials?.revokeRoot!=="function")
      deny("trusted Gateway retirement and Rust Adapter revocation required");
    operationalRecoveryStore=new TrustedOperationalRecoveryStore(recovery.directory);
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
        if(results.some(r=>r.status==="rejected"))
          deny("Engineer shutdown incomplete: operational root revocation or listener teardown unconfirmed; manual reconciliation required");
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
export async function startTrustedEngineerRecoveringHost(config){
  // The permissive loopback HTTP admission mode exists only for unit
  // fixtures. A recovering Engineer host is an operational entrypoint:
  // require mutually authenticated TLS and one trusted runner leaf pin
  // before connecting Gateway IPC or exposing any host listener.
  if(!config?.oidc?.tls?.cert||!config.oidc.tls.key||
     !config.oidc.tls.ca||
     !/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/u
       .test(config.oidc.tls.expectedClientFingerprint256??""))
    deny("operational Engineer host requires pinned mutual TLS admission");
  const recovery=config?.recovery;
  if(!recovery||typeof recovery.directory!=="string"||
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
  const gateway=await TrustedPlanIpcClient.connect({
    socketPath:recovery.gatewaySocketPath,
    secretFile:recovery.gatewaySecretFile
  });
  if(!gateway.operationalLeaseConfigured())
    deny("private Gateway must enforce its own operational lease");
  const credentials=new SoftwareEngineerAuthorityBootstrap({
    adapterBaseUrl:recovery.adapterBaseUrl,bearerToken:recovery.adapterToken
  });
  return startTrustedEngineerLocalHost({
    ...config,recovery:{directory:recovery.directory,gateway,credentials}
  });
}
