#!/bin/bash
# Long running script that completes after 5 seconds
echo "Starting long running task..."
for i in {1..5}; do
    sleep 1
    echo "Waiting... $i seconds"
done
echo "Done"
exit 0
