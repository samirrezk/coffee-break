const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const serverJs = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');

test('job storage keeps batch submission state monotonic and logs downgrade attempts', () => {
  assert.match(serverJs, /function normalizeBatchSubmissionStateValue\(incomingState, existingState, context = \{\}\)/, 'server.js should normalize batch submission state transitions.');
  assert.match(serverJs, /jobs\.batch-submission-state\.downgrade-ignored/, 'server.js should log when a stale write tries to downgrade a ready batch state back to submitting.');
  assert.match(serverJs, /jobs\.batch-submission-state\.changed/, 'server.js should log batch submission state changes for diagnostics.');
  assert.match(serverJs, /function mergeStoredJobRecord\(job, existingJob = null\)/, 'server.js should merge stored jobs through a shared normalization path.');
});

test('server can reconcile a stale batch submission gate and logs batch snapshots', () => {
  assert.match(serverJs, /async function reconcileBatchSubmissionGate\(sessionId, batchId, \{/, 'server.js should expose a batch gate reconciliation helper.');
  assert.match(serverJs, /automation\.batch\.submission-state\.blocked/, 'server.js should log when a batch cannot yet be marked ready.');
  assert.match(serverJs, /automation\.batch\.submission-state\.reconciled/, 'server.js should log when a stale batch gate is auto-reconciled.');
  assert.match(serverJs, /automation\.batch\.submission-state\.decorated/, 'server.js should emit a post-decoration batch readiness snapshot.');
  assert.match(serverJs, /automation\.batch\.submission-state\.queue-finished/, 'server.js should emit a queue-finished batch readiness snapshot.');
});

test('refreshJobStatus reconciles the batch gate before keeping ACC publish pending', () => {
  assert.match(serverJs, /reason: 'refresh-terminal-success'/, 'refreshJobStatus should attempt batch gate reconciliation for already-terminal success jobs.');
  assert.match(serverJs, /reason: 'refresh-live-success'/, 'refreshJobStatus should attempt batch gate reconciliation when a poll first sees success.');
  assert.match(serverJs, /if \(batchGate\.ready\) \{\s*merged = \{\s*\.\.\.merged,\s*batchSubmissionState: 'ready',/m, 'refreshJobStatus should flip the current job to ready when reconciliation succeeds.');
});
