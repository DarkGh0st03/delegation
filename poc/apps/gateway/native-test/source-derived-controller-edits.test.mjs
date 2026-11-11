import test from "node:test";
import assert from "node:assert/strict";
import {applyApprovedControllerInstructions,parseApprovedControllerInstructions}
  from "./source-derived-controller-edits.mjs";
const source=[
  'import type { NextFunction, Request, Response } from "express";',
  'import { z } from "zod";',
  'import { UserNotFoundError, UserService } from "./user.service.js";',
  '',
  'export function createUserController(service: UserService) {',
  '  return {',
  '    updateProfile(request: Request, response: Response, next: NextFunction): void {',
  '      try {',
  '        response.json(service.updateProfile(String(request.params.id), request.body));',
  '      } catch (error) {',
  '        next(error);',
  '      }',
  '    }',
  '  };',
  '}',
  '',
  'export function userErrorHandler(error: unknown, _request: Request,',
  '  response: Response, _next: NextFunction): void {',
  '  if (error instanceof UserNotFoundError) {',
  '    response.status(404).json({ code: "USER_NOT_FOUND" });',
  '    return;',
  '  }',
  '  if (error instanceof z.ZodError) {',
  '    response.status(400).json({ code: "INVALID_INPUT" });',
  '    return;',
  '  }',
  '}',
  ''
].join("\n");
const instructions=[
  'Implement the Account Suspension lifecycle, preserving profile behavior.',
  'CONTROLLER HANDLER suspendUser CALL suspendUser',
  'CONTROLLER HANDLER reactivateUser CALL reactivateUser',
  'CONTROLLER ERROR AccountStatusConflictError STATUS 409 CODE ACCOUNT_STATUS_CONFLICT'
].join("\n");
test("approved Task and original controller produce source-derived lifecycle handlers and HTTP conflict",()=>{
  const rules=parseApprovedControllerInstructions(instructions);
  const output=applyApprovedControllerInstructions(source,rules);
  assert.ok(output.includes("AccountStatusConflictError } from"));
  assert.ok(output.includes('response.json(service.suspendUser(String(request.params.id)));'));
  assert.ok(output.includes('response.json(service.reactivateUser(String(request.params.id)));'));
  assert.ok(output.includes('response.status(409).json({'));
  assert.ok(output.includes('code: "ACCOUNT_STATUS_CONFLICT"'));
  assert.ok(output.indexOf("suspendUser(request")<output.indexOf("reactivateUser(request"));
  assert.ok(output.indexOf("if (error instanceof AccountStatusConflictError)")<
    output.indexOf("if (error instanceof z.ZodError)"));
  assert.ok(output.includes("service.updateProfile(String(request.params.id), request.body)"));
});
test("different approved method instructions change generated code without new scenario",()=>{
  const altered=instructions.replace(
    "CONTROLLER HANDLER reactivateUser CALL reactivateUser",
    "CONTROLLER HANDLER restoreUser CALL reactivateUser");
  const output=applyApprovedControllerInstructions(source,
    parseApprovedControllerInstructions(altered));
  assert.ok(output.includes("restoreUser(request: Request"));
  assert.ok(output.includes("service.reactivateUser(String(request.params.id))"));
  assert.equal(output.includes("reactivateUser(request: Request"),false);
});
test("malformed/ambiguous/conflicting controller input fails closed",()=>{
  for(const bad of [
    instructions.replace("STATUS 409","STATUS 500"),
    instructions.replace("HANDLER suspendUser CALL suspendUser",
      "HANDLER suspendUser CALL dangerous;process.exit"),
    instructions+"\nCONTROLLER HANDLER suspendUser CALL suspendUser",
    instructions.replace("CONTROLLER ERROR AccountStatusConflictError STATUS 409 CODE ACCOUNT_STATUS_CONFLICT","")
  ])assert.throws(()=>parseApprovedControllerInstructions(bad),/NO-GO/);
  const rules=parseApprovedControllerInstructions(instructions);
  for(const bad of [
    source.replace('  if (error instanceof z.ZodError) {',""),
    source.replace('  };',"  // no closing controller anchor"),
    source.replace('import { UserNotFoundError, UserService } from "./user.service.js";',""),
    source.replace("    updateProfile(", "    suspendUser("),
    source.replace("if (error instanceof z.ZodError)",
      "if (error instanceof AccountStatusConflictError)")
  ])assert.throws(()=>applyApprovedControllerInstructions(bad,rules),/NO-GO/);
});
