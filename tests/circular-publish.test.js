const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const serverJs = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
const appJs = fs.readFileSync(path.join(rootDir, 'public', 'app.js'), 'utf8');

test('server uses SCC-based publish resolution instead of pair-only circle bypass logic', () => {
  assert.match(serverJs, /function findStronglyConnectedComponents\(graph\)/, 'server.js should define SCC discovery for batch publish dependencies.');
  assert.match(serverJs, /function buildBatchPublishSccIndex\(jobByItemId, dependenciesByItemId\)/, 'server.js should build SCC metadata for the submitted batch.');
  assert.match(serverJs, /publishScc,/, 'server.js should persist per-job SCC metadata.');
  assert.match(serverJs, /sccId:/, 'server.js should annotate circular publish dependencies with an SCC id.');
  assert.match(serverJs, /Uploaded w\/Circle Attach/, 'server.js should persist the renamed circle attach status label.');
  assert.match(serverJs, /Uploaded w\/Circle Overlay/, 'server.js should persist the renamed circle overlay status label.');
  assert.match(serverJs, /function buildPublishSccReleaseState\(job, batchJobsByItemId\)/, 'server.js should compute which SCC member may publish next.');
  assert.match(serverJs, /waiting-scc-order/, 'server.js should expose SCC ordering waits in publish dependency status.');
  assert.doesNotMatch(serverJs, /function canBypassCircularDependencyWait\(/, 'server.js should remove the old pair-only circular wait bypass helper.');
  assert.doesNotMatch(serverJs, /function chooseCircularDependencyLeader\(/, 'server.js should remove the old reciprocal-pair leader helper.');
});

test('server stores jobs in SQLite and exports JSON on demand for the jobs viewer', () => {
  assert.match(serverJs, /const JOBS_DB_FILE = path.join\(STORAGE_DIR, 'jobs\.db'\)/, 'server.js should define a SQLite jobs database path.');
  assert.match(serverJs, /function createSqliteSessionJobStore\(filePath, \{ legacyJsonPath = null \} = \{\}\)/, 'server.js should define a SQLite-backed job store.');
  assert.match(serverJs, /const jobsStore = createSessionJobStore\(JOBS_DB_FILE, \{ legacyJsonPath: LEGACY_JOBS_FILE \}\)/, 'server.js should initialize the job store with the SQLite database.');
  assert.match(serverJs, /async function exportJobsSnapshotToJsonFile\(sessionId\)/, 'server.js should export session jobs to JSON for the jobs viewer button.');
});

test('client surfaces circle upload labels and preserves refreshed hub project folder selections', () => {
  assert.match(appJs, /function getCircularUploadStatusLabel\(job\)/, 'app.js should derive circular upload labels from job metadata.');
  assert.match(appJs, /Uploaded w\/Circle Overlay/, 'app.js should include the renamed circle overlay upload label.');
  assert.match(appJs, /Uploaded w\/Circle Attach/, 'app.js should include the renamed circle attach upload label.');
  assert.match(appJs, /Queued for upload/, 'app.js should expose the renamed queued-for-upload status badge.');
  assert.match(appJs, /Publishing new version/, 'app.js should expose the renamed publishing status badge.');
  assert.match(appJs, /cache: options\.cache \|\| 'no-store'/, 'app.js should bypass browser cache for dynamic API calls.');
  assert.match(appJs, /async function restoreFolderPathFromIds\(folderPathIds\)/, 'app.js should restore the current project folder path after a hub refresh.');
  assert.match(appJs, /await loadHubs\(\{ preserveSelection: true \}\)/, 'the Refresh Hubs UI action should preserve the active selection while refreshing data.');
});
