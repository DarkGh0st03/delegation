/**
 * Pinned, deterministic functional changes for the offline positive DAG.
 * These are TEST scripts, NOT code authored by Gemini or by an LLM.
 * They intentionally affect observable application behavior, not comments.
 * Every transformation is anchored to the exact reference source.
 */
import {getApprovedOfflineScenario} from
  "../fixtures/approved-scenarios.mjs";

export const APPROVED_FUNCTIONAL_CHANGES=Object.freeze({
  backend:{
    path:"apps/backend/src/users/user.service.ts",
    label:"stable alphabetical ordering of user summaries"
  },
  frontend:{
    path:"apps/frontend/src/pages/UserDetailPage.tsx",
    label:"accessible live feedback for profile/status actions"
  }
});

function replaceExactlyOnce(source,oldText,newText){
  const first=source.indexOf(oldText);
  if(first<0||source.indexOf(oldText,first+1)>=0)
    throw Error("Pinned functional edit requires one exact source anchor");
  return source.slice(0,first)+newText+source.slice(first+oldText.length);
}

export function approvedFunctionalEdit(role,source,
  scenarioId=process.env.APPROVED_RUNNER_SCENARIO){
  const entry=APPROVED_FUNCTIONAL_CHANGES[role];
  const approved=getApprovedOfflineScenario(scenarioId);
  if(!entry||typeof source!=="string"||
     source!==approved.files[entry.path]){
    throw Error("Functional edit refused: role or pinned source differs");
  }
  if(role==="backend"){
    // Match the complete listUsers method: Department Directory adds
    // another summary mapping and a trailing-only anchor becomes ambiguous.
    const before="  listUsers(): UserSummary[] {\n    return this.repository.findAll().map(({ id, displayName, email, status }) => ({\n      id,\n      displayName,\n      email,\n      status\n    }));\n  }";
    const after="  listUsers(): UserSummary[] {\n    return this.repository.findAll().map(({ id, displayName, email, status }) => ({\n      id,\n      displayName,\n      email,\n      status\n    })).sort((a, b) => a.displayName.localeCompare(b.displayName));\n  }";
    return replaceExactlyOnce(source,before,after);
  }
  if(role==="frontend"){
    let modified=replaceExactlyOnce(source,
      '{message ? <p className="success-message">{message}</p> : null}',
      '{message ? <p className="success-message" role="status" aria-live="polite">{message}</p> : null}');
    modified=replaceExactlyOnce(modified,
      '{error ? <p className="error-message">{error}</p> : null}',
      '{error ? <p className="error-message" role="alert">{error}</p> : null}');
    return modified;
  }
  throw Error("Unsupported pinned functional edit role");
}
