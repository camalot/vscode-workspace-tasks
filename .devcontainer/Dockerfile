# Use Ruby 3.3 base image from the official VS Code devcontainer library
# which includes a non-root "vscode" user and some common tools.
FROM mcr.microsoft.com/devcontainers/ruby:3.3

# Install Node.js LTS (needed for extension development / npm scripts)
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g yarn pnpm \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Make sure bundler is available globally (should be by default, but safe to
# reinstall/update).
RUN gem install bundler

# The UI/integration test framework (`vscode-extension-tester`) requires a Java
# runtime. Install an OpenJDK package so that `npm run test:ui` works in the
# container.
RUN apt-get update && \
    apt-get clean && rm -rf /var/lib/apt/lists/*
