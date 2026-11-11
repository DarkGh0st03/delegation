import {TrustedAuthorityOnlyBranchExecutor} from './trusted-authority-only-branch-executor.ts';
import {TrustedGatewayGiteaReadEvidencePublisher}
 from './trusted-authority-only-gitea-publisher.ts';
/**
 * R310 — explicit owner-assembled authority-only Gateway HTTP entrypoint.
 *
 * A separate trusted owner process must construct native root/Task admission,
 * one-shot CAS and Runner executors and the SAME request store. Unlike
 * main.ts, this host never imports legacy plan deployment or registers an
 * untrusted HTTP/MCP/A2A control endpoint. No bearer, credential or Task
 * is accepted as an owner constructor argument from a network request.
 *
 * Intentionally not a standalone CLI: constructing real owner capabilities
 * from environment variables or a JSON file would create an unsafe parallel
 * authority path. The trusted Coordinator owner must import this function.
 */
import type {Server} from "node:http";
import {createGatewayHttpServer} from "./http.ts";
import {GatewayRuntime} from "./runtime.ts";
import type {GatewayRuntimeConfig} from "./config.ts";
import {InMemoryRequestStore} from "./prepare.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "./trusted-authority-only-admissions.ts";
import {TrustedAuthorityOnlyGiteaMutationExecutor}
 from "./trusted-authority-only-mutation-executor.ts";
import {TrustedAuthorityOnlyGiteaCreateExecutor}
 from "./trusted-authority-only-create-executor.ts";
import {TrustedAuthorityOnlyRunnerExecutor}
 from "./trusted-authority-only-runner-executor.ts";
import {TrustedAuthorityOnlyPullRequestExecutor}
 from "./trusted-authority-only-pull-request-executor.ts";
import type {AuditSink} from "./types.ts";

export interface TrustedAuthorityOnlyGatewayOwner {
  admissions:TrustedAuthorityOnlyGatewayAdmissions;
  mutationExecutor:TrustedAuthorityOnlyGiteaMutationExecutor;
  /** Optional owner-created native CREATE CAS (never from HTTP). */
  createExecutor?:TrustedAuthorityOnlyGiteaCreateExecutor;
  runnerExecutor:TrustedAuthorityOnlyRunnerExecutor;
  /** Explicit owner-only read evidence opt-in; absent means fail closed. */
  readPublisher?:TrustedGatewayGiteaReadEvidencePublisher;
  branchExecutor?:TrustedAuthorityOnlyBranchExecutor;
  pullRequestExecutor?:TrustedAuthorityOnlyPullRequestExecutor;
  store:InMemoryRequestStore;
  audit?:AuditSink;
}

function deny(reason:string):never{
  throw Error("Authority-only Gateway owner startup NO-GO: "+reason);
}

/** The existing main.ts remains explicitly legacy, never implicit migration. */
export function assertLegacyGatewayEntrypoint(value:string|undefined):void{
  if(value!==undefined&&value!=="legacy-signed-dag")
    deny("legacy main.ts cannot launch requested authority-only deployment");
}

const LEGACY_ENV=[
  "TRUSTED_PLAN_IPC_SOCKET","TRUSTED_PLAN_APPROVAL_DIR",
  "TRUSTED_PLAN_OPERATIONAL_SESSION_DIR"
] as const;

/**
 * Construct an actual HTTP server with independently loaded native Core
 * verifier, OPA and real Gitea. No test/mock verifier, executor, legacy
 * planning gate or bearer-provided owner objects can be injected here.
 *
 * This host is for an already authenticated, activated owner. The owner must
 * durably stage every Task effect BEFORE sending requests to the server.
 */
export function createTrustedAuthorityOnlyGatewayServer(
  config:GatewayRuntimeConfig,owner:TrustedAuthorityOnlyGatewayOwner
):Server{
  if(!config||config.provider_mode!=="gitea"||
     config.verifier_mode!=="core-rust"||
     !config.gitea_base_url?.trim()||
     !config.gitea_gateway_token?.trim()||
     !config.opa_url?.trim())
    deny("mutable Gitea, independent Core Rust and OPA are mandatory");
  if(process.env.DELEGATION_GATEWAY_ARCHITECTURE!==undefined&&
     process.env.DELEGATION_GATEWAY_ARCHITECTURE!=="authority-only")
    deny("owner host requires authority-only architecture selection");
  if(LEGACY_ENV.some(name=>process.env[name]!==undefined))
    deny("legacy signed-DAG deployment environment cannot be reused");
  if(!owner||
     !(owner.admissions instanceof TrustedAuthorityOnlyGatewayAdmissions)||
     !(owner.mutationExecutor instanceof TrustedAuthorityOnlyGiteaMutationExecutor)||
     !(owner.runnerExecutor instanceof TrustedAuthorityOnlyRunnerExecutor)||
     !(owner.store instanceof InMemoryRequestStore))
    deny("concrete trusted owner admissions, CAS, Runner and store required");
  if(owner.admissions.phase!=="active")
    deny("Engineer authority and native Gateway admission must be active");
  if(!owner.mutationExecutor.isForAdmissions(owner.admissions)||
     !owner.runnerExecutor.isForAdmissions(owner.admissions))
    deny("effect executors belong to another Gateway owner");
  if(owner.createExecutor!==undefined&&
     (!(owner.createExecutor instanceof TrustedAuthorityOnlyGiteaCreateExecutor)||
      !TrustedAuthorityOnlyGiteaCreateExecutor.prototype.isForAdmissions.call(
       owner.createExecutor,owner.admissions)))
    deny("create CAS executor belongs to another Gateway owner");
  if(owner.readPublisher!==undefined&&
     (!(owner.readPublisher instanceof TrustedGatewayGiteaReadEvidencePublisher)||
      !owner.readPublisher.isForAdmissions(owner.admissions)))
    deny("read evidence publisher differs from original Gateway owner");
  if(owner.branchExecutor!==undefined&&
     !TrustedAuthorityOnlyBranchExecutor.isNativeForAdmissions(owner.branchExecutor,owner.admissions))
    deny("branch executor belongs to another Gateway owner");
  if(owner.pullRequestExecutor!==undefined&&
     !TrustedAuthorityOnlyPullRequestExecutor.isNativeForAdmissions(
      owner.pullRequestExecutor,owner.admissions))
    deny("PR executor belongs to another Gateway owner");
  if(owner.audit!==undefined&&
     (typeof owner.audit!=="object"||
      typeof owner.audit.emit!=="function"))
    deny("invalid owner audit sink");
  // The private owner MUST use the identical request store when reserving
  // update_file or run_tests intent; a second store cannot be reconstructed
  // from serialized Task metadata after the fact.
  const runtime=new GatewayRuntime(config,{
    store:owner.store,
    ...(owner.audit?{audit:owner.audit}:{}),
    authorityOnlyAdmissions:owner.admissions,
    authorityOnlyMutationEnabled:true,
    authorityOnlyMutationExecutor:owner.mutationExecutor,
    ...(owner.createExecutor?{authorityOnlyCreateEnabled:true,
      authorityOnlyCreateExecutor:owner.createExecutor}:{}),
    authorityOnlyRunnerEnabled:true,
    authorityOnlyRunnerExecutor:owner.runnerExecutor,
    ...(owner.readPublisher?{authorityOnlyReadEnabled:true,
     authorityOnlyReceiptWriter:owner.readPublisher}:{}),
    ...(owner.branchExecutor?{authorityOnlyBranchEnabled:true,authorityOnlyBranchExecutor:owner.branchExecutor}:{}),
    ...(owner.pullRequestExecutor?{authorityOnlyPullRequestEnabled:true,
     authorityOnlyPullRequestExecutor:owner.pullRequestExecutor}:{})
  });
  return createGatewayHttpServer(runtime);
}

/**
 * The listener only starts after all owner-instance and native Core checks.
 * The result is owned by the trusted host, never by public Gateway callers.
 */
export async function startTrustedAuthorityOnlyGatewayServer(
  config:GatewayRuntimeConfig,owner:TrustedAuthorityOnlyGatewayOwner
):Promise<Readonly<{server:Server;close:()=>Promise<void>}>>{
  const server=createTrustedAuthorityOnlyGatewayServer(config,owner);
  await new Promise<void>((resolve,reject)=>{
    const onError=(error:Error)=>{
      server.off("listening",onListen);
      reject(error);
    };
    const onListen=()=>{
      server.off("error",onError);
      resolve();
    };
    server.once("error",onError);
    server.once("listening",onListen);
    server.listen(config.bind_port,config.bind_host);
  });
  return Object.freeze({
    server,
    close:()=>new Promise<void>((resolve,reject)=>{
      server.close(error=>error?reject(error):resolve());
    })
  });
}
