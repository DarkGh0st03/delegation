use delegation_adapter::{IdentityBindings, app};
use std::{env, net::SocketAddr};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let bindings = IdentityBindings::from_env()
        .map_err(|err| format!("Delegation Adapter configuration error: {err}"))?;

    let bind = env::var("DELEGATION_ADAPTER_BIND")
        .unwrap_or_else(|_| String::from("0.0.0.0:8090"))
        .parse::<SocketAddr>()?;

    let listener = tokio::net::TcpListener::bind(bind).await?;
    println!("delegation-adapter listening on {bind}");
    axum::serve(listener, app(bindings)).await?;
    Ok(())
}
