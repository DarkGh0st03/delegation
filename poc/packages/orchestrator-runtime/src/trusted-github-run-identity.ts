/** GitHub Actions run metadata corroboration shared by independently
 * pinned paid and scripted-only OIDC profiles. READ-ONLY. No paid
 * imports, credentials, Planner, A2A or authority can enter this module.
 * Both profiles must separately authenticate their own RS256 workflow
 * assertion, exact manual inputs and protected HMAC admission.
 */
import type {PinnedGithubDispatch,ReviewedGithubDispatchRequest}
  from "./trusted-manual-github-dispatch.ts";

function deny(reason:string):never{
  throw Error("Trusted Github manual dispatch: "+reason);
}
export async function verifyGithubManualRunViaApi(input:{
  dispatch:Pick<ReviewedGithubDispatchRequest,"run_id"|"source_sha">;
  pinned:PinnedGithubDispatch;
  githubApiToken:string|undefined;
  fetchFn?:typeof fetch;
  nowMs?:number;
}):Promise<void>{
  const {dispatch,pinned}=input;
  if(!input.githubApiToken?.trim())deny("trusted GitHub API token missing");
  if(!pinned.sourceSha||pinned.sourceSha!==dispatch.source_sha)
    deny("host must independently pin the workflow source revision");
  const url="https://api.github.com/repos/"+
    pinned.repository+"/actions/runs/"+dispatch.run_id;
  let result:Response;
  try{
    result=await (input.fetchFn??fetch)(url,{
      headers:{
        authorization:"Bearer "+input.githubApiToken,
        accept:"application/vnd.github+json",
        "x-github-api-version":"2022-11-28"
      },
      signal:AbortSignal.timeout(10000)
    });
  }catch{
    deny("trusted GitHub API run metadata unavailable");
  }
  if(!result.ok)deny("trusted GitHub API run metadata rejected");
  let run:Record<string,any>;
  try{run=await result.json() as Record<string,any>;}
  catch{deny("malformed trusted GitHub run metadata");}
  const created=Date.parse(run.created_at);
  const now=input.nowMs??Date.now();
  if(!Number.isFinite(created)||!Number.isFinite(now)||
     created>now+60000||now-created>2*60*60*1000)
    deny("manual workflow run is too old or premature");
  if(String(run.id)!==dispatch.run_id||
     run.event!=="workflow_dispatch"||run.run_attempt!==1||
     run.status!=="in_progress"||
     run.head_sha!==dispatch.source_sha||
     run.head_branch!==pinned.ref.slice("refs/heads/".length)||
     run.path!==pinned.workflowPath||
     run.head_repository?.full_name!==pinned.repository)
    deny("GitHub API does not corroborate active manual run identity");
}

