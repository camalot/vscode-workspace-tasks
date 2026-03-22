const fs = require('fs');
let code = fs.readFileSync('src/services/taskFilesService.ts', 'utf8');

code = code.replace(/vscode\.workspace\.findFiles\(([^,]+)(?:,\s*[^)]+)?\)/g, "vscode.workspace.findFiles($1, '{**/.vscode-test/**,**/node_modules/**,**/.git/**}')");

fs.writeFileSync('src/services/taskFilesService.ts', code);
