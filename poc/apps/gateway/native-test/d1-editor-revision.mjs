/** Private owner check over existing Gateway-observed effects. No model claims. */
export function verifyD1EditorRevision({task, binding, writes, branch, previousSha, headSha}) {
  const sha=/^[a-f0-9]{40}$/u;
  const fail=category=>{
    const error=new Error("D1 editor revision rejected: "+category);
    error.category=category;
    throw error;
  };
  if(!binding||binding.taskId!==task.task_id||binding.runtimeTaskId!==task.runtime_task_id||
     binding.credentialId!==task.credential_id||binding.failedSha!==previousSha||
     !sha.test(previousSha)||!sha.test(headSha))fail("revision_baseline_mismatch");
  const own=writes.filter(x=>x.taskId===task.task_id);
  if(!own.length)fail("no_confirmed_editor_write");
  if(own.some(x=>x.role!==task.role||x.runtimeTaskId!==task.runtime_task_id||
     x.credentialId!==task.credential_id||x.branch!==branch||
     x.operation!=="update_file"||!binding.paths.includes(x.path)||
     !sha.test(x.commitSha)||!Number.isSafeInteger(x.sequence)))
    fail("editor_effect_binding_mismatch");
  const latest=own.reduce((a,b)=>a.sequence>b.sequence?a:b);
  if(latest.commitSha!==headSha)fail("provider_head_mismatch");
  if(headSha===previousSha)fail("unchanged_editor_revision");
  return headSha;
}
