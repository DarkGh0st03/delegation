/**
 * Non-billable owner-side readiness probe between signed root activation
 * and the first approved DAG provider effect. This is NOT A2A peer
 * authentication: authority remains with signed VC/VP + Gateway/Rust/OPA.
 *
 * The endpoints MUST come from the host-owned, newly started role servers,
 * not workflow inputs, plan text or an LLM response. Never send secrets or
 * delegated credentials to this read-only probe.
 */
import {agentDid} from "../../agent-runtime/src/cards.ts";
import {DELEGATED_AUTHORIZATION_EXTENSION_URI}
  from "../../agent-runtime/src/contracts.ts";

type Role="backend"|"frontend"|"test";
const ROLES=["backend","frontend","test"] as const;
const NAMES:Readonly<Record<Role,string>>=Object.freeze({
  backend:"Backend Development Agent",
  frontend:"Frontend Development Agent",
  test:"Software Testing Agent"
});
const SKILLS:Readonly<Record<Role,string>>=Object.freeze({
  backend:"backend-software-engineering",
  frontend:"frontend-software-engineering",
  test:"software-testing"
});
const BASE=/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/?$/u;
const LIMIT=32*1024;
function denied():never{
  throw Error("Trusted A2A startup: pinned localhost role-card verification denied");
}
export async function assertTrustedApprovedA2AStartup(input:{
  endpoints:Readonly<Record<Role,string>>;
  /** Test-only injectable fetch; private owner uses global fetch. */
  fetchFn?:typeof fetch;
}):Promise<void>{
  const endpoints=input?.endpoints;
  if(!endpoints||typeof endpoints!=="object"||
     Array.isArray(endpoints)||
     Object.keys(endpoints).length!==3||
     ROLES.some(role=>!Object.hasOwn(endpoints,role)))denied();
  const addresses=ROLES.map(role=>endpoints[role]);
  if(new Set(addresses).size!==3)denied();
  for(const role of ROLES){
    const base=endpoints[role];
    const match=typeof base==="string"?BASE.exec(base):null;
    if(!match||Number(match[1])>65535)denied();
    const target=base.replace(/\/$/u,"")+"/.well-known/agent-card.json";
    let result:Response;
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),5000);
    try{
      // One probe at a time. No A2A sendMessage, no Adapter token,
      // Authorization header, redirects, or credentials.
      result=await (input.fetchFn??fetch)(target,{
        method:"GET",redirect:"error",signal:controller.signal,
        headers:{accept:"application/json"}
      });
      if(!result.ok||!result.headers.get("content-type")?.includes("json")||
         !result.body)denied();
      let n=0;
      const parts:Uint8Array[]=[];
      const reader=result.body.getReader();
      try{
        while(true){
          const chunk=await reader.read();
          if(chunk.done)break;
          n+=chunk.value.byteLength;
          if(n>LIMIT)denied();
          parts.push(chunk.value);
        }
      }finally{await reader.cancel().catch(()=>{});}
      const card=JSON.parse(Buffer.concat(parts).toString("utf8"));
      const interfaces=card?.supportedInterfaces;
      const ext=card?.capabilities?.extensions;
      if(card?.name!==NAMES[role]||
         !Array.isArray(interfaces)||interfaces.length!==1||
         interfaces[0]?.url!==base.replace(/\/$/u,"")+"/a2a/rest"||
         interfaces[0]?.protocolBinding!=="HTTP+JSON"||
         !Array.isArray(ext)||ext.length!==1||
         ext[0]?.uri!==DELEGATED_AUTHORIZATION_EXTENSION_URI||
         ext[0]?.required!==true||
         ext[0]?.params?.agentDid!==agentDid(role)||
         ext[0]?.params?.evidenceLocation!==
           "message.metadata.delegation_evidence"||
         !Array.isArray(card?.skills)||
         !card.skills.some((s:unknown)=>
           typeof s==="object"&&s!==null&&
           (s as {id?:string}).id===SKILLS[role]))
        denied();
    }catch{denied();}
    finally{clearTimeout(timer);}
  }
}
