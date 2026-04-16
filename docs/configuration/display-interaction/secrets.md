---
layout: default
title: 🔐 Secrets
parent: 🖥️ Display & Interaction
grand_parent: ⚙️ Configuration
nav_order: 3
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Secrets Settings
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

---

{: .new }
Added in v1.8.0

Settings that control how the **Secrets** group in the task treeview behaves.

For a full guide to storing, updating, and referencing secrets in tasks see
[Task Environment Variables — Managing Secrets]({{ site.baseurl }}/features/task-environment-variables/#managing-secrets).

---

### workspaceTasks.secrets.showEmptyGroup

**Type:** `boolean`
**Default:** `false`

By default the **Secrets** root item is hidden from the treeview when no secrets are stored in VS
Code `SecretStorage`. Set this to `true` to always show the group, even when it is empty.

When the group is empty and this option is `true`, hovering over the group shows a tooltip
indicating that no secrets are currently stored and directing you to the
**Workspace Tasks: Add New Secret** command.

```jsonc
{
  "workspaceTasks.secrets.showEmptyGroup": true
}
```

**Use this when** you want a persistent visual cue to remind you that the Secrets group exists
(for example, when onboarding a project that uses secrets but none have been stored yet on the
current machine).

---

## See Also

- [Task Environment Variables]({{ site.baseurl }}/features/task-environment-variables/)
- [Environment Variables Settings]({{ site.baseurl }}/configuration/environment/environment-variables/)
