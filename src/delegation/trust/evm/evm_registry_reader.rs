use crate::delegation::trust::identity_status::IdentityStatus;
use alloy::primitives::{Address, B256, keccak256};
use alloy::providers::{DynProvider, Provider, ProviderBuilder};
use alloy::sol;
use std::str::FromStr;
use tokio::runtime::Runtime;

sol! {
    #[sol(rpc)]
    interface EthereumDIDRegistryContract {
        function identityOwner(address identity) external view returns (address owner);
    }

    #[sol(rpc)]
    interface EnterpriseTrustRegistryContract {
        function getIdentity(address identity)
            external
            view
            returns (
                uint8 status,
                bool trustAnchor,
                address sponsor,
                uint64 enrolledAt,
                uint64 updatedAt
            );

        function isTrustAnchor(address identity) external view returns (bool);
    }

    #[sol(rpc)]
    interface IssuerRegistryContract {
        function latestAccumulatorMaterialVersion(address issuer)
            external
            view
            returns (uint64);

        function getAccumulatorMaterial(address issuer, uint64 version)
            external
            view
            returns (
                bytes32 materialHash,
                uint64 publishedAt,
                bool exists
            );

        function getStatusList(address issuer, bytes32 listId)
            external
            view
            returns (
                uint8 purpose,
                bytes32 currentDocumentHash,
                uint64 currentVersion,
                uint64 updatedAt,
                bool exists
            );
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AccumulatorMaterialAnchor {
    pub material_hash: B256,
    pub published_at: u64,
    pub exists: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StatusListAnchor {
    pub purpose: u8,
    pub current_document_hash: B256,
    pub current_version: u64,
    pub updated_at: u64,
    pub exists: bool,
}

/// Synchronous reader for the EVM trust layer.
///
/// The rest of the Delegation Credential code is currently synchronous. This
/// wrapper owns a Tokio runtime internally and exposes blocking read methods,
/// keeping asynchronous JSON-RPC details out of `DelegationVerifier`.
pub trait EvmTrustReader {
    fn identity_status(&self, identity_id: &str) -> Result<IdentityStatus, String>;
    fn is_trust_anchor(&self, identity_id: &str) -> Result<bool, String>;
    fn latest_accumulator_material_version(&self, issuer_id: &str) -> Result<u64, String>;
    fn accumulator_material_anchor(
        &self,
        issuer_id: &str,
        version: u64,
    ) -> Result<AccumulatorMaterialAnchor, String>;
}

/// Narrow reader used by the Status List resolver. Kept separate from
/// `EvmTrustReader` so verifier trust mocks do not need status-list behavior.
pub trait EvmStatusListReader {
    fn status_list_anchor(
        &self,
        issuer_id: &str,
        status_list_credential: &str,
    ) -> Result<StatusListAnchor, String>;
}

pub struct EvmRegistryReader {
    runtime: Runtime,
    provider: DynProvider,
    did_registry: Address,
    enterprise_trust_registry: Address,
    issuer_registry: Address,
    expected_chain_id: u64,
}

impl EvmRegistryReader {
    pub fn connect(
        rpc_url: &str,
        did_registry: &str,
        enterprise_trust_registry: &str,
        issuer_registry: &str,
        expected_chain_id: u64,
    ) -> Result<Self, String> {
        let runtime =
            Runtime::new().map_err(|err| format!("Could not create Tokio runtime [{err}]"))?;

        let provider = runtime
            .block_on(async {
                ProviderBuilder::new()
                    .connect(rpc_url)
                    .await
                    .map(|provider| provider.erased())
            })
            .map_err(|err| format!("Could not connect to EVM RPC {rpc_url} [{err}]"))?;

        let observed_chain_id = runtime
            .block_on(provider.get_chain_id())
            .map_err(|err| format!("Could not read EVM chain id [{err}]"))?;

        if observed_chain_id != expected_chain_id {
            return Err(format!(
                "Unexpected EVM chain id {observed_chain_id}; expected {expected_chain_id}"
            ));
        }

        Ok(Self {
            runtime,
            provider,
            did_registry: parse_address(did_registry, "DID registry")?,
            enterprise_trust_registry: parse_address(
                enterprise_trust_registry,
                "EnterpriseTrustRegistry",
            )?,
            issuer_registry: parse_address(issuer_registry, "IssuerRegistry")?,
            expected_chain_id,
        })
    }

    pub fn expected_chain_id(&self) -> u64 {
        self.expected_chain_id
    }

    pub fn identity_address(&self, identity_id: &str) -> Result<Address, String> {
        parse_identity_address(identity_id, self.expected_chain_id)
    }

    pub fn identity_owner(&self, identity_id: &str) -> Result<Address, String> {
        let identity = self.identity_address(identity_id)?;
        let contract = EthereumDIDRegistryContract::new(self.did_registry, &self.provider);

        self.runtime
            .block_on(async { contract.identityOwner(identity).call().await })
            .map_err(|err| format!("Could not resolve DID owner for {identity_id} [{err}]"))
    }

    pub fn identity_status(&self, identity_id: &str) -> Result<IdentityStatus, String> {
        let identity = self.identity_address(identity_id)?;
        let contract =
            EnterpriseTrustRegistryContract::new(self.enterprise_trust_registry, &self.provider);

        let result = self
            .runtime
            .block_on(async { contract.getIdentity(identity).call().await })
            .map_err(|err| format!("Could not read enterprise identity {identity_id} [{err}]"))?;

        match result.status {
            0 => Err(format!(
                "Identity {identity_id} is not enrolled in EnterpriseTrustRegistry"
            )),
            1 => Ok(IdentityStatus::Active),
            2 => Ok(IdentityStatus::Suspended),
            3 => Ok(IdentityStatus::Revoked),
            status => Err(format!(
                "Identity {identity_id} has unsupported on-chain status {status}"
            )),
        }
    }

    pub fn is_trust_anchor(&self, identity_id: &str) -> Result<bool, String> {
        let identity = self.identity_address(identity_id)?;
        let contract =
            EnterpriseTrustRegistryContract::new(self.enterprise_trust_registry, &self.provider);

        self.runtime
            .block_on(async { contract.isTrustAnchor(identity).call().await })
            .map_err(|err| format!("Could not read trust-anchor state for {identity_id} [{err}]"))
    }

    pub fn latest_accumulator_material_version(&self, issuer_id: &str) -> Result<u64, String> {
        let issuer = self.identity_address(issuer_id)?;
        let contract = IssuerRegistryContract::new(self.issuer_registry, &self.provider);

        self.runtime
            .block_on(async {
                contract
                    .latestAccumulatorMaterialVersion(issuer)
                    .call()
                    .await
            })
            .map_err(|err| {
                format!(
                    "Could not read latest accumulator material version for {issuer_id} [{err}]"
                )
            })
    }

    pub fn accumulator_material_anchor(
        &self,
        issuer_id: &str,
        version: u64,
    ) -> Result<AccumulatorMaterialAnchor, String> {
        if version == 0 {
            return Err(String::from(
                "Accumulator material version must be greater than zero",
            ));
        }

        let issuer = self.identity_address(issuer_id)?;
        let contract = IssuerRegistryContract::new(self.issuer_registry, &self.provider);

        self.runtime
            .block_on(async {
                contract
                    .getAccumulatorMaterial(issuer, version)
                    .call()
                    .await
            })
            .map(|result| AccumulatorMaterialAnchor {
                material_hash: result.materialHash,
                published_at: result.publishedAt,
                exists: result.exists,
            })
            .map_err(|err| {
                format!(
                    "Could not read accumulator material version {version} for {issuer_id} [{err}]"
                )
            })
    }

    pub fn status_list_anchor(
        &self,
        issuer_id: &str,
        status_list_credential: &str,
    ) -> Result<StatusListAnchor, String> {
        if status_list_credential.trim().is_empty() {
            return Err(String::from("Status List Credential id cannot be empty"));
        }

        let issuer = self.identity_address(issuer_id)?;
        let list_id = Self::status_list_id(status_list_credential);
        let contract = IssuerRegistryContract::new(self.issuer_registry, &self.provider);

        self.runtime
            .block_on(async { contract.getStatusList(issuer, list_id).call().await })
            .map(|result| StatusListAnchor {
                purpose: result.purpose,
                current_document_hash: result.currentDocumentHash,
                current_version: result.currentVersion,
                updated_at: result.updatedAt,
                exists: result.exists,
            })
            .map_err(|err| {
                format!(
                    "Could not read Status List anchor {status_list_credential} for {issuer_id} [{err}]"
                )
            })
    }

    /// Matches the Solidity-side convention used by the PoC:
    /// listId = keccak256(UTF-8 Status List Credential identifier).
    pub fn status_list_id(status_list_credential: &str) -> B256 {
        keccak256(status_list_credential.as_bytes())
    }
}

impl EvmTrustReader for EvmRegistryReader {
    fn identity_status(&self, identity_id: &str) -> Result<IdentityStatus, String> {
        EvmRegistryReader::identity_status(self, identity_id)
    }

    fn is_trust_anchor(&self, identity_id: &str) -> Result<bool, String> {
        EvmRegistryReader::is_trust_anchor(self, identity_id)
    }

    fn latest_accumulator_material_version(&self, issuer_id: &str) -> Result<u64, String> {
        EvmRegistryReader::latest_accumulator_material_version(self, issuer_id)
    }

    fn accumulator_material_anchor(
        &self,
        issuer_id: &str,
        version: u64,
    ) -> Result<AccumulatorMaterialAnchor, String> {
        EvmRegistryReader::accumulator_material_anchor(self, issuer_id, version)
    }
}

impl EvmStatusListReader for EvmRegistryReader {
    fn status_list_anchor(
        &self,
        issuer_id: &str,
        status_list_credential: &str,
    ) -> Result<StatusListAnchor, String> {
        EvmRegistryReader::status_list_anchor(self, issuer_id, status_list_credential)
    }
}

fn parse_address(value: &str, label: &str) -> Result<Address, String> {
    Address::from_str(value).map_err(|err| format!("Invalid {label} address {value} [{err}]"))
}

fn parse_identity_address(identity_id: &str, expected_chain_id: u64) -> Result<Address, String> {
    if identity_id.starts_with("0x") {
        return parse_address(identity_id, "identity");
    }

    let rest = identity_id
        .strip_prefix("did:ethr:")
        .ok_or_else(|| format!("Unsupported identity id {identity_id}; expected did:ethr"))?;

    let parts = rest.split(':').collect::<Vec<_>>();
    if parts.len() != 2 {
        return Err(format!(
            "Unsupported did:ethr identifier {identity_id}; expected did:ethr:<chainId>:<address>"
        ));
    }

    let chain_id = parse_chain_id(parts[0])?;
    if chain_id != expected_chain_id {
        return Err(format!(
            "DID {identity_id} belongs to chain {chain_id}, expected {expected_chain_id}"
        ));
    }

    parse_address(parts[1], "did:ethr identity")
}

fn parse_chain_id(value: &str) -> Result<u64, String> {
    if let Some(hex) = value.strip_prefix("0x") {
        u64::from_str_radix(hex, 16)
            .map_err(|err| format!("Invalid hexadecimal did:ethr chain id {value} [{err}]"))
    } else {
        value
            .parse::<u64>()
            .map_err(|err| format!("Invalid did:ethr chain id {value} [{err}]"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOCAL_DID: &str = "did:ethr:0x7a69:0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

    #[test]
    fn parses_local_did_ethr_identity() -> Result<(), String> {
        let address = parse_identity_address(LOCAL_DID, 31337)?;
        assert_eq!(
            address,
            Address::from_str("0x70997970C51812dc3A010C7d01b50e0d17dc79C8")
                .map_err(|err| err.to_string())?
        );
        Ok(())
    }

    #[test]
    fn rejects_did_from_different_chain() {
        assert!(parse_identity_address(LOCAL_DID, 1).is_err());
    }

    #[test]
    fn status_list_id_is_deterministic() {
        let id = "urn:delegation:status-list:root:revocation-1";
        assert_eq!(
            EvmRegistryReader::status_list_id(id),
            keccak256(id.as_bytes())
        );
    }
}
