/**
 * Opt-in deployed control plane: the real GatewayRuntime shares its approved
 * plan registry with an authenticated owner-only Unix socket listener.
 * No public management HTTP endpoints; no fake task-completion attestor.
 */
import {readFile,open,lstat} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {constants} from "node:fs";
import {SignedEngineerApprovalFileStore} from
  "../../../packages/orchestrator-runtime/src/signed-approval-store.ts";
import {TrustedApprovedExecutionPlans} from "./approved-execution-plans.ts";
import {GatewayCorroboratedTaskAttestor} from "./trusted-task-observation.ts";
import {createTrustedPlanIpcServer} from "./trusted-plan-ipc.ts";
import {TrustedPlanningRevisions} from "./planning-revisions.ts";
import {TrustedPlanningRetirementStore} from "./trusted-planning-retirement-store.ts";
import {GiteaClient} from "./gitea-client.ts";
import type {GatewayRuntimeConfig} from "./config.ts";

const ENV=[
  "TRUSTED_PLAN_IPC_SOCKET","TRUSTED_PLAN_IPC_SECRET_FILE",
  "TRUSTED_PLAN_APPROVAL_DIR","TRUSTED_PLAN_ENGINEER_DID",
  "TRUSTED_PLAN_KEY_ID","TRUSTED_PLAN_PUBLIC_KEY_FILE",
  "TRUSTED_PLAN_PLANNING_RETIREMENT_DIR"
] as const;

async function pinnedPublicKey(path:string):Promise<string>{
  const full=resolve(path);
  const dir=await lstat(dirname(full));
  if(!dir.isDirectory()||dir.isSymbolicLink()||(dir.mode&0o077)!==0){
    throw Error("Trusted public key directory must be owner-only");
  }
  const fd=await open(full,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const meta=await fd.stat();
    if(!meta.isFile()||(meta.mode&0o022)!==0||meta.size>8192||
       meta.size===0)throw Error("Invalid trusted public key file");
    return fd.readFile({encoding:"utf8"});
  }finally{await fd.close();}
}

export async function trustedPlanDeploymentFromEnv(config:GatewayRuntimeConfig){
  if(!ENV.some(name=>process.env[name]))return null;
  // An operationally trusted host MUST NOT run without the independently
  // authenticated, pinned Gitea Planning registry. In particular the
  // mock provider is never a substitute for the real read-only root.
  if(config.provider_mode==="mock"||
     !config.gitea_base_url||!config.gitea_gateway_token)
    throw Error("Trusted Gateway Planning requires real authenticated Gitea");
  if(ENV.some(name=>!process.env[name]?.trim())){
    throw Error("Incomplete trusted plan IPC configuration; fail closed");
  }
  const value=(key:typeof ENV[number])=>process.env[key]!;
  const engineerDid=value("TRUSTED_PLAN_ENGINEER_DID");
  const keyId=value("TRUSTED_PLAN_KEY_ID");
  const publicKey=await pinnedPublicKey(value("TRUSTED_PLAN_PUBLIC_KEY_FILE"));
  const approvals=new SignedEngineerApprovalFileStore({
    directory:value("TRUSTED_PLAN_APPROVAL_DIR"),
    engineerDid,trustedKeys:{
      [keyId]:{engineer_did:engineerDid,public_key_pem:publicKey}
    }
  });
  // Optional independent Gateway watchdog: this TTL lives in the Gateway
  // process and does NOT rely on Engineer Node timers for expiry. Admitted
  // GitHub execution refuses any Gateway without this configured.
  const leaseRaw=process.env.TRUSTED_PLAN_OPERATIONAL_LEASE_MS;
  if(leaseRaw!==undefined&&!/^[1-9]\d{3,5}$/u.test(leaseRaw))
    throw Error("Invalid trusted Gateway operational lease duration");
  const retirementStore=new TrustedPlanningRetirementStore(
    value("TRUSTED_PLAN_PLANNING_RETIREMENT_DIR"));
  // Verify all prior retirements before any trusted socket or public HTTP.
  await retirementStore.assertReady();
  const planningRevisions=new TrustedPlanningRevisions(new GiteaClient({
    baseUrl:config.gitea_base_url,
    token:config.gitea_gateway_token,
    owner:config.prepare.repository.owner,
    repository:config.prepare.repository.repository,
    timeoutMs:config.gitea_timeout_ms
  }),{retirementStore});
  const plans=new TrustedApprovedExecutionPlans({
    repository:config.prepare.repository,engineerDid,approvals,
    ...(leaseRaw===undefined?{}:{operationalLeaseMs:Number(leaseRaw)}),
    // Gateway independently corroborates private Coordinator observations
    // using results retained from authorized provider I/O.
    completionAttestor:new GatewayCorroboratedTaskAttestor()
  });
  const ipc=await createTrustedPlanIpcServer({
    socketPath:value("TRUSTED_PLAN_IPC_SOCKET"),
    secretFile:value("TRUSTED_PLAN_IPC_SECRET_FILE"),plans,
    planningRevisions
  });
  // SAME instance must be installed into GatewayRuntime.prepare/execute.
  return {plans,planningRevisions,ipc};
}
