use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub enum AsymmetricMechanism {
    Signature(String),
    Accumulator(String, String, Vec<String>),
}

impl AsymmetricMechanism {
    pub fn new_signature(signature: String) -> Self {
        Self::Signature(signature)
    }

    pub fn new_accumulator(
        accumulator_value: String,
        metadata_witness: String,
        permission_witnesses: Vec<String>,
    ) -> Self {
        Self::Accumulator(accumulator_value, metadata_witness, permission_witnesses)
    }
}
