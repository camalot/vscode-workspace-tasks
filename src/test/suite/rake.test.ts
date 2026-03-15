import * as assert from 'assert';
import { RakeTaskProvider } from '../../providers/rakeTaskProvider';
import constants from '../../libs/constants';

suite('Rake Provider Test Suite', () => {
  test('uses correct type', function () {
    const provider = new RakeTaskProvider();
    assert.strictEqual(provider.type, 'rake');
  });

  test('uses correct file pattern', function () {
    const provider = new RakeTaskProvider();
    assert.strictEqual(provider.filePattern, constants.GLOB_RAKE);
  });

  test('parses rake output with task names and descriptions', function () {
    const provider = new RakeTaskProvider();
    const sampleOutput = `rake test                # Run all tests
rake build               # Build the project
rake deploy              # Deploy to production
rake db:create           # Create the database
rake db:migrate          # Migrate the database
rake assets:precompile   # Precompile assets`;

    const tasks = (provider as any).parseRakeOutput(sampleOutput);

    assert.strictEqual(tasks.length, 6);
    assert.strictEqual(tasks[0].name, 'test');
    assert.strictEqual(tasks[0].description, 'Run all tests');
    assert.strictEqual(tasks[1].name, 'build');
    assert.strictEqual(tasks[1].description, 'Build the project');
    assert.strictEqual(tasks[3].name, 'db:create');
    assert.strictEqual(tasks[3].description, 'Create the database');
    assert.strictEqual(tasks[5].name, 'assets:precompile');
    assert.strictEqual(tasks[5].description, 'Precompile assets');
  });

  test('parses rake output with tasks without descriptions', function () {
    const provider = new RakeTaskProvider();
    const sampleOutput = `rake test
rake build               # Build the project`;

    const tasks = (provider as any).parseRakeOutput(sampleOutput);

    assert.strictEqual(tasks.length, 2);
    assert.strictEqual(tasks[0].name, 'test');
    assert.strictEqual(tasks[0].description, undefined);
    assert.strictEqual(tasks[1].name, 'build');
    assert.strictEqual(tasks[1].description, 'Build the project');
  });

  test('handles empty rake output', function () {
    const provider = new RakeTaskProvider();
    const sampleOutput = '';

    const tasks = (provider as any).parseRakeOutput(sampleOutput);

    assert.strictEqual(tasks.length, 0);
  });

  test('handles rake output with extra whitespace', function () {
    const provider = new RakeTaskProvider();
    const sampleOutput = `rake test                              # Run all tests
rake build       # Build the project
rake deploy#Deploy to production`;

    const tasks = (provider as any).parseRakeOutput(sampleOutput);

    assert.strictEqual(tasks.length, 3);
    assert.strictEqual(tasks[0].name, 'test');
    assert.strictEqual(tasks[0].description, 'Run all tests');
    assert.strictEqual(tasks[1].name, 'build');
    assert.strictEqual(tasks[1].description, 'Build the project');
    assert.strictEqual(tasks[2].name, 'deploy');
    assert.strictEqual(tasks[2].description, 'Deploy to production');
  });

  test('ignores non-rake lines in output', function () {
    const provider = new RakeTaskProvider();
    const sampleOutput = `Some warning message
rake test                # Run all tests
Another random line
rake build               # Build the project
Error: something happened`;

    const tasks = (provider as any).parseRakeOutput(sampleOutput);

    assert.strictEqual(tasks.length, 2);
    assert.strictEqual(tasks[0].name, 'test');
    assert.strictEqual(tasks[1].name, 'build');
  });

  test('parses namespaced rake tasks', function () {
    const provider = new RakeTaskProvider();
    const sampleOutput = `rake db:create           # Create the database
rake db:migrate          # Migrate the database
rake db:seed             # Seed the database
rake assets:precompile   # Precompile assets
rake assets:clean        # Clean compiled assets`;

    const tasks = (provider as any).parseRakeOutput(sampleOutput);

    assert.strictEqual(tasks.length, 5);
    assert.strictEqual(tasks[0].name, 'db:create');
    assert.strictEqual(tasks[1].name, 'db:migrate');
    assert.strictEqual(tasks[2].name, 'db:seed');
    assert.strictEqual(tasks[3].name, 'assets:precompile');
    assert.strictEqual(tasks[4].name, 'assets:clean');
  });

  test('getCommand returns default rake command', function () {
    const provider = new RakeTaskProvider();
    const result = provider.getCommand();

    assert.strictEqual(result.command, 'rake');
    assert.ok(Array.isArray(result.args));
    assert.ok(result.cwd);
  });

  test('getTasks returns array', async function () {
    this.timeout(20000);
    const provider = new RakeTaskProvider();
    const tasks = await provider.getTasks();

    assert.ok(Array.isArray(tasks));
    // Tasks may or may not exist depending on if rake is installed and if it can find the test files
  });

  test('getSystemTasks returns array', async function () {
    this.timeout(10000);
    const provider = new RakeTaskProvider();
    const tasks = await provider.getSystemTasks();

    assert.ok(Array.isArray(tasks));
    // System tasks depend on VSCode's rake support being available
  });

  test('parses rake task names with underscores and hyphens', function () {
    const provider = new RakeTaskProvider();
    const sampleOutput = `rake test_unit           # Run unit tests
rake test-integration    # Run integration tests
rake build_all           # Build all components`;

    const tasks = (provider as any).parseRakeOutput(sampleOutput);

    assert.strictEqual(tasks.length, 3);
    assert.strictEqual(tasks[0].name, 'test_unit');
    assert.strictEqual(tasks[1].name, 'test-integration');
    assert.strictEqual(tasks[2].name, 'build_all');
  });

  test('handles rake output with unicode characters in descriptions', function () {
    const provider = new RakeTaskProvider();
    const sampleOutput = `rake test                # Run all tests ✓
rake build               # Build the project 🔨
rake deploy              # Deploy to production 🚀`;

    const tasks = (provider as any).parseRakeOutput(sampleOutput);

    assert.strictEqual(tasks.length, 3);
    assert.strictEqual(tasks[0].description, 'Run all tests ✓');
    assert.strictEqual(tasks[1].description, 'Build the project 🔨');
    assert.strictEqual(tasks[2].description, 'Deploy to production 🚀');
  });

  test('handles rake tasks with complex namespaces', function () {
    const provider = new RakeTaskProvider();
    const sampleOutput = `rake db:test:prepare     # Prepare test database
rake rails:update:bin    # Update bin directory
rake app:template:apply  # Apply template`;

    const tasks = (provider as any).parseRakeOutput(sampleOutput);

    assert.strictEqual(tasks.length, 3);
    assert.strictEqual(tasks[0].name, 'db:test:prepare');
    assert.strictEqual(tasks[1].name, 'rails:update:bin');
    assert.strictEqual(tasks[2].name, 'app:template:apply');
  });
});
