use crate::delegation::status::model::status_list_credential_artifact::StatusListCredentialArtifact;
use crate::delegation::status::provider::status_list_credential_provider_trait::StatusListCredentialProvider;
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

/// Explicit in-memory Status List artifact store for deterministic tests and
/// local examples.
///
/// Production EVM/JWT resolution uses an authenticated provider plus on-chain
/// anchoring; this store only supplies locally controlled artifacts.
#[derive(Clone, Default)]
pub struct InMemoryStatusListStore {
    credentials: Rc<RefCell<HashMap<(String, String), String>>>,
}

impl InMemoryStatusListStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&self, issuer_id: String, url: String, artifact: String) {
        self.credentials
            .borrow_mut()
            .insert((issuer_id, url), artifact);
    }
}

impl StatusListCredentialProvider for InMemoryStatusListStore {
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
                format!("Status list credential {url} is not available for issuer {issuer_id}")
            })?;

        Ok(StatusListCredentialArtifact {
            commitment_bytes: document.as_bytes().to_vec(),
            document,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_issuer_different_urls_are_distinct_and_missing_keys_fail_closed() -> Result<(), String> {
        let store = InMemoryStatusListStore::new();
        let issuer = String::from("did:ethr:0x7a69:0x1234");
        let other_issuer = String::from("did:ethr:0x7a69:0xabcd");
        let revocation = String::from("https://status.example/revocation");
        let suspension = String::from("https://status.example/suspension");

        store.insert(issuer.clone(), revocation.clone(), String::from("signed-jwt-1"));
        store.insert(issuer.clone(), suspension.clone(), String::from("signed-jwt-2"));

        let revocation_artifact = store.get_status_list_credential(&issuer, &revocation)?;
        let suspension_artifact = store.get_status_list_credential(&issuer, &suspension)?;
        assert_eq!(revocation_artifact.document, "signed-jwt-1");
        assert_eq!(revocation_artifact.commitment_bytes, b"signed-jwt-1");
        assert_eq!(suspension_artifact.document, "signed-jwt-2");
        assert_eq!(suspension_artifact.commitment_bytes, b"signed-jwt-2");

        assert!(store.get_status_list_credential(&other_issuer, &revocation).is_err());
        assert!(store.get_status_list_credential(&issuer, "https://status.example/absent").is_err());
        Ok(())
    }

    #[test]
    fn updating_one_issuer_and_url_does_not_overwrite_another() -> Result<(), String> {
        let store = InMemoryStatusListStore::new();
        let url = String::from("https://status.example/common");
        let issuer_a = String::from("did:example:issuer-a");
        let issuer_b = String::from("did:example:issuer-b");
        store.insert(issuer_a.clone(), url.clone(), String::from("initial-a"));
        store.insert(issuer_b.clone(), url.clone(), String::from("initial-b"));
        store.insert(issuer_a.clone(), url.clone(), String::from("updated-a"));

        let a = store.get_status_list_credential(&issuer_a, &url)?;
        let b = store.get_status_list_credential(&issuer_b, &url)?;
        assert_eq!(a.document, "updated-a");
        assert_eq!(a.commitment_bytes, b"updated-a");
        assert_eq!(b.document, "initial-b");
        assert_eq!(b.commitment_bytes, b"initial-b");
        Ok(())
    }

    #[test]
    fn isolates_status_artifacts_by_issuer_and_url() -> Result<(), String> {
        let store = InMemoryStatusListStore::new();
        let url = String::from("https://status.example/lists/shared");
        let issuer_a = String::from("did:example:issuer-a");
        let issuer_b = String::from("did:example:issuer-b");

        store.insert(issuer_a.clone(), url.clone(), String::from("artifact-a"));
        store.insert(issuer_b.clone(), url.clone(), String::from("artifact-b"));

        let artifact_a = store.get_status_list_credential(&issuer_a, &url)?;
        let artifact_b = store.get_status_list_credential(&issuer_b, &url)?;

        assert_eq!(artifact_a.document, "artifact-a");
        assert_eq!(artifact_b.document, "artifact-b");
        assert_ne!(artifact_a.commitment_bytes, artifact_b.commitment_bytes);
        Ok(())
    }
}
