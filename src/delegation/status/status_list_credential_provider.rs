use std::rc::Rc;

/// Result of retrieving a Status List Credential.
///
/// `document` is the authenticated JSON document consumed by the Bitstring
/// resolver. `commitment_bytes` are the exact externally fetched bytes whose
/// hash must match the current on-chain anchor.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StatusListCredentialArtifact {
    pub document: String,
    pub commitment_bytes: Vec<u8>,
}

/// Supplies a BitstringStatusListCredential for a stable status-list identifier.
pub trait StatusListCredentialProvider {
    fn get_status_list_credential(&self, url: &str) -> Result<String, String>;

    /// Issuer-aware retrieval/authentication hook.
    ///
    /// Plain providers default to treating the JSON document itself as the
    /// committed artifact. Authenticated providers can instead verify an envelope
    /// (for example a signed JWT) and return its decoded document while preserving
    /// the exact envelope bytes for blockchain commitment checks.
    fn get_status_list_credential_for_issuer(
        &self,
        _issuer_id: &str,
        url: &str,
    ) -> Result<StatusListCredentialArtifact, String> {
        let document = self.get_status_list_credential(url)?;
        Ok(StatusListCredentialArtifact {
            commitment_bytes: document.as_bytes().to_vec(),
            document,
        })
    }
}

pub type StatusListCredentialProviderRef = Rc<dyn StatusListCredentialProvider>;
