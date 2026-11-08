/**
 * R385.2 — pure owner-side A2A endpoint admission boundary.
 *
 * This preflight must run before activating a signed operational root.
 * No reviewed DAG dispatcher, model, A2A server or Rust authority is loaded.
 * Preserve the historical acceptance/error contract for legacy callers.
 */
const ROLES=["backend","frontend","test"] as const;
const LOOPBACK=/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/?$/u;
const validLoopbackEndpoint=(url:unknown):url is string=>{
  if(typeof url!=="string")return false;
  const match=LOOPBACK.exec(url);
  return match!==null && Number(match[1])<=65535;
};
function fail(reason:string):never{
  throw Error("Reviewed Gemini DAG bridge: "+reason);
}

/** Shared owner-side A2A endpoint preflight. Run this BEFORE any new
 * operational root issuance and freeze a defensive copy across awaits. */
export function pinTrustedReviewedAgentEndpoints(
  endpoints:Readonly<Record<"backend"|"frontend"|"test",string>>
):Readonly<Record<"backend"|"frontend"|"test",string>>{
  const pinnedUrls=ROLES.map(role=>endpoints?.[role]);
  if(pinnedUrls.some(url=>!validLoopbackEndpoint(url))||
     new Set(pinnedUrls).size!==ROLES.length)
    fail("Gemini A2A endpoints must be three distinct localhost servers");
  return Object.freeze({
    backend:pinnedUrls[0]!,frontend:pinnedUrls[1]!,test:pinnedUrls[2]!
  });
}

