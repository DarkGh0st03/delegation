use crate::delegation::status::model::status_list_credential_artifact::StatusListCredentialArtifact;
use std::rc::Rc;

/// Supplies the current Status List artifact for a specific issuer and stable
/// status-list identifier.
pub trait StatusListCredentialProvider {
    fn get_status_list_credential(
        &self,
        issuer_id: &str,
        url: &str,
    ) -> Result<StatusListCredentialArtifact, String>;
}

pub type StatusListCredentialProviderRef = Rc<dyn StatusListCredentialProvider>;
