import assert from "node:assert/strict";
import {readdir,readFile} from "node:fs/promises";
import {test} from "node:test";

test("every CI Adapter cargo build, run, test or metadata command uses --locked",async()=>{
  const dir=new URL("../../../.github/workflows/",import.meta.url);
  const files=(await readdir(dir)).filter(file=>/\.ya?ml$/.test(file));
  let inspected=0;
  for(const file of files){
    const lines=(await readFile(new URL(file,dir),"utf8")).split("\n");
    for(let i=0;i<lines.length;i++){
      const line=lines[i];
      if(!/\bcargo\s+(?:build|run|test|metadata)\s+--manifest-path\s+services\/delegation-adapter\/Cargo\.toml\b/.test(line))continue;
      inspected++;
      assert.match(line,/\s--locked(?:\s|$)/,file+":"+(i+1)+" must freeze Adapter resolution");
    }
  }
  assert.ok(inspected>=10,"expected Adapter commands in current workflows");
});
