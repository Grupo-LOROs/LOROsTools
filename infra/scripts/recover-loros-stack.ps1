$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$infraDir = Split-Path -Parent $PSScriptRoot
$composePath = Join-Path $infraDir "docker-compose.yml"
$dockerDesktopExe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
$logDir = Join-Path $infraDir "logs"
$logPath = Join-Path $logDir "recover-loros-stack.log"

if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
}

function Write-Log {
    param([string]$Message)

    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -Path $logPath -Value $line
}

function Wait-ForStableDocker {
    param(
        [int]$TimeoutSeconds = 300,
        [int]$ConsecutiveSuccesses = 3,
        [int]$SleepSeconds = 5
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $successCount = 0

    while ((Get-Date) -lt $deadline) {
        try {
            docker info | Out-Null
            $successCount += 1
            if ($successCount -ge $ConsecutiveSuccesses) {
                Write-Log "Docker engine is stable."
                return $true
            }
        } catch {
            $successCount = 0
        }

        Start-Sleep -Seconds $SleepSeconds
    }

    Write-Log "Docker engine did not stabilize in time."
    return $false
}

function Invoke-ComposeWithRetry {
    param(
        [int]$MaxAttempts = 12,
        [int]$SleepSeconds = 10
    )

    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt += 1) {
        Write-Log ("docker compose up -d attempt {0}/{1}" -f $attempt, $MaxAttempts)
        $composeOutput = & cmd.exe /d /c "docker compose -f ""$composePath"" up -d 2>&1"
        foreach ($line in $composeOutput) {
            Write-Log $line
        }

        if ($LASTEXITCODE -eq 0) {
            return $true
        }

        Write-Log ("docker compose up -d failed with exit code {0}" -f $LASTEXITCODE)
        Start-Sleep -Seconds $SleepSeconds
    }

    return $false
}

function Wait-ForHttpOk {
    param(
        [string]$Name,
        [string]$Url,
        [string]$ExpectedBody = "",
        [int]$TimeoutSeconds = 180,
        [int]$SleepSeconds = 5
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            if ($ExpectedBody) {
                $response = curl.exe -sS --http1.1 $Url
                if ($response -match $ExpectedBody) {
                    Write-Log "$Name OK"
                    return $true
                }
            } else {
                $code = curl.exe -sS -o NUL -w "%{http_code}" --http1.1 $Url
                if ($code -eq "200") {
                    Write-Log "$Name OK"
                    return $true
                }
            }
        } catch {
        }

        Start-Sleep -Seconds $SleepSeconds
    }

    Write-Log "$Name TIMEOUT"
    return $false
}

Write-Log "Recovery started."

try {
    Start-Service com.docker.service -ErrorAction Stop
    Write-Log "Docker Desktop service start requested."
} catch {
    Write-Log ("Docker Desktop service start skipped: {0}" -f $_.Exception.Message)
}

$dockerProcess = Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue
if (-not $dockerProcess) {
    if (-not (Test-Path $dockerDesktopExe)) {
        throw "Docker Desktop executable was not found at $dockerDesktopExe"
    }

    Start-Process $dockerDesktopExe | Out-Null
    Write-Log "Docker Desktop process launched."
} else {
    Write-Log "Docker Desktop process already running."
}

if (-not (Wait-ForStableDocker)) {
    throw "Docker engine did not become ready within 5 minutes."
}

if (-not (Invoke-ComposeWithRetry)) {
    throw "docker compose up -d failed after repeated attempts."
}

$statusOutput = & cmd.exe /d /c "docker compose -f ""$composePath"" ps 2>&1"
foreach ($line in $statusOutput) {
    Write-Log $line
}

if ($LASTEXITCODE -ne 0) {
    throw "docker compose ps failed with exit code $LASTEXITCODE."
}

if (-not (Wait-ForHttpOk -Name "API health" -Url "https://api.grupo-loros.com/health" -ExpectedBody '"status":"ok"' -TimeoutSeconds 180)) {
    throw "API health check did not pass after recovery."
}

if (-not (Wait-ForHttpOk -Name "Portal login page" -Url "https://tools.grupo-loros.com/tools/login" -TimeoutSeconds 180)) {
    throw "Portal login page did not become available after recovery."
}

Write-Log "Recovery finished."
