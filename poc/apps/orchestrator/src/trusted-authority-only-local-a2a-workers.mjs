import {generateKeyPairSync,randomBytes} from "node:crypto";
import {lstat,mkdtemp,realpath,rm,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {startSpecializedAgentServer}
 from "../../../packages/agent-runtime/src/server.ts";
import {TrustedEffectStagingTaskRegistry}
 from "../../../packages/agent-runtime/src/trusted-effect-staging-task-registry.ts";
import {connectTrustedOwnerEffectStagingClient,createTrustedEffectAgentBindingServer}
 from "../../../packages/agent-runtime/src/trusted-effect-staging-unix-ipc.ts";

const ORIGINAL=["backend","frontend","test"];
const ROLE=/^[a-z][a-z0-9_-]{0,23}$/u;
function deny(){throw Error("Invalid private local A2A worker configuration");}

/** Start private, role-pinned agent listeners without dispatching Tasks.
 * The original Review Host starts its SDK owner with the returned pins. */
export async function startTrustedAuthorityOnlyLocalA2AWorkers({
 directory,workers,native=true,a2aPolling,trustedAgentRegistry,projectTestSourceProfile
}){
 const roles=workers&&typeof workers==="object"&&!Array.isArray(workers)
  ?Object.keys(workers).sort():[];
 const additional=roles.filter(role=>!ORIGINAL.includes(role));
 const nativeExtras=(process.env.ADAPTER_ADDITIONAL_SPECIALISTS??"");
 const configuredExtras=nativeExtras===""?[]:nativeExtras.split(",").sort();
 const registered=trustedAgentRegistry&&typeof trustedAgentRegistry==="object"&&
  !Array.isArray(trustedAgentRegistry)
   ?Object.keys(trustedAgentRegistry).filter(role=>role!=="orchestrator").sort()
   :undefined;
 if(!workers||roles.length<3||roles.length>16||
    !ORIGINAL.every(role=>Object.hasOwn(workers,role))||
    roles.some(role=>!ROLE.test(role)||
     ["constructor","prototype","orchestrator"].includes(role))||
    (registered&&registered.join(",")!==roles.join(","))||
    (additional.length>0&&(!native||!registered))||
    configuredExtras.length!==additional.length||
    !additional.every((role,i)=>role===configuredExtras[i])||
    typeof directory!=="string"||!directory.startsWith("/")||
    (native&&(process.env.DELEGATION_GATEWAY_ARCHITECTURE!=="authority-only"||
     process.env.APPROVED_RUNNER_NATIVE_MCP!=="1")))
  deny();
 const parent=await lstat(directory);
 if(!parent.isDirectory()||(parent.mode&0o077)!==0||
    (typeof process.getuid==="function"&&parent.uid!==process.getuid())||
    await realpath(directory)!==directory)
  deny();
 const ports=new Set();
 const configs=roles.map(role=>{
  const {port,adk,ownerAdditionalCardPin:pin}=workers[role]??{};
  const did=process.env["ADAPTER_ID_"+role.toUpperCase()];
  const extra=additional.includes(role);
  const registeredPin=trustedAgentRegistry?.[role];
  if(!Number.isSafeInteger(port)||port<1||port>65535||ports.has(port)||
     !adk?.model||!adk.adapterToken||
     (native&&!did?.startsWith("did:"))||
     (registered&&(!registeredPin||registeredPin.did!==did))||
     (extra&&process.env["ADAPTER_CALLER_"+role.toUpperCase()]!==adk?.adapterToken)||
     (extra&&(!pin||typeof pin!=="object"||Array.isArray(pin)||
       Object.keys(pin).sort().join(",")!=="capabilities,did,name,skillId"||
       pin.did!==registeredPin?.did||
       !Array.isArray(pin.capabilities)||pin.capabilities.length!==1||
       pin.capabilities[0]!=="read_file"||
       registeredPin?.capabilities?.length!==1||
       registeredPin.capabilities[0]!=="read_file"))||
     (!extra&&pin!==undefined))
   deny();
  ports.add(port);
  return {role,port,adk,did,...(extra?{pin}:{})};
 });
 const location=await mkdtemp(join(directory,"a2a-"));
 const listeners=[];
 let closing;
 const close=()=>closing??=(async()=>{
  const results=await Promise.allSettled(listeners.reverse().map(
   listener=>Promise.resolve().then(()=>listener.close())
  ));
  if(results.some(result=>result.status==="rejected"))
   throw Error("Private local A2A worker shutdown unconfirmed");
  await rm(location,{recursive:true,force:true});
 })();
 const stageChannels={},agentBindingChannels={},agentBaseUrls={};
 const additionalRolePins={};
 try{
  for(const {role,port,adk,did,pin} of configs){
   const channel=async prefix=>{
    const socketPath=join(location,prefix+"-"+role+".sock");
    const secretFile=join(location,prefix+"-"+role+".hex");
    await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",
     {mode:0o600,flag:"wx"});
    return Object.freeze({socketPath,secretFile});
   };
   const stage=stageChannels[role]=await channel("stage");
   const bind=agentBindingChannels[role]=await channel("bind");
   const registry=new TrustedEffectStagingTaskRegistry(
    projectTestSourceProfile===undefined?{}:{projectTestSourceProfile});
   const binder=await createTrustedEffectAgentBindingServer({
    ...bind,registry,expectedRole:role,
    ownerStageClient:await connectTrustedOwnerEffectStagingClient(stage)
   });
   listeners.push(binder);
   await binder.start();
   const keys=generateKeyPairSync("ed25519");
   const server=await startSpecializedAgentServer({
    role,port,host:"127.0.0.1",capabilityProfile:"approved-plan",delegatedAuthorization:true,
    ...(pin?{ownerAdditionalCardPin:pin}:{}),
    ...(native?{nativeSignerDid:did}:{}),
    adk:{...adk,trustedEffectTaskRegistry:registry,
     ...(native?{nativePresentationTransport:"mcp-stdio"}:{})},
    mcpTaskSigning:{
     signingPrivateKeyPem:keys.privateKey.export({type:"pkcs8",format:"pem"}).toString(),
     signingPublicKeyPem:keys.publicKey.export({type:"spki",format:"pem"}).toString()
    }
   });
   listeners.push(server);
   agentBaseUrls[role]=server.baseUrl;
   if(pin)additionalRolePins[role]=Object.freeze({...pin,
    capabilities:Object.freeze([...pin.capabilities])});
  }
  return Object.freeze({close,sdk:Object.freeze({
   stageChannels:Object.freeze(stageChannels),
   agentBindingChannels:Object.freeze(agentBindingChannels),
   agentBaseUrls:Object.freeze(agentBaseUrls),
   ...(additional.length?{additionalRolePins:Object.freeze(additionalRolePins)}:{}),
   a2aPolling
  })});
 }catch(error){
  await close();
  throw error;
 }
}
