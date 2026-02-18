import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { TaskFilesService } from '../../services/taskFilesService';

suite('TaskFilesService Test Suite', () => {
    let service: TaskFilesService;
    let disposables: vscode.Disposable[] = [];
    let workspaceRoot: vscode.Uri;
    let testFolder: vscode.Uri;

    setup(async () => {
        service = TaskFilesService.getInstance();

        // Find workspace root
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            workspaceRoot = vscode.workspace.workspaceFolders[0].uri;
        } else {
            // Fallback (might fail if no workspace open)
            workspaceRoot = vscode.Uri.file(process.cwd());
        }

        testFolder = vscode.Uri.joinPath(workspaceRoot, 'test-taskfiles');

        // Ensure clean state
        try {
            await vscode.workspace.fs.delete(testFolder, { recursive: true, useTrash: false });
        } catch { }
        await vscode.workspace.fs.createDirectory(testFolder);

        // Initialize service
        const context = { subscriptions: [] } as any;
        await service.initialize(context);
    });

    teardown(async () => {
        try {
            await vscode.workspace.fs.delete(testFolder, { recursive: true, useTrash: false });
        } catch { }

        // Reset configuration
        const config = vscode.workspace.getConfiguration('workspaceTasks');
        await config.update('exclude', undefined, vscode.ConfigurationTarget.Workspace);
        await config.update('taskDiscovery.fetchDepth', undefined, vscode.ConfigurationTarget.Workspace);

        disposables.forEach(d => d.dispose());
    });

    /**
     * Helper to create a file
     */
    async function createFile(relativePath: string, content: string = '') {
        const uri = vscode.Uri.joinPath(testFolder, relativePath);
        const parent = vscode.Uri.joinPath(uri, '..');
        try {
            await vscode.workspace.fs.createDirectory(parent);
        } catch { } // Directory might exist
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
        return uri;
    }

    test('shouldIgnore - Ignores default patterns (node_modules)', async () => {
        const fileUri = await createFile('node_modules/package.json');
        assert.strictEqual(service.shouldIgnore(fileUri), true, 'Should ignore node_modules by default');
    });

    test('shouldIgnore - Ignores .git', async () => {
        const fileUri = await createFile('.git/config');
        assert.strictEqual(service.shouldIgnore(fileUri), true, 'Should ignore .git by default');
    });

    test('shouldIgnore - Respects workspaceTasks.exclude configuration', async function() {
        this.timeout(5000); // Increase timeout
        // Create file that should correspond to new exclude rule
        const fileUri = await createFile('dist/output.js');
        // Initial state check
        assert.strictEqual(service.shouldIgnore(fileUri), false, 'Initially should allow');

        // Update config
        const config = vscode.workspace.getConfiguration('workspaceTasks');
        await config.update('exclude', ['**/dist/**'], vscode.ConfigurationTarget.Workspace);

        // Wait for config update to propagate
        await new Promise(r => setTimeout(r, 2500));

        // Verify
        assert.strictEqual(service.shouldIgnore(fileUri), true, 'Should ignore after config update');
    });


    async function waitForIgnoreFile(uri: vscode.Uri) {
        // Deterministically load in tests (watchers can be flaky in extension host)
        await (service as any).loadIgnoreFile(uri);

        // Wait for service to pick up the file
        // We can check internal state via any
        const expectedDir = path.dirname(uri.fsPath).toLowerCase();
        const maxRetries = 50; // Increased from 20
        for (let i = 0; i < maxRetries; i++) {
            const ignoreFiles = (service as any).ignoreFiles as any[];
            if (ignoreFiles.some(ig => ig.folderUri.fsPath.toLowerCase() === expectedDir)) {
                return;
            }
            await new Promise(r => setTimeout(r, 100)); // wait 100ms before retrying
        }
        // Fallback: manually trigger load if watcher missed it (common in test envs)
        await (service as any).loadIgnoreFile(uri);
        // Wait a bit more for processing
        await new Promise(r => setTimeout(r, 200));
    }

    test('shouldIgnore - Respects .tasksignore file', async () => {
        const fileUri = await createFile('secret/key.txt');
        const allowedUri = await createFile('public/read.txt');

        // Create .tasksignore at root of test folder
        const ignoreFile = await createFile('.tasksignore', 'secret/');

        await waitForIgnoreFile(ignoreFile);

        assert.strictEqual(service.shouldIgnore(fileUri), true, 'Should ignore secret/key.txt based on .tasksignore');
        assert.strictEqual(service.shouldIgnore(allowedUri), false, 'Should allow public/read.txt');
    });

    test('shouldIgnore - Nested .tasksignore takes precedence/adds rules', async function() {
        this.timeout(10000); // Increase timeout for file operations

        // Use isolated subfolder to avoid stale document cache from other tests
        // Create root ignore blocking foo/
        const rootIgnore = await createFile('nested-case/.tasksignore', 'foo/');
        await waitForIgnoreFile(rootIgnore);

        // Create nested ignore blocking bar/ inside nested folder
        const nestedIgnore = await createFile('nested-case/nested/.tasksignore', 'bar/');
        await waitForIgnoreFile(nestedIgnore);

        // Create files
        const fileFoo = await createFile('nested-case/foo/file.txt'); // Should be ignored by root
        const fileNestedBar = await createFile('nested-case/nested/bar/file.txt'); // Should be ignored by nested
        const fileNestedAllowed = await createFile('nested-case/nested/allowed.txt'); // Should be allowed

        // Extra wait to ensure all file operations complete
        await new Promise(r => setTimeout(r, 300));

        assert.strictEqual(service.shouldIgnore(fileFoo), true, 'Root ignore should apply to foo/file.txt');
        assert.strictEqual(service.shouldIgnore(fileNestedBar), true, 'Nested ignore should apply to bar/file.txt');
        assert.strictEqual(service.shouldIgnore(fileNestedAllowed), false, 'Should allow explicitly allowed files');
    });

    test('filterByDepth - Respects fetchDepth configuration', async () => {
        const config = vscode.workspace.getConfiguration('workspaceTasks');

        // Create nested structure
        // root/depth0.txt
        // root/lev1/depth1.txt
        // root/lev1/lev2/depth2.txt (depth 2 relative to testFolder)
        const depth0File = await createFile('depth0.txt');
        const depth1File = await createFile('lev1/depth1.txt');
        const depth2File = await createFile('lev1/lev2/depth2.txt');

        const uris = [depth0File, depth1File, depth2File];

        // Calculate depths relative to workspace
        // We need to know actual depth relative to workspace root to set config correctly.
        // If testFolder is at root, depth0File is depth 1 (root/test-taskfiles/depth0.txt)
        // Check actual depth calculation logic: path.relative(wsRoot, uri).split(sep).length - 1

        const getDepth = (uri: vscode.Uri) => {
            const rel = path.relative(workspaceRoot.fsPath, uri.fsPath);
            return rel.split(path.sep).length - 1;
        };

        const d0 = getDepth(depth0File);
        const d1 = getDepth(depth1File);
        const d2 = getDepth(depth2File);

        // 1. Unset limit (null)
        await config.update('taskDiscovery.fetchDepth', null, vscode.ConfigurationTarget.Workspace);
        // Force refresh config? filterByDepth reads config on invocation
        let filtered = (service as any).filterByDepth(uris);
        assert.strictEqual(filtered.length, 3, 'Should find all 3 files without depth limit');

        // 2. Limit to depth of depth0File
        await config.update('taskDiscovery.fetchDepth', d0, vscode.ConfigurationTarget.Workspace);
        filtered = (service as any).filterByDepth(uris);
        assert.ok(filtered.some((u: vscode.Uri) => u.toString() === depth0File.toString()), 'Should include depth0');
        // If d1 > d0, it should be excluded
        if (d1 > d0) {
            assert.ok(!filtered.some((u: vscode.Uri) => u.toString() === depth1File.toString()), 'Should exclude depth1');
        }

        // 3. Limit to depth of depth1File
        await config.update('taskDiscovery.fetchDepth', d1, vscode.ConfigurationTarget.Workspace);
        filtered = (service as any).filterByDepth(uris);
        assert.ok(filtered.some((u: vscode.Uri) => u.toString() === depth1File.toString()), 'Should include depth1');
        if (d2 > d1) {
            assert.ok(!filtered.some((u: vscode.Uri) => u.toString() === depth2File.toString()), 'Should exclude depth2');
        }
    });

    test('loadIgnoreFile - Handles comments and empty lines', async function() {
        this.timeout(10000); // Increase timeout for file operations

        // Create complicated ignore file
        const content = `
# This is a comment
  # Another comment with whitespace
ignore.me
!keep.me
`;
        // Note: ensure no leading whitespace before ignore.me if indentation matters?
        // Trim() handles it.
        const ignoreFile = await createFile('comments-case/.tasksignore', content);
        await waitForIgnoreFile(ignoreFile);

        const ignoreUri = await createFile('comments-case/ignore.me');
        const keepUri = await createFile('comments-case/keep.me');

        // Extra wait to ensure all file operations complete
        await new Promise(r => setTimeout(r, 300));

        assert.strictEqual(service.shouldIgnore(ignoreUri), true, 'Should ignore ignore.me');
        assert.strictEqual(service.shouldIgnore(keepUri), false, 'Should keep keep.me');
    });

    test('Integration - findFiles', async () => {
        const file1 = await createFile('match1.json');
        const file2 = await createFile('match2.json');
        const ignored = await createFile('ignore.me');

        const ignoreFile = await createFile('.tasksignore', 'ignore.me');
        await waitForIgnoreFile(ignoreFile);

        // Use relative pattern to workspace root to ensure robustness
        const relativeFolder = vscode.workspace.asRelativePath(testFolder, false); // e.g. "test-taskfiles"
        const glob = `${relativeFolder}/**/*`.replace(/\\/g, '/');

        let found: vscode.Uri[] = [];
        for (let i = 0; i < 30; i++) { // Increased timeout (6s)
            // Use service to find files
            const result = await service.findFiles([glob]);

            // Filter to only our test files (just in case)
            const relevant = result.filter(u => u.fsPath.startsWith(testFolder.fsPath));

            // We expect at least match1 and match2
            // And ignore.me should NOT be present (handled by shouldIgnore in service.findFiles)
            // BUT findFiles needs to find them first.
            if (relevant.length >= 2) {
                found = relevant;
                break;
            }
            await new Promise(r => setTimeout(r, 200));
        }

        const hasMatch1 = found.some(u => u.fsPath.endsWith('match1.json'));
        const hasMatch2 = found.some(u => u.fsPath.endsWith('match2.json'));
        const hasIgnore = found.some(u => u.fsPath.endsWith('ignore.me'));

        assert.strictEqual(hasMatch1, true, 'Should find match1.json');
        assert.strictEqual(hasMatch2, true, 'Should find match2.json');
        assert.strictEqual(hasIgnore, false, 'Should ignore ignore.me');
    });
});
