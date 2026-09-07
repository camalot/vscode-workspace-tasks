# makefile.windows.mk
# Windows cross-build, embedded resources (.syso) and Inno Setup packaging.
# Kept unconditional (not behind ifeq GOHOST_OS) so these targets remain
# runnable when cross-compiling from a non-Windows host.

# ── Installer / setup ────────────────────────────────────────────────────────

.PHONY: install-windows
install-windows: setup-windows ## install setup windows x64
	@echo "Running install for Windows amd64..."

.PHONY: setup-windows
setup-windows: build-windows generate-help ## Create setup windows x64
	@echo "Running setup for Windows amd64..."

# ── Build (Windows) ──────────────────────────────────────────────────────────

.PHONY: build-windows
build-windows: generate-help go-winres ## Build for windows-amd64
	@echo "Running Windows amd64 build..."

# ── Windows resources (.syso) ────────────────────────────────────────────────

.PHONY: go-winres
go-winres: go-vet go-winres_clean ## Generate Windows resource files
	@echo "Running go-winres, resource files (.syso) generation..."

.PHONY: go-winres_clean
go-winres_clean: ## Remove generated .syso resource files
	@echo "Running go-winres_clean, resource files (.syso) cleanup..."
