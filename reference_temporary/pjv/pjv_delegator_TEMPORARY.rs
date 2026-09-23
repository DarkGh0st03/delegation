use serde::{Deserialize, Serialize};
use std::fmt::Display;

#[derive(Clone, Serialize, Deserialize)]
pub struct PJVDelegator {
    #[serde(rename = "owner")]
    owner: String,
    #[serde(rename = "iss")]
    iss: String,
    #[serde(rename = "sub")]
    sub: String,
    #[serde(rename = "iat")]
    iat: String,
    #[serde(rename = "exp")]
    exp: String,
    #[serde(rename = "uri")]
    resource_uri: String,
    #[serde(rename = "ops")]
    operations: Vec<String>,
    #[serde(rename = "hierarchy")]
    hierarchy: String,
}

impl PJVDelegator {
    /// Creates a new PJVDelegator instance.
    ///
    /// # Arguments
    /// * `owner` - a string containing the resource owner's identity.
    /// * `iss` - a string containing the issuer's identity.
    /// * `sub` - a string containing the subject's identity.
    /// * `iat` - a string containing the "issued at" parameter.
    /// * `exp` - a string containing the "expiration" parameter.
    /// * `resource_uri` - a string containing the uri of the resource.
    /// * `operations` - a string containing the possible permissions on the resource.
    /// * `hierarchy` - a string containing the encrypted list of previous PJVDelegationCredentials as a string.
    ///
    /// # Returns
    /// An instance of PJVDelegator.
    pub fn new(
        owner: String,
        iss: String,
        sub: String,
        iat: String,
        exp: String,
        resource_uri: String,
        operations: Vec<String>,
        hierarchy: String,
    ) -> PJVDelegator {
        PJVDelegator {
            owner,
            iss,
            sub,
            iat,
            exp,
            resource_uri,
            operations,
            hierarchy,
        }
    }

    /// Getter function that returns the id of the resource owner.
    pub fn owner(&self) -> &String {
        &self.owner
    }
    /// Getter function that returns the issuer's (delegator) id.
    pub fn iss(&self) -> &String {
        &self.iss
    }
    /// Getter function that returns the subject's (delegatee) id.
    pub fn sub(&self) -> &String {
        &self.sub
    }
    /// Getter function that returns the iat variable.
    pub fn iat(&self) -> &String {
        &self.iat
    }
    /// Getter function that returns the exp variable.
    pub fn exp(&self) -> &String {
        &self.exp
    }
    /// Getter function that returns the resource_uri variable.
    pub fn resource_uri(&self) -> &String {
        &self.resource_uri
    }
    /// Getter function that returns the operations (permissions) vector.
    pub fn operations(&self) -> &Vec<String> {
        &self.operations
    }
    /// Getter function that returns a mutable reference to the operations (permissions) vector.
    pub fn mut_operations(&mut self) -> &mut Vec<String> {
        &mut self.operations
    }
    /// Getter function that returns the hierarchy string.
    pub fn hierarchy(&self) -> &String {
        &self.hierarchy
    }
}

impl Display for PJVDelegator {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match serde_json::to_string(self) {
            Ok(result) => write!(f, "{}", result),
            Err(e) => {
                eprintln!("PJVDelegator serialization failed: {}", e);
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
                "owner": "https://vc.example/delegators/d0",
                "iss": "https://vc.example/delegators/d0",
                "sub": "https://vc.example/delegators/d1",
                "iat": "0000000001",
                "exp": "1000000000",
                "uri": "https://api.example.edu/main-door",
                "ops": ["GET"],
                "hierarchy": ""
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
        let delegator = match serde_json::from_value::<PJVDelegator>(delegator_value) {
            Ok(delegator) => delegator,
            Err(err) => return Err(format!("Failed to parse delegator object: [{err}]")),
        };

        println!("{delegator}");

        Ok(())
    }
}
