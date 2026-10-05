import assert from "node:assert/strict";
import test from "node:test";
import {
  ProviderNotFoundError,
  ProviderUnavailableError
} from "../src/errors.ts";
import { GiteaClient } from "../src/gitea-client.ts";

function clientWith(fetchFn: typeof fetch) {
  return new GiteaClient({
    baseUrl: "http://gitea:3000/",
    token: "gateway-secret",
    owner: "thesis",
    repository: "iam-console-poc",
    fetchFn
  });
}

test("Gitea client authenticates with Gateway token and validates repository identity", async () => {
  let auth = "";
  const client = clientWith((async (_url, init) => {
    auth = String((init?.headers as Record<string, string>)?.authorization ?? "");
    return new Response(
      JSON.stringify({
        name: "iam-console-poc",
        full_name: "thesis/iam-console-poc",
        default_branch: "main",
        object_format_name: "sha1",
        owner: { login: "thesis" }
      }),
      { status: 200 }
    );
  }) as typeof fetch);

  const metadata = await client.getRepositoryMetadata();
  assert.equal(auth, "token gateway-secret");
  assert.deepEqual(metadata, {
    full_name: "thesis/iam-console-poc",
    default_branch: "main",
    object_format_name: "sha1"
  });
});

test("readTextFile resolves branch then pins contents to exact commit SHA", async () => {
  const urls: string[] = [];
  const content = Buffer.from("export const value = 1;\n", "utf8").toString("base64");

  const client = clientWith((async (url) => {
    urls.push(String(url));
    if (String(url).includes("/branches/feature%2Faccount-suspension")) {
      return new Response(
        JSON.stringify({
          name: "feature/account-suspension",
          commit: { id: "abc123" }
        }),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify({
        type: "file",
        path: "apps/backend/src/users/user.service.ts",
        sha: "blob456",
        last_commit_sha: "commit789",
        size: 24,
        encoding: "base64",
        content
      }),
      { status: 200 }
    );
  }) as typeof fetch);

  const file = await client.readTextFile(
    "feature/account-suspension",
    "apps/backend/src/users/user.service.ts"
  );

  assert.equal(urls.length, 2);
  assert.match(urls[1], /ref=abc123$/u);
  assert.equal(file.revision, "abc123");
  assert.equal(file.blob_sha, "blob456");
  assert.equal(file.last_commit_sha, "commit789");
  assert.equal(file.content, "export const value = 1;\n");
});

test("Gitea 404 and transport failures become structured provider errors", async () => {
  const missing = clientWith((async () => new Response("", { status: 404 })) as typeof fetch);
  await assert.rejects(
    missing.getBranchMetadata("feature/account-suspension"),
    ProviderNotFoundError
  );

  const offline = clientWith((async () => {
    throw new Error("ECONNREFUSED");
  }) as typeof fetch);
  await assert.rejects(offline.getRepositoryMetadata(), ProviderUnavailableError);
});

test("readTextFile rejects directory, binary and unexpected response metadata", async () => {
  let call = 0;
  const client = clientWith((async () => {
    call += 1;
    if (call === 1) {
      return new Response(
        JSON.stringify({ name: "feature/account-suspension", commit: { id: "abc123" } }),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify({
        type: "file",
        path: "wrong/path.ts",
        sha: "blob",
        encoding: "base64",
        content: Buffer.from("text").toString("base64")
      }),
      { status: 200 }
    );
  }) as typeof fetch);

  await assert.rejects(
    client.readTextFile(
      "feature/account-suspension",
      "apps/backend/src/users/user.service.ts"
    ),
    ProviderUnavailableError
  );
});
