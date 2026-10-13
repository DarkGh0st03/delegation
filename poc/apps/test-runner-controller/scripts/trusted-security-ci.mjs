/**
 * Privileged CI ENTRYPOINT. Not an A2A/MCP/Gateway tool and never called
 * with model-supplied arguments. The operator supplies a trusted expected SHA
 * and distinct read-only Runner / status-publishing CI credentials.
 *
 * WARNING: this writes commit statuses to the configured Gitea repository.
 * The isolated smoke test should be used before configuring this for a
 * persistent installation. It NEVER posts reviews or merges.
 */
import {randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";
import {mkdtemp,rm,stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {IsolatedDockerRunnerExecutor} from "../src/isolated-executor.ts";
import {TrustedGiteaSecurityCi} from "../src/trusted-security-ci.ts";

function required(name){
  const value=process.env[name];
  if(typeof value!=="string"||value.trim()===""){
    throw Error("Missing operator-managed security CI setting "+name);
  }
  return value;
}
const expectedSha=required("SECURITY_CI_EXPECTED_SHA");
if(!/^[0-9a-f]{40}$/u.test(expectedSha)){
  throw Error("SECURITY_CI_EXPECTED_SHA must be the exact 40-char feature HEAD");
}
const actorId=Number(required("SECURITY_CI_ACTOR_ID"));
if(!Number.isSafeInteger(actorId)||actorId<=0){
  throw Error("SECURITY_CI_ACTOR_ID must be a valid numeric Gitea user ID");
}
const gitea=required("SECURITY_CI_GITEA_URL");
const readerToken=required("SECURITY_CI_GITEA_READ_TOKEN");
const statusToken=required("SECURITY_CI_GITEA_STATUS_TOKEN");
const statusActor={id:actorId,login:required("SECURITY_CI_ACTOR_LOGIN")};
const nodeImage=process.env.SECURITY_CI_DOCKER_IMAGE??"node:22.15.0-bookworm";
// This directory is owned by the thesis/researcher, not read from Gitea or
// the model context. CI has no env flag to disable its acceptance tests.
const acceptanceDir=fileURLToPath(new URL(
  "../../../runner/acceptance/",import.meta.url
));
const dir=await stat(acceptanceDir);
if(!dir.isDirectory())throw Error("Researcher acceptance source not found");
try{
  // Never silently pull a large container image on the developer machine.
  execFileSync("docker",["image","inspect",nodeImage],{
    timeout:20000,stdio:"ignore"
  });
}catch{
  throw Error("Trusted CI requires an already cached Node Docker image");
}
const logs=await mkdtemp(join(tmpdir(),"thesis-trusted-ci-"));
try{
  const executor=new IsolatedDockerRunnerExecutor({
    gitea_base_url:gitea,gitea_owner:"thesis",
    gitea_repository:"iam-console-poc",gitea_token:readerToken,
    docker_image:nodeImage,
    phase_timeout_ms:600000,
    acceptance_enabled:true,
    acceptance_dir:acceptanceDir,
    log_dir:logs
  });
  const ci=new TrustedGiteaSecurityCi({
    giteaBaseUrl:gitea,giteaReadToken:readerToken,
    giteaStatusToken:statusToken,
    trustedStatusActor:statusActor,runner:executor
  });
  const verdict=await ci.run({
    request_id:"trusted-security-ci-"+randomUUID(),
    repository:"gitea://gitea.local/thesis/iam-console-poc",
    branch:"feature/account-suspension",
    commit_sha:expectedSha,
    profile:"poc-default"
  });
  process.stdout.write(JSON.stringify({
    event:"trusted_security_ci_exact_sha",
    state:verdict.status,expected_sha:expectedSha,
    status_context:verdict.context,
    status_id:verdict.gitea_status_id,
    real_docker_runner:true,researcher_acceptance_enabled:true,
    no_review_or_merge:true
  })+"\n");
  if(verdict.status!=="success")process.exitCode=1;
}finally{
  // CI logs stay private to the ephemeral job; no token, code or test output
  // is placed into Gitea commit descriptions.
  await rm(logs,{recursive:true,force:true});
}
