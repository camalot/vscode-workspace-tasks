typeset -g POWERLEVEL9K_INSTANT_PROMPT=off

if [[ -f $HOME/.devcontainer/.env ]]; then
  # echo with yellow color
  echo -e "\033[0;33mSourcing $HOME/.devcontainer/.env\033[0m"
  source $HOME/.devcontainer/.env
fi

source $HOME/.antigen/antigen.zsh

antigen use oh-my-zsh

# Enable Powerlevel10k instant prompt. Should stay close to the top of ~/.zshrc.
# Initialization code that may require console input (password prompts, [y/n]
# confirmations, etc.) must go above this block; everything else may go below.
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi

if [[ -f "${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/completions/default.zsh" ]]; then
  source "${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/completions/default.zsh";
fi

export PATH=$HOME/.local/bin/:$HOME/bin:$PATH

# If you come from bash you might have to change your $PATH.
# export PATH=$HOME/bin:/usr/local/bin:$PATH

HISTFILE=$HOME/.zsh/.zsh_history

# Path to your oh-my-zsh installation.
export ZSH="$HOME/.oh-my-zsh"
ZSH_THEME="powerlevel10k/powerlevel10k"

# Set list of themes to pick from when loading at random
# Setting this variable when ZSH_THEME=random will cause zsh to load
# a theme from this variable instead of looking in $ZSH/themes/
# If set to an empty array, this variable will have no effect.
# ZSH_THEME_RANDOM_CANDIDATES=( "robbyrussell" "agnoster" )

# Uncomment the following line to use case-sensitive completion.
# CASE_SENSITIVE="true"

# Uncomment the following line to use hyphen-insensitive completion.
# Case-sensitive completion must be off. _ and - will be interchangeable.
# HYPHEN_INSENSITIVE="true"

# Uncomment the following line to disable bi-weekly auto-update checks.
# DISABLE_AUTO_UPDATE="true"

# Uncomment the following line to automatically update without prompting.
# DISABLE_UPDATE_PROMPT="true"

# Uncomment the following line to change how often to auto-update (in days).
# export UPDATE_ZSH_DAYS=13

# Uncomment the following line if pasting URLs and other text is messed up.
# DISABLE_MAGIC_FUNCTIONS="true"

# Uncomment the following line to disable colors in ls.
# DISABLE_LS_COL ~ORS="true"

# Uncomment the following line to disable auto-setting terminal title.
# DISABLE_AUTO_TITLE="true"

# Uncomment the following line to enable command auto-correction.
# ENABLE_CORRECTION="true"

# Uncomment the following line to display red dots whilst waiting for completion.
# Caution: this setting can cause issues with multiline prompts (zsh 5.7.1 and newer seem to work)
# See https://github.com/ohmyzsh/ohmyzsh/issues/5765
# COMPLETION_WAITING_DOTS="true"

# Uncomment the following line if you want to disable marking untracked files
# under VCS as dirty. This makes repository status check for large repositories
# much, much faster.
# DISABLE_UNTRACKED_FILES_DIRTY="true"

# Uncomment the following line if you want to change the command execution time
# stamp shown in the history command output.
# You can set one of the optional three formats:
# "mm/dd/yyyy"|"dd.mm.yyyy"|"yyyy-mm-dd"
# or set a custom format using the strftime function format specifications,
# see 'man strftime' for details.
# HIST_STAMPS="mm/dd/yyyy"

# Would you like to use another custom folder than $ZSH/custom?
# ZSH_CUSTOM=/path/to/new-custom-folder

# Which plugins would you like to load?
# Standard plugins can be found in $ZSH/plugins/
# Custom plugins may be added to $ZSH_CUSTOM/plugins/
# Example format: plugins=(rails git textmate ruby lighthouse)
# Add wisely, as too many plugins slow down shell startup.
# plugins=(
#   git
#   vscode
#   docker
#   helm
#   zsh-syntax-highlighting
#   zsh-autosuggestions
#   history-substring-search
#   zsh-z
#   common-aliases
#   dotenv
#   emoji
#   sudo
# )

antigen theme romkatv/powerlevel10k
antigen bundle git
antigen bundle vscode
antigen bundle docker
antigen bundle helm
antigen bundle zsh-users/zsh-syntax-highlighting
antigen bundle zsh-users/zsh-autosuggestions
antigen bundle zsh-users/history-substring-search
antigen bundle rupa/z
antigen bundle zsh-users/common-aliases
antigen bundle b4b4r07/emoji-cli
antigen bundle ohmyzsh/plugins/sudo

source $ZSH/oh-my-zsh.sh

[[ ! -f ~/.p10k.zsh ]] || source ~/.p10k.zsh

antigen apply

__sources=("aliases" "exports" "functions", "sources")

for source in $__sources; do
  if [[ -d $HOME/.zsh/custom/$source ]]; then
    # if $HOME/.zsh/custom/$source/*.zsh matches any files, source them. if not skip
    if [[ -n $(ls -A $HOME/.zsh/custom/$source/*.zsh 2>/dev/null) ]]; then
      for file in $HOME/.zsh/custom/$source/*.zsh; do
        source $file
      done
    fi
  fi
done

for source in $__sources; do
  if [[ -d $HOME/.devcontainer/custom/$source ]]; then
    if [[ -n $(ls -A $HOME/.devcontainer/custom/$source/*.zsh 2>/dev/null) ]]; then
      # if $HOME/.devcontainer/custom/$source/*.zsh matches any files, source them
      for file in $HOME/.devcontainer/custom/$source/*.zsh; do
        source $file
      done
    fi
  fi
done
