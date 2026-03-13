#!/usr/bin/env zsh
# shellcheck disable=SC1071

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

# Enable aliases to be sudoed
alias sudo='sudo '

alias du="du -h"
alias df="df -h"

# IP addresses
alias whatsmyip="dig +short myip.opendns.com @resolver1.opendns.com"
alias ifconfigme="curl -s ifconfig.me"
alias ips="ip addr show | grep -o 'inet6\? \(addr:\)\?\s\?\(\(\([0-9]\+\.\)\{3\}[0-9]\+\)\|[a-fA-F0-9:]\+\)' | awk '{ sub(/inet6? (addr:)? ?/, \"\"); print }'"
