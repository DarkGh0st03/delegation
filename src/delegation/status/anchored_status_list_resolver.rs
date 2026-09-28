use crate::delegation::status::bitstring_status_list_entry::BitstringStatusListEntry;
use crate::delegation::status::bitstring_status_list_resolver::BitstringStatusListResolver;
use crate::delegation::status::status_list_credential_provider::StatusListCredentialProviderRef;
use crate::delegation::status::status_list_resolver::StatusListResolver;
use crate::delegation::status::status_purpose::StatusPurpose;
use crate::delegation::trust::evm::evm_registry_reader::EvmStatusListReader;
use alloy::primitives::{B256, keccak256};
use std::rc::Rc;

/// Status List resolver that binds the exact off-chain document bytes to the
/// issuer's current on-chain Status List anchor before reading the status bit.
///
/// Commitment convention for this PoC:
/// `currentDocumentHash = keccak256(exact UTF-8 bytes returned by the provider)`.
/// No JSON reserialization or normalization is performed.
pub struct AnchoredStatusListResolver {
    provider: StatusListCredentialProviderRef,
    chain: Rc<dyn EvmStatusListReader>,
}

impl AnchoredStatusListResolver {
    pub fn new(
        provider: StatusListCredentialProviderRef,
        chain: Rc<dyn EvmStatusListReader>,
    ) -> Self {
        Self { provider, chain }
    }

    pub fn document_commitment(raw_credential: &str) -> B256 {
        keccak256(raw_credential.as_bytes())
    }

    fn expected_chain_purpose(purpose: &StatusPurpose) -> Result<u8, String> {
        match purpose {
            StatusPurpose::Revocation => Ok(1),
            StatusPurpose::Suspension => Ok(2),
            StatusPurpose::Message => Err(String::from(
                "Status purpose message is not supported by IssuerRegistry",
            )),
        }
    }
}

impl StatusListResolver for AnchoredStatusListResolver {
    fn is_status_set(&self, _entry: &BitstringStatusListEntry) -> Result<bool, String> {
        Err(String::from(
            "AnchoredStatusListResolver requires the credential issuer; use issuer-aware resolution",
        ))
    }

    fn is_status_set_for_issuer(
        &self,
        issuer_id: &str,
        entry: &BitstringStatusListEntry,
    ) -> Result<bool, String> {
        let anchor = self
            .chain
            .status_list_anchor(issuer_id, entry.status_list_credential())?;

        if !anchor.exists {
            return Err(format!(
                "Status List {} is not anchored on-chain for issuer {issuer_id}",
                entry.status_list_credential()
            ));
        }

        let expected_purpose = Self::expected_chain_purpose(entry.status_purpose())?;
        if anchor.purpose != expected_purpose {
            return Err(format!(
                "On-chain Status List purpose {} does not match credential entry purpose {}",
                anchor.purpose,
                entry.status_purpose()
            ));
        }

        if anchor.current_version == 0 {
            return Err(format!(
                "Status List {} has invalid on-chain version 0",
                entry.status_list_credential()
            ));
        }

        // Fetch exactly once: the bytes checked against the chain are the same bytes
        // subsequently parsed and used for the status-bit decision.
        let raw_credential = self
            .provider
            .get_status_list_credential(entry.status_list_credential())?;

        let observed_hash = Self::document_commitment(&raw_credential);
        if observed_hash != anchor.current_document_hash {
            return Err(format!(
                "Status List commitment mismatch for issuer {issuer_id}, list {} version {}: on-chain {}, observed {}",
                entry.status_list_credential(),
                anchor.current_version,
                anchor.current_document_hash,
                observed_hash
            ));
        }

        BitstringStatusListResolver::is_status_set_in_document(entry, &raw_credential)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::delegation::status::in_memory_status_list_credential_provider::InMemoryStatusListCredentialProvider;
    use crate::delegation::trust::evm::evm_registry_reader::StatusListAnchor;
    use flate2::Compression;
    use flate2::write::GzEncoder;
    use multibase::Base;
    use serde_json::json;
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::io::Write;

    const ISSUER: &str = "did:ethr:0x7a69:0x90F79bf6EB2c4f870365E785982E1f101E93b906";
    const STATUS_LIST_URL: &str = "https://status.example/lists/anchored-revocation-1";

    struct MockStatusListReader {
        anchors: RefCell<HashMap<(String, String), StatusListAnchor>>,
    }

    impl MockStatusListReader {
        fn new() -> Self {
            Self {
                anchors: RefCell::new(HashMap::new()),
            }
        }

        fn set_anchor(&self, issuer: &str, url: &str, document: &str, version: u64) {
            self.anchors.borrow_mut().insert(
                (issuer.to_string(), url.to_string()),
                StatusListAnchor {
                    purpose: 1,
                    current_document_hash: AnchoredStatusListResolver::document_commitment(document),
                    current_version: version,
                    updated_at: version,
                    exists: true,
                },
            );
        }
    }

    impl EvmStatusListReader for MockStatusListReader {
        fn status_list_anchor(
            &self,
            issuer_id: &str,
            status_list_credential: &str,
        ) -> Result<StatusListAnchor, String> {
            Ok(self
                .anchors
                .borrow()
                .get(&(issuer_id.to_string(), status_list_credential.to_string()))
                .cloned()
                .unwrap_or(StatusListAnchor {
                    purpose: 0,
                    current_document_hash: B256::ZERO,
                    current_version: 0,
                    updated_at: 0,
                    exists: false,
                }))
        }
    }


    fn entry() -> BitstringStatusListEntry {
        BitstringStatusListEntry::revocation(
            None,
            String::from("42"),
            String::from(STATUS_LIST_URL),
        )
        .expect("test status entry must be valid")
    }

    fn encode_bitstring(bitstring: &[u8]) -> Result<String, String> {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder
            .write_all(bitstring)
            .map_err(|err| format!("Could not GZIP-compress test bitstring [{err}]"))?;
        let compressed = encoder
            .finish()
            .map_err(|err| format!("Could not finish GZIP test encoding [{err}]"))?;
        Ok(multibase::encode(Base::Base64Url, compressed))
    }

    fn document(revoked: bool) -> Result<String, String> {
        let mut bitstring = vec![0u8; 16 * 1024];
        if revoked {
            let index = 42usize;
            bitstring[index / 8] |= 0b1000_0000u8 >> (index % 8);
        }

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
                "encodedList": encode_bitstring(&bitstring)?
            }
        })
        .to_string())
    }

    #[test]
    fn accepts_exact_current_anchored_document() -> Result<(), String> {
        let raw = document(false)?;
        let provider = Rc::new(InMemoryStatusListCredentialProvider::new());
        provider.insert(String::from(STATUS_LIST_URL), raw.clone());

        let chain = Rc::new(MockStatusListReader::new());
        chain.set_anchor(ISSUER, STATUS_LIST_URL, &raw, 1);

        let resolver = AnchoredStatusListResolver::new(provider, chain);
        assert!(!resolver.is_status_set_for_issuer(ISSUER, &entry())?);
        Ok(())
    }

    #[test]
    fn rejects_document_that_no_longer_matches_current_anchor() -> Result<(), String> {
        let original = document(false)?;
        let changed = document(true)?;
        let provider = Rc::new(InMemoryStatusListCredentialProvider::new());
        provider.insert(String::from(STATUS_LIST_URL), changed);

        let chain = Rc::new(MockStatusListReader::new());
        chain.set_anchor(ISSUER, STATUS_LIST_URL, &original, 1);

        let resolver = AnchoredStatusListResolver::new(provider, chain);
        assert!(resolver.is_status_set_for_issuer(ISSUER, &entry()).is_err());
        Ok(())
    }

    #[test]
    fn current_anchor_update_changes_revocation_decision() -> Result<(), String> {
        let active = document(false)?;
        let revoked = document(true)?;

        let provider = Rc::new(InMemoryStatusListCredentialProvider::new());
        provider.insert(String::from(STATUS_LIST_URL), active.clone());

        let chain = Rc::new(MockStatusListReader::new());
        chain.set_anchor(ISSUER, STATUS_LIST_URL, &active, 1);

        let resolver = AnchoredStatusListResolver::new(provider.clone(), chain.clone());
        assert!(!resolver.is_status_set_for_issuer(ISSUER, &entry())?);

        provider.insert(String::from(STATUS_LIST_URL), revoked.clone());
        chain.set_anchor(ISSUER, STATUS_LIST_URL, &revoked, 2);

        assert!(resolver.is_status_set_for_issuer(ISSUER, &entry())?);
        Ok(())
    }
}
