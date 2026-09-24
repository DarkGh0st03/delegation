use serde::{Deserialize, Serialize};
use std::fmt::{Display, Formatter};

/// A delegated authorization claim made of a resource and an operation.
///
/// The current thesis baseline treats a permission as an exact pair:
/// the child delegation may only re-delegate a permission it already owns.
/// Resource-hierarchy attenuation (for example repository -> subdirectory)
/// is intentionally left for a later extension.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct Permission {
    resource: String,
    operation: String,
}

impl Permission {
    /// Creates a permission after checking that both components are non-empty.
    pub fn new(resource: String, operation: String) -> Result<Self, String> {
        if resource.trim().is_empty() {
            return Err(String::from("Permission resource cannot be empty"));
        }

        if operation.trim().is_empty() {
            return Err(String::from("Permission operation cannot be empty"));
        }

        Ok(Self {
            resource,
            operation,
        })
    }

    /// Returns the resource identifier, expected to be represented as a URI in the thesis PoC.
    pub fn resource(&self) -> &str {
        &self.resource
    }

    /// Returns the operation granted on the resource.
    pub fn operation(&self) -> &str {
        &self.operation
    }

    /// Returns the deterministic representation committed to the cryptographic accumulator.
    ///
    /// The resource byte length makes the representation unambiguous even if separator
    /// characters occur inside the URI. The version prefix leaves room for future changes.
    pub fn canonical_value(&self) -> String {
        format!(
            "v1:{}:{}:{}",
            self.resource.as_bytes().len(),
            self.resource,
            self.operation
        )
    }
}

impl Display for Permission {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}#{}", self.resource, self.operation)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_exposes_components_and_canonical_value() -> Result<(), String> {
        let permission = Permission::new(
            String::from("https://gitea.local/repos/project-a"),
            String::from("write_file"),
        )?;

        assert_eq!(permission.resource(), "https://gitea.local/repos/project-a");
        assert_eq!(permission.operation(), "write_file");
        assert!(permission
            .canonical_value()
            .contains("https://gitea.local/repos/project-a"));

        Ok(())
    }

    #[test]
    fn permission_rejects_empty_components() {
        assert!(Permission::new(String::new(), String::from("read_file")).is_err());
        assert!(
            Permission::new(
                String::from("https://gitea.local/repos/project-a"),
                String::new()
            )
            .is_err()
        );
    }
}
