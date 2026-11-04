/**
 * R181 — only the trusted crypto MCP route for active signed Agent Tasks.
 * No read_file/update_file/create_file/run_tests route exists in this class.
 * Identity is asserted by the MCP token verifier first; the private worker
 * independently validates the same active Task + Gateway challenge.
 */
import {parseCreatePresentationArgs} from "./crypto-catalog.ts";
import {toolFailureReasonFields} from "./tool-failure-reason.ts";
import type {AgentRole,TaskClaims} from "./task-token.ts";

export type CryptoWorkerEndpoints=Readonly<Record<AgentRole,{baseUrl:string}>>;

export class CryptoWorkerRouter {
 readonly #workers:CryptoWorkerEndpoints;
 readonly #fetch:typeof fetch;

 constructor(workers:CryptoWorkerEndpoints,fetchFn:typeof fetch=fetch){
  for(const role of ["backend","frontend","test"] as const){
   const url=new URL(workers[role].baseUrl);
   if(!["http:","https:"].includes(url.protocol)||
       url.username||url.password||url.hash||url.search)
    throw Error("invalid_worker_endpoint");
  }
  this.#workers=workers;
  this.#fetch=fetchFn;
 }

 async createPresentation(claims:Readonly<TaskClaims>,token:string,raw:unknown){
  const args=parseCreatePresentationArgs(raw);
  const endpoint=new URL("/internal/mcp-crypto-call",this.#workers[claims.role].baseUrl);
  let response:Response;
  try{
   response=await this.#fetch(endpoint,{
    method:"POST",headers:{
     authorization:"Bearer "+token,"content-type":"application/json"
    },
    body:JSON.stringify({tool:"delegation_create_presentation",arguments:args}),
    redirect:"error",signal:AbortSignal.timeout(10_000)
   });
  }catch{
   throw Object.assign(Error("task_worker_unavailable"),{reason:"upstream_unavailable"});
  }
  if(Number(response.headers.get("content-length"))>2_000_000)
   throw Error("task_worker_invalid_result");
  let data:unknown;
  try{
   const body=await response.text();
   if(body.length>2_000_000)throw Error("oversized");
   data=JSON.parse(body);
  }catch{throw Error("task_worker_invalid_result");}
  if(!response.ok){
   const failure=data&&typeof data==="object"&&!Array.isArray(data)
    ?(data as {error?:{kind?:unknown;reason?:unknown}}).error:undefined;
   const kind=failure?.kind;
   const allowed=["authorization_denied","invalid_tool_call",
    "inactive_task","unauthorized","tool_unavailable"];
   throw Object.assign(Error(typeof kind==="string"&&allowed.includes(kind)
    ?kind:"task_worker_rejected"),toolFailureReasonFields(failure));
  }
  if(!data||typeof data!=="object"||Array.isArray(data)||
     (data as Record<string,unknown>).ok!==true||
     !Object.hasOwn(data,"result"))
   throw Error("task_worker_invalid_result");
  return (data as {result:unknown}).result;
 }
}
