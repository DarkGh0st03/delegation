/**
 * R151.9: select executable repair task IDs ONLY from an independently
 * verified, signed owner epoch. Never trust a model's chosen name, URL,
 * role, credentials, predecessor completion or permission claims here.
 *
 * Current native proof supports exactly one Backend edit and one subsequent
 * Test validation. Other model DAG shapes are rejected, not silently
 * coerced into these two operations. General multi-role scheduling is a
 * separate extension and must independently validate each new role.
 */
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DIGEST=/^[a-f0-9]{64}$/u;
const deny=()=>{throw Error("R151 signed owner D1 task selection NO-GO");};
export function selectSignedNativeD1Tasks({epoch,planDigest,fileUri,branchUri,
 repairRole="backend"}={}){
 const tasks=epoch?.plan?.tasks,grants=epoch?.plan?.requested_permissions;
 if(epoch?.epoch!==2||epoch?.plan_digest!==planDigest||
    !DIGEST.test(planDigest??"")||
    !Array.isArray(tasks)||tasks.length!==2||
    !Array.isArray(grants)||grants.length<3||grants.length>10||
    typeof fileUri!=="string"||typeof branchUri!=="string"||
    !fileUri.startsWith(branchUri+"/files/")||
    !["backend","frontend"].includes(repairRole)||
    tasks.some(t=>!ID.test(t?.id??"")||
      ![repairRole,"test"].includes(t?.agent_id)||
      !Array.isArray(t.depends_on))||
    new Set(tasks.map(t=>t.id)).size!==tasks.length)
  deny();
 const repair=tasks.find(t=>t.agent_id===repairRole);
 const test=tasks.find(t=>t.agent_id==="test");
 if(!repair||!test||repair.depends_on.length!==0||
    test.depends_on.length!==1||
    test.depends_on[0]!==repair.id||
    tasks.some(t=>t.depends_on.includes(t.id)))
  deny();
 const actual=grants.map(g=>[g.task_id,g.agent_id,g.operation,g.resource]);
 const expected=[
  [repair.id,repairRole,"read_file",fileUri],
  [repair.id,repairRole,"update_file",fileUri],
  [test.id,"test","run_tests",branchUri]
 ];
 if(actual.length!==expected.length||
    new Set(actual.map(x=>JSON.stringify(x))).size!==actual.length||
    !expected.every(row=>actual.some(other=>
      JSON.stringify(row)===JSON.stringify(other))))
  deny();
 return Object.freeze(repairRole==="backend"
  ?{backendTaskId:repair.id,testTaskId:test.id}
  :{frontendTaskId:repair.id,testTaskId:test.id});
}


/** R151.74.1: derive the entire multi-file repair schedule ONLY from
 * the already admitted signed epoch. The original host supplies the exact
 * per-role files it previously wrote; no model-supplied file list is trusted.
 * This selects IDs and ordering, not authority, credentials or effects. */
export function selectSignedNativeMultiD1Tasks({
 epoch,planDigest,branchUri,originalFilesByRole,requireBothRoles=true
}={}){
 const tasks=epoch?.plan?.tasks,grants=epoch?.plan?.requested_permissions;
 if(epoch?.epoch!==2||epoch?.plan_digest!==planDigest||
    !DIGEST.test(planDigest??"")||
    typeof branchUri!=="string"||!branchUri.startsWith("gitea://")||
    typeof requireBothRoles!=="boolean"||
    !Array.isArray(tasks)||tasks.length<(requireBothRoles?3:2)||tasks.length>9||
    !Array.isArray(grants)||grants.length<(requireBothRoles?5:3)||grants.length>33||
    !originalFilesByRole||typeof originalFilesByRole!=="object")
  deny();
 if(["backend","frontend"].some(role=>
    !Array.isArray(originalFilesByRole[role])||
    originalFilesByRole[role].length>16))
  deny();
 const allowed={
  backend:new Set(originalFilesByRole.backend),
  frontend:new Set(originalFilesByRole.frontend)
 };
 if(["backend","frontend"].some(role=>
    originalFilesByRole[role].length>16||
    [...allowed[role]].some(uri=>
     typeof uri!=="string"||!uri.startsWith(branchUri+"/files/"))))
  deny();
 const ids=new Set(),byId=new Map();
 for(const task of tasks){
  if(!ID.test(task?.id??"")||ids.has(task.id)||
     !["backend","frontend","test"].includes(task.agent_id)||
     !Array.isArray(task.depends_on)||task.depends_on.length>8||
     new Set(task.depends_on).size!==task.depends_on.length||
     task.depends_on.some(dep=>!ID.test(dep)||dep===task.id))
   deny();
  ids.add(task.id);byId.set(task.id,task);
 }
 const editors=tasks.filter(t=>t.agent_id!=="test");
 const test=tasks.filter(t=>t.agent_id==="test");
 if(test.length!==1||editors.length!==tasks.length-1||
    (requireBothRoles&&(!editors.some(t=>t.agent_id==="backend")||
      !editors.some(t=>t.agent_id==="frontend"))))
  deny();
 const used=new Set(),results=[];
 for(const task of editors){
  const mine=grants.filter(g=>g.task_id===task.id);
  if(mine.length<2||mine.length>16||mine.length%2!==0||
     mine.some(g=>g.agent_id!==task.agent_id||
      !allowed[task.agent_id].has(g.resource)||
      !["read_file","update_file"].includes(g.operation)))
   deny();
  const files=new Map();
  for(const grant of mine){
   let set=files.get(grant.resource);
   if(!set){set=new Set();files.set(grant.resource,set);}
   if(set.has(grant.operation))deny();
   set.add(grant.operation);
  }
  for(const [uri,ops] of files){
   if(ops.size!==2||!ops.has("read_file")||!ops.has("update_file")||
      used.has(uri))deny();
   used.add(uri);
  }
  results.push(Object.freeze({
   taskId:task.id,role:task.agent_id,
   fileUris:Object.freeze([...files.keys()].sort())
  }));
 }
 if(used.size<(requireBothRoles?2:1)||used.size>8)deny();
 const testGrants=grants.filter(g=>g.task_id===test[0].id);
 if(testGrants.length!==1||testGrants[0].agent_id!=="test"||
    testGrants[0].operation!=="run_tests"||
    testGrants[0].resource!==branchUri||
    grants.length!==testGrants.length+
     editors.reduce((n,t)=>n+grants.filter(g=>g.task_id===t.id).length,0))
  deny();
 const completed=new Set(),ordered=[];
 while(ordered.length<tasks.length){
  const next=tasks.find(t=>!completed.has(t.id)&&
    t.depends_on.every(dep=>completed.has(dep)));
  if(!next||next.depends_on.some(dep=>!byId.has(dep)))deny();
  completed.add(next.id);ordered.push(next.id);
 }
 if(ordered.at(-1)!==test[0].id)deny();
 const beforeTest=new Set(),pending=[...test[0].depends_on];
 while(pending.length){
  const id=pending.pop();
  if(beforeTest.has(id))continue;
  const task=byId.get(id);
  if(!task)deny();
  beforeTest.add(id);pending.push(...task.depends_on);
 }
 if(editors.some(t=>!beforeTest.has(t.id)))deny();
 return Object.freeze({
  editingTasks:Object.freeze(results),
  testTaskId:test[0].id,
  orderedTaskIds:Object.freeze(ordered)
 });
}


/**
 * A signed D1 may repair a generated test only when the ORIGINAL Engineer
 * root and original signed Test grants already include exact read/update
 * permissions. This selector grants nothing: it returns IDs and verified
 * paths from the independently admitted signed epoch.
 *
 * Creating a test is not permission to read or update that test later.
 * A Runner FAIL or model attribution is not permission either.
 * This deliberately handles one test editor followed by a separate,
 * newly signed run-only Test Task; execution needs its own trusted ports.
 */
export function selectSignedNativeTestEditD1Tasks({
 epoch,planDigest,branchUri,originalCreatedTestFileUris,
 originalApprovedTestGrants,originalRootPermissions
}={}){
 const tasks=epoch?.plan?.tasks,grants=epoch?.plan?.requested_permissions;
 if(epoch?.epoch!==2||epoch?.plan_digest!==planDigest||
    !DIGEST.test(planDigest??"")||
    typeof branchUri!=="string"||!branchUri.startsWith("gitea://")||
    !Array.isArray(tasks)||tasks.length!==2||
    !Array.isArray(grants)||grants.length<3||grants.length>17||
    !Array.isArray(originalCreatedTestFileUris)||
    originalCreatedTestFileUris.length<1||originalCreatedTestFileUris.length>8||
    !Array.isArray(originalApprovedTestGrants)||
    !Array.isArray(originalRootPermissions))
  deny();
 const created=new Set(originalCreatedTestFileUris);
 if(created.size!==originalCreatedTestFileUris.length||
    [...created].some(uri=>typeof uri!=="string"||
      !uri.startsWith(branchUri+"/files/")||
      uri.length>1024))
  deny();
 const [edit,retest]=tasks;
 if(!edit||!retest||!ID.test(edit.id)||!ID.test(retest.id)||
    edit.id===retest.id||edit.agent_id!=="test"||
    retest.agent_id!=="test"||
    !Array.isArray(edit.depends_on)||edit.depends_on.length!==0||
    !Array.isArray(retest.depends_on)||retest.depends_on.length!==1||
    retest.depends_on[0]!==edit.id)
  deny();
 const edits=grants.filter(g=>g.task_id===edit.id);
 const checks=grants.filter(g=>g.task_id===retest.id);
 if(edits.length<2||edits.length>16||edits.length%2!==0||
    checks.length!==1||checks[0].agent_id!=="test"||
    checks[0].resource!==branchUri||checks[0].operation!=="run_tests"||
    grants.length!==edits.length+1)
  deny();
 const perFile=new Map();
 const unique=new Set();
 for(const g of edits){
  if(g.agent_id!=="test"||!created.has(g.resource)||
     !["read_file","update_file"].includes(g.operation))
   deny();
  const key=JSON.stringify([g.resource,g.operation]);
  if(unique.has(key))deny();
  unique.add(key);
  const ops=perFile.get(g.resource)??new Set();
  ops.add(g.operation);perFile.set(g.resource,ops);
 }
 if(perFile.size<1||perFile.size>8)deny();
 for(const [uri,ops] of perFile){
  if(ops.size!==2||!ops.has("read_file")||!ops.has("update_file"))
   deny();
  const signed=originalApprovedTestGrants.filter(g=>
   g.agent_id==="test"&&g.resource===uri&&
   ["read_file","update_file"].includes(g.operation));
  if(new Set(signed.map(g=>g.task_id)).size!==1||
     !["read_file","update_file"].every(op=>
       signed.some(g=>g.operation===op)&&
       originalRootPermissions.some(g=>g.resource===uri&&g.operation===op)))
   deny();
 }
 if(!originalApprovedTestGrants.some(g=>g.agent_id==="test"&&
    g.resource===branchUri&&g.operation==="run_tests")||
    !originalRootPermissions.some(g=>g.resource===branchUri&&
    g.operation==="run_tests"))
  deny();
 return Object.freeze({
  testEditTaskId:edit.id,testRunTaskId:retest.id,
  fileUris:Object.freeze([...perFile.keys()].sort()),
  orderedTaskIds:Object.freeze([edit.id,retest.id])
 });
}
