use crate::delegation::authorization::operation::Operation;
use crate::delegation::authorization::resource_uri::ResourceUri;
use serde::{Deserialize, Serialize};
use std::fmt::{Display, Formatter};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(deny_unknown_fields)]
pub struct Permission {
    resource: ResourceUri,
    operation: Operation,
}

impl Permission {
    pub fn new(resource: String, operation: Operation) -> Result<Self, String> {
        Ok(Self {
            resource: ResourceUri::new(resource)?,
            operation,
        })
    }

    pub fn resource(&self) -> &ResourceUri {
        &self.resource
    }

    pub fn operation(&self) -> &Operation {
        &self.operation
    }

    pub fn canonical_value(&self) -> String {
        let resource = self.resource.as_str();
        let operation = self.operation.as_str();

        format!(
            "v1:{}:{}:{}:{}",
            resource.len(),
            resource,
            operation.len(),
            operation
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
    fn permission_exposes_typed_components_and_canonical_value() -> Result<(), String> {
        let permission = Permission::new(
            String::from("https://gitea.local/repos/project-a"),
            Operation::UpdateFile,
        )?;

        assert_eq!(
            permission.resource().as_str(),
            "https://gitea.local/repos/project-a"
        );
        assert_eq!(permission.operation(), &Operation::UpdateFile);
        assert!(
            permission
                .canonical_value()
                .contains("https://gitea.local/repos/project-a")
        );
        assert!(permission.canonical_value().contains("update_file"));

        Ok(())
    }

    #[test]
    fn permission_rejects_invalid_resource_uri() {
        assert!(
            Permission::new(String::from("project-a/src/main.rs"), Operation::ReadFile).is_err()
        );
    }

    #[test]
    fn permission_json_remains_resource_plus_operation() -> Result<(), String> {
        let permission = Permission::new(
            String::from("https://gitea.local/repos/project-a"),
            Operation::CreateBranch,
        )?;

        let json = serde_json::to_value(permission).map_err(|err| err.to_string())?;

        assert_eq!(
            json["resource"],
            serde_json::Value::String(String::from("https://gitea.local/repos/project-a"))
        );
        assert_eq!(
            json["operation"],
            serde_json::Value::String(String::from("create_branch"))
        );

        Ok(())
    }
}
