//! Phase-1b experiment: single- vs multi-permission VP verification on the REAL
//! trust layer (Anvil EVM registries, file public artifacts, did:ethr resolver).
//!
//! Uses only the public API of the core crate. The verifier is rebuilt for EVERY
//! verification exactly like `services/delegation-core-node/src/lib.rs::verify_real`
//! (EvmRegistryReader::connect, FilePublicArtifactStore::open_read_only,
//! DidEthrVerificationKeyProvider, EvmTrustResolver, JWT-authenticated and
//! EVM-anchored Status Lists). Each source is wrapped by a timing counter; JSON-RPC
//! traffic is counted by `rpc_count_proxy.py` placed between the verifier and Anvil.
//!
//! Setup (DID keys, enrolment, trust anchor, accumulator anchors, Status Lists) is
//! published on-chain beforehand and is NOT part of any measured interval.
//!
//! Required env: RPC_URL (proxy), RPC_URL_DIRECT (anvil), PROXY_CONTROL_URL,
//! DID_REGISTRY_ADDRESS, ENTERPRISE_TRUST_REGISTRY_ADDRESS, ISSUER_REGISTRY_ADDRESS,
//! DID_RESOLVER_SCRIPT, DID_PUBLISHER_SCRIPT, ARTIFACT_DIR.

use std::cell::Cell;
use std::fs::File;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::Command;
use std::rc::Rc;
use std::str::FromStr;
use std::time::{Duration, Instant};

use alloy::primitives::{Address, B256, keccak256};
use alloy::providers::ProviderBuilder;
use alloy::signers::local::PrivateKeySigner;
use alloy::sol;
use ark_bn254::Bn254;
use flate2::Compression;
use flate2::write::GzEncoder;
use josekit::jwk::Jwk;
use multibase::Base;
use serde_json::json;

use delegation::delegation::accumulator::accumulator_public_data::AccumulatorPublicData;
use delegation::delegation::authorization::authorization_context::AuthorizationContext;
use delegation::delegation::authorization::operation::Operation;
use delegation::delegation::authorization::permission::Permission;
use delegation::delegation::credentials::delegation::delegation_credential::DelegationCredential;
use delegation::delegation::credentials::generic::verifiable_credential::VerifiableCredential;
use delegation::delegation::issuance::delegation_issuer::DelegationIssuer;
use delegation::delegation::issuance::issuer_trait::Issuer;
use delegation::delegation::local::file_public_artifact_store::FilePublicArtifactStore;
use delegation::delegation::status::evm::status_list_anchor_reader::{
    StatusListAnchor, StatusListAnchorReader,
};
use delegation::delegation::status::model::bitstring_status_list_entry::BitstringStatusListEntry;
use delegation::delegation::status::model::status_list_credential_artifact::StatusListCredentialArtifact;
use delegation::delegation::status::provider::jwt_status_list_provider::{
    JwtAuthenticatedStatusListCredentialProvider, sign_status_list_credential_jwt,
};
use delegation::delegation::status::provider::status_list_credential_provider_trait::{
    StatusListCredentialProvider, StatusListCredentialProviderRef,
};
use delegation::delegation::status::resolver::evm_anchored_status_list_resolver::EvmAnchoredStatusListResolver;
use delegation::delegation::status::resolver::status_list_resolver_trait::StatusListResolverRef;
use delegation::delegation::trust::evm::evm_registry_reader::EvmRegistryReader;
use delegation::delegation::trust::evm::trust_chain_reader::{
    AccumulatorMaterialAnchor, TrustChainReader,
};
use delegation::delegation::trust::material::accumulator_material_provider::{
    AccumulatorMaterialProvider, AccumulatorMaterialProviderRef,
};
use delegation::delegation::trust::material::did_ethr_verification_key_provider::DidEthrVerificationKeyProvider;
use delegation::delegation::trust::material::verification_key_provider::{
    VerificationKeyProvider, VerificationKeyProviderRef,
};
use delegation::delegation::trust::model::identity_status::IdentityStatus;
use delegation::delegation::trust::resolver::evm_trust_resolver::EvmTrustResolver;
use delegation::delegation::trust::resolver::trust_resolver_trait::TrustResolverRef;
use delegation::delegation::verification::delegation_verifier::DelegationVerifier;
use delegation::delegation::verification::verifier_trait::Verifier;

type Curve = Bn254;

const CHAIN_ID: u64 = 31337;
const N_PERMISSIONS: usize = 128;
const AUDIENCE: &str = "cloud-access-gateway";
const BRANCH_URI: &str = "gitea://gitea.local/team/app/branches/feature%2Fs1";
// Anvil's public, well-known TEST accounts (mnemonic "test test ... junk").
const GOVERNANCE_KEY: &str = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ENGINEER: (&str, &str) = (
    "did:ethr:0x7a69:0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const ORCHESTRATOR: (&str, &str) = (
    "did:ethr:0x7a69:0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
);
const BACKEND: (&str, &str) = (
    "did:ethr:0x7a69:0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
);
const STATUS_ENGINEER: &str = "https://status.example/lists/engineer-revocation";
const STATUS_ORCHESTRATOR: &str = "https://status.example/lists/orchestrator-revocation";
// Status indices: root(exact)=1, child=2, root(dirscope)=3, child(dirscope)=4.

sol! {
    #[sol(rpc)]
    interface EnterpriseWriter {
        function enrollEnterpriseIdentity(address identity) external;
        function setTrustAnchor(address identity, bool enabled) external;
    }
    #[sol(rpc)]
    interface IssuerWriter {
        function publishAccumulatorMaterial(address issuer, bytes32 materialHash) external returns (uint64 version);
        function registerStatusList(address issuer, bytes32 listId, uint8 purpose, bytes32 artifactHash) external;
        function updateStatusList(address issuer, bytes32 listId, bytes32 artifactHash) external returns (uint64 version);
    }
}

struct Env {
    rpc: String,
    rpc_direct: String,
    proxy_control: String,
    did_registry: String,
    enterprise: String,
    issuer_registry: String,
    resolver: PathBuf,
    publisher: PathBuf,
    artifacts: PathBuf,
}

fn env(name: &str) -> Result<String, String> {
    std::env::var(name).map_err(|_| format!("missing env {name}"))
}

impl Env {
    fn read() -> Result<Self, String> {
        Ok(Self {
            rpc: env("RPC_URL")?,
            rpc_direct: env("RPC_URL_DIRECT")?,
            proxy_control: env("PROXY_CONTROL_URL")?,
            did_registry: env("DID_REGISTRY_ADDRESS")?,
            enterprise: env("ENTERPRISE_TRUST_REGISTRY_ADDRESS")?,
            issuer_registry: env("ISSUER_REGISTRY_ADDRESS")?,
            resolver: PathBuf::from(env("DID_RESOLVER_SCRIPT")?),
            publisher: PathBuf::from(env("DID_PUBLISHER_SCRIPT")?),
            artifacts: PathBuf::from(env("ARTIFACT_DIR")?),
        })
    }
}

// ---------------------------------------------------------------------------
// Minimal HTTP client for the proxy control endpoints (no extra dependency)
// ---------------------------------------------------------------------------

fn http(method: &str, url: &str) -> Result<String, String> {
    let rest = url.strip_prefix("http://").ok_or("proxy URL must be http://")?;
    let (host, path) = rest.split_once('/').map(|(h, p)| (h, format!("/{p}"))).unwrap_or((rest, "/".into()));
    let mut s = TcpStream::connect(host).map_err(|e| e.to_string())?;
    write!(s, "{method} {path} HTTP/1.1\r\nHost: {host}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        .map_err(|e| e.to_string())?;
    let mut buf = String::new();
    s.read_to_string(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf.split_once("\r\n\r\n").map(|(_, b)| b.to_string()).unwrap_or_default())
}

#[derive(Clone, Default)]
struct RpcStats {
    requests: u64,
    calls: u64,
    eth_call: u64,
    eth_get_logs: u64,
    eth_chain_id: u64,
    other: u64,
    upstream_ms: f64,
}

fn rpc_reset(e: &Env) -> Result<(), String> {
    http("POST", &format!("{}/__reset", e.proxy_control)).map(|_| ())
}

fn rpc_stats(e: &Env) -> Result<RpcStats, String> {
    let v: serde_json::Value = serde_json::from_str(&http("GET", &format!("{}/__stats", e.proxy_control))?)
        .map_err(|e| e.to_string())?;
    let m = &v["methods"];
    let get = |k: &str| m.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
    let calls = v["calls"].as_u64().unwrap_or(0);
    let (c, l, i) = (get("eth_call"), get("eth_getLogs"), get("eth_chainId"));
    Ok(RpcStats {
        requests: v["requests"].as_u64().unwrap_or(0),
        calls,
        eth_call: c,
        eth_get_logs: l,
        eth_chain_id: i,
        other: calls - c - l - i,
        upstream_ms: v["upstream_ms"].as_f64().unwrap_or(0.0),
    })
}

// ---------------------------------------------------------------------------
// Timing wrappers around the REAL trust-layer sources
// ---------------------------------------------------------------------------

#[derive(Default)]
struct Meter {
    chain_calls: Cell<u64>,
    chain_ns: Cell<u128>,
    did_calls: Cell<u64>,
    did_ns: Cell<u128>,
    file_calls: Cell<u64>,
    file_ns: Cell<u128>,
}

fn timed<T>(calls: &Cell<u64>, ns: &Cell<u128>, f: impl FnOnce() -> T) -> T {
    let t = Instant::now();
    let r = f();
    calls.set(calls.get() + 1);
    ns.set(ns.get() + t.elapsed().as_nanos());
    r
}

struct TimedChain {
    m: Rc<Meter>,
    inner: Rc<EvmRegistryReader>,
}
impl TrustChainReader for TimedChain {
    fn identity_status(&self, id: &str) -> Result<IdentityStatus, String> {
        timed(&self.m.chain_calls, &self.m.chain_ns, || self.inner.identity_status(id))
    }
    fn is_trust_anchor(&self, id: &str) -> Result<bool, String> {
        timed(&self.m.chain_calls, &self.m.chain_ns, || TrustChainReader::is_trust_anchor(self.inner.as_ref(), id))
    }
    fn latest_accumulator_material_version(&self, id: &str) -> Result<u64, String> {
        timed(&self.m.chain_calls, &self.m.chain_ns, || TrustChainReader::latest_accumulator_material_version(self.inner.as_ref(), id))
    }
    fn accumulator_material_anchor(&self, id: &str, v: u64) -> Result<AccumulatorMaterialAnchor, String> {
        timed(&self.m.chain_calls, &self.m.chain_ns, || TrustChainReader::accumulator_material_anchor(self.inner.as_ref(), id, v))
    }
}
impl StatusListAnchorReader for TimedChain {
    fn status_list_anchor(&self, issuer: &str, url: &str) -> Result<StatusListAnchor, String> {
        timed(&self.m.chain_calls, &self.m.chain_ns, || StatusListAnchorReader::status_list_anchor(self.inner.as_ref(), issuer, url))
    }
}

struct TimedKeys {
    m: Rc<Meter>,
    inner: DidEthrVerificationKeyProvider,
}
impl VerificationKeyProvider for TimedKeys {
    fn get_verification_key(&self, id: &str) -> Result<Jwk, String> {
        timed(&self.m.did_calls, &self.m.did_ns, || self.inner.get_verification_key(id))
    }
}

struct TimedFiles {
    m: Rc<Meter>,
    inner: FilePublicArtifactStore<Curve>,
}
impl AccumulatorMaterialProvider<Curve> for TimedFiles {
    fn get_accumulator_data_at_version(&self, id: &str, v: u64) -> Result<AccumulatorPublicData<Curve>, String> {
        timed(&self.m.file_calls, &self.m.file_ns, || self.inner.get_accumulator_data_at_version(id, v))
    }
}
impl StatusListCredentialProvider for TimedFiles {
    fn get_status_list_credential(&self, issuer: &str, url: &str) -> Result<StatusListCredentialArtifact, String> {
        timed(&self.m.file_calls, &self.m.file_ns, || self.inner.get_status_list_credential(issuer, url))
    }
}

/// Mirror of `verify_real`: build every reader for THIS verification.
fn build_verifier(e: &Env, m: &Rc<Meter>, rpc: &str) -> Result<DelegationVerifier<Curve>, String> {
    let files = Rc::new(TimedFiles { m: m.clone(), inner: FilePublicArtifactStore::<Curve>::open_read_only(&e.artifacts)? });
    let reader = timed(&m.chain_calls, &m.chain_ns, || {
        EvmRegistryReader::connect(rpc, &e.did_registry, &e.enterprise, &e.issuer_registry, CHAIN_ID)
    })?;
    let chain = Rc::new(TimedChain { m: m.clone(), inner: Rc::new(reader) });
    let keys: VerificationKeyProviderRef = Rc::new(TimedKeys {
        m: m.clone(),
        inner: DidEthrVerificationKeyProvider::new(&e.resolver, rpc, &e.did_registry, CHAIN_ID),
    });
    let trust_chain: Rc<dyn TrustChainReader> = chain.clone();
    let acc: AccumulatorMaterialProviderRef<Curve> = files.clone();
    let trust: TrustResolverRef<Curve> = Rc::new(EvmTrustResolver::new(trust_chain, acc, keys.clone()));
    let source: StatusListCredentialProviderRef = files;
    let authenticated: StatusListCredentialProviderRef = Rc::new(JwtAuthenticatedStatusListCredentialProvider::new(source, keys));
    let status_chain: Rc<dyn StatusListAnchorReader> = chain;
    let status: StatusListResolverRef = Rc::new(EvmAnchoredStatusListResolver::new(authenticated, status_chain));
    DelegationVerifier::<Curve>::new(trust, status)
}

// ---------------------------------------------------------------------------
// On-chain setup (not measured)
// ---------------------------------------------------------------------------

fn addr(did: &str) -> Address {
    Address::from_str(did.rsplit(':').next().unwrap()).unwrap()
}

fn public_jwk(jwk: &Jwk) -> Result<String, String> {
    let mut v = serde_json::to_value(jwk).map_err(|e| e.to_string())?;
    v.as_object_mut().ok_or("jwk")?.remove("d");
    Ok(v.to_string())
}

fn publish_did(e: &Env, did: &str, key: &str, jwk: &Jwk) -> Result<(), String> {
    let out = Command::new("node")
        .arg(&e.publisher)
        .env("RPC_URL", &e.rpc_direct)
        .env("REGISTRY_ADDRESS", &e.did_registry)
        .env("CHAIN_ID", CHAIN_ID.to_string())
        .env("IDENTITY_PRIVATE_KEY", key)
        .env("ED25519_JWK", public_jwk(jwk)?)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("DID publication failed for {did}: {}", String::from_utf8_lossy(&out.stderr)));
    }
    Ok(())
}

struct Chain {
    rt: tokio::runtime::Runtime,
    rpc: String,
    enterprise: Address,
    issuer_registry: Address,
}

async fn provider(rpc: &str, key: &str) -> Result<alloy::providers::DynProvider, String> {
    let signer: PrivateKeySigner = key.parse().map_err(|e: alloy::signers::local::LocalSignerError| e.to_string())?;
    let p = ProviderBuilder::new().wallet(signer).connect(rpc).await.map_err(|e| e.to_string())?;
    Ok(alloy::providers::Provider::erased(p))
}

fn status_document(issuer: &str, url: &str, revoked: &[usize]) -> Result<String, String> {
    let mut bits = vec![0u8; 16 * 1024];
    for &i in revoked {
        bits[i / 8] |= 0b1000_0000u8 >> (i % 8);
    }
    let mut enc = GzEncoder::new(Vec::new(), Compression::default());
    enc.write_all(&bits).map_err(|e| e.to_string())?;
    let compressed = enc.finish().map_err(|e| e.to_string())?;
    Ok(json!({
        "@context": ["https://www.w3.org/ns/credentials/v2"],
        "id": url, "type": ["VerifiableCredential", "BitstringStatusListCredential"],
        "issuer": issuer, "validFrom": "2026-01-01T00:00:00Z",
        "credentialSubject": {"id": format!("{url}#list"), "type": "BitstringStatusList",
            "statusPurpose": "revocation", "encodedList": multibase::encode(Base::Base64Url, compressed)}
    })
    .to_string())
}

struct World {
    env: Env,
    chain: Chain,
    writer: FilePublicArtifactStore<Curve>,
    engineer: DelegationIssuer<Curve>,
    orchestrator: DelegationIssuer<Curve>,
    backend: DelegationIssuer<Curve>,
    roots: [VerifiableCredential<DelegationCredential>; 2],
    children: [VerifiableCredential<DelegationCredential>; 2],
    files: Vec<Permission>,
}

impl World {
    fn publish_status(&self, issuer: &DelegationIssuer<Curve>, key: &str, url: &str, revoked: &[usize], register: bool) -> Result<(), String> {
        let jwt = sign_status_list_credential_jwt(&status_document(issuer.holder_id(), url, revoked)?, issuer.holder_jwk())?;
        self.writer.publish_status_jwt(issuer.holder_id(), url, &jwt)?;
        let hash = keccak256(jwt.as_bytes());
        let list_id = EvmRegistryReader::status_list_id(url);
        let (rpc, reg, who) = (self.chain.rpc.clone(), self.chain.issuer_registry, addr(issuer.holder_id()));
        let key = key.to_string();
        self.chain.rt.block_on(async move {
            let p = provider(&rpc, &key).await?;
            let r = IssuerWriter::new(reg, &p);
            if register {
                r.registerStatusList(who, list_id, 1, hash).send().await.map_err(|e| e.to_string())?
                    .get_receipt().await.map_err(|e| e.to_string())?;
            } else {
                r.updateStatusList(who, list_id, hash).send().await.map_err(|e| e.to_string())?
                    .get_receipt().await.map_err(|e| e.to_string())?;
            }
            Ok::<_, String>(())
        })
    }
}

fn setup(e: Env) -> Result<World, String> {
    let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    let chain = Chain {
        rt,
        rpc: e.rpc_direct.clone(),
        enterprise: Address::from_str(&e.enterprise).map_err(|x| x.to_string())?,
        issuer_registry: Address::from_str(&e.issuer_registry).map_err(|x| x.to_string())?,
    };
    std::fs::create_dir_all(&e.artifacts).map_err(|x| x.to_string())?;
    let writer = FilePublicArtifactStore::<Curve>::new(&e.artifacts)?;

    let mut engineer = DelegationIssuer::<Curve>::new(ENGINEER.0.to_string())?;
    let mut orchestrator = DelegationIssuer::<Curve>::new(ORCHESTRATOR.0.to_string())?;
    let backend = DelegationIssuer::<Curve>::new(BACKEND.0.to_string())?;

    for (issuer, key) in [(&engineer, ENGINEER.1), (&orchestrator, ORCHESTRATOR.1), (&backend, BACKEND.1)] {
        publish_did(&e, issuer.holder_id(), key, issuer.public_verification_key())?;
    }
    let (rpc, ent, reg) = (chain.rpc.clone(), chain.enterprise, chain.issuer_registry);
    chain.rt.block_on(async {
        let gov = provider(&rpc, GOVERNANCE_KEY).await?;
        let t = EnterpriseWriter::new(ent, &gov);
        for did in [ENGINEER.0, ORCHESTRATOR.0, BACKEND.0] {
            t.enrollEnterpriseIdentity(addr(did)).send().await.map_err(|x| x.to_string())?
                .get_receipt().await.map_err(|x| x.to_string())?;
        }
        t.setTrustAnchor(addr(ENGINEER.0), true).send().await.map_err(|x| x.to_string())?
            .get_receipt().await.map_err(|x| x.to_string())?;
        Ok::<_, String>(())
    })?;
    for (issuer, key) in [(&mut engineer, ENGINEER.1), (&mut orchestrator, ORCHESTRATOR.1)] {
        let data = issuer.accumulator_public_data();
        let commitment: B256 = EvmTrustResolver::<Curve>::accumulator_material_commitment(&data)?;
        let who = addr(issuer.holder_id());
        let k = key.to_string();
        chain.rt.block_on(async {
            let p = provider(&rpc, &k).await?;
            IssuerWriter::new(reg, &p).publishAccumulatorMaterial(who, commitment).send().await
                .map_err(|x| x.to_string())?.get_receipt().await.map_err(|x| x.to_string())?;
            Ok::<_, String>(())
        })?;
        let reader = EvmRegistryReader::connect(&rpc, &e.did_registry, &e.enterprise, &e.issuer_registry, CHAIN_ID)?;
        let version = TrustChainReader::latest_accumulator_material_version(&reader, issuer.holder_id())?;
        issuer.bind_accumulator_material_version(version)?;
        writer.publish_accumulator(issuer.holder_id(), version, &data)?;
    }

    let files: Vec<Permission> = (0..N_PERMISSIONS)
        .map(|i| Permission::new(format!("{BRANCH_URI}/files/src/module_{i:03}.ts"), Operation::ReadFile).unwrap())
        .collect();
    let ctx = vec![String::from("https://www.w3.org/ns/credentials/v2")];
    let entry = |i: &str, url: &str| BitstringStatusListEntry::revocation(None, i.to_string(), url.to_string()).unwrap();
    let mk_root = |id: &str, idx: &str, perms: Vec<Permission>| {
        engineer.issue_delegation_verifiable_credential(ctx.clone(), id.to_string(), entry(idx, STATUS_ENGINEER),
            "2026-01-01T00:00:00Z".into(), ORCHESTRATOR.0.into(), Duration::new(7200, 0), perms, None)
    };
    let root_exact = mk_root("urn:delegation:bench1b:root", "1", files.clone())?;
    let root_dir = mk_root("urn:delegation:bench1b:root-dir", "3",
        vec![Permission::new(format!("{BRANCH_URI}/directories/src"), Operation::ReadFile)?])?;
    let mk_child = |id: &str, idx: &str, parent: &VerifiableCredential<DelegationCredential>| {
        orchestrator.issue_delegation_verifiable_credential(ctx.clone(), id.to_string(), entry(idx, STATUS_ORCHESTRATOR),
            "2026-01-01T00:00:00Z".into(), BACKEND.0.into(), Duration::new(7200, 0), files.clone(), Some(parent.clone()))
    };
    let child_exact = mk_child("urn:delegation:bench1b:child", "2", &root_exact)?;
    let child_dir = mk_child("urn:delegation:bench1b:child-dir", "4", &root_dir)?;

    let world = World { env: e, chain, writer, engineer, orchestrator, backend,
        roots: [root_exact, root_dir], children: [child_exact, child_dir], files };
    world.publish_status(&world.engineer, ENGINEER.1, STATUS_ENGINEER, &[], true)?;
    world.publish_status(&world.orchestrator, ORCHESTRATOR.1, STATUS_ORCHESTRATOR, &[], true)?;
    Ok(world)
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq)]
enum Config { Root, Child, ChildDirScope }
impl Config {
    fn name(self) -> &'static str {
        match self { Config::Root => "root", Config::Child => "child", Config::ChildDirScope => "child_dirscope" }
    }
}

fn holder<'a>(w: &'a World, c: Config) -> (&'a DelegationIssuer<Curve>, &'a VerifiableCredential<DelegationCredential>, &'static str) {
    match c {
        Config::Root => (&w.orchestrator, &w.roots[0], ORCHESTRATOR.0),
        Config::Child => (&w.backend, &w.children[0], BACKEND.0),
        Config::ChildDirScope => (&w.backend, &w.children[1], BACKEND.0),
    }
}

#[derive(Default)]
struct Obs {
    gen_ns: u128,
    verify_ns: u128,
    vp_bytes: usize,
    n_vps: usize,
    chain_calls: u64,
    chain_ns: u128,
    did_calls: u64,
    did_ns: u128,
    file_calls: u64,
    file_ns: u128,
    rpc: RpcStats,
    ok: bool,
    error: String,
}

fn verify_one(w: &World, presenter: &str, required: Vec<Permission>, challenge: &str, vp: String, rpc: &str, o: &mut Obs) -> Result<(), String> {
    let m = Rc::new(Meter::default());
    let t = Instant::now();
    let result = (|| {
        let ctx = AuthorizationContext::new_multiple(presenter.into(), AUDIENCE.into(), challenge.into(), required)?;
        let verifier = build_verifier(&w.env, &m, rpc)?;
        verifier.verify_verifiable_presentation(ctx, vp)
    })();
    o.verify_ns += t.elapsed().as_nanos();
    o.chain_calls += m.chain_calls.get();
    o.chain_ns += m.chain_ns.get();
    o.did_calls += m.did_calls.get();
    o.did_ns += m.did_ns.get();
    o.file_calls += m.file_calls.get();
    o.file_ns += m.file_ns.get();
    if let Err(err) = result {
        o.ok = false;
        if o.error.is_empty() {
            o.error = err;
        }
    }
    Ok(())
}

fn trial(w: &World, c: Config, multi: bool, k: usize, seq: &mut u64, rpc: &str, count_rpc: bool) -> Result<Obs, String> {
    let (h, vc, presenter) = holder(w, c);
    let batches: Vec<Vec<Permission>> = if multi { vec![w.files[..k].to_vec()] } else { w.files[..k].iter().map(|p| vec![p.clone()]).collect() };
    let mut o = Obs { ok: true, ..Default::default() };
    if count_rpc { rpc_reset(&w.env)?; }
    for batch in batches {
        *seq += 1;
        let challenge = format!("bench1b-{seq}");
        let cred = vc.clone();
        let t = Instant::now();
        let vp = h.issue_delegation_verifiable_presentation(cred, batch.clone(), AUDIENCE.into(), challenge.clone())?;
        o.gen_ns += t.elapsed().as_nanos();
        o.vp_bytes += vp.len();
        o.n_vps += 1;
        verify_one(w, presenter, batch, &challenge, vp, rpc, &mut o)?;
    }
    if count_rpc { o.rpc = rpc_stats(&w.env)?; }
    Ok(o)
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 { let mut x = self.0; x ^= x << 13; x ^= x >> 7; x ^= x << 17; self.0 = x; x }
    fn shuffle<T>(&mut self, v: &mut [T]) { for i in (1..v.len()).rev() { let j = (self.next() % (i as u64 + 1)) as usize; v.swap(i, j); } }
}

fn arg(a: &[String], n: &str) -> Option<String> { a.iter().position(|x| x == n).and_then(|i| a.get(i + 1).cloned()) }

fn main() -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();
    let out = PathBuf::from(arg(&args, "--out").ok_or("--out required")?);
    let reps: usize = arg(&args, "--reps").map(|s| s.parse().unwrap()).unwrap_or(20);
    let warmup: usize = arg(&args, "--warmup").map(|s| s.parse().unwrap()).unwrap_or(2);
    let neg_reps: usize = arg(&args, "--neg-reps").map(|s| s.parse().unwrap()).unwrap_or(5);
    let proxy_reps: usize = arg(&args, "--proxy-reps").map(|s| s.parse().unwrap()).unwrap_or(3);
    let seed: u64 = arg(&args, "--seed").map(|s| s.parse().unwrap()).unwrap_or(0x1b_2026_1125);
    let ks: Vec<usize> = arg(&args, "--ks").unwrap_or_else(|| "1,2,5,10,15".into()).split(',').map(|s| s.parse().unwrap()).collect();
    std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;

    let started = Instant::now();
    let w = setup(Env::read()?)?;
    eprintln!("[{:>7.1}s] on-chain setup done", started.elapsed().as_secs_f64());
    let configs = [Config::Root, Config::Child, Config::ChildDirScope];

    let mut pos = File::create(out.join("positive.csv")).map_err(|e| e.to_string())?;
    writeln!(pos, "config,mode,k,rep,path,n_vps,gen_us,verify_us,total_us,vp_bytes,chain_calls,chain_ms,did_resolutions,did_ms,file_reads,file_ms,rpc_requests,rpc_calls,rpc_eth_call,rpc_eth_getLogs,rpc_eth_chainId,rpc_other,rpc_upstream_ms,ok,error").unwrap();
    let rpc_proxy = w.env.rpc.clone();
    let rpc_direct = w.env.rpc_direct.clone();
    let mut rng = Rng(seed);
    let mut seq = 0u64;
    let mut plan: Vec<(Config, bool, usize)> = Vec::new();
    for &c in &configs { for &k in &ks { plan.push((c, false, k)); plan.push((c, true, k)); } }

    let write = |pos: &mut File, c: Config, multi: bool, k: usize, rep: usize, path: &str, o: &Obs| {
        let r = &o.rpc;
        writeln!(pos, "{},{},{},{},{},{},{:.1},{:.1},{:.1},{},{},{:.3},{},{:.3},{},{:.3},{},{},{},{},{},{},{:.3},{},{}",
            c.name(), if multi { "multi" } else { "single" }, k, rep, path, o.n_vps,
            o.gen_ns as f64 / 1e3, o.verify_ns as f64 / 1e3, (o.gen_ns + o.verify_ns) as f64 / 1e3, o.vp_bytes,
            o.chain_calls, o.chain_ns as f64 / 1e6, o.did_calls, o.did_ns as f64 / 1e6, o.file_calls, o.file_ns as f64 / 1e6,
            r.requests, r.calls, r.eth_call, r.eth_get_logs, r.eth_chain_id, r.other, r.upstream_ms,
            o.ok, o.error.replace([',', '\n', '"'], " ").chars().take(160).collect::<String>()).unwrap();
    };

    // Main LATENCY campaign: direct to Anvil (no proxy in the path), all 3 configs
    // interleaved in random order, warm-up discarded.
    for rep in 0..(warmup + reps) {
        rng.shuffle(&mut plan);
        for &(c, multi, k) in &plan {
            let o = trial(&w, c, multi, k, &mut seq, &rpc_direct, false)?;
            if rep >= warmup { write(&mut pos, c, multi, k, rep - warmup, "direct", &o); }
        }
        eprintln!("[{:>7.1}s] direct rep {}/{}", started.elapsed().as_secs_f64(), rep + 1, warmup + reps);
    }
    // RPC COUNT campaign: through the counting proxy (its forwarding inflates
    // latency, so these rows are used for request counts, not timing).
    for rep in 0..proxy_reps {
        rng.shuffle(&mut plan);
        for &(c, multi, k) in &plan {
            let o = trial(&w, c, multi, k, &mut seq, &rpc_proxy, true)?;
            write(&mut pos, c, multi, k, rep, "proxy", &o);
        }
        eprintln!("[{:>7.1}s] proxy rep {}/{}", started.elapsed().as_secs_f64(), rep + 1, proxy_reps);
    }

    // Negative cases on the real trust layer (k = 10, via proxy).
    let mut neg = File::create(out.join("negative.csv")).map_err(|e| e.to_string())?;
    writeln!(neg, "config,case,k,rep,rejected,verify_us,rpc_calls,error").unwrap();
    let k = 10.min(*ks.iter().max().unwrap());
    for rep in 0..neg_reps {
        for &c in &configs {
            let (h, vc, presenter) = holder(&w, c);
            let base = w.files[..k].to_vec();
            let mut run = |case: &str, required: Vec<Permission>, disclosed: Vec<Permission>, challenge_vp: &str, challenge_ctx: &str, seq: &mut u64| -> Result<(), String> {
                *seq += 1;
                let vp = h.issue_delegation_verifiable_presentation(vc.clone(), disclosed, AUDIENCE.into(), format!("{challenge_vp}-{seq}"))?;
                let mut o = Obs { ok: true, ..Default::default() };
                rpc_reset(&w.env)?;
                verify_one(&w, presenter, required, &format!("{challenge_ctx}-{seq}"), vp, &rpc_proxy, &mut o)?;
                let r = rpc_stats(&w.env)?;
                writeln!(neg, "{},{},{},{},{},{:.1},{},{}", c.name(), case, k, rep, !o.ok, o.verify_ns as f64 / 1e3, r.calls,
                    o.error.replace([',', '\n', '"'], " ").chars().take(160).collect::<String>()).unwrap();
                Ok(())
            };
            let foreign = Permission::new(format!("{BRANCH_URI}/files/secrets/deploy_key.pem"), Operation::ReadFile)?;
            let mut req = base[..k - 1].to_vec(); req.push(foreign);
            run("required_not_delegated", req, base[..k - 1].to_vec(), "c", "c", &mut seq)?;
            run("wrong_challenge", base.clone(), base.clone(), "a", "b", &mut seq)?;
            // Revoke the Root on-chain (Status List JWT rewritten + IssuerRegistry anchor updated).
            let root_bit = if c == Config::ChildDirScope { 3 } else { 1 };
            w.publish_status(&w.engineer, ENGINEER.1, STATUS_ENGINEER, &[root_bit], false)?;
            run("revoked_root_onchain", base.clone(), base.clone(), "c", "c", &mut seq)?;
            w.publish_status(&w.engineer, ENGINEER.1, STATUS_ENGINEER, &[], false)?;
            run("control_valid_batch", base.clone(), base.clone(), "c", "c", &mut seq)?;
        }
        eprintln!("[{:>7.1}s] negatives rep {}/{}", started.elapsed().as_secs_f64(), rep + 1, neg_reps);
    }

    let meta = json!({"phase": "1b", "ks": ks, "reps": reps, "warmup": warmup, "proxy_reps": proxy_reps, "latency_path": "direct", "count_path": "proxy",
        "negative_reps": neg_reps, "negative_k": k, "seed": seed, "n_permissions_in_credential": N_PERMISSIONS,
        "verifier": "rebuilt per verification like services/delegation-core-node verify_real",
        "elapsed_s": started.elapsed().as_secs_f64()});
    std::fs::write(out.join("run-meta.json"), serde_json::to_string_pretty(&meta).unwrap()).map_err(|e| e.to_string())?;
    let _ = &w.orchestrator;
    Ok(())
}
