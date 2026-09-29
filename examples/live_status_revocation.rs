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
use delegation::delegation::trust::registry::evm_backed_trust_registry::EvmBackedTrustRegistry;
use delegation::delegation::trust::evm::evm_reader_traits::{
    EvmStatusListReader, EvmTrustReader,
};
use delegation::delegation::trust::evm::evm_registry_reader::EvmRegistryReader;
use delegation::delegation::trust::registry::in_memory_trust_registry::InMemoryTrustRegistry;
use delegation::delegation::trust::material::in_memory_public_material_provider::InMemoryPublicMaterialProvider;
use delegation::delegation::trust::registry::trust_registry_trait::{TrustRegistry, TrustRegistryRef};
use delegation::delegation::verification::delegation_verifier::DelegationVerifier;
use delegation::delegation::verification::verifier_trait::Verifier;
use flate2::Compression;
use flate2::write::GzEncoder;
use multibase::Base;
use serde_json::json;
use std::env;
use std::io::Write;
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

const STATUS_LIST_URL: &str = "https://status.example/lists/live-root-revocation-1";
const STATUS_LIST_INDEX: usize = 42;
const STATUS_PURPOSE_REVOCATION: u8 = 1;

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
    // W3C Bitstring Status List requires at least 131072 entries.
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

async fn provision_live_chain(
    rpc_url: &str,
    enterprise_trust_registry: Address,
    issuer_registry: Address,
    governance_private_key: &str,
    root_private_key: &str,
    root: Address,
    holder: Address,
    root_material_commitment: B256,
    status_list_id: B256,
    active_status_hash: B256,
) -> Result<(), String> {
    let governance_signer: PrivateKeySigner = governance_private_key
        .parse()
        .map_err(|err| format!("Invalid GOVERNANCE_PRIVATE_KEY [{err}]"))?;

    let governance_provider = ProviderBuilder::new()
        .wallet(governance_signer)
        .connect(rpc_url)
        .await
        .map_err(|err| format!("Could not connect governance provider [{err}]"))?;

    let trust =
        EnterpriseTrustRegistryWriterContract::new(enterprise_trust_registry, &governance_provider);

    let root_active = trust
        .isActive(root)
        .call()
        .await
        .map_err(|err| format!("Could not read root enterprise status [{err}]"))?;

    if !root_active {
        trust
            .enrollEnterpriseIdentity(root)
            .send()
            .await
            .map_err(|err| format!("Could not enroll root identity [{err}]"))?
            .get_receipt()
            .await
            .map_err(|err| format!("Could not confirm root enrollment [{err}]"))?;
    }

    let holder_active = trust
        .isActive(holder)
        .call()
        .await
        .map_err(|err| format!("Could not read holder enterprise status [{err}]"))?;

    if !holder_active {
        trust
            .enrollEnterpriseIdentity(holder)
            .send()
            .await
            .map_err(|err| format!("Could not enroll holder identity [{err}]"))?
            .get_receipt()
            .await
            .map_err(|err| format!("Could not confirm holder enrollment [{err}]"))?;
    }

    let root_is_anchor = trust
        .isTrustAnchor(root)
        .call()
        .await
        .map_err(|err| format!("Could not read root trust-anchor state [{err}]"))?;

    if !root_is_anchor {
        trust
            .setTrustAnchor(root, true)
            .send()
            .await
            .map_err(|err| format!("Could not assign root trust anchor [{err}]"))?
            .get_receipt()
            .await
            .map_err(|err| format!("Could not confirm trust-anchor assignment [{err}]"))?;
    }

    let root_signer: PrivateKeySigner = root_private_key
        .parse()
        .map_err(|err| format!("Invalid ROOT_PRIVATE_KEY [{err}]"))?;

    let root_provider = ProviderBuilder::new()
        .wallet(root_signer)
        .connect(rpc_url)
        .await
        .map_err(|err| format!("Could not connect root issuer provider [{err}]"))?;

    let issuer = IssuerRegistryWriterContract::new(issuer_registry, &root_provider);

    issuer
        .publishAccumulatorMaterial(root, root_material_commitment)
        .send()
        .await
        .map_err(|err| format!("Could not publish accumulator commitment [{err}]"))?
        .get_receipt()
        .await
        .map_err(|err| format!("Could not confirm accumulator commitment [{err}]"))?;

    issuer
        .registerStatusList(
            root,
            status_list_id,
            STATUS_PURPOSE_REVOCATION,
            active_status_hash,
        )
        .send()
        .await
        .map_err(|err| format!("Could not register Status List anchor [{err}]"))?
        .get_receipt()
        .await
        .map_err(|err| format!("Could not confirm Status List registration [{err}]"))?;

    Ok(())
}

async fn update_live_status_list(
    rpc_url: &str,
    issuer_registry: Address,
    root_private_key: &str,
    root: Address,
    status_list_id: B256,
    revoked_status_hash: B256,
) -> Result<String, String> {
    let root_signer: PrivateKeySigner = root_private_key
        .parse()
        .map_err(|err| format!("Invalid ROOT_PRIVATE_KEY [{err}]"))?;

    let root_provider = ProviderBuilder::new()
        .wallet(root_signer)
        .connect(rpc_url)
        .await
        .map_err(|err| format!("Could not connect root issuer provider [{err}]"))?;

    let issuer = IssuerRegistryWriterContract::new(issuer_registry, &root_provider);
    let receipt = issuer
        .updateStatusList(root, status_list_id, revoked_status_hash)
        .send()
        .await
        .map_err(|err| format!("Could not update Status List anchor [{err}]"))?
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

    let root_address = did_address(&root_id)?;
    let holder_address = did_address(&holder_id)?;
    let enterprise_trust_registry = Address::from_str(&enterprise_trust_registry_address)
        .map_err(|err| format!("Invalid ENTERPRISE_TRUST_REGISTRY_ADDRESS [{err}]"))?;
    let issuer_registry = Address::from_str(&issuer_registry_address)
        .map_err(|err| format!("Invalid ISSUER_REGISTRY_ADDRESS [{err}]"))?;

    let source_registry = Rc::new(InMemoryTrustRegistry::<Curve>::new());
    let source_registry_ref: TrustRegistryRef<Curve> = source_registry.clone();

    let root = DelegationIssuer::<Curve>::new(root_id.clone(), source_registry_ref.clone())?;
    let status_entry = BitstringStatusListEntry::revocation(
        None,
        STATUS_LIST_INDEX.to_string(),
        String::from(STATUS_LIST_URL),
    )?;

    let vc = root.issue_delegation_verifiable_credential(
        vec![String::from("https://www.w3.org/ns/credentials/v2")],
        String::from("http://delegation.example/credentials/live-status-revocation-1"),
        status_entry.clone(),
        String::from("2026-01-01T00:00:00Z"),
        holder_id.clone(),
        Duration::new(3600, 0),
        vec![permission(Operation::ReadFile)?],
        None,
    )?;

    let material_version = vc.credential().issuer_material_version();
    if material_version != 1 {
        return Err(format!(
            "Live Status List integration expects local accumulator material version 1, got {material_version}"
        ));
    }

    let root_material =
        source_registry.get_accumulator_data_at_version(&root_id, material_version)?;
    let root_commitment =
        EvmBackedTrustRegistry::<Curve>::accumulator_material_commitment(&root_material)?;

    let holder = DelegationIssuer::<Curve>::new(holder_id.clone(), source_registry_ref)?;
    let signed_vp = holder.issue_delegation_verifiable_presentation(
        vc,
        vec![permission(Operation::ReadFile)?],
        String::from("cloud-access-gateway"),
        String::from("challenge-live-status"),
    )?;
    let holder_verification_key = source_registry.get_verification_key(&holder_id)?;

    let active_document = status_list_document(&root_id, false)?;
    let revoked_document = status_list_document(&root_id, true)?;
    let active_status_hash = EvmAnchoredStatusListResolver::document_commitment(&active_document);
    let revoked_status_hash = EvmAnchoredStatusListResolver::document_commitment(&revoked_document);
    let status_list_id = EvmRegistryReader::status_list_id(STATUS_LIST_URL);

    let preflight = EvmRegistryReader::connect(
        &rpc_url,
        &did_registry_address,
        &enterprise_trust_registry_address,
        &issuer_registry_address,
        chain_id,
    )?;

    let existing_version = preflight.latest_accumulator_material_version(&root_id)?;
    if existing_version != 0 {
        return Err(format!(
            "ROOT_ID already has accumulator material version {existing_version} on-chain. Use a fresh Anvil identity for this one-shot live status test."
        ));
    }

    let runtime =
        Runtime::new().map_err(|err| format!("Could not create Tokio runtime [{err}]"))?;
    runtime.block_on(provision_live_chain(
        &rpc_url,
        enterprise_trust_registry,
        issuer_registry,
        &governance_private_key,
        &root_private_key,
        root_address,
        holder_address,
        root_commitment,
        status_list_id,
        active_status_hash,
    ))?;

    let chain_reader = Rc::new(EvmRegistryReader::connect(
        &rpc_url,
        &did_registry_address,
        &enterprise_trust_registry_address,
        &issuer_registry_address,
        chain_id,
    )?);

    let observed_status = chain_reader.status_list_anchor(&root_id, STATUS_LIST_URL)?;
    if !observed_status.exists
        || observed_status.current_version != 1
        || observed_status.current_document_hash != active_status_hash
    {
        return Err(String::from(
            "On-chain Status List registration does not match the active document",
        ));
    }

    let public_material = Rc::new(InMemoryPublicMaterialProvider::<Curve>::new());
    public_material.insert_accumulator_data(root_id.clone(), material_version, root_material)?;
    public_material.insert_verification_key(holder_id.clone(), holder_verification_key)?;

    let trust_reader: Rc<dyn EvmTrustReader> = chain_reader.clone();
    let evm_registry: TrustRegistryRef<Curve> = Rc::new(EvmBackedTrustRegistry::<Curve>::new(
        trust_reader,
        public_material,
    ));

    let status_provider = Rc::new(InMemoryStatusListCredentialProvider::new());
    status_provider.insert(String::from(STATUS_LIST_URL), active_document);

    let status_reader: Rc<dyn EvmStatusListReader> = chain_reader.clone();
    let status_resolver = Rc::new(EvmAnchoredStatusListResolver::new(
        status_provider.clone(),
        status_reader,
    ));

    let verifier = DelegationVerifier::<Curve>::new(evm_registry, status_resolver)?;
    let request = AuthorizationRequest::new(
        holder_id.clone(),
        String::from("cloud-access-gateway"),
        String::from("challenge-live-status"),
        permission(Operation::ReadFile)?,
    )?;

    let accepted = verifier.verify_verifiable_presentation(request.clone(), signed_vp.clone())?;
    println!("beforeRevocation=ACCEPT");
    println!("verifiedPresenter={}", accepted.presenter_id());
    println!("statusListVersion=1");
    println!("statusListHash={active_status_hash}");

    // Publish a new current Status List document with the same entry set to 1.
    // The Delegation Credential and VP remain unchanged.
    let update_tx = runtime.block_on(update_live_status_list(
        &rpc_url,
        issuer_registry,
        &root_private_key,
        root_address,
        status_list_id,
        revoked_status_hash,
    ))?;
    status_provider.insert(String::from(STATUS_LIST_URL), revoked_document);

    let updated_anchor = chain_reader.status_list_anchor(&root_id, STATUS_LIST_URL)?;
    if updated_anchor.current_version != 2
        || updated_anchor.current_document_hash != revoked_status_hash
    {
        return Err(String::from(
            "On-chain Status List update does not match the revoked document",
        ));
    }

    let rejection = verifier
        .verify_verifiable_presentation(request, signed_vp)
        .expect_err("the same credential must be rejected after its status bit is revoked");

    if !rejection.contains("revoked") {
        return Err(format!(
            "Expected revocation rejection after Status List update, got: {rejection}"
        ));
    }

    println!("statusListUpdateTx={update_tx}");
    println!("statusListVersion=2");
    println!("statusListHash={revoked_status_hash}");
    println!("afterRevocation=REJECT");
    println!("rejectionReason={rejection}");

    Ok(())
}
