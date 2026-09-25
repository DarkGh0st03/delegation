use crate::delegation::status::status_purpose::StatusPurpose;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
enum StatusListEntryType {
    #[serde(rename = "BitstringStatusListEntry")]
    BitstringStatusListEntry,
}

/// W3C Bitstring Status List entry associated with a Verifiable Credential.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BitstringStatusListEntry {
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    #[serde(rename = "type")]
    entry_type: StatusListEntryType,
    #[serde(rename = "statusPurpose")]
    status_purpose: StatusPurpose,
    #[serde(rename = "statusListIndex")]
    status_list_index: String,
    #[serde(rename = "statusListCredential")]
    status_list_credential: String,
}

impl BitstringStatusListEntry {
    pub fn new(
        id: Option<String>,
        status_purpose: StatusPurpose,
        status_list_index: String,
        status_list_credential: String,
    ) -> Result<Self, String> {
        if id.as_ref().is_some_and(|value| value.trim().is_empty()) {
            return Err(String::from("Bitstring Status List entry id cannot be empty"));
        }

        if status_list_index.is_empty()
            || !status_list_index.chars().all(|value| value.is_ascii_digit())
        {
            return Err(String::from(
                "statusListIndex must be a non-empty base-10 integer string",
            ));
        }

        if status_list_credential.trim().is_empty() {
            return Err(String::from("statusListCredential cannot be empty"));
        }

        Ok(Self {
            id,
            entry_type: StatusListEntryType::BitstringStatusListEntry,
            status_purpose,
            status_list_index,
            status_list_credential,
        })
    }

    pub fn revocation(
        id: Option<String>,
        status_list_index: String,
        status_list_credential: String,
    ) -> Result<Self, String> {
        Self::new(
            id,
            StatusPurpose::Revocation,
            status_list_index,
            status_list_credential,
        )
    }

    pub fn id(&self) -> Option<&String> {
        self.id.as_ref()
    }

    pub fn status_purpose(&self) -> &StatusPurpose {
        &self.status_purpose
    }

    pub fn status_list_index(&self) -> &String {
        &self.status_list_index
    }

    pub fn status_list_credential(&self) -> &String {
        &self.status_list_credential
    }

    /// Deterministic, length-prefixed representation used in the accumulator metadata binding.
    pub fn canonical_value(&self) -> String {
        fn field(value: &str) -> String {
            format!("{}:{}", value.len(), value)
        }

        let id = self.id.as_deref().unwrap_or_default();
        let id_present = if self.id.is_some() { "1" } else { "0" };

        format!(
            "v1:{}:{}:{}:{}:{}:{}",
            id_present,
            field(id),
            field("BitstringStatusListEntry"),
            field(self.status_purpose.as_str()),
            field(&self.status_list_index),
            field(&self.status_list_credential),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_w3c_field_names() -> Result<(), String> {
        let entry = BitstringStatusListEntry::revocation(
            None,
            String::from("42"),
            String::from("https://status.example/lists/1"),
        )?;
        let value = serde_json::to_value(entry).map_err(|err| err.to_string())?;

        assert_eq!(value["type"], "BitstringStatusListEntry");
        assert_eq!(value["statusPurpose"], "revocation");
        assert_eq!(value["statusListIndex"], "42");
        assert_eq!(
            value["statusListCredential"],
            "https://status.example/lists/1"
        );
        Ok(())
    }

    #[test]
    fn canonical_value_changes_with_status_index() -> Result<(), String> {
        let first = BitstringStatusListEntry::revocation(
            None,
            String::from("42"),
            String::from("https://status.example/lists/1"),
        )?;
        let second = BitstringStatusListEntry::revocation(
            None,
            String::from("43"),
            String::from("https://status.example/lists/1"),
        )?;

        assert_ne!(first.canonical_value(), second.canonical_value());
        Ok(())
    }
}
