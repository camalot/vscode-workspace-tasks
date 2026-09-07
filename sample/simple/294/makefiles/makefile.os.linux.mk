# makefile.linux.mk
# Linux build targets.

# ── Build (Linux) ────────────────────────────────────────────────────────────

.PHONY: build-linux
build-linux: go-vet generate-help ## Build for linux-amd64
	@echo "Running Linux amd64 build..."
