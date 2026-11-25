//! Phase-1 experiment: single-permission vs multi-permission VP verification.
//!
//! This example uses ONLY the public API of the `delegation` core crate. It does
//! not modify the workflow, the credential format or the smart contracts.
//!
//! The verifier is composed exactly like the native Gateway binding
//! (`services/delegation-core-node/src/lib.rs::verify_real`):
//!
//!   EvmTrustResolver(TrustChainReader, AccumulatorMaterialProvider, VerificationKeyProvider)
//!   EvmAnchoredStatusListResolver(JwtAuthenticatedStatusListCredentialProvider, StatusListAnchorReader)
//!
//! The only difference is that the trust-layer SOURCES (chain reads, DID key
//! resolution, public artifacts, Status List fetches) are in-memory and wrapped
//! by counters. Latencies therefore isolate the cryptographic/core cost; the
//! counters give the exact number of trust-layer queries a real deployment
//! would perform for the same verification.
//!
//! Usage:
//!   cargo run --release --example multi_permission_benchmark -- \
//!     --out <dir> [--reps 30] [--warmup 3] [--neg-reps 10] [--ks 1,2,5,10,15,32,64,128]

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::rc::Rc;
use std::time::{Duration, Instant};

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
use delegation::delegation::local::in_memory_public_material_store::InMemoryPublicMaterialStore;
use delegation::delegation::local::in_memory_status_list_store::InMemoryStatusListStore;
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
use delegation::delegation::trust::evm::trust_chain_reader::{
    AccumulatorMaterialAnchor, TrustChainReader,
};
use delegation::delegation::trust::material::accumulator_material_provider::{
    AccumulatorMaterialProvider, AccumulatorMaterialProviderRef,
};
use delegation::delegation::trust::material::verification_key_provider::{
    VerificationKeyProvider, VerificationKeyProviderRef,
};
use delegation::delegation::trust::model::identity_status::IdentityStatus;
use delegation::delegation::trust::resolver::evm_trust_resolver::EvmTrustResolver;
use delegation::delegation::trust::resolver::trust_resolver_trait::TrustResolverRef;
use delegation::delegation::verification::delegation_verifier::DelegationVerifier;
use delegation::delegation::verification::verifier_trait::Verifier;

type Curve = Bn254;

const N_PERMISSIONS: usize = 128;
const AUDIENCE: &str = "cloud-access-gateway";
const ENGINEER: &str = "did:ethr:0x7a69:0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const ORCHESTRATOR: &str = "did:ethr:0x7a69:0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const BACKEND: &str = "did:ethr:0x7a69:0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const BRANCH_URI: &str = "gitea://gitea.local/team/app/branches/feature%2Fs1";
const STATUS_ENGINEER: &str = "https://status.example/lists/engineer-revocation";
const STATUS_ORCHESTRATOR: &str = "https://status.example/lists/orchestrator-revocation";

// ---------------------------------------------------------------------------
// Trust-layer query counters
// ---------------------------------------------------------------------------

#[derive(Default)]
struct Counters {
    identity_status: Cell<u64>,
    trust_anchor: Cell<u64>,
    latest_material_version: Cell<u64>,
    material_anchor: Cell<u64>,
    accumulator_data: Cell<u64>,
    verification_key: Cell<u64>,
    status_anchor: Cell<u64>,
    status_list_fetch: Cell<u64>,
}

#[derive(Clone, Copy, Default)]
struct CountSnapshot {
    identity_status: u64,
    trust_anchor: u64,
    latest_material_version: u64,
    material_anchor: u64,
    accumulator_data: u64,
    verification_key: u64,
    status_anchor: u64,
    status_list_fetch: u64,
}

impl CountSnapshot {
    fn add(&mut self, o: &CountSnapshot) {
        self.identity_status += o.identity_status;
        self.trust_anchor += o.trust_anchor;
        self.latest_material_version += o.latest_material_version;
        self.material_anchor += o.material_anchor;
        self.accumulator_data += o.accumulator_data;
        self.verification_key += o.verification_key;
        self.status_anchor += o.status_anchor;
        self.status_list_fetch += o.status_list_fetch;
    }
    fn chain_reads(&self) -> u64 {
        self.identity_status
            + self.trust_anchor
            + self.latest_material_version
            + self.material_anchor
            + self.status_anchor
    }
    fn total(&self) -> u64 {
        self.chain_reads() + self.accumulator_data + self.verification_key + self.status_list_fetch
    }
}

impl Counters {
    fn reset(&self) {
        for c in [
            &self.identity_status,
            &self.trust_anchor,
            &self.latest_material_version,
            &self.material_anchor,
            &self.accumulator_data,
            &self.verification_key,
            &self.status_anchor,
            &self.status_list_fetch,
        ] {
            c.set(0);
        }
    }
    fn snapshot(&self) -> CountSnapshot {
        CountSnapshot {
            identity_status: self.identity_status.get(),
            trust_anchor: self.trust_anchor.get(),
            latest_material_version: self.latest_material_version.get(),
            material_anchor: self.material_anchor.get(),
            accumulator_data: self.accumulator_data.get(),
            verification_key: self.verification_key.get(),
            status_anchor: self.status_anchor.get(),
            status_list_fetch: self.status_list_fetch.get(),
        }
    }
}

fn bump(c: &Cell<u64>) {
    c.set(c.get() + 1);
}

/// In-memory stand-in for EvmRegistryReader (EnterpriseTrustRegistry + IssuerRegistry).
struct CountingChain {
    counters: Rc<Counters>,
    status: RefCell<HashMap<String, IdentityStatus>>,
    anchors: RefCell<HashMap<String, bool>>,
    versions: RefCell<HashMap<String, u64>>,
    material: RefCell<HashMap<(String, u64), AccumulatorMaterialAnchor>>,
    status_lists: RefCell<HashMap<(String, String), StatusListAnchor>>,
}

impl TrustChainReader for CountingChain {
    fn identity_status(&self, id: &str) -> Result<IdentityStatus, String> {
        bump(&self.counters.identity_status);
        self.status
            .borrow()
            .get(id)
            .copied()
            .ok_or_else(|| format!("Identity {id} is not enrolled"))
    }
    fn is_trust_anchor(&self, id: &str) -> Result<bool, String> {
        bump(&self.counters.trust_anchor);
        Ok(*self.anchors.borrow().get(id).unwrap_or(&false))
    }
    fn latest_accumulator_material_version(&self, id: &str) -> Result<u64, String> {
        bump(&self.counters.latest_material_version);
        Ok(*self.versions.borrow().get(id).unwrap_or(&0))
    }
    fn accumulator_material_anchor(
        &self,
        id: &str,
        version: u64,
    ) -> Result<AccumulatorMaterialAnchor, String> {
        bump(&self.counters.material_anchor);
        self.material
            .borrow()
            .get(&(id.to_string(), version))
            .cloned()
            .ok_or_else(|| format!("No accumulator anchor for {id} v{version}"))
    }
}

impl StatusListAnchorReader for CountingChain {
    fn status_list_anchor(&self, issuer: &str, url: &str) -> Result<StatusListAnchor, String> {
        bump(&self.counters.status_anchor);
        Ok(self
            .status_lists
            .borrow()
            .get(&(issuer.to_string(), url.to_string()))
            .cloned()
            .unwrap_or(StatusListAnchor {
                purpose: 0,
                current_artifact_hash: Default::default(),
                current_version: 0,
                updated_at: 0,
                exists: false,
            }))
    }
}

/// Counts public-artifact reads (FilePublicArtifactStore) and DID key resolutions
/// (DidEthrVerificationKeyProvider, a `node` subprocess per call in production).
struct CountingMaterial {
    counters: Rc<Counters>,
    inner: InMemoryPublicMaterialStore<Curve>,
}

impl AccumulatorMaterialProvider<Curve> for CountingMaterial {
    fn get_accumulator_data_at_version(
        &self,
        id: &str,
        version: u64,
    ) -> Result<AccumulatorPublicData<Curve>, String> {
        bump(&self.counters.accumulator_data);
        self.inner.get_accumulator_data_at_version(id, version)
    }
}

impl VerificationKeyProvider for CountingMaterial {
    fn get_verification_key(&self, id: &str) -> Result<Jwk, String> {
        bump(&self.counters.verification_key);
        self.inner.get_verification_key(id)
    }
}

/// Counts Status List artifact fetches (FilePublicArtifactStore in production).
struct CountingStatusSource {
    counters: Rc<Counters>,
    inner: InMemoryStatusListStore,
}

impl StatusListCredentialProvider for CountingStatusSource {
    fn get_status_list_credential(
        &self,
        issuer: &str,
        url: &str,
    ) -> Result<StatusListCredentialArtifact, String> {
        bump(&self.counters.status_list_fetch);
        self.inner.get_status_list_credential(issuer, url)
    }
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq)]
enum Config {
    /// Orchestrator presents the Root issued by the Engineer (depth 0).
    Root,
    /// Backend presents a Child of exact file permissions; the Root holds the
    /// same exact file permissions (depth 1).
    Child,
    /// Backend presents a Child of exact file permissions; the Root holds one
    /// recursive directory scope (depth 1, exercises `pp` + Gitea coverage).
    ChildDirScope,
}

impl Config {
    fn name(&self) -> &'static str {
        match self {
            Config::Root => "root",
            Config::Child => "child",
            Config::ChildDirScope => "child_dirscope",
        }
    }
}

struct Fixture {
    config: Config,
    holder: DelegationIssuer<Curve>,
    presenter: String,
    vc: VerifiableCredential<DelegationCredential>,
    permissions: Vec<Permission>,
    verifier: DelegationVerifier<Curve>,
    counters: Rc<Counters>,
    chain: Rc<CountingChain>,
    status_source: Rc<CountingStatusSource>,
    engineer_key: Jwk,
    orchestrator_key: Jwk,
    root_index: String,
    leaf_index: String,
}

fn file_permission(i: usize, op: Operation) -> Permission {
    Permission::new(format!("{BRANCH_URI}/files/src/module_{i:03}.ts"), op)
        .expect("valid permission")
}

fn status_entry(index: &str, url: &str) -> BitstringStatusListEntry {
    BitstringStatusListEntry::revocation(None, index.to_string(), url.to_string())
        .expect("valid status entry")
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
        "id": url,
        "type": ["VerifiableCredential", "BitstringStatusListCredential"],
        "issuer": issuer,
        "validFrom": "2026-01-01T00:00:00Z",
        "credentialSubject": {
            "id": format!("{url}#list"),
            "type": "BitstringStatusList",
            "statusPurpose": "revocation",
            "encodedList": multibase::encode(Base::Base64Url, compressed)
        }
    })
    .to_string())
}

impl Fixture {
    fn publish_status(&self, issuer: &str, url: &str, key: &Jwk, revoked: &[usize]) -> Result<(), String> {
        publish_status(&self.chain, &self.status_source, issuer, url, key, revoked)
    }
}

fn publish_status(
    chain: &CountingChain,
    source: &CountingStatusSource,
    issuer: &str,
    url: &str,
    key: &Jwk,
    revoked: &[usize],
) -> Result<(), String> {
    let token = sign_status_list_credential_jwt(&status_document(issuer, url, revoked)?, key)?;
    let version = chain
        .status_lists
        .borrow()
        .get(&(issuer.to_string(), url.to_string()))
        .map(|a| a.current_version + 1)
        .unwrap_or(1);
    source.inner.insert(issuer.to_string(), url.to_string(), token.clone());
    chain.status_lists.borrow_mut().insert(
        (issuer.to_string(), url.to_string()),
        StatusListAnchor {
            purpose: 1,
            current_artifact_hash: EvmAnchoredStatusListResolver::artifact_commitment(&token),
            current_version: version,
            updated_at: version,
            exists: true,
        },
    );
    Ok(())
}

fn issuer(id: &str, material: &CountingMaterial, chain: &CountingChain) -> Result<DelegationIssuer<Curve>, String> {
    let mut issuer = DelegationIssuer::<Curve>::new(id.to_string())?;
    issuer.bind_accumulator_material_version(1)?;
    let data = issuer.accumulator_public_data();
    let commitment = EvmTrustResolver::<Curve>::accumulator_material_commitment(&data)?;
    material.inner.insert_accumulator_data(id.to_string(), 1, data)?;
    material
        .inner
        .insert_verification_key(id.to_string(), issuer.public_verification_key().clone())?;
    chain.status.borrow_mut().insert(id.to_string(), IdentityStatus::Active);
    chain.versions.borrow_mut().insert(id.to_string(), 1);
    chain.material.borrow_mut().insert(
        (id.to_string(), 1),
        AccumulatorMaterialAnchor { material_hash: commitment, published_at: 1, exists: true },
    );
    Ok(issuer)
}

fn build_fixture(config: Config) -> Result<Fixture, String> {
    let counters = Rc::new(Counters::default());
    let chain = Rc::new(CountingChain {
        counters: counters.clone(),
        status: RefCell::new(HashMap::new()),
        anchors: RefCell::new(HashMap::new()),
        versions: RefCell::new(HashMap::new()),
        material: RefCell::new(HashMap::new()),
        status_lists: RefCell::new(HashMap::new()),
    });
    let material = Rc::new(CountingMaterial {
        counters: counters.clone(),
        inner: InMemoryPublicMaterialStore::<Curve>::new(),
    });
    let status_source = Rc::new(CountingStatusSource {
        counters: counters.clone(),
        inner: InMemoryStatusListStore::new(),
    });

    let engineer = issuer(ENGINEER, &material, &chain)?;
    let orchestrator = issuer(ORCHESTRATOR, &material, &chain)?;
    let backend = issuer(BACKEND, &material, &chain)?;
    chain.anchors.borrow_mut().insert(ENGINEER.to_string(), true);

    let files: Vec<Permission> = (0..N_PERMISSIONS)
        .map(|i| file_permission(i, Operation::ReadFile))
        .collect();
    let ctx = vec![String::from("https://www.w3.org/ns/credentials/v2")];
    let validity = Duration::new(7200, 0);
    let root_permissions = if config == Config::ChildDirScope {
        vec![Permission::new(format!("{BRANCH_URI}/directories/src"), Operation::ReadFile)?]
    } else {
        files.clone()
    };
    let root = engineer.issue_delegation_verifiable_credential(
        ctx.clone(),
        String::from("urn:delegation:bench:root"),
        status_entry("1", STATUS_ENGINEER),
        String::from("2026-01-01T00:00:00Z"),
        ORCHESTRATOR.to_string(),
        validity,
        root_permissions,
        None,
    )?;

    // Each issuer signs its own Status List with its own key.
    let engineer_key = engineer.holder_jwk().clone();
    let orchestrator_key = orchestrator.holder_jwk().clone();

    let (holder, presenter, vc, leaf_index) = match config {
        Config::Root => (orchestrator, ORCHESTRATOR.to_string(), root, String::from("1")),
        Config::Child | Config::ChildDirScope => {
            let child = orchestrator.issue_delegation_verifiable_credential(
                ctx,
                String::from("urn:delegation:bench:child"),
                status_entry("2", STATUS_ORCHESTRATOR),
                String::from("2026-01-01T00:00:00Z"),
                BACKEND.to_string(),
                Duration::new(1200, 0),
                files.clone(),
                Some(root),
            )?;
            (backend, BACKEND.to_string(), child, String::from("2"))
        }
    };

    let trust_chain: Rc<dyn TrustChainReader> = chain.clone();
    let acc: AccumulatorMaterialProviderRef<Curve> = material.clone();
    let keys: VerificationKeyProviderRef = material.clone();
    let trust: TrustResolverRef<Curve> =
        Rc::new(EvmTrustResolver::<Curve>::new(trust_chain, acc, keys.clone()));
    let source: StatusListCredentialProviderRef = status_source.clone();
    let authenticated: StatusListCredentialProviderRef =
        Rc::new(JwtAuthenticatedStatusListCredentialProvider::new(source, keys));
    let status_chain: Rc<dyn StatusListAnchorReader> = chain.clone();
    let status: StatusListResolverRef =
        Rc::new(EvmAnchoredStatusListResolver::new(authenticated, status_chain));
    let verifier = DelegationVerifier::<Curve>::new(trust, status)?;

    Ok(Fixture {
        config,
        holder,
        presenter,
        vc,
        permissions: files,
        verifier,
        counters,
        chain,
        status_source,
        engineer_key,
        orchestrator_key,
        root_index: String::from("1"),
        leaf_index,
    })
}

// ---------------------------------------------------------------------------
// Measurements
// ---------------------------------------------------------------------------

struct Trial {
    presentation: Duration,
    verify: Duration,
    vp_bytes: usize,
    n_vps: usize,
    counts: CountSnapshot,
    ok: bool,
    depth_ok: bool,
}

fn present(f: &Fixture, disclosed: Vec<Permission>, challenge: &str) -> Result<(String, Duration), String> {
    let vc = f.vc.clone();
    let t = Instant::now();
    let vp = f.holder.issue_delegation_verifiable_presentation(
        vc,
        disclosed,
        AUDIENCE.to_string(),
        challenge.to_string(),
    )?;
    Ok((vp, t.elapsed()))
}

fn verify(f: &Fixture, required: Vec<Permission>, challenge: &str, vp: String) -> (Result<usize, String>, Duration, CountSnapshot) {
    f.counters.reset();
    let t = Instant::now();
    let ctx = match AuthorizationContext::new_multiple(
        f.presenter.clone(),
        AUDIENCE.to_string(),
        challenge.to_string(),
        required,
    ) {
        Ok(ctx) => ctx,
        // Rejected before any cryptography (e.g. more than 128 requirements).
        Err(e) => return (Err(format!("context: {e}")), t.elapsed(), f.counters.snapshot()),
    };
    f.counters.reset();
    let t = Instant::now();
    let result = f.verifier.verify_verifiable_presentation(ctx, vp);
    let elapsed = t.elapsed();
    let counts = f.counters.snapshot();
    (result.map(|v| v.hierarchy_depth()), elapsed, counts)
}

fn expected_depth(c: Config) -> usize {
    if c == Config::Root { 0 } else { 1 }
}

fn trial(f: &Fixture, multi: bool, k: usize, seq: &mut u64) -> Result<Trial, String> {
    let mut t = Trial {
        presentation: Duration::ZERO,
        verify: Duration::ZERO,
        vp_bytes: 0,
        n_vps: 0,
        counts: CountSnapshot::default(),
        ok: true,
        depth_ok: true,
    };
    let batches: Vec<Vec<Permission>> = if multi {
        vec![f.permissions[..k].to_vec()]
    } else {
        f.permissions[..k].iter().map(|p| vec![p.clone()]).collect()
    };
    for batch in batches {
        *seq += 1;
        let challenge = format!("bench-challenge-{seq}");
        let (vp, g) = present(f, batch.clone(), &challenge)?;
        t.presentation += g;
        t.vp_bytes += vp.len();
        t.n_vps += 1;
        let (r, v, c) = verify(f, batch, &challenge, vp);
        t.verify += v;
        t.counts.add(&c);
        match r {
            Ok(depth) => t.depth_ok &= depth == expected_depth(f.config),
            Err(_) => t.ok = false,
        }
    }
    Ok(t)
}

/// Deterministic xorshift64 for randomized run order (seed recorded in output).
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    fn shuffle<T>(&mut self, v: &mut [T]) {
        for i in (1..v.len()).rev() {
            let j = (self.next() % (i as u64 + 1)) as usize;
            v.swap(i, j);
        }
    }
}

// ---------------------------------------------------------------------------
// Negative cases
// ---------------------------------------------------------------------------

struct Negative {
    case: &'static str,
    stage: &'static str,
    rejected: bool,
    verify: Duration,
    error: String,
}

/// Appends `value` (or a clone of the first element) to the array `key` of `obj`.
fn push_clone(obj: &mut serde_json::Value, key: &str, value: Option<serde_json::Value>) {
    if let Some(arr) = obj.get_mut(key).and_then(|a| a.as_array_mut()) {
        let v = value.or_else(|| arr.first().cloned());
        if let Some(v) = v {
            arr.push(v);
        }
    }
}

/// Finds the Delegation Credential object (the one carrying `per` and `pw`).
fn find_dc(v: &mut serde_json::Value) -> Option<&mut serde_json::Value> {
    if v.get("per").is_some() && v.get("pw").is_some() {
        return Some(v);
    }
    match v {
        serde_json::Value::Object(m) => m.values_mut().find_map(find_dc),
        serde_json::Value::Array(a) => a.iter_mut().find_map(find_dc),
        _ => None,
    }
}

/// Malicious-holder model: decode the holder's own VP, mutate the Delegation
/// Credential and re-sign with the holder's own Ed25519 key (valid signature).
fn forge(
    vp: &str,
    holder_key: &Jwk,
    mutate: impl FnOnce(&mut serde_json::Value),
) -> Result<String, String> {
    use base64::Engine as _;
    let part = vp.split('.').nth(1).ok_or("not a compact JWT")?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(part)
        .map_err(|e| e.to_string())?;
    let mut payload: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let dc = find_dc(&mut payload).ok_or("Delegation Credential not found in VP")?;
    mutate(dc);
    let map = payload.as_object().cloned().ok_or("payload is not an object")?;
    let payload = josekit::jwt::JwtPayload::from_map(map).map_err(|e| e.to_string())?;
    let mut header = josekit::jws::JwsHeader::new();
    header.set_algorithm("EdDSA");
    let signer = josekit::jws::EdDSA.signer_from_jwk(holder_key).map_err(|e| e.to_string())?;
    josekit::jwt::encode_with_signer(&payload, &header, &signer).map_err(|e| e.to_string())
}

fn foreign_permission() -> Permission {
    Permission::new(format!("{BRANCH_URI}/files/secrets/deploy_key.pem"), Operation::ReadFile)
        .expect("valid permission")
}

fn negatives(f: &Fixture, k: usize, seq: &mut u64) -> Result<Vec<Negative>, String> {
    let mut out = Vec::new();
    let base = f.permissions[..k].to_vec();
    // Cases that ADD one requirement keep the batch within the core bound of 128.
    let head = f.permissions[..k.min(127)].to_vec();
    let mut next_challenge = || {
        *seq += 1;
        format!("bench-negative-{seq}")
    };

    // N1: one required permission was never delegated (outside the credential).
    {
        let c = next_challenge();
        let disclosed = base[..k - 1].to_vec();
        let mut required = disclosed.clone();
        required.push(foreign_permission());
        let (vp, _) = present(f, if disclosed.is_empty() { base[..1].to_vec() } else { disclosed }, &c)?;
        let (r, v, _) = verify(f, required, &c, vp);
        out.push(Negative { case: "required_not_delegated", stage: "verify", rejected: r.is_err(), verify: v, error: r.err().unwrap_or_default() });
    }
    // N2: delegated but not disclosed in the VP (holder omits one).
    if k >= 2 {
        let c = next_challenge();
        let (vp, _) = present(f, base[..k - 1].to_vec(), &c)?;
        let (r, v, _) = verify(f, base.clone(), &c, vp);
        out.push(Negative { case: "required_not_disclosed", stage: "verify", rejected: r.is_err(), verify: v, error: r.err().unwrap_or_default() });
    }
    // N3: operation escalation inside the batch (read_file delegated, update_file required).
    {
        let c = next_challenge();
        let (vp, _) = present(f, base.clone(), &c)?;
        let mut required = base[..k - 1].to_vec();
        required.push(file_permission(k - 1, Operation::UpdateFile));
        let (r, v, _) = verify(f, required, &c, vp);
        out.push(Negative { case: "operation_escalation", stage: "verify", rejected: r.is_err(), verify: v, error: r.err().unwrap_or_default() });
    }
    // N4a: the wallet is asked to present a permission it does not hold.
    // `retain_only` keeps only the intersection with the credential, so the
    // unheld permission is silently absent from the VP; verification must
    // then reject the batch that requires it.
    {
        let c = next_challenge();
        let mut requested = head.clone();
        requested.push(foreign_permission());
        let (vp, _) = present(f, requested.clone(), &c)?;
        let (r, v, _) = verify(f, requested, &c, vp);
        out.push(Negative { case: "unheld_permission_requested", stage: "verify", rejected: r.is_err(), verify: v, error: r.err().unwrap_or_default() });
    }
    // N4b: malicious holder edits its own VP: appends an undelegated permission,
    // reuses an existing valid witness for it and RE-SIGNS with its own key.
    // The signature is valid; only the accumulator can stop this.
    {
        let c = next_challenge();
        let (vp, _) = present(f, head.clone(), &c)?;
        let foreign = serde_json::to_value(foreign_permission()).map_err(|e| e.to_string())?;
        let forged = forge(&vp, f.holder.holder_jwk(), |dc| {
            push_clone(dc, "per", Some(foreign.clone()));
            push_clone(dc, "pw", None);
            if let Some(h) = dc.get_mut("hierarchy").and_then(|h| h.as_array_mut()) {
                for e in h {
                    push_clone(e, "pw", None);
                    if e.get("pp").is_some() {
                        push_clone(e, "pp", Some(foreign.clone()));
                    }
                }
            }
        })?;
        let mut required = head.clone();
        required.push(foreign_permission());
        let (r, v, _) = verify(f, required, &c, forged);
        out.push(Negative { case: "forged_permission_reused_witness", stage: "verify", rejected: r.is_err(), verify: v, error: r.err().unwrap_or_default() });
    }
    // N4c: malicious holder swaps two witnesses inside its own re-signed VP.
    if k >= 2 {
        let c = next_challenge();
        let (vp, _) = present(f, base.clone(), &c)?;
        let forged = forge(&vp, f.holder.holder_jwk(), |dc| {
            if let Some(pw) = dc.get_mut("pw").and_then(|p| p.as_array_mut()) {
                pw.swap(0, 1);
            }
        })?;
        let (r, v, _) = verify(f, base.clone(), &c, forged);
        out.push(Negative { case: "witness_swap", stage: "verify", rejected: r.is_err(), verify: v, error: r.err().unwrap_or_default() });
    }
    // N8: batch over the core bound (129 requirements) is refused before crypto.
    if k == 128 {
        let c = next_challenge();
        let (vp, _) = present(f, base.clone(), &c)?;
        let mut required = base.clone();
        required.push(foreign_permission());
        let (r, v, _) = verify(f, required, &c, vp);
        out.push(Negative { case: "batch_over_128", stage: "context", rejected: r.is_err(), verify: v, error: r.err().unwrap_or_default() });
    }
    // N5: wrong challenge (VP replayed against a different Prepare).
    {
        let c1 = next_challenge();
        let c2 = next_challenge();
        let (vp, _) = present(f, base.clone(), &c1)?;
        let (r, v, _) = verify(f, base.clone(), &c2, vp);
        out.push(Negative { case: "wrong_challenge", stage: "verify", rejected: r.is_err(), verify: v, error: r.err().unwrap_or_default() });
    }
    // N6: revoked ancestor (Child configs) / revoked credential (Root config).
    {
        let root_bit: usize = f.root_index.parse().unwrap();
        f.publish_status(ENGINEER, STATUS_ENGINEER, &f.engineer_key, &[root_bit])?;
        let c = next_challenge();
        let (vp, _) = present(f, base.clone(), &c)?;
        let (r, v, _) = verify(f, base.clone(), &c, vp);
        out.push(Negative { case: "revoked_root", stage: "verify", rejected: r.is_err(), verify: v, error: r.err().unwrap_or_default() });
        f.publish_status(ENGINEER, STATUS_ENGINEER, &f.engineer_key, &[])?;
    }
    // N7: revoked leaf Child only (Child configs).
    if f.config != Config::Root {
        let leaf_bit: usize = f.leaf_index.parse().unwrap();
        f.publish_status(ORCHESTRATOR, STATUS_ORCHESTRATOR, &f.orchestrator_key, &[leaf_bit])?;
        let c = next_challenge();
        let (vp, _) = present(f, base.clone(), &c)?;
        let (r, v, _) = verify(f, base.clone(), &c, vp);
        out.push(Negative { case: "revoked_child", stage: "verify", rejected: r.is_err(), verify: v, error: r.err().unwrap_or_default() });
        f.publish_status(ORCHESTRATOR, STATUS_ORCHESTRATOR, &f.orchestrator_key, &[])?;
    }
    // Sanity: the same batch is accepted again after restoring status.
    {
        let c = next_challenge();
        let (vp, _) = present(f, base.clone(), &c)?;
        let (r, v, _) = verify(f, base.clone(), &c, vp);
        out.push(Negative { case: "control_valid_batch", stage: "verify", rejected: r.is_err(), verify: v, error: r.err().unwrap_or_default() });
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

fn main() -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();
    let out = PathBuf::from(arg(&args, "--out").ok_or("--out <dir> required")?);
    let reps: usize = arg(&args, "--reps").map(|s| s.parse().unwrap()).unwrap_or(30);
    let warmup: usize = arg(&args, "--warmup").map(|s| s.parse().unwrap()).unwrap_or(3);
    let neg_reps: usize = arg(&args, "--neg-reps").map(|s| s.parse().unwrap()).unwrap_or(10);
    let seed: u64 = arg(&args, "--seed").map(|s| s.parse().unwrap()).unwrap_or(0x5eed_2026_1125);
    let ks: Vec<usize> = arg(&args, "--ks")
        .unwrap_or_else(|| String::from("1,2,5,10,15,32,64,128"))
        .split(',')
        .map(|s| s.parse().unwrap())
        .collect();
    let configs: Vec<Config> = arg(&args, "--configs")
        .unwrap_or_else(|| String::from("root,child,child_dirscope"))
        .split(',')
        .map(|s| match s {
            "root" => Config::Root,
            "child" => Config::Child,
            "child_dirscope" => Config::ChildDirScope,
            other => panic!("unknown config {other}"),
        })
        .collect();
    std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;

    let mut pos = File::create(out.join("positive.csv")).map_err(|e| e.to_string())?;
    writeln!(pos, "config,mode,k,rep,n_vps,gen_us,verify_us,total_us,vp_bytes,q_identity_status,q_trust_anchor,q_latest_material_version,q_material_anchor,q_accumulator_data,q_verification_key,q_status_anchor,q_status_list_fetch,q_chain_reads,q_total,ok,depth_ok").unwrap();
    let mut neg = File::create(out.join("negative.csv")).map_err(|e| e.to_string())?;
    writeln!(neg, "config,case,k,rep,stage,rejected,verify_us,error").unwrap();

    let mut rng = Rng(seed);
    let mut seq: u64 = 0;
    let started = Instant::now();

    for &config in &configs {
        let fixture = build_fixture(config)?;
        // Initial (unrevoked) Status Lists, signed by each issuer's own key.
        fixture.publish_status(ENGINEER, STATUS_ENGINEER, &fixture.engineer_key, &[])?;
        if config != Config::Root {
            fixture.publish_status(ORCHESTRATOR, STATUS_ORCHESTRATOR, &fixture.orchestrator_key, &[])?;
        }

        let mut plan: Vec<(bool, usize)> = Vec::new();
        for &k in &ks {
            plan.push((false, k));
            plan.push((true, k));
        }
        for rep in 0..(warmup + reps) {
            rng.shuffle(&mut plan);
            for &(multi, k) in &plan {
                let t = trial(&fixture, multi, k, &mut seq)?;
                if rep < warmup {
                    continue;
                }
                let c = t.counts;
                writeln!(
                    pos,
                    "{},{},{},{},{},{:.1},{:.1},{:.1},{},{},{},{},{},{},{},{},{},{},{},{},{}",
                    config.name(),
                    if multi { "multi" } else { "single" },
                    k,
                    rep - warmup,
                    t.n_vps,
                    t.presentation.as_secs_f64() * 1e6,
                    t.verify.as_secs_f64() * 1e6,
                    (t.presentation + t.verify).as_secs_f64() * 1e6,
                    t.vp_bytes,
                    c.identity_status,
                    c.trust_anchor,
                    c.latest_material_version,
                    c.material_anchor,
                    c.accumulator_data,
                    c.verification_key,
                    c.status_anchor,
                    c.status_list_fetch,
                    c.chain_reads(),
                    c.total(),
                    t.ok,
                    t.depth_ok
                )
                .unwrap();
            }
            eprintln!("[{:>7.1}s] {} rep {}/{}", started.elapsed().as_secs_f64(), config.name(), rep + 1, warmup + reps);
        }

        for rep in 0..neg_reps {
            for &k in &[1usize, 10, 128] {
                for n in negatives(&fixture, k, &mut seq)? {
                    let err = n.error.replace([',', '\n', '"'], " ");
                    let err: String = err.chars().take(160).collect();
                    writeln!(neg, "{},{},{},{},{},{},{:.1},{}", config.name(), n.case, k, rep, n.stage, n.rejected, n.verify.as_secs_f64() * 1e6, err).unwrap();
                }
            }
        }
        eprintln!("[{:>7.1}s] {} negatives done", started.elapsed().as_secs_f64(), config.name());
    }

    let meta = json!({
        "n_permissions_in_credential": N_PERMISSIONS,
        "ks": ks,
        "reps": reps,
        "warmup": warmup,
        "negative_reps": neg_reps,
        "seed": seed,
        "configs": configs.iter().map(|c| c.name()).collect::<Vec<_>>(),
        "features": { "parallel_verification": cfg!(feature = "parallel_verification") },
        "elapsed_s": started.elapsed().as_secs_f64(),
    });
    std::fs::write(out.join("run-meta.json"), serde_json::to_string_pretty(&meta).unwrap())
        .map_err(|e| e.to_string())?;
    Ok(())
}
