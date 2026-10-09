use crate::auth::CallerRecord;
use crate::config::AdapterConfig;
use crate::crypto::{
    CreatePresentationRequest, CryptoRuntime, IssueChildRequest, IssueRootRequest,
    UpdateCredentialStatusRequest, VerifyPresentationRequest,
};
use serde::Serialize;
use serde::de::DeserializeOwned;
use std::io::Read;
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

const MAX_BODY_BYTES: u64 = 1024 * 1024;

#[derive(Serialize)]
struct HealthResponse<'a> {
    status: &'a str,
    service: &'a str,
    trust_profile: &'a str,
}

#[derive(Serialize)]
struct IdentityResponse<'a> {
    role: crate::auth::CallerRole,
    identity_id: &'a str,
    capabilities: &'a [crate::auth::CallerCapability],
}

#[derive(Serialize)]
struct ErrorResponse<'a> {
    error: &'a str,
}

pub fn run(config: AdapterConfig) -> Result<(), String> {
    let server = Server::http(&config.bind_addr).map_err(|err| {
        format!(
            "Could not bind Delegation Adapter at {} [{err}]",
            config.bind_addr
        )
    })?;
    let mut crypto = CryptoRuntime::from_config(&config)?;

    eprintln!("Delegation Adapter listening on {}", config.bind_addr);

    for request in server.incoming_requests() {
        handle_request(request, &config, &mut crypto);
    }

    Ok(())
}

fn handle_request(mut request: Request, config: &AdapterConfig, crypto: &mut CryptoRuntime) {
    let method = request.method().clone();
    let url = request.url().to_string();

    if method == Method::Get && url == "/health" {
        respond_json(
            request,
            StatusCode(200),
            &HealthResponse {
                status: "ok",
                service: "delegation-adapter",
                trust_profile: config.trust_profile.as_str(),
            },
        );
        return;
    }

    let caller = match authenticate(&request, config) {
        Ok(caller) => caller.clone(),
        Err(error) => {
            respond_error(request, StatusCode(401), &error);
            return;
        }
    };

    match (method, url.as_str()) {
        (Method::Get, "/v1/whoami") => respond_json(
            request,
            StatusCode(200),
            &IdentityResponse {
                role: caller.role(),
                identity_id: caller.identity_id(),
                capabilities: caller.capabilities(),
            },
        ),
        (Method::Post, "/v1/credentials/root") => {
            let body = match read_json::<IssueRootRequest>(&mut request) {
                Ok(body) => body,
                Err(error) => {
                    respond_error(request, StatusCode(400), &error);
                    return;
                }
            };
            match crypto.issue_root(&caller, &config.callers, body) {
                Ok(credential) => respond_json(request, StatusCode(201), &credential),
                Err(error) => respond_error(request, StatusCode(400), &error),
            }
        }
        (Method::Post, "/v1/credentials/child") => {
            let body = match read_json::<IssueChildRequest>(&mut request) {
                Ok(body) => body,
                Err(error) => {
                    respond_error(request, StatusCode(400), &error);
                    return;
                }
            };
            match crypto.issue_child(&caller, &config.callers, body) {
                Ok(credential) => respond_json(request, StatusCode(201), &credential),
                Err(error) => respond_error(request, StatusCode(400), &error),
            }
        }
        (Method::Post, "/v1/credentials/status") => {
            let body = match read_json::<UpdateCredentialStatusRequest>(&mut request) {
                Ok(body) => body,
                Err(error) => {
                    respond_error(request, StatusCode(400), &error);
                    return;
                }
            };
            match crypto.update_credential_status(&caller, body) {
                Ok(status) => respond_json(request, StatusCode(200), &status),
                Err(error) => respond_error(request, StatusCode(400), &error),
            }
        }
        (Method::Post, "/v1/presentations") => {
            let body = match read_json::<CreatePresentationRequest>(&mut request) {
                Ok(body) => body,
                Err(error) => {
                    respond_error(request, StatusCode(400), &error);
                    return;
                }
            };
            match crypto.create_presentation(&caller, body) {
                Ok(presentation) => respond_json(request, StatusCode(200), &presentation),
                Err(error) => respond_error(request, StatusCode(400), &error),
            }
        }
        (Method::Post, "/v1/verify") => {
            let body = match read_json::<VerifyPresentationRequest>(&mut request) {
                Ok(body) => body,
                Err(error) => {
                    respond_error(request, StatusCode(400), &error);
                    return;
                }
            };
            match crypto.verify_presentation(&caller, &config.callers, body) {
                Ok(verified) => respond_json(request, StatusCode(200), &verified),
                Err(error) => respond_error(request, StatusCode(400), &error),
            }
        }
        _ => respond_error(request, StatusCode(404), "Not found"),
    }
}

fn authenticate<'a>(
    request: &Request,
    config: &'a AdapterConfig,
) -> Result<&'a CallerRecord, String> {
    let header = request
        .headers()
        .iter()
        .find(|header| header.field.equiv("Authorization"))
        .ok_or_else(|| String::from("Missing Authorization header"))?;

    let token = crate::auth::bearer_token(header.value.as_str())?;
    config.callers.authenticate(token)
}

fn read_json<T: DeserializeOwned>(request: &mut Request) -> Result<T, String> {
    let mut body = String::new();
    let mut reader = request.as_reader().take(MAX_BODY_BYTES + 1);
    reader
        .read_to_string(&mut body)
        .map_err(|err| format!("Could not read request body [{err}]"))?;

    if body.len() as u64 > MAX_BODY_BYTES {
        return Err(String::from("Request body exceeds 1 MiB"));
    }

    serde_json::from_str(&body).map_err(|err| format!("Invalid JSON request [{err}]"))
}

fn json_header() -> Header {
    Header::from_bytes("Content-Type", "application/json")
        .expect("static JSON content-type must be valid")
}

fn respond_json<T: Serialize>(request: Request, status: StatusCode, value: &T) {
    let body = match serde_json::to_string(value) {
        Ok(body) => body,
        Err(error) => {
            let fallback = format!(r#"{{"error":"serialization failure: {error}"}}"#);
            let response = Response::from_string(fallback)
                .with_status_code(StatusCode(500))
                .with_header(json_header());
            let _ = request.respond(response);
            return;
        }
    };

    let response = Response::from_string(body)
        .with_status_code(status)
        .with_header(json_header());
    let _ = request.respond(response);
}

fn respond_error(request: Request, status: StatusCode, error: &str) {
    respond_json(request, status, &ErrorResponse { error });
}
