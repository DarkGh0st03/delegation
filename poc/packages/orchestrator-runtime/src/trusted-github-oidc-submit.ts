/**
 * Non-billable runner-side private OIDC admission client. NOT a Gemini or
 * Engineer approval interface and NEVER invoked by the paid workflow here.
 *
 * GitHub's id-token request is authenticated by the runner-provided bearer
 * token. The JWT and event are submitted in ONE request to an independently
 * configured HTTPS/mTLS host. Never log or persist the JWT, bearer, key or
 * response body; a failure is not an authorization to execute anything.
 *
 * This assumes a trusted private network path to the Engineer's HTTPS
 * endpoint. A GitHub-hosted runner cannot reach its localhost listener.
 */
import {request as httpsRequest} from "node:https";

const ADMISSION_PATH="/v1/trusted/github/oidc-admission";
const MAX_BODY_BYTES=48*1024;
const ENV_KEYS=[
  "GITHUB_ACTIONS","GITHUB_EVENT_NAME","GITHUB_RUN_ATTEMPT",
  "GITHUB_REPOSITORY","GITHUB_REF","GITHUB_WORKFLOW_REF",
  "GITHUB_SHA","GITHUB_RUN_ID"
] as const;

function fail():never{
  throw Error("Trusted GitHub private OIDC admission denied");
}
export interface TrustedGithubRunnerSubmission{
  tokenRequestUrl:string;
  tokenRequestBearer:string;
  audience:string;
  intakeUrl:string;
  env:Record<typeof ENV_KEYS[number],string>;
  event:unknown;
  /** CA for verifying the server, plus runner client cert and private key. */
  tls:{ca:string|Buffer;cert:string|Buffer;key:string|Buffer};
  /** Offline unit fixture; never fill with data from the event. */
  oidcFetchFn?:typeof fetch;
}
export async function submitTrustedGithubOidcFromRunner(
  input:TrustedGithubRunnerSubmission
):Promise<Readonly<{status:"authenticated_only_not_engineer_approved";
                      run_id:string;source_sha:string}>>{
  if(!input||typeof input.audience!=="string"||
     input.audience.length<16||input.audience.length>512||
     typeof input.tokenRequestBearer!=="string"||
     !input.tokenRequestBearer.trim()||
     !input.tls||["ca","cert","key"].some(field=>{
       const v=input.tls[field as keyof typeof input.tls];
       return !(typeof v==="string"||Buffer.isBuffer(v))||
         !v.length||v.length>128*1024;
     })||
     typeof input.env!=="object"||!input.env||
     ENV_KEYS.some(x=>typeof input.env[x]!=="string")||
     input.env.GITHUB_ACTIONS!=="true"||
     input.env.GITHUB_EVENT_NAME!=="workflow_dispatch"||
     input.env.GITHUB_RUN_ATTEMPT!=="1"||
     !/^[0-9a-f]{40}$/u.test(input.env.GITHUB_SHA)||
     !/^[1-9]\d{0,19}$/u.test(input.env.GITHUB_RUN_ID))
    fail();
  let issuerUrl:URL,endpoint:URL;
  try{
    issuerUrl=new URL(input.tokenRequestUrl);
    endpoint=new URL(input.intakeUrl);
  }catch{fail();}
  // Reject redirects and any attacker-controlled token request destination.
  if(issuerUrl!.protocol!=="https:"||
     issuerUrl!.hostname!=="pipelines.actions.githubusercontent.com"||
     issuerUrl!.username||issuerUrl!.password||issuerUrl!.hash||
     endpoint!.protocol!=="https:"||
     endpoint!.pathname!==ADMISSION_PATH||
     endpoint!.search||endpoint!.hash||
     endpoint!.username||endpoint!.password)
    fail();
  issuerUrl!.searchParams.set("audience",input.audience);
  let jwt:string;
  try{
    const response=await (input.oidcFetchFn??fetch)(issuerUrl!,{
      method:"GET",headers:{
        authorization:"Bearer "+input.tokenRequestBearer,
        accept:"application/json"
      },redirect:"error",signal:AbortSignal.timeout(10000)
    });
    if(!response.ok)fail();
    const raw=await response.text();
    if(raw.length>20000)fail();
    const parsed=JSON.parse(raw);
    jwt=parsed?.value;
    if(typeof jwt!=="string"||jwt.length<100||jwt.length>16000||
       !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(jwt))
      fail();
  }catch{fail();}
  const body=JSON.stringify({env:input.env,event:input.event,oidcJwt:jwt!});
  if(Buffer.byteLength(body,"utf8")>MAX_BODY_BYTES)fail();
  return new Promise((resolve,reject)=>{
    let settled=false;
    function denied(){
      if(settled)return;
      settled=true;
      reject(Error("Trusted GitHub private OIDC admission denied"));
    }
    const req=httpsRequest(endpoint!,{
      method:"POST",ca:input.tls.ca,cert:input.tls.cert,
      key:input.tls.key,rejectUnauthorized:true,minVersion:"TLSv1.2",
      headers:{"content-type":"application/json",
        "content-length":Buffer.byteLength(body,"utf8")},
      timeout:12000
    },res=>{
      const chunks:Buffer[]=[];
      let size=0;
      res.on("data",(chunk:Buffer)=>{
        size+=chunk.length;
        if(size>4096){req.destroy();denied();return;}
        chunks.push(chunk);
      });
      res.on("end",()=>{
        if(settled)return;
        try{
          const parsed=JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if(res.statusCode!==200||
             parsed?.status!=="github_job_authenticated_only_not_engineer_approved"||
             parsed?.engineer_approval!=="not_checked"||
             parsed?.operational_credential!=="not_issued"||
             parsed?.gemini_calls!==0||
             parsed?.run_id!==input.env.GITHUB_RUN_ID||
             parsed?.source_sha!==input.env.GITHUB_SHA)
            {denied();return;}
          settled=true;
          resolve(Object.freeze({
            status:"authenticated_only_not_engineer_approved",
            run_id:parsed.run_id,source_sha:parsed.source_sha
          }));
        }catch{denied();}
      });
      res.on("error",denied);
    });
    req.on("timeout",()=>{req.destroy();denied();});
    req.on("error",denied);
    req.end(body,"utf8");
  });
}
