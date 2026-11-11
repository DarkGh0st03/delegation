import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {mkdtemp,mkdir,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {seal,unseal,sealDirectory} from "../seal-runner-evidence.mjs";
test("encrypted evidence requires correct key and rejects tampering",()=>{
 const key=randomBytes(32).toString("hex"),plain=Buffer.from("private source and assertion");
 const encrypted=seal(plain,key);
 assert.deepEqual(unseal(encrypted,key),plain);
 assert.equal(encrypted.includes(plain),false);
 assert.notDeepEqual(seal(plain,key),encrypted);
 assert.throws(()=>unseal(encrypted,randomBytes(32).toString("hex")));
 encrypted[encrypted.length-1]^=1;assert.throws(()=>unseal(encrypted,key));
 assert.throws(()=>seal(plain,""));
});
test("collection seals exact bundle files and ignores unrelated service logs",async()=>{
 const root=await mkdtemp(join(tmpdir(),"seal-test-"));
 try{
  const key=randomBytes(32).toString("hex"),dir=join(root,"failure-abc123"),output=join(root,"result.enc");
  await mkdir(dir);
  for(const name of ["manifest.json","source.tar.gz","runner.log"])await writeFile(join(dir,name),name);
  await writeFile(join(root,"service.log"),"credential");
  assert.equal(await sealDirectory(root,output,key),true);
  const result=JSON.parse(unseal(await readFile(output),key));
  assert.equal(result.bundles.length,1);
  assert.equal(Buffer.from(result.bundles[0].files["source.tar.gz"],"base64").toString(),"source.tar.gz");
  assert.doesNotMatch(JSON.stringify(result),/credential/);
 }finally{await rm(root,{recursive:true,force:true});}
});
