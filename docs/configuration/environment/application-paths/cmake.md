---
layout: default
title: 🔨 CMake
parent: 📂 Application Paths
grand_parent: 🌐 Environment
nav_order: 3
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# CMake Settings
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

### workspaceTasks.applicationPath.cmake

| | |
| --- | --- |
| **Type:** | `string` |
| **Default:** | `"cmake"` |
| **Scope:** | `resource` |

Path to the CMake executable. On Windows, `.exe` is appended automatically when the path ends with `cmake`.

**Example:**

```json
{
  "workspaceTasks.applicationPath.cmake": "cmake"
}
```

---

### workspaceTasks.cmake.buildDirectory

| | |
| --- | --- |
| **Type:** | `string` |
| **Default:** | `"build"` |
| **Scope:** | `resource` |

The directory (relative to the workspace root) where CMake build output is placed. This is the directory passed to the `-B` flag when configuring a project, and is where the generated build files will be written.

**Example:**

```json
{
  "workspaceTasks.cmake.buildDirectory": "build"
}
```

---

### workspaceTasks.cmake.buildType

| | |
| --- | --- |
| **Type:** | `string` |
| **Default:** | `"Debug"` |
| **Options:** | `"Debug"`, `"Release"`, `"RelWithDebInfo"`, `"MinSizeRel"` |
| **Scope:** | `resource` |

The default CMake build type. This value is passed as `-DCMAKE_BUILD_TYPE` during configuration.

| | |
| --- | --- |
| **Debug** | Debug information included, no optimization |
| **Release** | Fully optimized, no debug information |
| **RelWithDebInfo** | Optimized with debug information |
| **MinSizeRel** | Optimized for minimum binary size |

**Example:**

```json
{
  "workspaceTasks.cmake.buildType": "Release"
}
```

---

### workspaceTasks.cmake.generator

| | |
| --- | --- |
| **Type:** | `string` |
| **Default:** | `""` |
| **Scope:** | `resource` |

The CMake generator to use (e.g. `"Ninja"`, `"Unix Makefiles"`, `"Visual Studio 17 2022"`). Leave empty to use CMake's default generator for the current platform.

**Example:**

```json
{
  "workspaceTasks.cmake.generator": "Ninja"
}
```

---

## Related

- [CMake task type](../../../task-types/cmake)
