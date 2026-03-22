$env:VIRTUAL_ENV_DISABLE_PROMPT = 1;

if (!(Get-Module -ListAvailable -Name PSReadLine)) {
  Install-Module -Name PSReadLine -AllowPrerelease -Scope CurrentUser -Force -SkipPublisherCheck;
}


$modules = @("posh-git");
$modules | ForEach-Object {
  if ( !(Get-Module -ListAvailable -Name "$_") ) {
    Install-Module $_ -Scope CurrentUser -Force;
  }
};

$modules | ForEach-Object {
  Import-Module -Name $_;
}

$host.privatedata.ErrorForegroundColor = 'Magenta';
$host.privatedata.ErrorBackgroundColor = 'Black';
$host.privatedata.WarningForegroundColor = 'Yellow';
$host.privatedata.WarningBackgroundColor = 'Black';
$host.privatedata.DebugForegroundColor = 'DarkGray';
$host.privatedata.DebugBackgroundColor = 'Black';
$host.privatedata.VerboseForegroundColor = 'White';
$host.privatedata.VerboseBackgroundColor = 'Black';
$host.privatedata.ProgressForegroundColor = 'DarkBlue';
$host.privatedata.ProgressBackgroundColor = 'DarkCyan';

# add ~/bin to the path
$env:PATH += ";$Env:HOME\bin;$Env:HOME\.local\bin";

oh-my-posh init pwsh --config $Env:HOME/.config/powershell/darthminos.omp.json | Invoke-Expression;

. "$HOME/.cargo/env.ps1"
