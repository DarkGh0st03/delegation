use alloy::primitives::B256;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StatusListAnchor {
    pub purpose: u8,
    pub current_artifact_hash: B256,
    pub current_version: u64,
    pub updated_at: u64,
    pub exists: bool,
}

/// Narrow EVM read contract used by the Status List resolver.
pub trait StatusListAnchorReader {
    fn status_list_anchor(
        &self,
        issuer_id: &str,
        status_list_credential: &str,
    ) -> Result<StatusListAnchor, String>;
}
