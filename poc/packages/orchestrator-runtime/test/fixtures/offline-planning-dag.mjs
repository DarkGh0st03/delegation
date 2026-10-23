/**
 * OFFLINE TEST FIXTURE ONLY.
 *
 * Constructs an unapproved plan sketch from trusted repository inventory
 * and an explicit candidate edit intention. No file contents, model output,
 * approval, DC/VP or authority originate here. Production uses the ADK
 * planner/compiler and a separately signed Engineer approval.
 */
const ROLES=["backend","frontend"];
function unsafePath(path){
  if(path.includes("%")||path.includes(String.fromCharCode(92)))return true;
  for(let i=0;i<path.length;i++){
    const code=path.charCodeAt(i);
    if(code<32||code===127)return true;
  }
  return false;
}
function canonical(path){
  return typeof path==="string" && path.length>0 && path.length<=240 &&
    !unsafePath(path) && !path.startsWith("/") && !path.includes("//") &&
    path.split("/").every(p=>p!==""&&p!=="."&&p!=="..");
}
function requirePath(path){
  if(!canonical(path))throw Error("Offline Planning intent: unsafe path");
  return path;
}
export function makeOfflineReviewableDag({snapshot,edits,newTestFile}){
  if(!snapshot||!Array.isArray(snapshot.files)||
     !Array.isArray(snapshot.directories)||
     !edits||Object.keys(edits).sort().join(",")!=="backend,frontend")
    throw Error("Offline Planning intent: invalid trusted inventory");
  const discovered=new Set(snapshot.files);
  const directories=new Set(snapshot.directories);
  const all=[];
  for(const role of ROLES){
    const paths=edits[role];
    if(!Array.isArray(paths)||paths.length<1||paths.length>8)
      throw Error("Offline Planning intent: role has invalid files");
    for(const path of paths){
      requirePath(path);
      if(!discovered.has(path))
        throw Error("Offline Planning intent: file absent from trusted inventory");
      all.push(path);
    }
  }
  if(new Set(all).size!==all.length)
    throw Error("Offline Planning intent: overlapping Agent file edits");
  requirePath(newTestFile);
  const parent=newTestFile.includes("/")
    ?newTestFile.slice(0,newTestFile.lastIndexOf("/")):"";
  if(!directories.has(parent)||discovered.has(newTestFile)||
     all.includes(newTestFile))
    throw Error("Offline Planning intent: test file outside scope");
  const tasks=[
    {id:"branch",agent_id:"orchestrator",title:"Create isolated work branch",
      description:"Keep planned changes off the main branch",depends_on:[],
      permissions:[{operation:"create_branch",path:null,
        reason:"Create a separate approved workspace"}]},
    ...ROLES.map(role=>({
      id:role,agent_id:role,title:"Implement approved "+role+" task",
      description:"Update the inspected source files within this Task's scope",
      depends_on:["branch"],
      permissions:edits[role].flatMap(path=>[
        {operation:"read_file",path,reason:"Inspect pinned existing source"},
        {operation:"update_file",path,reason:"Apply the reviewed change"}
      ])
    })),
    {id:"test",agent_id:"test",title:"Create scoped E2E and run acceptance",
      description:"Run the approved tests on the final feature branch SHA",
      depends_on:["backend","frontend"],
      permissions:[
        {operation:"create_file",path:newTestFile,
          reason:"Add the reviewed scenario regression"},
        {operation:"run_tests",path:null,reason:"Run exact-SHA acceptance"}
      ]},
    {id:"pr",agent_id:"orchestrator",title:"Open tested feature Pull Request",
      description:"Request separate human review; never merge automatically",
      depends_on:["test"],
      permissions:[{operation:"create_pull_request",path:null,
        reason:"Request review of approved, tested changes"}]}
  ];
  return {tasks,assumptions:[],uncertainties:[]};
}
