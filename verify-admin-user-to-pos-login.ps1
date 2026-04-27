[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingPlainTextForPassword', '', Justification='Script uses PSCredential input and does not expose plaintext password parameter.')]
param(
  [Uri]$CoreBaseUrl = [Uri]"http://localhost:3001",
  [PSCredential]$Credential
)

$ErrorActionPreference = "Stop"

if (-not $Credential) {
  $Credential = Get-Credential -Message "Masukkan credential untuk verifikasi login Core API"
}

$passwordPlain = $Credential.GetNetworkCredential().Password
$username = $Credential.UserName

$baseUrl = $CoreBaseUrl.ToString().TrimEnd('/')
$uri = "$baseUrl/auth/login"
$body = @{
  username = $username
  password = $passwordPlain
} | ConvertTo-Json

Write-Output "Verifying login to $uri for username '$username' ..."

try {
  $response = Invoke-RestMethod `
    -Uri $uri `
    -Method Post `
    -ContentType "application/json" `
    -Body $body

  if (-not $response.token) {
    $rawBody = $response | ConvertTo-Json -Depth 10
    throw "HTTP 200 tapi token tidak ada di response. Body: $rawBody"
  }

  Write-Output "SUCCESS: /auth/login returned HTTP 200 and token exists."
  Write-Output "Token length: $($response.token.Length)"
  exit 0
} catch {
  if ($_.Exception.Response) {
    $res = $_.Exception.Response
    $status = [int]$res.StatusCode
    $stream = $res.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($stream)
    $errBody = $reader.ReadToEnd()

    Write-Output "HTTP status: $status"
    Write-Output "Response body: $errBody"
  }

  throw
}
