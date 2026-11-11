import {createHash} from "node:crypto";
/**
 * Non-authorizing public correlation key for an independently trusted
 * 128-bit dispatch ID. Never publish raw task IDs, paths or credentials.
 * Predictable legacy IDs deliberately do not receive a public fingerprint.
 */
export function safeSignedTaskRef(runtimeTaskId){
 if(typeof runtimeTaskId!=="string"||
    !/^dispatch_[A-Za-z0-9_-]{22}$/u.test(runtimeTaskId))return null;
 return createHash("sha256")
  .update("delegation-public-task-observation-v1\u0000")
  .update(runtimeTaskId).digest("hex").slice(0,16);
}
