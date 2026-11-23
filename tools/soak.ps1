# Memory and processor soak for RigHelper, on a real Windows PC or CI runner.
#
#   pwsh tools/soak.ps1 -Helper helper-out/RigHelper.exe -Minutes 20
#
# Runs the two ways Rig runs the helper, side by side, for the given time:
#   recorder  the background recorder (as the RigRecorder service does), via --record-for
#   helper    the app's helper on its pipe, asked what the app asks: a sensor reading every
#             2 seconds, settings every 30 seconds, Windows' event log every 5 minutes and the
#             parts every 10 minutes
# and samples each process every 30 seconds: working set, private memory, handles, threads and
# processor time. It prints a table and the change per hour after a two-minute warm-up, and
# writes soak.csv and soak.json to -Out. It fails only when a process stops early.

param(
  [Parameter(Mandatory)] [string] $Helper,
  [int] $Minutes = 20,
  [string] $Out = "soak-out"
)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force $Out | Out-Null
$Helper = (Resolve-Path $Helper).Path
$cores = [Environment]::ProcessorCount

# The recorder, in a process of its own.
$recDir = Join-Path $Out "recorder-data"
New-Item -ItemType Directory -Force $recDir | Out-Null
$rec = Start-Process $Helper -ArgumentList "--record-for", ($Minutes * 60 + 60), "--data-dir", $recDir -PassThru

# The app's helper, connected to a pipe this script serves, as Rig's app does.
$name = "rig-soak-$PID"
$server = [System.IO.Pipes.NamedPipeServerStream]::new($name, [System.IO.Pipes.PipeDirection]::InOut, 1, [System.IO.Pipes.PipeTransmissionMode]::Byte, [System.IO.Pipes.PipeOptions]::Asynchronous)
$help = Start-Process $Helper -ArgumentList "--pipe", "\\.\pipe\$name", "--parent", $PID -PassThru
if (-not $server.WaitForConnectionAsync().Wait(30000)) { throw "The helper didn't connect to the pipe" }
$utf8 = [System.Text.UTF8Encoding]::new($false)
$reader = [System.IO.StreamReader]::new($server, $utf8)
$writer = [System.IO.StreamWriter]::new($server, $utf8)
$writer.AutoFlush = $true
$writer.NewLine = "`n"
$script:id = 0
$script:slow = @{}
function Call([string] $method, $params = $null) {
  $script:id++
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $writer.WriteLine((@{ id = $script:id; method = $method; params = $params } | ConvertTo-Json -Compress -Depth 5))
  $line = $reader.ReadLine()
  if ($null -eq $line) { throw "The helper closed the pipe during $method" }
  $ms = $sw.Elapsed.TotalMilliseconds
  if (-not $script:slow[$method] -or $ms -gt $script:slow[$method]) { $script:slow[$method] = [math]::Round($ms) }
  if ($line -match '"error"') { Write-Host "$method answered an error: $($line.Substring(0, [math]::Min(200, $line.Length)))" }
}

$rows = [System.Collections.Generic.List[object]]::new()
function Sample([string] $label, [System.Diagnostics.Process] $p, [double] $min) {
  $p.Refresh()
  $rows.Add([pscustomobject]@{
    proc = $label; min = [math]::Round($min, 1)
    wsMB = [math]::Round($p.WorkingSet64 / 1MB, 1); privateMB = [math]::Round($p.PrivateMemorySize64 / 1MB, 1)
    handles = $p.HandleCount; threads = $p.Threads.Count; cpuSec = [math]::Round($p.TotalProcessorTime.TotalSeconds, 2)
  })
}

$start = [System.Diagnostics.Stopwatch]::StartNew()
$weekAgo = [DateTimeOffset]::UtcNow.AddDays(-30).ToUnixTimeMilliseconds()
$tick = 0
Call "inventory"; Call "facts"; Call "events" @{ sinceMs = $weekAgo }
while ($start.Elapsed.TotalMinutes -lt $Minutes) {
  if ($rec.HasExited) { throw "The recorder stopped early: $($rec.ExitCode)" }
  if ($help.HasExited) { throw "The helper stopped early: $($help.ExitCode)" }
  Call "snapshot"
  if ($tick % 15 -eq 0) { Call "facts"; Call "processes" @{ top = 8 } }
  if ($tick % 150 -eq 0 -and $tick -gt 0) { Call "events" @{ sinceMs = [DateTimeOffset]::UtcNow.AddDays(-30).ToUnixTimeMilliseconds() } }
  if ($tick % 300 -eq 0 -and $tick -gt 0) { Call "inventory" }
  if ($tick % 15 -eq 0) { $m = $start.Elapsed.TotalMinutes; Sample "recorder" $rec $m; Sample "helper" $help $m }
  $tick++
  $wait = 2000 - ($start.ElapsedMilliseconds % 2000)
  Start-Sleep -Milliseconds $wait
}
$m = $start.Elapsed.TotalMinutes; Sample "recorder" $rec $m; Sample "helper" $help $m
$server.Dispose()
$help.WaitForExit(10000) | Out-Null
Stop-Process -Id $rec.Id -ErrorAction SilentlyContinue

$rows | Export-Csv -NoTypeInformation (Join-Path $Out "soak.csv")
$summary = foreach ($proc in "recorder", "helper") {
  $r = @($rows | Where-Object proc -eq $proc)
  $warm = @($r | Where-Object min -ge 2)
  $a = $warm[0]; $z = $r[-1]
  $hours = [math]::Max(0.01, ($z.min - $a.min) / 60)
  [pscustomobject]@{
    proc = $proc; minutes = $z.min
    wsMB = $z.wsMB; peakWsMB = ($r | Measure-Object wsMB -Maximum).Maximum; privateMB = $z.privateMB
    handles = $z.handles; threads = $z.threads
    privatePerHourMB = [math]::Round(($z.privateMB - $a.privateMB) / $hours, 1)
    handlesPerHour = [math]::Round(($z.handles - $a.handles) / $hours, 1)
    # Processor use after the warm-up, as Task Manager shows it: a share of the whole processor.
    cpuPct = [math]::Round(($z.cpuSec - $a.cpuSec) / (($z.min - $a.min) * 60) / $cores * 100, 3)
  }
}
$rows | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
$summary | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
Write-Host "Slowest helper answers (ms): $(($script:slow.GetEnumerator() | ForEach-Object { "$($_.Key) $($_.Value)" }) -join ', ')"
@{ summary = $summary; slowestMs = $script:slow; cores = $cores } | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $Out "soak.json")
if ($env:GITHUB_STEP_SUMMARY) {
  $md = @("### Helper soak, $Minutes minutes", "", "| process | MB working set (peak) | MB private | private MB/h | handles (per h) | threads | CPU % |", "|---|---|---|---|---|---|---|")
  $md += $summary | ForEach-Object { "| $($_.proc) | $($_.wsMB) ($($_.peakWsMB)) | $($_.privateMB) | $($_.privatePerHourMB) | $($_.handles) ($($_.handlesPerHour)) | $($_.threads) | $($_.cpuPct) |" }
  $md -join "`n" | Add-Content $env:GITHUB_STEP_SUMMARY
}
