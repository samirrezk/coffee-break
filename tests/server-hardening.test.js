const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const serverJs = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(rootDir, 'public', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(rootDir, 'public', 'app.js'), 'utf8');
const workflowYaml = fs.readFileSync(path.join(rootDir, '.github', 'workflows', 'ci.yml'), 'utf8');

test('server uses structured logger and request logging middleware', () => {
  assert.match(serverJs, /const logger = \{[\s\S]*?child\(defaultContext = \{\}\)/, 'server.js should define a structured logger with child contexts.');
  assert.match(serverJs, /function initializeRequestContext\(req, res, next\)/, 'server.js should initialize a per-request log context.');
  assert.match(serverJs, /function requestLoggingMiddleware\(req, res, next\)/, 'server.js should log request lifecycle events.');
  assert.match(serverJs, /req\.log\?\.info\('request\.start'/, 'server.js should log request start events.');
  assert.match(serverJs, /req\.log\?\.info\('request\.finish'/, 'server.js should log request completion events.');
  assert.match(serverJs, /req\.log\?\.error\('request\.failed'/, 'server.js should log structured request failures.');
  assert.match(serverJs, /logger\.info\('server\.started'/, 'server startup should use structured logging.');
});

test('jobs viewer exports a JSON snapshot from the local jobs database', () => {
  assert.match(serverJs, /function openUrlInDefaultBrowser\(targetUrl\)/, 'server.js should define a default browser opener.');
  assert.match(serverJs, /pathToFileURL\(filePath\)\.href/, 'server.js should open the exported jobs snapshot via a file URL.');
  assert.match(serverJs, /async function exportJobsSnapshotToJsonFile\(sessionId\)/, 'server.js should export the current session jobs from the local database to JSON.');
  assert.match(serverJs, /app\.post\('\/api\/jobs\/open-file',[\s\S]*?exportJobsSnapshotToJsonFile\(_req\.sessionID\);/, 'jobs open route should export the current session jobs before opening them.');
  assert.match(indexHtml, /Open jobs\.json in browser/, 'The UI tooltip text should still reference the browser JSON viewer.');
  assert.match(appJs, /Opened jobs\.json in your default browser\./, 'The client toast should still mention the default browser.');
});

test('lint and CI hooks are configured', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  assert.equal(typeof packageJson.scripts.lint, 'string', 'package.json should expose a lint script.');
  assert.equal(packageJson.scripts.lint.length > 0, true, 'package.json should expose a non-empty lint script.');
  assert.equal(packageJson.scripts.ci.includes('npm run lint'), true, 'package.json should expose a CI convenience script.');
  assert.match(workflowYaml, /npm run check/, 'CI should run static checks.');
  assert.match(workflowYaml, /npm run lint/, 'CI should run lint.');
  assert.match(workflowYaml, /npm test/, 'CI should run tests.');
});
