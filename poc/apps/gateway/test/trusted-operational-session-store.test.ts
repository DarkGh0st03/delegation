import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,chmod,writeFile,readdir,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {TrustedOperationalSessionStore}
  from "../src/trusted-operational-session-store.ts";

const SESSION="engineer-operational-reboot";
async function fixture(){
  const directory=await mkdtemp(join(tmpdir(),"gateway-operational-durable-"));
  const store=new TrustedOperationalSessionStore(directory);
  return {directory,store,close:()=>rm(directory,{recursive:true,force:true})};
}
test("corrupted, incomplete or shared Gateway operational journal fails before startup",async()=>{
  const f=await fixture();
  try{
    await f.store.reserveActivation(SESSION);
    const [entry]=await readdir(f.directory);
    assert.match(entry,/^[a-f0-9]{64}\.json$/u);
    const file=join(f.directory,entry);
    const original=await readFile(file,"utf8");
    assert.equal(JSON.parse(original).event,"activation_reserved");
    await writeFile(file,"{");
    await assert.rejects(new TrustedOperationalSessionStore(
      f.directory).assertReady(),/unsafe or incomplete operational journal/);
    await writeFile(file,"{"+" ".repeat(90));
    await assert.rejects(f.store.assertReady(),/corrupt operational journal JSON/);
    await writeFile(file,original);
    await chmod(f.directory,0o755);
    await assert.rejects(f.store.assertReady(),/directory must be owner-only/);
  }finally{await f.close();}
});
