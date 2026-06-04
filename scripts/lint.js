const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const rootDir = path.resolve(__dirname, '..');
const serverJs = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
const appJs = fs.readFileSync(path.join(rootDir, 'public', 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(rootDir, 'public', 'index.html'), 'utf8');
const workflowYaml = fs.readFileSync(path.join(rootDir, '.github', 'workflows', 'ci.yml'), 'utf8');
const testFiles = fs.readdirSync(path.join(rootDir, 'tests')).filter((name) => name.endsWith('.js'));

const failures = [];

function check(name, fn) {
  try {
    fn();
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}

check('server structured logging', () => {
  assert.match(serverJs, /const logger = \{[\s\S]*?child\(defaultContext = \{\}\)/);
  assert.match(serverJs, /req\.log\?\.info\('request\.start'/);
  assert.match(serverJs, /req\.log\?\.info\('request\.finish'/);
  const consoleMatches = serverJs.match(/console.(?:log|warn|error|info)/g) || [];
  assert.equal(consoleMatches.length, 0, 'server.js should not use raw console logging.');
});

check('browser log opening copy', () => {
  assert.doesNotMatch(indexHtml, /Open jobs\.json in Notepad/);
  assert.match(indexHtml, /Open jobs\.json in browser/);
  assert.match(appJs, /Opened jobs\.json in your default browser\./);
});

check('CI workflow', () => {
  assert.match(workflowYaml, /npm run check/);
  assert.match(workflowYaml, /npm run lint/);
  assert.match(workflowYaml, /npm test/);
});

check('test coverage hooks', () => {
  assert.ok(testFiles.length >= 2, 'at least two automated test files should exist.');
});

if (failures.length) {
  process.stderr.write(`lint failed\n${failures.map((entry) => `- ${entry}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('lint passed\n');
