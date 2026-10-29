/**
 * Source-free, bounded Vitest failure FILE paths. Never return assertion
 * messages, suite names, stderr, source snippets or tool payloads.
 * A later signed Task read-grant check is mandatory before model exposure.
 */
export type VitestPhase="backend_tests"|"frontend_tests";
const MAX=8;
function allowed(x:unknown,phase:VitestPhase):x is string{
  if(typeof x!=="string"||x.length>180||x.includes("\\")||
     x.includes("//")||x.split("/").some(s=>s==="."||s===".."))return false;
  const prefix=phase==="frontend_tests"?"tests/frontend/":"tests/backend/";
  return x.startsWith(prefix)&&
    /^[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*\.(?:test|spec)\.[jt]sx?$/u
      .test(x.slice(prefix.length));
}
export function sanitizeVitestFailureFiles(raw:unknown,phase:VitestPhase):string[]{
  if(!Array.isArray(raw)||raw.length>MAX)return [];
  return [...new Set(raw.filter((x):x is string=>allowed(x,phase)))];
}
export function extractVitestFailureFiles(stdout:string,stderr:string,
  phase:VitestPhase):string[]{
  const cleaned=(stdout+"\n"+stderr).slice(0,120_000)
    .replace(/\x1b\[[0-9;]*m/gu,"");
  const result:string[]=[];
  for(const line of cleaned.split(/\r?\n/u).slice(0,1500)){
    // Only the Vitest FAIL header, never arbitrary test code or prose.
    const hit=/^\s*FAIL\s+(tests\/(?:frontend|backend)\/[A-Za-z0-9_@./-]{1,174}\.(?:test|spec)\.[jt]sx?)(?=\s|$)/u.exec(line);
    if(hit&&allowed(hit[1],phase)&&!result.includes(hit[1])){
      result.push(hit[1]);
      if(result.length===MAX)break;
    }
  }
  return result;
}
