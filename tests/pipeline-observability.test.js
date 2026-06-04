const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const serverJs = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
const appJs = fs.readFileSync(path.join(rootDir, 'public', 'app.js'), 'utf8');

test('server prewarms batch artifacts and stages queued work with a byte budget', () => {
  assert.match(serverJs, /AUTOMATION_BATCH_STAGE_MAX_INFLIGHT_BYTES = readPositiveIntEnv\('AUTOMATION_BATCH_STAGE_MAX_INFLIGHT_BYTES', 512 \* 1024 \* 1024\)/, 'server.js should expose a configurable in-flight byte budget for background staging.');
  assert.match(serverJs, /async function mapWithWeightedBudget\(/, 'server.js should provide a weighted scheduler for byte-budget-aware work.');
  assert.match(serverJs, /async function prewarmAutomationBatchArtifacts\(/, 'server.js should prewarm shared source and reference artifacts for a batch.');
  assert.match(serverJs, /batch\.prewarm\.started/, 'the server should log when batch prewarm begins.');
  assert.match(serverJs, /batch\.prewarm\.finished/, 'the server should log when batch prewarm completes.');
  assert.match(serverJs, /mapWithWeightedBudget\([\s\S]*workEntries,[\s\S]*maxWeight: AUTOMATION_BATCH_STAGE_MAX_INFLIGHT_BYTES/, 'the background batch runner should use the byte-budget scheduler for queued work.');
});

test('server and client expose publish queue observability and live job updates', () => {
  assert.match(serverJs, /app\.get\('\/api\/events'/, 'server.js should expose an SSE endpoint for live job updates.');
  assert.match(serverJs, /app\.get\('\/api\/bootstrap'/, 'server.js should expose a bootstrap endpoint for config, jobs, and engines.');
  assert.match(serverJs, /publish\.queue\.started/, 'server.js should log when the publish queue begins evaluating a batch.');
  assert.match(serverJs, /publish\.queue\.finished/, 'server.js should log when the publish queue finishes a batch pass.');
  assert.match(serverJs, /job\.summary/, 'server.js should emit compact per-job summaries.');
  assert.match(serverJs, /external\.call/, 'server.js should log external APS calls with timing metadata.');
  assert.match(serverJs, /cache\.lookup/, 'server.js should log cache lookups for ref graphs and staged artifacts.');
  assert.match(appJs, /await api\('\/api\/bootstrap'\)/, 'app.js should bootstrap the shell from the combined endpoint.');
  assert.match(appJs, /new window\.EventSource\('\/api\/events'\)/, 'app.js should subscribe to SSE job updates.');
  assert.match(appJs, /function getPublishQueueInfo\(job\)/, 'app.js should summarize publish queue state for the job viewer.');
});

test('server can relax overlay-only publish waits behind a fast-publish flag', () => {
  assert.match(serverJs, /AUTOMATION_FAST_OVERLAY_PUBLISH = readBooleanEnv\('AUTOMATION_FAST_OVERLAY_PUBLISH', false\)/, 'server.js should expose a fast overlay publish flag.');
  assert.match(serverJs, /status: 'released-overlay'/, 'overlay-only batches should be able to release queued publish dependencies using the last stable version when enabled.');
});

test('client invalidates stale browser responses during hub and folder refreshes', () => {
  assert.match(appJs, /function beginBrowserGeneration\(\)/, 'app.js should track a generation for browser refresh cycles.');
  assert.match(appJs, /function isActiveBrowserGeneration\(generation\)/, 'app.js should guard async browser responses by generation.');
  assert.match(appJs, /if \(!isActiveBrowserGeneration\(activeGeneration\)\) \{\n\s*return;\n\s*\}/, 'browser loaders should discard stale async responses after a newer refresh starts.');
});
