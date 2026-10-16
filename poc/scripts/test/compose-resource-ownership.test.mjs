import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtemp,readFile,rm,writeFile,mkdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";

const lifecycle=fileURLToPath(new URL("../ci-compose-lifecycle.sh",import.meta.url));
const stub=[
  '#!/usr/bin/env bash',
  'printf "%s\\n" "$*" >> "$DOCKER_LOG"',
  'if [[ "$1" == "info" ]]; then [[ "$MOCK_DOCKER_INFO_FAIL" != 1 ]]; exit; fi',
  'if [[ "$1" == "container" && "$2" == "inspect" ]]; then [[ "$MOCK_EXISTING_CONTAINER" == "$3" ]]; exit; fi',
  'if [[ "$1" == "volume" && "$2" == "inspect" ]]; then [[ "$MOCK_EXISTING_VOLUME" == 1 ]]; exit; fi',
  'if [[ "$1" == "network" && "$2" == "inspect" ]]; then [[ "$MOCK_EXISTING_NETWORK" == "$3" ]]; exit; fi',
  'if [[ "$1" == "compose" ]]; then',
  '  for part in "$@"; do',
  '    if [[ "$part" == "config" ]]; then exit 0; fi',
  '    if [[ "$part" == "up" ]]; then [[ "$MOCK_UP_FAIL" != 1 ]]; exit; fi',
  '    if [[ "$part" == "down" ]]; then exit 0; fi',
  '  done',
  'fi',
  'exit 8'
].join("\n")+"\n";

async function withFakeDocker(options,exercise){
  const dir=await mkdtemp(join(tmpdir(),"delegation-compose-ownership-"));
  const temp=join(dir,"runner");
  const fake=join(dir,"docker");
  const log=join(dir,"docker.log");
  try{
    await mkdir(temp);
    await writeFile(fake,stub,{mode:0o755});
    await writeFile(log,"");
    const env={...process.env,PATH:dir+":"+process.env.PATH,
      DOCKER_LOG:log,RUNNER_TEMP:temp,GITHUB_RUN_ID:"12345",
      GITHUB_RUN_ATTEMPT:"1",MOCK_DOCKER_INFO_FAIL:"0",
      MOCK_EXISTING_CONTAINER:"",MOCK_EXISTING_VOLUME:"0",
      MOCK_EXISTING_NETWORK:"",MOCK_UP_FAIL:"0",...options};
    const invoke=action=>spawnSync("bash",[lifecycle,action],{
      env,encoding:"utf8",timeout:10000
    });
    const readLog=async()=>(await readFile(log,"utf8")).split("\n").filter(Boolean);
    await exercise({invoke,readLog});
  }finally{await rm(dir,{recursive:true,force:true});}
}

test("existing Gitea volume is refused and never torn down",async()=>{
  await withFakeDocker({MOCK_EXISTING_VOLUME:"1"},async({invoke,readLog})=>{
    assert.notEqual(invoke("start").status,0);
    assert.equal(invoke("cleanup").status,0);
    const lines=await readLog();
    assert.ok(lines.some(x=>x.includes("volume inspect delegation-poc-gitea-data")));
    assert.equal(lines.some(x=>x.includes(" up -d ")||x.includes(" down --volumes")),false);
  });
});

test("pre-existing containers and networks are not adopted",async()=>{
  for(const options of [
    {MOCK_EXISTING_CONTAINER:"delegation-poc-opa"},
    {MOCK_EXISTING_NETWORK:"delegation-poc-infra"}
  ]){
    await withFakeDocker(options,async({invoke,readLog})=>{
      assert.notEqual(invoke("start").status,0);
      assert.equal(invoke("cleanup").status,0);
      assert.equal((await readLog()).some(x=>x.includes(" down --volumes")),false);
    });
  }
});

test("Docker daemon failure never grants cleanup ownership",async()=>{
  await withFakeDocker({MOCK_DOCKER_INFO_FAIL:"1"},async({invoke,readLog})=>{
    assert.notEqual(invoke("start").status,0);
    assert.equal(invoke("cleanup").status,0);
    assert.equal((await readLog()).some(x=>x.includes(" down --volumes")),false);
  });
});

test("normal start and idempotent teardown claim exactly one stack",async()=>{
  await withFakeDocker({},async({invoke,readLog})=>{
    assert.equal(invoke("start").status,0);
    assert.notEqual(invoke("start").status,0);
    assert.equal(invoke("cleanup").status,0);
    assert.equal(invoke("cleanup").status,0);
    const lines=await readLog();
    assert.equal(lines.filter(x=>x.includes(" up -d gitea opa anvil")).length,1);
    assert.equal(lines.filter(x=>x.includes(" down --volumes")).length,1);
  });
});

test("partially failed Compose up is still cleaned",async()=>{
  await withFakeDocker({MOCK_UP_FAIL:"1"},async({invoke,readLog})=>{
    assert.notEqual(invoke("start").status,0);
    assert.equal(invoke("cleanup").status,0);
    const lines=await readLog();
    assert.equal(lines.filter(x=>x.includes(" up -d gitea opa anvil")).length,1);
    assert.equal(lines.filter(x=>x.includes(" down --volumes")).length,1);
  });
});
