/**
 * Syntax guard for the signed work branch of a Task. Git/OPA/Gateway keep
 * enforcing the actual resources, repository and permission authority.
 */
export function validatePrivateApprovedBranch(value:unknown):string{
  if(typeof value!=="string"||value.length>120||
     !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(value)||
     value.endsWith("/")||value.endsWith(".")||value.endsWith(".lock")||
     value.includes("..")||value.includes("//")||value.includes("@{")){
    throw new Error("Invalid approved feature branch");
  }
  return value;
}
