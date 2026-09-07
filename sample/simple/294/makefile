.DEFAULT_GOAL      := help

# project before env
include ./makefile.project.mk
# # common targets
include ./makefiles/makefile.env.mk
include ./makefiles/makefile.dev.mk
include ./makefiles/makefile.os.linux.mk
include ./makefiles/makefile.os.windows.mk

# ── Help ─────────────────────────────────────────────────────────────────────

.PHONY: help
help: ## Show this help
	@echo "Usage: make [target]"
	@grep -hE '^[a-zA-Z0-9_.-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| $(AWK) 'BEGIN {FS = ":.*?## "}; {printf "  %-28s %s\n", $$1, $$2}' \
		| sort

# ── Clean ────────────────────────────────────────────────────────────────────

.PHONY: clean
clean: go-winres_clean ## Remove generated build artifacts
	@echo "Running clean..."
