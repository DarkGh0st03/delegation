/**
 * E2E runtime preflight only: GitHub Actions owns Compose startup/teardown.
 * Do not launch, stop, bootstrap, or delete infrastructure from agent scripts.
 */
import {execFileSync} from "node:child_process";
import assert from "node:assert/strict";

export const GITEA_COMPOSE_CONTAINER="delegation-poc-gitea";
export const GITEA_COMPOSE_URL="http://127.0.0.1:3000";

export function assertPreparedComposeGitea(){
  if(process.env.GITEA_E2E_COMPOSE_READY!=="1"){
    throw Error("Start clean Gitea, OPA and Anvil through Docker Compose before running E2E");
  }
  let inspected;
  try{
    inspected=JSON.parse(execFileSync("docker",
      ["inspect","--type","container",GITEA_COMPOSE_CONTAINER],
      {encoding:"utf8",timeout:15000,stdio:["ignore","pipe","pipe"]}))[0];
  }catch{
    throw Error("Expected Compose-owned E2E Gitea container is missing");
  }
  assert.equal(inspected?.State?.Running,true,"Compose Gitea must be running");
  assert.equal(inspected.Config?.Labels?.["com.docker.compose.service"],"gitea",
    "Gitea must belong to Compose, not an ad hoc Docker run");
  assert.equal(inspected.Config?.Labels?.["com.docker.compose.project"],
    "delegation-thesis-poc","Unexpected Compose project for Gitea");
  const bindings=inspected.NetworkSettings?.Ports?.["3000/tcp"]??[];
  assert.ok(bindings.some(p=>p.HostIp==="127.0.0.1"&&p.HostPort==="3000"),
    "Compose Gitea must bind port 3000 on loopback only");
  const mounted=inspected.Mounts??[];
  assert.ok(mounted.some(m=>m.Type==="volume"&&m.Name==="delegation-poc-gitea-data"&&m.Destination==="/data"),
    "Compose Gitea must use the expected CI-managed data volume");
}
