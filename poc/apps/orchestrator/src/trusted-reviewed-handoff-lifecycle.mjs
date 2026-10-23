/**
 * Trusted *local process* lifetime of an admitted, signed Execution.
 * This helper never grants root authority, validates a plan or invokes a
 * model. It owns the admitted handoff promise and MUST close its real
 * Gateway/Coordinator/Rust authority before the Engineer host can stop.
 *
 * One attempt per Engineer host, even when GitHub admission fails. A
 * restart requires a new independently reviewed session.
 */
export function createTrustedReviewedHandoffLifecycle(start){
  if(typeof start!=="function")throw Error("Trusted handoff start required");
  let state="idle",attempt,active,shutdown;
  return Object.freeze({
    start(input){
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
    },
    close(){
      if(shutdown)return shutdown;
      state="closing";
      shutdown=(async()=>{
        // A concurrently starting handoff can issue its operational root
        // after shutdown began. Wait, then revoke that root too.
        if(attempt)await attempt.catch(()=>{});
        if(active)await active.close();
        state="closed";
      })();
      // On failure retain the rejected promise; silently retrying could
      // obscure an unrevoked root that needs manual reconciliation.
      return shutdown;
    },
    get status(){return state;}
  });
}
