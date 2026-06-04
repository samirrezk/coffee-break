const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const serverJs = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
const appJs = fs.readFileSync(path.join(rootDir, 'public', 'app.js'), 'utf8');

test('Ref Canvas health updates broadcast live and repaint bubbles for batch-selected files', () => {
  assert.match(serverJs, /function broadcastRefCanvasHealthEvent\(sessionId, entry\)/, 'server.js should define a session event broadcaster for Ref Canvas health updates.');
  assert.match(serverJs, /type: 'ref-canvas-health-updated'/, 'server.js should emit a ref-canvas-health-updated session event.');
  assert.match(appJs, /function applyRefCanvasHealthEvent\(entry\)/, 'public/app.js should apply live Ref Canvas health updates to the current graph.');
  assert.match(appJs, /payload\.type === 'ref-canvas-health-updated' && payload\.entry/, 'public/app.js should react to ref-canvas-health-updated session events.');
  assert.match(appJs, /node\.healthStatus = String\(entry\?\.normalizedHealth \|\| 'unknown'\)/, 'public/app.js should continue to map normalized health to the bubble node state.');
  assert.match(appJs, /copy\.textContent = 'Running drawing health automation, please wait for output report\.'/, 'The Ref Canvas health copy should use the requested status sentence.');
  assert.match(appJs, /copy\.textContent = 'Drawing primary ingredients';/, 'The health counts section should use the requested wording.');
});

test('health summary parser only reads the correct HealthReport spelling', () => {
  assert.match(serverJs, /header\.HealthReport/, 'server.js should read the canonical HealthReport header value.');
  assert.doesNotMatch(serverJs, /HealthReprot/, 'server.js should no longer parse the misspelled HealthReprot field.');
});

test('folder id recovery tries multiple ACC folder namespaces before failing', () => {
  assert.match(serverJs, /const KNOWN_ACC_FOLDER_NAMESPACES = \['wipprod', 'wips5jku'\];/, 'server.js should define the supported ACC folder namespaces for recovery.');
  assert.match(serverJs, /async function tryResolveAccFolderIdCandidates\(projectId, folderId, token, context = 'ACC folder id'\)/, 'server.js should attempt to recover malformed or bare ACC folder ids.');
  assert.match(serverJs, /buildCandidateAccFolderUrns\(folderId\)/, 'server.js should build namespace fallback candidates for ACC folder ids.');
  assert.match(serverJs, /const recoveredFolderId = await tryResolveAccFolderIdCandidates\(projectId, folderId, token, context\);/, 'resolveAccFolderId should use the folder namespace recovery path before failing.');
});

test('folder normalization keeps richer Desktop Connector folder names', () => {
  assert.match(serverJs, /entity\?\.attributes\?\.name\s*\|\|\s*entity\?\.attributes\?\.displayName/, 'server.js should prefer the richer ACC name field before displayName when both exist.');
  assert.match(serverJs, /extensionType\.includes\('folder'\)/, 'server.js should recognize folder-like entities by extension type as well as raw type.');
  assert.match(serverJs, /extractAccFolderId\(folder\?\.relationships\?\.contents\)/, 'normalizeFolder should attempt to recover a folder id from relationships.contents when direct ids are incomplete.');
});
