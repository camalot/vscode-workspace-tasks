#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const allowedPaths = ['out', 'dist', 'build'];

// get path from command line args
// if no path provided, use 'out' directory

// if no args, log that 'out' will be cleaned
if (process.argv.length <= 2) {
    console.log(`No path provided. Defaulting to "out".`);
}

// what if the script is ran directly instead of with node? (e.g. ./scripts/clean-path.js out)
// in that case, process.argv[0] will be the path to node, and process.argv[1] will be the path to the script
// get the last argument as the target path
const targetPath = process.argv[process.argv.length - 1] || 'out';
// example:
// node scripts/clean-path.js out
// ./scripts/clean-path.js out

if (!fs.existsSync(targetPath)) {
    console.error(`Path "${targetPath}" does not exist. Skipping clean.`);
    process.exit(0);
}

if (!allowedPaths.includes(targetPath)) {
    console.error(`Path "${targetPath}" is not allowed. Allowed paths: ${allowedPaths.join(', ')}`);
    process.exit(1);
}

// if path is the root directory, do not delete
if (targetPath === '/' || targetPath === '\\') {
    console.error(`Cannot delete the root directory.`);
    process.exit(1);
}

// if path is the current directory, do not delete
if (targetPath === '.' || targetPath === './') {
    console.error(`Cannot delete the current directory.`);
    process.exit(1);
}

// if path exists, delete it
const cleanDir = path.join(__dirname, '..', targetPath);
if (fs.existsSync(cleanDir)) {
    console.log(`Cleaning directory: ${cleanDir}`);
    fs.rmSync(cleanDir, { recursive: true, force: true });
    console.log(`Directory "${targetPath}" has been cleaned.`);
} else {
    console.log(`Directory "${targetPath}" does not exist. Nothing to clean.`);
}
