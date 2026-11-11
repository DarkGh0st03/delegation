/** Deterministic zero-billing fixture only; never patches paid model output. */
export const PROJECT_TEST_ORIGINAL='return this.repository.save({ ...user, status: nextStatus });';
export const PROJECT_TEST_FAULT='return this.repository.save({ ...user, status: user.status });';
function replaceOnce(source,from,to){
 if(typeof source!=="string"||source.split(from).length!==2||source.includes(to))
  throw Error("Offline project test fixture NO-GO: ambiguous lifecycle source");
 return source.replace(from,to);
}
export const injectProjectTestFault=source=>replaceOnce(source,PROJECT_TEST_ORIGINAL,PROJECT_TEST_FAULT);
export const repairProjectTestFault=source=>replaceOnce(source,PROJECT_TEST_FAULT,PROJECT_TEST_ORIGINAL);

export const FRONTEND_TEST_ORIGINAL='user.status === "ACTIVE"';
export const FRONTEND_TEST_FAULT='user.status === "SUSPENDED"';
export const injectFrontendTestFault=source=>replaceOnce(source,FRONTEND_TEST_ORIGINAL,FRONTEND_TEST_FAULT);
export const repairFrontendTestFault=source=>replaceOnce(source,FRONTEND_TEST_FAULT,FRONTEND_TEST_ORIGINAL);

/** Independent fixture: correct application code, incorrectly authored Test.
 * This exercises provenance/authorization without granting the Test Agent
 * additional repair permissions or relaxing researcher acceptance. */
export const GENERATED_TEST_CORRECT_ASSERTION='expect(service.suspendUser("usr-001").status).toBe("SUSPENDED");';
export const GENERATED_TEST_WRONG_ASSERTION='expect(service.suspendUser("usr-001").status).toBe("ACTIVE");';
export const injectGeneratedTestAssertionFault=source=>
 replaceOnce(source,GENERATED_TEST_CORRECT_ASSERTION,GENERATED_TEST_WRONG_ASSERTION);
export const repairGeneratedTestAssertionFault=source=>
 replaceOnce(source,GENERATED_TEST_WRONG_ASSERTION,GENERATED_TEST_CORRECT_ASSERTION);
