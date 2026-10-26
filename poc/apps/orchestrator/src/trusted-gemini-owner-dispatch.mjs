/**
 * Privileged owner-only continuation. A human-signature precheck and GitHub
 * admission are NOT interchangeable. Never expose this object via HTTP,
 * OIDC, A2A, MCP, model tools, UI, or GitHub workflow inputs.
 *
 * No model/provider call, approval, DC issue or GitHub admission occurs at
 * construction. The genuine Host independently revalidates all authority.
 */
import {bindProtectedGeminiApprovedExecution}
  from "./trusted-gemini-execution-binding.mjs";

function reject(reason){throw Error("Protected Gemini owner dispatch: "+reason);}

export function createProtectedGeminiOwnerDispatch({
  assembly,host,geminiApiKey,verifySignedReview
}={}){
  const planning=assembly?.planning,coordinator=assembly?.coordinator;
  if(!planning||!Object.isFrozen(planning)||
     coordinator!==planning.coordinator||
     typeof coordinator?.phase!=="string"||
     typeof host?.runReviewedApprovedDagWithGateway!=="function"||
     typeof host?.close!=="function"||
     typeof verifySignedReview!=="function"||
     typeof geminiApiKey!=="string"||geminiApiKey.length<8)
    reject("original Planning, protected Host and private signer required");
  let closed=false,dispatchPreparing=false,dispatchAttempted=false;
  let dispatchPromise,shutdownPromise;
  const signedReviewReady=()=>verifySignedReview();
  return Object.freeze({
    /** Only a read-only check, NEVER an operational authorization. */
    async reviewReadiness(){
      if(closed||dispatchPreparing||dispatchAttempted||
         coordinator.phase!=="planning")
        reject("signed Engineer review unavailable");
      const signed=await signedReviewReady();
      if(closed||dispatchPreparing||dispatchAttempted||
         coordinator.phase!=="planning")
        reject("signed Engineer review changed before return");
      return signed;
    },
    runApprovedGeminiDag(input){
      if(closed||dispatchPreparing||dispatchAttempted||
         coordinator.phase!=="planning")
        reject("one-use approved DAG already attempted or unavailable");
      // Binding is deliberately synchronous and non-billable. Reject any
      // injected coordinator, remote transport or model-defined grants
      // BEFORE reading a receipt or consuming a GitHub admission.
      const bound=bindProtectedGeminiApprovedExecution(planning,input);
      dispatchPreparing=true; // serialize BEFORE the first await
      const running=(async()=>{
        try{
          await signedReviewReady();
          // An unsigned premature request can be retried after the actual
          // Engineer signs; no one-use GitHub admission has been consumed.
          if(closed||coordinator.phase!=="planning")
            reject("signed review changed before Github admission");
          dispatchAttempted=true; // reserve BEFORE host OIDC / root effects
          const result=await host.runReviewedApprovedDagWithGateway({
            ...bound,coordinator,
            reviewGate:planning.reviewGate,
            checkpointStore:planning.checkpointStore,
            geminiApiKey,transports:bound.transports
          });
          if(closed)
            reject("Owner shutdown raced completed approved DAG");
          return result;
        }finally{
          dispatchPreparing=false;
        }
      })();
      dispatchPromise=running;
      // Preserve the exact in-flight promise until it is settled so a
      // concurrent SIGTERM can await the final host/Gateway/Root cleanup.
      void running.finally(()=>{
        if(dispatchPromise===running)dispatchPromise=undefined;
      }).catch(()=>{});
      return running;
    },
    close(){
      if(shutdownPromise)return shutdownPromise;
      closed=true; // fence ALL new approval/dispatch work synchronously
      shutdownPromise=(async()=>{
        let error;
        // Host.close() revokes authority BEFORE waiting for in-flight DAGs;
        // reversing this ordering could deadlock with an A2A Task.
        try{await host.close();}catch(e){error=e;}
        if(dispatchPromise){
          try{await dispatchPromise;}catch{/* original result stays with caller */}
        }
        if(error)throw error; // NEVER claim clean revocation if unconfirmed
      })();
      return shutdownPromise;
    },
    get status(){
      return closed?"closing_or_closed":
        dispatchAttempted?"execution_selected":
        dispatchPreparing?"signed_review_in_progress":"awaiting_human_review";
    }
  });
}
