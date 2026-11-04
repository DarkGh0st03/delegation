//! R201: trusted LOCAL Rust cryptography for Engineer and signed A2A Tasks.
//!
//! The same process-local CryptoRuntime holds root and child credential objects,
//! issuer accumulators, EVM status anchors and private signing material. The
//! optional Unix listener does NOT create another issuer or another authority.
//! It is NOT an MCP endpoint, HTTP endpoint, ADK tool or an agent capability.
//! CallerRegistry checks role and Core Rust capabilities for every operation.
//! The Unix socket is NOT MCP, A2A, a model tool or a public interface.
//!
//! The socket pathname is provisioned by the trusted owner; 0600 on Unix.
//! One bounded request per connection; keys never leave Rust. Signed VPs
//! return only to authenticated trusted local callers.

use crate::auth::CallerRole;
use crate::config::AdapterConfig;
use crate::crypto::{
    CreatePresentationRequest, CryptoRuntime, IssueChildRequest, IssueRootRequest,
    UpdateCredentialStatusRequest,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::fs::{self, Permissions};
use std::io::{Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::time::Duration;

const MAX_REQUEST: u64 = 128 * 1024;
const MAX_RESPONSE: usize = 1024 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EngineerRequest {
    token: String,
    operation: String,
    body: Value,
}

pub struct NativeEngineerSocket {
    listener: UnixListener,
    path: PathBuf,
}

impl NativeEngineerSocket {
    pub fn bind(raw: &str) -> Result<Self, String> {
        let path = PathBuf::from(raw);
        if !path.is_absolute()
            || raw.trim() != raw
            || raw.contains('\0')
            || path.as_os_str().len() > 100
        {
            return Err(String::from("Invalid trusted Engineer native socket path"));
        }
        // Never unlink an existing path: stale sockets and preplaced symlinks
        // must be operator-reconciled, not silently clobbered.
        if fs::symlink_metadata(&path).is_ok() {
            return Err(String::from(
                "Trusted Engineer native socket path already exists",
            ));
        }
        let listener = UnixListener::bind(&path)
            .map_err(|_| String::from("Could not bind trusted Engineer native socket"))?;
        let socket = Self { listener, path };
        fs::set_permissions(&socket.path, Permissions::from_mode(0o600))
            .map_err(|_| String::from("Could not protect trusted Engineer native socket"))?;
        socket
            .listener
            .set_nonblocking(true)
            .map_err(|_| String::from("Could not configure Engineer native socket"))?;
        Ok(socket)
    }

    pub fn poll(&self, config: &AdapterConfig, crypto: &mut CryptoRuntime) -> Result<(), String> {
        match self.listener.accept() {
            Ok((mut stream, _)) => {
                Self::handle(&mut stream, config, crypto);
                Ok(())
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => Ok(()),
            Err(_) => Err(String::from("Trusted Engineer native socket unavailable")),
        }
    }

    fn handle(stream: &mut UnixStream, config: &AdapterConfig, crypto: &mut CryptoRuntime) {
        let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
        let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));
        let mut bytes = Vec::new();
        let read = stream.take(MAX_REQUEST + 1).read_to_end(&mut bytes);
        let answer = match read {
            Ok(_) if !bytes.is_empty() && bytes.len() as u64 <= MAX_REQUEST => {
                match serde_json::from_slice::<EngineerRequest>(&bytes) {
                    Ok(req) => Self::dispatch(req, config, crypto),
                    Err(_) => json!({"ok":false,"error":"engineer_native_invalid_request"}),
                }
            }
            _ => json!({"ok":false,"error":"engineer_native_invalid_request"}),
        };
        let data = serde_json::to_vec(&answer).unwrap_or_else(|_| {
            b"{\"ok\":false,\"error\":\"engineer_native_unavailable\"}".to_vec()
        });
        if data.len() <= MAX_RESPONSE {
            let _ = stream.write_all(&data);
        }
    }

    fn dispatch(req: EngineerRequest, config: &AdapterConfig, crypto: &mut CryptoRuntime) -> Value {
        // Never accept authority from request fields, MCP claims or model output.
        let caller = match config.callers.authenticate(&req.token) {
            Ok(caller) => caller,
            _ => return json!({"ok":false,"error":"engineer_native_denied"}),
        };
        let outcome = match req.operation.as_str() {
            "issue_root" if caller.role() == CallerRole::Engineer => serde_json::from_value::<
                IssueRootRequest,
            >(req.body)
            .map_err(|_| String::from("invalid request"))
            .and_then(|input| crypto.issue_root(caller, &config.callers, input))
            .and_then(|issued| {
                serde_json::to_value(issued).map_err(|_| String::from("serialization unavailable"))
            }),
            "revoke_root" if caller.role() == CallerRole::Engineer => serde_json::from_value::<
                UpdateCredentialStatusRequest,
            >(req.body)
            .map_err(|_| String::from("invalid request"))
            .and_then(|input| {
                if !input.status_set {
                    return Err(String::from("root revocation cannot be cleared"));
                }
                crypto.update_credential_status(caller, input)
            })
            .and_then(|receipt| {
                serde_json::to_value(receipt).map_err(|_| String::from("serialization unavailable"))
            }),
            "issue_child" if caller.role() == CallerRole::Orchestrator => serde_json::from_value::<
                IssueChildRequest,
            >(req.body)
            .map_err(|_| String::from("invalid request"))
            .and_then(|input| crypto.issue_child(caller, &config.callers, input))
            .and_then(|issued| {
                serde_json::to_value(issued).map_err(|_| String::from("serialization unavailable"))
            }),
            "create_presentation"
                if matches!(
                    caller.role(),
                    CallerRole::Orchestrator
                        | CallerRole::Backend
                        | CallerRole::Frontend
                        | CallerRole::Test
                ) =>
            {
                serde_json::from_value::<CreatePresentationRequest>(req.body)
                    .map_err(|_| String::from("invalid request"))
                    .and_then(|input| crypto.create_presentation(caller, input))
                    .and_then(|signed| {
                        serde_json::to_value(signed)
                            .map_err(|_| String::from("serialization unavailable"))
                    })
            }
            _ => return json!({"ok":false,"error":"engineer_native_denied"}),
        };
        match outcome {
            Ok(result) => json!({"ok":true,"result":result}),
            // Do not expose credential IDs, signing keys or Rust diagnostics.
            Err(_) => json!({"ok":false,"error":"engineer_native_denied"}),
        }
    }
}

impl Drop for NativeEngineerSocket {
    fn drop(&mut self) {
        // Only clean up the socket created by this process.
        let _ = fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_owner_crypto_reuses_one_runtime_for_root_child_and_presentation() {
        use crate::auth::{CallerCapability, CallerRecord, CallerRegistry};
        use crate::config::AdapterTrustProfile;
        use crate::crypto::VerifyPresentationRequest;
        use delegation::delegation::authorization::operation::Operation;
        use delegation::delegation::authorization::permission::Permission;
        use delegation::delegation::status::model::bitstring_status_list_entry::BitstringStatusListEntry;
        use delegation::delegation::status::model::status_purpose::StatusPurpose;

        let record = |role: CallerRole, token: &str, did: &str, grants| {
            CallerRecord::new(role, token.to_string(), did.to_string(), grants).unwrap()
        };
        let callers = CallerRegistry::new(vec![
            record(
                CallerRole::Engineer,
                "native-engineer",
                "did:thesis:engineer",
                vec![CallerCapability::IssueRoot, CallerCapability::ManageStatus],
            ),
            record(
                CallerRole::Orchestrator,
                "native-orchestrator",
                "did:thesis:orchestrator",
                vec![
                    CallerCapability::IssueChild,
                    CallerCapability::CreatePresentation,
                ],
            ),
            record(
                CallerRole::Backend,
                "native-backend",
                "did:thesis:backend",
                vec![CallerCapability::CreatePresentation],
            ),
            record(
                CallerRole::Gateway,
                "native-gateway",
                "did:thesis:gateway",
                vec![CallerCapability::VerifyPresentation],
            ),
        ])
        .unwrap();
        let config = AdapterConfig {
            bind_addr: "127.0.0.1:0".to_string(),
            callers,
            trust_profile: AdapterTrustProfile::InMemory,
            evm: None,
        };
        let mut crypto = CryptoRuntime::new(&config.callers).unwrap();
        let permission = Permission::new(
            "gitea://gitea.local/thesis/iam-console-poc".to_string(),
            Operation::ReadFile,
        )
        .unwrap();
        let status = |index: u64| {
            BitstringStatusListEntry::new(
                None,
                StatusPurpose::Revocation,
                index.to_string(),
                "https://status.example/lists/native-owner".to_string(),
            )
            .unwrap()
        };
        let send = |token: &str, operation: &str, body: Value, crypto: &mut CryptoRuntime| {
            NativeEngineerSocket::dispatch(
                EngineerRequest {
                    token: token.to_string(),
                    operation: operation.to_string(),
                    body,
                },
                &config,
                crypto,
            )
        };
        let root = json!({
            "credential_id":"urn:credential:native-root",
            "delegatee":"orchestrator",
            "valid_from":"2026-01-01T00:00:00Z",
            "validity_seconds":94608000,
            "credential_status":status(400),
            "permissions":[permission.clone()]
        });
        assert_eq!(
            send("native-backend", "issue_root", root.clone(), &mut crypto)["ok"],
            false
        );
        let root_result = send("native-engineer", "issue_root", root, &mut crypto);
        assert_eq!(root_result["ok"], true, "{root_result:?}");
        assert_eq!(root_result["result"]["id"], "urn:credential:native-root");

        let child = json!({
            "parent_credential_id":"urn:credential:native-root",
            "credential_id":"urn:credential:native-child",
            "delegatee":"backend",
            "valid_from":"2026-01-01T00:00:00Z",
            "validity_seconds":31536000,
            "credential_status":status(401),
            "permissions":[permission.clone()]
        });
        assert_eq!(
            send("native-engineer", "issue_child", child.clone(), &mut crypto)["ok"],
            false
        );
        let child_result = send("native-orchestrator", "issue_child", child, &mut crypto);
        assert_eq!(child_result["ok"], true, "{child_result:?}");
        assert_eq!(child_result["result"]["id"], "urn:credential:native-child");

        let request = json!({
            "credential_id":"urn:credential:native-child",
            "disclosed_permissions":[permission.clone()],
            "audience":"cloud-access-gateway",
            "challenge":"native-cryptographic-test-challenge"
        });
        assert_eq!(
            send(
                "native-engineer",
                "create_presentation",
                request.clone(),
                &mut crypto
            )["ok"],
            false
        );
        let issued_vp = send(
            "native-backend",
            "create_presentation",
            request,
            &mut crypto,
        );
        assert_eq!(issued_vp["ok"], true, "{issued_vp:?}");
        let signed_vp = issued_vp["result"]["signed_vp"]
            .as_str()
            .expect("native signed VP missing");
        assert!(!signed_vp.is_empty());

        let verified = crypto
            .verify_presentation(
                config.callers.record_for_role(CallerRole::Gateway).unwrap(),
                &config.callers,
                VerifyPresentationRequest {
                    presenter: CallerRole::Backend,
                    audience: "cloud-access-gateway".to_string(),
                    challenge: "native-cryptographic-test-challenge".to_string(),
                    required_permission: permission,
                    signed_vp: signed_vp.to_string(),
                },
            )
            .expect("Gateway's Rust verifier must accept the same native issuer");
        assert_eq!(verified.hierarchy_depth(), 1);
        assert_eq!(
            send(
                "forged-identity",
                "create_presentation",
                json!({}),
                &mut crypto
            )["ok"],
            false
        );
    }

    #[test]
    fn native_socket_never_removes_preexisting_path() {
        let directory =
            std::env::temp_dir().join(format!("delegation-r170-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("existing.sock");
        fs::write(&path, b"sentinel").unwrap();
        assert!(NativeEngineerSocket::bind(path.to_str().unwrap()).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"sentinel");
        fs::remove_file(path).unwrap();
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn native_socket_is_owner_only_and_is_removed_on_drop() {
        let dir =
            std::env::temp_dir().join(format!("delegation-r170-bound-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("engineer.sock");
        let service = NativeEngineerSocket::bind(path.to_str().unwrap()).unwrap();
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(NativeEngineerSocket::bind(path.to_str().unwrap()).is_err());
        drop(service);
        assert!(!path.exists());
        fs::remove_dir(dir).unwrap();
    }
}
