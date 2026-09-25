use std::rc::Rc;

/// Supplies a BitstringStatusListCredential document for a status-list URL.
///
/// A production provider that crosses a trust boundary must also ensure that the
/// retrieved Verifiable Credential is authenticated according to the deployment's
/// trust model before exposing it to the resolver.
pub trait StatusListCredentialProvider {
    fn get_status_list_credential(&self, url: &str) -> Result<String, String>;
}

pub type StatusListCredentialProviderRef = Rc<dyn StatusListCredentialProvider>;
