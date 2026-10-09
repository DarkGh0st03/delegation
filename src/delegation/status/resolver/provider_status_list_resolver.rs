use crate::delegation::status::model::bitstring_status_list_entry::BitstringStatusListEntry;
use crate::delegation::status::parser::bitstring_status_list_parser::BitstringStatusListParser;
use crate::delegation::status::provider::status_list_credential_provider_trait::StatusListCredentialProviderRef;
use crate::delegation::status::resolver::status_list_resolver_trait::StatusListResolver;

/// Simple provider-backed resolver for off-chain/local profiles.
///
/// It fetches the issuer-scoped artifact and delegates all Bitstring Status List
/// interpretation to `BitstringStatusListParser`.
pub struct ProviderStatusListResolver {
    provider: StatusListCredentialProviderRef,
}

impl ProviderStatusListResolver {
    pub fn new(provider: StatusListCredentialProviderRef) -> Self {
        Self { provider }
    }
}

impl StatusListResolver for ProviderStatusListResolver {
    fn is_status_set(
        &self,
        issuer_id: &str,
        entry: &BitstringStatusListEntry,
    ) -> Result<bool, String> {
        let artifact = self
            .provider
            .get_status_list_credential(issuer_id, entry.status_list_credential())?;

        BitstringStatusListParser::read_status(entry, &artifact.document)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::delegation::status::model::status_purpose::StatusPurpose;
    use crate::delegation::status::provider::in_memory_status_list_provider::InMemoryStatusListCredentialProvider;
    use flate2::Compression;
    use flate2::write::GzEncoder;
    use multibase::Base;
    use serde_json::json;
    use std::io::Write;
    use std::rc::Rc;

    const ISSUER: &str = "did:example:status-authority";
    const STATUS_LIST_URL: &str = "https://status.example/lists/revocation-1";

    fn entry() -> BitstringStatusListEntry {
        BitstringStatusListEntry::new(
            None,
            StatusPurpose::Revocation,
            String::from("42"),
            String::from(STATUS_LIST_URL),
        )
        .expect("test status entry must be valid")
    }

    fn active_document() -> Result<String, String> {
        let bitstring = vec![0u8; 16 * 1024];
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder
            .write_all(&bitstring)
            .map_err(|err| format!("Could not GZIP-compress test bitstring [{err}]"))?;
        let compressed = encoder
            .finish()
            .map_err(|err| format!("Could not finish GZIP test encoding [{err}]"))?;
        let encoded = multibase::encode(Base::Base64Url, compressed);

        Ok(json!({
            "@context": ["https://www.w3.org/ns/credentials/v2"],
            "id": STATUS_LIST_URL,
            "type": ["VerifiableCredential", "BitstringStatusListCredential"],
            "issuer": ISSUER,
            "validFrom": "2026-01-01T00:00:00Z",
            "credentialSubject": {
                "id": format!("{STATUS_LIST_URL}#list"),
                "type": "BitstringStatusList",
                "statusPurpose": "revocation",
                "encodedList": encoded
            }
        })
        .to_string())
    }

    #[test]
    fn fetches_artifact_then_delegates_parsing() -> Result<(), String> {
        let provider = Rc::new(InMemoryStatusListCredentialProvider::new());
        provider.insert(
            String::from(ISSUER),
            String::from(STATUS_LIST_URL),
            active_document()?,
        );

        let resolver = ProviderStatusListResolver::new(provider);
        assert!(!resolver.is_status_set(ISSUER, &entry())?);
        Ok(())
    }
}
