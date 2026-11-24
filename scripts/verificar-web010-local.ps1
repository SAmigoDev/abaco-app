[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateSet('isolated-checkout')][string]$Acknowledgement)
$ErrorActionPreference='Stop'
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\','/')
$location=Get-Location
$names=@('NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','NEXT_TELEMETRY_DISABLED','ABACO_LOCAL_BUILD_CHECK','npm_config_userconfig','npm_config_globalconfig')
$previous=@{}
foreach($name in $names){$previous[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
$npmUserFile=$null;$npmGlobalFile=$null
try{
 Set-Location -LiteralPath $repoRoot
 $status=& git status --porcelain
 if($LASTEXITCODE -ne 0 -or $status){throw 'Se requiere checkout limpio; no se verifica sobre trabajo local sin commit.'}
 if(Get-ChildItem -LiteralPath $repoRoot -Force -File | Where-Object {$_.Name -like '.env*'}){throw 'El checkout no debe contener archivos .env.'}
 if((Test-Path node_modules) -and ((Get-Item node_modules).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'No se admite node_modules enlazado desde otro checkout.'}
 $npmUserFile=[IO.Path]::GetTempFileName();$npmGlobalFile=[IO.Path]::GetTempFileName()
 [IO.File]::WriteAllText($npmUserFile,'# Public packages, no credentials');[IO.File]::WriteAllText($npmGlobalFile,'# Empty global configuration')
 $env:npm_config_userconfig=$npmUserFile;$env:npm_config_globalconfig=$npmGlobalFile
 $env:NEXT_PUBLIC_SUPABASE_URL='https://abaco-tests.invalid'
 $env:NEXT_PUBLIC_SUPABASE_ANON_KEY='synthetic-no-real-credentials'
 $env:NEXT_TELEMETRY_DISABLED='1'
 $env:ABACO_LOCAL_BUILD_CHECK='synthetic-only'
 & npm.cmd ci --no-audit --no-fund --registry=https://registry.npmjs.org
 if($LASTEXITCODE -ne 0){throw 'Fallo npm ci; no se continuara con dependencias parciales.'}
 & npm.cmd test
 if($LASTEXITCODE -ne 0){throw 'Tests fallidos.'}
 # Build artifacts only; source files/configuration remain exactly as checked out from Git.
 $buildRoot=Join-Path $repoRoot '.next'
 $appOutput=Join-Path $buildRoot 'server\app'
 New-Item -ItemType Directory -Path $appOutput -Force | Out-Null
 $appSource=Join-Path $repoRoot 'src\app'
 foreach($directory in Get-ChildItem -LiteralPath $appSource -Directory -Recurse){
  $relative=$directory.FullName.Substring($appSource.Length).TrimStart('\','/')
  New-Item -ItemType Directory -Path (Join-Path $appOutput $relative) -Force | Out-Null
 }
 foreach($route in @('_not-found','_global-error','login')){
  New-Item -ItemType Directory -Path (Join-Path $appOutput "$route.segments\$route") -Force | Out-Null
 }
 & npm.cmd run build -- --webpack
 if($LASTEXITCODE -ne 0){throw 'Build Webpack local fallido.'}
 if(& git status --porcelain){throw 'El proceso modifico fuentes o dejo archivos sin versionar.'}
 Write-Output 'Verificacion completa: npm ci, tests y build; checkout limpio, sin overlays ni .env.'
}finally{
 Set-Location -LiteralPath $location.Path
 foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')}
 foreach($configFile in @($npmUserFile,$npmGlobalFile)){if($configFile -and (Test-Path -LiteralPath $configFile)){Remove-Item -LiteralPath $configFile -Force}}
}
