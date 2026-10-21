import assert from "node:assert/strict";
import test from "node:test";
import { GiteaClient } from "../src/gitea-client.ts";
import { GiteaReadOnlyExecutor } from "../src/gitea-read-executor.ts";
import { GiteaExecutor } from "../src/gitea-executor.ts";
import { ProviderUnavailableError, ProviderOperationUnavailableError } from "../src/errors.ts";
import { deriveRequiredPermission } from "../src/canonical.ts";
import { validatePrepareAuthorizationRequest } from "../src/validation.ts";
import { executeAuthorization } from "../src/execute.ts";
import { InMemoryAuditSink, InMemoryRequestStore, prepareAuthorization } from "../src/prepare.ts";
import type {
  PreparedRequestRecord, VerifiedDelegation, VerifierPort, PolicyPort
} from "../src/types.ts";

const repository = {authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const prepareConfig={audience:"cloud-access-gateway",request_ttl_ms:120_000,repository};
const base="http://gitea:3000/api/v1/repos/thesis/iam-console-poc";
const SHA="a".repeat(40);
const answer=(body:unknown)=>new Response(JSON.stringify(body),{status:200});
const branch=(name:string)=>({name,commit:{id:SHA}});
function clientWith(fetchFn:typeof fetch){
  return new GiteaClient({
    baseUrl:"http://gitea:3000",
    token:"gateway-secret",
    owner:"thesis",repository:"iam-console-poc",fetchFn
  });
}

function record(tool:"read_repository"|"list_directory"|"update_file"):PreparedRequestRecord{
  const raw={
    task_id:"planning-1",agent_role:"orchestrator",tool,
    arguments:tool==="read_repository"?{}:
      tool==="list_directory"?{branch:"main",path:"apps/backend"}:
        {branch:"main",path:"apps/backend/app.ts",content:"bad"}
  };
  const normalized=validatePrepareAuthorizationRequest(raw);
  return {
    request_id:"req-1",task_id:"planning-1",agent_role:"orchestrator",
    request:normalized.request,
    required_permission:deriveRequiredPermission(repository,normalized.request),
    audience:"cloud-access-gateway",challenge:"one-time",
    request_fingerprint:"fingerprint",created_at_ms:1,expires_at_ms:100,consumed:true
  };
}

test("repository discovery pins default-branch revision and validates configured Gitea identity",async()=>{
  const urls:string[]=[];
  const client=clientWith((async(url,init)=>{
    assert.equal((init?.method??"GET"),"GET");
    assert.equal((init?.headers as Record<string,string>).authorization,"token gateway-secret");
    urls.push(String(url));
    if(String(url)===base) return answer({
      name:"iam-console-poc",owner:{login:"thesis"},default_branch:"main",
      object_format_name:"sha1"
    });
    if(String(url)===base+"/branches/main")return answer(branch("main"));
    throw Error("unexpected URL "+String(url));
  }) as typeof fetch);
  assert.deepEqual(await client.readRepository(),{
    full_name:"thesis/iam-console-poc",
    default_branch:"main",object_format_name:"sha1",revision:SHA
  });
  assert.deepEqual(urls,[base,base+"/branches/main"]);
});

test("list_directory pins a nested directory to a fixed commit and returns bounded metadata",async()=>{
  const urls:string[]=[];
  const client=clientWith((async(url)=>{
    urls.push(String(url));
    if(String(url).startsWith(base+"/branches/"))return answer(branch("main"));
    if(String(url)===base+"/contents/apps/backend?ref="+SHA){
      return answer([
        {type:"dir",name:"utils",path:"apps/backend/utils"},
        {type:"file",name:"app.ts",path:"apps/backend/app.ts",size:77}
      ]);
    }
    throw Error("unexpected Gitea read "+String(url));
  }) as typeof fetch);
  const r=await client.listDirectory("main","apps/backend");
  assert.deepEqual(r,{
    branch:"main",path:"apps/backend",revision:SHA,
    entries:[
      {name:"app.ts",path:"apps/backend/app.ts",type:"file",size:77},
      {name:"utils",path:"apps/backend/utils",type:"dir"}
    ]
  });
  assert.equal(urls.length,2);
  assert.equal(urls[1],base+"/contents/apps/backend?ref="+SHA);
});

test("root directory uses contents endpoint without a path, also pinned",async()=>{
  const client=clientWith((async(url)=>{
    if(String(url).includes("/branches/main"))return answer(branch("main"));
    assert.equal(String(url),base+"/contents?ref="+SHA);
    return answer([{type:"file",name:"README.md",path:"README.md",size:42}]);
  }) as typeof fetch);
  const r=await client.listDirectory("main","");
  assert.equal(r.entries[0].path,"README.md");
  assert.equal(r.revision,SHA);
});

test("Gitea refuses forged paths, symlinks, duplicate and oversized directory responses",async()=>{
  for(const entries of [
    [{type:"file",name:"app.ts",path:"another/app.ts",size:1}],
    [{type:"file",name:"../secret",path:"apps/backend/../secret",size:1}],
    [{type:"symlink",name:"outside",path:"apps/backend/outside"}],
    [{type:"file",name:"app.ts",path:"apps/backend/app.ts",size:1},
     {type:"file",name:"app.ts",path:"apps/backend/app.ts",size:1}],
    new Array(201).fill(0).map((_,i)=>({
      type:"file",name:"f"+i,path:"apps/backend/f"+i,size:1
    }))
  ]){
    const client=clientWith((async(url)=>
      String(url).includes("/branches/")?answer(branch("main")):answer(entries)) as typeof fetch);
    await assert.rejects(client.listDirectory("main","apps/backend"),ProviderUnavailableError);
  }
});

test("read-only provider supports just three discovery tools; all mutations fail before Gitea calls",async()=>{
  const calls:string[]=[];
  const client={
    async readRepository(){calls.push("repository");return {
      full_name:"thesis/iam-console-poc",default_branch:"main",revision:SHA
    };},
    async listDirectory(){calls.push("directory");return {
      branch:"main",path:"apps/backend",revision:SHA,entries:[]
    };},
    async readTextFile(){calls.push("file");throw Error("not used");}
  } as unknown as GiteaClient;
  const executor=new GiteaReadOnlyExecutor(client);
  const a=await executor.execute(record("read_repository"));
  const b=await executor.execute(record("list_directory"));
  assert.equal(a.tool,"read_repository");
  assert.equal(b.tool,"list_directory");
  await assert.rejects(executor.execute(record("update_file")),ProviderOperationUnavailableError);
  assert.deepEqual(calls,["repository","directory"]);
});

test("normal Gitea executor also supports planning reads without calling mutation functions",async()=>{
  const calls:string[]=[];
  const client={
    async readRepository(){calls.push("repo");return {
      full_name:"thesis/iam-console-poc",default_branch:"main",revision:SHA
    };},
    async listDirectory(){calls.push("list");return {
      branch:"main",path:"apps/backend",revision:SHA,entries:[]
    };},
    async createFile(){calls.push("write");throw Error("forbidden");}
  } as unknown as GiteaClient;
  const exec=new GiteaExecutor(client);
  assert.equal((await exec.execute(record("read_repository"))).tool,"read_repository");
  assert.equal((await exec.execute(record("list_directory"))).tool,"list_directory");
  assert.deepEqual(calls,["repo","list"]);
});

test("canonical scope stays narrow and main reading still requires verifier and OPA",async()=>{
  const permission=deriveRequiredPermission(repository,record("list_directory").request);
  assert.deepEqual(permission,{
    resource:"gitea://gitea.local/thesis/iam-console-poc/branches/main/directories/apps/backend",
    operation:"list_directory"
  });
  const request=prepareAuthorization({
    task_id:"planning-1",agent_role:"orchestrator",tool:"list_directory",
    arguments:{branch:"main",path:"apps/backend"}
  },prepareConfig,{
    store:new InMemoryRequestStore(),audit:new InMemoryAuditSink(),
    requestId:()=> "req-any",challenge:()=> "challenge"
  });
  assert.deepEqual(request.required_permission,permission);

  const store=new InMemoryRequestStore(),audit=new InMemoryAuditSink();
  const prepared=prepareAuthorization({
    task_id:"planning-1",agent_role:"orchestrator",tool:"list_directory",
    arguments:{branch:"main",path:"apps/backend"}
  },prepareConfig,{
    store,audit,requestId:()=> "req-execute",challenge:()=> "challenge"
  });
  let verifierCalls=0,policyCalls=0,providerCalls=0;
  const verifier:VerifierPort={
    async verify(input){
      verifierCalls++;
      assert.deepEqual(input.required_permission,prepared.required_permission);
      return {
        presenter_id:"did:thesis:orchestrator",credential_id:"urn:vc",
        issuer_id:"did:thesis:engineer",permissions:[input.required_permission],
        hierarchy_depth:0,expiration:"99999999999999999999"
      };
    }
  };
  const policy:PolicyPort={
    async evaluate(input){
      policyCalls++;
      assert.equal(input.arguments.branch,"main");
      assert.equal(input.arguments.path,"apps/backend");
      return {allow:false,policy_version:"phase6-ro-v1"};
    }
  };
  await assert.rejects(executeAuthorization(
    {request_id:prepared.request_id,signed_vp:"signed.jwt"},
    {
      store,audit,verifier,policy,repository,
      executor:{
        provider:"gitea",
        async execute(){providerCalls++;throw Error("must not execute");}
      },
      nowMs:()=>Date.now()
    }
  ));
  assert.equal(verifierCalls,1);
  assert.equal(policyCalls,1);
  assert.equal(providerCalls,0);
});
