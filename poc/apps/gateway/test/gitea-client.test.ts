import assert from "node:assert/strict";
import test from "node:test";
import {
  ProviderConflictError,
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


test("createBranch pins the requested base revision and posts the Gitea branch contract", async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const client = clientWith((async (url, init) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      ...(typeof init?.body === "string" ? { body: init.body } : {})
    });

    if ((init?.method ?? "GET") === "GET") {
      return new Response(
        JSON.stringify({ name: "main", commit: { id: "baseline123" } }),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify({
        name: "feature/account-suspension",
        commit: { id: "baseline123" }
      }),
      { status: 201 }
    );
  }) as typeof fetch);

  const created = await client.createBranch("main", "feature/account-suspension");

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/branches\/main$/u);
  assert.equal(calls[1].method, "POST");
  assert.match(calls[1].url, /\/branches$/u);
  assert.deepEqual(JSON.parse(calls[1].body ?? "{}"), {
    new_branch_name: "feature/account-suspension",
    old_branch_name: "main"
  });
  assert.deepEqual(created, {
    name: "feature/account-suspension",
    base_branch: "main",
    base_revision: "baseline123",
    commit_sha: "baseline123"
  });
});

test("createBranch fails closed if Gitea creates from a different revision", async () => {
  let call = 0;
  const client = clientWith((async () => {
    call += 1;
    if (call === 1) {
      return new Response(
        JSON.stringify({ name: "main", commit: { id: "baseline123" } }),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify({
        name: "feature/account-suspension",
        commit: { id: "unexpected456" }
      }),
      { status: 201 }
    );
  }) as typeof fetch);

  await assert.rejects(
    client.createBranch("main", "feature/account-suspension"),
    ProviderUnavailableError
  );
});

test("Gitea branch conflicts become structured provider conflicts", async () => {
  let call = 0;
  const client = clientWith((async () => {
    call += 1;
    if (call === 1) {
      return new Response(
        JSON.stringify({ name: "main", commit: { id: "baseline123" } }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ message: "branch already exists" }), {
      status: 409
    });
  }) as typeof fetch);

  await assert.rejects(
    client.createBranch("main", "feature/account-suspension"),
    ProviderConflictError
  );
});


test("createFile sends base64 content and returns commit/blob metadata", async () => {
  const calls: Array<{ method: string; url: string; body: Record<string, unknown> }> = [];
  const client = clientWith((async (url, init) => {
    calls.push({
      method: init?.method ?? "GET",
      url: String(url),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : {}
    });
    return new Response(
      JSON.stringify({
        content: {
          path: "tests/e2e/account-suspension.spec.ts",
          sha: "blob-created"
        },
        commit: { sha: "commit-created" }
      }),
      { status: 201 }
    );
  }) as typeof fetch);

  const result = await client.createFile(
    "feature/account-suspension",
    "tests/e2e/account-suspension.spec.ts",
    "test content\n",
    "thesis-gateway: create"
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].url, /\/contents\/tests\/e2e\/account-suspension\.spec\.ts$/u);
  assert.deepEqual(calls[0].body, {
    branch: "feature/account-suspension",
    content: Buffer.from("test content\n", "utf8").toString("base64"),
    message: "thesis-gateway: create"
  });
  assert.deepEqual(result, {
    path: "tests/e2e/account-suspension.spec.ts",
    branch: "feature/account-suspension",
    revision: "commit-created",
    commit_sha: "commit-created",
    blob_sha: "blob-created"
  });
});

test("createFile maps Gitea validation conflicts to provider conflict", async () => {
  const client = clientWith((async () =>
    new Response(JSON.stringify({ message: "file already exists" }), {
      status: 422
    })) as typeof fetch);

  await assert.rejects(
    client.createFile(
      "feature/account-suspension",
      "tests/e2e/account-suspension.spec.ts",
      "duplicate",
      "thesis-gateway: create"
    ),
    ProviderConflictError
  );
});

test("updateFile binds the PUT to the current blob SHA and returns the new revision", async () => {
  const calls: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];
  const content = Buffer.from("old source\n", "utf8").toString("base64");
  let call = 0;
  const client = clientWith((async (url, init) => {
    call += 1;
    const method = init?.method ?? "GET";
    calls.push({
      method,
      url: String(url),
      ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) } : {})
    });

    if (call === 1) {
      return new Response(
        JSON.stringify({
          name: "feature/account-suspension",
          commit: { id: "branch-before" }
        }),
        { status: 200 }
      );
    }
    if (call === 2) {
      return new Response(
        JSON.stringify({
          type: "file",
          path: "apps/backend/src/users/user.service.ts",
          sha: "blob-before",
          last_commit_sha: "commit-before",
          encoding: "base64",
          content
        }),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify({
        content: {
          path: "apps/backend/src/users/user.service.ts",
          sha: "blob-after"
        },
        commit: { sha: "commit-after" }
      }),
      { status: 200 }
    );
  }) as typeof fetch);

  const result = await client.updateFile(
    "feature/account-suspension",
    "apps/backend/src/users/user.service.ts",
    "new source\n",
    "thesis-gateway: update"
  );

  assert.equal(calls.length, 3);
  assert.equal(calls[2].method, "PUT");
  assert.deepEqual(calls[2].body, {
    branch: "feature/account-suspension",
    content: Buffer.from("new source\n", "utf8").toString("base64"),
    message: "thesis-gateway: update",
    sha: "blob-before"
  });
  assert.deepEqual(result, {
    path: "apps/backend/src/users/user.service.ts",
    branch: "feature/account-suspension",
    revision: "commit-after",
    commit_sha: "commit-after",
    blob_sha: "blob-after",
    previous_revision: "branch-before",
    precondition_blob_sha: "blob-before"
  });
});

test("updateFile maps a stale blob precondition to provider conflict", async () => {
  const content = Buffer.from("old source\n", "utf8").toString("base64");
  let call = 0;
  const client = clientWith((async () => {
    call += 1;
    if (call === 1) {
      return new Response(
        JSON.stringify({
          name: "feature/account-suspension",
          commit: { id: "branch-before" }
        }),
        { status: 200 }
      );
    }
    if (call === 2) {
      return new Response(
        JSON.stringify({
          type: "file",
          path: "apps/backend/src/users/user.service.ts",
          sha: "stale-blob",
          encoding: "base64",
          content
        }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ message: "sha does not match" }), {
      status: 409
    });
  }) as typeof fetch);

  await assert.rejects(
    client.updateFile(
      "feature/account-suspension",
      "apps/backend/src/users/user.service.ts",
      "new source",
      "thesis-gateway: update"
    ),
    ProviderConflictError
  );
});


test("createPullRequest pins the head revision and validates the returned branch direction", async () => {
  const calls: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];
  let call = 0;
  const client = clientWith((async (url, init) => {
    call += 1;
    calls.push({
      method: init?.method ?? "GET",
      url: String(url),
      ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) } : {})
    });
    if (call === 1) {
      return new Response(
        JSON.stringify({
          name: "feature/account-suspension",
          commit: { id: "head123" }
        }),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify({
        id: 77,
        number: 5,
        html_url: "http://gitea/thesis/iam-console-poc/pulls/5",
        head: { ref: "feature/account-suspension", sha: "head123" },
        base: { ref: "main" }
      }),
      { status: 201 }
    );
  }) as typeof fetch);

  const result = await client.createPullRequest(
    "feature/account-suspension",
    "main",
    "Account suspension",
    "Automated PoC pull request"
  );

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/branches\/feature%2Faccount-suspension$/u);
  assert.equal(calls[1].method, "POST");
  assert.match(calls[1].url, /\/pulls$/u);
  assert.deepEqual(calls[1].body, {
    head: "feature/account-suspension",
    base: "main",
    title: "Account suspension",
    body: "Automated PoC pull request"
  });
  assert.deepEqual(result, {
    id: 77,
    number: 5,
    url: "http://gitea/thesis/iam-console-poc/pulls/5",
    head_branch: "feature/account-suspension",
    base_branch: "main",
    head_revision: "head123"
  });
});

test("createPullRequest maps duplicate PR validation failures to provider conflict", async () => {
  let call = 0;
  const client = clientWith((async () => {
    call += 1;
    if (call === 1) {
      return new Response(
        JSON.stringify({
          name: "feature/account-suspension",
          commit: { id: "head123" }
        }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ message: "pull request already exists" }), {
      status: 422
    });
  }) as typeof fetch);

  await assert.rejects(
    client.createPullRequest(
      "feature/account-suspension",
      "main",
      "Account suspension"
    ),
    ProviderConflictError
  );
});


test("approved PR refuses changed HEAD before creating provider-side PR",async()=>{
  const approved="a".repeat(40);
  let posts=0;
  const client=clientWith((async (url,init)=>{
    if(init?.method==="POST")posts++;
    return new Response(JSON.stringify({
      name:"feature/account-suspension",
      commit:{id:"b".repeat(40)}
    }),{status:200});
  }) as typeof fetch);
  await assert.rejects(()=>client.createPullRequest(
    "feature/account-suspension","main","Review","",approved
  ),ProviderConflictError);
  assert.equal(posts,0);
});


test("approved PR detects changed Gitea head during POST, never attests it",async()=>{
  const approved="a".repeat(40),changed="b".repeat(40);
  let gets=0,posts=0;
  const client=clientWith((async(_url,init)=>{
    if(init?.method==="POST"){
      posts++;
      return new Response(JSON.stringify({
        id:77,number:7,
        head:{ref:"feature/account-suspension",sha:changed},
        base:{ref:"main"}
      }),{status:201});
    }
    gets++;
    return new Response(JSON.stringify({
      name:"feature/account-suspension",commit:{id:approved}
    }),{status:200});
  }) as typeof fetch);
  await assert.rejects(()=>client.createPullRequest(
    "feature/account-suspension","main","Review","",approved
  ),ProviderUnavailableError);
  assert.equal(gets,1);
  assert.equal(posts,1);
  // Gitea might have created the PR during this race. Its effect must not
  // be recorded as a verified success or used to authorize a merge.
});
test("malformed attested PR SHA is rejected before any Gitea request",async()=>{
  let touches=0;
  const client=clientWith((async()=>{
    touches++;
    throw Error("No network request allowed");
  }) as typeof fetch);
  await assert.rejects(()=>client.createPullRequest(
    "feature/account-suspension","main","Review","", "not-a-sha"
  ),ProviderConflictError);
  assert.equal(touches,0);
});

test("R143 Gitea creates exactly one draft only on accepted SHA; rechecks PR and branch",async()=>{
 const wanted="a".repeat(40),main="b".repeat(40);
 let posts=0,headReads=0,confirmationReads=0;
 const c=clientWith((async(url,init)=>{
  const u=String(url),method=init?.method??"GET";
  if(u.endsWith("/branches/feature%2Fr143-fix")){
   headReads++;
   return new Response(JSON.stringify({
    name:"feature/r143-fix",commit:{id:wanted}
   }),{status:200});
  }
  if(u.endsWith("/branches/main"))
   return new Response(JSON.stringify({name:"main",commit:{id:main}}),
    {status:200});
  const pr={
   id:12,number:3,state:"open",merged:false,draft:true,
   head:{ref:"feature/r143-fix",sha:wanted},
   base:{ref:"main",sha:main},
   html_url:"http://gitea:3000/thesis/iam-console-poc/pulls/3"
  };
  if(u.endsWith("/pulls")&&method==="POST"){
   posts++;const body=JSON.parse(String(init?.body));
   assert.deepEqual(body,{
    head:"feature/r143-fix",base:"main",title:"WIP: Review corrected tests",
    body:"Owner-reviewed correction"
   });
   return new Response(JSON.stringify(pr),{status:201});
  }
  if(u.endsWith("/pulls/3")&&method==="GET"){
   confirmationReads++;
   return new Response(JSON.stringify(pr),{status:200});
  }
  throw Error("Unapproved R143 Gitea request "+method+" "+u);
 }) as typeof fetch);
 const r=await c.createDraftPullRequest(
  "feature/r143-fix","main","Review corrected tests",wanted,
  "Owner-reviewed correction"
 );
 assert.equal(posts,1);assert.equal(headReads,2);
 assert.equal(confirmationReads,1);
 assert.equal(r.draft,true);assert.equal(r.open,true);
 assert.equal(r.merged,false);assert.equal(r.head_revision,wanted);
 assert.equal(r.number,3);
});
test("R150.10.3 Gitea draft title uses WIP protocol once; does not send ignored draft field",async()=>{
 const accepted="a".repeat(40),main="b".repeat(40);
 let submittedTitle=null,posts=0;
 const c=clientWith((async(url,init)=>{
  const u=String(url);
  if(u.endsWith("/branches/feature%2Fr143-fix"))
   return new Response(JSON.stringify({name:"feature/r143-fix",
    commit:{id:accepted}}),{status:200});
  if(u.endsWith("/branches/main"))
   return new Response(JSON.stringify({name:"main",commit:{id:main}}),
    {status:200});
  if(u.endsWith("/pulls")&&init?.method==="POST"){
   posts++;
   const request=JSON.parse(String(init.body));
   assert.equal(Object.hasOwn(request,"draft"),false,
    "Unsupported Gitea API draft request field must not be relied on");
   submittedTitle=request.title;
   return new Response(JSON.stringify({
    id:4,number:5,state:"open",merged:false,
    draft:request.title.startsWith("WIP: "),
    head:{ref:"feature/r143-fix",sha:accepted},
    base:{ref:"main",sha:main}
   }),{status:201});
  }
  if(u.endsWith("/pulls/5")&&init?.method==="GET")
   return new Response(JSON.stringify({
    id:4,number:5,state:"open",merged:false,draft:true,
    head:{ref:"feature/r143-fix",sha:accepted},
    base:{ref:"main",sha:main}
   }),{status:200});
  throw Error("Unexpected Gitea draft request");
 }) as typeof fetch);
 const out=await c.createDraftPullRequest(
  "feature/r143-fix","main","WIP: Verify repaired code",accepted
 );
 assert.equal(submittedTitle,"WIP: Verify repaired code");
 assert.equal(posts,1);
 assert.equal(out.draft,true);
 let sent=0;
 const bad=clientWith(async()=>{
  sent++;
  throw Error("no requests");
 });
 await assert.rejects(bad.createDraftPullRequest(
  "feature/r143-fix","main","x".repeat(158),accepted
 ),ProviderConflictError);
 assert.equal(sent,0);
});
test("R143 refuses changed Gitea head before POST and does not open a PR",async()=>{
 let posts=0;const c=clientWith((async(url,init)=>{
  if(init?.method==="POST"){posts++;throw Error("POST not allowed");}
  if(String(url).endsWith("/branches/feature%2Fr143-fix"))
   return new Response(JSON.stringify({
    name:"feature/r143-fix",commit:{id:"c".repeat(40)}
   }),{status:200});
  throw Error("Unapproved Gitea request");
 }) as typeof fetch);
 await assert.rejects(c.createDraftPullRequest(
  "feature/r143-fix","main","Review","a".repeat(40)
 ),ProviderConflictError);
 assert.equal(posts,0);
});
test("R143 refuses non-draft PR response, without a dangerous second POST",async()=>{
 const accepted="a".repeat(40),main="b".repeat(40);let posts=0;
 const c=clientWith((async(url,init)=>{
  const u=String(url);
  if(u.endsWith("/branches/feature%2Fr143-fix"))
   return new Response(JSON.stringify({
    name:"feature/r143-fix",commit:{id:accepted}
   }),{status:200});
  if(u.endsWith("/branches/main"))
   return new Response(JSON.stringify({name:"main",commit:{id:main}}),
    {status:200});
  if(u.endsWith("/pulls")&&init?.method==="POST"){
   posts++;
   return new Response(JSON.stringify({
    id:9,number:10,state:"open",merged:false,draft:false,
    head:{ref:"feature/r143-fix",sha:accepted},
    base:{ref:"main",sha:main}
   }),{status:201});
  }
  throw Error("Unapproved R143 request");
 }) as typeof fetch);
 await assert.rejects(c.createDraftPullRequest(
  "feature/r143-fix","main","Review",accepted
 ),ProviderUnavailableError);
 assert.equal(posts,1,"Never retry a potentially created non-draft PR");
});
