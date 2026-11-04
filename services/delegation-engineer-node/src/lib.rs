//! Direct, in-process Software Engineer -> Rust Core cryptography binding.
//!
//! R225: this Node-API addon OWNS the one CryptoRuntime in the trusted
//! Software Engineer process. It does not call an Adapter HTTP service, a
//! Unix socket or MCP to issue/revoke root Delegation Credentials.
//!
//! CryptoRuntime is intentionally !Send (Rc-backed trust and issuer state).
//! It is constructed and operated on ONE dedicated Rust thread inside this
//! Node process. N-API AsyncTask sends an in-process typed command to that
//! thread, not to a separate process. The SAME thread polls the authenticated
//! Unix listener for Orchestrator child DCs and specialist VPs. There is no
//! second issuer, key material cache or status registry.
//!
//! The native addon must never be loaded by an A2A Agent or the Gateway.
//! They cannot access the Engineer-only functions or bearer.

#![cfg(unix)]

use delegation_adapter::auth::CallerRole;
use delegation_adapter::config::AdapterConfig;
use delegation_adapter::crypto::{
    CryptoRuntime, IssueRootRequest, UpdateCredentialStatusRequest,
};
use delegation_adapter::engineer_native::NativeEngineerSocket;
use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Error, Result, Status, Task};
use napi_derive::napi;
use std::env;
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;

const MAX_INPUT_BYTES: usize = 128 * 1024;
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
const OWNER_START_TIMEOUT: Duration = Duration::from_secs(90);
const OWNER_OPERATION_TIMEOUT: Duration = Duration::from_secs(90);
const DENIED: &str = "Native Engineer Core operation denied";

static START_LOCK: Mutex<()> = Mutex::new(());
static OWNER: OnceLock<Sender<OwnerCommand>> = OnceLock::new();

#[derive(Clone, Copy)]
enum OwnerOperation {
    IssueRoot,
    RevokeRoot,
}

struct OwnerCommand {
    token: String,
    operation: OwnerOperation,
    input_json: String,
    reply: Sender<std::result::Result<String, ()>>,
}

fn denied() -> Error {
    Error::new(Status::GenericFailure, DENIED.to_owned())
}

/// This authorization is independent of the JS layer: no Task/Agent token
/// may call root issuance or undo an approved Engineer-only revocation.
fn handle_owner_command(
    config: &AdapterConfig,
    crypto: &mut CryptoRuntime,
    request: OwnerCommand,
) {
    let output = (|| -> std::result::Result<String, ()> {
        let caller = config.callers.authenticate(&request.token).map_err(|_| ())?;
        if caller.role() != CallerRole::Engineer {
            return Err(());
        }
        match request.operation {
            OwnerOperation::IssueRoot => {
                let input: IssueRootRequest =
                    serde_json::from_str(&request.input_json).map_err(|_| ())?;
                let issued = crypto.issue_root(caller, &config.callers, input).map_err(|_| ())?;
                serde_json::to_string(&issued).map_err(|_| ())
            }
            OwnerOperation::RevokeRoot => {
                let input: UpdateCredentialStatusRequest =
                    serde_json::from_str(&request.input_json).map_err(|_| ())?;
                if !input.status_set {
                    return Err(());
                }
                let receipt = crypto.update_credential_status(caller, input).map_err(|_| ())?;
                serde_json::to_string(&receipt).map_err(|_| ())
            }
        }
    })();
    // Never expose source errors, bearer tokens, keys or credential material.
    let output = output.and_then(|s| {
        if s.len() > MAX_RESPONSE_BYTES {
            Err(())
        } else {
            Ok(s)
        }
    });
    let _ = request.reply.send(output);
}

/// The owner thread is the ONLY creator of CryptoRuntime. Binding the socket
/// before EVM initialization prevents an accidentally duplicated owner from
/// publishing new issuer state when another canonical runtime already lives.
fn run_owned_runtime(
    config: AdapterConfig,
    socket_path: String,
    rx: Receiver<OwnerCommand>,
    ready: Sender<std::result::Result<(), ()>>,
) {
    let listener = match NativeEngineerSocket::bind(&socket_path) {
        Ok(value) => value,
        Err(_) => {
            let _ = ready.send(Err(()));
            return;
        }
    };
    let mut crypto = match CryptoRuntime::from_config(&config) {
        Ok(value) => value,
        Err(_) => {
            let _ = ready.send(Err(()));
            return;
        }
    };
    if ready.send(Ok(())).is_err() {
        return;
    }
    loop {
        // A bounded batch prevents a busy Engineer UI from starving agent VP
        // requests. No Rc-backed Rust state crosses thread boundaries.
        for _ in 0..16 {
            match rx.try_recv() {
                Ok(command) => handle_owner_command(&config, &mut crypto, command),
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => return,
            }
        }
        // The same runtime handles only Orchestrator/Agent commands here;
        // root operations arrive solely over the native Engineer API above.
        if listener.poll(&config, &mut crypto).is_err() {
            return;
        }
        thread::sleep(Duration::from_millis(10));
    }
}

/// Startup is explicit, one-use, and fail-closed. Never activate an implicit
/// HTTP Adapter or an independent second CryptoRuntime. An existing socket
/// pathname prevents accidental duplicate owner processes from starting.
#[napi(js_name = "start_engineer_core")]
pub fn start_engineer_core() -> Result<()> {
    let _guard = START_LOCK.lock().map_err(|_| denied())?;
    if OWNER.get().is_some() {
        return Err(denied());
    }
    let socket_path = env::var("ADAPTER_ENGINEER_NATIVE_SOCKET").map_err(|_| denied())?;
    if socket_path.is_empty() {
        return Err(denied());
    }
    let config = AdapterConfig::from_env().map_err(|_| denied())?;
    let (tx, rx) = mpsc::channel::<OwnerCommand>();
    let (ready_tx, ready_rx) = mpsc::channel();
    thread::Builder::new()
        .name("delegation-trusted-rust-issuer".to_owned())
        .spawn(move || run_owned_runtime(config, socket_path, rx, ready_tx))
        .map_err(|_| denied())?;
    match ready_rx.recv_timeout(OWNER_START_TIMEOUT) {
        Ok(Ok(())) => OWNER.set(tx).map_err(|_| denied()),
        _ => Err(denied()),
    }
}

pub struct EngineerCommandTask {
    token: String,
    operation: OwnerOperation,
    input_json: String,
}

impl Task for EngineerCommandTask {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> Result<Self::Output> {
        if self.token.is_empty() || self.input_json.len() > MAX_INPUT_BYTES {
            return Err(denied());
        }
        let tx = OWNER.get().ok_or_else(denied)?;
        let (reply_tx, reply_rx) = mpsc::channel();
        tx.send(OwnerCommand {
            token: std::mem::take(&mut self.token),
            operation: self.operation,
            input_json: std::mem::take(&mut self.input_json),
            reply: reply_tx,
        })
        .map_err(|_| denied())?;
        reply_rx
            .recv_timeout(OWNER_OPERATION_TIMEOUT)
            .map_err(|_| denied())?
            .map_err(|_| denied())
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// Real Rust Core issue_root, not an HTTP or Unix-socket call. The Engineer
/// host must bind approved permissions and review signature BEFORE invoking.
#[napi(js_name = "issue_engineer_root")]
pub fn issue_engineer_root(token: String, root_json: String) -> AsyncTask<EngineerCommandTask> {
    AsyncTask::new(EngineerCommandTask {
        token,
        operation: OwnerOperation::IssueRoot,
        input_json: root_json,
    })
}

/// Real Rust Core update_credential_status. Only status_set=true is admitted.
#[napi(js_name = "revoke_engineer_root")]
pub fn revoke_engineer_root(token: String, revocation_json: String) -> AsyncTask<EngineerCommandTask> {
    AsyncTask::new(EngineerCommandTask {
        token,
        operation: OwnerOperation::RevokeRoot,
        input_json: revocation_json,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_owner_command_is_not_a_remote_issuer() {
        assert_eq!(MAX_INPUT_BYTES, 128 * 1024);
        assert!(OWNER.get().is_none());
    }

    #[test]
    fn root_and_revocation_are_only_native_engineer_operations() {
        // These two explicit variants are intentionally not issue_child or VP.
        assert!(matches!(OwnerOperation::IssueRoot, OwnerOperation::IssueRoot));
        assert!(matches!(OwnerOperation::RevokeRoot, OwnerOperation::RevokeRoot));
    }
}
