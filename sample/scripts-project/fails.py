#! /usr/bin/env python

import sys
import time

# Fail the script after 5 seconds
print("Starting fail task...")
for i in range(5):
    time.sleep(1)
    print(f"Waiting... {i + 1} seconds")
print("Failing...")
sys.exit(1)
