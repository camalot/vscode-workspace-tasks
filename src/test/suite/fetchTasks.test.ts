import * as vscode from 'vscode';
import * as assert from 'assert';

suite('Task Fetching Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Fetch tasks and inspect', async () => {
		console.log('Fetching tasks...');
		// Fetch all tasks
		const tasks = await vscode.tasks.fetchTasks();
		console.log(`Fetched ${tasks.length} tasks.`);

		// Look for tasks that look like they come from tasks.json
		// Specifically "npm: compile" which we saw in tasks.json
		const compileTask = tasks.find(t => t.name === 'compile' || t.name === 'npm: compile');
		
		if (compileTask) {
			console.log('Found compile task:', JSON.stringify({
				name: compileTask.name,
				source: compileTask.source,
				scope: compileTask.scope,
				detail: compileTask.detail,
				definition: compileTask.definition,
				execution: compileTask.execution ? 'present' : 'missing'
			}, null, 2));
		} else {
			console.log('Compile task not found among:', tasks.map(t => `${t.source}: ${t.name}`));
		}

        // Check for any task with source "Workspace"
        const workspaceTasks = tasks.filter(t => t.source === 'Workspace');
        console.log(`Found ${workspaceTasks.length} Workspace tasks.`);
        workspaceTasks.forEach(t => {
            console.log(` - ${t.name} (${t.detail})`);
        });

	});
});
