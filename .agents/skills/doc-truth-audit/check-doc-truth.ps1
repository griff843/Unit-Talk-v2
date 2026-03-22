param(
  [Parameter(Mandatory = $true)]
  [string]$DocPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Normalize-RepoPath {
  param([string]$Path)
  return ($Path -replace '\\', '/').Trim()
}

function Extract-BacktickPaths {
  param([string]$Text)

  $matches = [regex]::Matches($Text, '`((?:apps|packages)/[^`]+?\.ts)`')
  $paths = @()
  foreach ($match in $matches) {
    $paths += (Normalize-RepoPath $match.Groups[1].Value)
  }
  return @($paths | Select-Object -Unique)
}

function Split-MarkdownRow {
  param([string]$Line)

  $trimmed = $Line.Trim()
  if (-not $trimmed.StartsWith('|')) {
    return @()
  }

  $parts = $trimmed.Split('|')
  if ($parts.Count -lt 3) {
    return @()
  }

  return @($parts[1..($parts.Count - 2)] | ForEach-Object { $_.Trim() })
}

function New-Claim {
  param(
    [string]$Name,
    [string]$Status,
    [string[]]$Files,
    [string]$BlockText,
    [string]$SourceKind
  )

  return [pscustomobject]@{
    Name = $Name
    Status = $Status
    Files = @($Files | Select-Object -Unique)
    BlockText = $BlockText
    SourceKind = $SourceKind
  }
}

if (-not (Test-Path $DocPath)) {
  Write-Error "Doc not found: $DocPath"
  exit 2
}

$docFullPath = (Resolve-Path $DocPath).Path
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$rawDocLines = Get-Content $docFullPath
$docLinesList = New-Object System.Collections.Generic.List[string]
$inCodeFence = $false
foreach ($rawLine in $rawDocLines) {
  if ($rawLine -match '^\s*```') {
    $inCodeFence = -not $inCodeFence
    continue
  }

  if (-not $inCodeFence) {
    $docLinesList.Add($rawLine) | Out-Null
  }
}
$docLines = @($docLinesList)
$docContent = $docLines -join "`n"
$docRelativePath = Normalize-RepoPath ((Resolve-Path -Relative $docFullPath) -replace '^[.][\\/]', '')

$allowedStatuses = @('ACTIVE', 'NOT_CONSUMING')
$bannedPhrases = @(
  'adjacent',
  'easy to wire',
  'possible',
  'ready to consume'
)
$evidenceTokens = @(
  'computeSubmissionDomainAnalysis',
  'enrichMetadataWithDomainAnalysis',
  'readDomainAnalysisEdgeScore',
  'domainAnalysis'
)

$validatedActive = New-Object System.Collections.Generic.List[string]
$invalidOrUnproven = New-Object System.Collections.Generic.List[string]
$missingButReal = New-Object System.Collections.Generic.List[string]

$domainRefLines = @(
  & rg -n --glob '!**/*.test.ts' --glob '!**/dist/**' --glob '!**/node_modules/**' `
    'domainAnalysis|metadata\.domainAnalysis|readDomainAnalysisEdgeScore|computeSubmissionDomainAnalysis|enrichMetadataWithDomainAnalysis' `
    apps packages 2>$null
)

$activeCodeFiles = @{}
foreach ($line in $domainRefLines) {
  if ($line -match '^(?<file>(?:apps|packages)[\\/][^:]+):(?<line>\d+):(?<text>.*)$') {
    $file = Normalize-RepoPath $matches['file']
    if (-not $activeCodeFiles.ContainsKey($file)) {
      $activeCodeFiles[$file] = New-Object System.Collections.Generic.List[string]
    }
    $activeCodeFiles[$file].Add($line) | Out-Null
  }
}

$claims = New-Object System.Collections.Generic.List[object]

for ($i = 0; $i -lt $docLines.Length; $i++) {
  $line = $docLines[$i]
  if (-not $line.Trim().StartsWith('|')) {
    continue
  }

  $tableLines = New-Object System.Collections.Generic.List[string]
  while ($i -lt $docLines.Length -and $docLines[$i].Trim().StartsWith('|')) {
    $tableLines.Add($docLines[$i]) | Out-Null
    $i++
  }
  $i--

  if ($tableLines.Count -lt 3) {
    continue
  }

  $headerCells = Split-MarkdownRow $tableLines[0]
  if ($headerCells.Count -eq 0) {
    continue
  }

  $statusIndex = -1
  $looksLikeConsumerTable = $false
  for ($h = 0; $h -lt $headerCells.Count; $h++) {
    if ($headerCells[$h] -match '^(Current\s+)?Status$') {
      $statusIndex = $h
    }
    if ($headerCells[$h] -match '^(Consumer|Surface|File|Runtime boundary|Candidate App Surface)$') {
      $looksLikeConsumerTable = $true
    }
  }

  if (-not $looksLikeConsumerTable) {
    continue
  }

  if ($statusIndex -lt 0) {
    $hasClaimLikePaths = $false
    for ($r = 2; $r -lt $tableLines.Count; $r++) {
      if (@(Extract-BacktickPaths $tableLines[$r]).Count -gt 0) {
        $hasClaimLikePaths = $true
        break
      }
    }

    if ($looksLikeConsumerTable -and $hasClaimLikePaths) {
      $invalidOrUnproven.Add('Consumer-style table references code files but has no Status column') | Out-Null
    }
    continue
  }

  for ($r = 2; $r -lt $tableLines.Count; $r++) {
    $cells = Split-MarkdownRow $tableLines[$r]
    if ($cells.Count -le $statusIndex) {
      continue
    }

    $status = ($cells[$statusIndex] -replace '`', '').Trim()
    $name = if ($cells.Count -gt 0) { ($cells[0] -replace '`', '').Trim() } else { "row-$r" }
    $files = Extract-BacktickPaths ($tableLines[$r])

    if ($allowedStatuses -notcontains $status) {
      $invalidOrUnproven.Add("Non-binary status '$status' in status table for '$name'") | Out-Null
      continue
    }

    $claims.Add((New-Claim -Name $name -Status $status -Files $files -BlockText ($tableLines[$r]) -SourceKind 'table')) | Out-Null
  }
}

$currentHeading = ''
$currentSectionStart = 0
for ($i = 0; $i -lt $docLines.Length; $i++) {
  if ($docLines[$i] -match '^###\s+(.*)$') {
    $currentHeading = $matches[1].Trim()
    $currentSectionStart = $i
    continue
  }

  if ($docLines[$i] -match '^\*\*Status:\*\*\s*(.+?)\s*$') {
    $status = ($matches[1] -replace '`', '').Trim()
    $blockLines = New-Object System.Collections.Generic.List[string]
    for ($k = $currentSectionStart; $k -le $i; $k++) {
      $blockLines.Add($docLines[$k]) | Out-Null
    }

    $j = $i + 1
    while ($j -lt $docLines.Length -and $docLines[$j] -notmatch '^###\s+' -and $docLines[$j] -notmatch '^\*\*Status:\*\*') {
      $blockLines.Add($docLines[$j]) | Out-Null
      $j++
    }

    $blockText = ($blockLines -join "`n")
    $fileLines = @($blockLines | Where-Object { $_ -match '^\*\*File:\*\*' })
    $files = if ($fileLines.Count -gt 0) {
      Extract-BacktickPaths ($fileLines -join "`n")
    } else {
      Extract-BacktickPaths $blockText
    }

    if ($allowedStatuses -notcontains $status) {
      $invalidOrUnproven.Add("Non-binary section status '$status' in section '$currentHeading'") | Out-Null
      continue
    }

    $claims.Add((New-Claim -Name $currentHeading -Status $status -Files $files -BlockText $blockText -SourceKind 'section')) | Out-Null
  }
}

for ($i = 0; $i -lt $docLines.Length; $i++) {
  if ($docLines[$i] -notmatch '^##\s+(.*)$') {
    continue
  }

  $sectionHeading = $matches[1].Trim()
  if ($sectionHeading -notmatch 'Consumer|Consumers|Forbidden Usage') {
    continue
  }

  $sectionLines = New-Object System.Collections.Generic.List[string]
  $j = $i + 1
  while ($j -lt $docLines.Length -and $docLines[$j] -notmatch '^##\s+') {
    $sectionLines.Add($docLines[$j]) | Out-Null
    $j++
  }

  $sectionText = $sectionLines -join "`n"
  $sectionFiles = @(Extract-BacktickPaths $sectionText)
  $hasSectionStatus = @($sectionLines | Where-Object { $_ -match '\*\*Status:\*\*' -or $_ -match '^\|.*Status.*\|$' }).Count -gt 0
  if ($sectionFiles.Count -gt 0 -and -not $hasSectionStatus) {
    $invalidOrUnproven.Add("Consumer section '$sectionHeading' references code files but has no explicit ACTIVE/NOT_CONSUMING statuses") | Out-Null
  }
}

$dedupedClaims = @()
$seenKeys = @{}
foreach ($claim in $claims) {
  $key = '{0}|{1}|{2}' -f $claim.Name, $claim.Status, (($claim.Files | Sort-Object) -join ',')
  if (-not $seenKeys.ContainsKey($key)) {
    $seenKeys[$key] = $true
    $dedupedClaims += $claim
  }
}
$claims = $dedupedClaims

$documentedFiles = New-Object System.Collections.Generic.HashSet[string]
foreach ($claim in $claims) {
  foreach ($file in $claim.Files) {
    [void]$documentedFiles.Add($file)
  }
}

foreach ($claim in $claims) {
  $claimSpeculativeHits = @()
  foreach ($phrase in $bannedPhrases) {
    $regex = [regex]::new("\b$([regex]::Escape($phrase))\b", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($regex.IsMatch($claim.BlockText)) {
      $claimSpeculativeHits += $phrase
    }
  }

  if ($claimSpeculativeHits.Count -gt 0) {
    $invalidOrUnproven.Add("Claim '$($claim.Name)' uses banned speculative wording: $($claimSpeculativeHits -join ', ')") | Out-Null
  }

  if ($claim.Files.Count -eq 0) {
    $invalidOrUnproven.Add("Claim '$($claim.Name)' has status '$($claim.Status)' but no code file path") | Out-Null
    continue
  }

  $existingFiles = @()
  foreach ($file in $claim.Files) {
    $full = Join-Path $repoRoot $file
    if (Test-Path $full) {
      $existingFiles += $file
    } else {
      $invalidOrUnproven.Add("Claim '$($claim.Name)' references missing file '$file'") | Out-Null
    }
  }

  if ($existingFiles.Count -eq 0) {
    continue
  }

  if ($claim.Status -eq 'ACTIVE') {
    $matchedActive = @($existingFiles | Where-Object { $activeCodeFiles.ContainsKey($_) })
    if ($matchedActive.Count -eq 0) {
      $invalidOrUnproven.Add("ACTIVE claim '$($claim.Name)' has no code-level domain-analysis proof in referenced files") | Out-Null
      continue
    }

    $hasInlineEvidence = $false
    foreach ($token in $evidenceTokens) {
      if ($claim.BlockText -match [regex]::Escape($token)) {
        $hasInlineEvidence = $true
        break
      }
    }

    if ($claim.SourceKind -eq 'section' -and -not $hasInlineEvidence -and $claim.BlockText -notmatch 'Exact usage:') {
      $invalidOrUnproven.Add("ACTIVE claim '$($claim.Name)' lacks exact symbol or usage proof in the doc text") | Out-Null
      continue
    }

    $validatedActive.Add("$($claim.Name) -> $($matchedActive -join ', ') [$($activeCodeFiles[$matchedActive[0]][0]) ]") | Out-Null
  }
  elseif ($claim.Status -eq 'NOT_CONSUMING') {
    $matchedActive = @($existingFiles | Where-Object { $activeCodeFiles.ContainsKey($_) })
    if ($matchedActive.Count -gt 0) {
      $invalidOrUnproven.Add("NOT_CONSUMING claim '$($claim.Name)' is contradicted by code in $($matchedActive -join ', ')") | Out-Null
    }
  }
}

foreach ($file in ($activeCodeFiles.Keys | Sort-Object)) {
  if (-not $documentedFiles.Contains($file)) {
    $missingButReal.Add("$file -> $($activeCodeFiles[$file][0])") | Out-Null
  }
}

$hasFailures = $invalidOrUnproven.Count -gt 0

Write-Host '=== DOC TRUTH AUDIT ==='
Write-Host "Document: $docRelativePath"
Write-Host ''

Write-Host 'VALIDATED_ACTIVE'
if ($validatedActive.Count -gt 0) {
  $validatedActive | ForEach-Object { Write-Host "  - $_" }
} else {
  Write-Host '  - none'
}
Write-Host ''

Write-Host 'INVALID_OR_UNPROVEN'
if ($invalidOrUnproven.Count -gt 0) {
  $invalidOrUnproven | ForEach-Object { Write-Host "  - $_" }
} else {
  Write-Host '  - none'
}
Write-Host ''

Write-Host 'MISSING_BUT_REAL'
if ($missingButReal.Count -gt 0) {
  $missingButReal | ForEach-Object { Write-Host "  - $_" }
} else {
  Write-Host '  - none'
}
Write-Host ''

Write-Host 'FINAL_VERDICT'
if ($hasFailures) {
  Write-Host '  - FAIL'
  exit 1
}

Write-Host '  - PASS'
exit 0
