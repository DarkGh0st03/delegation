use std::fmt::{Display, Formatter};

/// Lifecycle state of an identity registered in the TrustRegistry.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IdentityStatus {
    Active,
    Suspended,
    Revoked,
}

impl Display for IdentityStatus {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        let value = match self {
            IdentityStatus::Active => "active",
            IdentityStatus::Suspended => "suspended",
            IdentityStatus::Revoked => "revoked",
        };
        write!(f, "{value}")
    }
}
