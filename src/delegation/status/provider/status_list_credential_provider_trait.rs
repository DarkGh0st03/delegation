/// Supplies a BitstringStatusListCredential for a stable status-list identifier.
use crate::delegation::status::model::status_list_credential_artifact::StatusListCredentialArtifact;
use std::rc::Rc;

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
