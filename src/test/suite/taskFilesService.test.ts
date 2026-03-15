import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { TaskFilesService } from '../../services/taskFilesService';

suite('TaskFilesService Test Suite', () => {
    let service: TaskFilesService;
    let disposables: vscode.Disposable[] = [];
    let workspaceRoot: vscode.Uri;
    let testFolder: vscode.Uri;

    setup(async function(this: Mocha.Context) {
        this.timeout(10000);
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

    teardown(async function(this: Mocha.Context) {
        this.timeout(10000);
        try {
            await vscode.workspace.fs.delete(testFolder, { recursive: true, useTrash: false });
        } catch { }

        // Reset configuration
        const config = vscode.workspace.getConfiguration('workspaceTasks');
        await config.update('exclude', undefined, vscode.ConfigurationTarget.Workspace);
        await config.update('taskDiscovery.fetchDepth', undefined, vscode.ConfigurationTarget.Workspace);
        // Wait for any onDidChangeConfiguration handlers (e.g. initialize()) to settle
        // before the next test starts. Without this, a deferred initialize() triggered by
        // the config reset can clear ignoreFiles mid-test.
        await new Promise(r => setTimeout(r, 500));

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


    /**
     * Waits until the given glob pattern returns at least `expectedCount` files
     * via vscode.workspace.findFiles. On Linux CI, newly written files can take
     * a moment to be picked up by VS Code's internal file watcher/indexer.
     */
    async function waitForFilesIndexed(glob: string, expectedCount: number, maxRetries = 30): Promise<void> {
        let actualCount = 0;
        for (let i = 0; i < maxRetries; i++) {
            const uris = await vscode.workspace.findFiles(glob);
            const relevant = uris.filter(u => u.fsPath.startsWith(testFolder.fsPath));
            actualCount = relevant.length;
            if (actualCount >= expectedCount) {
                return;
            }
            await new Promise(r => setTimeout(r, 200));
        }
        throw new Error(
            `waitForFilesIndexed timed out: glob="${glob}", expected>=${expectedCount}, actual=${actualCount} after ${maxRetries} retries`
        );
    }

    async function waitForIgnoreFile(uri: vscode.Uri) {
        // Deterministically load in tests (watchers can be flaky in extension host).
        // loadIgnoreFile now uses vscode.workspace.fs.readFile (disk read, no cache)
        // so a single call is reliable; we only need to poll until the entry appears.
        await (service as any).loadIgnoreFile(uri);

        // Wait for service to pick up the file
        const expectedDir = path.dirname(uri.fsPath).toLowerCase();
        const maxRetries = 50; // up to 5 s
        for (let i = 0; i < maxRetries; i++) {
            const ignoreFiles = (service as any).ignoreFiles as any[];
            if (ignoreFiles.some((ig: any) => ig.folderUri.fsPath.toLowerCase() === expectedDir)) {
                return;
            }
            await new Promise(r => setTimeout(r, 100)); // wait 100ms before retrying
        }
        // Fallback: manually trigger load if watcher missed it (common in test envs)
        await (service as any).loadIgnoreFile(uri);
        // Wait a bit more for processing
        await new Promise(r => setTimeout(r, 200));
    }

    test('shouldIgnore - Respects .tasksignore file', async function() {
        this.timeout(10000);
        const fileUri = await createFile('secret/key.txt');
        const allowedUri = await createFile('public/read.txt');

        // Create .tasksignore at root of test folder
        const ignoreFile = await createFile('.tasksignore', 'secret/');

        await waitForIgnoreFile(ignoreFile);

        assert.strictEqual(service.shouldIgnore(fileUri), true, 'Should ignore secret/key.txt based on .tasksignore');
        assert.strictEqual(service.shouldIgnore(allowedUri), false, 'Should allow public/read.txt');
    });

    test('shouldIgnore - Nested .tasksignore takes precedence/adds rules', async function() {
        this.timeout(20000); // Two waitForIgnoreFile calls, each up to 5s

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

    test('filterByDepth - Respects fetchDepth configuration', async function() {
        this.timeout(10000);
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
        this.timeout(20000); // Increase timeout for file operations

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

    test('Integration - findFiles', async function() {
        this.timeout(15000);
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

    test('Integration - findFiles includes file rescued by task-level negation from glob pattern', async function() {
        this.timeout(15000);

        // rescued: ignored by glob but has a specific task-level negation → must appear in findFiles
        // ignored: no negation → must NOT appear
        await createFile('task-rescue/apps/sub/package.json', '{"scripts":{"build":"echo build"}}');
        await createFile('task-rescue/apps/sub/other.json', '{}');

        const ignoreFile = await createFile('task-rescue/.tasksignore', `apps/sub/**\n!apps/sub/package.json@build`);
        await waitForIgnoreFile(ignoreFile);

        const relativeFolder = vscode.workspace.asRelativePath(testFolder, false);
        const glob = `**/${relativeFolder}/task-rescue/**/*.json`.replace(/\\/g, '/');

        service.registerPatterns([glob]);
        service.invalidateCache();

        await waitForFilesIndexed('**/task-rescue/**/*.json', 2);

        let found: vscode.Uri[] = [];
        for (let i = 0; i < 30; i++) {
            const result = await service.findFiles([glob]);
            const relevant = result.filter(u => u.fsPath.startsWith(testFolder.fsPath));
            if (relevant.length > 0) {
                found = relevant;
                break;
            }
            await new Promise(r => setTimeout(r, 200));
        }

        const hasRescued = found.some(u => u.fsPath.endsWith('package.json'));
        const hasIgnored = found.some(u => u.fsPath.endsWith('other.json'));

        assert.strictEqual(hasRescued, true, 'package.json should appear because task-level negation rescues it');
        assert.strictEqual(hasIgnored, false, 'other.json should remain excluded by the glob pattern');
    });

    test('Integration - findFiles includes file rescued by file-level negation from glob pattern', async function() {
        this.timeout(15000);

        // rescued: ignored by glob but has a specific file-level negation → must appear in findFiles
        // ignored: no negation → must NOT appear
        await createFile('file-rescue/apps/sub/script.sh', '#!/bin/bash\necho hello');
        await createFile('file-rescue/apps/sub/other.sh', '#!/bin/bash\necho other');

        const ignoreFile = await createFile('file-rescue/.tasksignore', `apps/sub/**\n!apps/sub/script.sh`);
        await waitForIgnoreFile(ignoreFile);

        const relativeFolder = vscode.workspace.asRelativePath(testFolder, false);
        const glob = `**/${relativeFolder}/file-rescue/**/*.sh`.replace(/\\/g, '/');

        service.registerPatterns([glob]);
        service.invalidateCache();

        await waitForFilesIndexed('**/file-rescue/**/*.sh', 2);

        let found: vscode.Uri[] = [];
        for (let i = 0; i < 30; i++) {
            const result = await service.findFiles([glob]);
            const relevant = result.filter(u => u.fsPath.startsWith(testFolder.fsPath));
            if (relevant.length > 0) {
                found = relevant;
                break;
            }
            await new Promise(r => setTimeout(r, 200));
        }

        const hasRescued = found.some(u => u.fsPath.endsWith('script.sh'));
        const hasIgnored = found.some(u => u.fsPath.endsWith('other.sh'));

        assert.strictEqual(hasRescued, true, 'script.sh should appear because file-level negation rescues it');
        assert.strictEqual(hasIgnored, false, 'other.sh should remain excluded by the glob pattern');
    });

    test('findFiles with registered patterns uses cache', async function() {
        this.timeout(10000);
        // Clear patterns
        (service as any).registeredPatterns.clear();
        service.invalidateCache();

        // Create a couple of files
        await createFile('cache-test/file1.txt');
        await createFile('cache-test/subdir/file2.js');

        // Wait until VS Code has indexed the files (Linux CI can be slow to pick up new files)
        await waitForFilesIndexed('**/cache-test/**/*.txt', 1);
        await waitForFilesIndexed('**/cache-test/**/*.js', 1);

        service.registerPatterns(['**/cache-test/**/*.txt', '**/cache-test/**/*.js']);

        let uris1 = await service.findFiles(['**/cache-test/**/*.txt']);
        let relevant1 = uris1.filter(u => u.fsPath.startsWith(testFolder.fsPath));
        assert.strictEqual(relevant1.length > 0, true, 'Should find txt file');
        assert.strictEqual((service as any).cacheInvalidated, false, 'Cache should be built and valid');

        // Find again should hit the cache
        let uris2 = await service.findFiles(['**/cache-test/**/*.js']);
        let relevant2 = uris2.filter(u => u.fsPath.startsWith(testFolder.fsPath));
        assert.strictEqual(relevant2.length > 0, true, 'Should find js file');
        assert.strictEqual((service as any).cacheInvalidated, false, 'Cache should remain valid');
    });

    test('invalidateCache works correctly', async function() {
        this.timeout(10000);
        (service as any).registeredPatterns.clear();
        // Register the exact pattern used in findFiles calls so cache is used
        service.registerPatterns(['**/invalidate-test/**/*.txt']);
        service.invalidateCache();

        await createFile('invalidate-test/file1.txt');

        // Wait until VS Code has indexed the first file before building the cache
        await waitForFilesIndexed('**/invalidate-test/**/*.txt', 1);

        let uris = await service.findFiles(['**/invalidate-test/**/*.txt']);
        let relevant = uris.filter(u => u.fsPath.startsWith(testFolder.fsPath));
        assert.strictEqual(relevant.length, 1, 'Should find initial file');

        await createFile('invalidate-test/file2.txt');

        // Wait until VS Code has indexed the second file, then invalidate and rebuild
        await waitForFilesIndexed('**/invalidate-test/**/*.txt', 2);

        // Explicitly invalidate cache to force the next findFiles to rebuild it
        service.invalidateCache();

        uris = await service.findFiles(['**/invalidate-test/**/*.txt']);
        relevant = uris.filter(u => u.fsPath.startsWith(testFolder.fsPath));
        assert.strictEqual(relevant.length, 2, 'Should find both files after cache invalidated');
    });

    test('rebuildRegisteredPatterns - clears and repopulates from TaskCacheService providers', () => {
        const { TaskCacheService } = require('../../services/taskCacheService');
        const cacheService = TaskCacheService.getInstance();

        // Stub a fake provider with getFilePatterns
        const fakeProvider = {
            getFilePatterns: () => ['**/fake/**/*.ts', '**/fake/**/*.js'],
        };

        // Manually inject the fake provider
        const origGetProviders = cacheService.getProviders.bind(cacheService);
        cacheService.getProviders = () => [fakeProvider];

        // Pre-populate with something different
        (service as any).registeredPatterns.clear();
        service.registerPatterns(['**/old-pattern/**']);

        service.rebuildRegisteredPatterns();

        const patterns = Array.from((service as any).registeredPatterns as Set<string>);
        assert.ok(!patterns.includes('**/old-pattern/**'), 'Old patterns should be cleared');
        assert.ok(patterns.includes('**/fake/**/*.ts'), 'Should include fake provider pattern .ts');
        assert.ok(patterns.includes('**/fake/**/*.js'), 'Should include fake provider pattern .js');

        // Restore
        cacheService.getProviders = origGetProviders;
    });

    test('dispose - clears all internal watchers', async () => {
        // Watchers are set up during initialize(); verify they exist first
        assert.ok(
            (service as any).configWatcher !== undefined ||
            (service as any).fileWatcher !== undefined ||
            (service as any).fileEventsWatcher !== undefined,
            'At least one watcher should be active after initialize()',
        );

        service.dispose();

        assert.strictEqual((service as any).configWatcher, undefined, 'configWatcher should be undefined after dispose()');
        assert.strictEqual((service as any).fileWatcher, undefined, 'fileWatcher should be undefined after dispose()');
        assert.strictEqual((service as any).fileEventsWatcher, undefined, 'fileEventsWatcher should be undefined after dispose()');
    });

    test('dispose - is idempotent (safe to call multiple times)', () => {
        assert.doesNotThrow(() => {
            service.dispose();
            service.dispose();
        }, 'Calling dispose() multiple times should not throw');
    });

    test('dispose then re-initialize restores all watchers', async () => {
        // Watchers exist after setup
        assert.ok(
            (service as any).configWatcher !== undefined ||
            (service as any).fileWatcher !== undefined ||
            (service as any).fileEventsWatcher !== undefined,
            'At least one watcher should be active after initialize()',
        );

        // Dispose clears them
        service.dispose();
        assert.strictEqual((service as any).configWatcher, undefined, 'configWatcher cleared after dispose()');
        assert.strictEqual((service as any).fileWatcher, undefined, 'fileWatcher cleared after dispose()');
        assert.strictEqual((service as any).fileEventsWatcher, undefined, 'fileEventsWatcher cleared after dispose()');

        // Re-initialize should restore all watchers
        const context = { subscriptions: [] } as any;
        await service.initialize(context);

        assert.notStrictEqual((service as any).configWatcher, undefined, 'configWatcher should be restored after re-initialize()');
        assert.notStrictEqual((service as any).fileWatcher, undefined, 'fileWatcher should be restored after re-initialize()');
        assert.notStrictEqual((service as any).fileEventsWatcher, undefined, 'fileEventsWatcher should be restored after re-initialize()');
    });

    test('initialize - registers service as a disposable on context.subscriptions', async () => {
        const subscriptions: vscode.Disposable[] = [];
        const context = { subscriptions } as any;

        // Simulate what extension.ts does: initialize then push to subscriptions
        await service.initialize(context);
        subscriptions.push(service);

        assert.ok(
            subscriptions.includes(service),
            'Service should be registered in context.subscriptions',
        );

        // Disposing via subscriptions should clear watchers
        subscriptions.forEach(d => d.dispose());

        assert.strictEqual((service as any).configWatcher, undefined, 'configWatcher should be cleared when disposed via subscriptions');
        assert.strictEqual((service as any).fileWatcher, undefined, 'fileWatcher should be cleared when disposed via subscriptions');
        assert.strictEqual((service as any).fileEventsWatcher, undefined, 'fileEventsWatcher should be cleared when disposed via subscriptions');
    });

    suite('shouldIgnoreTask ($filepath@taskname)', () => {
        test('Special characters in task names', async function() {
            this.timeout(15000);
            const taskNames = [
                'docs:build:serve',
                'docs/build/serve',
                'docs@build',
                'build docs',
                'docs-build-serve',
                'docs_build_serve',
                'docs!build',
                'build (dev)',
                'test[unit]',
                'build 🏗️',
                'task+name',
                'foo$bar',
                'hello.world'
            ];

            const content = taskNames.map(name => `package.json@${name}`).join('\n');
            const ignoreFile = await createFile('task-ignore-special-chars/.tasksignore', content);
            await waitForIgnoreFile(ignoreFile);

            const fileUri = vscode.Uri.joinPath(testFolder, 'task-ignore-special-chars/package.json');

            for (const name of taskNames) {
                assert.strictEqual(service.shouldIgnoreTask(fileUri, name), true, `Should ignore task "${name}"`);
            }
        });

        test('Case sensitivity in task names', async function() {
            this.timeout(5000);
            const content = `package.json
!package.json@docs:build`;
            const ignoreFile = await createFile('task-ignore-case/.tasksignore', content);
            await waitForIgnoreFile(ignoreFile);

            const fileUri = vscode.Uri.joinPath(testFolder, 'task-ignore-case/package.json');

            assert.strictEqual(service.shouldIgnoreTask(fileUri, 'docs:build'), false, 'Exact case match should be un-ignored');
            assert.strictEqual(service.shouldIgnoreTask(fileUri, 'Docs:Build'), true, 'Different case should remain implicitly ignored by file rule');
        });

        test('Rule matches file and task name -> true', async function() {
            this.timeout(10000);
            const ignoreFile = await createFile('task-ignore/.tasksignore', 'package.json@build');
            await waitForIgnoreFile(ignoreFile);

            const fileUri = vscode.Uri.joinPath(testFolder, 'task-ignore/package.json');

            assert.strictEqual(service.shouldIgnore(fileUri), false, 'Should not ignore file itself');
            assert.strictEqual(service.shouldIgnoreTask(fileUri, 'build'), true, 'Should ignore task "build"');
        });

        test('Rule matches file but not task name -> false', async function() {
            this.timeout(5000);
            const ignoreFile = await createFile('task-ignore-nomatch/.tasksignore', 'package.json@build');
            await waitForIgnoreFile(ignoreFile);

            const fileUri = vscode.Uri.joinPath(testFolder, 'task-ignore-nomatch/package.json');

            assert.strictEqual(service.shouldIgnoreTask(fileUri, 'test'), false, 'Should allow task "test"');
        });

        test('Rule does not match file -> false', async function() {
            this.timeout(5000);
            const ignoreFile = await createFile('task-ignore-wrongfile/.tasksignore', 'package.json@build');
            await waitForIgnoreFile(ignoreFile);

            const fileUri = vscode.Uri.joinPath(testFolder, 'task-ignore-wrongfile/other.json');

            assert.strictEqual(service.shouldIgnoreTask(fileUri, 'build'), false, 'Should allow task "build" on different file');
        });

        test('Negation re-includes after file-level ignore -> false', async function() {
            this.timeout(5000);
            const content = `package.json
!package.json@test`;
            const ignoreFile = await createFile('task-ignore-negation/.tasksignore', content);
            await waitForIgnoreFile(ignoreFile);

            const fileUri = vscode.Uri.joinPath(testFolder, 'task-ignore-negation/package.json');

            assert.strictEqual(service.shouldIgnore(fileUri), false, 'File should be rescued by negated task rule');
            assert.strictEqual(service.shouldIgnoreTask(fileUri, 'build'), true, 'Task "build" should be implicitly ignored');
            assert.strictEqual(service.shouldIgnoreTask(fileUri, 'test'), false, 'Task "test" should be re-included');
        });

        test('Last-match-wins', async function() {
            this.timeout(10000);
            const content = `package.json@build
!package.json@build`;
            const ignoreFile1 = await createFile('task-ignore-lastmatch1/.tasksignore', content);
            await waitForIgnoreFile(ignoreFile1);

            const fileUri1 = vscode.Uri.joinPath(testFolder, 'task-ignore-lastmatch1/package.json');
            assert.strictEqual(service.shouldIgnoreTask(fileUri1, 'build'), false, 'Last rule (negated) wins');

            const content2 = `!package.json@build
package.json@build`;
            const ignoreFile2 = await createFile('task-ignore-lastmatch2/.tasksignore', content2);
            await waitForIgnoreFile(ignoreFile2);

            const fileUri2 = vscode.Uri.joinPath(testFolder, 'task-ignore-lastmatch2/package.json');
            assert.strictEqual(service.shouldIgnoreTask(fileUri2, 'build'), true, 'Last rule (positive) wins');
        });

        test('Nested .tasksignore files (deeper rule overrides shallower)', async function() {
            this.timeout(20000);
            const rootIgnore = await createFile('nested-tasks/.tasksignore', 'package.json@build');
            await waitForIgnoreFile(rootIgnore);

            const nestedIgnore = await createFile('nested-tasks/sub/.tasksignore', '!package.json@build');
            await waitForIgnoreFile(nestedIgnore);

            const fileRoot = vscode.Uri.joinPath(testFolder, 'nested-tasks/package.json');
            const fileNested = vscode.Uri.joinPath(testFolder, 'nested-tasks/sub/package.json');

            assert.strictEqual(service.shouldIgnoreTask(fileRoot, 'build'), true, 'Root file should ignore build');
            assert.strictEqual(service.shouldIgnoreTask(fileNested, 'build'), false, 'Nested file should allow build due to negation');
        });
    });

    // ---------------------------------------------------------------------------
    // Regression tests: task-level negation (@) must not be overridden by a
    // secondary disk-check that only examines file rules (issue: "isIgnoredByDiskRules
    // overrides shouldIgnore's correct rescue decision").
    // ---------------------------------------------------------------------------

    test('shouldIgnore - task-level negation rescues file from glob-level ignore', async function() {
        this.timeout(10000);
        // Reproduce: apps/sub/** (ignore all) + !apps/sub/package.json@build (task negation)
        // shouldIgnore must return false for package.json so it remains discoverable.
        const ignoreFile = await createFile('rescue-task-only/.tasksignore',
            `apps/sub/**\n!apps/sub/package.json@build`);
        await waitForIgnoreFile(ignoreFile);

        const rescued = vscode.Uri.joinPath(testFolder, 'rescue-task-only/apps/sub/package.json');
        const ignored  = vscode.Uri.joinPath(testFolder, 'rescue-task-only/apps/sub/other.json');

        assert.strictEqual(service.shouldIgnore(rescued), false, 'package.json must be rescued by task-level negation');
        assert.strictEqual(service.shouldIgnore(ignored),  true,  'other.json has no negation and must remain ignored');
    });

    test('shouldIgnore - file-level negation rescues script from glob-level ignore', async function() {
        this.timeout(10000);
        // Reproduce: apps/sub/** (ignore all) + !apps/sub/script.sh (file negation)
        // shouldIgnore must return false for script.sh so it remains discoverable.
        const ignoreFile = await createFile('rescue-file-only/.tasksignore',
            `apps/sub/**\n!apps/sub/script.sh`);
        await waitForIgnoreFile(ignoreFile);

        const rescued = vscode.Uri.joinPath(testFolder, 'rescue-file-only/apps/sub/script.sh');
        const ignored  = vscode.Uri.joinPath(testFolder, 'rescue-file-only/apps/sub/other.sh');

        assert.strictEqual(service.shouldIgnore(rescued), false, 'script.sh must be rescued by file-level negation');
        assert.strictEqual(service.shouldIgnore(ignored),  true,  'other.sh has no negation and must remain ignored');
    });

    test('shouldIgnore - combined task-level and file-level negations in one .tasksignore', async function() {
        this.timeout(10000);
        // Reproduces the user-reported scenario (using lowercase paths to match
        // normalizePathForComparison which lowercases for cross-platform consistency):
        //   apps/appa/**                        ← ignore everything
        //   !apps/appa/project.json@build       ← task-level rescue (file must surface for provider)
        //   !apps/appa/script1.sh               ← file-level rescue
        const ignoreFile = await createFile('rescue-combined/.tasksignore',
            `apps/appa/**\n!apps/appa/project.json@build\n!apps/appa/script1.sh`);
        await waitForIgnoreFile(ignoreFile);

        const rescuedJson = vscode.Uri.joinPath(testFolder, 'rescue-combined/apps/appa/project.json');
        const rescuedSh   = vscode.Uri.joinPath(testFolder, 'rescue-combined/apps/appa/script1.sh');
        const ignoredJson = vscode.Uri.joinPath(testFolder, 'rescue-combined/apps/appa/other.json');
        const ignoredSh   = vscode.Uri.joinPath(testFolder, 'rescue-combined/apps/appa/other.sh');

        assert.strictEqual(service.shouldIgnore(rescuedJson), false, 'project.json rescued by task-level negation');
        assert.strictEqual(service.shouldIgnore(rescuedSh),   false, 'script1.sh rescued by file-level negation');
        assert.strictEqual(service.shouldIgnore(ignoredJson),  true, 'other.json must remain ignored');
        assert.strictEqual(service.shouldIgnore(ignoredSh),    true, 'other.sh must remain ignored');
    });

    test('Integration - findFiles rescues files via combined task-level and file-level negations (cache path)', async function() {
        this.timeout(15000);

        // Mirrors user-reported bug: both project.json (task negation) and script1.sh (file negation)
        // must appear in findFiles results even though apps/appa/** blocks them at the glob level.
        // Uses lowercase directory name to match normalizePathForComparison behavior.
        await createFile('combined-rescue/apps/appa/project.json', '{"scripts":{"build":"echo build"}}');
        await createFile('combined-rescue/apps/appa/script1.sh',   '#!/bin/bash\necho hello');
        await createFile('combined-rescue/apps/appa/other.json',   '{}');
        await createFile('combined-rescue/apps/appa/other.sh',     '#!/bin/bash\necho other');

        const ignoreFile = await createFile('combined-rescue/.tasksignore',
            `apps/appa/**\n!apps/appa/project.json@build\n!apps/appa/script1.sh`);
        await waitForIgnoreFile(ignoreFile);

        const relativeFolder = vscode.workspace.asRelativePath(testFolder, false);
        const jsonGlob = `**/${relativeFolder}/combined-rescue/**/*.json`.replace(/\\/g, '/');
        const shGlob   = `**/${relativeFolder}/combined-rescue/**/*.sh`.replace(/\\/g, '/');

        service.registerPatterns([jsonGlob, shGlob]);
        service.invalidateCache();

        await waitForFilesIndexed('**/combined-rescue/**/*.json', 2);
        await waitForFilesIndexed('**/combined-rescue/**/*.sh',   2);

        let found: vscode.Uri[] = [];
        for (let i = 0; i < 30; i++) {
            const result = await service.findFiles([jsonGlob, shGlob]);
            const relevant = result.filter(u => u.fsPath.startsWith(testFolder.fsPath));
            if (relevant.length >= 2) {
                found = relevant;
                break;
            }
            await new Promise(r => setTimeout(r, 200));
        }

        assert.strictEqual(found.some(u => u.fsPath.endsWith('project.json')), true,
            'project.json must appear — rescued by task-level negation !apps/appa/project.json@build');
        assert.strictEqual(found.some(u => u.fsPath.endsWith('script1.sh')),   true,
            'script1.sh must appear — rescued by file-level negation !apps/appa/script1.sh');
        assert.strictEqual(found.some(u => u.fsPath.endsWith('other.json')),   false,
            'other.json must remain excluded');
        assert.strictEqual(found.some(u => u.fsPath.endsWith('other.sh')),     false,
            'other.sh must remain excluded');
    });

    test('Integration - findFiles rescues files via task-level negation (uncovered/dynamic pattern path)', async function() {
        this.timeout(15000);

        // Same rescue scenario but through the uncovered-pattern code path
        // (pattern NOT pre-registered, so findFiles queries VS Code directly).
        await createFile('uncovered-rescue/apps/sub/package.json', '{"scripts":{"build":"echo build"}}');
        await createFile('uncovered-rescue/apps/sub/other.json',   '{}');

        const ignoreFile = await createFile('uncovered-rescue/.tasksignore',
            `apps/sub/**\n!apps/sub/package.json@build`);
        await waitForIgnoreFile(ignoreFile);

        const relativeFolder = vscode.workspace.asRelativePath(testFolder, false);
        // Deliberately do NOT register this pattern so it goes through the uncovered path.
        const glob = `**/${relativeFolder}/uncovered-rescue/**/*.json`.replace(/\\/g, '/');
        (service as any).registeredPatterns.delete(glob);

        await waitForFilesIndexed('**/uncovered-rescue/**/*.json', 2);

        const result = await service.findFiles([glob]);
        const relevant = result.filter(u => u.fsPath.startsWith(testFolder.fsPath));

        assert.strictEqual(relevant.some(u => u.fsPath.endsWith('package.json')), true,
            'package.json must appear via uncovered path — task-level negation must rescue it');
        assert.strictEqual(relevant.some(u => u.fsPath.endsWith('other.json')),   false,
            'other.json must remain excluded via uncovered path');
    });

        // -------------------------------------------------------------------------
        // Regression tests: mixed-case path patterns in .tasksignore
        // On Windows, normalizePathForComparison lowercases all paths so patterns
        // written with uppercase letters (e.g. apps/appA/**) must still match files
        // even though micromatch is case-sensitive.
        // -------------------------------------------------------------------------

        test('shouldIgnore - mixed-case glob rescues file via task-level negation', async function() {
            this.timeout(5000);
            // Reproduces: apps/appA/** + !apps/appA/package.json@build (uppercase A)
            // The negation must still rescue package.json despite the casing difference.
            const ignoreFile = await createFile('mixedcase-task-rescue/.tasksignore',
                `apps/appA/**\n!apps/appA/package.json@build`);
            await waitForIgnoreFile(ignoreFile);

            const rescued = vscode.Uri.joinPath(testFolder, 'mixedcase-task-rescue/apps/appA/package.json');
            const ignored  = vscode.Uri.joinPath(testFolder, 'mixedcase-task-rescue/apps/appA/other.json');

            assert.strictEqual(service.shouldIgnore(rescued), false,
                'package.json must be rescued by task-level negation with mixed-case pattern');
            assert.strictEqual(service.shouldIgnore(ignored),  true,
                'other.json has no negation and must remain ignored');
        });

        test('shouldIgnore - mixed-case glob rescues file via file-level negation', async function() {
            this.timeout(5000);
            // Reproduces: apps/appA/** + !apps/appA/script1.sh (uppercase A, file-level negation)
            const ignoreFile = await createFile('mixedcase-file-rescue/.tasksignore',
                `apps/appA/**\n!apps/appA/script1.sh`);
            await waitForIgnoreFile(ignoreFile);

            const rescued = vscode.Uri.joinPath(testFolder, 'mixedcase-file-rescue/apps/appA/script1.sh');
            const ignored  = vscode.Uri.joinPath(testFolder, 'mixedcase-file-rescue/apps/appA/other.sh');

            assert.strictEqual(service.shouldIgnore(rescued), false,
                'script1.sh must be rescued by file-level negation with mixed-case pattern');
            assert.strictEqual(service.shouldIgnore(ignored),  true,
                'other.sh has no negation and must remain ignored');
        });

        test('shouldIgnoreTask - mixed-case pattern allows negated task, blocks others', async function() {
            this.timeout(10000);

            // apps/appA/** + !apps/appA/package.json@build (uppercase A in the glob)
            // shouldIgnoreTask('build') must be false; other tasks must fall back to the file-level block.
            const ignoreFile = await createFile('mixedcase-task-ignore/.tasksignore',
                `apps/appA/**\n!apps/appA/package.json@build`);
            await waitForIgnoreFile(ignoreFile);

            const fileUri = vscode.Uri.joinPath(testFolder, 'mixedcase-task-ignore/apps/appA/package.json');

            assert.strictEqual(service.shouldIgnoreTask(fileUri, 'build'), false,
                'task "build" must be allowed by the negated task-level rule (mixed-case pattern)');
            assert.strictEqual(service.shouldIgnoreTask(fileUri, 'test'), true,
                'task "test" has no negation and must inherit the file-level ignore');
        });

        test('Integration - findFiles rescues files via mixed-case .tasksignore patterns (cache path)', async function() {
            this.timeout(15000);

            // apps/appA/** with mixed-case A blocks all files; negations must rescue the two named files.
            await createFile('mixedcase-combined/apps/appA/package.json', '{"scripts":{"build":"echo build"}}');
            await createFile('mixedcase-combined/apps/appA/script1.sh',   '#!/bin/bash\necho hello');
            await createFile('mixedcase-combined/apps/appA/other.json',   '{}');
            await createFile('mixedcase-combined/apps/appA/other.sh',     '#!/bin/bash\necho other');

            const ignoreFile = await createFile('mixedcase-combined/.tasksignore',
                `apps/appA/**\n!apps/appA/package.json@build\n!apps/appA/script1.sh`);
            await waitForIgnoreFile(ignoreFile);

            const relativeFolder = vscode.workspace.asRelativePath(testFolder, false);
            const jsonGlob = `**/${relativeFolder}/mixedcase-combined/**/*.json`.replace(/\\/g, '/');
            const shGlob   = `**/${relativeFolder}/mixedcase-combined/**/*.sh`.replace(/\\/g, '/');

            service.registerPatterns([jsonGlob, shGlob]);
            service.invalidateCache();

            await waitForFilesIndexed('**/mixedcase-combined/**/*.json', 2);
            await waitForFilesIndexed('**/mixedcase-combined/**/*.sh',   2);

            let found: vscode.Uri[] = [];
            for (let i = 0; i < 30; i++) {
                const result = await service.findFiles([jsonGlob, shGlob]);
                const relevant = result.filter(u => u.fsPath.startsWith(testFolder.fsPath));
                if (relevant.length >= 2) {
                    found = relevant;
                    break;
                }
                await new Promise(r => setTimeout(r, 200));
            }

            assert.strictEqual(found.some(u => u.fsPath.toLowerCase().endsWith('package.json')), true,
                'package.json must appear — rescued by mixed-case task-level negation !apps/appA/package.json@build');
            assert.strictEqual(found.some(u => u.fsPath.toLowerCase().endsWith('script1.sh')),   true,
                'script1.sh must appear — rescued by mixed-case file-level negation !apps/appA/script1.sh');
            assert.strictEqual(found.some(u => u.fsPath.toLowerCase().endsWith('other.json')),   false,
                'other.json must remain excluded');
            assert.strictEqual(found.some(u => u.fsPath.toLowerCase().endsWith('other.sh')),     false,
                'other.sh must remain excluded');
        });
});
