import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { WorkspaceTasksService } from '../../services/workspaceTasksService';
import { TaskFilesService } from '../../services/taskFilesService';

// Helper to wait for async operations if needed
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

suite('WorkspaceTasksService Test Suite', () => {
    let service: WorkspaceTasksService;
    let originalFindFiles: any;
    let originalFsDescriptor: PropertyDescriptor | undefined;
    let originalShowInputBox: any;
    let originalShowQuickPick: any;
    let originalGetWorkspaceFolder: any;
    let originalTaskFilesFindFiles: any;
    let originalFsExistsSyncDescriptor: PropertyDescriptor | undefined;
    let originalFsReadFile: any;

    setup(() => {
        service = WorkspaceTasksService.getInstance();
        // Reset config implementation detail
        (service as any).config = {};
        // Clear context so it doesn't try to load defaults
        (service as any).context = undefined;

        originalFindFiles = vscode.workspace.findFiles;
        originalFsDescriptor = Object.getOwnPropertyDescriptor(vscode.workspace, 'fs');
        originalShowInputBox = vscode.window.showInputBox;
        originalShowQuickPick = vscode.window.showQuickPick;
        originalGetWorkspaceFolder = vscode.workspace.getWorkspaceFolder;

        // Mock native fs to prevent loading defaults
        originalFsExistsSyncDescriptor = Object.getOwnPropertyDescriptor(fs, 'existsSync');
        originalFsReadFile = fs.promises.readFile;
        try {
            Object.defineProperty(fs, 'existsSync', {
                value: () => false,
                writable: true,
                configurable: true
            });
        } catch {
            // Some Node runtimes expose existsSync as read-only getter; skip mocking in that case.
        }

        // Mock TaskFilesService.findFiles to return empty array by default
        const taskFilesService = TaskFilesService.getInstance();
        originalTaskFilesFindFiles = taskFilesService.findFiles;
        taskFilesService.findFiles = async () => [];

        // Default mocks
        vscode.workspace.findFiles = async () => [];

        // Mock the entire fs object using defineProperty
        const mockFs = {
            ...vscode.workspace.fs,
            readFile: async () => new Uint8Array()
        };
        Object.defineProperty(vscode.workspace, 'fs', {
            value: mockFs,
            writable: true,
            configurable: true
        });

        vscode.workspace.getWorkspaceFolder = () => undefined;
    });

    teardown(() => {
        vscode.workspace.findFiles = originalFindFiles;

        // Restore original fs descriptor
        if (originalFsDescriptor) {
            Object.defineProperty(vscode.workspace, 'fs', originalFsDescriptor);
        }

        vscode.window.showInputBox = originalShowInputBox;
        vscode.window.showQuickPick = originalShowQuickPick;
        vscode.workspace.getWorkspaceFolder = originalGetWorkspaceFolder;

        // Restore native fs functions
        if (originalFsExistsSyncDescriptor) {
            try {
                Object.defineProperty(fs, 'existsSync', originalFsExistsSyncDescriptor);
            } catch {
                (fs as any).existsSync = originalFsExistsSyncDescriptor.value;
            }
        }
        (fs.promises as any).readFile = originalFsReadFile;

        // Restore TaskFilesService.findFiles
        const taskFilesService = TaskFilesService.getInstance();
        taskFilesService.findFiles = originalTaskFilesFindFiles;
    });

    test('getProviders returns empty array initially', async () => {
        const providers = await service.getProviders();
        assert.deepStrictEqual(providers, []);
    });

    test('Loads configuration from found files', async () => {
        const mockUri = vscode.Uri.file('/test/.workspace-tasks.json');

        vscode.workspace.findFiles = async (include: any) => {
             // Basic check to ensure it asks for right files
             if (include.toString().includes('.workspace-tasks.json')) {
                 return [mockUri];
             }
             return [];
        };

        // Mock TaskFilesService.findFiles to return the mock file
        const taskFilesService = TaskFilesService.getInstance();
        taskFilesService.findFiles = async (patterns) => {
            if (patterns.includes('**/.workspace-tasks.json')) {
                return [mockUri];
            }
            return [];
        };

        const configData = {
            "myLanguage": {
                "tasks": [
                    {
                        "label": "My Task",
                        "type": "workspace",
                        "command": "echo hello"
                    }
                ]
            }
        };

        const mockFs = {
            ...vscode.workspace.fs,
            readFile: async (uri: vscode.Uri) => {
                if (uri.fsPath === mockUri.fsPath) {
                    return Buffer.from(JSON.stringify(configData));
                }
                return new Uint8Array();
            }
        };
        Object.defineProperty(vscode.workspace, 'fs', {
            value: mockFs,
            writable: true,
            configurable: true
        });

        const providers = await service.getProviders();
        assert.ok(providers.includes('myLanguage'), 'Should have loaded myLanguage provider');

        const tasks = await service.getTasks('myLanguage');
        assert.strictEqual(tasks.length, 1);
        assert.strictEqual(tasks[0].label, 'My Task');
        assert.strictEqual(tasks[0].command, 'echo hello');
        // Check sourceUri is set
        assert.strictEqual(tasks[0].sourceUri, mockUri);
    });

    test('Merges Configurations correctly', async () => {
        const uri1 = vscode.Uri.file('/test/1/.workspace-tasks.json');
        const uri2 = vscode.Uri.file('/test/2/.workspace-tasks.json');

        vscode.workspace.findFiles = async () => [uri1, uri2];

        // Mock TaskFilesService.findFiles
        const taskFilesService = TaskFilesService.getInstance();
        taskFilesService.findFiles = async () => [uri1, uri2];

        const config1 = {
            "lang": {
                "inputs": [{ "id": "input1", "type": "promptString", "description": "desc1" }],
                "tasks": [{ "label": "Task1", "type": "workspace", "command": "cmd1" }]
            }
        };
        const config2 = {
            "lang": {
                "inputs": [{ "id": "input2", "type": "promptString", "description": "desc2" }],
                "tasks": [{ "label": "Task2", "type": "workspace", "command": "cmd2" }]
            }
        };

        const mockFs = {
            ...vscode.workspace.fs,
            readFile: async (uri: vscode.Uri) => {
                if (uri.fsPath === uri1.fsPath) return Buffer.from(JSON.stringify(config1));
                if (uri.fsPath === uri2.fsPath) return Buffer.from(JSON.stringify(config2));
                return new Uint8Array();
            }
        };
        Object.defineProperty(vscode.workspace, 'fs', {
            value: mockFs,
            writable: true,
            configurable: true
        });

        await service.getProviders();
        const tasks = await service.getTasks('lang');
        assert.strictEqual(tasks.length, 2);

        const config = service.getLanguageConfig('lang');
        assert.strictEqual(config?.inputs.length, 2);
    });

    test('Handles Invalid JSON gracefully', async () => {
        const mockUri = vscode.Uri.file('/test/invalid.json');
        vscode.workspace.findFiles = async () => [mockUri];

        // Mock TaskFilesService.findFiles
        const taskFilesService = TaskFilesService.getInstance();
        taskFilesService.findFiles = async () => [mockUri];

        const mockFs = {
            ...vscode.workspace.fs,
            readFile: async () => Buffer.from("{ invalid json ")
        };
        Object.defineProperty(vscode.workspace, 'fs', {
            value: mockFs,
            writable: true,
            configurable: true
        });

        // Should not throw
        await service.getProviders();
        const tasks = await service.getTasks('any');
        assert.strictEqual(tasks.length, 0);
    });

    test('resolveTaskCommand replaces {{ .FileName }}', async () => {
        const langId = 'testLang';
        (service as any).config = {
            [langId]: {
                tasks: [{ "label": "t1", "command": "run {{ .FileName }}", "type": "workspace" }],
                inputs: []
            }
        };

        const uri = vscode.Uri.file('/path/to/script.py');
        const cmd = await service.resolveTaskCommand('t1', langId, uri);
        assert.strictEqual(cmd, 'run script.py');
    });

    test('resolveTaskCommand prompts for input (promptString)', async () => {
        const langId = 'testLang';
        (service as any).config = {
            [langId]: {
                tasks: [{ "label": "t1", "command": "echo {{ .MyVar }}", "type": "workspace" }],
                inputs: [{ "id": "MyVar", "type": "promptString", "description": "Enter value" }]
            }
        };

        vscode.window.showInputBox = async (opts?: vscode.InputBoxOptions) => {
            if (opts) {
                assert.strictEqual(opts.prompt, "Enter value");
            }
            return "foobar";
        };

        const cmd = await service.resolveTaskCommand('t1', langId, vscode.Uri.file('foo'));
        assert.strictEqual(cmd, 'echo foobar');
    });

    test('resolveTaskCommand uses default prompt value if provided', async () => {
         const langId = 'testLang';
         (service as any).config = {
             [langId]: {
                 tasks: [{ "label": "t2", "command": "echo {{ .MyVar }}", "type": "workspace" }],
                 inputs: [{ "id": "MyVar", "type": "promptString", "description": "Desc", "default": "defaultValue" }]
             }
         };

         vscode.window.showInputBox = async (opts?: vscode.InputBoxOptions) => {
             if (opts) {
                 assert.strictEqual(opts.value, "defaultValue");
                 return opts.value;
             }
             return undefined;
         };

         const cmd = await service.resolveTaskCommand('t2', langId, vscode.Uri.file('foo'));
         assert.strictEqual(cmd, 'echo defaultValue');
    });

    test('resolveTaskCommand handles ${workspaceFolderBasename} in default', async () => {
        const langId = 'testLang';
        (service as any).config = {
            [langId]: {
                tasks: [{ "label": "t3", "command": "echo {{ .MyVar }}", "type": "workspace" }],
                inputs: [{ "id": "MyVar", "type": "promptString", "description": "Desc", "default": "${workspaceFolderBasename}" }]
            }
        };

        const uri = vscode.Uri.file('/root/myProject/file.txt');
        vscode.workspace.getWorkspaceFolder = (_u: vscode.Uri) => ({ uri: vscode.Uri.file('/root/myProject'), name: 'myProject', index: 0 });

        vscode.window.showInputBox = async (opts?: vscode.InputBoxOptions) => {
            if (opts) {
                assert.strictEqual(opts.value, "myProject");
                return opts.value;
            }
            return undefined;
        };

        const cmd = await service.resolveTaskCommand('t3', langId, uri);
        assert.strictEqual(cmd, 'echo myProject');
   });

    test('resolveTaskCommand uses pickString', async () => {
        const langId = 'testLang';
        (service as any).config = {
            [langId]: {
                tasks: [{ "label": "tPick", "command": "echo {{ .PickVar }}", "type": "workspace" }],
                inputs: [{ "id": "PickVar", "type": "pickString", "description": "Pick one", "options": ["A", "B"] }]
            }
        };

        // @ts-ignore
        vscode.window.showQuickPick = async (items: any[], _opts: vscode.QuickPickOptions) => {
            assert.deepStrictEqual(items, ["A", "B"]);
            return "B";
        };

        const cmd = await service.resolveTaskCommand('tPick', langId, vscode.Uri.file('foo'));
        assert.strictEqual(cmd, 'echo B');
    });

    test('resolveTaskCommand returns undefined if user cancels input', async () => {
        const langId = 'testLang';
        (service as any).config = {
            [langId]: {
                tasks: [{ "label": "tCancel", "command": "echo {{ .MyVar }}", "type": "workspace" }],
                inputs: [{ "id": "MyVar", "type": "promptString", "description": "Desc" }]
            }
        };

        vscode.window.showInputBox = async () => undefined;

        const cmd = await service.resolveTaskCommand('tCancel', langId, vscode.Uri.file('foo'));
        assert.strictEqual(cmd, undefined);
    });

    test('resolveTaskCommand ignores unknown variables', async () => {
        // If input is not defined, it warns and continues?, wait code says:
        // if (!inputDef) { logger.warn; continue; }
        // so {{ .Unknown }} remains in string.

        const langId = 'testLang';
        (service as any).config = {
            [langId]: {
                tasks: [{ "label": "tUnknown", "command": "echo {{ .Unknown }}", "type": "workspace" }],
                inputs: []
            }
        };

        const cmd = await service.resolveTaskCommand('tUnknown', langId, vscode.Uri.file('foo'));
        assert.strictEqual(cmd, 'echo {{ .Unknown }}');
    });

    test('getLanguageConfig case insensitivity', async () => {
        (service as any).config = {
            "MyLang": { tasks: [], inputs: [], version: "1" }
        };
        const config = service.getLanguageConfig('mylang');
        assert.ok(config);
        assert.strictEqual(config?.version, "1");
    });

    test('resolveTaskCommand/getLanguageConfig return undefined for unknown IDs', async () => {
        // @ts-ignore
        const cmd = await service.resolveTaskCommand('t', 'unknownLang', vscode.Uri.file('/'));
        assert.strictEqual(cmd, undefined);

        const config = service.getLanguageConfig('unknownLang');
        assert.strictEqual(config, undefined);
    });

    test('resolveTaskCommand returns undefined for unknown task label', async () => {
         const langId = 'test';
         (service as any).config = {
             [langId]: { tasks: [], inputs: [], version: '1' }
         };
         // @ts-ignore
         const cmd = await service.resolveTaskCommand('unknownTask', langId, vscode.Uri.file('/'));
         assert.strictEqual(cmd, undefined);
    });

    test('Merges Globs correctly', async () => {
         const uri1 = vscode.Uri.file('/1');
         const uri2 = vscode.Uri.file('/2');
         // @ts-ignore
         vscode.workspace.findFiles = async () => [uri1, uri2];

         // Mock TaskFilesService.findFiles
         const taskFilesService = TaskFilesService.getInstance();
         taskFilesService.findFiles = async () => [uri1, uri2];

         const c1 = { "l": { "version": "1", "inputs": [], "tasks": [], "globs": { "include": ["i1"], "exclude": ["e1"] } } };
         const c2 = { "l": { "version": "1", "inputs": [], "tasks": [], "globs": { "include": ["i2"] } } };

         const mockFs = {
             ...vscode.workspace.fs,
             readFile: async (uri: vscode.Uri) => {
                 if (uri.fsPath === uri1.fsPath) return Buffer.from(JSON.stringify(c1));
                 if (uri.fsPath === uri2.fsPath) return Buffer.from(JSON.stringify(c2));
                 return new Uint8Array();
             }
         };
         Object.defineProperty(vscode.workspace, 'fs', {
             value: mockFs,
             writable: true,
             configurable: true
         });

         await service.getProviders();
         const config = service.getLanguageConfig('l');
         assert.deepStrictEqual(config?.globs?.include, ["i1", "i2"]);
         assert.deepStrictEqual(config?.globs?.exclude, ["e1"]);
    });

    test('initialize sets context', () => {
        const ctx: any = { extensionPath: '/ext' };
        service.initialize(ctx);
        assert.strictEqual((service as any).context, ctx);
    });
});
