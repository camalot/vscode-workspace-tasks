#!/bin/bash
# Fail the script after 5 seconds
echo "Starting fail task..."
for i in {1..5}; do
    sleep 1
    echo "Waiting... $i seconds"
done
echo "Failing..."
exit 1
