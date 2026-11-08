/** Trusted owner configuration only. No model, HTTP, A2A or MCP input.
 * Existing default: two authenticated Test FAILs; hard caps are bounded.
 * A final readiness/block decision consumes no Child: 24 signed Tasks may
 * therefore require a 25th owner-budgeted model turn, never a 25th Child. */
function deny(){throw Error('Protected canonical execution budget denied');}
export function resolveTrustedAuthorityOnlyExecutionBudgets({childCount,ownerBudget}={}){
 if(!Number.isSafeInteger(childCount)||childCount<1||childCount>24)deny();
 if(ownerBudget===undefined)
  return Object.freeze({maxDecisions:childCount,maxVerifiedFailures:Math.min(2,childCount)});
 if(!ownerBudget||typeof ownerBudget!=='object'||Array.isArray(ownerBudget)||
    Object.getPrototypeOf(ownerBudget)!==Object.prototype||
    Object.keys(ownerBudget).length!==2||
    !Object.hasOwn(ownerBudget,'maxDecisions')||
    !Object.hasOwn(ownerBudget,'maxVerifiedFailures'))deny();
 const {maxDecisions,maxVerifiedFailures}=ownerBudget;
 if(!Number.isSafeInteger(maxDecisions)||maxDecisions<1||maxDecisions>childCount+1||maxDecisions>25||
    !Number.isSafeInteger(maxVerifiedFailures)||
    maxVerifiedFailures<0||maxVerifiedFailures>4||
    maxVerifiedFailures>maxDecisions)deny();
 return Object.freeze({maxDecisions,maxVerifiedFailures});
}
