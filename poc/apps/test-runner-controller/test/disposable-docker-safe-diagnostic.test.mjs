import test from "node:test";
import assert from "node:assert/strict";
import {safeDisposableDockerFailure as safe}
 from "../scripts/disposable-docker-safe-diagnostic.mjs";

const secret="PRIVATE_GITEA_TOKEN_AND_ROOT_KEY_17";
const knownSteps=[
 ["start no-volume isolated Gitea","gitea_container_start"],
 ["inspect disposable Gitea localhost port","gitea_host_port_inspection"],
 ["start disposable real OPA policy server","opa_container_start"],
 ["inspect isolated OPA localhost port","opa_host_port_inspection"]
];

test("R274 fixed Docker errors identify only trusted bootstrap phases and reason categories",()=>{
 for(const [label,phase] of knownSteps){
  const event=safe({status:125,stderr:"Error response from daemon: port is already allocated "+secret},label);
  assert.deepEqual(event,{
   event:"disposable_docker_failure_v1",
   step:phase,category:"host_port_unavailable",
   exit_status:125,causal_attribution:"not_established"
  });
  assert.ok(Object.isFrozen(event));
  assert.doesNotMatch(JSON.stringify(event),/PRIVATE_GITEA|ROOT_KEY|daemon: port/i);
 }
});

test("R274 stderr is classified but never released, even with arbitrary label injections",()=>{
 const cases=[
  ["Cannot connect to the Docker daemon","docker_daemon_unavailable"],
  ["Conflict. The container name '/test' is already in use","container_name_conflict"],
  ["invalid mount config for type bind","volume_mount_failure"],
  ["no space left on device","host_disk_exhausted"],
  ["pull access denied","docker_image_unavailable"],
  ["failed to create task for container","container_start_failed"],
  ["network sample not found","docker_network_missing"],
  [secret+" arbitrary diagnostics","docker_command_failed_unclassified"]
 ];
 for(const [message,category] of cases){
  const actual=safe({stderr:message+"\n"+secret,status:1},
   secret+" start disposable real OPA policy server");
  assert.equal(actual.step,"unclassified_bootstrap_step");
  assert.equal(actual.category,category);
  assert.equal(actual.causal_attribution,"not_established");
  assert.doesNotMatch(JSON.stringify(actual),/PRIVATE_GITEA|ROOT_KEY/u);
 }
});

test("R274 timeout, missing Docker and invalid exit statuses stay finite",()=>{
 assert.equal(safe({code:"ETIMEDOUT",status:999,stderr:secret},
  knownSteps[2][0]).category,"docker_command_timeout");
 assert.equal(safe({code:"ENOENT",status:-1,stderr:secret},
  knownSteps[2][0]).category,"docker_binary_unavailable");
 assert.equal(safe({code:"ETIMEDOUT",status:999},knownSteps[2][0]).exit_status,null);
 assert.equal(safe({status:137,stderr:Buffer.from("OCI runtime create failed "+secret)},
  knownSteps[0][0]).category,"container_start_failed");
 assert.equal(safe(null,"unknown").category,"docker_command_failed_unclassified");
});
