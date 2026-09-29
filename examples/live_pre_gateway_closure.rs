use alloy::primitives::{Address, B256};
use alloy::providers::ProviderBuilder;
use alloy::signers::local::PrivateKeySigner;
use alloy::sol;
use ark_bn254::Bn254;
use delegation::delegation::authorization::authorization_request::AuthorizationRequest;
use delegation::delegation::authorization::operation::Operation;
use delegation::delegation::authorization::permission::Permission;
use delegation::delegation::credentials::delegation::delegation_evidence_trait::DelegationEvidence;
use delegation::delegation::issuance::delegation_issuer::DelegationIssuer;
use delegation::delegation::issuance::issuer_trait::Issuer;
use delegation::delegation::status::resolver::evm_anchored_status_list_resolver::EvmAnchoredStatusListResolver;
use delegation::delegation::status::model::bitstring_status_list_entry::BitstringStatusListEntry;
use delegation::delegation::status::provider::in_memory_status_list_provider::InMemoryStatusListCredentialProvider;
use delegation::delegation::status::provider::jwt_status_list_provider::{
    JwtAuthenticatedStatusListCredentialProvider, sign_status_list_credential_jwt,
};
use delegation::delegation::trust::did_verification_key_provider::DidEthrVerificationKeyProvider;
use delegation::delegation::trust::evm::evm_backed_trust_registry::EvmBackedTrustRegistry;
use delegation::delegation::trust::evm::evm_registry_reader::{
    EvmRegistryReader, EvmStatusListReader, EvmTrustReader,
};
use delegation::delegation::trust::in_memory_trust_registry::InMemoryTrustRegistry;
use delegation::delegation::trust::public_material_provider::{
    AccumulatorMaterialProviderRef, CompositePublicMaterialProvider,
    InMemoryPublicMaterialProvider, VerificationKeyProviderRef,
};
use delegation::delegation::trust::trust_registry::{TrustRegistry, TrustRegistryRef};
use delegation::delegation::verification::delegation_verifier::DelegationVerifier;
use delegation::delegation::verification::verifier_trait::Verifier;
use flate2::Compression;
use flate2::write::GzEncoder;
use josekit::jwk::Jwk;
use multibase::Base;
use serde_json::json;
use std::env;
use std::io::Write;
use std::process::Command;
use std::rc::Rc;
use std::str::FromStr;
use std::time::Duration;
use tokio::runtime::Runtime;

sol! {
    #[sol(rpc)]
    interface EnterpriseTrustRegistryWriterContract {
        function enrollEnterpriseIdentity(address identity) external;
        function setTrustAnchor(address identity, bool enabled) external;
        function isActive(address identity) external view returns (bool);
        function isTrustAnchor(address identity) external view returns (bool);
    }

    #[sol(rpc)]
    interface IssuerRegistryWriterContract {
        function publishAccumulatorMaterial(address issuer, bytes32 materialHash)
            external
            returns (uint64 version);

        function registerStatusList(
            address issuer,
            bytes32 listId,
            uint8 purpose,
            bytes32 documentHash
        ) external;

        function updateStatusList(
            address issuer,
            bytes32 listId,
            bytes32 documentHash
        ) external returns (uint64 version);
    }
}

const STATUS_LIST_URL: &str = "https://status.example/lists/pre-gateway-root-revocation-1";
const STATUS_LIST_INDEX: usize = 42;
const STATUS_PURPOSE_REVOCATION: u8 = 1;
const DID_RESOLVER_SCRIPT: &str = "blockchain/did-client/resolve-did-json.mjs";
const DID_PUBLISH_SCRIPT: &str = "blockchain/did-client/publish-ed25519.mjs";

fn required(name: &str) -> Result<String, String> {
    env::var(name).map_err(|_| format!("Missing required environment variable {name}"))
}

fn did_address(did: &str) -> Result<Address, String> {
    let address = did
        .rsplit(':')
        .next()
        .ok_or_else(|| format!("Invalid did:ethr identifier {did}"))?;

    Address::from_str(address)
        .map_err(|err| format!("Invalid address in did:ethr identifier {did} [{err}]"))
}

fn permission(operation: Operation) -> Result<Permission, String> {
    Permission::new(
        String::from("https://gitea.local/repos/project-a"),
        operation,
    )
}

fn encode_bitstring(bitstring: &[u8]) -> Result<String, String> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(bitstring)
        .map_err(|err| format!("Could not GZIP-compress status bitstring [{err}]"))?;
    let compressed = encoder
        .finish()
        .map_err(|err| format!("Could not finish GZIP status encoding [{err}]"))?;
    Ok(multibase::encode(Base::Base64Url, compressed))
}

fn status_list_document(issuer_id: &str, revoked: bool) -> Result<String, String> {
    let mut bitstring = vec![0u8; 16 * 1024];
    if revoked {
        bitstring[STATUS_LIST_INDEX / 8] |= 0b1000_0000u8 >> (STATUS_LIST_INDEX % 8);
    }

    Ok(json!({
        "@context": ["https://www.w3.org/ns/credentials/v2"],
        "id": STATUS_LIST_URL,
        "type": ["VerifiableCredential", "BitstringStatusListCredential"],
        "issuer": issuer_id,
        "validFrom": "2026-01-01T00:00:00Z",
        "credentialSubject": {
            "id": format!("{STATUS_LIST_URL}#list"),
            "type": "BitstringStatusList",
            "statusPurpose": "revocation",
            "encodedList": encode_bitstring(&bitstring)?
        }
    })
    .to_string())
}

fn public_jwk_json(private_jwk: &Jwk) -> Result<String, String> {
    let mut value = serde_json::to_value(private_jwk)
        .map_err(|err| format!("Could not serialize JWK [{err}]"))?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| String::from("JWK serialization was not a JSON object"))?;
    object.remove("d");
    serde_json::to_string(&value).map_err(|err| format!("Could not encode public JWK [{err}]"))
}

fn publish_did_ed25519(
    rpc_url: &str,
    registry_address: &str,
    chain_id: u64,
    identity_private_key: &str,
    signing_jwk: &Jwk,
) -> Result<String, String> {
    let output = Command::new("node")
        .arg(DID_PUBLISH_SCRIPT)
        .env("RPC_URL", rpc_url)
        .env("REGISTRY_ADDRESS", registry_address)
        .env("CHAIN_ID", chain_id.to_string())
        .env("IDENTITY_PRIVATE_KEY", identity_private_key)
        .env("ED25519_JWK", public_jwk_json(signing_jwk)?)
        .output()
        .map_err(|err| format!("Could not launch DID publication script [{err}]"))?;

    if !output.status.success() {
        return Err(format!(
            "DID Ed25519 publication failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

async fn ensure_enterprise_state(
    rpc_url: &str,
    enterprise_trust_registry: Address,
    governance_private_key: &str,
    root: Address,
    holder: Address,
) -> Result<(), String> {
    let governance_signer: PrivateKeySigner = governance_private_key
        .parse()
        .map_err(|err| format!("Invalid GOVERNANCE_PRIVATE_KEY [{err}]"))?;

    let provider = ProviderBuilder::new()
        .wallet(governance_signer)
        .connect(rpc_url)
        .await
        .map_err(|err| format!("Could not connect governance provider [{err}]"))?;

    let trust = EnterpriseTrustRegistryWriterContract::new(enterprise_trust_registry, &provider);

    if !trust
        .isActive(root)
        .call()
        .await
        .map_err(|err| format!("Could not read root enterprise state [{err}]"))?
    {
        trust
            .enrollEnterpriseIdentity(root)
            .send()
            .await
            .map_err(|err| format!("Could not enroll root [{err}]"))?
            .get_receipt()
            .await
            .map_err(|err| format!("Could not confirm root enrollment [{err}]"))?;
    }

    if !trust
        .isActive(holder)
        .call()
        .await
        .map_err(|err| format!("Could not read holder enterprise state [{err}]"))?
    {
        trust
            .enrollEnterpriseIdentity(holder)
            .send()
            .await
            .map_err(|err| format!("Could not enroll holder [{err}]"))?
            .get_receipt()
            .await
            .map_err(|err| format!("Could not confirm holder enrollment [{err}]"))?;
    }

    if !trust
        .isTrustAnchor(root)
        .call()
        .await
        .map_err(|err| format!("Could not read root trust-anchor state [{err}]"))?
    {
        trust
            .setTrustAnchor(root, true)
            .send()
            .await
            .map_err(|err| format!("Could not set root trust anchor [{err}]"))?
            .get_receipt()
            .await
            .map_err(|err| format!("Could not confirm root trust anchor [{err}]"))?;
    }

    Ok(())
}

async fn publish_accumulator(
    rpc_url: &str,
    issuer_registry: Address,
    root_private_key: &str,
    root: Address,
    commitment: B256,
) -> Result<String, String> {
    let signer: PrivateKeySigner = root_private_key
        .parse()
        .map_err(|err| format!("Invalid ROOT_PRIVATE_KEY [{err}]"))?;
    let provider = ProviderBuilder::new()
        .wallet(signer)
        .connect(rpc_url)
        .await
        .map_err(|err| format!("Could not connect root provider [{err}]"))?;
    let issuer = IssuerRegistryWriterContract::new(issuer_registry, &provider);

    let receipt = issuer
        .publishAccumulatorMaterial(root, commitment)
        .send()
        .await
        .map_err(|err| format!("Could not publish accumulator commitment [{err}]"))?
        .get_receipt()
        .await
        .map_err(|err| format!("Could not confirm accumulator commitment [{err}]"))?;

    Ok(receipt.transaction_hash.to_string())
}

async fn register_status_list(
    rpc_url: &str,
    issuer_registry: Address,
    root_private_key: &str,
    root: Address,
    list_id: B256,
    document_hash: B256,
) -> Result<String, String> {
    let signer: PrivateKeySigner = root_private_key
        .parse()
        .map_err(|err| format!("Invalid ROOT_PRIVATE_KEY [{err}]"))?;
    let provider = ProviderBuilder::new()
        .wallet(signer)
        .connect(rpc_url)
        .await
        .map_err(|err| format!("Could not connect root provider [{err}]"))?;
    let issuer = IssuerRegistryWriterContract::new(issuer_registry, &provider);

    let receipt = issuer
        .registerStatusList(root, list_id, STATUS_PURPOSE_REVOCATION, document_hash)
        .send()
        .await
        .map_err(|err| format!("Could not register Status List [{err}]"))?
        .get_receipt()
        .await
        .map_err(|err| format!("Could not confirm Status List registration [{err}]"))?;

    Ok(receipt.transaction_hash.to_string())
}

async fn update_status_list(
    rpc_url: &str,
    issuer_registry: Address,
    root_private_key: &str,
    root: Address,
    list_id: B256,
    document_hash: B256,
) -> Result<String, String> {
    let signer: PrivateKeySigner = root_private_key
        .parse()
        .map_err(|err| format!("Invalid ROOT_PRIVATE_KEY [{err}]"))?;
    let provider = ProviderBuilder::new()
        .wallet(signer)
        .connect(rpc_url)
        .await
        .map_err(|err| format!("Could not connect root provider [{err}]"))?;
    let issuer = IssuerRegistryWriterContract::new(issuer_registry, &provider);

    let receipt = issuer
        .updateStatusList(root, list_id, document_hash)
        .send()
        .await
        .map_err(|err| format!("Could not update Status List [{err}]"))?
        .get_receipt()
        .await
        .map_err(|err| format!("Could not confirm Status List update [{err}]"))?;

    Ok(receipt.transaction_hash.to_string())
}

fn main() -> Result<(), String> {
    type Curve = Bn254;

    let rpc_url = env::var("RPC_URL").unwrap_or_else(|_| String::from("http://127.0.0.1:8545"));
    let chain_id = env::var("CHAIN_ID")
        .unwrap_or_else(|_| String::from("31337"))
        .parse::<u64>()
        .map_err(|err| format!("Invalid CHAIN_ID [{err}]"))?;

    let did_registry_address = required("DID_REGISTRY_ADDRESS")?;
    let enterprise_trust_registry_address = required("ENTERPRISE_TRUST_REGISTRY_ADDRESS")?;
    let issuer_registry_address = required("ISSUER_REGISTRY_ADDRESS")?;
    let root_id = required("ROOT_ID")?;
    let holder_id = required("HOLDER_ID")?;
    let governance_private_key = required("GOVERNANCE_PRIVATE_KEY")?;
    let root_private_key = required("ROOT_PRIVATE_KEY")?;
    let holder_private_key = required("HOLDER_PRIVATE_KEY")?;

    let root_address = did_address(&root_id)?;
    let holder_address = did_address(&holder_id)?;
    let enterprise_trust_registry = Address::from_str(&enterprise_trust_registry_address)
        .map_err(|err| format!("Invalid ENTERPRISE_TRUST_REGISTRY_ADDRESS [{err}]"))?;
    let issuer_registry = Address::from_str(&issuer_registry_address)
        .map_err(|err| format!("Invalid ISSUER_REGISTRY_ADDRESS [{err}]"))?;

    // Issuance side: generate the real accumulator and Ed25519 keys used by this run.
    let issuance_registry = Rc::new(InMemoryTrustRegistry::<Curve>::new());
    let issuance_registry_ref: TrustRegistryRef<Curve> = issuance_registry.clone();
    let root = DelegationIssuer::<Curve>::new(root_id.clone(), issuance_registry_ref.clone())?;
    let holder = DelegationIssuer::<Curve>::new(holder_id.clone(), issuance_registry_ref)?;

    let status_entry = BitstringStatusListEntry::revocation(
        None,
        STATUS_LIST_INDEX.to_string(),
        String::from(STATUS_LIST_URL),
    )?;

    let vc = root.issue_delegation_verifiable_credential(
        vec![String::from("https://www.w3.org/ns/credentials/v2")],
        String::from("http://delegation.example/credentials/pre-gateway-final"),
        status_entry,
        String::from("2026-01-01T00:00:00Z"),
        holder_id.clone(),
        Duration::new(3600, 0),
        vec![permission(Operation::ReadFile)?],
        None,
    )?;

    let material_version = vc.credential().issuer_material_version();
    if material_version != 1 {
        return Err(format!(
            "Expected fresh Rust accumulator material version 1, got {material_version}"
        ));
    }

    let root_material =
        issuance_registry.get_accumulator_data_at_version(&root_id, material_version)?;
    let root_commitment =
        EvmBackedTrustRegistry::<Curve>::accumulator_material_commitment(&root_material)?;

    let signed_vp = holder.issue_delegation_verifiable_presentation(
        vc,
        vec![permission(Operation::ReadFile)?],
        String::from("cloud-access-gateway"),
        String::from("challenge-pre-gateway-final"),
    )?;

    let active_document = status_list_document(&root_id, false)?;
    let revoked_document = status_list_document(&root_id, true)?;
    let active_status_jwt = sign_status_list_credential_jwt(&active_document, root.holder_jwk())?;
    let revoked_status_jwt = sign_status_list_credential_jwt(&revoked_document, root.holder_jwk())?;

    let active_status_hash = EvmAnchoredStatusListResolver::artifact_commitment(&active_status_jwt);
    let revoked_status_hash = EvmAnchoredStatusListResolver::artifact_commitment(&revoked_status_jwt);
    let status_list_id = EvmRegistryReader::status_list_id(STATUS_LIST_URL);

    let runtime =
        Runtime::new().map_err(|err| format!("Could not create Tokio runtime [{err}]"))?;
    runtime.block_on(ensure_enterprise_state(
        &rpc_url,
        enterprise_trust_registry,
        &governance_private_key,
        root_address,
        holder_address,
    ))?;

    let preflight = EvmRegistryReader::connect(
        &rpc_url,
        &did_registry_address,
        &enterprise_trust_registry_address,
        &issuer_registry_address,
        chain_id,
    )?;

    match preflight.latest_accumulator_material_version(&root_id)? {
        0 => {
            let tx = runtime.block_on(publish_accumulator(
                &rpc_url,
                issuer_registry,
                &root_private_key,
                root_address,
                root_commitment,
            ))?;
            println!("accumulatorCommitmentTx={tx}");
        }
        1 => {
            let existing = preflight.accumulator_material_anchor(&root_id, 1)?;
            if !existing.exists || existing.material_hash != root_commitment {
                return Err(String::from(
                    "Existing accumulator version 1 does not match this run; use a fresh ROOT_ID",
                ));
            }
            println!("accumulatorCommitmentTx=SKIPPED_ALREADY_MATCHING");
        }
        version => {
            return Err(format!(
                "ROOT_ID already has accumulator material version {version}; use a fresh identity"
            ));
        }
    }

    // Publish the exact Rust-generated presentation/status verification keys into ERC-1056.
    let root_did_publish = publish_did_ed25519(
        &rpc_url,
        &did_registry_address,
        chain_id,
        &root_private_key,
        root.holder_jwk(),
    )?;
    let holder_did_publish = publish_did_ed25519(
        &rpc_url,
        &did_registry_address,
        chain_id,
        &holder_private_key,
        holder.holder_jwk(),
    )?;
    println!(
        "rootDidPublication={}",
        root_did_publish.replace('\n', " | ")
    );
    println!(
        "holderDidPublication={}",
        holder_did_publish.replace('\n', " | ")
    );

    let chain_reader = Rc::new(EvmRegistryReader::connect(
        &rpc_url,
        &did_registry_address,
        &enterprise_trust_registry_address,
        &issuer_registry_address,
        chain_id,
    )?);

    let existing_status = chain_reader.status_list_anchor(&root_id, STATUS_LIST_URL)?;
    if !existing_status.exists {
        let tx = runtime.block_on(register_status_list(
            &rpc_url,
            issuer_registry,
            &root_private_key,
            root_address,
            status_list_id,
            active_status_hash,
        ))?;
        println!("statusListRegistrationTx={tx}");
    } else if existing_status.current_version == 1
        && existing_status.current_document_hash == active_status_hash
    {
        println!("statusListRegistrationTx=SKIPPED_ALREADY_MATCHING");
    } else {
        return Err(format!(
            "ROOT_ID already has incompatible Status List state version {}; use a fresh identity",
            existing_status.current_version
        ));
    }

    // Verifier side: accumulator payload remains off-chain, but its version/hash is
    // EVM-anchored. Ed25519 keys are no longer injected: they are resolved from did:ethr.
    let accumulator_source = Rc::new(InMemoryPublicMaterialProvider::<Curve>::new());
    accumulator_source.insert_accumulator_data(root_id.clone(), material_version, root_material)?;
    let accumulator_provider: AccumulatorMaterialProviderRef<Curve> = accumulator_source;

    let did_keys = Rc::new(DidEthrVerificationKeyProvider::new(
        DID_RESOLVER_SCRIPT,
        &rpc_url,
        &did_registry_address,
        chain_id,
    ));
    let verification_key_provider: VerificationKeyProviderRef = did_keys.clone();

    // Force both resolutions before the authorization decision so failures are explicit.
    verification_key_provider.get_verification_key(&root_id)?;
    verification_key_provider.get_verification_key(&holder_id)?;
    println!("didResolution=OK");

    let public_material = Rc::new(CompositePublicMaterialProvider::<Curve>::new(
        accumulator_provider,
        verification_key_provider.clone(),
    ));
    let trust_reader: Rc<dyn EvmTrustReader> = chain_reader.clone();
    let evm_registry: TrustRegistryRef<Curve> =
        Rc::new(EvmBackedTrustRegistry::new(trust_reader, public_material));

    let raw_status_provider = Rc::new(InMemoryStatusListCredentialProvider::new());
    raw_status_provider.insert(String::from(STATUS_LIST_URL), active_status_jwt);

    let authenticated_status_provider = Rc::new(JwtAuthenticatedStatusListCredentialProvider::new(
        raw_status_provider.clone(),
        verification_key_provider,
    ));
    let status_reader: Rc<dyn EvmStatusListReader> = chain_reader.clone();
    let status_resolver = Rc::new(EvmAnchoredStatusListResolver::new(
        authenticated_status_provider,
        status_reader,
    ));

    let verifier = DelegationVerifier::<Curve>::new(evm_registry, status_resolver)?;
    let request = AuthorizationRequest::new(
        holder_id.clone(),
        String::from("cloud-access-gateway"),
        String::from("challenge-pre-gateway-final"),
        permission(Operation::ReadFile)?,
    )?;

    verifier.verify_verifiable_presentation(request.clone(), signed_vp.clone())?;
    println!("statusCredentialSignature=VALID");
    println!("beforeRevocation=ACCEPT");
    println!("statusListVersion=1");
    println!("statusListHash={active_status_hash}");

    let update_tx = runtime.block_on(update_status_list(
        &rpc_url,
        issuer_registry,
        &root_private_key,
        root_address,
        status_list_id,
        revoked_status_hash,
    ))?;
    raw_status_provider.insert(String::from(STATUS_LIST_URL), revoked_status_jwt);

    let updated = chain_reader.status_list_anchor(&root_id, STATUS_LIST_URL)?;
    if updated.current_version != 2 || updated.current_document_hash != revoked_status_hash {
        return Err(String::from(
            "Updated on-chain Status List does not match signed revoked artifact",
        ));
    }

    let rejection = verifier
        .verify_verifiable_presentation(request, signed_vp)
        .expect_err("revoked credential must be rejected");

    if !rejection.contains("revoked") {
        return Err(format!("Expected revocation rejection, got: {rejection}"));
    }

    println!("statusListUpdateTx={update_tx}");
    println!("statusListVersion=2");
    println!("statusListHash={revoked_status_hash}");
    println!("afterRevocation=REJECT");
    println!("rejectionReason={rejection}");
    println!("preGatewayBlockchainPhase=COMPLETE");

    Ok(())
}
