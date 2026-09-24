use crate::delegation::authorization::permission::Permission;
use crate::delegation::credentials::ours::our_delegation::OurDelegation;
use crate::delegation::credentials::ours::our_delegator::OurDelegator;
use crate::delegation::traits::credential::Credential;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fmt::Display;

#[derive(Clone, Serialize, Deserialize)]
pub struct OurDelegationCredential {
    #[serde(rename = "sub")]
    delegatee_id: String,
    #[serde(rename = "av")]
    accumulator_value: String,
    #[serde(rename = "iat")]
    iat: String,
    #[serde(rename = "exp")]
    exp: String,
    #[serde(rename = "per")]
    permissions: Vec<Permission>,
    #[serde(rename = "mw")]
    metadata_witness: String,
    #[serde(rename = "pw")]
    permission_witnesses: Vec<String>,
    #[serde(rename = "hierarchy")]
    hierarchy: Vec<OurDelegator>,
}

impl OurDelegationCredential {
    /// Creates a new instance of the Delegation Credential we have proposed in the paper
    ///
    /// # Arguments
    /// * `delegatee_id` - string containing the id of the delegatee.
    /// * `accumulator_value` - string containing the value of the accumulator.
    /// * `iat` - string containing the "issued at" parameter.
    /// * `exp` - string containing the "expiration" parameter.
    /// * `permissions` - vector of structured Permission values granted.
    /// * `metadata_witnesses` - string containing the serialized metadata witness.
    /// * `permission_witnesses` - vector of strings containing the permission witnesses.
    /// * `hierarchy` - vector of OurDelegator containing previous delegators in the delegation chain.
    ///
    /// # Returns
    /// A result containing the OurDelegationCredential instance or an error as a string in case of failure.
    pub fn new(
        delegatee_id: String,
        accumulator_value: String,
        iat: String,
        exp: String,
        permissions: Vec<Permission>,
        metadata_witness: String,
        permission_witnesses: Vec<String>,
        hierarchy: Vec<OurDelegator>,
    ) -> Result<OurDelegationCredential, String> {
        Ok(OurDelegationCredential {
            delegatee_id,
            accumulator_value,
            iat,
            exp,
            permissions,
            metadata_witness,
            permission_witnesses,
            hierarchy,
        })
    }

    /// Getter function for the permissions variable.
    pub fn permissions(&self) -> &Vec<Permission> {
        &self.permissions
    }

    /// Getter function for the hierarchy variable.
    pub fn hierarchy(&self) -> &Vec<OurDelegator> {
        &self.hierarchy
    }
}

impl OurDelegation for OurDelegationCredential {
    /// Getter function for the delegatee_id variable.
    fn delegatee_id(&self) -> &String {
        &self.delegatee_id
    }
    /// Getter function for the accumulator_value variable.
    fn accumulator_value(&self) -> &String {
        &self.accumulator_value
    }
    /// Getter function for the iat variable.
    fn iat(&self) -> &String {
        &self.iat
    }
    /// Getter function for the exp variable.
    fn exp(&self) -> &String {
        &self.exp
    }
    /// Getter function for the metadata_witnesses variable.
    fn metadata_witness(&self) -> &String {
        &self.metadata_witness
    }
    /// Getter function for the permission_witnesses variable.
    fn permission_witnesses(&self) -> &Vec<String> {
        &self.permission_witnesses
    }
}

impl Credential for OurDelegationCredential {
    type Claim = Permission;

    /// Function that returns a static string containing the type of the credential.
    fn credential_type(&self) -> &'static str {
        "OurDelegationCredential"
    }

    /// Builds an OurDelegationCredential instance from a serde_json Map<String, Value>.
    ///
    /// # Arguments
    /// * `map` - the map object to build the OurDelegationCredential instance from.
    ///
    /// # Returns
    /// A result containing the OurDelegationCredential instance or an error containing a string in case of failure.
    fn from_map(map: Map<String, Value>) -> Result<Self, String> {
        match serde_json::from_value::<OurDelegationCredential>(Value::Object(map.clone())) {
            Ok(credential) => Ok(credential),
            Err(err) => Err(format!("Error in parsing OurDelegationCredential: {err}")),
        }
    }

    /// Builds an OurDelegationCredential instance from a json string.
    ///
    /// # Arguments
    /// * `str` - the json string used to build the instance.
    ///
    /// # Returns
    /// A result containing the OurDelegationCredential instance or an error as a string in case of failure.
    fn from_string(str: String) -> Result<Self, String> {
        match serde_json::from_str::<OurDelegationCredential>(&str) {
            Ok(credential) => Ok(credential),
            Err(err) => Err(format!(
                "Failed to deserialize OurDelegationCredential [{err}]"
            )),
        }
    }

    /// Generates a serde_json Map<String, Value> object from the current OurDelegationCredential instance.
    ///
    /// # Returns
    /// A result containing the Map<String, Value> or an error as a string in case of failure.
    fn to_map(&self) -> Result<Map<String, Value>, String> {
        let map_value = match ::serde_json::to_value(&self) {
            Ok(map_value) => map_value,
            Err(err) => {
                return Err(format!(
                    "Failed to serialize OurDelegationCredential to map [{err}]"
                ));
            }
        };

        match map_value {
            Value::Object(map) => Ok(map),
            _ => Err(format!("Serialized map is not an object [{map_value}]")),
        }
    }

    /// Generates a serde_json Map<String, Value> object from the current OurDelegationCredential instance.
    ///
    /// # Returns
    /// A result containing the Map<String, Value> or an error as a string in case of failure.
    fn to_string(&self) -> Result<String, String> {
        match serde_json::to_string(&self) {
            Ok(str) => Ok(str),
            Err(err) => Err(format!(
                "Failed to serialize OurDelegationCredential to json string [{err}]"
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
    fn retain_only(&mut self, allowed: Vec<Permission>) -> Result<Vec<usize>, String> {
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
            self.permission_witnesses.remove(*i);

            for delegator in self.hierarchy.iter_mut() {
                delegator.remove_permission_witness(*i)?;
            }
        }

        Ok(removable_indices)
    }

    /// Checks whether the credential still contains the necessary elements for a presentation.
    /// # Returns
    /// A boolean value: true if the credential is empty, false otherwise.
    fn is_empty(&self) -> bool {
        self.permissions.is_empty() || self.permission_witnesses.is_empty()
    }
}

impl Display for OurDelegationCredential {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match Credential::to_string(self) {
            Ok(result) => write!(f, "{}", result),
            Err(e) => {
                eprintln!("OurDelegationCredential serialization failed: {}", e);
                Err(std::fmt::Error)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::delegation::credentials::ours::our_delegation_credential::OurDelegationCredential;
    use crate::delegation::traits::credential::Credential;

    #[test]
    fn parse_dc() -> Result<(), String> {
        let dcs: Vec<&str> = vec![DC_D1, DC_D2, DC_D3, DC_D4];
        let names: Vec<&str> = vec!["D1", "D2", "D3", "D4"];

        for (name, dc) in names.iter().zip(dcs.iter()) {
            let dc: OurDelegationCredential = match serde_json::from_str(dc) {
                Ok(dc) => dc,
                Err(err) => {
                    return Err(format!(
                        "Failed to deserialize DelegationCredential [{err}]"
                    ));
                }
            };

            let dc_map = dc.to_map()?;
            let dc = OurDelegationCredential::from_map(dc_map)?;

            println!("[{name}]\nDelegationCredential object: [{dc}]");
        }

        Ok(())
    }

    pub const DC_D1: &str = r#"{
        "sub": "https://vc.example/delegators/d1",
        "av": "accumulator_value_d1",
        "iat": "0000000001",
        "exp": "1000000000",
        "per": [ { "resource": "https://gitea.local/repos/project-a", "operation": "read_file" }, { "resource": "https://gitea.local/repos/project-a", "operation": "write_file" }, { "resource": "https://gitea.local/repos/project-a", "operation": "create_branch" } ],
        "mw": "w_metadata_d1",
        "pw": [ "w0d1", "w1d1", "w2d1" ],
        "hierarchy": []
    }"#;

    pub const DC_D2: &str = r#"{
        "sub": "https://vc.example/delegators/d2",
        "av": "accumulator_value_d2",
        "iat": "0000000002",
        "exp": "1000000000",
        "per": [ { "resource": "https://gitea.local/repos/project-a", "operation": "read_file" }, { "resource": "https://gitea.local/repos/project-a", "operation": "write_file" } ],
        "mw": "w_metadata_d2",
        "pw": [ "w0d2", "w1d2" ],
        "hierarchy": [
            {
                "id": "https://vc.example/delegators/d0",
                "sub": "https://vc.example/delegators/d1",
                "iat": "0000000001",
                "exp": "1000000000",
                "av": "accumulator_value_d1",
                "mw": "w_metadata_d1",
                "pw": [ "w0d1", "w1d1" ]
            }
        ]
    }"#;

    pub const DC_D3: &str = r#"{
        "sub": "https://vc.example/delegators/d3",
        "av": "accumulator_value_d3",
        "iat": "0000000003",
        "exp": "1000000000",
        "per": [ { "resource": "https://gitea.local/repos/project-a", "operation": "read_file" }, { "resource": "https://gitea.local/repos/project-a", "operation": "write_file" } ],
        "mw": "w_metadata_d3",
        "pw": [ "w0d3", "w1d3" ],
        "hierarchy": [
            {
                "id": "https://vc.example/delegators/d0",
                "sub": "https://vc.example/delegators/d1",
                "iat": "0000000001",
                "exp": "1000000000",
                "av": "accumulator_value_d1",
                "mw": "w_metadata_d1",
                "pw": [ "w0d1", "w1d1" ]
            },
            {
                "id": "https://vc.example/delegators/d1",
                "sub": "https://vc.example/delegators/d2",
                "iat": "0000000002",
                "exp": "1000000000",
                "av": "accumulator_value_d2",
                "mw": "w_metadata_d2",
                "pw": [ "w0d2", "w1d2" ]
            }
        ]
    }"#;

    pub const DC_D4: &str = r#"{
        "sub": "https://vc.example/delegators/d4",
        "av": "accumulator_value_d4",
        "iat": "0000000004",
        "exp": "1000000000",
        "per": [ { "resource": "https://gitea.local/repos/project-a", "operation": "read_file" } ],
        "mw": "w_metadata_d4",
        "pw": [ "w0d4" ],
        "hierarchy": [
            {
                "id": "https://vc.example/delegators/d0",
                "sub": "https://vc.example/delegators/d1",
                "iat": "0000000001",
                "exp": "1000000000",
                "av": "accumulator_value_d1",
                "mw": "w_metadata_d1",
                "pw": [ "w0d1" ]
            },
            {
                "id": "https://vc.example/delegators/d1",
                "sub": "https://vc.example/delegators/d2",
                "iat": "0000000002",
                "exp": "1000000000",
                "av": "accumulator_value_d2",
                "mw": "w_metadata_d2",
                "pw": [ "w0d2" ]
            },
            {
                "id": "https://vc.example/delegators/d2",
                "sub": "https://vc.example/delegators/d3",
                "iat": "0000000003",
                "exp": "1000000000",
                "av": "accumulator_value_d3",
                "mw": "w_metadata_d3",
                "pw": [ "w0d3" ]
            }
        ]
    }"#;
}
