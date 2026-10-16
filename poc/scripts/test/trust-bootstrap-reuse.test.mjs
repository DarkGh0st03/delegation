import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtemp,mkdir,readFile,rm,unlink,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {test} from "node:test";

const bootstrap=fileURLToPath(new URL("../bootstrap-trust.sh",import.meta.url));
const a=Object.fromEntries(["did","enterprise","issuer","governance"].map((n,i)=>[n,"0x"+String(i+1).repeat(40)]));
const castStub=[
  "#!/usr/bin/env bash",
  'set -euo pipefail',
  'case "$1" in',
  '  chain-id) echo "$MOCK_CHAIN_ID" ;;',
  '  block-number) echo "$MOCK_BLOCK_NUMBER" ;;',
  '  wallet) echo "$MOCK_GOVERNANCE" ;;',
  '  code) if [[ -f "$MOCK_DEPLOYED_DIR/$2" ]]; then echo 0x6000; else echo 0x; fi ;;',
  '  call)',
  '    if [[ "$MOCK_BAD_LINK" == 1 ]]; then echo "0x0000000000000000000000000000000000000000"; exit 0; fi',
  '    case "$3" in',
  '      "governance()(address)") echo "$MOCK_GOVERNANCE" ;;',
  '      "trustRegistry()(address)") echo "$MOCK_ENTERPRISE" ;;',
  '      "didRegistry()(address)") echo "$MOCK_DID" ;;',
  '      *) exit 7 ;;',
  '    esac ;;',
  '  *) exit 8 ;;',
  'esac'
].join("\n")+"\n";
const forgeStub=[
  "#!/usr/bin/env bash",
  'set -euo pipefail',
  'printf "%s\n" "$*" >> "$MOCK_FORGE_LOG"',
  'if [[ "$1" == "build" ]]; then exit 0; fi',
  'if [[ "$1" != "create" ]]; then exit 9; fi',
  'case "$*" in',
  '  *EthereumDIDRegistry*) address="$MOCK_DID" ;;',
  '  *EnterpriseTrustRegistry*) address="$MOCK_ENTERPRISE" ;;',
  '  *IssuerRegistry*) address="$MOCK_ISSUER" ;;',
  '  *) exit 10 ;;',
  'esac',
  'touch "$MOCK_DEPLOYED_DIR/$address"',
  'echo "Deployed to: $address"'
].join("\n")+"\n";

async function fixture(run){
  const dir=await mkdtemp(join(tmpdir(),"delegation-trust-reuse-"));
  const bin=join(dir,"bin"),runtime=join(dir,"runtime"),deployed=join(dir,"deployed");
  await Promise.all([mkdir(bin),mkdir(runtime),mkdir(deployed)]);
  await writeFile(join(bin,"cast"),castStub,{mode:0o755});
  await writeFile(join(bin,"forge"),forgeStub,{mode:0o755});
  await writeFile(join(dir,"forge.log"),"");
  const vars={...process.env,PATH:bin+":"+process.env.PATH,
    TRUST_BOOTSTRAP_RUNTIME_DIR:runtime,RPC_URL:"http://127.0.0.1:8545",CHAIN_ID:"31337",
    ANVIL_DEPLOYER_PRIVATE_KEY:"0x"+String(5).repeat(64),
    MOCK_CHAIN_ID:"31337",MOCK_BLOCK_NUMBER:"0",MOCK_BAD_LINK:"0",
    MOCK_DEPLOYED_DIR:deployed,MOCK_FORGE_LOG:join(dir,"forge.log"),MOCK_DID:a.did,
    MOCK_ENTERPRISE:a.enterprise,MOCK_ISSUER:a.issuer,MOCK_GOVERNANCE:a.governance};
  function invoke(env={}){
    return spawnSync("bash",[bootstrap],{env:{...vars,...env},encoding:"utf8",timeout:15000});
  }
  const log=async()=>await readFile(join(dir,"forge.log"),"utf8");
  try{await run({invoke,log,deployed,runtime});}
  finally{await rm(dir,{recursive:true,force:true});}
}

test("first startup deploys once; second startup verifies and reuses without a transaction",async()=>{
  await fixture(async({invoke,log,runtime})=>{
    const first=invoke();
    assert.equal(first.status,0,first.stderr);
    assert.equal((await log()).split("\n").filter(x=>x.startsWith("create ")).length,3);
    const original=await readFile(join(runtime,"trust.env"),"utf8");
    assert.match(original,/DID_REGISTRY_ADDRESS=0x1111111111111111111111111111111111111111/);
    const second=invoke();
    assert.equal(second.status,0,second.stderr);
    assert.match(second.stdout,/Reusing verified local trust contracts/);
    assert.equal((await log()).split("\n").filter(x=>x.startsWith("create ")).length,3);
    assert.equal(await readFile(join(runtime,"trust.env"),"utf8"),original);
  });
});

test("partially missing deployment refuses reuse and does not create further contracts",async()=>{
  await fixture(async({invoke,log,deployed})=>{
    assert.equal(invoke().status,0);
    await unlink(join(deployed,a.issuer));
    const before=await log(),failure=invoke();
    assert.notEqual(failure.status,0);
    assert.match(failure.stderr,/Partially present trust contracts/);
    assert.equal(await log(),before);
  });
});

test("mismatched governance or linked contracts fails before deployment",async()=>{
  await fixture(async({invoke,log})=>{
    assert.equal(invoke().status,0);
    const before=await log(),bad=invoke({MOCK_BAD_LINK:"1"});
    assert.notEqual(bad.status,0);
    assert.match(bad.stderr,/Trust deployment mismatch/);
    assert.equal(await log(),before);
  });
});

test("fresh reset redeploys, but missing contracts on a nonempty chain are rejected",async()=>{
  await fixture(async({invoke,log,deployed})=>{
    assert.equal(invoke().status,0);
    await Promise.all([a.did,a.enterprise,a.issuer].map(name=>unlink(join(deployed,name))));
    const before=await log(),denied=invoke({MOCK_BLOCK_NUMBER:"6"});
    assert.notEqual(denied.status,0);
    assert.match(denied.stderr,/nonempty chain/);
    assert.equal(await log(),before);
    const fresh=invoke({MOCK_BLOCK_NUMBER:"0"});
    assert.equal(fresh.status,0,fresh.stderr);
    assert.equal((await log()).split("\n").filter(x=>x.startsWith("create ")).length,6);
  });
});

test("wrong chain ID fails closed before running Foundry",async()=>{
  await fixture(async({invoke,log})=>{
    const failed=invoke({MOCK_CHAIN_ID:"1"});
    assert.notEqual(failed.status,0);
    assert.match(failed.stderr,/chain ID mismatch/);
    assert.equal(await log(),"");
  });
});
