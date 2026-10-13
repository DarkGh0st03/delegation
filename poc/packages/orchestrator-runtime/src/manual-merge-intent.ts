/**
 * Explicit human dispatch intent for the privileged Gitea merge operation.
 *
 * This module verifies the operator's verbatim request BEFORE secrets are
 * loaded. An approval review and trusted CI still must be independently
 * verified against Gitea by TrustedGiteaMergeExecutor.
 *
 * Do not expose this module as an ADK/MCP/Gateway tool.
 */
const SHA=/^[0-9a-f]{40}$/u;
const LOGIN=/^[a-zA-Z0-9-]{1,39}$/u;
const REF="refs/heads/main";

export type ManualMergeIntentReason=
  |"invalid_dispatch"|"untrusted_dispatch_actor"|"invalid_merge_intent";

export class ManualMergeIntentDenied extends Error {
  readonly reason:ManualMergeIntentReason;
  constructor(reason:ManualMergeIntentReason){
    super("Manual merge intent denied: "+reason);
    this.name="ManualMergeIntentDenied";
    this.reason=reason;
  }
}

export interface ManualMergeDispatch {
  eventName:string|undefined;
  actor:string|undefined;
  triggeringActor:string|undefined;
  authorizedActor:string|undefined;
  ref:string|undefined;
  pr:string|undefined;
  sha:string|undefined;
  confirmation:string|undefined;
}
export interface ValidManualMergeIntent {
  pullRequestNumber:number;
  expectedHeadSha:string;
  authorizedGitHubActor:string;
}

export function expectedMergeConfirmation(pr:number,sha:string):string {
  return "MERGE PR #"+pr+" AT "+sha;
}

/** No user-controlled repo URL, branch, merge method or bypass flags. */
export function validateManualMergeIntent(
  value:ManualMergeDispatch
):ValidManualMergeIntent {
  if(value.eventName!=="workflow_dispatch"||value.ref!==REF){
    throw new ManualMergeIntentDenied("invalid_dispatch");
  }
  // A re-run by a different actor must not inherit the original dispatch
  // authorization. The configured username is set by repo administrators.
  if(!value.authorizedActor||!LOGIN.test(value.authorizedActor)||
    !value.actor||!LOGIN.test(value.actor)||
    !value.triggeringActor||!LOGIN.test(value.triggeringActor)||
    value.authorizedActor.toLowerCase()!==value.actor.toLowerCase()||
    value.triggeringActor.toLowerCase()!==value.actor.toLowerCase()){
    throw new ManualMergeIntentDenied("untrusted_dispatch_actor");
  }
  const rawPr=value.pr;
  if(typeof rawPr!=="string"||
    !/^[1-9][0-9]{0,8}$/u.test(rawPr)||
    !Number.isSafeInteger(Number(rawPr))||
    typeof value.sha!=="string"||!SHA.test(value.sha)||
    value.confirmation!==expectedMergeConfirmation(Number(rawPr),value.sha)){
    throw new ManualMergeIntentDenied("invalid_merge_intent");
  }
  return Object.freeze({
    pullRequestNumber:Number(rawPr),
    expectedHeadSha:value.sha,
    authorizedGitHubActor:value.actor
  });
}
