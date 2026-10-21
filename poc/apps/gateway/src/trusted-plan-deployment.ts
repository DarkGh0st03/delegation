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
import type {GatewayRepositoryConfig} from "./types.ts";

const ENV=[
  "TRUSTED_PLAN_IPC_SOCKET","TRUSTED_PLAN_IPC_SECRET_FILE",
  "TRUSTED_PLAN_APPROVAL_DIR","TRUSTED_PLAN_ENGINEER_DID",
  "TRUSTED_PLAN_KEY_ID","TRUSTED_PLAN_PUBLIC_KEY_FILE"
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

export async function trustedPlanDeploymentFromEnv(repository:GatewayRepositoryConfig){
  if(!ENV.some(name=>process.env[name]))return null;
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
  const plans=new TrustedApprovedExecutionPlans({
    repository,engineerDid,approvals,
    // Gateway independently corroborates private Coordinator observations
    // using results retained from authorized provider I/O.
    completionAttestor:new GatewayCorroboratedTaskAttestor()
  });
  const ipc=await createTrustedPlanIpcServer({
    socketPath:value("TRUSTED_PLAN_IPC_SOCKET"),
    secretFile:value("TRUSTED_PLAN_IPC_SECRET_FILE"),plans
  });
  return {plans,ipc};
}
