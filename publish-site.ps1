param(
  [string]$SourceIndex = ""
)

$ErrorActionPreference = 'Stop'

$repoDir = "C:\Users\midas\Documents\Codex\2026-06-20\logo"
$repoIndex = Join-Path $repoDir "index.html"
$gitExe = "C:\Program Files\Git\cmd\git.exe"

if ([string]::IsNullOrWhiteSpace($SourceIndex)) {
  $oneDrive = $env:OneDrive
  if ([string]::IsNullOrWhiteSpace($oneDrive) -or !(Test-Path -LiteralPath $oneDrive)) {
    throw "OneDrive path not found."
  }

  $preferredCandidates = @(
    (Join-Path $oneDrive "桌面\網站\index.html"),
    (Join-Path $oneDrive "桌面\index.html")
  )

  foreach ($candidate in $preferredCandidates) {
    if (Test-Path -LiteralPath $candidate) {
      $SourceIndex = $candidate
      break
    }
  }

  if ([string]::IsNullOrWhiteSpace($SourceIndex)) {
    $found = Get-ChildItem -Path $oneDrive -Filter "index.html" -File -Recurse -ErrorAction SilentlyContinue |
      Sort-Object @{ Expression = { $_.FullName.Length }; Descending = $true } |
      Select-Object -First 1

    if ($found) {
      $SourceIndex = $found.FullName
    }
  }
}

if ([string]::IsNullOrWhiteSpace($SourceIndex) -or !(Test-Path -LiteralPath $SourceIndex)) {
  throw "Source index.html not found."
}

if (!(Test-Path -LiteralPath $gitExe)) {
  throw "Git not found: $gitExe"
}

Copy-Item -LiteralPath $SourceIndex -Destination $repoIndex -Force

Set-Location $repoDir

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

& $gitExe add .

$status = & $gitExe status --short
if (-not $status) {
  Write-Host "No changes detected. Nothing to publish."
  exit 0
}

& $gitExe commit -m "Update site $timestamp"
& $gitExe push

Write-Host ""
Write-Host "Publish complete. Changes pushed to GitHub."
Write-Host "Vercel will redeploy automatically."
