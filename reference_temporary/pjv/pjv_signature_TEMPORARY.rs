use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub struct PJVSignature {
    #[serde(rename = "ED25519Signature")]
    pub signature: String,
}

impl PJVSignature {
    /// Creates a new PJVSignature instance.
    ///
    /// # Arguments
    /// * `signature` - a string containing the encoded signature.
    ///
    /// # Returns
    /// An instance of PJVSignature.
    pub fn new(signature: String) -> PJVSignature {
        PJVSignature { signature }
    }

    /// Getter function that returns the signature variable.
    pub fn signature(&self) -> &String {
        &self.signature
    }
}
