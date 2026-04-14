---
layout: default
title: ✏️ Contributing
nav_order: 99
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

1. **Fork the repository**: `gh repo fork camalot/vscode-workspace-tasks`
2. **Open in Visual Studio Code**: `code vscode-workspace-tasks`
3. **Reopen in Dev Container**: When prompted, reopen the project in the recommended dev container for a consistent development environment
4. **Install dependencies**: `npm install`
5. **Run the extension**: Press `F5` to launch a new Extension Development Host instance with the extension loaded
6. **Run tests**: `npm test` to run unit tests and `npm run test:coverage` for coverage reports

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
docs/                  Documentation (this site)
├── _includes/         Reusable markdown snippets
├── _plugins/          Jekyll plugins for custom functionality
├── _sass/             Stylesheets for custom styling
├── configuration/     Configuration settings documentation
├── contributing/      Contributing guidelines
├── features/          Feature documentation
├── getting-started/   Getting started guides
├── performance/       Performance optimization guides
├── task-types/        Task types documentation
└── troubleshooting/   Troubleshooting guides

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

Please read the [Code of Conduct](contributing/code_of_conduct) before contributing.
