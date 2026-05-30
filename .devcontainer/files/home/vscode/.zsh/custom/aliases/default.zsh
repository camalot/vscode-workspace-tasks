#!/usr/bin/env zsh
# shellcheck disable=SC1071

alias ~='cd ~'
alias .='pwd'
alias ..='cd ..'
alias ...='cd ../..'
alias ....='cd ../../..'
alias .....='cd ../../../..'
alias ......='cd ../../../../..'
alias .2='cd -2'
alias .3='cd -3'
alias .4='cd -4'
alias .5='cd -5'
alias .6='cd -6'
alias .7='cd -7'
alias .8='cd -8'
alias .9='cd -9'

# function expand-dots() {
#   if [[ $LBUFFER =~ '\.\.\.+$' ]]; then
#     LBUFFER+='/..'
#   else
#     LBUFFER+='.'
#   fi
# }
# zle -N expand-dots
# bindkey '.' expand-dots

alias dev='cd /workspace'
alias ws='cd /workspace'

if command -v eza >/dev/null 2>&1; then
  alias l="eza -lah --color=auto --icons=auto"
  alias ls="eza -ah --color=auto --icons=auto"
  alias ll="eza -lAh --color=auto --icons=auto"
  alias la="eza -lah --color=auto --icons=auto"
  alias lsd="eza -ah --only-dirs --icons=auto --classify=auto"
  alias lld="eza -lah --only-dirs --icons=auto --classify=auto"
else
  # Detect which `ls` flavor is in use
  if ls --color >/dev/null 2>&1; then # GNU `ls`
    colorflag="--color"
    alias s_lsnc="command ls --color=never"
  else # macOS `ls`
    colorflag="-G"
    alias s_lsnc="command ls"
  fi

  # List all files colorized in long format
  # shellcheck disable=SC2139
  alias l="ls -lFh ${colorflag}"
  # shellcheck disable=SC2139

  alias ll="ls -lFAh ${colorflag}"
  # List all files colorized in long format, including dot files
  # shellcheck disable=SC2139
  alias la="ls -laFh ${colorflag}"

  # List only directories
  # shellcheck disable=SC2139
  alias lsd="ls -lFh ${colorflag} | grep --color=never '^d'"

  # Always use color output for `ls`
  # shellcheck disable=SC2139
  alias ls="command ls -h ${colorflag}"
fi

# Enable aliases to be sudoed
alias sudo='sudo '

alias du="du -h"
alias df="df -h"

alias epoch='date +"%s"'
alias mkdir="mkdir -pv"
alias wget="wget -c"

# IP addresses
alias whatsmyip="dig +short myip.opendns.com @resolver1.opendns.com"
alias ifconfigme="curl -s ifconfig.me"
alias ips="ip addr show | grep -o 'inet6\? \(addr:\)\?\s\?\(\(\([0-9]\+\.\)\{3\}[0-9]\+\)\|[a-fA-F0-9:]\+\)' | awk '{ sub(/inet6? (addr:)? ?/, \"\"); print }'"
# Canonical hex dump; some systems have this symlinked
command -v hd > /dev/null || alias hd="hexdump -C"

# macOS has no `md5sum`, so use `md5` as a fallback
command -v md5sum > /dev/null || alias md5sum="md5"

# macOS has no `sha1sum`, so use `shasum` as a fallback
command -v sha1sum > /dev/null || alias sha1sum="shasum"

command -v sha256sum > /dev/null || alias sha256sum="shasum -a 256"

command -v bat   >/dev/null && alias cat='bat --paging=never'
command -v btop  >/dev/null && alias top='btop'

# Intuitive map function
# For example, to list all directories that contain a certain file:
# find . -name .gitattributes | map dirname
alias map="xargs -n1";
