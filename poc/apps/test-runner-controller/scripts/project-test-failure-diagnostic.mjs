/** Public projection only: paths stay in the private Gateway result. This
 * diagnostic neither establishes causality nor authorizes any repair Task. */
export function safeProjectTestFailureDiagnostic(raw){
  if(!raw||typeof raw!=="object"||Array.isArray(raw)||
     Object.keys(raw).length!==2||
     !Object.hasOwn(raw,"phase")||!Object.hasOwn(raw,"failed_test_file_count")||
     !["backend_tests","frontend_tests"].includes(raw.phase)||
     !Number.isInteger(raw.failed_test_file_count)||
     raw.failed_test_file_count<1||raw.failed_test_file_count>8)return null;
  return Object.freeze({phase:raw.phase,failed_test_file_count:raw.failed_test_file_count});
}
