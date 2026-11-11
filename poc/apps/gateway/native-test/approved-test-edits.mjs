/**
 * Shape-only acceptance checks for an Engineer-approved Test role.
 * There is intentionally NO fixed number of Test file edits: a signed
 * Task can run existing tests, update discovered tests, or create new ones.
 * Actual authority and provider effects remain enforced by Gateway/Rust.
 */
export function analyzeApprovedTestEdits({creates,updates,reads,testGrants}){
  for(const value of [creates,updates,reads,testGrants]){
    if(!Array.isArray(value))throw Error("Invalid approved Test grants");
  }
  const createdTestFiles=[...new Set(creates)];
  const updatedTestFiles=[...new Set(updates)];
  const readableTestFiles=[...new Set(reads)];
  // A file can be created only once; another signed, dependent Task may
  // subsequently read and update it, but must own its own read permission.
  if(createdTestFiles.length!==creates.length)
    throw Error("Duplicate Test creation is not a valid approved workflow");
  for(const write of testGrants.filter(g=>g.operation==="update_file")){
    if(!testGrants.some(read=>read.task_id===write.task_id&&
       read.operation==="read_file"&&read.resource===write.resource)){
      throw Error("Every signed Test update requires a same-Task read grant");
    }
  }
  const writes=testGrants.filter(g=>
    g.operation==="create_file"||g.operation==="update_file");
  if(writes.length!==creates.length+updates.length)
    throw Error("Unmatched approved Test write grants");
  const expectedWriteKeys=new Set(writes.map(g=>
    g.task_id+"\0"+g.operation+"\0"+g.resource));
  if(expectedWriteKeys.size!==writes.length)
    throw Error("Duplicate Test write grant within a Task");
  return {createdTestFiles,updatedTestFiles,readableTestFiles,
    expectedWriteKeys};
}
