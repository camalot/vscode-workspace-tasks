# Use Ruby 3.3 base image from the official VS Code devcontainer library
# which includes a non-root "vscode" user and some common tools.
FROM mcr.microsoft.com/devcontainers/ruby:3

ARG USERNAME=vscode

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

USER root

RUN if id -u "${USERNAME}" >/dev/null 2>&1; then \
    usermod -m -d /home/${USERNAME} -s /bin/zsh "${USERNAME}"; \
  elif id -u ubuntu >/dev/null 2>&1; then \
    usermod -l "${USERNAME}" ubuntu; \
    if getent group ubuntu >/dev/null 2>&1; then groupmod -n "${USERNAME}" ubuntu; fi; \
    usermod -m -d /home/${USERNAME} -s /bin/zsh "${USERNAME}"; \
  else \
    useradd -m -s /bin/zsh "${USERNAME}"; \
  fi \
  && mkdir -p /home/${USERNAME}/bin/ /home/${USERNAME}/.zsh/ /home/${USERNAME}/.zsh-history/ /home/${USERNAME}/.ssh \
  && chown -R ${USERNAME}:${USERNAME} /home/${USERNAME}


# Remove the stale Yarn apt repo that ships in the base image (its GPG key is
# expired/missing and causes `apt update` to fail).
RUN rm -f /etc/apt/sources.list.d/yarn.list \
    /usr/share/keyrings/yarnkey.gpg \
    /etc/apt/keyrings/yarn*.gpg 2>/dev/null || true

RUN apt-get update \
  && apt-get install -y --no-install-recommends apt-utils xauth apt-transport-https 2>&1 \
  && apt-get install -y --no-install-recommends git iproute2 procps lsb-release sudo gnupg 2>&1 \
  && apt-get install -y --no-install-recommends curl wget zip unzip dnsutils jq bat fzf zoxide 2>&1 \
  && apt-get install -y --no-install-recommends nano vim zsh ripgrep cmake imagemagick 2>&1 \
  && apt-get install -y --no-install-recommends python3-full python3-pip python3-venv 2>&1 \
  && apt-get install -y --no-install-recommends \
    xvfb libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
    libasound2 libpango-1.0-0 libpangocairo-1.0-0 libgtk-3-0 \
    libgdk-pixbuf-xlib-2.0-0 libx11-6 libxss1 libxtst6 libdbus-1-3 2>&1\
  && YQ_VERSION=$(curl -s "https://api.github.com/repos/mikefarah/yq/releases/latest" | jq -r ".tag_name" | sed 's/v//') \
  && curl -X GET -Ls "https://github.com/mikefarah/yq/releases/download/v${YQ_VERSION}/yq_linux_amd64" -o /usr/bin/yq \
  && chmod +x /usr/bin/yq \
  && apt-get autoremove -y \
  && apt-get clean -y \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /usr/local/bin && \
  ln -s /usr/bin/batcat /usr/local/bin/bat \
  && echo ${USERNAME} ALL=\(root\) NOPASSWD:ALL > /etc/sudoers.d/${USERNAME} \
  && chmod 0440 /etc/sudoers.d/${USERNAME}

RUN curl -fsSL "https://deb.nodesource.com/setup_25.x" | bash - \
  && apt-get install -y nodejs \
  && apt-get remove -y yarn \
  && node -v \
  && npm install -g npm@11.11.1 \
  && npm install -g pnpm yarn \
  && apt-get clean && rm -rf /var/lib/apt/lists/* \
  && export NVM_DIR="/home/${USERNAME}/.nvm" \
  && for i in 1 2 3 4 5; do \
    git clone --depth 1 --branch v0.40.4 https://github.com/nvm-sh/nvm.git "${NVM_DIR}" && break || \
    { rm -rf "${NVM_DIR}"; sleep $((i * 2)); }; \
  done \
  && test -f "${NVM_DIR}/nvm.sh" \
  && chown -R ${USERNAME}:${USERNAME} "${NVM_DIR}"


RUN mkdir -p -m 755 /etc/apt/keyrings \
  && out=$(mktemp) && curl -fsSL -o $out https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  && cat $out | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && mkdir -p -m 755 /etc/apt/sources.list.d \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && apt-get update \
  && apt-get install -y gh \
  && apt-get clean -y \
  && rm -rf /var/lib/apt/lists/*


# Make sure bundler is available globally (should be by default, but safe to
# reinstall/update).
RUN gem install bundler

# The UI/integration test framework (`vscode-extension-tester`) requires a Java
# runtime. Install Temurin 17 (Eclipse Adoptium) since openjdk-17-jdk is not
# available in the base image's repos.
RUN apt-get update && \
    apt-get install -y --no-install-recommends apt-transport-https gnupg && \
    curl -fsSL https://packages.adoptium.net/artifactory/api/gpg/key/public \
        | gpg --dearmor | tee /etc/apt/trusted.gpg.d/adoptium.gpg > /dev/null && \
    echo "deb https://packages.adoptium.net/artifactory/deb $(awk -F= '/^VERSION_CODENAME/{print $2}' /etc/os-release) main" \
        | tee /etc/apt/sources.list.d/adoptium.list && \
    apt-get update && \
    apt-get install -y temurin-17-jdk && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install PowerShell
RUN PWSH_TAG=$(curl -s "https://api.github.com/repos/PowerShell/PowerShell/releases/latest" | jq -r ".tag_name") && \
  PWSH_VERSION=${PWSH_TAG#v} && \
  curl -fsSL "https://github.com/PowerShell/PowerShell/releases/download/${PWSH_TAG}/powershell-${PWSH_VERSION}-linux-x64.tar.gz" -o /tmp/powershell.tar.gz && \
  mkdir -p /opt/microsoft/powershell/7 && \
  tar zxf /tmp/powershell.tar.gz -C /opt/microsoft/powershell/7 && \
  chmod +x /opt/microsoft/powershell/7/pwsh && \
  ln -s /opt/microsoft/powershell/7/pwsh /usr/bin/pwsh && \
  ln -s /opt/microsoft/powershell/7/pwsh /usr/bin/powershell && \
  rm /tmp/powershell.tar.gz && \
  curl -fsSL https://gh.io/copilot-install | bash

# Install dotnet - used for supporting Cake build scripts
RUN curl -fsSL https://packages.microsoft.com/config/debian/13/packages-microsoft-prod.deb -o /tmp/packages-microsoft-prod.deb \
  && dpkg -i /tmp/packages-microsoft-prod.deb \
  && rm /tmp/packages-microsoft-prod.deb \
  && apt-get update \
  && apt-get install -y dotnet-sdk-10.0 \
  && dotnet tool install Cake.Tool --version 6.1.0


# install task (https://taskfile.dev/), a modern alternative to Make written in Go
# install gitlab-ci-local (https://gitlab-ci-local.dev/), a tool to run GitLab CI pipelines locally
RUN curl -1sLf 'https://dl.cloudsmith.io/public/task/task/setup.deb.sh' | bash - && \
  curl -fsSL "https://gitlab-ci-local-ppa.firecow.dk/gitlab-ci-local.sources" -o "/etc/apt/sources.list.d/gitlab-ci-local.sources" \
  && apt-get update \
  && apt-get install -y gitlab-ci-local task \
  && curl -fLSs https://raw.githubusercontent.com/CircleCI-Public/circleci-cli/main/install.sh | bash

WORKDIR /workspace

# Add venv to PATH for all users
ENV PATH="/opt/venv/bin:$PATH"
RUN chown -R ${USERNAME}:${USERNAME} /home/${USERNAME}/bin/ \
  && chown -R ${USERNAME}:${USERNAME} /home/${USERNAME}/.zsh/ \
  && chown -R ${USERNAME}:${USERNAME} /home/${USERNAME}/.zsh-history/ \
  && find /home/${USERNAME}/bin -maxdepth 1 -type f -exec chmod +x {} +

RUN ([ ! -f /usr/bin/python ] && [ ! -l /usr/bin/python ] && [ -f /usr/bin/python3 ] && ln -s /usr/bin/python3 /usr/bin/python || true) \
  && ([ ! -f /usr/bin/pip ] && [ ! -l /usr/bin/pip ] && [ -f /usr/bin/pip3 ] && ln -s /usr/bin/pip3 /usr/bin/pip || true)

USER ${USERNAME}

# install user tools
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
  && ACT_VERSION=$(curl -s "https://api.github.com/repos/nektos/act/releases/latest" | jq -r ".tag_name") \
  && curl -fsSL "https://github.com/nektos/act/releases/download/${ACT_VERSION}/act_Linux_x86_64.tar.gz" | tar -xz -C "/home/${USERNAME}/bin" \
  && curl -fsSL "https://uploader.codecov.io/latest/linux/codecov" -o "/home/${USERNAME}/bin/codecov" \
  && chmod +x "/home/${USERNAME}/bin/codecov" \
  && pip install --user pipx --break-system-packages && /home/${USERNAME}/.local/bin/pipx ensurepath && /home/${USERNAME}/.local/bin/pipx install bitbucket-pipeline-runner

COPY files/home/vscode/ /home/${USERNAME}/

RUN git clone --depth=1 'https://github.com/romkatv/powerlevel10k.git' "${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/powerlevel10k" \
  && mkdir -p "/home/${USERNAME}/.antigen" "/home/${USERNAME}/.zsh/custom/aliases" "/home/${USERNAME}/.devcontainer" "/home/${USERNAME}/bin" \
  && curl -fsSL https://raw.githubusercontent.com/zsh-users/antigen/master/bin/antigen.zsh > "/home/${USERNAME}/.antigen/antigen.zsh"

# Reset SHELL to prevent pipefail from breaking devcontainer features installation
SHELL ["/bin/sh", "-c"]
