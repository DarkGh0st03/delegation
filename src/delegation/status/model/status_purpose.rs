use serde::{Deserialize, Serialize};
use std::fmt::{Display, Formatter};

/// Purpose associated with a W3C Bitstring Status List entry.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StatusPurpose {
    Revocation,
    Suspension,
    Message,
}

impl StatusPurpose {
    pub fn as_str(&self) -> &'static str {
        match self {
            StatusPurpose::Revocation => "revocation",
            StatusPurpose::Suspension => "suspension",
            StatusPurpose::Message => "message",
        }
    }
}

impl Display for StatusPurpose {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}
