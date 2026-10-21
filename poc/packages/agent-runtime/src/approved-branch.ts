/**
 * Only a trusted, prebound approved-plan task can use a non-legacy branch.
 * This is a narrow syntax guard; Git/OPA/Gateway continue enforcing actual
 * resources, repository and permission authority.
 */
export const LEGACY_A2A_BRANCH="feature/account-suspension";
export function validatePrivateApprovedBranch(value:unknown):string{
  if(typeof value!=="string"||value.length>120||
     !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(value)||
     value.endsWith("/")||value.endsWith(".")||value.endsWith(".lock")||
     value.includes("..")||value.includes("//")||value.includes("@{")){
    throw new Error("Invalid approved feature branch");
  }
  return value;
}
