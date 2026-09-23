use crate::delegation::credentials::sdjwt::sdjwt_delegation::SdJWTDelegation;
use crate::delegation::credentials::sdjwt::sdjwt_delegator::SdJWTDelegator;
use crate::delegation::traits::credential::Credential;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fmt::Display;

#[derive(Clone, Serialize, Deserialize)]
pub struct SdJWTDelegationCredential {
    #[serde(rename = "sub")]
    delegatee_id: String,
    #[serde(rename = "has")]
    hashes: Vec<String>,
    #[serde(rename = "iat")]
    iat: String,
    #[serde(rename = "exp")]
    exp: String,
    #[serde(rename = "per")]
    permissions: Vec<String>,
    #[serde(rename = "ps")]
    permission_salts: Vec<String>,
    #[serde(rename = "sig")]
    signature: String,
    #[serde(rename = "hierarchy")]
    hierarchy: Vec<SdJWTDelegator>,
}

impl SdJWTDelegationCredential {
    /// Creates a new instance of the Delegation Credential based on SD-JWT
    ///
    /// # Arguments
    /// * `delegatee_id` - string containing the id of the delegatee.
    /// * `hashes` - vector of strings containing the salted hashes of the permissions.
    /// * `iat` - string containing the "issued at" parameter.
    /// * `exp` - string containing the "expiration" parameter.
    /// * `permissions` - vector of strings containing the permissions granted.
    /// * `permission_salts` - vector of strings containing the salts corresponding to every permission.
    /// * `signature` - signature over every other field except for hierarchy, permissions, permission_salts.
    /// * `hierarchy` - vector of SdJWTDelegator containing previous delegators in the delegation chain.
    ///
    /// # Returns
    /// A result containing the SdJWTDelegationCredential instance
    pub fn new(
        delegatee_id: String,
        hashes: Vec<String>,
        iat: String,
        exp: String,
        permissions: Vec<String>,
        permission_salts: Vec<String>,
        signature: String,
        hierarchy: Vec<SdJWTDelegator>,
    ) -> Result<SdJWTDelegationCredential, String> {
        Ok(SdJWTDelegationCredential {
            delegatee_id,
            hashes,
            iat,
            exp,
            permissions,
            permission_salts,
            signature,
            hierarchy,
        })
    }

    /// Getter function for the permissions variable.
    pub fn permissions(&self) -> &Vec<String> {
        &self.permissions
    }

    /// Getter function for the hierarchy variable.
    pub fn hierarchy(&self) -> &Vec<SdJWTDelegator> {
        &self.hierarchy
    }

    /// Getter function for the permission salts.
    pub fn permission_salts(&self) -> &Vec<String> {
        &self.permission_salts
    }
}

impl SdJWTDelegation for SdJWTDelegationCredential {
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

impl Credential for SdJWTDelegationCredential {
    /// Function that returns a static string containing the type of the credential.
    fn credential_type(&self) -> &'static str {
        "SdJWTDelegationCredential"
    }

    /// Builds a SdJWTDelegationCredential instance from a serde_json Map<String, Value>.
    ///
    /// # Arguments
    /// * `map` - the map object to build the SdJWTDelegationCredential instance from.
    ///
    /// # Returns
    /// A result containing the SdJWTDelegationCredential instance or an error containing a string in case of failure.
    fn from_map(map: Map<String, Value>) -> Result<Self, String> {
        match serde_json::from_value::<SdJWTDelegationCredential>(Value::Object(map.clone())) {
            Ok(credential) => Ok(credential),
            Err(err) => Err(format!("Error in parsing SdJWTDelegationCredential: {err}")),
        }
    }

    /// Builds an SdJWTDelegationCredential instance from a json string.
    ///
    /// # Arguments
    /// * `str` - the json string used to build the instance.
    ///
    /// # Returns
    /// A result containing the SdJWTDelegationCredential instance or an error as a string in case of failure.
    fn from_string(str: String) -> Result<Self, String> {
        match serde_json::from_str::<SdJWTDelegationCredential>(&str) {
            Ok(credential) => Ok(credential),
            Err(err) => Err(format!(
                "Failed to deserialize SdJWTDelegationCredential [{err}]"
            )),
        }
    }

    /// Generates a serde_json Map<String, Value> object from the current SdJWTDelegationCredential instance.
    ///
    /// # Returns
    /// A result containing the Map<String, Value> or an error as a string in case of failure.
    fn to_map(&self) -> Result<Map<String, Value>, String> {
        let map_value = match ::serde_json::to_value(&self) {
            Ok(map_value) => map_value,
            Err(err) => {
                return Err(format!(
                    "Failed to serialize SdJWTDelegationCredential to map [{err}]"
                ));
            }
        };

        match map_value {
            Value::Object(map) => Ok(map),
            _ => Err(format!("Serialized map is not an object [{map_value}]")),
        }
    }

    /// Generates a serde_json Map<String, Value> object from the current SdJWTDelegationCredential instance.
    ///
    /// # Returns
    /// A result containing the Map<String, Value> or an error as a string in case of failure.
    fn to_string(&self) -> Result<String, String> {
        match serde_json::to_string(&self) {
            Ok(str) => Ok(str),
            Err(err) => Err(format!(
                "Failed to serialize SdJWTDelegationCredential to json string [{err}]"
            )),
        }
    }

    /// Function that enables Selective Disclosure in this credential. It only retains the claims specified and modifies the verification values accordingly.
    ///
    /// # Arguments
    /// * `allowed` - claims to be kept in the credential (if a claim is key:value, the vector contains key).
    ///
    /// # Returns
    /// A result containing the indices of the claims removed from the credential or an error as a string in case of failure.
    fn retain_only(&mut self, allowed: Vec<String>) -> Result<Vec<usize>, String> {
        let permissions_to_keep = allowed;

        let mut removable_indices: Vec<usize> = vec![];

        // For every permission check whether it is contained in the permissions to be kept.
        // If not, add it to an array of indices to be removed
        for (i, permission) in self.permissions.iter().enumerate() {
            if !permissions_to_keep.contains(&permission) {
                removable_indices.push(i);
            }
        }

        // Remove indices from permissions, witnesses, and delegator witnesses contained in
        // hierarchy
        for i in removable_indices.iter().rev() {
            self.permissions.remove(*i);
            self.permission_salts.remove(*i);
        }

        Ok(removable_indices)
    }

    /// Checks whether the credential still contains the necessary elements for a presentation.
    /// # Returns
    /// A boolean value: true if the credential is empty, false otherwise.
    fn is_empty(&self) -> bool {
        self.permissions.is_empty() || self.hashes.is_empty()
    }
}

impl Display for SdJWTDelegationCredential {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match Credential::to_string(self) {
            Ok(result) => write!(f, "{}", result),
            Err(e) => {
                eprintln!("SdJWTDelegationCredential serialization failed: {}", e);
                Err(std::fmt::Error)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::delegation::traits::credential::Credential;

    #[test]
    fn parse_dc() -> Result<(), String> {
        let dcs: Vec<&str> = vec![DC_D1, DC_D2, DC_D3, DC_D4];
        let names: Vec<&str> = vec!["D1", "D2", "D3", "D4"];

        for (name, dc) in names.iter().zip(dcs.iter()) {
            let dc: SdJWTDelegationCredential = match serde_json::from_str(dc) {
                Ok(dc) => dc,
                Err(err) => {
                    return Err(format!(
                        "Failed to deserialize DelegationCredential [{err}]"
                    ));
                }
            };

            let dc_map = dc.to_map()?;
            let dc = SdJWTDelegationCredential::from_map(dc_map)?;

            println!("[{name}]\nDelegationCredential object: [{dc}]");
        }

        Ok(())
    }

    pub const DC_D1: &str = r#"{
        "sub": "https://vc.example/delegators/d1",
        "has": ["hash0_d1", "hash1_d1", "hash2_d1"],
        "iat": "0000000001",
        "exp": "1000000000",
        "per": [ "https://vc.example/resources/r1:p0", "https://vc.example/resources/r1:p1", "https://vc.example/resources/r1:p2" ],
        "ps": [ "salt0", "salt1", "salt2" ],
        "sig": "signature from d0",
        "hierarchy": []
    }"#;

    pub const DC_D2: &str = r#"{
        "sub": "https://vc.example/delegators/d2",
        "has": ["hash0_d1", "hash1_d1"],
        "iat": "0000000002",
        "exp": "1000000000",
        "per": [ "https://vc.example/resources/r1:p0", "https://vc.example/resources/r1:p1" ],
        "ps": [ "salt0", "salt1" ],
        "sig": "signature from d1",
        "hierarchy": [
            {
                "id": "https://vc.example/delegators/d0",
                "sub": "https://vc.example/delegators/d1",
                "iat": "0000000001",
                "exp": "1000000000",
                "has": ["hash0_d1", "hash1_d1", "hash2_d1"],
                "sig": "signature from d0"
            }
        ]
    }"#;

    pub const DC_D3: &str = r#"{
        "sub": "https://vc.example/delegators/d3",
        "has": ["hash0_d1", "hash1_d1"],
        "iat": "0000000003",
        "exp": "1000000000",
        "per": [ "https://vc.example/resources/r1:p0", "https://vc.example/resources/r1:p1" ],
        "ps": [ "salt0", "salt1" ],
        "sig": "signature from d2",
        "hierarchy": [
            {
                "id": "https://vc.example/delegators/d0",
                "sub": "https://vc.example/delegators/d1",
                "iat": "0000000001",
                "exp": "1000000000",
                "has": ["hash0_d1", "hash1_d1", "hash2_d1"],
                "sig": "signature from d0"
            },
            {
                "id": "https://vc.example/delegators/d1",
                "sub": "https://vc.example/delegators/d2",
                "iat": "0000000002",
                "exp": "1000000000",
                "has": ["hash0_d1", "hash1_d1"],
                "sig": "signature from d1"
            }
        ]
    }"#;

    pub const DC_D4: &str = r#"{
        "sub": "https://vc.example/delegators/d4",
        "has": ["hash0_d1", "hash1_d1"],
        "iat": "0000000004",
        "exp": "1000000000",
        "per": [ "https://vc.example/resources/r1:p0", "https://vc.example/resources/r1:p1" ],
        "ps": [ "salt0", "salt1" ],
        "sig": "signature from d3",
        "hierarchy": [
            {
                "id": "https://vc.example/delegators/d0",
                "sub": "https://vc.example/delegators/d1",
                "iat": "0000000001",
                "exp": "1000000000",
                "has": ["hash0_d1", "hash1_d1", "hash2_d1"],
                "sig": "signature from d0"
            },
            {
                "id": "https://vc.example/delegators/d1",
                "sub": "https://vc.example/delegators/d2",
                "iat": "0000000002",
                "exp": "1000000000",
                "has": ["hash0_d1", "hash1_d1"],
                "sig": "signature from d1"
            },
            {
                "id": "https://vc.example/delegators/d2",
                "sub": "https://vc.example/delegators/d3",
                "iat": "0000000003",
                "exp": "1000000000",
                "has": ["hash0_d1", "hash1_d1"],
                "sig": "signature from d3"
            }
        ]
    }"#;
}
