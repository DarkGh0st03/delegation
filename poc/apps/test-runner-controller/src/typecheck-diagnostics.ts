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
export function extractTypecheckLocations(stdout:string,stderr:string):TypecheckLocation[]{
  const lines=(stdout+"\n"+stderr).slice(0,100_000).split(/\r?\n/u).slice(0,1000);
  const candidates:TypecheckLocation[]=[];
  for(const line of lines){
    // tsc plain: src/file.ts(12,8): error TS2322: message
    const m=/^([^\r\n]{1,181})\(([0-9]{1,6}),([0-9]{1,5})\): error (TS[0-9]{4,5}):/u.exec(line);
    // tsc pretty: src/file.ts:12:8 - error TS2322: message
    const n=m?null:/^([^\r\n]{1,181}):([0-9]{1,6}):([0-9]{1,5}) - error (TS[0-9]{4,5}):/u.exec(line);
    const hit=m??n;
    if(!hit)continue;
    const row={path:hit[1],line:Number(hit[2]),column:Number(hit[3]),code:hit[4]};
    if(sanitizeTypecheckLocations([row]).length){
      candidates.push(row);
      if(candidates.length>=MAX_ITEMS)break;
    }
  }
  return candidates;
}
