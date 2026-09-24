use crate::delegation::authorization::permission::Permission;
use serde::{Deserialize, Serialize};

/// Structured authorization result produced only after the delegation proof has been verified.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct VerifiedDelegation {
    presenter_id: String,
    credential_id: String,
    issuer_id: String,
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
            permissions,
            hierarchy_depth,
            expiration,
        }
    }

    pub fn presenter_id(&self) -> &String {
        &self.presenter_id
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
