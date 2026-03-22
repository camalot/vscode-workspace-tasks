const fs = require('fs');
let code = fs.readFileSync('src/services/taskFilesService.ts', 'utf8');

// The curly brace pattern might be invalid for vscode.workspace.findFiles exclude if it doesn't support multiple `{}` at root or something strange, let's just use a simple `undefined` to rely on the settings.json
code = code.replace(/,\s*'\{\*\*\/\.vscode-test\/\*\*\}'\)/g, ")");
code = code.replace(/,\s*'\*\*\/\.vscode-test\/\*\*'\)/g, ")");
code = code.replace(/\{\*\*\/node_modules\/\*\*,\*\*\/\.git\/\*\*,\*\*\/\.vscode-test\/\*\*\}/g, "{**/node_modules/**,**/.git/**}");
code = code.replace(/,\s*'\{.*?\}'\)/g, ")");

fs.writeFileSync('src/services/taskFilesService.ts', code);
