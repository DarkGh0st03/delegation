/**
 * Bounded, source-free TypeScript compiler locations from a pinned Docker
 * run. Diagnostics are trusted runner metadata, NOT authorization. They must
 * be filtered again against the signed Task's read grants before model use.
 */
export interface TypecheckLocation {
  path:string;line:number;column:number;code:string;
}
const PATH=/^[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*\.tsx?$/u;
const CODE=/^TS[0-9]{4,5}$/u;
const MAX_ITEMS=8;
function permittedPath(path:unknown):path is string{
  return typeof path==="string"&&path.length<=180&&PATH.test(path)&&
    path.split("/").every(s=>s!=="."&&s!=="..")&&
    !path.includes("\\")&&!path.includes("//")&&!path.startsWith("/");
}
/** Fail closed on extra response fields, arbitrary code or source text. */
export function sanitizeTypecheckLocations(raw:unknown):TypecheckLocation[]{
  if(!Array.isArray(raw)||raw.length>MAX_ITEMS)return [];
  const result:TypecheckLocation[]=[];
  for(const item of raw){
    if(!item||typeof item!=="object"||Array.isArray(item))continue;
    const x=item as Record<string,unknown>;
    if(Object.keys(x).sort().join(",")!=="code,column,line,path"||
       !permittedPath(x.path)||typeof x.code!=="string"||!CODE.test(x.code)||
       typeof x.line!=="number"||!Number.isSafeInteger(x.line)||x.line<1||x.line>100000||
       typeof x.column!=="number"||!Number.isSafeInteger(x.column)||x.column<1||x.column>10000)
      continue;
    result.push({path:x.path,line:x.line,column:x.column,code:x.code});
  }
  return result;
}
/** Parser accepts only compiler location headers, discards message/snippets. */
/** Source-free TypeScript codes, including project-level errors without file paths.
 * Runner metadata is NEVER authorization or an executable repair instruction. */
export function sanitizeTypecheckErrorCodes(raw:unknown):string[]{
  if(!Array.isArray(raw)||raw.length===0||raw.length>MAX_ITEMS)return [];
  if(raw.some(x=>typeof x!=="string"||!CODE.test(x)))return [];
  if(new Set(raw).size!==raw.length||
     raw.some((x,i)=>i>0&&raw[i-1]>=x))return [];
  return [...raw];
}
export function extractTypecheckErrorCodes(stdout:string,stderr:string):string[]{
  const lines=(stdout+"\n"+stderr).slice(0,100_000)
    .split(/\r?\n/u).slice(0,1000);
  const codes=new Set<string>();
  for(const line of lines){
    const m=/^(?:error |[^\r\n]{1,181}\([0-9]{1,6},[0-9]{1,5}\): error |[^\r\n]{1,181}:[0-9]{1,6}:[0-9]{1,5} - error )(TS[0-9]{4,5}):/u.exec(line);
    if(m&&CODE.test(m[1]))codes.add(m[1]);
    if(codes.size>=MAX_ITEMS)break;
  }
  return [...codes].sort();
}
/**
 * The npm workspace banner identifies where tsc is actually running.
 * tsc reports src/foo.ts relative to that workspace; the signed plan and
 * Gitea use repository-relative paths. This source-free normalization is
 * diagnostic evidence only and NEVER grants tool authorization.
 *
 * Explicit roots are part of this fixed IAM-console Runner profile, not
 * model output. Unknown workspace banners disable relative-path expansion.
 */
const WORKSPACE_ROOTS:Readonly<Record<string,string>>=Object.freeze({
  "@iam/backend":"apps/backend",
  "@iam/frontend":"apps/frontend",
  "@iam/shared":"packages/shared",
  "@iam/security":"security"
});
const BANNER=/^> ((?:@[A-Za-z0-9_-]+\/)?[A-Za-z0-9_-]+)@[0-9][A-Za-z0-9.+-]* typecheck$/u;
export function extractTypecheckLocations(stdout:string,stderr:string):TypecheckLocation[]{
  const lines=(stdout+"\n"+stderr).slice(0,100_000).split(/\r?\n/u).slice(0,1000);
  const candidates:TypecheckLocation[]=[];
  let workspaceRoot:string|null=null;
  for(const line of lines){
    const banner=BANNER.exec(line);
    if(banner){
      // An unknown banner must not inherit the previous workspace root.
      workspaceRoot=WORKSPACE_ROOTS[banner[1]!]??null;
      continue;
    }
    // tsc plain: src/file.ts(12,8): error TS2322: message
    const m=/^([^\r\n]{1,181})\(([0-9]{1,6}),([0-9]{1,5})\): error (TS[0-9]{4,5}):/u.exec(line);
    // tsc pretty: src/file.ts:12:8 - error TS2322: message
    const n=m?null:/^([^\r\n]{1,181}):([0-9]{1,6}):([0-9]{1,5}) - error (TS[0-9]{4,5}):/u.exec(line);
    const hit=m??n;
    if(!hit)continue;
    const rawPath=hit[1];
    // Only a recognized npm banner may expand src/; no traversal, absolute
    // path, or unknown workspace can gain an implied repository root.
    const path=workspaceRoot!==null&&rawPath.startsWith("src/")
      ?workspaceRoot+"/"+rawPath:rawPath;
    const row={path,line:Number(hit[2]),column:Number(hit[3]),code:hit[4]};
    if(sanitizeTypecheckLocations([row]).length){
      candidates.push(row);
      if(candidates.length>=MAX_ITEMS)break;
    }
  }
  return candidates;
}
