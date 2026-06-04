const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const serverJs = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
const appJs = fs.readFileSync(path.join(rootDir, 'public', 'app.js'), 'utf8');

test('artifact stage cache uses SQLite with legacy JSON migration and emits staging diagnostics', () => {
  assert.match(serverJs, /const ARTIFACT_STAGE_CACHE_DB_FILE = path.join\(STORAGE_DIR, 'artifact-stage-cache\.db'\)/, 'server.js should define a SQLite artifact stage cache database path.');
  assert.match(serverJs, /function createSqlitePersistentArtifactStore\(filePath, \{ legacyJsonPath = null \} = \{\}\)/, 'server.js should define a SQLite-backed artifact stage cache store.');
  assert.match(serverJs, /const artifactStageStore = createPersistentArtifactStore\(ARTIFACT_STAGE_CACHE_DB_FILE, \{ legacyJsonPath: LEGACY_ARTIFACT_STAGE_CACHE_FILE \}\)/, 'server.js should initialize the artifact stage cache store with SQLite and legacy JSON migration.');
  assert.match(serverJs, /artifact-stage\.store\.selected/, 'server.js should log the selected artifact stage cache backend.');
  assert.match(serverJs, /job\.failed-staging/, 'server.js should emit a dedicated failed-staging event with structured context.');
});

test('publish queue selection and SCC leader release are logged for performance diagnostics', () => {
  assert.match(serverJs, /publish\.queue\.selection/, 'server.js should log which ready publish candidates were selected.');
  assert.match(serverJs, /publish\.scc\.release-selected/, 'server.js should log which SCC member was chosen to publish next.');
  assert.match(serverJs, /sccCandidateScores:/, 'publish-plan logs should include SCC candidate release scores.');
});

test('automation jobs UI renders exactly two badges and renames blocked states to waiting', () => {
  assert.match(appJs, /function getAutomationJobDaBadgeInfo\(job\)/, 'app.js should derive a dedicated Design Automation badge for the jobs cards.');
  assert.match(appJs, /function getAutomationJobAccBadgeInfo\(job\)/, 'app.js should derive a dedicated ACC badge for the jobs cards.');
  assert.match(appJs, /data-tooltip-title="ACC state"/, 'the jobs card ACC badge should render from the dedicated ACC badge helper.');
  assert.doesNotMatch(appJs, /label: 'Blocked'/, 'app.js should not expose a visible Blocked badge label anymore.');
  assert.doesNotMatch(appJs, /\$\{queueTag\}/, 'the jobs cards should not render a third queue badge.');
});
