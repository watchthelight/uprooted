#Requires -Version 5.1
<#
.SYNOPSIS
    Uninstaller for Uprooted - removes all modifications.
.DESCRIPTION
    1. Restores all shortcuts to point to Root.exe
    2. Restores the rootapp:// protocol handler
    3. Removes all Uprooted environment variables (DOTNET_ profiler + legacy CORECLR_)
    4. Restores Root.exe from backup if it was patched
    5. Removes installed DLL directory
    6. Optionally removes log and settings files
#>

$ErrorActionPreference = "Stop"

$RootDir = Join-Path $env:LOCALAPPDATA "Root"
$RootCurrent = Join-Path $RootDir "current"
$RootExePath = Join-Path $RootCurrent "Root.exe"
$BackupPath = "$RootExePath.uprooted.bak"
$InstallDir = Join-Path $RootDir "uprooted"
$BackupFile = Join-Path $InstallDir "shortcuts-backup.txt"

function Write-Step($msg) { Write-Host "[*] $msg" -ForegroundColor Cyan }
function Write-OK($msg) { Write-Host "[+] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }

Write-Host ""
Write-Host "  +---------------------------------+" -ForegroundColor Yellow
Write-Host "  |   Uprooted Uninstaller v0.4.2   |" -ForegroundColor Yellow
Write-Host "  +---------------------------------+" -ForegroundColor Yellow
Write-Host ""

# Check if Root is running
$rootProcess = Get-Process -Name "Root" -ErrorAction SilentlyContinue
if ($rootProcess) {
    Write-Warn "Root is currently running. Please close it first."
    $response = Read-Host "Close Root now? (y/n)"
    if ($response -eq 'y') {
        Stop-Process -Name "Root" -Force
        Start-Sleep -Seconds 2
        Write-OK "Root closed"
    } else {
        Write-Warn "Continuing anyway (changes take effect on next launch)"
    }
}

# Step 1: Restore shortcuts (BEFORE deleting uprooted dir, which contains the backup file)
Write-Step "Restoring shortcuts..."

$shell = New-Object -ComObject WScript.Shell
$restoreCount = 0

if (Test-Path $BackupFile) {
    Get-Content $BackupFile | ForEach-Object {
        $parts = $_ -split '\|'

        if ($parts[0] -eq "REGISTRY") {
            # Registry entry - handled in Step 2
            return
        }

        if ($parts.Count -lt 5) { return }

        $lnkPath = $parts[0]
        $origTarget = $parts[1]
        $origWorkDir = $parts[2]
        $origArgs = $parts[3]
        $origIcon = $parts[4]

        if (-not (Test-Path $lnkPath)) {
            Write-Host "  Skip (not found): $lnkPath" -ForegroundColor DarkGray
            return
        }

        try {
            $lnk = $shell.CreateShortcut($lnkPath)
            $lnk.TargetPath = $origTarget
            $lnk.WorkingDirectory = $origWorkDir
            $lnk.Arguments = $origArgs
            if ($origIcon) { $lnk.IconLocation = $origIcon }
            $lnk.Save()
            $restoreCount++
            Write-OK "  Restored: $lnkPath -> $origTarget"
        } catch {
            Write-Warn "  Failed to restore: $lnkPath - $($_.Exception.Message)"
        }
    }
    Write-OK "Shortcuts restored ($restoreCount)"
} else {
    Write-Warn "No backup file found, restoring shortcuts to Root.exe directly..."

    $shortcutPaths = @(
        (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Root.lnk"),
        (Join-Path ([Environment]::GetFolderPath('Desktop')) "Root.lnk"),
        (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\Root.lnk"),
        (Join-Path $env:APPDATA "Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Root.lnk")
    )

    foreach ($lnkPath in $shortcutPaths) {
        if (-not (Test-Path $lnkPath)) { continue }
        try {
            $lnk = $shell.CreateShortcut($lnkPath)
            if ($lnk.TargetPath -like "*UprootedLauncher*") {
                $lnk.TargetPath = $RootExePath
                $lnk.WorkingDirectory = $RootCurrent
                $lnk.IconLocation = "$RootExePath,0"
                $lnk.Save()
                $restoreCount++
                Write-OK "  Restored: $lnkPath"
            }
        } catch {
            Write-Warn "  Failed: $lnkPath - $($_.Exception.Message)"
        }
    }
}

# Step 2: Restore protocol handler
Write-Step "Restoring protocol handler..."

$regPath = "HKCU:\SOFTWARE\Classes\rootapp\shell\open\command"
if (Test-Path $regPath) {
    $currentCmd = (Get-ItemProperty $regPath).'(default)'

    if ($currentCmd -like "*UprootedLauncher*") {
        # Try to find original from backup
        $origCmd = $null
        if (Test-Path $BackupFile) {
            Get-Content $BackupFile | ForEach-Object {
                $parts = $_ -split '\|'
                if ($parts[0] -eq "REGISTRY" -and $parts[1] -eq $regPath) {
                    $origCmd = $parts[2]
                }
            }
        }

        if (-not $origCmd) {
            $origCmd = "`"$RootExePath`" `"%1`""
        }

        Set-ItemProperty $regPath -Name '(default)' -Value $origCmd
        Write-OK "Protocol handler restored: $origCmd"
    } else {
        Write-Host "  Protocol handler already points to Root.exe" -ForegroundColor DarkGray
    }
} else {
    Write-Host "  No rootapp:// handler found" -ForegroundColor DarkGray
}

# Step 3: Remove all environment variables (DOTNET_ profiler + legacy CORECLR_)
Write-Step "Removing environment variables..."

$envVars = @(
    # Current DOTNET_ profiler vars (set by install-hook.ps1)
    "DOTNET_EnableDiagnostics",
    "DOTNET_ENABLE_PROFILING",
    "DOTNET_PROFILER",
    "DOTNET_PROFILER_PATH",
    # Legacy CORECLR_ vars (older installs)
    "CORECLR_ENABLE_PROFILING",
    "CORECLR_PROFILER",
    "CORECLR_PROFILER_PATH",
    # Startup hook vars
    "DOTNET_ReadyToRun",
    "DOTNET_STARTUP_HOOKS"
)

foreach ($var in $envVars) {
    $current = [System.Environment]::GetEnvironmentVariable($var, "User")
    if ($current) {
        [System.Environment]::SetEnvironmentVariable($var, $null, "User")
        Write-OK "Removed $var"
    }
}
# Also clear from current session
foreach ($var in $envVars) {
    Remove-Item "Env:\$var" -ErrorAction SilentlyContinue
}
Write-OK "Environment variables cleaned"

# Step 4: Restore Root.exe from backup
Write-Step "Checking for Root.exe backup..."
if (Test-Path $BackupPath) {
    Copy-Item $BackupPath $RootExePath -Force
    Remove-Item $BackupPath -Force
    Write-OK "Root.exe restored from backup"
} else {
    Write-OK "No backup found (Root.exe was not patched)"
}

# Step 5: Remove installed DLL directory
Write-Step "Removing installed files..."
if (Test-Path $InstallDir) {
    Remove-Item $InstallDir -Recurse -Force
    Write-OK "Removed $InstallDir"
} else {
    Write-OK "Install directory was already clean"
}

# Step 6: Clean up log and settings (optional)
$profileDir = Join-Path $env:LOCALAPPDATA "Root Communications\Root\profile\default"
$logFile = Join-Path $profileDir "uprooted-hook.log"
$settingsFile = Join-Path $profileDir "uprooted-settings.ini"

$hasLeftovers = (Test-Path $logFile) -or (Test-Path $settingsFile)
if ($hasLeftovers) {
    Write-Host ""
    $response = Read-Host "Remove log and settings files too? (y/n)"
    if ($response -eq 'y') {
        if (Test-Path $logFile) { Remove-Item $logFile -Force }
        if (Test-Path $settingsFile) { Remove-Item $settingsFile -Force }
        Write-OK "Log and settings files removed"
    } else {
        Write-OK "Log and settings files kept"
    }
}

Write-Host ""
Write-Host "  +---------------------------------+" -ForegroundColor Green
Write-Host "  |   Uninstall Complete!            |" -ForegroundColor Green
Write-Host "  +---------------------------------+" -ForegroundColor Green
Write-Host ""
Write-Host "  Root Communications has been restored to stock." -ForegroundColor White
Write-Host ""
