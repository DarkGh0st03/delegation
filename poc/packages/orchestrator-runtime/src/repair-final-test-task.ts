/** Select validation by its signed operation, not by role cardinality.
 * A Test editor is a predecessor, never proof of a Runner PASS. */
export function finalRepairTestTask(plan:{
 tasks:Array<{id:string;agent_id:string;depends_on:string[]}>;
 requested_permissions:Array<{task_id:string;agent_id:string;operation:string;resource:string}>;
},branchUri:string):string{
 const deny=():never=>{throw Error("One final run-only Test must depend on every repair editor");};
 const runners=plan.requested_permissions.filter(p=>p.operation==="run_tests");
 if(runners.length!==1||runners[0].agent_id!=="test"||runners[0].resource!==branchUri)deny();
 const runner=runners[0];
 const tasks=new Map(plan.tasks.map(t=>[t.id,t]));
 const task=tasks.get(runner.task_id);
 if(tasks.size!==plan.tasks.length||!task||task.agent_id!=="test"||
    plan.requested_permissions.filter(p=>p.task_id===task.id).length!==1)deny();
 const seen=new Set<string>(),visiting=new Set<string>();
 const visit=(id:string):void=>{
  if(visiting.has(id))deny();
  if(seen.has(id))return;
  const current=tasks.get(id);if(!current)deny();
  visiting.add(id);
  for(const dep of current.depends_on)visit(dep);
  visiting.delete(id);seen.add(id);
 };
 visit(task.id);
 if(plan.tasks.some(t=>!seen.has(t.id)))deny();
 return task.id;
}
