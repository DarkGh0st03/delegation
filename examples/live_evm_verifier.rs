use alloy::primitives::Address;
use alloy::providers::ProviderBuilder;
use alloy::signers::local::PrivateKeySigner;
use alloy::sol;
use ark_bn254::Bn254;
use delegation::delegation::authorization::authorization_context::AuthorizationContext;
use delegation::delegation::authorization::operation::Operation;
use delegation::delegation::authorization::permission::Permission;
use delegation::delegation::credentials::delegation::delegation_evidence_trait::DelegationEvidence;
use delegation::delegation::issuance::delegation_issuer::DelegationIssuer;
use delegation::delegation::issuance::issuer_trait::Issuer;
use delegation::delegation::status::model::bitstring_status_list_entry::BitstringStatusListEntry;
use delegation::delegation::status::resolver::in_memory_status_list_resolver::InMemoryStatusListResolver;
use delegation::delegation::trust::evm::evm_registry_reader::EvmRegistryReader;
use delegation::delegation::trust::material::in_memory_public_material_provider::InMemoryPublicMaterialProvider;
use delegation::delegation::trust::registry::evm_backed_trust_registry::EvmBackedTrustRegistry;
use delegation::delegation::trust::registry::in_memory_trust_registry::InMemoryTrustRegistry;
use delegation::delegation::trust::registry::trust_registry_trait::{
    TrustRegistry, TrustRegistryRef,
};
use delegation::delegation::verification::delegation_verifier::DelegationVerifier;
use delegation::delegation::verification::verifier_trait::Verifier;
use std::env;
use std::rc::Rc;
use std::str::FromStr;
use std::time::Duration;
use tokio::runtime::Runtime;

sol! {
    #[sol(rpc)]
    interface EnterpriseTrustRegistryWriterContract {
        function enrollEnterpriseIdentity(address identity) external;
        function setTrustAnchor(address identity, bool enabled) external;
    }

    #[sol(rpc)]
    interface IssuerRegistryWriterContract {
        function publishAccumulatorMaterial(address issuer, bytes32 materialHash)
            external
            returns (uint64 version);
    }
}

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

async fn provision_live_chain(
    rpc_url: &str,
    enterprise_trust_registry: Address,
    issuer_registry: Address,
    governance_private_key: &str,
    root_private_key: &str,
    root: Address,
    holder: Address,
    root_material_commitment: alloy::primitives::B256,
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

    let root_receipt = trust
        .enrollEnterpriseIdentity(root)
        .send()
        .await
        .map_err(|err| format!("Could not enroll root identity [{err}]"))?
        .get_receipt()
        .await
        .map_err(|err| format!("Could not confirm root enrollment [{err}]"))?;

    let holder_receipt = trust
        .enrollEnterpriseIdentity(holder)
        .send()
        .await
        .map_err(|err| format!("Could not enroll holder identity [{err}]"))?
        .get_receipt()
        .await
        .map_err(|err| format!("Could not confirm holder enrollment [{err}]"))?;

    let anchor_receipt = trust
        .setTrustAnchor(root, true)
        .send()
        .await
        .map_err(|err| format!("Could not assign root trust anchor [{err}]"))?
        .get_receipt()
        .await
        .map_err(|err| format!("Could not confirm trust-anchor assignment [{err}]"))?;

    let root_signer: PrivateKeySigner = root_private_key
        .parse()
        .map_err(|err| format!("Invalid ROOT_PRIVATE_KEY [{err}]"))?;

    let root_provider = ProviderBuilder::new()
        .wallet(root_signer)
        .connect(rpc_url)
        .await
        .map_err(|err| format!("Could not connect root issuer provider [{err}]"))?;

    let issuer = IssuerRegistryWriterContract::new(issuer_registry, &root_provider);
    let accumulator_receipt = issuer
        .publishAccumulatorMaterial(root, root_material_commitment)
        .send()
        .await
        .map_err(|err| format!("Could not publish accumulator commitment [{err}]"))?
        .get_receipt()
        .await
        .map_err(|err| format!("Could not confirm accumulator commitment [{err}]"))?;

    println!("rootEnrollmentTx={}", root_receipt.transaction_hash);
    println!("holderEnrollmentTx={}", holder_receipt.transaction_hash);
    println!("trustAnchorTx={}", anchor_receipt.transaction_hash);
    println!(
        "accumulatorCommitmentTx={}",
        accumulator_receipt.transaction_hash
    );

    Ok(())
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

    // Create a real Delegation Credential and VP with the unchanged issuer logic.
    let source_registry = Rc::new(InMemoryTrustRegistry::<Curve>::new());
    let source_registry_ref: TrustRegistryRef<Curve> = source_registry.clone();

    let root = DelegationIssuer::<Curve>::new(root_id.clone(), source_registry_ref.clone())?;
    let status = BitstringStatusListEntry::revocation(
        None,
        String::from("42"),
        String::from("https://status.example/lists/live-root-revocation-1"),
    )?;

    let vc = root.issue_delegation_verifiable_credential(
        vec![String::from("https://www.w3.org/ns/credentials/v2")],
        String::from("http://delegation.example/credentials/live-evm-1"),
        status.clone(),
        String::from("2026-01-01T00:00:00Z"),
        holder_id.clone(),
        Duration::new(3600, 0),
        vec![permission(Operation::ReadFile)?],
        None,
    )?;

    let material_version = vc.credential().issuer_material_version();
    if material_version != 1 {
        return Err(format!(
            "Live integration expects a fresh issuer material version 1, got {material_version}"
        ));
    }

    let root_material =
        source_registry.get_accumulator_data_at_version(&root_id, material_version)?;
    let root_commitment =
        EvmBackedTrustRegistry::<Curve>::accumulator_material_commitment(&root_material)?;

    let holder = DelegationIssuer::<Curve>::new(holder_id.clone(), source_registry_ref)?;
    let signed_vp = holder.issue_delegation_verifiable_presentation(
        vc.clone(),
        vec![permission(Operation::ReadFile)?],
        String::from("cloud-access-gateway"),
        String::from("challenge-live-evm"),
    )?;

    let holder_verification_key = source_registry.get_verification_key(&holder_id)?;

    // Fail early on reruns: this example intentionally uses fresh EVM identities so
    // the Rust material version 1 is also version 1 in IssuerRegistry.
    let preflight_reader = EvmRegistryReader::connect(
        &rpc_url,
        &did_registry_address,
        &enterprise_trust_registry_address,
        &issuer_registry_address,
        chain_id,
    )?;

    let existing_version = preflight_reader.latest_accumulator_material_version(&root_id)?;
    if existing_version != 0 {
        return Err(format!(
            "ROOT_ID already has accumulator material version {existing_version} on-chain. Use fresh Anvil identities (or reset/redeploy the local chain) for this one-shot integration example."
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
    ))?;

    // The verifier now reads lifecycle/trust/commitment from the real EVM contracts.
    let chain_reader = Rc::new(EvmRegistryReader::connect(
        &rpc_url,
        &did_registry_address,
        &enterprise_trust_registry_address,
        &issuer_registry_address,
        chain_id,
    )?);

    let observed_version = chain_reader.latest_accumulator_material_version(&root_id)?;
    if observed_version != material_version {
        return Err(format!(
            "On-chain material version {observed_version} does not match credential imv {material_version}"
        ));
    }

    let public_material = Rc::new(InMemoryPublicMaterialProvider::<Curve>::new());
    public_material.insert_accumulator_data(root_id.clone(), material_version, root_material)?;
    public_material.insert_verification_key(holder_id.clone(), holder_verification_key)?;

    let evm_registry: TrustRegistryRef<Curve> = Rc::new(EvmBackedTrustRegistry::<Curve>::new(
        chain_reader,
        public_material,
    ));

    let status_resolver = Rc::new(InMemoryStatusListResolver::new());
    status_resolver.set_status(&status, false);

    let verifier = DelegationVerifier::<Curve>::new(evm_registry, status_resolver)?;
    let context = AuthorizationContext::new(
        holder_id.clone(),
        String::from("cloud-access-gateway"),
        String::from("challenge-live-evm"),
        permission(Operation::ReadFile)?,
    )?;

    let verified = verifier.verify_verifiable_presentation(context, signed_vp)?;

    println!("verifiedPresenter={}", verified.presenter_id());
    println!("verifiedIssuer={}", verified.issuer_id());
    println!("hierarchyDepth={}", verified.hierarchy_depth());
    println!("materialVersion={material_version}");
    println!("materialCommitment={root_commitment}");
    println!("authorization=ACCEPT");

    Ok(())
}
