/**
 * R274: fixed-vocabulary diagnostics for disposable Gitea/OPA Docker
 * bootstrap. stderr can contain credentials, paths and provider responses.
 * Never return raw stderr, error.message, or an untrusted operation label.
 */
const patterns=Object.freeze([
 ["docker_daemon_unavailable",/(?:cannot connect to the docker daemon|is the docker daemon running|error during connect)/iu],
 ["container_name_conflict",/(?:container name .* is already in use|conflict\. the container name)/iu],
 ["host_port_unavailable",/(?:port is already allocated|bind: address already in use|failed programming external connectivity)/iu],
 ["volume_mount_failure",/(?:invalid mount config|mounts denied|error while mounting|invalid volume specification)/iu],
 ["host_disk_exhausted",/(?:no space left on device|disk quota exceeded)/iu],
 ["docker_permission_denied",/(?:permission denied while trying to connect to the docker daemon|got permission denied)/iu],
 ["docker_image_unavailable",/(?:manifest unknown|pull access denied|no matching manifest)/iu],
 ["container_start_failed",/(?:failed to create task|failed to start container|oci runtime create failed)/iu],
 ["docker_network_missing",/(?:network .* not found|network .* does not exist)/iu]
]);

const steps=new Map([
 ["start no-volume isolated Gitea","gitea_container_start"],
 ["inspect disposable Gitea localhost port","gitea_host_port_inspection"],
 ["start disposable real OPA policy server","opa_container_start"],
 ["inspect isolated OPA localhost port","opa_host_port_inspection"]
]);

export function safeDisposableDockerFailure(error,label){
 const step=steps.get(label)??"unclassified_bootstrap_step";
 const stderr=(typeof error?.stderr==="string"?error.stderr:
   Buffer.isBuffer(error?.stderr)?error.stderr.toString("utf8"):"")
     .slice(-8192);
 const category=error?.code==="ETIMEDOUT"?"docker_command_timeout":
   error?.code==="ENOENT"?"docker_binary_unavailable":
   patterns.find(([,expression])=>expression.test(stderr))?.[0]??
   "docker_command_failed_unclassified";
 const exitStatus=Number.isSafeInteger(error?.status)&&
   error.status>=0&&error.status<=255?error.status:null;
 return Object.freeze({
  event:"disposable_docker_failure_v1",
  step,category,exit_status:exitStatus,
  causal_attribution:"not_established"
 });
}
