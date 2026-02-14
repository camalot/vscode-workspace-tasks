#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function extractCoordinates(pathData) {
  // Extract all numeric values from path data
  const numbers = pathData.match(/-?\d+\.?\d*/g);
  if (!numbers) return [];
  return numbers.map(Number);
}

function getBoundingBox(svgContent) {
  // Find all path elements and extract coordinates
  const pathRegex = /<path[^>]*\sd="([^"]*)"/g;
  let match;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  while ((match = pathRegex.exec(svgContent)) !== null) {
    const pathData = match[1];
    const coords = extractCoordinates(pathData);

    // Assume coordinates alternate x, y
    for (let i = 0; i < coords.length; i += 2) {
      if (i + 1 < coords.length) {
        const x = coords[i];
        const y = coords[i + 1];
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function removePadding(svgFilePath, padding = 0) {
  if (!fs.existsSync(svgFilePath)) {
    console.error(`Error: File not found: ${svgFilePath}`);
    return false;
  }

  try {
    const svgContent = fs.readFileSync(svgFilePath, 'utf8');
    const bbox = getBoundingBox(svgContent);

    console.log(`File: ${path.basename(svgFilePath)}`);
    console.log(`Bounding box:`, bbox);

    // Use specified padding or calculate a small margin
    const margin = padding > 0 ? padding : Math.max(bbox.width, bbox.height) * 0.02;
    const newMinX = Math.floor(bbox.minX - margin);
    const newMinY = Math.floor(bbox.minY - margin);
    const newWidth = Math.ceil(bbox.width + margin * 2);
    const newHeight = Math.ceil(bbox.height + margin * 2);

    console.log(`Padding: ${margin}px`);
    console.log(`New viewBox: ${newMinX} ${newMinY} ${newWidth} ${newHeight}`);

    // Replace viewBox
    const newViewBox = `${newMinX}, ${newMinY}, ${newWidth},${newHeight}`;
    const updatedContent = svgContent.replace(
      /viewBox="[^"]*"/,
      `viewBox="${newViewBox}"`
    );

    // Also update width and height to match the aspect ratio
    const updatedContent2 = updatedContent
      .replace(/width="\d+"/, `width="${newWidth}"`)
      .replace(/height="\d+"/, `height="${newHeight}"`);

    fs.writeFileSync(svgFilePath, updatedContent2, 'utf8');
    console.log(`Updated ${svgFilePath}\n`);
    return true;
  } catch (error) {
    console.error(`Error processing ${svgFilePath}:`, error.message);
    return false;
  }
}

function processIconByName(iconName, padding = 0) {
  const darkFile = path.join(__dirname, `../res/icons/dark/${iconName}.svg`);
  const lightFile = path.join(__dirname, `../res/icons/light/${iconName}.svg`);

  console.log(`Processing icon: ${iconName}\n`);

  let darkResult = false;
  let lightResult = false;

  if (fs.existsSync(darkFile)) {
    darkResult = removePadding(darkFile, padding);
  } else {
    console.log(`Skipping dark icon (not found): ${darkFile}\n`);
  }

  if (fs.existsSync(lightFile)) {
    lightResult = removePadding(lightFile, padding);
  } else {
    console.log(`Skipping light icon (not found): ${lightFile}\n`);
  }

  return darkResult || lightResult;
}

// Get icon name and optional padding from command line arguments
const iconName = process.argv[2];
const padding = process.argv[3] ? parseInt(process.argv[3], 10) : 0;

if (!iconName) {
  console.error('Usage: node remove-svg-padding.js <icon-name> [padding-px]');
  console.error('Example: node remove-svg-padding.js cargo');
  console.error('Example: node remove-svg-padding.js cargo 5');
  console.error('');
  console.error('If padding-px is not specified, 2% of the icon size will be used.');
  process.exit(1);
}

if (process.argv[3] && isNaN(padding)) {
  console.error(`Error: Invalid padding value "${process.argv[3]}". Must be a number.`);
  process.exit(1);
}

const success = processIconByName(iconName, padding);

if (success) {
  console.log('Done!');
} else {
  console.error('No files were processed.');
  process.exit(1);
}
