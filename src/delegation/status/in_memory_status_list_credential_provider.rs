use crate::delegation::status::status_list_credential_provider::StatusListCredentialProvider;
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

/// In-memory source of complete BitstringStatusListCredential JSON documents.
///
/// This provider is intended for deterministic local tests and for the PoC before
/// an HTTP-backed provider is introduced at the Gateway/integration layer.
#[derive(Clone, Default)]
pub struct InMemoryStatusListCredentialProvider {
    credentials: Rc<RefCell<HashMap<String, String>>>,
}

impl InMemoryStatusListCredentialProvider {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&self, url: String, credential_json: String) {
        self.credentials.borrow_mut().insert(url, credential_json);
    }
}

impl StatusListCredentialProvider for InMemoryStatusListCredentialProvider {
    fn get_status_list_credential(&self, url: &str) -> Result<String, String> {
        self.credentials
            .borrow()
            .get(url)
            .cloned()
            .ok_or_else(|| format!("Status list credential {url} is not available"))
    }
}
