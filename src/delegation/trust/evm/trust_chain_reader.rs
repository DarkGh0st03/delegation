use crate::delegation::trust::model::identity_status::IdentityStatus;
use alloy::primitives::B256;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AccumulatorMaterialAnchor {
    pub material_hash: B256,
    pub published_at: u64,
    pub exists: bool,
}

/// Synchronous reader for trust data anchored on EVM.
///
/// The rest of the Delegation Credential verifier is synchronous. This
/// abstraction keeps asynchronous JSON-RPC details out of the trust resolver.
pub trait TrustChainReader {
    fn identity_status(&self, identity_id: &str) -> Result<IdentityStatus, String>;
    fn is_trust_anchor(&self, identity_id: &str) -> Result<bool, String>;
    fn latest_accumulator_material_version(&self, issuer_id: &str) -> Result<u64, String>;
    fn accumulator_material_anchor(
        &self,
        issuer_id: &str,
        version: u64,
    ) -> Result<AccumulatorMaterialAnchor, String>;
}
