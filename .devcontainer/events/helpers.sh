#!/usr/bin/env bash
# shellcheck disable=SC1090

COLOR_RESET="\033[0m"
COLOR_GREEN="\033[32m"
COLOR_BLUE="\033[34m"
COLOR_YELLOW="\033[33m"
COLOR_RED="\033[31m"
COLOR_WHITE="\033[37m"
# BG_COLOR_GREEN="\033[42m"
# BG_COLOR_BLUE="\033[44m"
# BG_COLOR_YELLOW="\033[43m"
TEXT_BOLD="\033[1m"
BG_COLOR_RED="\033[41m\033[37m"


function _get_timestamp() {
  date +"%Y-%m-%d %H:%M:%S"
}

function _get_color() {
  local color_name="$1"
  case "$color_name" in
    "green") echo -e "${COLOR_GREEN}" ;;
    "blue") echo -e "${COLOR_BLUE}" ;;
    "red") echo -e "${COLOR_RED}" ;;
    "yellow") echo -e "${COLOR_YELLOW}" ;;
    "reset") echo -e "${COLOR_RESET}" ;;
    *) echo -e "${COLOR_RESET}" ;;
  esac
}

function _level_to_color() {
  local level="$1"
  case "$level" in
    "TRACE") echo -e "${COLOR_RESET}" ;;
    "DEBUG") echo -e "${COLOR_BLUE}" ;;
    "INFO") echo -e "${COLOR_GREEN}" ;;
    "WARN") echo -e "${COLOR_YELLOW}" ;;
    "ERROR") echo -e "${COLOR_RED}" ;;
    "FATAL") echo -e "${BG_COLOR_RED}${TEXT_BOLD}${COLOR_WHITE}" ;;
    *) echo -e "${COLOR_RESET}" ;;
  esac
}

function __dch_log() {
  local level
  if [[ "$1" =~ ^\[(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\]$ ]]; then
    level="${BASH_REMATCH[1]}"
    shift
  else
    level="INFO"
  fi
  local redirect="false"
  if [[ "$1" == "--redirect" ]]; then
    redirect="true"
    shift
  fi
  local no_color="false"
  if [[ "$1" == "--no-color" ]]; then
    no_color="true"
    shift
  fi

  local no_timestamp="false"
  if [[ "$1" == "--no-timestamp" ]] || [[ "$1" == "-T" ]]; then
    no_timestamp="true"
    shift
  fi

  local timestamp
  if [[ "$no_timestamp" == "true" ]]; then
    timestamp=""
  else
    timestamp="[$(_get_timestamp)] "
  fi
  local color
  if [[ "$no_color" == "true" ]]; then
    color=""
  else
    color="$(_level_to_color "$level")"
  fi

  # if error or fatal, always redirect to stderr
  if [[ "$level" == "ERROR" || "$level" == "FATAL" ]]; then
    redirect="true"
  fi

  local message="$*"
  if [[ "$redirect" == "true" ]]; then
    echo -e "${color}${timestamp}[${level}] ${message}${COLOR_RESET}" >&2
  else
    echo -e "${color}${timestamp}[${level}] ${message}${COLOR_RESET}"
  fi
}

function trace() { __dch_log "TRACE" "$@"; }
function debug() { __dch_log "DEBUG" "$@"; }
function info() { __dch_log "INFO" "$@"; }
function warn() { __dch_log "WARN" "$@"; }
function error() { __dch_log "ERROR" "$@"; }
function fatal() { __dch_log "FATAL" "$@"; }
