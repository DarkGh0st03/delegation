import test from "node:test";
import assert from "node:assert/strict";
import {chmod,link,mkdtemp,rm,symlink,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {loadProtectedDisposableGeminiKeyFile,
 consumeProtectedDisposableGeminiKey}
 from "../src/disposable-gemini-private-key.mjs";

const KEY="synthetic-protected-never-used-with-provider";
const deny=/Protected disposable Gemini credential NO-GO/u;
async function privateFixture(t){
 const dir=await mkdtemp(join(tmpdir(),"disposable-gemini-key-test-"));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=join(dir,"secret.key");
 await writeFile(file,KEY+"\n",{mode:0o600,flag:"wx"});
 return {dir,file};
}

test("Linux owner-only file loads as opaque, one-use handle; no provider calls",{
 skip:process.platform!=="linux"
},async t=>{
 const {file}=await privateFixture(t);
 const handle=await loadProtectedDisposableGeminiKeyFile(file);
 assert.deepEqual(Object.keys(handle),[]);
 assert.deepEqual(JSON.stringify(handle),"{}");
 assert.notEqual(handle,KEY);
 assert.equal(consumeProtectedDisposableGeminiKey(handle),KEY);
 assert.throws(()=>consumeProtectedDisposableGeminiKey(handle),deny);
 assert.throws(()=>consumeProtectedDisposableGeminiKey({}),deny);
 assert.throws(()=>consumeProtectedDisposableGeminiKey(KEY),deny);
});

test("disallow secrets under checkout, nonabsolute path, group-readable file or directory",{
 skip:process.platform!=="linux"
},async t=>{
 const {dir,file}=await privateFixture(t);
 const sourceRoot=resolve(dirname(fileURLToPath(import.meta.url)),"../../../..");
 await assert.rejects(loadProtectedDisposableGeminiKeyFile(
  join(sourceRoot,"package.json")
 ),deny);
 await assert.rejects(loadProtectedDisposableGeminiKeyFile("secret.key"),deny);
 await assert.rejects(loadProtectedDisposableGeminiKeyFile(file+"/../secret.key"),deny);
 await chmod(file,0o644);
 await assert.rejects(loadProtectedDisposableGeminiKeyFile(file),deny);
 await chmod(file,0o600);
 await chmod(dir,0o755);
 await assert.rejects(loadProtectedDisposableGeminiKeyFile(file),deny);
 await chmod(dir,0o700);
});

test("reject symlinked key, symlinked private parent, and hard links",{
 skip:process.platform!=="linux"
},async t=>{
 const {dir,file}=await privateFixture(t);
 const symlinkFile=join(dir,"file-link");
 await symlink(file,symlinkFile);
 await assert.rejects(loadProtectedDisposableGeminiKeyFile(symlinkFile),deny);
 // Symlink inside the private directory: test the parent's realpath guard.
 const linkDirectory=join(dir,"link-parent");
 await symlink(dir,linkDirectory,"dir");
 await assert.rejects(loadProtectedDisposableGeminiKeyFile(
  join(linkDirectory,"secret.key")
 ),deny);
 const hardlink=join(dir,"hard-link");
 await link(file,hardlink);
 await assert.rejects(loadProtectedDisposableGeminiKeyFile(file),deny);
 await assert.rejects(loadProtectedDisposableGeminiKeyFile(hardlink),deny);
});

test("reject malformed, empty, oversized and multiline credentials",{
 skip:process.platform!=="linux"
},async t=>{
 const {file}=await privateFixture(t);
 for(const value of ["short","bad key with spaces","first\nsecond", "", "x".repeat(4097)]){
  await writeFile(file,value,{mode:0o600});
  await assert.rejects(loadProtectedDisposableGeminiKeyFile(file),deny);
 }
});
