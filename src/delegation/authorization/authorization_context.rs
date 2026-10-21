use crate::delegation::authorization::permission::Permission;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Verifier-side context for one atomic, all-or-nothing authorization attempt.
///
/// The Gateway must derive every required permission from the concrete protected
/// operation(s). Presenter, audience and one-time challenge remain bound to the
/// signed VP. Replay tracking belongs to the Gateway, not this value object.
///
/// A singleton retains the historical \`required_permission\` JSON shape. A
/// request with multiple requirements uses \`required_permissions\` instead.
/// Both fields at once, empty sets and duplicate permissions fail closed.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(try_from = "AuthorizationContextWire", into = "AuthorizationContextWire")]
pub struct AuthorizationContext {
    presenter_id: String,
    audience: String,
    challenge: String,
    required_permissions: Vec<Permission>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct AuthorizationContextWire {
    presenter_id: String,
    audience: String,
    challenge: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    required_permission: Option<Permission>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    required_permissions: Option<Vec<Permission>>,
}

impl TryFrom<AuthorizationContextWire> for AuthorizationContext {
    type Error = String;

    fn try_from(value: AuthorizationContextWire) -> Result<Self, Self::Error> {
        let permissions = match (value.required_permission, value.required_permissions) {
            (Some(permission), None) => vec![permission],
            (None, Some(permissions)) => permissions,
            (None, None) => {
                return Err(String::from(
                    "Authorization context must contain required_permission or required_permissions",
                ));
            }
            (Some(_), Some(_)) => {
                return Err(String::from(
                    "Authorization context cannot contain both permission fields",
                ));
            }
        };
        Self::new_multiple(
            value.presenter_id,
            value.audience,
            value.challenge,
            permissions,
        )
    }
}

impl From<AuthorizationContext> for AuthorizationContextWire {
    fn from(context: AuthorizationContext) -> Self {
        let AuthorizationContext {
            presenter_id,
            audience,
            challenge,
            required_permissions,
        } = context;
        if required_permissions.len() == 1 {
            let mut permissions = required_permissions.into_iter();
            Self {
                presenter_id,
                audience,
                challenge,
                required_permission: permissions.next(),
                required_permissions: None,
            }
        } else {
            Self {
                presenter_id,
                audience,
                challenge,
                required_permission: None,
                required_permissions: Some(required_permissions),
            }
        }
    }
}

impl AuthorizationContext {
    /// Backwards-compatible constructor for one required permission.
    pub fn new(
        presenter_id: String,
        audience: String,
        challenge: String,
        required_permission: Permission,
    ) -> Result<Self, String> {
        Self::new_multiple(presenter_id, audience, challenge, vec![required_permission])
    }

    /// Build an atomic request: every distinct permission must pass verification.
    /// Duplicate permissions are rejected rather than silently collapsed.
    pub fn new_multiple(
        presenter_id: String,
        audience: String,
        challenge: String,
        required_permissions: Vec<Permission>,
    ) -> Result<Self, String> {
        if presenter_id.trim().is_empty() {
            return Err(String::from("Presenter id cannot be empty"));
        }
        if audience.trim().is_empty() {
            return Err(String::from(
                "Authorization context audience cannot be empty",
            ));
        }
        if challenge.trim().is_empty() {
            return Err(String::from(
                "Authorization context challenge cannot be empty",
            ));
        }
        if required_permissions.is_empty() {
            return Err(String::from(
                "Authorization context requires at least one permission",
            ));
        }
        // Bound untrusted requests before the verifier performs public-key work.
        const MAX_REQUIRED_PERMISSIONS: usize = 128;
        if required_permissions.len() > MAX_REQUIRED_PERMISSIONS {
            return Err(format!(
                "Authorization context exceeds {MAX_REQUIRED_PERMISSIONS} required permissions"
            ));
        }
        let mut seen = HashSet::with_capacity(required_permissions.len());
        if required_permissions
            .iter()
            .any(|permission| !seen.insert(permission))
        {
            return Err(String::from(
                "Authorization context contains duplicate required permissions",
            ));
        }

        Ok(Self {
            presenter_id,
            audience,
            challenge,
            required_permissions,
        })
    }

    pub fn presenter_id(&self) -> &String {
        &self.presenter_id
    }

    pub fn audience(&self) -> &String {
        &self.audience
    }

    pub fn challenge(&self) -> &String {
        &self.challenge
    }

    /// Historical accessor for callers expecting one permission.
    /// New multipermission verification MUST use \`required_permissions()\`.
    pub fn required_permission(&self) -> &Permission {
        &self.required_permissions[0]
    }

    pub fn required_permissions(&self) -> &[Permission] {
        &self.required_permissions
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::delegation::authorization::operation::Operation;
    use serde_json::{json, Value};

    fn permission(operation: Operation) -> Permission {
        Permission::new(
            String::from("https://gitea.local/repos/project-a"),
            operation,
        )
        .expect("test permission must be valid")
    }

    fn single() -> AuthorizationContext {
        AuthorizationContext::new(
            String::from("agent-1"),
            String::from("cloud-access-gateway"),
            String::from("challenge-1"),
            permission(Operation::ReadFile),
        )
        .expect("valid singleton")
    }

    #[test]
    fn authorization_context_requires_binding_values() {
        assert!(
            AuthorizationContext::new(
                String::new(),
                String::from("cloud-access-gateway"),
                String::from("challenge-1"),
                permission(Operation::ReadFile),
            )
            .is_err()
        );
        assert!(
            AuthorizationContext::new(
                String::from("agent-1"),
                String::new(),
                String::from("challenge-1"),
                permission(Operation::ReadFile),
            )
            .is_err()
        );
        assert!(
            AuthorizationContext::new(
                String::from("agent-1"),
                String::from("cloud-access-gateway"),
                String::new(),
                permission(Operation::ReadFile),
            )
            .is_err()
        );
    }

    #[test]
    fn singleton_keeps_existing_wire_format_and_getter() -> Result<(), String> {
        let original = single();
        let value = serde_json::to_value(&original).map_err(|err| err.to_string())?;
        assert_eq!(value["required_permission"]["operation"], "read_file");
        assert!(value.get("required_permissions").is_none());
        assert_eq!(original.required_permission(), &permission(Operation::ReadFile));
        assert_eq!(original.required_permissions().len(), 1);
        let parsed: AuthorizationContext =
            serde_json::from_value(value).map_err(|err| err.to_string())?;
        assert_eq!(parsed, original);
        Ok(())
    }

    #[test]
    fn multiple_permissions_use_explicit_plural_wire_format() -> Result<(), String> {
        let context = AuthorizationContext::new_multiple(
            String::from("agent-1"),
            String::from("cloud-access-gateway"),
            String::from("challenge-1"),
            vec![permission(Operation::ReadFile), permission(Operation::UpdateFile)],
        )?;
        let value = serde_json::to_value(&context).map_err(|err| err.to_string())?;
        assert!(value.get("required_permission").is_none());
        assert_eq!(value["required_permissions"].as_array().map(Vec::len), Some(2));
        let parsed: AuthorizationContext =
            serde_json::from_value(value).map_err(|err| err.to_string())?;
        assert_eq!(parsed, context);
        Ok(())
    }

    #[test]
    fn rejects_empty_duplicate_and_oversized_permission_sets() {
        let create = |permissions| {
            AuthorizationContext::new_multiple(
                String::from("agent-1"),
                String::from("cloud-access-gateway"),
                String::from("challenge-1"),
                permissions,
            )
        };
        assert!(create(vec![]).is_err());
        assert!(create(vec![
            permission(Operation::ReadFile),
            permission(Operation::ReadFile)
        ]).is_err());
        let many: Vec<Permission> = (0..129)
            .map(|n| Permission::new(
                format!("https://gitea.local/repos/project-a/files/{n}"),
                Operation::ReadFile
            ).expect("valid URI"))
            .collect();
        assert!(create(many).is_err());
    }

    #[test]
    fn rejects_ambiguous_or_invalid_json_shapes() {
        let p = serde_json::to_value(permission(Operation::ReadFile)).unwrap();
        let base = json!({
            "presenter_id": "agent-1",
            "audience": "cloud-access-gateway",
            "challenge": "challenge-1",
        });
        let mut invalid: Vec<Value> = vec![];
        let mut both = base.clone();
        both["required_permission"] = p.clone();
        both["required_permissions"] = json!([p.clone()]);
        invalid.push(both);
        let mut empty = base.clone();
        empty["required_permissions"] = json!([]);
        invalid.push(empty);
        invalid.push(base.clone());
        let mut duplicate = base.clone();
        duplicate["required_permissions"] = json!([p.clone(), p.clone()]);
        invalid.push(duplicate);
        let mut unknown = base;
        unknown["required_permission"] = p;
        unknown["injected_field"] = json!(true);
        invalid.push(unknown);
        for input in invalid {
            assert!(
                serde_json::from_value::<AuthorizationContext>(input).is_err(),
                "invalid authorization must fail closed"
            );
        }
    }
}
