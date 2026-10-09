use crate::delegation::status::model::bitstring_status_list_entry::BitstringStatusListEntry;
use crate::delegation::status::parser::bitstring_status_list_parser::BitstringStatusListParser;
use flate2::Compression;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use multibase::Base;
use serde_json::Value;
use std::io::{Read, Write};

/// Stateless editor for authenticated Bitstring Status List Credential JSON.
///
/// The caller is responsible for authenticating the document before mutation and
/// for signing/publishing the returned updated document afterwards.
pub struct BitstringStatusListMutator;

impl BitstringStatusListMutator {
    pub fn set_status(
        document: &str,
        entry: &BitstringStatusListEntry,
        status_set: bool,
    ) -> Result<String, String> {
        let current = BitstringStatusListParser::read_status(entry, document)?;
        if current == status_set {
            return Err(format!(
                "Status List entry {}:{} is already {}",
                entry.status_list_credential(),
                entry.status_list_index(),
                if status_set { "set" } else { "clear" }
            ));
        }

        let mut value: Value = serde_json::from_str(document).map_err(|err| {
            format!(
                "Could not parse Bitstring Status List Credential {} for mutation [{err}]",
                entry.status_list_credential()
            )
        })?;

        let encoded_list = value
            .get("credentialSubject")
            .and_then(Value::as_object)
            .and_then(|subject| subject.get("encodedList"))
            .and_then(Value::as_str)
            .ok_or_else(|| {
                String::from(
                    "Bitstring Status List Credential has no credentialSubject.encodedList",
                )
            })?
            .to_string();

        if !encoded_list.starts_with('u') {
            return Err(String::from(
                "encodedList must use Multibase base64url without padding",
            ));
        }

        let (_, compressed) = multibase::decode(&encoded_list)
            .map_err(|err| format!("Could not Multibase-decode encodedList [{err}]"))?;
        let mut decoder = GzDecoder::new(compressed.as_slice());
        let mut bitstring = Vec::new();
        decoder
            .read_to_end(&mut bitstring)
            .map_err(|err| format!("Could not GZIP-decompress encodedList [{err}]"))?;

        let index = entry.status_list_index().parse::<usize>().map_err(|err| {
            format!(
                "Could not parse statusListIndex {} [{err}]",
                entry.status_list_index()
            )
        })?;
        let bit_length = bitstring
            .len()
            .checked_mul(8)
            .ok_or_else(|| String::from("Status list bit length overflow"))?;
        if index >= bit_length {
            return Err(format!(
                "statusListIndex {index} is outside status list range 0..{}",
                bit_length.saturating_sub(1)
            ));
        }

        let byte_index = index / 8;
        let bit_offset = index % 8;
        let mask = 0b1000_0000u8 >> bit_offset;
        if status_set {
            bitstring[byte_index] |= mask;
        } else {
            bitstring[byte_index] &= !mask;
        }

        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder
            .write_all(&bitstring)
            .map_err(|err| format!("Could not GZIP-compress updated status list [{err}]"))?;
        let compressed = encoder
            .finish()
            .map_err(|err| format!("Could not finish updated status-list compression [{err}]"))?;
        let updated_encoded_list = multibase::encode(Base::Base64Url, compressed);

        let subject = value
            .get_mut("credentialSubject")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| {
                String::from("Bitstring Status List Credential has no credentialSubject object")
            })?;
        subject.insert(
            String::from("encodedList"),
            Value::String(updated_encoded_list),
        );

        let updated = serde_json::to_string(&value)
            .map_err(|err| format!("Could not serialize updated Status List Credential [{err}]"))?;

        let observed = BitstringStatusListParser::read_status(entry, &updated)?;
        if observed != status_set {
            return Err(String::from(
                "Updated Status List Credential does not contain the requested status bit",
            ));
        }

        Ok(updated)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::delegation::status::model::status_purpose::StatusPurpose;
    use flate2::Compression;
    use flate2::write::GzEncoder;
    use multibase::Base;
    use serde_json::json;
    use std::io::Write;

    const URL: &str = "https://status.example/lists/mutation-1";

    fn entry(purpose: StatusPurpose) -> BitstringStatusListEntry {
        BitstringStatusListEntry::new(
            None,
            purpose,
            String::from("42"),
            String::from(URL),
        )
        .expect("test status entry must be valid")
    }

    fn document(purpose: &str, status_set: bool) -> Result<String, String> {
        let mut bitstring = vec![0u8; 16 * 1024];
        if status_set {
            let index = 42usize;
            bitstring[index / 8] |= 0b1000_0000u8 >> (index % 8);
        }

        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder
            .write_all(&bitstring)
            .map_err(|err| err.to_string())?;
        let compressed = encoder.finish().map_err(|err| err.to_string())?;
        let encoded = multibase::encode(Base::Base64Url, compressed);

        Ok(json!({
            "@context": ["https://www.w3.org/ns/credentials/v2"],
            "id": URL,
            "type": ["VerifiableCredential", "BitstringStatusListCredential"],
            "issuer": "did:example:issuer",
            "validFrom": "2026-01-01T00:00:00Z",
            "credentialSubject": {
                "id": format!("{URL}#list"),
                "type": "BitstringStatusList",
                "statusPurpose": purpose,
                "encodedList": encoded
            }
        })
        .to_string())
    }

    #[test]
    fn sets_revocation_bit() -> Result<(), String> {
        let entry = entry(StatusPurpose::Revocation);
        let updated = BitstringStatusListMutator::set_status(
            &document("revocation", false)?,
            &entry,
            true,
        )?;
        assert!(BitstringStatusListParser::read_status(&entry, &updated)?);
        Ok(())
    }

    #[test]
    fn clears_suspension_bit() -> Result<(), String> {
        let entry = entry(StatusPurpose::Suspension);
        let updated = BitstringStatusListMutator::set_status(
            &document("suspension", true)?,
            &entry,
            false,
        )?;
        assert!(!BitstringStatusListParser::read_status(&entry, &updated)?);
        Ok(())
    }

    #[test]
    fn rejects_noop_mutation() -> Result<(), String> {
        let entry = entry(StatusPurpose::Revocation);
        assert!(
            BitstringStatusListMutator::set_status(
                &document("revocation", false)?,
                &entry,
                false,
            )
            .is_err()
        );
        Ok(())
    }
}
