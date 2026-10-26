/**
 * Owner-only Gemini Execution arguments. This does NOT consume OIDC,
 * authorize a permission, sign a plan, issue a DC, or call a provider.
 *
 * The original owner Planning object supplies all shared Gateway/Adapter
 * authority; the operator may only select three private role transports,
 * one signed-run candidate and bounded local operational resources.
 * Engineer Ed25519, signed DAG, current GitHub job, child permissions and
 * revocation are independently enforced by Engineer Host.
 */
const ROLES=Object.freeze(["backend","frontend","test"]);
const RUN=/^[1-9][0-9]{0,19}$/u;
const LOOPBACK=/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/u;
const ROOT_FIELDS=["credential_id","valid_from",
  "validity_seconds","credential_status"];
const ARG_FIELDS=["runId","operationalRoot","ports","transports",
  "sendProtectedTask","childStatusProvisioning"];
const STATUS_FIELDS=["reservationDirectory","statusListCredential",
  "indexByTask","excludedIndices","validitySeconds"];
const TRANSPORT_FIELDS=["gatewayBaseUrl","adapterBaseUrl","adapterToken"];
function deny(){throw Error("Protected Gemini Execution binding denied");}
function plain(x){
  return x!==null&&typeof x==="object"&&!Array.isArray(x)&&
    Object.getPrototypeOf(x)===Object.prototype;
}
function keys(x,allowed,required=allowed){
  return plain(x)&&Object.keys(x).every(k=>allowed.includes(k))&&
    required.every(k=>Object.hasOwn(x,k));
}
function localhost(s){
  const match=typeof s==="string"?LOOPBACK.exec(s):null;
  return !!match&&Number(match[1])<=65535;
}
function frozenCopy(x){
  if(Array.isArray(x))return Object.freeze(x.map(frozenCopy));
  if(plain(x))return Object.freeze(Object.fromEntries(
    Object.entries(x).map(([k,v])=>[k,frozenCopy(v)])));
  return x;
}
export function bindProtectedGeminiApprovedExecution(planning,input){
  const gateway=planning?.gateway;
  if(!Object.isFrozen(planning)||!Object.isFrozen(gateway)||
     !localhost(gateway?.gatewayBaseUrl)||
     !localhost(gateway?.adapterBaseUrl)||
     typeof gateway.adapterToken!=="string"||
     gateway.adapterToken.length<8||
     !keys(input,ARG_FIELDS)||
     !RUN.test(input.runId)||
     !keys(input.operationalRoot,ROOT_FIELDS)||
     !keys(input.ports,ROLES)||
     !keys(input.transports,ROLES)||
     typeof input.sendProtectedTask!=="function"||
     !keys(input.childStatusProvisioning,STATUS_FIELDS,
       STATUS_FIELDS.slice(0,4))||
     ROLES.some(role=>!Number.isSafeInteger(input.ports[role])||
       input.ports[role]<1024||input.ports[role]>65535)||
     new Set(ROLES.map(role=>input.ports[role])).size!==3)
    deny();
  const secrets=[];
  for(const role of ROLES){
    const transport=input.transports[role];
    if(!keys(transport,TRANSPORT_FIELDS)||
       !localhost(transport.gatewayBaseUrl)||
       !localhost(transport.adapterBaseUrl)||
       transport.gatewayBaseUrl!==gateway.gatewayBaseUrl||
       transport.adapterBaseUrl!==gateway.adapterBaseUrl||
       typeof transport.adapterToken!=="string"||
       transport.adapterToken.trim().length<8||
       transport.adapterToken===gateway.adapterToken)deny();
    secrets.push(transport.adapterToken);
  }
  if(new Set(secrets).size!==ROLES.length)deny();
  const status=input.childStatusProvisioning;
  if(typeof status.reservationDirectory!=="string"||
     !status.reservationDirectory.startsWith("/")||
     typeof status.statusListCredential!=="string"||
     !keys(status.indexByTask,Object.keys(status.indexByTask??{}),[])||
     Object.keys(status.indexByTask).some(k=>[
       "__proto__","prototype","constructor"].includes(k))||
     Object.values(status.indexByTask).some(x=>
       !(typeof x==="string"||Number.isSafeInteger(x)))||
     !Array.isArray(status.excludedIndices)||
     status.excludedIndices.some(x=>
       !(typeof x==="string"||Number.isSafeInteger(x)))||
     (status.validitySeconds!==undefined&&
       (!Number.isSafeInteger(status.validitySeconds)||
        status.validitySeconds<1)))deny();
  // Role tokens are never in a model prompt, plan/receipt, Task context,
  // GitHub run input or serialized confirmation. These objects remain
  // owner-process local and are passed directly to the trusted handoff.
  const transports=frozenCopy(input.transports);
  return Object.freeze({
    runId:input.runId,operationalRoot:frozenCopy(input.operationalRoot),
    ports:frozenCopy(input.ports),transports,
    childStatusProvisioning:frozenCopy(status),
    privateGatewayTransport:Object.freeze({
      gatewayBaseUrl:gateway.gatewayBaseUrl,
      adapterBaseUrl:gateway.adapterBaseUrl,
      adapterToken:gateway.adapterToken
    }),
    execution:Object.freeze({
      a2a:Object.freeze({sendProtectedTask:input.sendProtectedTask}),
      adapter:Object.freeze({
        adapterBaseUrl:gateway.adapterBaseUrl,
        bearerToken:gateway.adapterToken
      })
    })
  });
}
