/**
 * Owner-private Test-edit selection after an AUTHENTIC, classified Docker
 * project-test FAIL. Neither file creation nor a failed assertion proves a
 * test is wrong; this only constrains the authorized investigation to the
 * intersection of failed Test files and confirmed original Test creations.
 *
 * No path or file bytes should appear in public diagnostics. The subsequent
 * signed epoch/VP/OPA checks still decide every read and update.
 */
import {sanitizeVitestFailureFiles}
  from "../../test-runner-controller/src/vitest-failure-files.ts";

const SHA=/^[a-f0-9]{40}$/u;
const deny=()=>{throw Error("Failed created Test selection NO-GO");};

export function verifiedFailedCreatedTestPaths({
 runnerOutcome,originalCreatedPaths,branch,failedSha
}={}){
 if(!runnerOutcome||runnerOutcome.provider!=="runner"||
    runnerOutcome.performed!==true||runnerOutcome.tool!=="run_tests"||
    runnerOutcome.status!=="fail"||
    runnerOutcome.project_tests?.status!=="fail"||
    runnerOutcome.researcher_acceptance?.status!=="skipped"||
    !SHA.test(failedSha??"")||
    runnerOutcome.tested_commit_sha!==failedSha||
    runnerOutcome.revision!==failedSha||
    runnerOutcome.branch!==branch||
    !(originalCreatedPaths instanceof Set)||
    originalCreatedPaths.size>32||
    [...originalCreatedPaths].some(x=>typeof x!=="string"||
      x.length>180||x.includes("\\")||x.includes("//")||
      x.split("/").some(v=>v==="."||v==="..")))
  deny();
 const failures=Array.isArray(runnerOutcome.phases)
  ?runnerOutcome.phases.filter(p=>p?.status==="fail"):[];
 if(failures.length!==1||
    !["backend_tests","frontend_tests"].includes(failures[0].phase))
  deny();
 const raw=runnerOutcome.failing_test_files;
 const failed=sanitizeVitestFailureFiles(raw,failures[0].phase);
 // Reject partly sanitizable sets; silently dropping paths would conceal an
 // incomplete diagnosis and could make the model choose the wrong edit.
 if(!Array.isArray(raw)||failed.length!==raw.length||failed.length===0)
  deny();
 const selected=failed.filter(p=>originalCreatedPaths.has(p)).sort();
 if(selected.length===0)deny();
 return Object.freeze(selected);
}
