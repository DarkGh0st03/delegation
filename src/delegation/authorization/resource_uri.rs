use regex::Regex;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt::{Display, Formatter};
use std::sync::OnceLock;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ResourceUri(String);

impl ResourceUri {
    pub fn new(value: String) -> Result<Self, String> {
        if value.is_empty() {
            return Err(String::from("Resource URI cannot be empty"));
        }

        static URI_PATTERN: OnceLock<Regex> = OnceLock::new();
        let uri_pattern = URI_PATTERN.get_or_init(|| {
            Regex::new(
                r"^[A-Za-z][A-Za-z0-9+.-]*:[A-Za-z0-9._~:/?#[]@!$&'()*+,;=%-]+$",
            )
            .expect("resource URI regex must be valid")
        });

        if !uri_pattern.is_match(&value) || !Self::has_valid_percent_encoding(&value) {
            return Err(format!("Invalid absolute resource URI: {value}"));
        }

        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    fn has_valid_percent_encoding(value: &str) -> bool {
        let bytes = value.as_bytes();
        let mut i = 0;

        while i < bytes.len() {
            if bytes[i] == b'%' {
                if i + 2 >= bytes.len()
                    || !bytes[i + 1].is_ascii_hexdigit()
                    || !bytes[i + 2].is_ascii_hexdigit()
                {
                    return false;
                }
                i += 3;
            } else {
                i += 1;
            }
        }

        true
    }
}

impl Display for ResourceUri {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl Serialize for ResourceUri {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for ResourceUri {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::new(value).map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_absolute_resource_uris() {
        assert!(ResourceUri::new(String::from(
            "https://gitea.local/repos/project-a/branches/main"
        ))
        .is_ok());
        assert!(ResourceUri::new(String::from(
            "gitea://team/project-a/files/src/main.rs"
        ))
        .is_ok());
        assert!(ResourceUri::new(String::from("urn:delegation:project-a")).is_ok());
    }

    #[test]
    fn rejects_relative_or_malformed_resource_uris() {
        assert!(ResourceUri::new(String::from("project-a/src/main.rs")).is_err());
        assert!(ResourceUri::new(String::from(
            "https://gitea.local/repos/project a"
        ))
        .is_err());
        assert!(ResourceUri::new(String::from("gitea://project-a/%ZZ")).is_err());
    }

    #[test]
    fn serde_deserialization_reuses_validation() {
        let result = serde_json::from_str::<ResourceUri>(r#""relative/path""#);
        assert!(result.is_err());
    }
}
