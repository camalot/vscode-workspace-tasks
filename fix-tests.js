const fs = require('fs');

const path = 'src/test/suite/vscodeTaskProvider.test.ts';
let code = fs.readFileSync(path, 'utf8');

// remove getUserTasksPath dummy function
code = code.replace(/const getUserTasksPath = \(\) => '\/dummy\/path'; \/\/ Mocked out since it is no longer used by the provider\n?/g, '');

// replace getSystemTasks user-level tests
code = code.replace(
/test\('user-level system tasks point to the user tasks\.json path', async \(\) => \{[\s\S]*?\}\);/,
`test('user-level system tasks have undefined taskFileUri and point to openUserTasks action', async () => {
      const mockUserTask = {
        name: 'User Task One',
        source: 'User',
        scope: vscode.TaskScope.Global,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;
      (vscode.tasks as any).fetchTasks = async () => [mockUserTask];

      const tasks = await provider.getSystemTasks();
      const userTask = tasks.find(t => t.label === 'User Task One');
      assert.ok(userTask, 'Should find user-level system task');
      assert.strictEqual(userTask!.taskFileUri, undefined, 'taskFileUri should be undefined for user tasks');
      assert.strictEqual(userTask!.description, 'User Tasks', 'description should be User Tasks');
      assert.strictEqual(userTask!.onOpenActionCommand?.command, 'workbench.action.tasks.openUserTasks');
    });`);

code = code.replace(
/test\('user-level system task falls back to getUserTasksPath when user tasks\.json not found on disk', async \(\) => \{[\s\S]*?\}\);/,
'');

code = code.replace(
/test\('user profile task with scope Global points to user tasks\.json path', async \(\) => \{[\s\S]*?\}\);/,
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

code = code.replace(
/test\('includes user tasks when user tasks\.json exists and no \.vscode\/tasks\.json', async \(\) => \{[\s\S]*?\}\);/,
'');

code = code.replace(
/test\('user tasks taskFileUri points to user tasks\.json', async \(\) => \{[\s\S]*?\}\);/,
'');

code = code.replace(
/test\('does not duplicate user tasks when user tasks\.json is already in workspace files', async \(\) => \{[\s\S]*?\}\);/,
'');

code = code.replace(
/test\('user tasks have taskOrigin set to "user"', async \(\) => \{[\s\S]*?\}\);/,
'');

code = code.replace(
/test\('user task onOpenActionCommand references user tasks\.json', async \(\) => \{[\s\S]*?\}\);/,
'');

code = code.replace(
/test\('does not duplicate user tasks when system tasks return them with source Workspace and scope Global', async \(\) => \{[\s\S]*?\}\);/g,
`test('does not duplicate user tasks when system tasks return them with source Workspace and scope Global', async () => {
      const mockUserTask = {
        name: 'User Task One',
        source: 'Workspace',
        scope: vscode.TaskScope.Global,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;
      (vscode.tasks as any).fetchTasks = async () => [mockUserTask];
      // getTasks gets both system tasks and parses workspace files
      const tasks = await provider.getTasks();
      const userTasks = tasks.filter(t => t.label === 'User Task One');
      assert.strictEqual(userTasks.length, 1, 'Should only include the user task once');
    });`);

code = code.replace(
/test\('does not duplicate user tasks when system tasks return them with source Workspace and scope TaskScope\.Workspace', async \(\) => \{[\s\S]*?\}\);/g,
`test('does not duplicate user tasks when system tasks return them with source Workspace and scope TaskScope.Workspace', async () => {
      const mockUserTask = {
        name: 'User Task One',
        source: 'Workspace',
        scope: vscode.TaskScope.Workspace,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;
      (vscode.tasks as any).fetchTasks = async () => [mockUserTask];
      const tasks = await provider.getTasks();
      const userTasks = tasks.filter(t => t.label === 'User Task One');
      assert.strictEqual(userTasks.length, 1, 'Should only include the user task once');
    });`);

code = code.replace(
/test\('user task from system API has the user tasks\.json path, not \.vscode\/tasks\.json', async \(\) => \{[\s\S]*?\}\);/g,
`test('user task from system API has undefined tasks.json path, not .vscode/tasks.json', async () => {
      const mockUserTask = {
        name: 'User Task One',
        source: 'User',
        scope: vscode.TaskScope.Global,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;
      (vscode.tasks as any).fetchTasks = async () => [mockUserTask];
      const tasks = await provider.getTasks();
      const userTask = tasks.find(t => t.label === 'User Task One');
      assert.ok(userTask);
      assert.strictEqual(userTask!.taskFileUri, undefined);
    });`);

fs.writeFileSync(path, code);
