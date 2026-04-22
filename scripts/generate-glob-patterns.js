#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const workspaceRoot = path.resolve(__dirname, '..');
const constantsPath = path.join(workspaceRoot, 'src', 'libs', 'constants.ts');
const outputPath = path.join(workspaceRoot, 'docs', '_includes', '_glob_patterns.md');
const tableClasses = 'table table-dark table-striped';
const headerRow = `| Constant | Pattern | Should Match Examples |\n| --- | --- | --- |`;

function escapeHtml(input) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '\\|');
}

function parseGlobEntries(constantsText) {
  const lines = constantsText.split(/\r?\n/);
  const entries = [];

  let collectingExamples = false;
  let pendingExamples = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === '// should match:') {
      collectingExamples = true;
      pendingExamples = [];
      continue;
    }

    if (collectingExamples) {
      const sampleMatch = trimmed.match(/^\/\/\s*-\s*(.+)$/);
      if (sampleMatch) {
        pendingExamples.push(sampleMatch[1].trim());
        continue;
      }

      if (trimmed === '' || trimmed.startsWith('//')) {
        continue;
      }
    }

    const globMatch = trimmed.match(/^(GLOB_[A-Z0-9_]+):\s*'([^']*)',\s*$/);
    if (globMatch) {
      const [, name, pattern] = globMatch;
      entries.push({
        name,
        pattern,
        examples: collectingExamples ? pendingExamples : [],
      });

      collectingExamples = false;
      pendingExamples = [];
      continue;
    }

    // Any non-comment, non-empty line ends example collection.
    if (collectingExamples && trimmed !== '' && !trimmed.startsWith('//')) {
      collectingExamples = false;
      pendingExamples = [];
    }
  }

  return entries;
}

function toMarkdownTable(entries) {
  const lines = [];
  lines.push('<!-- AUTO-GENERATED: npm run docs:generate:glob-patterns -->');
  lines.push('');
  lines.push(`{: .${tableClasses} }`);
  lines.push(headerRow);

  for (const entry of entries) {
    const examplesCell = entry.examples.length > 0
      ? entry.examples.map((e) => `<code>${escapeHtml(e)}</code>`).join('<br>')
      : '';

    lines.push(
      `| <code>${escapeHtml(entry.name)}</code> | <code>${escapeHtml(entry.pattern)}</code> | ${examplesCell} |`,
    );
  }

  lines.push('');
  return lines.join('\n');
}

function main() {
  const constantsText = fs.readFileSync(constantsPath, 'utf8');
  const entries = parseGlobEntries(constantsText);

  if (entries.length === 0) {
    throw new Error('No GLOB_* entries were found in src/libs/constants.ts');
  }

  const markdown = toMarkdownTable(entries);
  fs.writeFileSync(outputPath, markdown, 'utf8');
  console.log(`Wrote ${entries.length} glob rows to ${path.relative(workspaceRoot, outputPath)}`);
}

main();
