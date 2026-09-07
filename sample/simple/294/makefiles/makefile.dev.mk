# makefile.dev.mk
# Platform-neutral developer targets: diagnostics, developer-tool install,
# common build steps, the fmt/lint/vet quality chain, release and scanning.

# ── Debug ────────────────────────────────────────────────────────────────────

.PHONY: print-debug
print-debug: ## Print all project, Go, host, makefile and tool variables
	@echo "Project variables: ..."

# ── Install-Development-Tools ────────────────────────────────────────────────

.PHONY: go-install_development_tools
go-install_development_tools: ## Install required developer tools
	@echo "Running install for required developer tools..."

# ── Build (common) ───────────────────────────────────────────────────────────

.PHONY: ensure-dist
ensure-dist: ## Ensure the ./dist directory exists
	@echo "Ensuring $(DIST_DIR) directory exists..."

.PHONY: go-build_for_host
go-build_for_host: ## Build for host
	@echo "Running build for host ..."

.PHONY: generate-help
generate-help: ensure-dist ## Generate help HTM
	@echo "Running help HTM generation '$(DOC_GEN)''..."

# ── Quality chain ────────────────────────────────────────────────────────────

# does not block the build pipeline.
# DEADCODE_STRICT ?=

# deadcode failures a hard error 
# DEADCODE_STRICT ?= 1

.PHONY: go-deadcode
go-deadcode: ## Run deadcode analysis
	@echo "Running deadcode analysis..."

.PHONY: go-tidy
go-tidy: go-deadcode ## Run go mod tidy
	@echo "Running go mod tidy..."

.PHONY: go-verify
go-verify: go-tidy ## Run go mod verify
	@echo "Running go mod verify..."

.PHONY: go-gen
go-gen: go-tidy ## Run go generate
	@echo "Running go generate..."

.PHONY: go-fmt
go-fmt: go-gen ## Run go fmt
	@echo "Running go fmt..."

.PHONY: go-lint
go-lint: go-fmt ## Run golangci-lint
	@echo "Running golangci-lint..."

.PHONY: go-vet
go-vet: go-lint ## Run go vet
	@echo "Running go vet..."

# ── Cache / release / scanning ───────────────────────────────────────────────

.PHONY: go-clean_cache
go-clean_cache: ## Run go clean --cache
	@echo "Running Go build cache cleanup..."

.PHONY: go-releaser_snapshot
go-releaser_snapshot: ## Run goreleaser snapshot
	@echo "Running goreleaser snapshot..."

.PHONY: go-releaser_tag_local
go-releaser_tag_local: ## Run goreleaser release from tag (local, no publish)
	@echo "Running goreleaser release (local, no publish)..."

.PHONY: go-releaser_check
go-releaser_check: ## Validate goreleaser config
	@echo "Running goreleaser config validation..."

.PHONY: go-vulncheck
go-vulncheck: ## Run go-vulncheck
	@echo "Running go-vulncheck..."

.PHONY: go-vulncheck_report
go-vulncheck_report: ensure-dist ## Run go-vulncheck_report
	@echo "Running go-vulncheck_report..."
