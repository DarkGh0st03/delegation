/**
 * Source-free, bounded Vitest failure FILE paths. Never return assertion
 * messages, suite names, stderr, source snippets or tool payloads.
 * A later signed Task read-grant check is mandatory before model exposure.
 * Paths are generic project test files (any folder of the project profile);
 * Runner-owned folders are never accepted.
 */
const MAX=8;
const FORBIDDEN=new Set(["acceptance","researcher_acceptance","runner",".github","node_modules",".researcher-acceptance"]);
const TEST_PATH=/^[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*\.(?:test|spec)\.[cm]?[jt]sx?$/u;
function allowed(x:unknown):x is string{
  return typeof x==="string"&&x.length<=180&&!x.includes("\\")&&!x.includes("//")&&
    !x.startsWith("/")&&x.split("/").every(s=>s!=="."&&s!==".."&&!FORBIDDEN.has(s.toLowerCase()))&&
    TEST_PATH.test(x);
}
export function sanitizeVitestFailureFiles(raw:unknown):string[]{
  if(!Array.isArray(raw)||raw.length>MAX)return [];
  return [...new Set(raw.filter((x):x is string=>allowed(x)))];
}
export function extractVitestFailureFiles(stdout:string,stderr:string):string[]{
  const cleaned=(stdout+"\n"+stderr).slice(0,120_000)
    .replace(/\x1b\[[0-9;]*m/gu,"");
  const result:string[]=[];
  for(const line of cleaned.split(/\r?\n/u).slice(0,1500)){
    // Only the Vitest FAIL header, never arbitrary test code or prose.
    const hit=/^\s*FAIL\s+([A-Za-z0-9_@./-]{1,180}\.(?:test|spec)\.[cm]?[jt]sx?)(?=\s|$)/u.exec(line);
    if(hit&&allowed(hit[1])&&!result.includes(hit[1])){
      result.push(hit[1]);
      if(result.length===MAX)break;
    }
  }
  return result;
}
