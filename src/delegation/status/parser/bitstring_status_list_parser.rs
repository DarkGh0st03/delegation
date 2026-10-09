use crate::delegation::status::model::bitstring_status_list_entry::BitstringStatusListEntry;
use flate2::read::GzDecoder;
use serde::Deserialize;
use std::io::Read;

const MINIMUM_STATUS_LIST_ENTRIES: usize = 131_072;
const STATUS_SIZE_BITS: usize = 1;

/// Stateless interpreter for authenticated Bitstring Status List Credential JSON.
///
/// This component only validates the document shape, decodes the W3C bitstring,
/// and reads the bit referenced by a `BitstringStatusListEntry`. It performs no
/// fetching, JWT verification, DID resolution, or blockchain access.
pub struct BitstringStatusListParser;

impl BitstringStatusListParser {
    fn expand_bitstring(encoded_list: &str) -> Result<Vec<u8>, String> {
        // The W3C format requires Multibase base64url without padding, whose prefix is "u".
        if !encoded_list.starts_with('u') {
            return Err(String::from(
                "encodedList must use Multibase base64url without padding",
            ));
        }

        let (_, compressed) = multibase::decode(encoded_list)
            .map_err(|err| format!("Could not Multibase-decode encodedList [{err}]"))?;

        let mut decoder = GzDecoder::new(compressed.as_slice());
        let mut bitstring = Vec::new();
        decoder
            .read_to_end(&mut bitstring)
            .map_err(|err| format!("Could not GZIP-decompress encodedList [{err}]"))?;

        Ok(bitstring)
    }

    fn read_status_bit(bitstring: &[u8], index: usize) -> Result<bool, String> {
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

        // W3C Bitstring Status List index 0 is the left-most bit of the first byte.
        let mask = 0b1000_0000u8 >> bit_offset;
        Ok(bitstring[byte_index] & mask != 0)
    }

    pub fn read_status(
        entry: &BitstringStatusListEntry,
        document: &str,
    ) -> Result<bool, String> {
        let credential: BitstringStatusListCredentialDocument =
            serde_json::from_str(document).map_err(|err| {
                format!(
                    "Could not parse BitstringStatusListCredential {} [{err}]",
                    entry.status_list_credential()
                )
            })?;

        if credential.id != *entry.status_list_credential() {
            return Err(format!(
                "Status list document id {} does not match referenced credential {}",
                credential.id,
                entry.status_list_credential()
            ));
        }

        if !credential
            .credential_type
            .contains("BitstringStatusListCredential")
        {
            return Err(String::from(
                "Status list credential type does not include BitstringStatusListCredential",
            ));
        }

        if credential.credential_subject.subject_type != "BitstringStatusList" {
            return Err(String::from(
                "Status list credential subject type is not BitstringStatusList",
            ));
        }

        if !credential
            .credential_subject
            .status_purpose
            .contains(entry.status_purpose().as_str())
        {
            return Err(format!(
                "Status purpose {} is not present in the referenced status list",
                entry.status_purpose()
            ));
        }

        let bitstring = Self::expand_bitstring(&credential.credential_subject.encoded_list)?;

        // This thesis profile currently uses the specification default statusSize=1.
        let number_of_entries = bitstring
            .len()
            .checked_mul(8)
            .and_then(|bits| bits.checked_div(STATUS_SIZE_BITS))
            .ok_or_else(|| String::from("Could not compute status list length"))?;

        if number_of_entries < MINIMUM_STATUS_LIST_ENTRIES {
            return Err(format!(
                "Status list contains {number_of_entries} entries, below the minimum {MINIMUM_STATUS_LIST_ENTRIES}"
            ));
        }

        let credential_index = entry.status_list_index().parse::<usize>().map_err(|err| {
            format!(
                "Could not parse statusListIndex {} [{err}]",
                entry.status_list_index()
            )
        })?;

        Self::read_status_bit(&bitstring, credential_index * STATUS_SIZE_BITS)
    }
}

#[derive(Deserialize)]
struct BitstringStatusListCredentialDocument {
    id: String,
    #[serde(rename = "type")]
    credential_type: OneOrManyString,
    #[serde(rename = "credentialSubject")]
    credential_subject: BitstringStatusListCredentialSubject,
}

#[derive(Deserialize)]
struct BitstringStatusListCredentialSubject {
    #[serde(rename = "type")]
    subject_type: String,
    #[serde(rename = "statusPurpose")]
    status_purpose: OneOrManyString,
    #[serde(rename = "encodedList")]
    encoded_list: String,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum OneOrManyString {
    One(String),
    Many(Vec<String>),
}

impl OneOrManyString {
    fn contains(&self, expected: &str) -> bool {
        match self {
            OneOrManyString::One(value) => value == expected,
            OneOrManyString::Many(values) => values.iter().any(|value| value == expected),
        }
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

    const ISSUER: &str = "did:example:status-authority";
    const STATUS_LIST_URL: &str = "https://status.example/lists/revocation-1";

    fn entry(index: &str, purpose: StatusPurpose) -> BitstringStatusListEntry {
        BitstringStatusListEntry::new(
            None,
            purpose,
            index.to_string(),
            STATUS_LIST_URL.to_string(),
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

    fn status_list_credential(purpose: serde_json::Value, encoded_list: String) -> String {
        json!({
            "@context": ["https://www.w3.org/ns/credentials/v2"],
            "id": STATUS_LIST_URL,
            "type": ["VerifiableCredential", "BitstringStatusListCredential"],
            "issuer": ISSUER,
            "validFrom": "2026-01-01T00:00:00Z",
            "credentialSubject": {
                "id": format!("{STATUS_LIST_URL}#list"),
                "type": "BitstringStatusList",
                "statusPurpose": purpose,
                "encodedList": encoded_list
            }
        })
        .to_string()
    }

    #[test]
    fn reads_real_bitstring_using_left_most_bit_order() -> Result<(), String> {
        let mut bitstring = vec![0u8; 16 * 1024];
        bitstring[0] |= 0b1000_0000;
        bitstring[1] |= 0b0100_0000;

        let document = status_list_credential(
            json!("revocation"),
            encode_bitstring(&bitstring)?,
        );

        assert!(BitstringStatusListParser::read_status(
            &entry("0", StatusPurpose::Revocation),
            &document,
        )?);
        assert!(!BitstringStatusListParser::read_status(
            &entry("1", StatusPurpose::Revocation),
            &document,
        )?);
        assert!(BitstringStatusListParser::read_status(
            &entry("9", StatusPurpose::Revocation),
            &document,
        )?);
        Ok(())
    }

    #[test]
    fn accepts_status_purpose_array_when_entry_purpose_is_present() -> Result<(), String> {
        let bitstring = vec![0u8; 16 * 1024];
        let document = status_list_credential(
            json!(["revocation", "suspension"]),
            encode_bitstring(&bitstring)?,
        );

        assert!(!BitstringStatusListParser::read_status(
            &entry("42", StatusPurpose::Suspension),
            &document,
        )?);
        Ok(())
    }

    #[test]
    fn rejects_status_purpose_mismatch() -> Result<(), String> {
        let bitstring = vec![0u8; 16 * 1024];
        let document = status_list_credential(
            json!("suspension"),
            encode_bitstring(&bitstring)?,
        );

        assert!(
            BitstringStatusListParser::read_status(
                &entry("42", StatusPurpose::Revocation),
                &document,
            )
            .is_err()
        );
        Ok(())
    }

    #[test]
    fn rejects_status_list_below_minimum_length() -> Result<(), String> {
        let bitstring = vec![0u8; 1];
        let document = status_list_credential(
            json!("revocation"),
            encode_bitstring(&bitstring)?,
        );

        assert!(
            BitstringStatusListParser::read_status(
                &entry("0", StatusPurpose::Revocation),
                &document,
            )
            .is_err()
        );
        Ok(())
    }
}
