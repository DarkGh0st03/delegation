import { randomBytes, sign, verify, createPrivateKey, createPublicKey } from "node:crypto";

export const MCP_AUDIENCE = "thesis-shared-mcp";
export const AGENT_ROLES = ["backend", "frontend", "test"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];
export type VerificationKeys = Readonly<Partial<Record<AgentRole, string>>>;
export interface TaskClaims {
  role: AgentRole;
  task_id: string;
  jti: string;
  iat: number;
  exp: number;
  aud: typeof MCP_AUDIENCE;
  iss: string;
}
const HEADER = Buffer.from(JSON.stringify({alg:"EdDSA",typ:"JWT"})).toString("base64url");
const MAX_AGE = 600;
function isRole(value: unknown): value is AgentRole {
  return typeof value === "string" && AGENT_ROLES.includes(value as AgentRole);
}
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
/** Use only in the private Agent runtime and only for an ACTIVE A2A task. */
export function issueTaskToken(
  privateKeyPem: string, role: AgentRole, taskId: string,
  now = Math.floor(Date.now()/1000), lifetimeSeconds = 300
): string {
  if (!isRole(role) || !taskId.trim() || taskId.length > 256 ||
      !Number.isInteger(lifetimeSeconds) || lifetimeSeconds < 1 || lifetimeSeconds > MAX_AGE) {
    throw new Error("Invalid task token parameters");
  }
  const claims: TaskClaims = {
    role, task_id:taskId, jti:randomBytes(16).toString("base64url"),
    iat:now, exp:now+lifetimeSeconds, aud:MCP_AUDIENCE, iss:"thesis-agent-"+role
  };
  const data = HEADER+"."+Buffer.from(JSON.stringify(claims)).toString("base64url");
  return data+"."+sign(null,Buffer.from(data),createPrivateKey(privateKeyPem)).toString("base64url");
}
/** Verifies identity and expiry, NOT repository authorization. No private keys at MCP. */
export function verifyTaskToken(
  token: string, publicKeys: VerificationKeys, now = Math.floor(Date.now()/1000)
): Readonly<TaskClaims> {
  if (!token || token.length > 8192) throw new Error("invalid_task_token");
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== HEADER ||
      !parts.slice(1).every(x => /^[A-Za-z0-9_-]+$/u.test(x))) {
    throw new Error("invalid_task_token");
  }
  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")); }
  catch { throw new Error("invalid_task_token"); }
  const claims = object(decoded);
  if (!claims || !isRole(claims.role)) throw new Error("invalid_task_token");
  const publicKey = publicKeys[claims.role];
  if (!publicKey || !verify(null, Buffer.from(parts[0]+"."+parts[1]),
                            createPublicKey(publicKey),Buffer.from(parts[2]!,"base64url"))) {
    throw new Error("invalid_task_signature");
  }
  if (claims.aud !== MCP_AUDIENCE || claims.iss !== "thesis-agent-"+claims.role ||
      typeof claims.task_id !== "string" || !claims.task_id.trim() || claims.task_id.length > 256 ||
      typeof claims.jti !== "string" || !/^[A-Za-z0-9_-]{16,}$/u.test(claims.jti) ||
      !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) ||
      (claims.iat as number)>now+30 || (claims.exp as number)<=now ||
      (claims.exp as number)<=(claims.iat as number) ||
      (claims.exp as number)-(claims.iat as number)>MAX_AGE) {
    throw new Error("expired_or_invalid_task_scope");
  }
  return Object.freeze(claims as unknown as TaskClaims);
}
export function bearerToken(header: string | undefined): string {
  if (!header || !/^Bearer [A-Za-z0-9._-]+$/u.test(header)) throw new Error("unauthorized");
  return header.slice(7);
}
