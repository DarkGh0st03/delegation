use crate::delegation::credentials::ours::our_delegation::OurDelegation;
use crate::delegation::status::bitstring_status_list_entry::BitstringStatusListEntry;
use serde::{Deserialize, Serialize};
use std::fmt::Display;

#[derive(Clone, Serialize, Deserialize)]
pub struct OurDelegator {
    #[serde(rename = "id")]
    id: String,
    #[serde(rename = "credentialId")]
    credential_id: String,
    #[serde(rename = "credentialStatus")]
    credential_status: BitstringStatusListEntry,
    #[serde(rename = "sub")]
    delegatee_id: String,
    #[serde(rename = "iat")]
    iat: String,
    #[serde(rename = "exp")]
    exp: String,
    #[serde(rename = "av")]
    accumulator_value: String,
    #[serde(rename = "mw")]
    metadata_witness: String,
    #[serde(rename = "pw")]
    permission_witnesses: Vec<String>,
}

impl OurDelegator {
    /// Creates a new OurDelegator instance.
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
    pub fn new(
        id: String,
        credential_id: String,
        credential_status: BitstringStatusListEntry,
        delegatee_id: String,
        iat: String,
        exp: String,
        accumulator_value: String,
        metadata_witness: String,
        permission_witnesses: Vec<String>,
    ) -> OurDelegator {
        OurDelegator {
            id,
            credential_id,
            credential_status,
            delegatee_id,
            iat,
            exp,
            accumulator_value,
            metadata_witness,
            permission_witnesses,
        }
    }

    /// Getter function that returns the issuer's id.
    pub fn id(&self) -> &String {
        &self.id
    }

    /// Getter function that returns the parent credential id.
    pub fn credential_id(&self) -> &String {
        &self.credential_id
    }

    /// Getter function that returns the parent credential status entry.
    pub fn credential_status(&self) -> &BitstringStatusListEntry {
        &self.credential_status
    }

    /// Removes a permission witness from the array.
    ///
    /// # Parameters:
    /// * `i` - index of the permission witness to remove.
    ///
    /// Returns
    /// an error in case of failure.
    pub fn remove_permission_witness(&mut self, i: usize) -> Result<(), String> {
        self.permission_witnesses.remove(i);
        Ok(())
    }
}

impl OurDelegation for OurDelegator {
    /// Getter function that returns the delegatee id variable.
    fn delegatee_id(&self) -> &String {
        &self.delegatee_id
    }
    /// Getter function that returns the value of the accumulator.
    fn accumulator_value(&self) -> &String {
        &self.accumulator_value
    }
    /// Getter function that returns the iat variable.
    fn iat(&self) -> &String {
        &self.iat
    }
    /// Getter function that returns the exp variable.
    fn exp(&self) -> &String {
        &self.exp
    }
    /// Getter function that returns the metadata_witness variable.
    fn metadata_witness(&self) -> &String {
        &self.metadata_witness
    }
    /// Getter function that returns the permission_witnesses variable.
    fn permission_witnesses(&self) -> &Vec<String> {
        &self.permission_witnesses
    }
}

impl Display for OurDelegator {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match serde_json::to_string(self) {
            Ok(result) => write!(f, "{}", result),
            Err(e) => {
                eprintln!("OurDelegator serialization failed: {}", e);
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
                "credentialId": "http://delegation.example/credentials/1337",
                "credentialStatus": {
                    "type": "BitstringStatusListEntry",
                    "statusPurpose": "revocation",
                    "statusListIndex": "0",
                    "statusListCredential": "https://status.example/lists/revocation-1"
                },
                "sub": "https://vc.example/delegators/d1",
                "iat": "0000000001",
                "exp": "1000000000",
                "av": "accumulator_value_d1",
                "mw": "w_metadata_d1",
                "pw": [ "w0d1", "w1d1" ]
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
        let delegator = match serde_json::from_value::<OurDelegator>(delegator_value) {
            Ok(delegator) => delegator,
            Err(err) => return Err(format!("Failed to parse delegator object: [{err}]")),
        };

        println!("{delegator}");

        Ok(())
    }
}
