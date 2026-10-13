/**
 * A narrow, deterministic integration preflight for the IAM Console case.
 *
 * This is an EARLY FAIL-CLOSED CONTRACT CHECK, NOT TEST SUCCESS, not an LLM
 * evaluation, and not a substitute for the real Docker Runner or researcher
 * acceptance. It detects the cross-role API mismatch found in billed run
 * #38372616301 before the Test Agent incurs additional Gemini calls.
 *
 * Analyze ONLY the three allowlisted generated files from ephemeral Gitea.
 * Never accept arbitrary paths or log generated code/credentials.
 */
export interface AccountSuspensionPreflightSources {
  backendRoutes: string;
  frontendApi: string;
  frontendPage: string;
}
export interface AccountSuspensionPreflightResult {
  ok: boolean;
  failures: string[];
}

function routeDeclared(source: string, action: "suspend"|"reactivate"): boolean {
  // This thesis fixture uses a minimal Express router. A missing exact route
  // is a contract violation, regardless of whether some differently named
  // endpoint was implemented. Checking source is only a *negative* signal.
  const route = `/:id/${action}`;
  const match = /\b(?:router|app)\s*\.\s*post\s*\(\s*["'`][^"'`]+["'`]/gu;
  return [...source.matchAll(match)].some(hit=>hit[0].includes(route));
}

function frontendCalls(source: string, action: "suspend"|"reactivate"): boolean {
  // Supports fetch template literals and string concatenation without ever
  // evaluating generated code or inspecting the model's prompt history.
  return source.includes(`/${action}`);
}

export function checkAccountSuspensionPreflight(
  sources: AccountSuspensionPreflightSources
): AccountSuspensionPreflightResult {
  const failures: string[]=[];
  for(const action of ["suspend","reactivate"] as const){
    if(!routeDeclared(sources.backendRoutes,action)){
      failures.push(`backend_missing_post_/:id/${action}`);
    }
    if(!frontendCalls(sources.frontendApi,action)){
      failures.push(`frontend_missing_/${action}_api_call`);
    }
  }
  if(!/\bSuspend account\b/iu.test(sources.frontendPage)){
    failures.push("frontend_missing_accessible_suspend_account_action");
  }
  if(!/\bReactivate account\b/iu.test(sources.frontendPage)){
    failures.push("frontend_missing_accessible_reactivate_account_action");
  }
  return {ok:failures.length===0,failures};
}
