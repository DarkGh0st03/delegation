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
 * Workspace roots (package name -> repository directory) come from the
 * repository's own npm workspaces, read by the Runner in the throw-away
 * container; they only map diagnostic paths and are sanitized here.
 * Unknown workspace banners disable relative-path expansion.
 */
export type WorkspaceRoots=Readonly<Record<string,string>>;
const WORKSPACE_NAME=/^(?:@[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+$/u;
const WORKSPACE_DIR=/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+){0,4}$/u;
/** Bounded, relative-path-only workspace map (untrusted repository data). */
export function sanitizeWorkspaceRoots(raw:unknown):WorkspaceRoots{
  const out:Record<string,string>=Object.create(null);
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return Object.freeze(out);
  for(const [name,dir] of Object.entries(raw).slice(0,100)){
    if(WORKSPACE_NAME.test(name)&&typeof dir==="string"&&WORKSPACE_DIR.test(dir)&&
       !dir.split("/").some(part=>part==="."||part===".."))out[name]=dir;
  }
  return Object.freeze(out);
}
/** Fixed Runner script (never repository-supplied): prints the npm
 * workspace map of /workspace as JSON, or {} when there is none. */
export const WORKSPACE_ROOTS_SCRIPT=
  'const fs=require("fs"),p=require("path"),r="/workspace",o={};try{'+
  'const k=JSON.parse(fs.readFileSync(r+"/package.json","utf8"));let w=k.workspaces;'+
  'if(w&&!Array.isArray(w))w=w.packages;for(const g of Array.isArray(w)?w.slice(0,50):[]){'+
  'if(typeof g!=="string")continue;const ds=g.endsWith("/*")?fs.readdirSync(p.join(r,g.slice(0,-2)))'+
  '.map(d=>g.slice(0,-2)+"/"+d):[g];for(const d of ds.slice(0,100)){try{'+
  'const q=JSON.parse(fs.readFileSync(p.join(r,d,"package.json"),"utf8"));'+
  'if(typeof q.name==="string")o[q.name]=d;}catch{}}}}catch{}process.stdout.write(JSON.stringify(o));';
const BANNER=/^> ((?:@[A-Za-z0-9_-]+\/)?[A-Za-z0-9_-]+)@[0-9][A-Za-z0-9.+-]* typecheck$/u;
export function extractTypecheckLocations(stdout:string,stderr:string,
  workspaceRoots:WorkspaceRoots={}):TypecheckLocation[]{
  const lines=(stdout+"\n"+stderr).slice(0,100_000).split(/\r?\n/u).slice(0,1000);
  const candidates:TypecheckLocation[]=[];
  let workspaceRoot:string|null=null;
  for(const line of lines){
    const banner=BANNER.exec(line);
    if(banner){
      // An unknown banner must not inherit the previous workspace root.
      workspaceRoot=Object.hasOwn(workspaceRoots,banner[1]!)?workspaceRoots[banner[1]!]!:null;
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

/** A compiler error with its message, as a developer reads it in CI.
 * The message is produced by code agents wrote: UNTRUSTED DATA, bounded,
 * one line, no source snippet; it grants nothing and is filtered again
 * against the signed read scope before any model sees it. */
export interface TypecheckError {
  readonly file:string;readonly line:number;readonly code:string;readonly message:string;
}
const MAX_TYPECHECK_MESSAGE=300;
// Every control and bidirectional character, newline included (one line).
const UNSAFE=new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]","gu");
export function cleanTypecheckMessage(raw:unknown):string{
  if(typeof raw!=="string")return "";
  const text=raw.slice(0,2000).replace(/\x1b\[[0-9;?]*[A-Za-z]/gu,"")
    .replace(UNSAFE," ").replace(/\s+/gu," ").trim();
  return text.length<=MAX_TYPECHECK_MESSAGE?text:text.slice(0,MAX_TYPECHECK_MESSAGE-1)+"…";
}
export function sanitizeTypecheckErrors(raw:unknown):TypecheckError[]{
  if(!Array.isArray(raw)||raw.length>MAX_ITEMS)return [];
  const out:TypecheckError[]=[];
  for(const item of raw){
    if(!item||typeof item!=="object"||Array.isArray(item))return [];
    const x=item as Record<string,unknown>;
    if(Object.keys(x).sort().join(",")!=="code,file,line,message"||
       !permittedPath(x.file)||typeof x.code!=="string"||!CODE.test(x.code)||
       typeof x.line!=="number"||!Number.isSafeInteger(x.line)||x.line<1||x.line>100000||
       typeof x.message!=="string"||!x.message||cleanTypecheckMessage(x.message)!==x.message)
      return [];
    out.push(Object.freeze({file:x.file,line:x.line,code:x.code,message:x.message}));
  }
  return out;
}
/** Runner side: tsc error lines (plain or pretty) with their message. */
export function extractTypecheckErrors(stdout:string,stderr:string,
  workspaceRoots:WorkspaceRoots={}):TypecheckError[]{
  const lines=(stdout+"\n"+stderr).slice(0,100_000).replace(/\x1b\[[0-9;?]*[A-Za-z]/gu,"")
    .split(/\r?\n/u).slice(0,1000);
  const out:TypecheckError[]=[];
  let workspaceRoot:string|null=null;
  for(const line of lines){
    const banner=BANNER.exec(line);
    if(banner){workspaceRoot=Object.hasOwn(workspaceRoots,banner[1]!)?workspaceRoots[banner[1]!]!:null;continue;}
    const m=/^([^\r\n]{1,181})\(([0-9]{1,6}),[0-9]{1,5}\): error (TS[0-9]{4,5}): (.*)$/u.exec(line)??
      /^([^\r\n]{1,181}):([0-9]{1,6}):[0-9]{1,5} - error (TS[0-9]{4,5}): (.*)$/u.exec(line);
    if(!m)continue;
    const file=workspaceRoot!==null&&m[1]!.startsWith("src/")?workspaceRoot+"/"+m[1]:m[1]!;
    const row={file,line:Number(m[2]),code:m[3]!,message:cleanTypecheckMessage(m[4])};
    if(row.message&&sanitizeTypecheckErrors([row]).length){
      out.push(Object.freeze(row));
      if(out.length>=MAX_ITEMS)break;
    }
  }
  return out;
}
