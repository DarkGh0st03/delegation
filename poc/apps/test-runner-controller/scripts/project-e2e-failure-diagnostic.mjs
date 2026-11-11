/** Fixed demo check IDs and numeric locations only. Never echo test output,
 * source, paths, titles, expected/received values or credentials. Diagnostic
 * observations are untrusted and do not authorize repair. */
const IDS={"user-profile":"baseline_user_profile","account-suspension":"account_suspension"};
const KINDS=["visibility","url","strict_locator","connection_refused","startup_port_timeout","test_timeout"];
const exact=(x,keys)=>x&&typeof x==="object"&&!Array.isArray(x)&&
  Object.keys(x).sort().join(",")===keys.slice().sort().join(",");
export function safeProjectE2eFailureDiagnostic(raw){
  if(!exact(raw,["locations","failure_kinds","timed_out","unclassified_failure"])||
     !Array.isArray(raw.locations)||raw.locations.length>8||
     !Array.isArray(raw.failure_kinds)||raw.failure_kinds.length>6||
     new Set(raw.failure_kinds).size!==raw.failure_kinds.length||
     raw.failure_kinds.some(k=>!KINDS.includes(k))||
     typeof raw.timed_out!=="boolean"||typeof raw.unclassified_failure!=="boolean"||
     raw.unclassified_failure!==(raw.locations.length===0||raw.failure_kinds.length===0)||
     raw.locations.some(x=>!exact(x,["check_id","line","column"])||
       !Object.values(IDS).includes(x.check_id)||
       !Number.isSafeInteger(x.line)||x.line<1||x.line>100000||
       !Number.isSafeInteger(x.column)||x.column<1||x.column>10000))return null;
  return Object.freeze({locations:Object.freeze(raw.locations.map(x=>
    Object.freeze({check_id:x.check_id,line:x.line,column:x.column}))),
    failure_kinds:Object.freeze([...raw.failure_kinds]),timed_out:raw.timed_out,
    unclassified_failure:raw.unclassified_failure});
}
export function extractProjectE2eFailureDiagnostic(stdout,stderr,timedOut){
  const text=(String(stdout)+"\n"+String(stderr)).slice(0,120000)
    .replace(/\x1b\[[0-9;]*m/gu,"");
  const locations=[];
  for(const m of text.matchAll(/(?:^|[\s/(])(?:tests\/e2e\/)?(user-profile|account-suspension)\.spec\.ts:(\d{1,6}):(\d{1,5})(?=\D|$)/gu)){
    const row={check_id:IDS[m[1]],line:Number(m[2]),column:Number(m[3])};
    if(row.line<1||row.line>100000||row.column<1||row.column>10000)continue;
    if(!locations.some(x=>JSON.stringify(x)===JSON.stringify(row)))locations.push(row);
    if(locations.length===8)break;
  }
  const patterns=[/toBeVisible\(/u,/toHaveURL\(/u,/strict mode violation/u,
    /ERR_CONNECTION_REFUSED/u,/Timed out waiting for port (?:3000|5173)/u,
    /Test timeout of \d+ms exceeded/u];
  const failure_kinds=KINDS.filter((_,i)=>patterns[i].test(text));
  return safeProjectE2eFailureDiagnostic({locations,failure_kinds,timed_out:timedOut===true,
    unclassified_failure:locations.length===0||failure_kinds.length===0});
}
