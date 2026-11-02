import {sanitizeVitestFailureFiles,type VitestPhase} from "./vitest-failure-files.ts";
/** Private diagnostics only. Test-controlled titles/messages are untrusted data,
 * never causal proof, signed grants, public telemetry or model instructions. */
export function extractPrivateVitestFailures(raw:string,phase:VitestPhase){
 const empty={status:"unavailable" as const,failures:[]};
 if(Buffer.byteLength(raw,"utf8")>1024*1024)return empty;
 let report:any;try{report=JSON.parse(raw);}catch{return empty;}
 if(!report||report.success!==false||!Array.isArray(report.testResults)||report.testResults.length>1000)return empty;
 const failures:Array<{path:string;test_id:string;failure_messages:string[]}>=[];
 for(const suite of report.testResults){
  if(typeof suite?.name!=="string"||!Array.isArray(suite.assertionResults))continue;
  const path=suite.name.startsWith("/workspace/")?suite.name.slice(11):suite.name;
  if(sanitizeVitestFailureFiles([path],phase).length!==1)continue;
  for(const assertion of suite.assertionResults.slice(0,1000)){
   if(assertion?.status!=="failed"||typeof assertion.fullName!=="string"||
      assertion.fullName.length>500||!Array.isArray(assertion.failureMessages))continue;
   const messages=assertion.failureMessages.slice(0,2).filter((x:unknown):x is string=>typeof x==="string")
    .map((x:string)=>x.slice(0,8000));
   if(!messages.length)continue;
   failures.push({path,test_id:assertion.fullName,failure_messages:messages});
   if(failures.length===16)return {status:"captured" as const,failures};
  }
 }
 return failures.length?{status:"captured" as const,failures}:empty;
}
