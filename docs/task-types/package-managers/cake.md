---
layout: default
title: 🍰 Cake
parent: 📦 Packages & Build Tools
nav_order: 1
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Cake
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

[Cake](https://cakebuild.net/) (C# Make) is a cross-platform build automation
tool that uses a C# DSL for defining build tasks. Cake scripts are `.cake`
files and tasks are declared using the `Task("TaskName")` API.

Cake is installed as a .NET global or local tool and invoked via `dotnet cake`.
No application path configuration is required — Cake must be installed using the
.NET package manager (`dotnet tool install`).

## How It Works

The extension scans every `*.cake` file in the workspace and extracts any
top-level `Task("...")` declarations. Each discovered task is surfaced as a
runnable task. When executed, the extension calls:

```shell
dotnet cake <scriptFile> --target=<TaskName>
```

---

## File Pattern

```text
**/*.cake
```

---

## Task Definition Syntax

Tasks in Cake are defined using the fluent `Task()` API:

```csharp
Task("Clean")
    .Does(() =>
{
    CleanDirectory("./output");
});

Task("Build")
    .IsDependentOn("Clean")
    .Does(() =>
{
    DotNetBuild("./src/MyProject.sln");
});

Task("Default")
    .IsDependentOn("Build");

RunTarget(target);
```

Both double-quoted and single-quoted task names are supported:

```csharp
Task("Build")  // ✅ supported
Task('Build')  // ✅ supported
```

---

## Prerequisites

Cake must be installed as a .NET tool. To install Cake globally:

```shell
dotnet tool install --global Cake.Tool
```

Or locally in your project (recommended):

```shell
dotnet tool install Cake.Tool
```

With a local installation, make sure a `dotnet-tools.json` manifest file is
present in your `.config/` directory and run `dotnet tool restore` to initialize
the tool.

---

## Enabling / Disabling

Use `workspaceTasks.enabledTaskTypes` to control whether Cake tasks are discovered:

```json
{
  "workspaceTasks.enabledTaskTypes": {
    "cake": true
  }
}
```

---

## Next Steps

- [Configuration Reference](../configuration) — Full settings reference including task type toggles
- [Task Runners](task-runners) — Gulp, Grunt, Just, Make, mise, CMake, and more
- [Enabling / Disabling Task Types](../configuration/task-type) — Control which task types are active
