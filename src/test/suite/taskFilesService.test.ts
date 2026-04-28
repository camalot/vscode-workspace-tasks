import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { TaskFilesService } from '../../services/taskFilesService';
import { TaskCacheService } from '../../services/taskCacheService';

suite('TaskFilesService Test Suite', () => {
    let service: TaskFilesService;
    let disposables: vscode.Disposable[] = [];
    let workspaceRoot: vscode.Uri;
    let testFolder: vscode.Uri;
    let originalGetConfiguration: typeof vscode.workspace.getConfiguration;
    let originalOnDidChangeConfiguration: typeof vscode.workspace.onDidChangeConfiguration;
    let originalOnDidSaveTextDocument: typeof vscode.workspace.onDidSaveTextDocument;
    let mockConfigValues: Record<string, unknown>;
    let capturedConfigChangeHandlers: Array<(e: vscode.ConfigurationChangeEvent) => void | Promise<void>>;
    let capturedDidSaveHandlers: Array<(d: vscode.TextDocument) => void>;

    // Synchronously fire a fake configuration-change event to all captured handlers.
    // Returns a promise that resolves once every async handler finishes.
    const fireConfigChange = async (section: string): Promise<void> => {
        const event: vscode.ConfigurationChangeEvent = {
            affectsConfiguration: (cfg: string) => cfg === section || section.startsWith(cfg + '.'),
        };
        await Promise.all(capturedConfigChangeHandlers.map((h) => h(event)));
    };

    setup(async function(this: Mocha.Context) {
        this.timeout(60000);
        service = TaskFilesService.getInstance();
        // Fully reset singleton lifecycle state from prior suites/tests.
        service.dispose();
        // Defensive reset for singleton state that can leak across tests in CI.
        clearTimeout((service as any)._saveDebounceTimer);
        (service as any)._saveDebounceTimer = undefined;
        (service as any)._pendingProviderTypes?.clear?.();
        mockConfigValues = {};
        capturedConfigChangeHandlers = [];
        capturedDidSaveHandlers = [];

        // Install mocks BEFORE service.initialize() so the service registers with the mock handler
        originalGetConfiguration = vscode.workspace.getConfiguration;
        (vscode.workspace as any).getConfiguration = (section?: string) => {
            if (section === 'workspaceTasks') {
                return {
                    get: <T>(key: string, defaultValue?: T): T =>
                        (Object.prototype.hasOwnProperty.call(mockConfigValues, key)
                            ? mockConfigValues[key]
                            : defaultValue) as T,
                };
            }
            return originalGetConfiguration(section);
        };

        originalOnDidChangeConfiguration = vscode.workspace.onDidChangeConfiguration;
        (vscode.workspace as any).onDidChangeConfiguration = (
            listener: (e: vscode.ConfigurationChangeEvent) => void | Promise<void>,
        ) => {
            capturedConfigChangeHandlers.push(listener);
            return { dispose: () => {
                const idx = capturedConfigChangeHandlers.indexOf(listener);
                if (idx !== -1) { capturedConfigChangeHandlers.splice(idx, 1); }
            } };
        };

        originalOnDidSaveTextDocument = vscode.workspace.onDidSaveTextDocument;
        (vscode.workspace as any).onDidSaveTextDocument = (listener: (d: vscode.TextDocument) => void) => {
            capturedDidSaveHandlers.push(listener);
            return { dispose: () => {
                const idx = capturedDidSaveHandlers.indexOf(listener);
                if (idx !== -1) {
                    capturedDidSaveHandlers.splice(idx, 1);
                }
            } };
        };

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

        // Initialize service (registers its configWatcher with the mock onDidChangeConfiguration)
        const context = { subscriptions: [] } as any;
        await service.initialize(context);
    });

    teardown(async function(this: Mocha.Context) {
        this.timeout(60000);
        // Ensure all watchers/timers are torn down before the next test/suite.
        service.dispose();
        // Ensure no debounced refresh callbacks survive into the next test.
        clearTimeout((service as any)._saveDebounceTimer);
        (service as any)._saveDebounceTimer = undefined;
        (service as any)._pendingProviderTypes?.clear?.();

        try {
            await vscode.workspace.fs.delete(testFolder, { recursive: true, useTrash: false });
        } catch { }

        // Restore mocked APIs; no real config was written so no cleanup needed
        (vscode.workspace as any).getConfiguration = originalGetConfiguration;
        (vscode.workspace as any).onDidChangeConfiguration = originalOnDidChangeConfiguration;
        (vscode.workspace as any).onDidSaveTextDocument = originalOnDidSaveTextDocument;

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

    async function fireDidSave(uri: vscode.Uri): Promise<void> {
        const fakeDocument = { uri } as vscode.TextDocument;
        for (const handler of capturedDidSaveHandlers) {
            handler(fakeDocument);
        }
        await Promise.resolve();
    }

    test('refreshes only taskfile provider when Taskfile is saved', async () => {
        const cache = TaskCacheService.getInstance();
        const originalRefreshProvider = cache.refreshProvider.bind(cache);
        const refreshedTypes: string[] = [];
        cache.refreshProvider = async (type: string) => {
            refreshedTypes.push(type);
        };

        try {
            const taskfileUri = await createFile('Taskfile.yml', 'version: "3"\ntasks:\n  build:\n    cmds:\n      - echo build\n');
            const nonTaskfileUri = await createFile('package.json', '{"scripts":{"build":"echo build"}}');

            await fireDidSave(nonTaskfileUri);
            assert.strictEqual(refreshedTypes.length, 0, 'non-Taskfile save should not refresh taskfile provider');

            await fireDidSave(taskfileUri);
            assert.deepStrictEqual(refreshedTypes, ['taskfile']);
        } finally {
            cache.refreshProvider = originalRefreshProvider;
        }
    });

    test('shouldIgnore - Ignores default patterns (node_modules)', async () => {
        const fileUri = await createFile('node_modules/package.json');
        assert.strictEqual(service.shouldIgnore(fileUri), true, 'Should ignore node_modules by default');
    });

    test('shouldIgnore - Ignores .git', async () => {
        const fileUri = await createFile('.git/config');
        assert.strictEqual(service.shouldIgnore(fileUri), true, 'Should ignore .git by default');
    });

    test('shouldIgnore - Respects workspaceTasks.exclude configuration', async function() {
        this.timeout(60000);
        // Create file that should correspond to new exclude rule
        const fileUri = await createFile('dist/output.js');
        // Initial state check
        assert.strictEqual(service.shouldIgnore(fileUri), false, 'Initially should allow');

        // Update mocked config and fire the event synchronously so the service
        // calls initialize() internally and picks up the new exclude pattern.
        mockConfigValues['exclude'] = ['**/dist/**'];
        await fireConfigChange('workspaceTasks.exclude');

        // Verify immediately — no polling needed because fireConfigChange awaits the handler
        assert.strictEqual(service.shouldIgnore(fileUri), true, 'Should ignore after config update');
    });


    /**
     * Waits until the given glob pattern returns at least `expectedCount` files
     * via vscode.workspace.findFiles. On Linux CI, newly written files can take
     * a moment to be picked up by VS Code's internal file watcher/indexer.
     */
    async function waitForFilesIndexed(glob: string, expectedCount: number, maxRetries = 75): Promise<void> {
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
        this.timeout(60000);
        const fileUri = await createFile('secret/key.txt');
        const allowedUri = await createFile('public/read.txt');

        // Create .tasksignore at root of test folder
        const ignoreFile = await createFile('.tasksignore', 'secret/');

        await waitForIgnoreFile(ignoreFile);

        assert.strictEqual(service.shouldIgnore(fileUri), true, 'Should ignore secret/key.txt based on .tasksignore');
        assert.strictEqual(service.shouldIgnore(allowedUri), false, 'Should allow public/read.txt');
    });

    test('shouldIgnore - Nested .tasksignore takes precedence/adds rules', async function() {
        this.timeout(60000); // Two waitForIgnoreFile calls, each up to 5s

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
        this.timeout(60000);

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

        // Mock getConfiguration so filterByDepth reads a known fetchDepth without touching real settings
        const originalGetConfig = vscode.workspace.getConfiguration;
        let fetchDepthValue: number | null = null;
        (vscode.workspace as any).getConfiguration = (section?: string) => {
            if (section === 'workspaceTasks') {
                return {
                    get: <T>(key: string, defaultValue?: T): T => {
                        if (key === 'taskDiscovery.fetchDepth') { return fetchDepthValue as unknown as T; }
                        return defaultValue as T;
                    },
                };
            }
            return originalGetConfig(section);
        };

        try {
            // 1. Unset limit (null) — filterByDepth reads config on each invocation
            fetchDepthValue = null;
            let filtered = (service as any).filterByDepth(uris);
            assert.strictEqual(filtered.length, 3, 'Should find all 3 files without depth limit');

            // 2. Limit to depth of depth0File
            fetchDepthValue = d0;
            filtered = (service as any).filterByDepth(uris);
            assert.ok(filtered.some((u: vscode.Uri) => u.toString() === depth0File.toString()), 'Should include depth0');
            // If d1 > d0, it should be excluded
            if (d1 > d0) {
                assert.ok(!filtered.some((u: vscode.Uri) => u.toString() === depth1File.toString()), 'Should exclude depth1');
            }

            // 3. Limit to depth of depth1File
            fetchDepthValue = d1;
            filtered = (service as any).filterByDepth(uris);
            assert.ok(filtered.some((u: vscode.Uri) => u.toString() === depth1File.toString()), 'Should include depth1');
            if (d2 > d1) {
                assert.ok(!filtered.some((u: vscode.Uri) => u.toString() === depth2File.toString()), 'Should exclude depth2');
            }
        } finally {
            (vscode.workspace as any).getConfiguration = originalGetConfig;
        }
    });

    test('loadIgnoreFile - Handles comments and empty lines', async function() {
        this.timeout(60000); // Increase timeout for file operations

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
        this.timeout(60000);
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
        this.timeout(60000);

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
        this.timeout(60000);

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
        this.timeout(60000);
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

    test('findFiles with registered patterns applies exclude globs on cached results', async function() {
        this.timeout(60000);
        (service as any).registeredPatterns.clear();
        service.invalidateCache();

        await createFile('findfiles-excludes/allowed/a.json');
        await createFile('findfiles-excludes/vendor/b.json');
        await createFile('findfiles-excludes/allowed/skip.json');

        await waitForFilesIndexed('**/findfiles-excludes/**/*.json', 3);

        const glob = '**/findfiles-excludes/**/*.json';
        service.registerPatterns([glob]);
        service.invalidateCache();

        const all = await service.findFiles([glob]);
        const allRelevant = all.filter(u => u.fsPath.startsWith(testFolder.fsPath));
        assert.strictEqual(allRelevant.length, 3, 'Baseline should include all matching files');

        const filtered = await service.findFiles([glob], [
            '**/findfiles-excludes/vendor/**',
            '**/findfiles-excludes/**/skip.json',
        ]);
        const filteredRelevant = filtered.filter(u => u.fsPath.startsWith(testFolder.fsPath));

        assert.strictEqual(filteredRelevant.length, 1, 'Exclude globs should remove vendor and skip.json files');
        assert.strictEqual(
            filteredRelevant.some(u => u.fsPath.endsWith(path.join('findfiles-excludes', 'allowed', 'a.json'))),
            true,
            'Allowed file should remain after excludes',
        );
    });

    test('invalidateCache works correctly', async function() {
        this.timeout(60000);
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

    test('findFiles does not throw when markCacheStale interrupts an in-flight build (generation mismatch)', async () => {
        // Regression test for: "object null is not iterable" in GitHub Actions CI.
        //
        // Race condition:
        //   1. findFiles() starts buildCache(), which starts _doBuildCache()
        //   2. markCacheStale() fires (e.g. via a file-watcher event) during the
        //      async awaits inside _doBuildCache, incrementing cacheGeneration and
        //      setting cachedPaths = null.
        //   3. _doBuildCache detects the generation mismatch and returns early
        //      WITHOUT setting cachedPaths.
        //   4. findFiles() resumes with cachedPaths still null → Array.from(null) throws.
        //
        // The fix (while-loop in findFiles) retries buildCache() until cachedPaths
        // is non-null so the error never reaches the caller.
        //
        // The mock below replicates step 3 by calling markCacheStale() and then
        // returning early (without calling the real _doBuildCache) on the first
        // invocation, leaving cachedPaths === null.  On the second invocation it
        // delegates to the real implementation, which succeeds.

        service.registerPatterns(['**/race-condition-test/**/*.txt']);
        service.invalidateCache();

        const original_doBuildCache = (service as any)._doBuildCache.bind(service);
        let buildCount = 0;

        (service as any)._doBuildCache = async () => {
            buildCount++;
            if (buildCount === 1) {
                // Simulate markCacheStale() firing mid-build (e.g. from a file-watcher event).
                // This increments cacheGeneration and clears cachedPaths/cacheInvalidated.
                // The real _doBuildCache detects the generation mismatch and returns early
                // WITHOUT populating cachedPaths.  We replicate that abort by returning here
                // so that cachedPaths remains null, which drives the while-loop retry in findFiles().
                (service as any).markCacheStale();
                return;
            }
            return original_doBuildCache();
        };

        try {
            // Must NOT throw despite the first build aborting without setting cachedPaths.
            const result = await service.findFiles(['**/race-condition-test/**/*.txt']);
            assert.ok(Array.isArray(result), 'findFiles should return an array, not throw');
            assert.ok(buildCount >= 2, `Expected at least 2 _doBuildCache calls (got ${buildCount}); first should abort, second should succeed`);
        } finally {
            (service as any)._doBuildCache = original_doBuildCache;
        }
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

    test('buildCache coalesces concurrent requests into a single scan', async () => {
        // Register a pattern so buildCache has something to scan
        service.registerPatterns(['**/package.json']);

        // Track how many times _doBuildCache is called
        const original_doBuildCache = (service as any)._doBuildCache.bind(service);
        let doBuildCacheCallCount = 0;
        (service as any)._doBuildCache = async () => {
            doBuildCacheCallCount++;
            return original_doBuildCache();
        };

        try {
            // Inject a pending in-flight promise so that the NEXT buildCache() call
            // hits the coalesce branch (buildCacheInFlight !== null).
            let inflightResolve: () => void;
            const inflightPromise = new Promise<void>((resolve) => { inflightResolve = resolve; });
            (service as any).buildCacheInFlight = inflightPromise;

            // Call buildCache() while an in-flight build exists — should coalesce
            const coalescedCall = (service as any).buildCache();

            // Resolve the fake in-flight promise so the coalesced call settles
            inflightResolve!();
            await coalescedCall;

            // _doBuildCache must NOT have been invoked (coalesce returned early)
            assert.strictEqual(doBuildCacheCallCount, 0, '_doBuildCache should not be called again when a build is already in flight');
        } finally {
            // Restore original method
            (service as any)._doBuildCache = original_doBuildCache;
        }
    });

    suite('shouldIgnoreTask ($filepath@taskname)', () => {
        test('Special characters in task names', async function() {
            this.timeout(60000);
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
            this.timeout(60000);
            const content = `package.json
!package.json@docs:build`;
            const ignoreFile = await createFile('task-ignore-case/.tasksignore', content);
            await waitForIgnoreFile(ignoreFile);

            const fileUri = vscode.Uri.joinPath(testFolder, 'task-ignore-case/package.json');

            assert.strictEqual(service.shouldIgnoreTask(fileUri, 'docs:build'), false, 'Exact case match should be un-ignored');
            assert.strictEqual(service.shouldIgnoreTask(fileUri, 'Docs:Build'), true, 'Different case should remain implicitly ignored by file rule');
        });

        test('Rule matches file and task name -> true', async function() {
            this.timeout(60000);
            const ignoreFile = await createFile('task-ignore/.tasksignore', 'package.json@build');
            await waitForIgnoreFile(ignoreFile);

            const fileUri = vscode.Uri.joinPath(testFolder, 'task-ignore/package.json');

            assert.strictEqual(service.shouldIgnore(fileUri), false, 'Should not ignore file itself');
            assert.strictEqual(service.shouldIgnoreTask(fileUri, 'build'), true, 'Should ignore task "build"');
        });

        test('Rule matches file but not task name -> false', async function() {
            this.timeout(60000);
            const ignoreFile = await createFile('task-ignore-nomatch/.tasksignore', 'package.json@build');
            await waitForIgnoreFile(ignoreFile);

            const fileUri = vscode.Uri.joinPath(testFolder, 'task-ignore-nomatch/package.json');

            assert.strictEqual(service.shouldIgnoreTask(fileUri, 'test'), false, 'Should allow task "test"');
        });

        test('Rule does not match file -> false', async function() {
            this.timeout(60000);
            const ignoreFile = await createFile('task-ignore-wrongfile/.tasksignore', 'package.json@build');
            await waitForIgnoreFile(ignoreFile);

            const fileUri = vscode.Uri.joinPath(testFolder, 'task-ignore-wrongfile/other.json');

            assert.strictEqual(service.shouldIgnoreTask(fileUri, 'build'), false, 'Should allow task "build" on different file');
        });

        test('Negation re-includes after file-level ignore -> false', async function() {
            this.timeout(60000);
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
            this.timeout(60000);
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
            this.timeout(60000);
            const rootIgnore = await createFile('nested-tasks/.tasksignore', 'package.json@build');
            await waitForIgnoreFile(rootIgnore);

            const nestedIgnore = await createFile('nested-tasks/sub/.tasksignore', '!package.json@build');
            await waitForIgnoreFile(nestedIgnore);

            const fileRoot = vscode.Uri.joinPath(testFolder, 'nested-tasks/package.json');
            const fileNested = vscode.Uri.joinPath(testFolder, 'nested-tasks/sub/package.json');

            assert.strictEqual(service.shouldIgnoreTask(fileRoot, 'build'), true, 'Root file should ignore build');
            assert.strictEqual(service.shouldIgnoreTask(fileNested, 'build'), false, 'Nested file should allow build due to negation');
        });

        test('Glob pattern in task name (e.g. "npm: *") matches tasks with that prefix', async function() {
            this.timeout(60000);
            const content = '.vscode/tasks.json@npm: *';
            const ignoreFile = await createFile('task-ignore-glob/.tasksignore', content);
            await waitForIgnoreFile(ignoreFile);

            const fileUri = vscode.Uri.joinPath(testFolder, 'task-ignore-glob/.vscode/tasks.json');

            assert.strictEqual(service.shouldIgnoreTask(fileUri, 'npm: test'), true, 'Should ignore "npm: test"');
            assert.strictEqual(service.shouldIgnoreTask(fileUri, 'npm: compile'), true, 'Should ignore "npm: compile"');
            assert.strictEqual(service.shouldIgnoreTask(fileUri, 'npm: watch'), true, 'Should ignore "npm: watch"');
            assert.strictEqual(service.shouldIgnoreTask(fileUri, 'build'), false, 'Should not ignore unrelated task "build"');
        });

        test('Glob pattern in task name negation (e.g. "!tasks.json@npm: *") re-includes tasks', async function() {
            this.timeout(60000);
            const content = `.vscode/tasks.json\n!.vscode/tasks.json@npm: *`;
            const ignoreFile = await createFile('task-ignore-glob-negation/.tasksignore', content);
            await waitForIgnoreFile(ignoreFile);

            const fileUri = vscode.Uri.joinPath(testFolder, 'task-ignore-glob-negation/.vscode/tasks.json');

            assert.strictEqual(service.shouldIgnoreTask(fileUri, 'npm: test'), false, 'Should allow "npm: test" via negated glob');
            assert.strictEqual(service.shouldIgnoreTask(fileUri, 'npm: compile'), false, 'Should allow "npm: compile" via negated glob');
            assert.strictEqual(service.shouldIgnoreTask(fileUri, 'build'), true, 'Should still ignore "build" (not covered by negation)');
        });
    });

    // ---------------------------------------------------------------------------
    // Regression tests: task-level negation (@) must not be overridden by a
    // secondary disk-check that only examines file rules (issue: "isIgnoredByDiskRules
    // overrides shouldIgnore's correct rescue decision").
    // ---------------------------------------------------------------------------

    test('shouldIgnore - task-level negation rescues file from glob-level ignore', async function() {
        this.timeout(60000);
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
        this.timeout(60000);
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
        this.timeout(60000);
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
        this.timeout(60000);

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
        this.timeout(60000);

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
            this.timeout(60000);
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
            this.timeout(60000);
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
            this.timeout(60000);

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
            this.timeout(60000);

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

    // -------------------------------------------------------------------------
    // Regression: modifying a .tasksignore in a subfolder must apply new rules
    // immediately.  Before the fix the onDidChange handler started loadIgnoreFile
    // without awaiting it, so invalidateCache() fired while the ignore-files list
    // still held the stale entry.  The next cache rebuild therefore saw
    // alreadyLoaded=true and skipped reloading, keeping stale rules.
    // -------------------------------------------------------------------------

    test('Updating a subfolder .tasksignore immediately applies new rules (regression: race condition)', async function() {
        this.timeout(60000);

        // Step 1: create a deep subfolder .tasksignore that initially blocks **/package.json
        const ignoreFile = await createFile('subfolder-update/apps/appA/.tasksignore', '**/package.json');
        await waitForIgnoreFile(ignoreFile);

        const pkgUri = vscode.Uri.joinPath(testFolder, 'subfolder-update/apps/appA/package.json');

        // Initial rule says "ignore **/package.json" — verify it is ignored
        assert.strictEqual(service.shouldIgnore(pkgUri), true, 'package.json should be ignored by initial rule');

        // Step 2: overwrite the .tasksignore so that it no longer ignores package.json
        await vscode.workspace.fs.writeFile(ignoreFile, Buffer.from('# no rules'));

        // Step 3: simulate the FIXED watcher path: await loadIgnoreFile, then invalidateCache
        // (This is what the fixed onDidChange handler does: async uri => { await this.loadIgnoreFile(uri); this.invalidateCache(); })
        await (service as any).loadIgnoreFile(ignoreFile);
        service.invalidateCache();

        // Step 4: the new rules should be in effect immediately
        assert.strictEqual(service.shouldIgnore(pkgUri), false,
            'package.json should no longer be ignored after subfolder .tasksignore is updated and reloaded');
    });

    test('Updating a root .tasksignore task-level rule via awaited reload applies new task filter rules', async function() {
        this.timeout(60000);

        const uniqueTaskName = 'rootUpdateUniqueTask';

        // Initial rule: ignore build task in any package.json
        const ignoreFile = await createFile('root-update/.tasksignore', `**/package.json@${uniqueTaskName}`);
        await waitForIgnoreFile(ignoreFile);

        const pkgUri = vscode.Uri.joinPath(testFolder, 'root-update/package.json');

        assert.strictEqual(service.shouldIgnoreTask(pkgUri, uniqueTaskName), true,
            'build task should be ignored by initial rule');

        // Change rule: no longer ignore the build task
        await vscode.workspace.fs.writeFile(ignoreFile, Buffer.from('# no rules'));

        // Fixed watcher path
        await (service as any).loadIgnoreFile(ignoreFile);
        service.invalidateCache();

        assert.strictEqual(service.shouldIgnoreTask(pkgUri, uniqueTaskName), false,
            'build task should no longer be ignored after root .tasksignore is updated');
    });

    test('Race condition: without awaiting loadIgnoreFile, stale rules may persist', async function() {
        this.timeout(60000);
        // This test demonstrates WHY the fix (awaiting loadIgnoreFile) is necessary.
        // Without await, the ignoreFiles list still has the old entry when invalidateCache
        // triggers a rebuild, causing syncIgnoreFiles to skip the reload.

        // Create a subfolder .tasksignore that ignores package.json
        const ignoreFile = await createFile('race-condition/apps/.tasksignore', 'package.json');
        await waitForIgnoreFile(ignoreFile);

        const pkgUri = vscode.Uri.joinPath(testFolder, 'race-condition/apps/package.json');
        assert.strictEqual(service.shouldIgnore(pkgUri), true, 'Initially ignored');

        // Overwrite the file  to remove the rule
        await vscode.workspace.fs.writeFile(ignoreFile, Buffer.from('# cleared'));

        // Simulate the OLD (broken) watcher path: call loadIgnoreFile without awaiting,
        // then immediately invalidate.  Since loadIgnoreFile is async and the test
        // itself awaits nothing between these two lines, the ignoreFiles entry still
        // holds the stale data when we check below — the file read is a promise that
        // hasn't resolved yet.
        const loadPromise = (service as any).loadIgnoreFile(ignoreFile); // intentionally not awaited
        service.invalidateCache(); // fires immediately with stale ignoreFiles

        // shouldIgnore called here still sees the OLD rules because loadIgnoreFile
        // has not yet resolved (we never awaited it)
        assert.strictEqual(service.shouldIgnore(pkgUri), true,
            'Stale rule still active when loadIgnoreFile was not awaited before invalidateCache');

        // Now resolve the load and confirm the fix kicks in
        await loadPromise;
        service.invalidateCache();
        assert.strictEqual(service.shouldIgnore(pkgUri), false,
            'Rule removed after awaiting loadIgnoreFile and re-invalidating');
    });

    // ── onDidInitialScanComplete (Phase 3 Pre-condition A) ────────────────────

    suite('onDidInitialScanComplete', () => {
        test('fires once after the first successful _doBuildCache', async () => {
            // Reset the initialScanFired flag so we can observe the event freshly
            (service as any).initialScanFired = false;
            (service as any).cachedPaths = null;
            (service as any).cacheInvalidated = true;

            let firedCount = 0;
            const disposable = service.onDidInitialScanComplete(() => { firedCount++; });
            disposables.push(disposable);

            // Run a cache build by calling findFiles
            await service.findFiles(['**/package.json']);

            // The event is scheduled via queueMicrotask — wait for it
            await new Promise<void>((resolve) => queueMicrotask(resolve));

            assert.strictEqual(firedCount, 1, 'onDidInitialScanComplete should fire exactly once after first build');
        });

        test('fires only once even if cache is rebuilt multiple times', async () => {
            (service as any).initialScanFired = false;
            (service as any).cachedPaths = null;
            (service as any).cacheInvalidated = true;

            let firedCount = 0;
            const disposable = service.onDidInitialScanComplete(() => { firedCount++; });
            disposables.push(disposable);

            // First build
            await service.findFiles(['**/package.json']);
            await new Promise<void>((resolve) => queueMicrotask(resolve));

            // Invalidate and trigger a second build (simulate file change)
            (service as any).initialScanFired = true; // keep it true — only first scan fires event
            (service as any).cacheInvalidated = true;
            (service as any).cachedPaths = null;
            await service.findFiles(['**/package.json']);
            await new Promise<void>((resolve) => queueMicrotask(resolve));

            assert.strictEqual(firedCount, 1, 'onDidInitialScanComplete should only fire once regardless of rebuilds');
        });

        test('does not fire until a cache build actually completes', async () => {
            (service as any).initialScanFired = false;

            let fired = false;
            const disposable = service.onDidInitialScanComplete(() => { fired = true; });
            disposables.push(disposable);

            // Before any build, event should not have fired
            assert.strictEqual(fired, false, 'Event should not fire before a cache build runs');
        });

        test('getCachedPathCount returns 0 when cache not built', () => {
            (service as any).cachedPaths = null;
            assert.strictEqual(service.getCachedPathCount(), 0);
        });

        test('getCachedPathCount returns the size of cachedPaths', () => {
            (service as any).cachedPaths = new Set(['/a', '/b', '/c']);
            assert.strictEqual(service.getCachedPathCount(), 3);
        });

        test('hasRegisteredPatterns returns false when no patterns registered', () => {
            (service as any).registeredPatterns = new Set();
            assert.strictEqual(service.hasRegisteredPatterns(), false);
        });

        test('hasRegisteredPatterns returns true when patterns are registered', () => {
            (service as any).registeredPatterns = new Set(['**/package.json']);
            assert.strictEqual(service.hasRegisteredPatterns(), true);
        });
    });

    // ─── Uncovered-pattern batch coalescing ──────────────────────────────────

    suite('uncovered batch coalescing', () => {
        let originalFindFiles: typeof vscode.workspace.findFiles;
        let findFilesCalls: string[];

        setup(() => {
            originalFindFiles = vscode.workspace.findFiles;
            findFilesCalls = [];
            // Remove all registered patterns so every call goes through the uncovered path
            (service as any).registeredPatterns = new Set<string>();
            // Reset batch state
            (service as any).uncoveredBatchQueue = [];
            (service as any).uncoveredBatchScheduled = false;
        });

        teardown(() => {
            (vscode.workspace as any).findFiles = originalFindFiles;
            (service as any).registeredPatterns = new Set<string>();
            (service as any).uncoveredBatchQueue = [];
            (service as any).uncoveredBatchScheduled = false;
        });

        test('concurrent findFiles calls with uncovered patterns are coalesced into one vscode.workspace.findFiles call', async () => {
            const uriA = vscode.Uri.file('/workspace/Cargo.toml');
            const uriB = vscode.Uri.file('/workspace/go.mod');
            const uriC = vscode.Uri.file('/workspace/pyproject.toml');

            // Mock so each known pattern returns its own file; the combined batch
            // pattern contains all three so all three URIs are returned together.
            (vscode.workspace as any).findFiles = async (pattern: string) => {
                // skip internal .tasksignore calls
                if (pattern.includes('.tasksignore')) { return []; }
                findFilesCalls.push(pattern);
                const results: vscode.Uri[] = [];
                if (pattern.includes('Cargo.toml')) { results.push(uriA); }
                if (pattern.includes('go.mod')) { results.push(uriB); }
                if (pattern.includes('pyproject.toml')) { results.push(uriC); }
                return results;
            };

            // Fire three concurrent uncovered findFiles calls (mirrors WorkspaceTasksProvider Phase 2)
            const [r1, r2, r3] = await Promise.all([
                service.findFiles(['**/Cargo.toml']),
                service.findFiles(['**/go.mod']),
                service.findFiles(['**/pyproject.toml']),
            ]);

            assert.strictEqual(findFilesCalls.length, 1, 'Should make exactly one vscode.workspace.findFiles call');
            assert.ok(r1.some(u => u.fsPath === uriA.fsPath), 'cargo result should contain Cargo.toml');
            assert.ok(r2.some(u => u.fsPath === uriB.fsPath), 'go result should contain go.mod');
            assert.ok(r3.some(u => u.fsPath === uriC.fsPath), 'poetry result should contain pyproject.toml');
        });

        test('sequential (non-concurrent) findFiles calls each get their own query', async () => {
            const uriA = vscode.Uri.file('/workspace/Cargo.toml');
            const uriB = vscode.Uri.file('/workspace/go.mod');

            (vscode.workspace as any).findFiles = async (pattern: string) => {
                if (pattern.includes('.tasksignore')) { return []; }
                findFilesCalls.push(pattern);
                if (pattern.includes('Cargo')) { return [uriA]; }
                if (pattern.includes('go.mod')) { return [uriB]; }
                return [];
            };

            // Sequential calls — each is awaited before the next starts, so they cannot coalesce
            const r1 = await service.findFiles(['**/Cargo.toml']);
            const r2 = await service.findFiles(['**/go.mod']);

            assert.strictEqual(findFilesCalls.length, 2, 'Sequential calls should each produce their own query');
            assert.ok(r1.some(u => u.fsPath === uriA.fsPath), 'First call should find Cargo.toml');
            assert.ok(r2.some(u => u.fsPath === uriB.fsPath), 'Second call should find go.mod');
        });

        test('per-request exclude is applied in memory after coalesced batch query', async () => {
            const uriA = vscode.Uri.file('/workspace/src/Cargo.toml');
            const uriB = vscode.Uri.file('/workspace/vendor/Cargo.toml');

            // Both URIs returned by the batch query
            (vscode.workspace as any).findFiles = async (pattern: string) => {
                if (pattern.includes('.tasksignore')) { return []; }
                findFilesCalls.push(pattern);
                return [uriA, uriB];
            };

            // Two concurrent calls: one excludes vendor/**, the other does not
            const [rFiltered, rUnfiltered] = await Promise.all([
                service.findFiles(['**/Cargo.toml'], ['**/vendor/**']),
                service.findFiles(['**/Cargo.toml']),
            ]);

            assert.strictEqual(findFilesCalls.length, 1, 'Should still make only one batch query');
            assert.ok(!rFiltered.some(u => u.fsPath === uriB.fsPath), 'vendor/ Cargo.toml should be excluded from filtered result');
            assert.ok(rFiltered.some(u => u.fsPath === uriA.fsPath), 'src/ Cargo.toml should appear in filtered result');
            assert.ok(rUnfiltered.some(u => u.fsPath === uriB.fsPath), 'vendor/ Cargo.toml should appear in unfiltered result');
            assert.ok(rUnfiltered.some(u => u.fsPath === uriA.fsPath), 'src/ Cargo.toml should appear in unfiltered result');
        });

        test('coalesced uncovered path forwards only common excludes to vscode.findFiles', async () => {
            const uriA = vscode.Uri.file('/workspace/src/Cargo.toml');
            const uriB = vscode.Uri.file('/workspace/vendor/Cargo.toml');
            let capturedExcludeGlob: string | undefined;

            (vscode.workspace as any).findFiles = async (pattern: string, exclude?: string) => {
                if (pattern.includes('.tasksignore')) { return []; }
                findFilesCalls.push(pattern);
                capturedExcludeGlob = exclude;
                // Simulate VS Code applying the forwarded exclude glob.
                if (exclude?.includes('**/vendor/**')) {
                    return [uriA];
                }
                return [uriA, uriB];
            };

            const [r1, r2] = await Promise.all([
                service.findFiles(['**/Cargo.toml'], ['**/vendor/**', '**/tmp/**']),
                service.findFiles(['**/Cargo.toml'], ['**/vendor/**', '**/cache/**']),
            ]);

            assert.strictEqual(findFilesCalls.length, 1, 'Concurrent uncovered queries should still coalesce');
            assert.strictEqual(capturedExcludeGlob, '**/vendor/**', 'Only common exclude should be forwarded to VS Code query');
            assert.ok(!r1.some(u => u.fsPath === uriB.fsPath), 'First request should exclude vendor path');
            assert.ok(!r2.some(u => u.fsPath === uriB.fsPath), 'Second request should exclude vendor path');
            assert.ok(r1.some(u => u.fsPath === uriA.fsPath), 'First request should keep non-excluded path');
            assert.ok(r2.some(u => u.fsPath === uriA.fsPath), 'Second request should keep non-excluded path');
        });

        test('errors from the batch query are propagated to all waiting callers', async () => {
            const batchError = new Error('findFiles batch failure');
            (vscode.workspace as any).findFiles = async (pattern: string) => {
                if (pattern.includes('.tasksignore')) { return []; }
                throw batchError;
            };

            const [r1, r2] = await Promise.allSettled([
                service.findFiles(['**/Cargo.toml']),
                service.findFiles(['**/go.mod']),
            ]);

            assert.strictEqual(r1.status, 'rejected', 'First caller should receive the error');
            assert.strictEqual(r2.status, 'rejected', 'Second caller should receive the error');
            assert.strictEqual((r1 as PromiseRejectedResult).reason, batchError);
            assert.strictEqual((r2 as PromiseRejectedResult).reason, batchError);
        });
    });

    // ── Save-refresh tests (T01–T06) ──────────────────────────────────────────

    test('T01 — saving package.json refreshes matching providers after debounce', async function() {
        this.timeout(5000);
        const cache = TaskCacheService.getInstance();
        const refreshedTypes: string[] = [];

        const originalGetProviders = cache.getProviders.bind(cache);
        const originalRefreshProvider = cache.refreshProvider.bind(cache);
        cache.getProviders = () => [{ type: 'npm', getFilePatterns: () => ['**/package.json'], getTasks: async () => [] } as any];
        cache.refreshProvider = async (type: string) => { refreshedTypes.push(type); };

        service.registerPatterns(['**/save-refresh-test/package.json']);

        try {
            await fireDidSave(vscode.Uri.file('/workspace/save-refresh-test/package.json'));
            assert.deepStrictEqual(refreshedTypes, [], 'refreshProvider should not fire immediately');
            await new Promise(r => setTimeout(r, 400));
            assert.deepStrictEqual(refreshedTypes, ['npm'], 'refreshProvider should fire once for the matching provider after debounce');
        } finally {
            cache.getProviders = originalGetProviders;
            cache.refreshProvider = originalRefreshProvider;
        }
    });

    test('T02 — saving a non-matching file does not trigger any refresh', async function() {
        this.timeout(2000);
        const cache = TaskCacheService.getInstance();
        const refreshedTypes: string[] = [];

        const originalGetProviders = cache.getProviders.bind(cache);
        const originalRefreshProvider = cache.refreshProvider.bind(cache);
        cache.getProviders = () => [{ type: 'npm', getFilePatterns: () => ['**/package.json'], getTasks: async () => [] } as any];
        cache.refreshProvider = async (type: string) => { refreshedTypes.push(type); };

        try {
            await fireDidSave(vscode.Uri.file('/workspace/README.md'));
            await new Promise(r => setTimeout(r, 400));
            assert.deepStrictEqual(refreshedTypes, [], 'non-matching file save should not trigger refreshProvider');
        } finally {
            cache.getProviders = originalGetProviders;
            cache.refreshProvider = originalRefreshProvider;
        }
    });

    test('T03 — saving Taskfile.yml calls refreshProvider not invalidateCache', async function() {
        this.timeout(2000);
        const cache = TaskCacheService.getInstance();
        const refreshedTypes: string[] = [];
        let invalidateCount = 0;

        const originalRefresh = cache.refreshProvider.bind(cache);
        cache.refreshProvider = async (type: string) => { refreshedTypes.push(type); };
        const originalInvalidate = service.invalidateCache.bind(service);
        service.invalidateCache = () => { invalidateCount++; originalInvalidate(); };

        try {
            await fireDidSave(vscode.Uri.file('/workspace/Taskfile.yml'));
            await new Promise(r => setTimeout(r, 400));
            assert.deepStrictEqual(refreshedTypes, ['taskfile']);
            assert.strictEqual(invalidateCount, 0, 'invalidateCache must not fire for Taskfile.yml save');
        } finally {
            cache.refreshProvider = originalRefresh;
            service.invalidateCache = originalInvalidate;
        }
    });

    test('T03b — initialize clears pending debounced provider refresh state', async function() {
        this.timeout(5000);
        const cache = TaskCacheService.getInstance();
        const refreshedTypes: string[] = [];

        const originalGetProviders = cache.getProviders.bind(cache);
        const originalRefreshProvider = cache.refreshProvider.bind(cache);
        cache.getProviders = () => [{ type: 'mockType', getFilePatterns: () => ['**/package.json'], getTasks: async () => [] } as any];
        cache.refreshProvider = async (type: string) => { refreshedTypes.push(type); };

        service.registerPatterns(['**/package.json']);

        try {
            await fireDidSave(vscode.Uri.file('/workspace/package.json'));
            assert.deepStrictEqual(refreshedTypes, [], 'refresh should remain debounced before reinitialize');

            await service.initialize({ subscriptions: [] } as any);
            await new Promise(r => setTimeout(r, 400));

            assert.deepStrictEqual(refreshedTypes, [], 'reinitialize should cancel pending debounced provider refreshes');
        } finally {
            cache.getProviders = originalGetProviders;
            cache.refreshProvider = originalRefreshProvider;
        }
    });

    test('T04 — three rapid saves of the same file coalesce into one provider refresh', async function() {
        this.timeout(3000);
        const cache = TaskCacheService.getInstance();
        const refreshedTypes: string[] = [];

        const originalGetProviders = cache.getProviders.bind(cache);
        const originalRefreshProvider = cache.refreshProvider.bind(cache);
        cache.getProviders = () => [{ type: 'npm', getFilePatterns: () => ['**/package.json'], getTasks: async () => [] } as any];
        cache.refreshProvider = async (type: string) => { refreshedTypes.push(type); };

        service.registerPatterns(['**/debounce-test/package.json']);
        const uri = vscode.Uri.file('/workspace/debounce-test/package.json');

        try {
            await fireDidSave(uri);
            await fireDidSave(uri);
            await fireDidSave(uri);
            assert.deepStrictEqual(refreshedTypes, [], 'Should not fire immediately');
            await new Promise(r => setTimeout(r, 400));
            assert.deepStrictEqual(refreshedTypes, ['npm'], 'Debounce should coalesce three saves into one refreshProvider call');
        } finally {
            cache.getProviders = originalGetProviders;
            cache.refreshProvider = originalRefreshProvider;
        }
    });

    test('T05 — saving an untitled document does not trigger any refresh', async function() {
        this.timeout(2000);
        const cache = TaskCacheService.getInstance();
        const refreshedTypes: string[] = [];
        const originalRefresh = cache.refreshProvider.bind(cache);
        cache.refreshProvider = async (type: string) => { refreshedTypes.push(type); };

        try {
            const untitledUri = vscode.Uri.parse('untitled:package.json');
            await fireDidSave(untitledUri);
            await new Promise(r => setTimeout(r, 400));
            assert.deepStrictEqual(refreshedTypes, [], 'untitled document save should not trigger refreshProvider');
        } finally {
            cache.refreshProvider = originalRefresh;
        }
    });

    test('T06 — after dispose(), saving a task file does not trigger any refresh', async function() {
        this.timeout(2000);
        const cache = TaskCacheService.getInstance();
        const refreshedTypes: string[] = [];

        const originalGetProviders = cache.getProviders.bind(cache);
        const originalRefreshProvider = cache.refreshProvider.bind(cache);
        cache.getProviders = () => [{ type: 'npm', getFilePatterns: () => ['**/package.json'], getTasks: async () => [] } as any];
        cache.refreshProvider = async (type: string) => { refreshedTypes.push(type); };

        service.registerPatterns(['**/dispose-test/package.json']);
        const uri = vscode.Uri.file('/workspace/dispose-test/package.json');

        try {
            service.dispose();
            // After dispose, captured handlers are removed via their dispose()
            // callbacks; clear our captured list to reflect that state.
            capturedDidSaveHandlers.length = 0;

            await fireDidSave(uri);
            await new Promise(r => setTimeout(r, 400));
            assert.deepStrictEqual(refreshedTypes, [], 'No refresh should occur after dispose()');
        } finally {
            cache.getProviders = originalGetProviders;
            cache.refreshProvider = originalRefreshProvider;
        }
    });

});
