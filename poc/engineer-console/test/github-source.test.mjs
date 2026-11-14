import test from "node:test";
import assert from "node:assert/strict";
import {GitHubSource} from "../src/github.mjs";

const repos = [
  {name: "iam-console-poc", private: false, owner: {login: "DarkGh0st03"}, updated_at: "x"},
  {name: "secret-lib", private: true, owner: {login: "DarkGh0st03"}},
  {name: "forked-other", owner: {login: "someone-else"}},
  {name: "old", owner: {login: "DarkGh0st03"}, archived: true}
];
test("GitHub source lists only the owner's repositories and never exposes the token", async () => {
  const seen = [];
  const source = new GitHubSource({owner: "DarkGh0st03", token: "ghp_SERVER_SIDE_ONLY",
    fetchFn: async (url, init) => { seen.push([url, init.headers.authorization]); return Response.json(repos); }});
  const list = await source.listRepositories();
  assert.deepEqual(list.map(r => r.name), ["iam-console-poc", "secret-lib"]);
  assert.equal(JSON.stringify(list).includes("ghp_"), false);
  assert.match(seen[0][0], /\/user\/repos\?affiliation=owner/u);
  assert.equal(seen[0][1], "Bearer ghp_SERVER_SIDE_ONLY");
  assert.equal(await source.cloneUrlFor("secret-lib"), "https://github.com/DarkGh0st03/secret-lib.git");
  await assert.rejects(source.cloneUrlFor("forked-other"), /non è tra quelle/u);
  await assert.rejects(source.cloneUrlFor("../x"), /non valido/u);
  assert.deepEqual(source.cloneCredentials, {username: "DarkGh0st03", password: "ghp_SERVER_SIDE_ONLY"});
});
test("without a token the public listing of the owner is used", async () => {
  let url;
  const source = new GitHubSource({owner: "DarkGh0st03", fetchFn: async (u) => { url = u; return Response.json(repos); }});
  await source.listRepositories();
  assert.match(url, /\/users\/DarkGh0st03\/repos/u);
  assert.equal(source.cloneCredentials, undefined);
  assert.throws(() => new GitHubSource({owner: "bad/owner"}), /non valido/u);
});
