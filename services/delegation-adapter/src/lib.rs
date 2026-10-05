use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode, header::AUTHORIZATION},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, env, sync::Arc};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CallerRole {
    Engineer,
    Gateway,
    Orchestrator,
    Backend,
    Frontend,
    Test,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Capability {
    IssueRoot,
    IssueChild,
    Present,
    Verify,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CallerBinding {
    pub role: CallerRole,
    pub identity_id: String,
    pub capabilities: Vec<Capability>,
}

#[derive(Clone)]
pub struct IdentityBindings {
    by_token_digest: HashMap<[u8; 32], CallerBinding>,
}

impl IdentityBindings {
    pub fn new(entries: Vec<(String, CallerBinding)>) -> Result<Self, String> {
        if entries.is_empty() {
            return Err(String::from("At least one Adapter caller binding is required"));
        }

        let mut by_token_digest = HashMap::new();
        for (token, binding) in entries {
            if token.trim().is_empty() {
                return Err(format!("Empty service token for {:?}", binding.role));
            }
            if binding.identity_id.trim().is_empty() {
                return Err(format!("Empty identity id for {:?}", binding.role));
            }

            let digest = token_digest(&token);
            if by_token_digest.insert(digest, binding).is_some() {
                return Err(String::from("Duplicate Adapter service token"));
            }
        }

        Ok(Self { by_token_digest })
    }

    pub fn from_env() -> Result<Self, String> {
        let bindings = vec![
            env_binding(
                "ADAPTER_CALLER_ENGINEER",
                "ADAPTER_ID_ENGINEER",
                CallerRole::Engineer,
                vec![Capability::IssueRoot],
            )?,
            env_binding(
                "ADAPTER_CALLER_GATEWAY",
                "ADAPTER_ID_GATEWAY",
                CallerRole::Gateway,
                vec![Capability::Verify],
            )?,
            env_binding(
                "ADAPTER_CALLER_ORCHESTRATOR",
                "ADAPTER_ID_ORCHESTRATOR",
                CallerRole::Orchestrator,
                vec![Capability::IssueChild, Capability::Present],
            )?,
            env_binding(
                "ADAPTER_CALLER_BACKEND",
                "ADAPTER_ID_BACKEND",
                CallerRole::Backend,
                vec![Capability::Present],
            )?,
            env_binding(
                "ADAPTER_CALLER_FRONTEND",
                "ADAPTER_ID_FRONTEND",
                CallerRole::Frontend,
                vec![Capability::Present],
            )?,
            env_binding(
                "ADAPTER_CALLER_TEST",
                "ADAPTER_ID_TEST",
                CallerRole::Test,
                vec![Capability::Present],
            )?,
        ];

        Self::new(bindings)
    }

    pub fn authenticate(&self, headers: &HeaderMap) -> Result<CallerBinding, ApiError> {
        let raw = headers
            .get(AUTHORIZATION)
            .ok_or_else(|| ApiError::unauthorized("Missing Authorization header"))?
            .to_str()
            .map_err(|_| ApiError::unauthorized("Invalid Authorization header"))?;

        let token = raw
            .strip_prefix("Bearer ")
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| ApiError::unauthorized("Expected Bearer service token"))?;

        self.by_token_digest
            .get(&token_digest(token))
            .cloned()
            .ok_or_else(|| ApiError::unauthorized("Unknown Adapter caller"))
    }
}

fn env_binding(
    token_var: &str,
    identity_var: &str,
    role: CallerRole,
    capabilities: Vec<Capability>,
) -> Result<(String, CallerBinding), String> {
    let token = env::var(token_var).map_err(|_| format!("Missing {token_var}"))?;
    let identity_id = env::var(identity_var).map_err(|_| format!("Missing {identity_var}"))?;

    Ok((
        token,
        CallerBinding {
            role,
            identity_id,
            capabilities,
        },
    ))
}

fn token_digest(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

#[derive(Clone)]
pub struct AppState {
    pub bindings: Arc<IdentityBindings>,
}

pub fn app(bindings: IdentityBindings) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/v1/whoami", get(whoami))
        .with_state(AppState {
            bindings: Arc::new(bindings),
        })
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
    phase: &'static str,
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "delegation-adapter",
        phase: "2a",
    })
}

#[derive(Serialize)]
struct WhoAmIResponse {
    role: CallerRole,
    identity_id: String,
    capabilities: Vec<Capability>,
}

async fn whoami(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<WhoAmIResponse>, ApiError> {
    let binding = state.bindings.authenticate(&headers)?;

    Ok(Json(WhoAmIResponse {
        role: binding.role,
        identity_id: binding.identity_id,
        capabilities: binding.capabilities,
    }))
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    error: String,
}

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn unauthorized(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(ErrorBody { error: self.message })).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    fn test_bindings() -> IdentityBindings {
        IdentityBindings::new(vec![
            (
                String::from("engineer-secret"),
                CallerBinding {
                    role: CallerRole::Engineer,
                    identity_id: String::from("did:example:engineer"),
                    capabilities: vec![Capability::IssueRoot],
                },
            ),
            (
                String::from("gateway-secret"),
                CallerBinding {
                    role: CallerRole::Gateway,
                    identity_id: String::from("urn:thesis:service:gateway"),
                    capabilities: vec![Capability::Verify],
                },
            ),
            (
                String::from("orchestrator-secret"),
                CallerBinding {
                    role: CallerRole::Orchestrator,
                    identity_id: String::from("did:example:orchestrator"),
                    capabilities: vec![Capability::IssueChild, Capability::Present],
                },
            ),
            (
                String::from("backend-secret"),
                CallerBinding {
                    role: CallerRole::Backend,
                    identity_id: String::from("did:example:backend"),
                    capabilities: vec![Capability::Present],
                },
            ),
        ])
        .expect("test bindings")
    }

    #[test]
    fn rejects_duplicate_service_tokens() {
        let result = IdentityBindings::new(vec![
            (
                String::from("same"),
                CallerBinding {
                    role: CallerRole::Backend,
                    identity_id: String::from("did:example:backend"),
                    capabilities: vec![Capability::Present],
                },
            ),
            (
                String::from("same"),
                CallerBinding {
                    role: CallerRole::Frontend,
                    identity_id: String::from("did:example:frontend"),
                    capabilities: vec![Capability::Present],
                },
            ),
        ]);

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn health_is_public() {
        let response = app(test_bindings())
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn protected_endpoint_rejects_missing_or_unknown_token() {
        let router = app(test_bindings());

        let missing = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/v1/whoami")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing.status(), StatusCode::UNAUTHORIZED);

        let unknown = router
            .oneshot(
                Request::builder()
                    .uri("/v1/whoami")
                    .header(AUTHORIZATION, "Bearer attacker")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(unknown.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn caller_identity_is_derived_from_service_token() {
        let response = app(test_bindings())
            .oneshot(
                Request::builder()
                    .uri("/v1/whoami")
                    .header(AUTHORIZATION, "Bearer backend-secret")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

        assert_eq!(value["role"], "backend");
        assert_eq!(value["identity_id"], "did:example:backend");
        assert_eq!(value["capabilities"][0], "present");
    }
}
