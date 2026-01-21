.PHONY: all build test clean long-task fail-task info

all: clean build test

build:
	@echo "Building project components..."
	@echo "Build complete."

test:
	@echo "Running tests..."
	@echo "Tests passed."

clean:
	@echo "Cleaning artifacts..."

# Long running task (5 seconds)
long-task:
	@echo "Starting long running task (5 seconds)..."
	@if [ "$(OS)" = "Windows_NT" ]; then timeout /t 5; else sleep 5; fi
	@echo "Long task finished!"

# Task designed to fail
fail-task:
	@echo "Attempting to perform risky operation..."
	@echo "Oh no! Something went wrong."
	@exit 1

info:
	@echo "Displaying project info"
	@echo "Version: 1.0.0"
