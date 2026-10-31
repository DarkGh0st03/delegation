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
