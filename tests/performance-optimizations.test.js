const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const serverJs = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
const appJs = fs.readFileSync(path.join(rootDir, 'public', 'app.js'), 'utf8');

test('server honors configurable batch concurrency and runs the queued batch with mapWithConcurrency', () => {
  assert.match(serverJs, /function readPositiveIntEnv\(name, fallback\)/, 'server.js should support env-tunable concurrency settings.');
  assert.match(serverJs, /AUTOMATION_BATCH_STAGE_CONCURRENCY = readPositiveIntEnv\('AUTOMATION_BATCH_STAGE_CONCURRENCY', 2\)/, 'batch staging concurrency should default above 1 and remain configurable.');
  assert.match(serverJs, /AUTOMATION_REFERENCE_STAGE_CONCURRENCY = readPositiveIntEnv\('AUTOMATION_REFERENCE_STAGE_CONCURRENCY', 2\)/, 'reference staging concurrency should default above 1 and remain configurable.');
  assert.match(serverJs, /const stagedResults = await mapWithConcurrency\(candidates, safeConcurrency, async \(item, index, queueWaitMs\) => \{/, 'the background batch runner should stage queued items with bounded concurrency instead of a serial for-loop.');
  assert.match(serverJs, /automation\.batch\.queue\.started/, 'the server should log when the background batch queue starts.');
  assert.match(serverJs, /automation\.batch\.queue\.finished/, 'the server should log when the background batch queue finishes.');
});

test('server logs publish-plan decisions so SCC ordering waits are diagnosable', () => {
  assert.match(serverJs, /function logPublishPlanDecision\(job, publishPlan\)/, 'server.js should log publish plan evaluations.');
  assert.match(serverJs, /logAutomationTiming\('publish-plan'/, 'server.js should emit publish-plan diagnostics.');
  assert.match(serverJs, /pendingDependencyStatuses:/, 'publish-plan logs should summarize pending dependency states.');
  assert.match(serverJs, /releasedCircularDependencyCount:/, 'publish-plan logs should include released SCC dependency counts.');
});

test('client polls jobs with non-overlapping timers and adaptive intervals', () => {
  assert.match(appJs, /function getJobPollInterval\(job\)/, 'app.js should choose a poll interval based on the current job phase.');
  assert.match(appJs, /current\.inFlight = true;/, 'job polling should mark an in-flight request to avoid duplicate polls.');
  assert.match(appJs, /window\.setTimeout\(runPoll, getJobPollInterval\(latestJob\)\)/, 'job polling should schedule the next poll only after the prior one completes.');
  assert.doesNotMatch(appJs, /window\.setInterval\(async \(\) => \{\s*try \{\s*const job = await api\(`\/api\/jobs\/\$\{encodeURIComponent\(id\)\}`\);/m, 'job polling should not use overlapping setInterval polling for per-job refreshes.');
});


test('server prefers pathInProject metadata and coalesces folder metadata lookups during health staging', () => {
  assert.match(serverJs, /const folderEntityCache = createTimedPromiseCache\(/, 'server.js should cache in-flight ACC folder entity lookups to avoid duplicate 403 ancestry requests.');
  assert.match(serverJs, /folderEntityCache\.getOrCreate\(cacheKey, async \(\) => \{/, 'folder metadata retrieval should share a cached in-flight promise per project and folder id.');
  assert.match(serverJs, /const normalizedPathInProject = normalizePathInProject\(tipPayload\?\.data \|\| itemEntity\);/, 'server.js should inspect pathInProject metadata before walking folder ancestry.');
  assert.match(serverJs, /if \(normalizedPathInProject\) \{[\s\S]*?const preferredPathValue = path\.posix\.extname\(normalizedPathInProject\)/, 'automation item resolution should prefer pathInProject-based local paths when Docs already provides them.');
  assert.match(serverJs, /acc\.folder-path\.segment-skipped/, 'server.js should log a structured warning when an inaccessible ancestor folder is skipped while building a visible path.');
});
