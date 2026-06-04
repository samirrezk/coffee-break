const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const serverJs = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
const appJs = fs.readFileSync(path.join(rootDir, 'public', 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(rootDir, 'public', 'index.html'), 'utf8');
const setupStates = JSON.parse(fs.readFileSync(path.join(rootDir, 'storage', 'automation-setups.json'), 'utf8'));

test('ref canvas smoke expectations stay intact', () => {
  assert.equal(Array.isArray(setupStates), false, 'storage/automation-setups.json must be an object, not an array.');
  assert.match(serverJs, /diagnosticLog/, 'server.js should retain a diagnostic health log in session on setup failures.');
  assert.match(appJs, /window\.open\(url, '_blank', 'noopener'\)/, 'public/app.js should open the health log in a new tab from the status badge.');
  assert.match(serverJs, /class SharedJsonSessionStore extends session\.Store/, 'server.js should replace MemoryStore with a persistent shared session store.');
  assert.match(serverJs, /store:\s*sessionStore/, 'express-session should use the shared session store.');
  assert.match(serverJs, /app\.use\('\/api', csrfProtection\);/, 'CSRF protection should be applied to API routes.');
  assert.match(appJs, /request\.headers\['x-csrf-token'\] = state\.csrfToken;/, 'public/app.js should send the CSRF token on mutating API requests.');
  assert.match(serverJs, /app\.post\('\/api\/jobs\/clear',[\s\S]*?clearJobsForSession\(req\.sessionID\);[\s\S]*?clearStoredRefCanvasHealthSession\(req, req\.sessionID\);[\s\S]*?res\.status\(204\)\.end\(\);[\s\S]*?\}\)\);/, 'jobs clear should only clear the current session state.');
  assert.doesNotMatch(serverJs, /app\.post\('\/api\/jobs\/clear',[\s\S]*clearArtifactStageCache\(/, 'jobs clear should not wipe the shared artifact cache.');
  assert.doesNotMatch(serverJs, /app\.post\('\/api\/jobs\/clear',[\s\S]*preparedAutomationRefGraphCache\.clear\(/, 'jobs clear should not wipe the shared ref graph cache.');
  assert.match(indexHtml, /<strong>Health Report<\/strong>/, 'The canvas health panel title should be Health Report.');
  assert.match(indexHtml, /experimental \| created with ai and human/, 'The footer disclaimer typo should be corrected.');
});
