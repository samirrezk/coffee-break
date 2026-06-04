const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const serverJs = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
const appJs = fs.readFileSync(path.join(rootDir, 'public', 'app.js'), 'utf8');

test('selected-file Ref Canvas queues batched health automation while folder-only canvas stays graph-only', () => {
  assert.match(appJs, /async function queueRefCanvasHealthForSelection\(itemIds\)/, 'public/app.js should batch queue health automation for selected Ref Canvas files.');
  assert.match(appJs, /if \(seedIds\.length\) \{\s*await queueRefCanvasHealthForSelection\(seedIds\);/s, 'Ref Canvas should auto-queue health runs only when selected DWGs seed the graph.');
  assert.doesNotMatch(appJs, /else \{\s*await queueRefCanvasHealthForSelection/s, 'Folder-tree Ref Canvas should not auto-queue health automation when no files are selected.');
  assert.match(serverJs, /const rawItemIds = Array\.isArray\(req\.body\?\.itemIds\)/, 'The health run route should accept batched itemIds.');
  assert.match(serverJs, /runRefCanvasHealthBatchForSession\(req, req\.sessionID, projectId, queuedItemIds\)/, 'The server should submit selected Ref Canvas items through the batched health pipeline.');
  assert.match(serverJs, /startStagedAutomationInputPreparation\(/, 'The health submission path should reuse the shared staging/reference pipeline entrypoint.');
  assert.match(serverJs, /finishStagedAutomationInputPreparation\(/, 'The health submission path should reuse the shared staged-input finalization helper.');
});
