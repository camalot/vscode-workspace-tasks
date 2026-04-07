---
layout: default
title: CMake
parent: 📱 Supported Task Types
nav_order: 8
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# CMake
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

[CMake](https://cmake.org/) is a cross-platform build-system generator. Projects
describe their build process in `CMakeLists.txt` files; CMake translates those
descriptions into build files for the native tool on each platform (Make, Ninja,
Visual Studio, Xcode, etc.).

## How It Works

The extension scans every `CMakeLists.txt` it finds in the workspace and extracts
two kinds of named targets:

| Declaration | Description |
| --- | --- |
| `add_custom_target(Name ...)` | Custom build rules that do not produce a file |
| `add_executable(Name ...)` | Binary executable targets |

Each target is surfaced as a task. When run, the extension executes:

```shell
cmake --build <buildDirectory> --target <Name>
```

where `<buildDirectory>` defaults to a `build/` subdirectory next to the
`CMakeLists.txt` file.

---

## File Pattern

```text
**/CMakeLists.txt
```

---

## Configuration

All settings are under the `workspaceTasks` namespace and support workspace- and
folder-level overrides (`"scope": "resource"`).

### `workspaceTasks.applicationPath.cmake`

| Property | Value |
| --- | --- |
| Type | `string` |
| Default | `cmake` |
| Scope | resource |

Path to the `cmake` executable. Accepts `~/` expansion and, on Windows,
automatically appends `.exe` when the path ends with `cmake`.

```json
{
  "workspaceTasks.applicationPath.cmake": "/usr/local/bin/cmake"
}
```

---

### `workspaceTasks.cmake.buildDirectory`

| Property | Value |
| --- | --- |
| Type | `string` |
| Default | `build` |
| Scope | resource |

Path to the CMake binary (build) directory. Relative paths are resolved against
the directory that contains the `CMakeLists.txt` file. Absolute paths are used
as-is.

```json
{
  "workspaceTasks.cmake.buildDirectory": "out/debug"
}
```

---

### `workspaceTasks.cmake.buildType`

| Property | Value |
| --- | --- |
| Type | `string` (enum) |
| Default | `Debug` |
| Scope | resource |
| Options | `Debug`, `Release`, `RelWithDebInfo`, `MinSizeRel` |

Build configuration to use. This value is passed as `-DCMAKE_BUILD_TYPE` during
the configure step and as `--config` during multi-configuration builds.

```json
{
  "workspaceTasks.cmake.buildType": "Release"
}
```

| Value | Description |
| --- | --- |
| `Debug` | No optimization, full debug information |
| `Release` | Full optimisation, no debug information |
| `RelWithDebInfo` | Optimized with debug information |
| `MinSizeRel` | Optimized for minimum binary size |

---

### `workspaceTasks.cmake.generator`

| Property | Value |
| --- | --- |
| Type | `string` |
| Default | `""` (platform default) |
| Scope | resource |

CMake generator to use when configuring the project. Leave empty to use the
platform default. Common values:

| Platform | Generator |
| --- | --- |
| Linux / macOS | `Ninja`, `Unix Makefiles` |
| Windows | `Ninja`, `Visual Studio 17 2022`, `NMake Makefiles` |
| macOS | `Xcode` |

```json
{
  "workspaceTasks.cmake.generator": "Ninja"
}
```

---

## Enabling / Disabling

CMake task discovery is enabled by default. To disable it:

```json
{
  "workspaceTasks.enabledTaskTypes": {
    "cmake": false
  }
}
```

---

## Configuring Your Project

A `CMakeLists.txt` that exposes tasks to the extension needs at least one
`add_executable` or `add_custom_target` declaration:

```cmake
cmake_minimum_required(VERSION 3.16)
project(MyApp)

# Executable target — becomes a task
add_executable(myapp src/main.cpp)

# Custom target — becomes a task
add_custom_target(run
  COMMAND myapp
  DEPENDS myapp
  COMMENT "Running myapp"
)

add_custom_target(lint
  COMMAND clang-tidy src/main.cpp
  COMMENT "Running clang-tidy"
)
```

The task panel will show: `myapp`, `run`, `lint`.

---

## Typical Workflow

```bash
# 1. Configure the project (run once)
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Debug

# 2. Build a specific target (what the extension does on task run)
cmake --build build --target run

# 3. Run tests with CTest
ctest --test-dir build

# 4. Install
cmake --install build
```

---

## Notes

- **Configure step is not automatic.** You must run `cmake -S . -B <buildDir>`
  manually (or via a custom target) before tasks can be built.
- `add_library` targets are intentionally excluded — they are not directly
  runnable through `cmake --build --target` in the way executables and custom
  targets are.
- `add_test` declarations (CTest tests) are not surfaced as individual tasks
  because they require a separate `ctest` invocation; they are not CMake build
  targets.
- Inline `#` comments in `CMakeLists.txt` are stripped before parsing so
  commented-out target declarations are correctly ignored.

---

## Further Reading

- [CMake Documentation](https://cmake.org/documentation/)
- [CMake Reference — `add_custom_target`](https://cmake.org/cmake/help/latest/command/add_custom_target.html)
- [CMake Reference — `add_executable`](https://cmake.org/cmake/help/latest/command/add_executable.html)
- [CMake Reference — `cmake --build`](https://cmake.org/cmake/help/latest/manual/cmake.1.html#build-a-project)
