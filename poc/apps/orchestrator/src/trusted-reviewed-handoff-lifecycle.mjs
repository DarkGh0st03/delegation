/**
 * Owner-only, one-shot lifecycle for signed reviewed Execution.
 * Neither admission nor an Engineer UI endpoint can invoke runApprovedDag.
 * The private operator supplies the real A2A/Adapter ports, while the
 * approved dispatcher loads authority from the signed Engineer receipt.
 */
export function createTrustedReviewedHandoffLifecycle(start){
  if(typeof start!=="function")throw Error("Trusted handoff start required");
  let state="idle",attempt,active,shutdown,verifiedOutcome="pending";
  const startAttempt=input=>{
    if(state!=="idle")
      throw Error("Trusted handoff already attempted or host closing");
    state="starting";
    attempt=Promise.resolve().then(()=>start(input)).then(running=>{
      if(!running||typeof running.close!=="function")
        throw Error("Trusted handoff missing verified authority closure");
      active=running;
      if(state==="closing")
        throw Error("Trusted handoff started after Engineer host shutdown");
      state="active";
      return running;
    },error=>{
      if(state!=="closing")state="failed";
      throw error;
    });
    return attempt;
  };
  const closeAttempt=()=>{
    if(shutdown)return shutdown;
    state="closing";
    shutdown=(async()=>{
      let startingFailed=false;
      if(attempt)await attempt.catch(()=>{startingFailed=true;});
      if(active)await active.close();
      // If a startup exception may have occurred after root issuance,
      // never claim clean closure without a verifiable revocation receipt.
      if(startingFailed&&!active)
        throw Error("Trusted handoff start failed without independently confirmed root closure; manual reconciliation required");
      state="closed";
    })();
    return shutdown;
  };
  return Object.freeze({
    start:startAttempt,
    /**
     * Close the real authority for EVERY path (success, dispatch failure,
     * lost GitHub run, or failed handoff construction). One attempt only.
     * No HTTP, A2A, MCP or GitHub caller is wired to this method.
     */
    async runApprovedDag(input,execution){
      if(!execution||typeof execution!=="object"||
         Array.isArray(execution)||
         typeof execution.invokeOrchestratorTask!=="function"||
         typeof execution.authorityForTask!=="function"||
         !execution.adapter||!execution.a2a)
        throw Error("Trusted handoff requires owner-provisioned signed DAG executor");
      let completed=false;
      try{
        const running=await startAttempt(input);
        if(state!=="active")
          throw Error("Trusted handoff closed before approved DAG dispatch");
        if(typeof running.approvedDag?.executeApprovedDag!=="function")
          throw Error("Trusted handoff missing canonical signed DAG dispatcher");
        const result=await running.approvedDag.executeApprovedDag(execution);
        completed=true;
        return result;
      }catch(error){
        verifiedOutcome="failed";
        throw error;
      }finally{
        // Only a successful signed DAG PLUS confirmed authority revocation
        // can be reported as complete to the private waiting runner.
        try{
          await closeAttempt();
          verifiedOutcome=completed?"verified_complete":"failed";
        }catch(error){
          verifiedOutcome="failed";
          throw error;
        }
      }
    },
    close:closeAttempt,
    get status(){return state;},
    /** Status only: not an Engineer approval or model execution receipt. */
    get verifiedOutcome(){return verifiedOutcome;}
  });
}
