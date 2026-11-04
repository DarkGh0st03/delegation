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
            "issue_root" if caller.role() == CallerRole::Engineer => serde_json::from_value::<IssueRootRequest>(req.body)
                .map_err(|_| String::from("invalid request"))
                .and_then(|input| crypto.issue_root(caller, &config.callers, input))
                .and_then(|issued| {
                    serde_json::to_value(issued)
                        .map_err(|_| String::from("serialization unavailable"))
                }),
            "revoke_root" if caller.role() == CallerRole::Engineer => serde_json::from_value::<UpdateCredentialStatusRequest>(req.body)
                .map_err(|_| String::from("invalid request"))
                .and_then(|input| {
                    if !input.status_set {
                        return Err(String::from("root revocation cannot be cleared"));
                    }
                    crypto.update_credential_status(caller, input)
                })
                .and_then(|receipt| {
                    serde_json::to_value(receipt)
                        .map_err(|_| String::from("serialization unavailable"))
                }),
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
