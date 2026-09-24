use crate::delegation::traits::credential::Credential;
use serde::{Deserialize, Serialize};
use std::fmt::Display;

#[derive(Clone, Serialize, Deserialize)]
pub struct VerifiableCredential<C: Credential> {
    #[serde(rename = "@context")]
    context: Vec<String>,
    #[serde(rename = "type")]
    credential_type: Vec<String>,
    #[serde(rename = "id")]
    id: String,
    #[serde(rename = "issuer")]
    issuer: String,
    #[serde(rename = "validFrom")]
    valid_from: String,
    #[serde(rename = "credentialSubject")]
    credential: C,
}

impl<C: Credential> VerifiableCredential<C> {
    /// Creates a new VerifiableCredential instance for a given Credential (C) type.
    ///
    /// # Arguments
    /// * `context` - a vector of string containing the context of the VC.
    /// * `id` - a string containing the VC's identifier.
    /// * `issuer` - a string containing the VC issuer.
    /// * `valid_from` - a string containing the validity of the VC.
    /// * `credential` - the Credential containing claims.
    ///
    /// # Returns
    /// An instance of VerifiableCredential.
    pub fn new(
        context: Vec<String>,
        id: String,
        issuer: String,
        valid_from: String,
        credential: C,
    ) -> VerifiableCredential<C> {
        let credential_type = vec![credential.credential_type().to_string()];
        VerifiableCredential {
            context,
            credential_type,
            id,
            issuer,
            valid_from,
            credential,
        }
    }

    /// Getter function that returns the context vector.
    pub fn context(&self) -> &Vec<String> {
        &self.context
    }
    /// Getter function that returns the type of the VC.
    pub fn credential_type(&self) -> &Vec<String> {
        &self.credential_type
    }
    /// Getter function that returns the id of the VC.
    pub fn id(&self) -> &String {
        &self.id
    }
    /// Getter function that returns the VC's issuer.
    pub fn issuer(&self) -> &String {
        &self.issuer
    }
    /// Getter function that returns the valid_from variable.
    pub fn valid_from(&self) -> &String {
        &self.valid_from
    }
    /// Getter function that returns the nested credential.
    pub fn credential(&self) -> &C {
        &self.credential
    }
}

impl<C: Credential> Display for VerifiableCredential<C> {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match serde_json::to_string(self) {
            Ok(result) => write!(f, "{}", result),
            Err(e) => {
                eprintln!("Verifiable Credential serialization failed: {}", e);
                Err(std::fmt::Error)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::delegation::credentials::ours::our_delegation_credential::OurDelegationCredential;
    use crate::delegation::credentials::verifiable_credential::VerifiableCredential;
    use serde_json::{Map, Value};

    #[test]
    fn parse_dc() -> Result<(), String> {
        let vcs: Vec<&str> = vec![RAW_VC_D1, RAW_VC_D2, RAW_VC_D3, RAW_VC_D4];
        let names: Vec<&str> = vec!["D1", "D2", "D3", "D4"];

        for (name, vc) in names.iter().zip(vcs.iter()) {
            let value_raw_vc: Value = match serde_json::from_str::<Value>(vc) {
                Ok(value_raw_vc) => value_raw_vc,
                Err(err) => {
                    return Err(format!(
                        "Failed to parse [{name}] Raw Verifiable Credential from string. [{err}]"
                    ));
                }
            };

            let raw_vc = match serde_json::from_value::<Map<String, Value>>(value_raw_vc) {
                Ok(raw_vc) => raw_vc,
                Err(err) => {
                    return Err(format!(
                        "Failed to parse [{name}] Raw Verifiable Credential from Value. [{err}]"
                    ));
                }
            };

            let vc = match serde_json::from_value::<VerifiableCredential<OurDelegationCredential>>(
                Value::Object(raw_vc),
            ) {
                Ok(vc) => vc,
                Err(err) => return Err(format!("Error in serialization of vc: [{err}]")),
            };

            println!("Parsed VC [{name}]: {vc}");
        }

        Ok(())
    }

    pub const RAW_VC_D1: &str = r#"{
    "@context": [ "https://www.w3.org/ns/credentials/v2" ],
    "type": [ "DelegationCredential" ],
    "id": "http://delegation.example/credentials/1337",
    "issuer": "https://vc.example/delegators/d0",
    "validFrom": "2010-01-01T00:00:00Z",

    "credentialSubject": {
        "sub": "https://vc.example/delegators/d1",
        "av": "av_d1",
        "iat": "0000000001",
        "exp": "1000000000",
        "per": [ { "resource": "https://gitea.local/repos/project-a", "operation": "read_file" }, { "resource": "https://gitea.local/repos/project-a", "operation": "write_file" }, { "resource": "https://gitea.local/repos/project-a", "operation": "create_branch" } ],
        "mw": "w_metadata_d1",
        "pw": [ "w0d1", "w1d1", "w2d1" ],
        "hierarchy": []
    }
}"#;

    pub const RAW_VC_D2: &str = r#"{
    "@context": [ "https://www.w3.org/ns/credentials/v2" ],
    "type": [ "DelegationCredential" ],
    "id": "http://delegation.example/credentials/1338",
    "issuer": "https://vc.example/delegators/d1",
    "validFrom": "2010-01-01T00:00:00Z",

    "credentialSubject": {
        "sub": "https://vc.example/delegators/d2",
        "av": "av_d2",
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
                "av": "av_d1",
                "mw": "w_metadata_d1",
                "pw": [ "w0d1", "w1d1" ]
            }
        ]
    }
}"#;

    pub const RAW_VC_D3: &str = r#"{
    "@context": [ "https://www.w3.org/ns/credentials/v2" ],
    "type": [ "DelegationCredential" ],
    "id": "http://delegation.example/credentials/1339",
    "issuer": "https://vc.example/delegators/d2",
    "validFrom": "2010-01-01T00:00:00Z",

    "credentialSubject": {
        "sub": "https://vc.example/delegators/d3",
        "av": "av_d3",
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
                "av": "av_d1",
                "mw": "w_metadata_d1",
                "pw": [ "w0d1", "w1d1" ]
            },
            {
                "id": "https://vc.example/delegators/d1",
                "sub": "https://vc.example/delegators/d2",
                "iat": "0000000002",
                "exp": "1000000000",
                "av": "av_d2",
                "mw": "w_metadata_d2",
                "pw": [ "w0d2", "w1d2" ]
            }
        ]
    }
}"#;

    pub const RAW_VC_D4: &str = r#"{
    "@context": [ "https://www.w3.org/ns/credentials/v2" ],
    "type": [ "DelegationCredential" ],
    "id": "http://delegation.example/credentials/1340",
    "issuer": "https://vc.example/delegators/d3",
    "validFrom": "2010-01-01T00:00:00Z",

    "credentialSubject": {
        "sub": "https://vc.example/delegators/d4",
        "av": "av_d4",
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
                "av": "av_d1",
                "mw": "w_metadata_d1",
                "pw": [ "w0d1" ]
            },
            {
                "id": "https://vc.example/delegators/d1",
                "sub": "https://vc.example/delegators/d2",
                "iat": "0000000002",
                "exp": "1000000000",
                "av": "av_d2",
                "mw": "w_metadata_d2",
                "pw": [ "w0d2" ]
            },
            {
                "id": "https://vc.example/delegators/d2",
                "sub": "https://vc.example/delegators/d3",
                "iat": "0000000003",
                "exp": "1000000000",
                "av": "av_d3",
                "mw": "w_metadata_d3",
                "pw": [ "w0d3" ]
            }
        ]
    }
}"#;
}
