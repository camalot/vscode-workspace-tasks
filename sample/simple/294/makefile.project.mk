# ── Project settings ─────────────────────────────────────────────────────────

BINARY             := demo
PRODUCTNAME        := demo
VERSION            := 1.0.0

# This will not show up in the Task Explorer in VS Code, but it will be available in the terminal.
# Simply run: make go-install_project_modules
.PHONY: go-install_project_modules
go-install_project_modules: ## Install required Go modules
	@echo "Running install for required Go modules..."
