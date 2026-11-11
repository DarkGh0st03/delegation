import test from "node:test";
import assert from "node:assert/strict";
import {parseApprovedApiActions,applyApprovedApiActions}
  from "./source-derived-frontend-api-edits.mjs";
const template=String.fromCharCode(96),expr=String.fromCharCode(36)+
  "{encodeURIComponent(id)}";
const source=[
  'import type { ApiError, UserDetails } from "@iam/shared";',
  "const ADMIN_HEADERS = {",
  '  "x-demo-role": "admin"',
  "};",
  "async function parseResponse<T>(response: Response): Promise<T> {",
  "  return (await response.json()) as T;",
  "}",
  "export async function getUser(id: string): Promise<UserDetails> {",
  "  return parseResponse<UserDetails>(",
  "    await fetch("+template+"/api/users/"+expr+template+", { headers: ADMIN_HEADERS })",
  "  );",
  "}",
  ""
].join("\n");
const directives="Implement authorized Account Suspension.\n"+
  "API ACTION suspendUser POST /suspend\n"+
  "API ACTION reactivateUser POST /reactivate";
test("API functions originate from approved Task and inspected source",()=>{
  const next=applyApprovedApiActions(source,parseApprovedApiActions(directives));
  assert.ok(next.startsWith(source));
  assert.ok(next.includes("export async function suspendUser(id: string)"));
  assert.ok(next.includes("export async function reactivateUser(id: string)"));
  assert.ok(next.includes("/api/users/"+expr+"/suspend"));
  assert.ok(next.includes("/api/users/"+expr+"/reactivate"));
});
test("real IAM baseline concatenation derives API calls without golden files",()=>{
  const original=source.replace(
    "await fetch("+template+"/api/users/"+expr+template+",",
    'await fetch("/api/users/" + encodeURIComponent(id),'
  );
  assert.notEqual(original,source);
  const next=applyApprovedApiActions(original,
    parseApprovedApiActions(directives));
  assert.ok(next.startsWith(original));
  assert.ok(next.includes(
    'await fetch("/api/users/" + encodeURIComponent(id) + "/suspend", {'));
  assert.ok(next.includes(
    'await fetch("/api/users/" + encodeURIComponent(id) + "/reactivate", {'));
  assert.ok(next.includes('method: "POST"'));
  const shifted=original.replaceAll("/api/users/","/identity/members/");
  const altered=applyApprovedApiActions(shifted,
    parseApprovedApiActions("API ACTION disableUser PATCH /disable"));
  assert.ok(altered.includes(
    'await fetch("/identity/members/" + encodeURIComponent(id) + "/disable", {'));
});
test("same code handles alternate file routing and rules",()=>{
  const original=source.replaceAll("/api/users/","/identity/members/");
  const next=applyApprovedApiActions(original,
    parseApprovedApiActions("API ACTION lockMember PATCH /lock"));
  assert.ok(next.includes("/identity/members/"+expr+"/lock"));
  assert.ok(next.includes("export async function lockMember(id: string)"));
  assert.ok(next.includes('method: "PATCH"'));
});
test("invalid directives, shadowed names and foreign source fail closed",()=>{
  for(const x of [
    directives+"\nAPI ACTION suspendUser POST /other",
    "API ACTION dangerous(); POST /hack",
    "API ACTION steal POST https://bad.site",
    "No API directive"
  ])assert.throws(()=>parseApprovedApiActions(x),/NO-GO/);
  const rules=parseApprovedApiActions(directives);
  for(const broken of [
    source.replace("const ADMIN_HEADERS = {","const HEADERS = {"),
    source.replace("/api/users/","http://evil.site/"),
    source.replace("getUser(id: string)","suspendUser(id: string)"),
    source+source
  ])assert.throws(()=>applyApprovedApiActions(broken,rules),/NO-GO/);
});
