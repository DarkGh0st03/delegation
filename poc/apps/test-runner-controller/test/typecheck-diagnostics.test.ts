import test from "node:test";
import assert from "node:assert/strict";
import {extractTypecheckLocations,sanitizeTypecheckLocations,
  extractTypecheckErrorCodes,sanitizeTypecheckErrorCodes}
  from "../src/typecheck-diagnostics.ts";

test("extracts only canonical TypeScript error codes and positions",()=>{
  const secret="MY_PRIVATE_SOURCE_AND_TOKEN";
  const raw=[
    "apps/backend/src/users/user.ts(23,7): error TS2304: "+secret,
    "apps/frontend/src/App.tsx:51:12 - error TS2322: "+secret,
    "../private/key.ts(1,1): error TS2304: "+secret,
    "/etc/secret.ts(1,1): error TS2304: "+secret,
    "apps/backend/src/users/user.ts(0,1): error TS9999: "+secret,
    "apps/frontend/src/App.tsx(18,2): warning TS1100: "+secret
  ].join("\n");
  const actual=extractTypecheckLocations(raw,"");
  assert.deepEqual(actual,[
    {path:"apps/backend/src/users/user.ts",line:23,column:7,code:"TS2304"},
    {path:"apps/frontend/src/App.tsx",line:51,column:12,code:"TS2322"}
  ]);
  assert.ok(!JSON.stringify(actual).includes(secret));
});
test("bounded sanitizer rejects injected fields and oversized collections",()=>{
  const good={path:"src/index.ts",line:3,column:5,code:"TS7006"};
  assert.deepEqual(sanitizeTypecheckLocations([good]),[good]);
  assert.deepEqual(sanitizeTypecheckLocations([{...good,private_source:"secret"}]),[]);
  assert.deepEqual(sanitizeTypecheckLocations([{...good,path:"../../keys.ts"}]),[]);
  assert.deepEqual(sanitizeTypecheckLocations([{...good,code:"TS2304 secret"}]),[]);
  assert.deepEqual(sanitizeTypecheckLocations(Array.from({length:9},()=>good)),[]);
});

test("bounded compiler codes work with fileless errors and no source disclosure",()=>{
  const secret="SECRET_COMPILER_OUTPUT";
  const lines=[
    "error TS2688: "+secret,
    "apps/backend/src/user.ts(23,7): error TS2304: "+secret,
    "../private/path.ts(2,1): error TS2322: "+secret,
    "apps/frontend/src/App.tsx:51:12 - error TS2304: "+secret,
    "warning TS1111: "+secret,
    "comment error TS9999: "+secret,
    "error TS2688: "+secret
  ].join("\n");
  const codes=extractTypecheckErrorCodes(lines,"");
  assert.deepEqual(codes,["TS2304","TS2322","TS2688"]);
  assert.ok(!JSON.stringify(codes).includes(secret));
  assert.deepEqual(sanitizeTypecheckErrorCodes(codes),codes);
});

test("malformed, duplicate or unsorted TypeScript codes fail closed",()=>{
  for(const x of [[],["TS2304","TS2304"],["TS2688","TS2304"],
    ["TS2304;SECRET"],["TS999999"],["NOT_TS2304"],
    ["TS2304",{code:"TS2322"}],
    Array.from({length:9},(_,i)=>"TS"+(2000+i))])
    assert.deepEqual(sanitizeTypecheckErrorCodes(x),[]);
});

test("R85 normalized real npm workspace TypeScript paths match signed Gitea scope",()=>{
  const raw=[
    "> @iam/backend@0.1.0 typecheck",
    "> tsc --noEmit",
    "src/users/user.service.ts(57,7): error TS2820: SECRET_SOURCE_NEVER_LOG",
    "src/users/user.service.ts(60,7): error TS2820: SECRET_SOURCE_NEVER_LOG",
    "> @iam/frontend@0.1.0 typecheck",
    "> tsc --noEmit",
    "src/pages/UserDetailPage.tsx(12,4): error TS2322: SECRET_SOURCE_NEVER_LOG",
    "> @unknown/worker@1.0.0 typecheck",
    "src/secret.ts(1,1): error TS2304: SECRET_SOURCE_NEVER_LOG"
  ].join("\n");
  const a=extractTypecheckLocations(raw,"");
  assert.deepEqual(a,[
    {path:"apps/backend/src/users/user.service.ts",line:57,column:7,code:"TS2820"},
    {path:"apps/backend/src/users/user.service.ts",line:60,column:7,code:"TS2820"},
    {path:"apps/frontend/src/pages/UserDetailPage.tsx",line:12,column:4,code:"TS2322"},
    {path:"src/secret.ts",line:1,column:1,code:"TS2304"}
  ]);
  assert.doesNotMatch(JSON.stringify(a),/SECRET_SOURCE_NEVER_LOG/u);
});
test("R85 no workspace context means no inferred permission, and traversals stay rejected",()=>{
  const raw=[
    "src/users/a.ts(1,1): error TS2322: private",
    "> @iam/backend@0.1.0 typecheck",
    "../../private.ts(2,1): error TS2322: private",
    "/etc/keys.ts(2,1): error TS2322: private",
    "src/users/a.ts(3,1): error TS2322: private",
    "> @evil/unknown@1.0.0 typecheck",
    "src/users/b.ts(4,1): error TS2322: private"
  ].join("\n");
  assert.deepEqual(extractTypecheckLocations(raw,"").map(x=>x.path),[
    "src/users/a.ts","apps/backend/src/users/a.ts","src/users/b.ts"
  ]);
});
