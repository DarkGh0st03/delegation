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
import {createTrustedApprovedBranchGateway}
  from "../../../packages/orchestrator-runtime/src/trusted-approved-branch-gateway.ts";
import {createTrustedApprovedTaskAuthorityAllocator}
  from "../../../packages/orchestrator-runtime/src/trusted-approved-task-authority.ts";
import {assertTrustedApprovedA2AStartup}
  from "../../../packages/orchestrator-runtime/src/trusted-a2a-startup-probe.ts";
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
import {TrustedScriptedGithubAdmissionStore}
  from "../../../packages/orchestrator-runtime/src/trusted-scripted-github-admission.ts";
import {startTrustedScriptedGithubOidcIntakeServer}
  from "../../../packages/orchestrator-runtime/src/trusted-scripted-github-oidc-intake.ts";
import {startAdmittedGithubReviewedScriptedHandoff}
  from "../../../packages/orchestrator-runtime/src/trusted-admitted-scripted-handoff.ts";
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
  const approval=config?.approval,oidc=config?.oidc,
    scripted=config?.scriptedOidc;
  if(!approval||!oidc||!approval.expectedSessionId||
     !oidc.pinned?.sourceSha||!oidc.pinned?.repository||!oidc.pinned?.ref||
     !port(config.approvalPort??0)||!port(config.oidcPort??0)||
     !Buffer.isBuffer(oidc.hmacSecret)||
     oidc.hmacSecret.length<32||oidc.hmacSecret.length>128)
    deny("independently pinned approval/OIDC config and strong secret required");
  // The optional no-charge listener has independently pinned OIDC
  // and disjoint durable state. It cannot consume a paid receipt.
  if(scripted&&(
     scripted.pinned?.workflowPath!==
       ".github/workflows/trusted-scripted-offline-session-hold.yml"||
     scripted.pinned.repository!==oidc.pinned.repository||
     scripted.pinned.ref!==oidc.pinned.ref||
     scripted.pinned.sourceSha!==oidc.pinned.sourceSha||
     scripted.trust?.expectedAudience===oidc.trust?.expectedAudience||
     !scripted.githubApiToken?.trim()||
     !scripted.tls||
     !port(config.scriptedOidcPort??0)||
     !Buffer.isBuffer(scripted.hmacSecret)||
     scripted.hmacSecret.length<32||scripted.hmacSecret.length>128||
     scripted.hmacSecret.equals(oidc.hmacSecret)))
    deny("separate pinned no-charge OIDC intake configuration required");
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
    ...(scripted?[scripted.replayDirectory,scripted.admissionDirectory]:[]),
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
  // An incomplete operational issue may have granted write authority.
  // Cancel that root and tombstone its Gateway session FIRST. Only then
  // retire read-only preliminary authority. In particular, a failure to
  // confirm operational revocation prevents all listeners AND prevents any
  // misleading Planning-only "recovered" state.
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
  const replayStore=new GithubOidcReplayFileStore(oidc.replayDirectory);
  const admissionStore=new TrustedGithubAdmissionReceiptStore({
    directory:oidc.admissionDirectory,hmacSecret:oidc.hmacSecret,
    expectedSessionId:approval.expectedSessionId
  });
  const scriptedReplayStore=scripted
    ?new GithubOidcReplayFileStore(scripted.replayDirectory):undefined;
  const scriptedAdmissionStore=scripted
    ?new TrustedScriptedGithubAdmissionStore({
      directory:scripted.admissionDirectory,
      hmacSecret:scripted.hmacSecret,
      expectedSessionId:approval.expectedSessionId
    }):undefined;
  let closed=false,shutdownPromise;
  const handoff=createTrustedReviewedHandoffLifecycle(trusted=>
    startAdmittedGithubReviewedGeminiHandoff(trusted));
  const scriptedHandoff=createTrustedReviewedHandoffLifecycle(trusted=>
    startAdmittedGithubReviewedScriptedHandoff(trusted));
  // Only a private in-process owner selects the run tied to this DAG.
  let selectedRunId,selectedScriptedRunId;
  // Only the trusted host selects the real Coordinator and revocation port.
  const {
    rejectPlanning:ignoredRejectPlanning,
    planningIsActive:ignoredPlanningIsActive,
    ...fixedApproval
  }=approval;
  const engineerServer=await createAuthenticatedEngineerServer({
    ...fixedApproval,host:"127.0.0.1",
    ...(active?{
      planningIsActive:()=>!closed&&
        active.coordinator.phase==="planning",
      rejectPlanning:async()=>{
      if(closed||handoff.status!=="idle"||
         active.coordinator.phase!=="planning")
        deny("Planning rejection unavailable after handoff or shutdown");
      await active.coordinator.closePlanning();
    }}:{})
  });
  let engineerUrl,oidcIntake,scriptedIntake;
  try{
    engineerUrl=await listen(engineerServer,config.approvalPort??0);
    oidcIntake=await startTrustedGithubOidcIntakeServer({
      pinned:oidc.pinned,trust:oidc.trust,
      githubApiToken:oidc.githubApiToken,
      replayStore,admissionStore,
      githubApiFetchFn:oidc.githubApiFetchFn,
      oidcJwksFetchFn:oidc.oidcJwksFetchFn,
      port:config.oidcPort??0,tls:oidc.tls,
      bindAddress:oidc.bindAddress,
      // Read-only runner rendezvous: the trusted in-process operator
      // still exclusively controls the original signed DAG and DC root.
      // Never equate an OIDC status query with Engineer approval.
      statusForAdmittedRun:(runId)=>{
        if(closed)return "terminated";
        // An unrelated admitted GitHub run can never inherit another
        // run's signed Engineer DAG completion or verified root closure.
        if(selectedRunId&&runId!==selectedRunId)return "terminated";
        if(!selectedRunId){
          return active?.coordinator.phase==="closed"
            ?"terminated":"waiting_for_owner";
        }
        if(handoff.verifiedOutcome==="verified_complete")
          return "completed_verified";
        if(handoff.verifiedOutcome==="failed"||
           ["failed","closed"].includes(handoff.status))
          return "terminated";
        // Running a signed DAG may already have closed its root while
        // A2A listeners finish draining. A runner must not treat this
        // non-atomic teardown interval as failed Execution. The lifecycle
        // declares verified_complete only AFTER every closure succeeds.
        if(["starting","active","closing"].includes(handoff.status))
          return "execution_active";
        if(active?.coordinator.phase==="closed")return "terminated";
        return "waiting_for_owner";
      }
    });
    if(scripted){
      scriptedIntake=await startTrustedScriptedGithubOidcIntakeServer({
        pinned:scripted.pinned,trust:scripted.trust,
        githubApiToken:scripted.githubApiToken,
        replayStore:scriptedReplayStore,
        admissionStore:scriptedAdmissionStore,
        githubApiFetchFn:scripted.githubApiFetchFn,
        oidcJwksFetchFn:scripted.oidcJwksFetchFn,
        port:config.scriptedOidcPort??0,tls:scripted.tls,
        bindAddress:scripted.bindAddress,
        // A signed JWT / consumed receipt is NOT completed Engineering.
        // No private status can report success until a genuine reviewed
        // DAG and all roots have been independently confirmed retired.
        statusForAdmittedRun:(runId)=>{
          if(closed)return "terminated";
          if(selectedScriptedRunId&&runId!==selectedScriptedRunId)
            return "terminated";
          if(!selectedScriptedRunId){
            return active?.coordinator.phase==="planning"&&
              scriptedHandoff.status==="idle"
              ?"waiting_for_owner":"terminated";
          }
          if(scriptedHandoff.verifiedOutcome==="verified_complete")
            return "completed_verified";
          if(scriptedHandoff.verifiedOutcome==="failed"||
             ["failed","closed"].includes(scriptedHandoff.status))
            return "terminated";
          if(["starting","active","closing"].includes(scriptedHandoff.status))
            return "execution_active";
          return "terminated";
        }
      });
    }
  }catch(error){
    await Promise.allSettled([
      ...(oidcIntake?[oidcIntake.close()]:[]),
      shutdown(engineerServer)
    ]);
    throw error;
  }
  const fixedPins=Object.freeze({
    sessionId:approval.expectedSessionId,
    sourceSha:oidc.pinned.sourceSha,
    repository:oidc.pinned.repository,
    ref:oidc.pinned.ref
  });
  // Both operator routes enforce the SAME pinned live Coordinator,
  // verified recovery store and host-owned GitHub source/workflow pins.
  // In particular, an execution helper cannot bypass the normal handoff.
  const pinnedHandoffInput=({runId,...trusted})=>{
    if(closed)deny("host closed");
    if(active&&(trusted.coordinator!==active.coordinator||
       active.coordinator.phase!=="planning"||
       (active.reviewGate&&trusted.reviewGate!==active.reviewGate)||
       trusted.checkpointStore!==active.checkpointStore))
      deny("reviewed Execution must use original active Planning Coordinator, review gate and checkpoint");
    if(!operationalRecoveryStore)
      deny("startup operational recovery mandatory for reviewed handoff");
    if(typeof trusted.coordinator?.assertOperationalRecoveryStore!=="function")
      deny("trusted Coordinator recovery journal required");
    trusted.coordinator.assertOperationalRecoveryStore(operationalRecoveryStore);
    return {
      ...trusted,admissionStore,pins:{...fixedPins,runId},
      githubApiToken:oidc.githubApiToken,
      githubApiFetchFn:oidc.githubApiFetchFn,
      expectedWorkflowPath:oidc.pinned.workflowPath
    };
  };
  return Object.freeze({
    engineerUrl,
    oidcAdmissionEndpoint:oidcIntake.endpoint,
    ...(scriptedIntake?{
      scriptedOidcAdmissionEndpoint:scriptedIntake.endpoint
    }:{}),
    /** Trusted process reference only, never returned by HTTP. */
    operationalRecoveryStore,
    planningRecoveryStore,
    /** Does NOT imply human approval; read-only, one-use status only. */
    consumeAuthenticatedScriptedRun(runId){
      if(closed||!scriptedAdmissionStore)
        deny("no separate scripted OIDC admission available");
      return scriptedAdmissionStore.consume({
        expectedSessionId:approval.expectedSessionId,
        expectedSourceSha:scripted.pinned.sourceSha,
        expectedRunId:runId
      });
    },
    consumeAuthenticatedRun(runId){
      if(closed)deny("host closed");
      return consumePinnedGithubAdmission({
        admissionStore,pins:{...fixedPins,runId}
      });
    },
    /** Trusted in-process call ONLY: never registered as an HTTP endpoint. */
    /** Owner-only split phase for callers which need explicit dispatch. */
    startReviewedHandoff(input){
      if(selectedScriptedRunId||scriptedHandoff.status!=="idle")
        deny("scripted offline handoff already selected");
      const trusted=pinnedHandoffInput(input);
      if(selectedRunId&&selectedRunId!==input.runId)
        deny("different manual run already selected for Engineer handoff");
      selectedRunId=input.runId;
      return handoff.start(trusted);
    },
    /**
     * Canonical owner-only single invocation: admitted GitHub run, signed
     * Engineer handoff, immutable approved DAG, then trusted root closure.
     * Not an HTTP route, model tool or remotely callable OIDC endpoint.
     */
    runReviewedApprovedDag({execution,...input}){
      if(closed)deny("host closed");
      if(selectedScriptedRunId||scriptedHandoff.status!=="idle")
        deny("scripted offline handoff already selected");
      // Validate before consuming the HMAC admission or issuing a root.
      if(!execution||typeof execution!=="object"||
         typeof execution.invokeOrchestratorTask!=="function"||
         typeof execution.authorityForTask!=="function"||
         !execution.adapter||!execution.a2a)
        deny("owner-provisioned approved DAG executor required");
      const trusted=pinnedHandoffInput(input);
      if(selectedRunId&&selectedRunId!==input.runId)
        deny("different manual run already selected for Engineer execution");
      selectedRunId=input.runId;
      return handoff.runApprovedDag(trusted,execution);
    },
    /**
     * Strict canonical Execution: after the authenticated human approval,
     * issue the root through the pinned handoff, then build the ONLY
     * Orchestrator write callback from that same signed, active root.
     * Unlike runReviewedApprovedDag, the owner cannot inject a
     * model-controlled create_branch callback. Owner-supplied A2A/Adapter
     * ports and scoped task allocation stay outside HTTP, ADK and MCP.
     */
    runReviewedApprovedDagWithGateway({
      execution,privateGatewayTransport,childStatusProvisioning,...input
    }){
      if(closed)deny("host closed");
      if(selectedScriptedRunId||scriptedHandoff.status!=="idle")
        deny("scripted offline handoff already selected");
      if(!active?.reviewGate||
         active.coordinator.phase!=="planning")
        deny("original live signed Planning session required");
      if(!execution||typeof execution!=="object"||
         // Neither caller nor model may choose a new branch operation or
         // assign a child index after the signed execution has started.
         Object.hasOwn(execution,"authorityForTask")||
         Object.hasOwn(execution,"invokeOrchestratorTask")||
         typeof execution.a2a?.sendProtectedTask!=="function"||
         !execution.adapter?.adapterBaseUrl||
         !execution.adapter?.bearerToken||
         !privateGatewayTransport?.gatewayBaseUrl||
         !privateGatewayTransport?.adapterBaseUrl||
         !privateGatewayTransport?.adapterToken||
         !childStatusProvisioning?.reservationDirectory||
         !childStatusProvisioning?.statusListCredential||
         !childStatusProvisioning?.indexByTask||
         !Array.isArray(childStatusProvisioning?.excludedIndices))
        deny("private reviewed A2A/Adapter, Gateway and durable child status provisioning required");
      // The entire approved DAG is localhost-bound. Do not let an
      // operator-selected URL turn the private Adapter bearer into an
      // accidental outbound credential to an arbitrary host.
      const local=url=>typeof url==="string"&&
        /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/u.test(url)&&
        Number(url.slice(url.lastIndexOf(":")+1))<=65535;
      if(!local(privateGatewayTransport.gatewayBaseUrl)||
         !local(privateGatewayTransport.adapterBaseUrl)||
         !local(execution.adapter.adapterBaseUrl))
        deny("trusted canonical Gateway and Adapter must use loopback ports");
      // Child allocation metadata is an operator-supplied DATA object,
      // never a source of trusted Coordinator, reviewGate, Engineer DID,
      // session or authenticated permissions. Forbid all extra keys
      // before the one-use OIDC admission can be consumed.
      const statusKeys=new Set([
        "reservationDirectory","statusListCredential","indexByTask",
        "excludedIndices","validitySeconds"
      ]);
      if(Object.getPrototypeOf(childStatusProvisioning)!==Object.prototype||
         Object.keys(childStatusProvisioning).some(k=>!statusKeys.has(k))||
         Object.keys(childStatusProvisioning.indexByTask).some(
           k=>k==="__proto__"||k==="constructor"||k==="prototype"))
        deny("child Status List provisioning may not override trusted session or Engineer identity");
      const trusted=pinnedHandoffInput(input);
      if(selectedRunId&&selectedRunId!==input.runId)
        deny("different manual run already selected for Engineer execution");
      selectedRunId=input.runId;
      return handoff.runApprovedDagWithFactory(trusted,async running=>{
        if(closed||active.coordinator.phase!=="execution")
          deny("operational handoff unavailable before signed Gateway branch binding");
        // Real role servers were started only after the operational root.
        // Confirm that their bound localhost HTTP Agent Cards identify
        // the exact delegated roles before any provider effect or VP mint.
        // The probe does not send a credential, model prompt or tool call.
        await assertTrustedApprovedA2AStartup({
          endpoints:running.endpoints
        });
        if(closed||active.coordinator.phase!=="execution")
          deny("signed Gateway authority closed while checking A2A servers");
        const branch=await createTrustedApprovedBranchGateway({
          coordinator:active.coordinator,
          reviewGate:active.reviewGate,
          sessionId:approval.expectedSessionId,
          baseRevision:approval.expectedBaseRevision,
          engineerDid:approval.engineerDid,
          transport:privateGatewayTransport
        });
        const children=await createTrustedApprovedTaskAuthorityAllocator({
          coordinator:active.coordinator,reviewGate:active.reviewGate,
          sessionId:approval.expectedSessionId,
          engineerDid:approval.engineerDid,
          reservationDirectory:childStatusProvisioning.reservationDirectory,
          statusListCredential:childStatusProvisioning.statusListCredential,
          indexByTask:childStatusProvisioning.indexByTask,
          excludedIndices:childStatusProvisioning.excludedIndices,
          ...(childStatusProvisioning.validitySeconds===undefined?{}:
            {validitySeconds:childStatusProvisioning.validitySeconds})
        });
        return {
          a2a:execution.a2a,adapter:execution.adapter,
          authorityForTask:children.authorityForTask,
          invokeOrchestratorTask:branch.invokeOrchestratorTask
        };
      });
    },
    /**
     * Owner-only, zero-billing canonical signed Execution. Consumes ONLY a
     * scripted_offline HMAC receipt and uses the SAME signed Coordinator,
     * Gateway transport, protected child allocator and three pinned A2A
     * servers as the paid DAG. Never exposed via the mTLS listener/UI.
     * A verified runner status follows ONLY after DAG and root teardown.
     */
    runReviewedScriptedApprovedDagWithGateway({
      execution,privateGatewayTransport,childStatusProvisioning,
      runId,operationalRoot,ports,handlers
    }){
      if(closed)deny("host closed");
      if(!scripted)deny("independent no-charge OIDC profile required");
      if(!active?.reviewGate||
         active.coordinator.phase!=="planning")
        deny("original live signed Planning session required");
      if(!execution||typeof execution!=="object"||
         // Neither caller nor model may choose a new branch operation or
         // assign a child index after the signed execution has started.
         Object.hasOwn(execution,"authorityForTask")||
         Object.hasOwn(execution,"invokeOrchestratorTask")||
         typeof execution.a2a?.sendProtectedTask!=="function"||
         !execution.adapter?.adapterBaseUrl||
         !execution.adapter?.bearerToken||
         !privateGatewayTransport?.gatewayBaseUrl||
         !privateGatewayTransport?.adapterBaseUrl||
         !privateGatewayTransport?.adapterToken||
         !childStatusProvisioning?.reservationDirectory||
         !childStatusProvisioning?.statusListCredential||
         !childStatusProvisioning?.indexByTask||
         !Array.isArray(childStatusProvisioning?.excludedIndices))
        deny("private reviewed A2A/Adapter, Gateway and durable child status provisioning required");
      // The entire approved DAG is localhost-bound. Do not let an
      // operator-selected URL turn the private Adapter bearer into an
      // accidental outbound credential to an arbitrary host.
      const local=url=>typeof url==="string"&&
        /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/u.test(url)&&
        Number(url.slice(url.lastIndexOf(":")+1))<=65535;
      if(!local(privateGatewayTransport.gatewayBaseUrl)||
         !local(privateGatewayTransport.adapterBaseUrl)||
         !local(execution.adapter.adapterBaseUrl))
        deny("trusted canonical Gateway and Adapter must use loopback ports");
      // Child allocation metadata is an operator-supplied DATA object,
      // never a source of trusted Coordinator, reviewGate, Engineer DID,
      // session or authenticated permissions. Forbid all extra keys
      // before the one-use OIDC admission can be consumed.
      const statusKeys=new Set([
        "reservationDirectory","statusListCredential","indexByTask",
        "excludedIndices","validitySeconds"
      ]);
      if(Object.getPrototypeOf(childStatusProvisioning)!==Object.prototype||
         Object.keys(childStatusProvisioning).some(k=>!statusKeys.has(k))||
         Object.keys(childStatusProvisioning.indexByTask).some(
           k=>k==="__proto__"||k==="constructor"||k==="prototype"))
        deny("child Status List provisioning may not override trusted session or Engineer identity");
      if(!scriptedHandoff||!scriptedAdmissionStore||!scripted)
        deny("no independently authenticated scripted profile available");
      if(handoff.status!=="idle"||selectedRunId)
        deny("paid handoff already selected for this Coordinator");
      if(selectedScriptedRunId)
        deny("scripted GitHub execution already selected: one-shot");
      if(!/^[1-9][0-9]{0,19}$/.test(runId??""))
        deny("original GitHub run identity required");
      if(!operationalRoot||typeof operationalRoot!=="object"||
         !ports||!handlers)
        deny("private scripted root and three deterministic role handlers required");
      const trusted={
        coordinator:active.coordinator,
        reviewGate:active.reviewGate,
        checkpointStore:active.checkpointStore,
        operationalRoot,ports,handlers,
        admissionStore:scriptedAdmissionStore,
        pins:{...fixedPins,runId},
        githubApiToken:scripted.githubApiToken,
        githubApiFetchFn:scripted.githubApiFetchFn
      };
      active.coordinator.assertOperationalRecoveryStore(
        operationalRecoveryStore);
      selectedScriptedRunId=runId;
      return scriptedHandoff.runApprovedDagWithFactory(trusted,async running=>{
        if(closed||active.coordinator.phase!=="execution")
          deny("operational handoff unavailable before signed Gateway branch binding");
        // Real role servers were started only after the operational root.
        // Confirm that their bound localhost HTTP Agent Cards identify
        // the exact delegated roles before any provider effect or VP mint.
        // The probe does not send a credential, model prompt or tool call.
        await assertTrustedApprovedA2AStartup({
          endpoints:running.endpoints
        });
        if(closed||active.coordinator.phase!=="execution")
          deny("signed Gateway authority closed while checking A2A servers");
        const branch=await createTrustedApprovedBranchGateway({
          coordinator:active.coordinator,
          reviewGate:active.reviewGate,
          sessionId:approval.expectedSessionId,
          baseRevision:approval.expectedBaseRevision,
          engineerDid:approval.engineerDid,
          transport:privateGatewayTransport
        });
        const children=await createTrustedApprovedTaskAuthorityAllocator({
          coordinator:active.coordinator,reviewGate:active.reviewGate,
          sessionId:approval.expectedSessionId,
          engineerDid:approval.engineerDid,
          reservationDirectory:childStatusProvisioning.reservationDirectory,
          statusListCredential:childStatusProvisioning.statusListCredential,
          indexByTask:childStatusProvisioning.indexByTask,
          excludedIndices:childStatusProvisioning.excludedIndices,
          ...(childStatusProvisioning.validitySeconds===undefined?{}:
            {validitySeconds:childStatusProvisioning.validitySeconds})
        });
        return {
          a2a:execution.a2a,adapter:execution.adapter,
          authorityForTask:children.authorityForTask,
          invokeOrchestratorTask:branch.invokeOrchestratorTask
        };
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
          handoff.close(),scriptedHandoff.close(),oidcIntake.close(),
          ...(scriptedIntake?[scriptedIntake.close()]:[]),
          shutdown(engineerServer)
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
  if(!gateway.operationalSessionDurableConfigured())
    deny("private Gateway must persist operational session fences across restarts");
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
