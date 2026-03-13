$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$taskName = "LOROs Post-Reboot Verification"
$infraDir = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $infraDir "logs"
$logPath = Join-Path $logDir "verify-loros-stack.log"
$composePath = Join-Path $infraDir "docker-compose.yml"

if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
}

function Write-Log {
    param([string]$Message)

    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -Path $logPath -Value $line
}

function Wait-ForCommand {
    param(
        [scriptblock]$Command,
        [string]$Name,
        [int]$TimeoutSeconds = 180,
        [int]$SleepSeconds = 5
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            & $Command | Out-Null
            Write-Log "$Name OK"
            return $true
        } catch {
            Start-Sleep -Seconds $SleepSeconds
        }
    }

    Write-Log "$Name TIMEOUT"
    return $false
}

Write-Log "Verification started."

$dockerReady = Wait-ForCommand -Name "Docker engine" -TimeoutSeconds 300 -Command { docker info }
if (-not $dockerReady) {
    throw "Docker engine did not become ready."
}

$composeOutput = & cmd.exe /d /c "docker compose -f ""$composePath"" ps 2>&1"
foreach ($line in $composeOutput) {
    Write-Log $line
}

$apiReady = Wait-ForCommand -Name "API health" -TimeoutSeconds 180 -Command {
    $response = curl.exe -sS --http1.1 https://api.grupo-loros.com/health
    if ($response -notmatch '"status":"ok"') {
        throw "Health endpoint returned unexpected payload: $response"
    }
}

$portalReady = Wait-ForCommand -Name "Portal login page" -TimeoutSeconds 180 -Command {
    $code = curl.exe -sS -o NUL -w "%{http_code}" --http1.1 https://tools.grupo-loros.com/tools/login
    if ($code -ne "200") {
        throw "Unexpected status code: $code"
    }
}

if ($apiReady -and $portalReady) {
    Write-Log "Verification finished successfully."
    try {
        Disable-ScheduledTask -TaskName $taskName | Out-Null
        Write-Log "Verification task disabled after success."
    } catch {
        Write-Log ("Failed to disable verification task: {0}" -f $_.Exception.Message)
    }
} else {
    throw "Verification failed."
}
