[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PostgresBin,
    [string]$WorkRoot = (Join-Path ([IO.Path]::GetTempPath()) ('abaco008-' + [guid]::NewGuid().ToString('N'))),
    [ValidateRange(50000, 59999)][int]$Port = 55441,
    [switch]$IncludeVolume,
    [switch]$Include009,
    [switch]$Include009Performance
)

# Windows, synthetic PostgreSQL only. No npm, Supabase CLI, network API or .env required.
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\', '/')
$testRoot = [IO.Path]::GetFullPath($WorkRoot).TrimEnd('\', '/')
if ($testRoot.Equals($repoRoot, [StringComparison]::OrdinalIgnoreCase) -or
    $testRoot.StartsWith($repoRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'WorkRoot debe quedar fuera del checkout.'
}
if (Test-Path -LiteralPath $testRoot) { throw 'WorkRoot debe ser una ruta nueva; no se reutilizan ni sobrescriben clusters.' }
$pgBin = (Resolve-Path -LiteralPath $PostgresBin).Path
foreach ($binary in @('initdb.exe', 'pg_ctl.exe', 'psql.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $pgBin $binary) -PathType Leaf)) { throw "Falta $binary" }
}
$node = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
& $node -e "if (Number(process.versions.node.split('.')[0]) < 20) process.exit(1)"
if ($LASTEXITCODE -ne 0) { throw 'Se requiere Node.js 20 o posterior; validado con 24.' }
# Reject a busy port before creating files. pg_ctl also fails if another process wins the race.
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
try { $listener.Start() } finally { $listener.Stop() }

$dataDir = Join-Path $testRoot 'work\staging-pg\data'
$logFile = Join-Path $testRoot 'postgres.log'
$names = @('ABACO_SQL_TEST_ACK', 'ABACO_TEST_PG_BIN', 'ABACO_TEST_PG_DATA', 'ABACO_TEST_PG_PORT', 'ABACO_008_VOLUME_RESULT_FILE', 'ABACO_009_PERF_ACK', 'ABACO_009_PERF_PHASE', 'ABACO_009_PERF_RESULT_FILE')
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$started = $false
$location = Get-Location
try {
    New-Item -ItemType Directory -Path $testRoot | Out-Null
    & (Join-Path $pgBin 'initdb.exe') -D $dataDir -U postgres --auth-local=trust --auth-host=trust --encoding=UTF8 --locale=C
    if ($LASTEXITCODE -ne 0) { throw 'initdb fallo; no se conectara a otro cluster.' }
    & (Join-Path $pgBin 'pg_ctl.exe') -D $dataDir -l $logFile -o "-h 127.0.0.1 -p $Port -c shared_buffers=32MB -c max_connections=20" -w start
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo iniciar el cluster aislado.' }
    $started = $true
    $env:ABACO_SQL_TEST_ACK = 'synthetic-only'
    $env:ABACO_TEST_PG_BIN = $pgBin
    $env:ABACO_TEST_PG_DATA = $dataDir
    $env:ABACO_TEST_PG_PORT = [string]$Port
    $env:ABACO_008_VOLUME_RESULT_FILE = Join-Path $testRoot '008-volume-result.json'
    Set-Location -LiteralPath $repoRoot
    & $node --test tests/integration/libro-ensayo-postgres.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Suite funcional 008 fallida.' }
    if ($Include009 -or $Include009Performance) {
        & $node --test tests/integration/libro-escritor-postgres.test.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Suite funcional 009 fallida.' }
    }
    if ($Include009Performance) {
        $env:ABACO_009_PERF_ACK = 'operational-history-only'
        $env:ABACO_009_PERF_PHASE = 'comparison'
        $env:ABACO_009_PERF_RESULT_FILE = Join-Path $testRoot '009-performance.json'
        & $node --test tests/integration/libro-rendimiento-postgres.test.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Benchmark comparativo 009 fallido.' }
    }
    if ($IncludeVolume) {
        & $node --test tests/integration/libro-volumen-postgres.test.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Benchmark 008 fallido.' }
    }
} finally {
    Set-Location -LiteralPath $location.Path
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
    if ($started) {
        & (Join-Path $pgBin 'pg_ctl.exe') -D $dataDir -m fast -w stop
        if ($LASTEXITCODE -ne 0) { throw "No se pudo detener el cluster propio: $dataDir" }
    }
    # Keep logs and the stopped synthetic cluster for inspection. Never recursively delete paths.
}
