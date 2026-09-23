use crate::delegation::credentials::sdjwt::sdjwt_delegation::SdJWTDelegation;
use serde::{Deserialize, Serialize};
use std::fmt::Display;

#[derive(Clone, Serialize, Deserialize)]
pub struct SdJWTDelegator {
    #[serde(rename = "id")]
    id: String,
    #[serde(rename = "sub")]
    delegatee_id: String,
    #[serde(rename = "iat")]
    iat: String,
    #[serde(rename = "exp")]
    exp: String,
    #[serde(rename = "has")]
    hashes: Vec<String>,
    #[serde(rename = "sig")]
    signature: String,
}

impl SdJWTDelegator {
    /// Creates a new SdJWTDelegator instance.
    ///
    /// # Arguments
    /// * `id` - a string containing the delegator's identity.
    /// * `delegatee_id` - a string containing the delegatee.
    /// * `iat` - a string containing the "issued at" parameter.
    /// * `exp` - a string containing the "expiration" parameter.
    /// * `hashes` - a vector of strings containing the salted hashes of the permissions.
    /// * `signature` - the signature over the other fields except for `id`.
    ///
    /// # Returns
    /// An instance of SdJWTDelegator.
    pub fn new(
        id: String,
        delegatee_id: String,
        iat: String,
        exp: String,
        hashes: Vec<String>,
        signature: String,
    ) -> SdJWTDelegator {
        SdJWTDelegator {
            id,
            delegatee_id,
            iat,
            exp,
            hashes,
            signature,
        }
    }

    /// Getter function that returns the issuers id.
    pub fn id(&self) -> &String {
        &self.id
    }

    pub fn mut_hashes(&mut self) -> &mut Vec<String> {
        &mut self.hashes
    }
}

impl SdJWTDelegation for SdJWTDelegator {
    /// Getter function that returns the delegatee id variable.
    fn delegatee_id(&self) -> &String {
        &self.delegatee_id
    }
    /// Getter function that returns the list of hashes.
    fn hashes(&self) -> &Vec<String> {
        &self.hashes
    }
    /// Getter function that returns the iat variable.
    fn iat(&self) -> &String {
        &self.iat
    }
    /// Getter function that returns the exp variable.
    fn exp(&self) -> &String {
        &self.exp
    }
    /// Getter function that returns the signature variable.
    fn signature(&self) -> &String {
        &self.signature
    }
}

impl Display for SdJWTDelegator {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match serde_json::to_string(self) {
            Ok(result) => write!(f, "{}", result),
            Err(e) => {
                eprintln!("SdJWTDelegator serialization failed: {}", e);
                Err(std::fmt::Error)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    const DELEGATOR_OBJECT: &str = r#"{
                "id": "https://vc.example/delegators/d0",
                "sub": "https://vc.example/delegators/d1",
                "iat": "0000000001",
                "exp": "1000000000",
                "has": [ "hash0_d1", "hash1_d1", "hash2_d1" ],
                "sig": "signature over id, sub, iat, exp, has"
        }"#;

    #[test]
    fn display_delegator() -> Result<(), String> {
        let delegator_value = match serde_json::from_str::<Value>(DELEGATOR_OBJECT) {
            Ok(delegator_value) => delegator_value,
            Err(e) => return Err(format!("Failed to parse delegator object: [{e}]")),
        };
        let delegator_map = match delegator_value {
            Value::Object(delegator_map) => delegator_map,
            _ => {
                return Err(format!(
                    "Parsed delegator {delegator_value} is not an object."
                ));
            }
        };

        let delegator_value = Value::Object(delegator_map);
        let delegator = match serde_json::from_value::<SdJWTDelegator>(delegator_value) {
            Ok(delegator) => delegator,
            Err(err) => return Err(format!("Failed to parse delegator object: [{err}]")),
        };

        println!("{delegator}");

        Ok(())
    }
}
