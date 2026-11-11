/**
 * R5 owner-only Execution ARGUMENT bridge.
 *
 * Only the authentic original live Engineer Host can consume an admitted
 * scripted GitHub run. This module does not authenticate an OIDC token,
 * Engineer signature or issue a root; host.runReviewedScriptedApprovedDag-
 * WithGateway performs the independent checks. No HTTP or GitHub input
 * reaches this private owner callback directly.
 */
const ROLES=["backend","frontend","test"];
const RUN=/^[1-9][0-9]{0,19}$/u;
const URL=/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/u;
const ROOT_FIELDS=["credential_id","valid_from",
  "validity_seconds","credential_status"];
const ARG_FIELDS=["runId","operationalRoot","ports","handlers",
  "sendProtectedTask","childStatusProvisioning"];
const STATUS_FIELDS=["reservationDirectory","statusListCredential",
  "indexByTask","excludedIndices","issuanceJournalDirectory","validitySeconds"];
const REQUIRED_STATUS=["reservationDirectory","statusListCredential",
  "indexByTask","excludedIndices","issuanceJournalDirectory"];
function deny(){throw Error("R5 protected scripted Execution binding denied");}
function plain(value){
  return value!==null&&typeof value==="object"&&!Array.isArray(value)&&
    Object.getPrototypeOf(value)===Object.prototype;
}
function keys(value,allowed,required){
  return plain(value)&&Object.keys(value).every(k=>allowed.includes(k))&&
    required.every(k=>Object.hasOwn(value,k));
}
function localhost(value){
  const match=typeof value==="string"?URL.exec(value):null;
  return !!match&&Number(match[1])<=65535;
}
function ownCopy(value){
  if(Array.isArray(value))return Object.freeze(value.map(ownCopy));
  if(plain(value))return Object.freeze(Object.fromEntries(
    Object.entries(value).map(([k,v])=>[k,ownCopy(v)])));
  return value;
}
/**
 * Caller can select only source-approved task handlers, role ports, a
 * revocable operational root candidate and the already-reviewed GitHub run.
 * Gateway/Adapter origin and bearer are copied exclusively from the
 * original signed Planning object built by the protected owner bootstrap.
 */
export function bindProtectedR5ScriptedExecution(planning,input){
  const gateway=planning?.gateway;
  if(!Object.isFrozen(planning)||!Object.isFrozen(gateway)||
     !localhost(gateway?.gatewayBaseUrl)||
     !localhost(gateway?.adapterBaseUrl)||
     typeof gateway.adapterToken!=="string"||
     gateway.adapterToken.length<8||
     !keys(input,ARG_FIELDS,ARG_FIELDS)||
     !RUN.test(input.runId)||
     !keys(input.operationalRoot,ROOT_FIELDS,ROOT_FIELDS)||
     !keys(input.ports,ROLES,ROLES)||
     !keys(input.handlers,ROLES,ROLES)||
     typeof input.sendProtectedTask!=="function"||
     !keys(input.childStatusProvisioning,STATUS_FIELDS,
       REQUIRED_STATUS)||
     ROLES.some(role=>typeof input.handlers[role]!=="function"||
       !Number.isSafeInteger(input.ports[role])||
       input.ports[role]<1024||input.ports[role]>65535)||
     new Set(ROLES.map(role=>input.ports[role])).size!==3||
     typeof input.childStatusProvisioning.reservationDirectory!=="string"||
     typeof input.childStatusProvisioning.issuanceJournalDirectory!=="string"||
     !input.childStatusProvisioning.issuanceJournalDirectory.startsWith("/")||
     typeof input.childStatusProvisioning.statusListCredential!=="string"||
     !plain(input.childStatusProvisioning.indexByTask)||
     !Array.isArray(input.childStatusProvisioning.excludedIndices)||
     (input.childStatusProvisioning.validitySeconds!==undefined&&
       (!Number.isSafeInteger(input.childStatusProvisioning.validitySeconds)||
        input.childStatusProvisioning.validitySeconds<=0)))
    deny();
  const status=input.childStatusProvisioning;
  if(Object.keys(status.indexByTask).some(k=>
     ["__proto__","prototype","constructor"].includes(k))||
     Object.values(status.indexByTask).some(v=>
       !(typeof v==="string"||Number.isSafeInteger(v)))||
     status.excludedIndices.some(v=>
       !(typeof v==="string"||Number.isSafeInteger(v))))
    deny();
  const config=Object.freeze({
    runId:input.runId,
    operationalRoot:ownCopy(input.operationalRoot),
    ports:ownCopy(input.ports),
    handlers:Object.freeze({...input.handlers}),
    childStatusProvisioning:ownCopy(status),
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
  return config;
}
