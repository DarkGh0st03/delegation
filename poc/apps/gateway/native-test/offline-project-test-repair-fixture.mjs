/** Deterministic zero-billing fixture only; never patches paid model output. */
export const PROJECT_TEST_ORIGINAL='return this.repository.save({ ...user, status: nextStatus });';
export const PROJECT_TEST_FAULT='return this.repository.save({ ...user, status: user.status });';
function replaceOnce(source,from,to){
 if(typeof source!=="string"||source.split(from).length!==2||source.includes(to))
  throw Error("Offline Backend test fixture NO-GO: ambiguous lifecycle source");
 return source.replace(from,to);
}
export const injectProjectTestFault=source=>replaceOnce(source,PROJECT_TEST_ORIGINAL,PROJECT_TEST_FAULT);
export const repairProjectTestFault=source=>replaceOnce(source,PROJECT_TEST_FAULT,PROJECT_TEST_ORIGINAL);
