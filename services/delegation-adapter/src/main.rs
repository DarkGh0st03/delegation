use delegation_adapter::config::AdapterConfig;

fn main() {
    if let Err(error) = run() {
        eprintln!("Delegation Adapter failed: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    // Canonical deployment owns the ONE Rust CryptoRuntime inside the trusted
    // Software Engineer process. Starting this old HTTP Adapter would create
    // another issuer with unrelated private keys/status and invalid Child DC
    // parent lookup. Refuse the competing process BEFORE EVM initialization.
    if std::env::var("ENGINEER_CORE_NATIVE_MODE").as_deref() == Ok("1") {
        return Err(String::from(
            "Legacy Adapter HTTP cannot start with direct Engineer Core enabled",
        ));
    }
    let config = AdapterConfig::from_env()?;
    delegation_adapter::http::run(config)
}
