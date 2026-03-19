param([string]$WorkDir)
Set-Location -Path $WorkDir
& claude --dangerously-skip-permissions $args[0]
