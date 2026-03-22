const fs = require('fs');
let code = fs.readFileSync('src/services/taskFilesService.ts', 'utf8');

code = code.replace(/vscode\.workspace\.findFiles\([^,]*?\)/g, (match) => {
    return match.replace(/\)$/, ", '**/.vscode-test/**')");
});

fs.writeFileSync('src/services/taskFilesService.ts', code);
