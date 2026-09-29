use crate::delegation::trust::model::identity_status::IdentityStatus;
use alloy::primitives::B256;

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
/// abstraction keeps asynchronous JSON-RPC details out of the verifier.
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
