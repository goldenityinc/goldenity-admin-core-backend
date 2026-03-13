param(
  [string]$CoreBaseUrl = "http://localhost:3001",
  [string]$BridgeBaseUrl = "http://localhost:3002",
  [string]$Username = $env:TPP_USERNAME,
  [string]$Password = $env:TPP_PASSWORD
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Username) -or [string]::IsNullOrWhiteSpace($Password)) {
  throw "Username/password wajib diisi. Pakai parameter -Username dan -Password, atau set env TPP_USERNAME dan TPP_PASSWORD."
}

Write-Host "[1/2] Login ke Core API: $CoreBaseUrl/auth/login"

$loginBody = @{
  username = $Username
  password = $Password
} | ConvertTo-Json

$loginResponse = Invoke-RestMethod `
  -Uri "$CoreBaseUrl/auth/login" `
  -Method Post `
  -ContentType "application/json" `
  -Body $loginBody

if (-not $loginResponse.token) {
  throw "Login berhasil dipanggil tapi token tidak ditemukan di response. Response: $($loginResponse | ConvertTo-Json -Depth 6)"
}

$token = [string]$loginResponse.token
Write-Host "Login sukses. Token length: $($token.Length)"

Write-Host "[2/2] GET Bridge API: $BridgeBaseUrl/products"

$headers = @{
  Authorization = "Bearer $token"
}

$productsResponse = Invoke-RestMethod `
  -Uri "$BridgeBaseUrl/products" `
  -Method Get `
  -Headers $headers

Write-Host "Bridge response:" 
$productsResponse | ConvertTo-Json -Depth 10
