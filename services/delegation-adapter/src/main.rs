use delegation_adapter::config::AdapterConfig;

fn main() {
    if let Err(error) = run() {
        eprintln!("Delegation Adapter failed: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let config = AdapterConfig::from_env()?;
    delegation_adapter::http::run(config)
}
