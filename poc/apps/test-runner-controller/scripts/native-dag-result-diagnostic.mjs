/**
 * Structured, secret-free failure diagnostics for the disposable native
 * signed DAG's REAL Docker acceptance. Child stderr can contain source,
 * credentials or untrusted test output and must NEVER be printed verbatim.
 */
const PREFIX="[native-dag-adk] docker_phase_status ";
const PHASES=Object.freeze([
  "dependency_install","typecheck","backend_tests","frontend_tests",
  "build","playwright_e2e","researcher_acceptance"
]);
const STATES=new Set(["pass","fail","skipped"]);
function parseExact(marker){
  if(!marker||typeof marker!=="object"||Array.isArray(marker)||
     !["pass","fail"].includes(marker.status)||
     !["pass","fail"].includes(marker.project_tests)||
     !STATES.has(marker.researcher_acceptance)||
     !Array.isArray(marker.phases)||marker.phases.length!==PHASES.length)
    return null;
  const statuses=[];
  for(let i=0;i<PHASES.length;i++){
    const p=marker.phases[i];
    if(!p||typeof p!=="object"||p.phase!==PHASES[i]||
       !STATES.has(p.status))return null;
    statuses.push(Object.freeze({phase:PHASES[i],status:p.status}));
  }
  const firstFailed=statuses.find(x=>x.status==="fail");
  if(marker.status==="fail"&&!firstFailed ||
     marker.status==="pass"&&statuses.some(x=>x.status!=="pass")||
     marker.status==="pass"&&(
       marker.project_tests!=="pass"||marker.researcher_acceptance!=="pass"))
    return null;
  return Object.freeze({
    status:marker.status,
    first_failed_phase:firstFailed?.phase??null,
    phases:Object.freeze(statuses),
    project_tests:marker.project_tests,
    researcher_acceptance:marker.researcher_acceptance
  });
}
/** Returns only enums from known fixed phases. No arbitrary stderr copied. */
export function safeNativeDockerFailureDiagnostic(stderr){
  if(!Buffer.isBuffer(stderr)&&typeof stderr!=="string")return null;
  const raw=(Buffer.isBuffer(stderr)?stderr.toString("utf8"):stderr);
  const tail=raw.slice(-256*1024);
  const lines=tail.split(/\r?\n/u);
  for(let i=lines.length-1;i>=0;i--){
    const line=lines[i];
    if(!line.startsWith(PREFIX)||line.length>4096)continue;
    try{
      const result=parseExact(JSON.parse(line.slice(PREFIX.length)));
      if(result)return result;
    }catch{/* invalid log event: do not print its content */}
  }
  return null;
}
