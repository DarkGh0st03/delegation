use crate::delegation::authorization::permission::Permission;
use serde::{Deserialize, Serialize};

/// Structured authorization result produced only after the delegation proof has been verified.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct VerifiedDelegation {
    presenter_id: String,
    credential_id: String,
    issuer_id: String,
    /// Anchored root credential ID recovered only from the verified Rust hierarchy.
    /// Historical constructors may omit it; authority-only execution MUST reject omission.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    root_credential_id: Option<String>,
    permissions: Vec<Permission>,
    hierarchy_depth: usize,
    expiration: u128,
}

impl VerifiedDelegation {
    pub fn new(
        presenter_id: String,
        credential_id: String,
        issuer_id: String,
        permissions: Vec<Permission>,
        hierarchy_depth: usize,
        expiration: u128,
    ) -> Self {
        Self {
            presenter_id,
            credential_id,
            issuer_id,
            root_credential_id: None,
            permissions,
            hierarchy_depth,
            expiration,
        }
    }

    pub fn presenter_id(&self) -> &String {
        &self.presenter_id
    }

    /// Attach provenance calculated by the cryptographic verifier, never caller JSON.
    pub fn with_verified_root(mut self, root_credential_id: String) -> Self {
        self.root_credential_id = Some(root_credential_id);
        self
    }

    pub fn root_credential_id(&self) -> Option<&str> {
        self.root_credential_id.as_deref()
    }

    pub fn credential_id(&self) -> &String {
        &self.credential_id
    }

    pub fn issuer_id(&self) -> &String {
        &self.issuer_id
    }

    pub fn permissions(&self) -> &Vec<Permission> {
        &self.permissions
    }

    pub fn hierarchy_depth(&self) -> usize {
        self.hierarchy_depth
    }

    pub fn expiration(&self) -> u128 {
        self.expiration
    }
}


#[cfg(test)]
mod root_provenance_tests {
    use super::VerifiedDelegation;

    #[test]
    fn optional_root_provenance_is_explicit_and_serialized() {
        let legacy = VerifiedDelegation::new(
            "did:thesis:backend".to_string(),
            "urn:child".to_string(),
            "did:thesis:orchestrator".to_string(),
            vec![],
            1,
            123,
        );
        assert_eq!(legacy.root_credential_id(), None);
        let with_root = legacy.with_verified_root("urn:operational-root".to_string());
        assert_eq!(with_root.root_credential_id(), Some("urn:operational-root"));
        let json = serde_json::to_value(&with_root).expect("serialize verified delegation");
        assert_eq!(json["root_credential_id"], "urn:operational-root");
    }
}
