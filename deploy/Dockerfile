# syntax=docker/dockerfile:1.7
#
# Images for the local Delegation deployment (see compose.yaml).
#
#   chain : Foundry (anvil/forge/cast) from the official release archive,
#           verified by SHA-256, plus the compiled trust contracts.
#   app   : Node runtime with the PoC sources, pinned npm dependencies and the
#           two native Rust addons (Engineer issuer, Gateway verifier).
#
# Optional corporate-proxy support for builds: pass a CA bundle as the build
# secret "extra_ca". Without it nothing changes.

# Full (non-slim) image: it ships OpenSSL 3, required by the native Rust addons.
ARG NODE_IMAGE=node:22.15.0-bookworm
ARG RUST_IMAGE=rust:1.99.0-bookworm
ARG CHAIN_BASE_IMAGE=buildpack-deps:bookworm-curl

# ---------------------------------------------------------------- chain ----
FROM ${CHAIN_BASE_IMAGE} AS chain
ARG FOUNDRY_VERSION=v1.8.4
ARG FOUNDRY_SHA256=699e2207a6a9b27ca17c48c81e56f1677ed9c58b623b59128b4e15ec9da0625e
# Solidity compiler pinned to blockchain/foundry.toml (0.8.24), official
# static build from the ethereum/solidity GitHub release.
ARG SOLC_VERSION=v0.8.24
ARG SOLC_SHA256=fb03a29a517452b9f12bcf459ef37d0a543765bb3bbc911e70a87d6a37c30d5f
RUN --mount=type=secret,id=extra_ca,required=false \
    set -eu; \
    if [ -f /run/secrets/extra_ca ]; then CA=/run/secrets/extra_ca; else CA=/etc/ssl/certs/ca-certificates.crt; fi; \
    curl --proto '=https' --tlsv1.2 -fsSL --cacert "$CA" --retry 5 -o /tmp/foundry.tgz \
      "https://github.com/foundry-rs/foundry/releases/download/${FOUNDRY_VERSION}/foundry_${FOUNDRY_VERSION}_linux_amd64.tar.gz"; \
    echo "${FOUNDRY_SHA256}  /tmp/foundry.tgz" | sha256sum -c -; \
    tar -xzf /tmp/foundry.tgz -C /usr/local/bin --no-same-owner forge cast anvil; \
    rm /tmp/foundry.tgz; \
    curl --proto '=https' --tlsv1.2 -fsSL --cacert "$CA" --retry 5 -o /usr/local/bin/solc \
      "https://github.com/ethereum/solidity/releases/download/${SOLC_VERSION}/solc-static-linux"; \
    echo "${SOLC_SHA256}  /usr/local/bin/solc" | sha256sum -c -; \
    chmod 0755 /usr/local/bin/solc; \
    useradd --uid 1000 --create-home chain
# Foundry uses the pinned local compiler and never downloads one at runtime.
ENV FOUNDRY_SOLC=/usr/local/bin/solc FOUNDRY_OFFLINE=true
WORKDIR /work
COPY --chown=chain:chain blockchain/foundry.toml blockchain/foundry.toml
COPY --chown=chain:chain blockchain/src blockchain/src
COPY --chown=chain:chain blockchain/scripts blockchain/scripts
COPY --chown=chain:chain poc/scripts/bootstrap-trust.sh poc/scripts/bootstrap-trust.sh
COPY --chown=chain:chain deploy/bootstrap/trust-bootstrap.sh deploy/bootstrap/trust-bootstrap.sh
USER chain
# Compile the contracts once at build time.
RUN cd blockchain && forge build
ENTRYPOINT []

# ----------------------------------------------------------- rust-build ----
FROM ${RUST_IMAGE} AS rust-build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src src
COPY examples examples
COPY services/delegation-adapter services/delegation-adapter
COPY services/delegation-core-node services/delegation-core-node
COPY services/delegation-engineer-node services/delegation-engineer-node
RUN --mount=type=secret,id=extra_ca,required=false \
    --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/services/delegation-core-node/target \
    --mount=type=cache,target=/src/services/delegation-engineer-node/target \
    set -eu; \
    if [ -f /run/secrets/extra_ca ]; then export CARGO_HTTP_CAINFO=/run/secrets/extra_ca SSL_CERT_FILE=/run/secrets/extra_ca; fi; \
    cargo build --release --locked --manifest-path services/delegation-engineer-node/Cargo.toml; \
    cargo build --release --locked --manifest-path services/delegation-core-node/Cargo.toml; \
    mkdir -p /out; \
    cp services/delegation-engineer-node/target/release/libdelegation_engineer_node.so /out/delegation-engineer.node; \
    cp services/delegation-core-node/target/release/libdelegation_core_node.so /out/delegation-core.node

# ------------------------------------------------------------------ app ----
FROM ${NODE_IMAGE} AS app
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node poc poc
COPY --chown=node:node blockchain/did-client blockchain/did-client
COPY --chown=node:node deploy deploy
RUN --mount=type=secret,id=extra_ca,required=false \
    set -eu; \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm --prefix poc ci --ignore-scripts --no-audit --no-fund; \
    npm --prefix blockchain/did-client ci --ignore-scripts --no-audit --no-fund; \
    npm cache clean --force; \
    chown -R node:node poc blockchain
COPY --from=rust-build --chown=node:node /out/delegation-engineer.node \
     poc/packages/orchestrator-runtime/src/native/delegation-engineer.node
COPY --from=rust-build --chown=node:node /out/delegation-core.node \
     poc/apps/gateway/src/native/delegation-core.node
# Mount points prepared with the runtime user as owner, so named volumes
# initialised from this image are writable by uid 1000.
RUN mkdir -p /config /state && chown node:node /config /state
USER node
EXPOSE 8700
CMD ["node", "--experimental-strip-types", "--disable-warning=ExperimentalWarning", "poc/engineer-console/src/server.mjs"]
