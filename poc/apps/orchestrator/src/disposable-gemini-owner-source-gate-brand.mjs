/**
 * Pure Node ESM brand for a private ORIGINAL Owner model-source gate.
 * Deliberately no ADK, Gemini, TypeScript, Gateway or provider imports:
 * original offline Engineer Review Host/Handoff must stay importable by
 * Node without --experimental-strip-types.
 *
 * The minting operation is only for the trusted process when it has already
 * validated a one-use issued, consented five-model set. This is a trusted
 * host-memory fence, NOT cross-process cryptographic authentication and
 * never a new permission or human-approval authority.
 */
const issued=new WeakSet();
export function mintDisposableOwnerSourceGate(gate){
 if(typeof gate!=="function")
  throw Error("Disposable owner source gate requires trusted callable");
 issued.add(gate);
 return gate;
}
export function isIssuedDisposableOwnerSourceGate(value){
 return typeof value==="function"&&issued.has(value);
}
