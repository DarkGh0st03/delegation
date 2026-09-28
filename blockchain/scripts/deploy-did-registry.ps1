param(
    [string]$RpcUrl = "http://127.0.0.1:8545",

    [Parameter(Mandatory = $true)]
    [string]$PrivateKey
)

$ErrorActionPreference = "Stop"

Write-Host "Deploying EthereumDIDRegistry to $RpcUrl"

forge create --broadcast --rpc-url $RpcUrl --private-key $PrivateKey src/vendor/EthereumDIDRegistry.sol:EthereumDIDRegistry
