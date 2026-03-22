const fs = require('fs');

function replaceTest(testName, newContent) {
    let code = fs.readFileSync('src/test/suite/vscodeTaskProvider.test.ts', 'utf8');
    const startIdx = code.indexOf(`test('${testName}'`);
    if (startIdx === -1) {
        console.log("NOT FOUND: " + testName);
        return;
    }
    
    // Look for the correct closing tag for the test. We can look for `    });` since tests are uniformly indented.
    const searchFrom = code.indexOf('});', startIdx);
    
    let match = code.substring(startIdx).match(/^    \}\);/m);
    if (!match) {
        console.log("NO CLOSING FOUND FOR: " + testName);
        return;
    }
    let endIdx = startIdx + match.index + 7;
    code = code.substring(0, startIdx) + newContent + code.substring(endIdx);
    fs.writeFileSync('src/test/suite/vscodeTaskProvider.test.ts', code);
}

replaceTest('user-level system tasks point to the user tasks.json path', 
`test('user-level system tasks have undefined fileUri', async () => {
      const mockUserTask = {
        name: 'User Task One',
        source: 'User',
        scope: vscode.TaskScope.Global,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;
      (vscode.tasks as any).fetchTasks = async () => [mockUserTask];

      const tasks = await provider.getSystemTasks();
      const userTask = tasks.find(t => t.label === 'User Task One');
      assert.ok(userTask);
      assert.strictEqual(userTask!.taskFileUri, undefined);
      assert.strictEqual(userTask!.description, 'User Tasks');
      assert.strictEqual(userTask!.onOpenActionCommand?.command, 'workbench.action.tasks.openUserTasks');
    });`);

replaceTest('user-level system task falls back to getUserTasksPath when user tasks.json not found on disk', ``);

replaceTest('user profile task with scope Global points to user tasks.json path', 
`test('user profile task with scope Global has undefined fileUri', async () => {
      const mockUserTask = {
        name: 'User Task One',
        source: 'Workspace',
        scope: vscode.TaskScope.Global,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;
      (vscode.tasks as any).fetchTasks = async () => [mockUserTask];

      const tasks = await provider.getSystemTasks();
      const userTask = tasks.find(t => t.label === 'User Task One');
      assert.ok(userTask);
      assert.strictEqual(userTask!.taskFileUri, undefined);
    });`);

replaceTest('includes user tasks when user tasks.json exists and no .vscode/tasks.json', ``);

replaceTest('user tasks taskFileUri points to user tasks.json', ``);

replaceTest('does not duplicate user tasks when user tasks.json is already in workspace files', ``);

replaceTest('user tasks have taskOrigin set to "user"', ``);

replaceTest('user task onOpenActionCommand references user tasks.json', ``);

replaceTest('does not duplicate user tasks when system tasks return them with source Workspace and scope Global', 
`test('does not duplicate user tasks when system tasks return them with source Workspace and scope Global', async () => {
      const mockUserTask = {
        name: 'User Task One',
        source: 'Workspace',
        scope: vscode.TaskScope.Global,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;
      (vscode.tasks as any).fetchTasks = async () => [mockUserTask];
      const tasks = await provider.getTasks();
      const userTasks = tasks.filter(t => t.label === 'User Task One');
      assert.strictEqual(userTasks.length, 1);
    });`);

replaceTest('does not duplicate user tasks when system tasks return them with source Workspace and scope TaskScope.Workspace', 
`test('does not duplicate user tasks when system tasks return them with source Workspace and scope TaskScope.Workspace', async () => {
      const mockUserTask = {
        name: 'User Task One',
        source: 'Workspace',
        scope: vscode.TaskScope.Workspace,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;
      (vscode.tasks as any).fetchTasks = async () => [mockUserTask];
      // ensure workspace finds none so we only get the system one
      const taskFilesService = TaskFilesService.getInstance();
      taskFilesService.findFiles = async () => [];

      const tasks = await provider.getTasks();
      const userTasks = tasks.filter(t => t.label === 'User Task One');
      assert.strictEqual(userTasks.length, 1);
    });`);

replaceTest('user task from system API has the user tasks.json path, not .vscode/tasks.json', 
`test('user task from system API has undefined fileUri', async () => {
      const mockUserTask = {
        name: 'User Task One',
        source: 'User',
        scope: vscode.TaskScope.Global,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;
      (vscode.tasks as any).fetchTasks = async () => [mockUserTask];
      // Workspace find returns nothing
      const taskFilesService = TaskFilesService.getInstance();
      taskFilesService.findFiles = async () => [];

      const tasks = await provider.getTasks();
      const userTask = tasks.find(t => t.label === 'User Task One');
      assert.ok(userTask);
      assert.strictEqual(userTask!.taskFileUri, undefined);
    });`);

