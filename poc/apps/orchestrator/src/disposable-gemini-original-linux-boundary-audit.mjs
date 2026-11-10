/**
 * Disposable original A2A Linux kernel boundary inspector: FREE, NO MODEL.
 *
 * It reads /proc from the TRUSTED owner PID, never from a worker-supplied
 * JSON status or model output. Even if all necessary kernel preconditions
 * pass, it MUST NOT certify role-scoped Unix HMAC channels, independent
 * Rust issuer identity, protected mounts, or paid Gemini readiness.
 *
 * ownerCanaryReadable is a child observation, NOT a trustworthy positive
 * attestation from a potentially compromised worker.
 */
import {readFile,readlink} from "node:fs/promises";

const DENY="Disposable original Linux worker boundary NO-GO";
const deny=()=>{throw Error(DENY);};
const line=(text,name)=>{
 if(typeof text!=="string")deny();
 const match=text.match(new RegExp("^"+name+":\\s*([^\\n]+)$","mu"));
 if(!match)deny();
 return match[1].trim();
};
const decimal=s=>{
 if(!/^(0|[1-9][0-9]*)$/u.test(s))deny();
 const n=Number(s);
 if(!Number.isSafeInteger(n))deny();
 return n;
};
const credentials=text=>{
 const values=line(text,"Uid").split(/\s+/u).map(decimal);
 const groups=line(text,"Gid").split(/\s+/u).map(decimal);
 if(values.length!==4||groups.length!==4)deny();
 const caps=line(text,"CapEff");
 if(!/^[a-fA-F0-9]{1,32}$/u.test(caps))deny();
 const noNewPrivs=decimal(line(text,"NoNewPrivs"));
 if(noNewPrivs!==0&&noNewPrivs!==1)deny();
 return Object.freeze({
  pid:decimal(line(text,"Pid")),
  ppid:decimal(line(text,"PPid")),
  uids:Object.freeze(values),gids:Object.freeze(groups),
  effectiveCapabilities:BigInt("0x"+caps),
  noNewPrivs:noNewPrivs===1
 });
};

/**
 * Pure policy evaluator for adversarial offline fixtures. Its result is
 * diagnostics only. It cannot verify a Rust DID, namespace contents,
 * cross-UID socket access or the real owner private-key mount.
 */
export function evaluateDisposableOriginalLinuxBoundary({
 ownerPid,workerPid,ownerStatus,workerStatus,ownerMountNs,workerMountNs,
 ownerCanaryReadable
}={}){
 if(!Number.isSafeInteger(ownerPid)||ownerPid<1||
    !Number.isSafeInteger(workerPid)||workerPid<1||
    typeof ownerCanaryReadable!=="boolean")deny();
 const parent=credentials(ownerStatus);
 const worker=credentials(workerStatus);
 if(typeof ownerMountNs!=="string"||
    !/^mnt:\[[0-9]+\]$/u.test(ownerMountNs)||
    typeof workerMountNs!=="string"||
    !/^mnt:\[[0-9]+\]$/u.test(workerMountNs))deny();
 const sameUid=parent.uids[1]===worker.uids[1];
 const conditions=Object.freeze({
  parentPidMatches:parent.pid===ownerPid&&worker.ppid===ownerPid&&
   worker.pid===workerPid&&workerPid!==ownerPid,
  ownerUidStable:parent.uids.every(uid=>uid===parent.uids[0])&&
   parent.uids[0]!==0,
  workerUidStable:worker.uids.every(uid=>uid===worker.uids[0])&&
   worker.uids[0]!==0,
  differentUid:!sameUid,
  workerGidStable:worker.gids.every(gid=>gid===worker.gids[0])&&
   worker.gids[0]!==0,
  workerHasNoEffectiveCapabilities:worker.effectiveCapabilities===0n,
  workerNoNewPrivs:worker.noNewPrivs,
  distinctMountNamespace:ownerMountNs!==workerMountNs,
  canaryDeniedToWorker:ownerCanaryReadable===false
 });
 const requiredKernelConditionsPassed=
  Object.values(conditions).every(value=>value===true);
 return Object.freeze({
  status:requiredKernelConditionsPassed?
   "kernel_preconditions_passed_not_isolation_attestation":
   "kernel_preconditions_failed_no_go",
  ownerUid:parent.uids[1],workerUid:worker.uids[1],
  workerPid,parentPid:ownerPid,workerCanReadOwnerCanary:ownerCanaryReadable,
  requiredKernelConditionsPassed,conditions,
  // Passing a kernel sample is never sufficient for this claimed status.
  osIsolationVerified:false,nativeRustSignerVerified:false,
  signedTaskBindingVerified:false
 });
}

/** Only use this from the parent that forked the actual worker PID. */
export async function inspectDisposableOriginalLinuxBoundary({
 workerPid,ownerCanaryReadable
}={}){
 if(process.platform!=="linux"||
    typeof process.getuid!=="function"||
    typeof process.geteuid!=="function"||
    !Number.isSafeInteger(workerPid)||workerPid<1||
    workerPid===process.pid||
    typeof ownerCanaryReadable!=="boolean")deny();
 try{
  const ownerPid=process.pid;
  const [ownerStatus,workerStatus,ownerMountNs,workerMountNs]=
   await Promise.all([
    readFile("/proc/"+ownerPid+"/status","utf8"),
    readFile("/proc/"+workerPid+"/status","utf8"),
    readlink("/proc/"+ownerPid+"/ns/mnt"),
    readlink("/proc/"+workerPid+"/ns/mnt")
   ]);
  const assessment=evaluateDisposableOriginalLinuxBoundary({
   ownerPid,workerPid,ownerStatus,workerStatus,
   ownerMountNs,workerMountNs,ownerCanaryReadable
  });
  // Cross-check the parent's real kernel status and local process API.
  if(assessment.ownerUid!==process.getuid()||
     process.geteuid()!==process.getuid())deny();
  return assessment;
 }catch{deny();}
}
