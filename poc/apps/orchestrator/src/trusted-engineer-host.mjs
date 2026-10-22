/**
 * Single-process, LOCAL ONLY Engineer host for manual OIDC admission and
 * independent human Ed25519 plan approval. No model or operational root is
 * started by this host. No network path is exposed to a GitHub runner.
 *
 * Security boundaries remain separate:
 *  1. Signed GitHub job + live Actions run -> one-use authenticated admission
 *  2. Engineer login + CSRF + protected signing key -> signed plan approval
 *  3. A live trusted Coordinator/checkpoint/receipt -> optional in-process
 *     handoff (never callable over either HTTP service).
 */
import {lstat} from "node:fs/promises";
import {resolve} from "node:path";
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
  const directories=[
    oidc.replayDirectory,oidc.admissionDirectory,approval.receiptDirectory
  ];
  if(directories.some(x=>typeof x!=="string"||!x.trim())||
     new Set(directories.map(dir=>resolve(dir))).size!==3)
    deny("separate owner-only replay/admission/Engineer directories required");
  for(const dir of directories)await privateDirectory(dir);
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
      port:config.oidcPort??0,tls:oidc.tls
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
  let closed=false;
  return Object.freeze({
    engineerUrl,
    oidcAdmissionEndpoint:oidcIntake.endpoint,
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
      return startAdmittedGithubReviewedGeminiHandoff({
        ...trusted,admissionStore,pins:{...fixedPins,runId},
        // Host configuration wins over every in-process caller argument.
        githubApiToken:oidc.githubApiToken,
        githubApiFetchFn:oidc.githubApiFetchFn,
        expectedWorkflowPath:oidc.pinned.workflowPath
      });
    },
    async close(){
      if(closed)return;
      closed=true;
      const results=await Promise.allSettled([
        oidcIntake.close(),shutdown(engineerServer)
      ]);
      const failures=results.filter(x=>x.status==="rejected");
      if(failures.length)
        deny("server shutdown incomplete; manual reconciliation required");
    }
  });
}
