use crate::auth::CallerRecord;
use crate::config::AdapterConfig;
use serde::Serialize;
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

#[derive(Serialize)]
struct HealthResponse<'a> {
    status: &'a str,
    service: &'a str,
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
    let server = Server::http(&config.bind_addr)
        .map_err(|err| format!("Could not bind Delegation Adapter at {} [{err}]", config.bind_addr))?;

    eprintln!("Delegation Adapter listening on {}", config.bind_addr);

    for request in server.incoming_requests() {
        handle_request(request, &config);
    }

    Ok(())
}

fn handle_request(request: Request, config: &AdapterConfig) {
    match (request.method(), request.url()) {
        (&Method::Get, "/health") => {
            respond_json(
                request,
                StatusCode(200),
                &HealthResponse {
                    status: "ok",
                    service: "delegation-adapter",
                },
            );
        }
        (&Method::Get, "/v1/whoami") => match authenticate(&request, config) {
            Ok(caller) => respond_json(
                request,
                StatusCode(200),
                &IdentityResponse {
                    role: caller.role(),
                    identity_id: caller.identity_id(),
                    capabilities: caller.capabilities(),
                },
            ),
            Err(error) => respond_error(request, StatusCode(401), &error),
        },
        _ => respond_error(request, StatusCode(404), "Not found"),
    }
}

fn authenticate<'a>(request: &Request, config: &'a AdapterConfig) -> Result<&'a CallerRecord, String> {
    let header = request
        .headers()
        .iter()
        .find(|header| header.field.equiv("Authorization"))
        .ok_or_else(|| String::from("Missing Authorization header"))?;

    let token = crate::auth::bearer_token(header.value.as_str())?;
    config.callers.authenticate(token)
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
