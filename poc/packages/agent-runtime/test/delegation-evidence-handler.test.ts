import assert from "node:assert/strict";
import test from "node:test";
import {ControlledToolError} from "../src/controlled-errors.ts";
import {DelegationEvidenceHandler} from "../src/delegation-evidence-handler.ts";
import {fakeSigner} from "./fixtures/fake-presentation-signer.ts";

const prepared = {
  request_id: "req_evidence",
  audience: "cloud-access-gateway",
  challenge: "evidence-challenge",
  required_permission: {
    resource:
      "gitea://gitea.local/thesis/sample-app/branches/feature%2Fsample-change/files/apps/backend/src/users/user.service.ts",
    operation: "read_file"
  },
  expires_at: "2026-10-05T18:00:00.000Z"
};
const evidence = {
  credential: "child-credential-payload",
  credential_id: "urn:test:backend",
  presenter_id: "did:thesis:backend-agent"
};

test("the signer receives only the exact presentation request, never the credential", async () => {
  const calls: Parameters<ReturnType<typeof fakeSigner>>[0][] = [];
  const handler = new DelegationEvidenceHandler({
    adapterToken: "wallet-token", evidence,
    presentationSigner: fakeSigner("signed-vp", calls as never)
  });
  assert.equal(await handler.createPresentation(prepared), "signed-vp");
  assert.deepEqual(calls, [{
    credential_id: "urn:test:backend",
    disclosed_permissions: [prepared.required_permission],
    audience: prepared.audience,
    challenge: prepared.challenge
  }]);
  assert.equal(JSON.stringify(calls).includes("child-credential-payload"), false);
});

test("a signer failure or an empty VP is a controlled, redacted error", async () => {
  for (const presentationSigner of [
    async () => { throw Error("PRIVATE_SIGNER_DETAIL"); },
    async () => ""
  ]) {
    const handler = new DelegationEvidenceHandler({
      adapterToken: "wallet-token", evidence, presentationSigner
    });
    await assert.rejects(handler.createPresentation(prepared), (error: unknown) =>
      error instanceof ControlledToolError &&
      error.kind === "tool_unavailable" &&
      !String(error.message).includes("PRIVATE_SIGNER_DETAIL"));
  }
});

test("exactly one signer is required, and the canonical mode refuses a fake one", () => {
  assert.throws(() => new DelegationEvidenceHandler({adapterToken: "t", evidence}),
    /exactly one signer/u);
  assert.throws(() => new DelegationEvidenceHandler({adapterToken: "t", evidence,
    nativeSocketPath: "/tmp/wallet.sock", presentationSigner: fakeSigner()}),
    /exactly one signer/u);
  const previous = process.env.APPROVED_RUNNER_NATIVE_MCP;
  process.env.APPROVED_RUNNER_NATIVE_MCP = "1";
  try {
    assert.throws(() => new DelegationEvidenceHandler({adapterToken: "t", evidence,
      presentationSigner: fakeSigner()}), /requires native Rust signer socket/u);
  } finally {
    if (previous === undefined) delete process.env.APPROVED_RUNNER_NATIVE_MCP;
    else process.env.APPROVED_RUNNER_NATIVE_MCP = previous;
  }
});
