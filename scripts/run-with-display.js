#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const os = require('os');

const args = process.argv.slice(2);

const needsDisplay = os.platform() === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;

const cmd = needsDisplay ? 'xvfb-run' : args[0];
const cmdArgs = needsDisplay ? ['-a', ...args] : args.slice(1);

const result = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: false });

process.exit(result.status ?? (result.error ? 1 : 0));
