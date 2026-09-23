use crate::delegation::credentials::ours::asymmetric_mechanism::AsymmetricMechanism;
use crate::delegation::credentials::ours::our_efficient_delegation::OurEfficientDelegation;
use serde::{Deserialize, Serialize};
use std::fmt::Display;

#[derive(Clone, Serialize, Deserialize)]
pub struct OurEfficientDelegator {
    #[serde(rename = "id")]
    id: String,
    #[serde(rename = "sub")]
    delegatee_id: String,
    #[serde(rename = "iat")]
    iat: String,
    #[serde(rename = "exp")]
    exp: String,
    #[serde(rename = "am")]
    asymmetric_mechanism: AsymmetricMechanism,
}

impl OurEfficientDelegator {
    /// Creates a new OurDelegator instance using cryptographic accumulators.
    ///
    /// # Arguments
    /// * `id` - a string containing the delegator's identity.
    /// * `delegatee_id` - a string containing the delegatee.
    /// * `iat` - a string containing the "issued at" parameter.
    /// * `exp` - a string containing the "expiration" parameter.
    /// * `accumulator_value` - a string containing the value of the accumulator as provided by the clone_accumulator in AccumulatorManager.
    /// * `metadata_witness` - string containing the witness corresponding to the hashed metadata (iat, exp, delegatee_id, ...).
    /// * `permission_witnesses` - a vector of strings containing the witnesses of permissions.
    ///
    /// # Returns
    /// An instance of OurDelegator.
    pub fn new_with_accumulator(
        id: String,
        delegatee_id: String,
        iat: String,
        exp: String,
        accumulator_value: String,
        metadata_witness: String,
        permission_witnesses: Vec<String>,
    ) -> OurEfficientDelegator {
        let asymmetric_mechanism = AsymmetricMechanism::Accumulator(
            accumulator_value,
            metadata_witness,
            permission_witnesses,
        );

        OurEfficientDelegator {
            id,
            delegatee_id,
            iat,
            exp,
            asymmetric_mechanism,
        }
    }

    /// Creates a new OurDelegator instance using digital signatures.
    ///
    /// # Arguments
    /// * `id` - a string containing the delegator's identity.
    /// * `delegatee_id` - a string containing the delegatee.
    /// * `iat` - a string containing the "issued at" parameter.
    /// * `exp` - a string containing the "expiration" parameter.
    /// * `signature` - a string containing the digital signature.
    ///
    /// # Returns
    /// An instance of OurDelegator.
    pub fn new_with_signature(
        id: String,
        delegatee_id: String,
        iat: String,
        exp: String,
        signature: String,
    ) -> OurEfficientDelegator {
        let asymmetric_mechanism = AsymmetricMechanism::Signature(signature);

        OurEfficientDelegator {
            id,
            delegatee_id,
            iat,
            exp,
            asymmetric_mechanism,
        }
    }

    /// Getter function that returns the issuers id.
    pub fn id(&self) -> &String {
        &self.id
    }

    /// Checks whether the underlying asymmetric mechanism is a signature or an accumulator. In the
    /// first case, returns an error, in the latter case the function removes the permission witness
    /// stored in the `i` index of the permission_witnesses array.
    ///
    /// # Parameters:
    /// * `i` - index of the permission witness to remove.
    ///
    /// Returns
    /// an error in case of failure.
    pub fn remove_permission_witness(&mut self, i: usize) -> Result<(), String> {
        match &mut self.asymmetric_mechanism {
            AsymmetricMechanism::Signature(_) => {
                Err("The underlying asymmetric mechanism is not an accumulator.".to_string())
            }
            AsymmetricMechanism::Accumulator(_, _, permission_witnesses) => {
                permission_witnesses.remove(i);
                Ok(())
            }
        }
    }
}

impl OurEfficientDelegation for OurEfficientDelegator {
    /// Getter function that returns the delegatee id variable.
    fn delegatee_id(&self) -> &String {
        &self.delegatee_id
    }
    /// Getter function that returns the iat variable.
    fn iat(&self) -> &String {
        &self.iat
    }
    /// Getter function that returns the exp variable.
    fn exp(&self) -> &String {
        &self.exp
    }
    /// Getter function for retrieving the underlying asymmetric mechanism variable.
    fn asymmetric_mechanism(&self) -> &AsymmetricMechanism {
        &self.asymmetric_mechanism
    }
}

impl Display for OurEfficientDelegator {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match serde_json::to_string(self) {
            Ok(result) => write!(f, "{}", result),
            Err(e) => {
                eprintln!("OurEfficientDelegator serialization failed: {}", e);
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
                "am": {
                  "Signature": "signature over id, sub, iat, exp, accumulator_value and metadata witness"
                }
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
        let delegator = match serde_json::from_value::<OurEfficientDelegator>(delegator_value) {
            Ok(delegator) => delegator,
            Err(err) => return Err(format!("Failed to parse delegator object: [{err}]")),
        };

        println!("{delegator}");

        Ok(())
    }
}
