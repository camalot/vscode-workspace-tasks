---
layout: default
title: Contributing
nav_order: 100
has_children: true
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Contributing
{: .no_toc }

Contributions are welcome! If you'd like to improve Workspace Tasks, here's how to get involved.

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## How to Contribute

- **Report Issues** — Found a bug or have a feature request? [Open an issue](https://github.com/camalot/vscode-workspace-tasks/issues) on GitHub
- **Submit Pull Requests** — Fork the repository, make your changes, and submit a PR
- **Improve Documentation** — Help make the docs clearer or add examples
- **Share Feedback** — Let us know how you use the extension and what could be better

---

## Development Setup

```bash
# Clone the repository
git clone https://github.com/camalot/vscode-workspace-tasks.git
cd vscode-workspace-tasks

# Install dependencies
npm install

# Open in Visual Studio Code
code .

# Start the watch task to compile TypeScript
npm run watch

# Press F5 to launch the Extension Development Host
```

---

## Guidelines

- Follow the existing code style and conventions
- Write clear, descriptive commit messages using [Conventional Commits](https://www.conventionalcommits.org/)
- Add tests for new features when applicable — new code should have 100% coverage
- Update documentation for any user-facing changes
- Ensure all tests pass before submitting: `npm test`

---

## Project Structure

{: .tree}

``` text
src/                   TypeScript source code
├── commands/          Command implementations
├── common/            Shared base classes
├── libs/              Utility libraries
├── providers/         Task providers for each task type
├── services/          Shared services (caching, configuration, etc.)
└── test/              Test files

res/                   Resources
├── assets/images/     Screenshots and UI images
├── icons/             Task type icons (light & dark)
├── schemas/           JSON schemas
├── syntaxes/          Language grammars
└── webviews/          HTML webviews

docs/                  Documentation (this site)
sample/                Sample workspace for testing
```

---

## Running Tests

```bash
# Run all tests
npm test

# Run tests with coverage
npm run vscode:test:coverage
```

Test reports are generated to:

- `coverage/lcov.info` — Coverage data
- `coverage/junit.xml` — JUnit test results

The goal is **90% code coverage** for existing files. New code should achieve **100% coverage**.

---

## Contributors

<!-- markdownlint-disable MD033 -->
<a href="https://github.com/camalot/vscode-workspace-tasks/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=camalot/vscode-workspace-tasks" alt="Contributors" />
</a>
<!-- markdownlint-enable MD033 -->

Made with [contrib.rocks](https://contrib.rocks).

---

## License

This project is licensed under the [Apache 2.0 License](https://github.com/camalot/vscode-workspace-tasks/blob/develop/LICENSE).

---

## Code of Conduct

Please read the [Code of Conduct](https://github.com/camalot/vscode-workspace-tasks/blob/develop/CODE_OF_CONDUCT.md) before contributing.
