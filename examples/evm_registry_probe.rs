use delegation::delegation::trust::evm::EvmRegistryReader;
use std::env;

fn required(name: &str) -> Result<String, String> {
    env::var(name).map_err(|_| format!("Missing required environment variable {name}"))
}

fn main() -> Result<(), String> {
    let rpc_url = env::var("RPC_URL").unwrap_or_else(|_| String::from("http://127.0.0.1:8545"));
    let chain_id = env::var("CHAIN_ID")
        .unwrap_or_else(|_| String::from("31337"))
        .parse::<u64>()
        .map_err(|err| format!("Invalid CHAIN_ID [{err}]"))?;

    let reader = EvmRegistryReader::connect(
        &rpc_url,
        &required("DID_REGISTRY_ADDRESS")?,
        &required("ENTERPRISE_TRUST_REGISTRY_ADDRESS")?,
        &required("ISSUER_REGISTRY_ADDRESS")?,
        chain_id,
    )?;

    let issuer_id = required("ISSUER_ID")?;

    println!("chainId={}", reader.expected_chain_id());
    println!("issuer={issuer_id}");
    println!("didOwner={}", reader.identity_owner(&issuer_id)?);
    println!("status={}", reader.identity_status(&issuer_id)?);
    println!("trustAnchor={}", reader.is_trust_anchor(&issuer_id)?);

    let latest_version = reader.latest_accumulator_material_version(&issuer_id)?;
    println!("latestAccumulatorMaterialVersion={latest_version}");

    if latest_version > 0 {
        let anchor = reader.accumulator_material_anchor(&issuer_id, latest_version)?;
        println!(
            "accumulatorMaterial(version={}, hash={}, publishedAt={}, exists={})",
            latest_version, anchor.material_hash, anchor.published_at, anchor.exists
        );
    }

    if let Ok(status_list_credential) = env::var("STATUS_LIST_CREDENTIAL") {
        let anchor = reader.status_list_anchor(&issuer_id, &status_list_credential)?;
        println!(
            "statusList(id={}, purpose={}, version={}, hash={}, updatedAt={}, exists={})",
            status_list_credential,
            anchor.purpose,
            anchor.current_version,
            anchor.current_document_hash,
            anchor.updated_at,
            anchor.exists
        );
    }

    Ok(())
}
