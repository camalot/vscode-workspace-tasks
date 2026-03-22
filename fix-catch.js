const fs = require('fs');
let code = fs.readFileSync('src/services/taskFilesService.ts', 'utf8');

code = code.replace(/try\s*\{\s*files = await vscode\.workspace\.findFiles\('\*\*\/\.tasksignore', '\*\*\/\.vscode-test\/\*\*'\);\s*\}\s*const folders/m, 
`try {
        files = await vscode.workspace.findFiles('**/.tasksignore', '**/.vscode-test/**');
      } catch {
        return;
      }
      
      const folders`);

fs.writeFileSync('src/services/taskFilesService.ts', code);
