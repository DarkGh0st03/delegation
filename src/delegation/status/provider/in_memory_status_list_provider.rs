use crate::delegation::status::model::status_list_credential_artifact::StatusListCredentialArtifact;
use crate::delegation::status::provider::status_list_credential_provider_trait::StatusListCredentialProvider;
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

/// In-memory source of complete Status List artifacts.
///
/// This provider is intended for deterministic local tests and test support. It
/// is issuer-aware so tests exercise the same lookup contract as the EVM/JWT
/// profile.
#[derive(Clone, Default)]
pub struct InMemoryStatusListCredentialProvider {
    credentials: Rc<RefCell<HashMap<(String, String), String>>>,
}

impl InMemoryStatusListCredentialProvider {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&self, issuer_id: String, url: String, artifact: String) {
        self.credentials
            .borrow_mut()
            .insert((issuer_id, url), artifact);
    }
}

impl StatusListCredentialProvider for InMemoryStatusListCredentialProvider {
    fn get_status_list_credential(
        &self,
        issuer_id: &str,
        url: &str,
    ) -> Result<StatusListCredentialArtifact, String> {
        let document = self
            .credentials
            .borrow()
            .get(&(issuer_id.to_string(), url.to_string()))
            .cloned()
            .ok_or_else(|| {
                format!(
                    "Status list credential {url} is not available for issuer {issuer_id}"
                )
            })?;

        Ok(StatusListCredentialArtifact {
            commitment_bytes: document.as_bytes().to_vec(),
            document,
        })
    }
}
