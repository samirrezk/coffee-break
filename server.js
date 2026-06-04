require('dotenv').config();

const express = require('express');
const session = require('express-session');
const multer = require('multer');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { pathToFileURL } = require('node:url');
const AdmZip = require('adm-zip');

function tryLoadNodeSqlite() {
  const originalEmitWarning = process.emitWarning;
  try {
    process.emitWarning = function patchedEmitWarning(warning, ...args) {
      const name = typeof warning === 'string'
        ? String(args[0] || '')
        : String(warning?.name || '');
      const message = typeof warning === 'string' ? warning : String(warning?.message || '');
      if (name === 'ExperimentalWarning' && /SQLite is an experimental feature/i.test(message)) {
        return;
      }
      return originalEmitWarning.call(this, warning, ...args);
    };
    return require('node:sqlite');
  } catch (_error) {
    return null;
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

const nodeSqlite = tryLoadNodeSqlite();
const DatabaseSync = nodeSqlite?.DatabaseSync || null;

function readPositiveIntEnv(name, fallback) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readBooleanEnv(name, fallback = false) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) {
    return Boolean(fallback);
  }
  if (['1', 'true', 'yes', 'on'].includes(raw)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(raw)) {
    return false;
  }
  return Boolean(fallback);
}

const APS_HOST = 'https://developer.api.autodesk.com';
const OAUTH_HOST = `${APS_HOST}/authentication/v2`;
const ACC_SCOPES = ['data:read', 'data:write', 'data:create', 'offline_access'];
const AUTOMATION_SCOPES = 'code:all bucket:create bucket:read bucket:update data:create data:read data:write';
const AUTOMATION_SETUP_REVISION = 4;
const AUTOMATION_SUBMISSION_CONCURRENCY = readPositiveIntEnv('AUTOMATION_SUBMISSION_CONCURRENCY', 2);
const AUTOMATION_BATCH_STAGE_CONCURRENCY = readPositiveIntEnv('AUTOMATION_BATCH_STAGE_CONCURRENCY', 2);
const AUTOMATION_BATCH_STAGE_MAX_INFLIGHT_BYTES = readPositiveIntEnv('AUTOMATION_BATCH_STAGE_MAX_INFLIGHT_BYTES', 512 * 1024 * 1024);
const AUTOMATION_REFERENCE_STAGE_CONCURRENCY = readPositiveIntEnv('AUTOMATION_REFERENCE_STAGE_CONCURRENCY', 2);
const AUTOMATION_WORKITEM_POLL_CONCURRENCY = readPositiveIntEnv('AUTOMATION_WORKITEM_POLL_CONCURRENCY', 4);
const AUTOMATION_BATCH_MONITOR_INTERVAL_MS = readPositiveIntEnv('AUTOMATION_BATCH_MONITOR_INTERVAL_MS', 4000);
const AUTOMATION_PUBLISH_MAX_CONCURRENCY = readPositiveIntEnv('AUTOMATION_PUBLISH_MAX_CONCURRENCY', 2);
const AUTOMATION_PUBLISH_MAX_INFLIGHT_BYTES = readPositiveIntEnv('AUTOMATION_PUBLISH_MAX_INFLIGHT_BYTES', 96 * 1024 * 1024);
const AUTOMATION_PUBLISH_TRIGGER_DEBOUNCE_MS = readPositiveIntEnv('AUTOMATION_PUBLISH_TRIGGER_DEBOUNCE_MS', 300);
const AUTOMATION_FAST_OVERLAY_PUBLISH = readBooleanEnv('AUTOMATION_FAST_OVERLAY_PUBLISH', false);
const DIRECT_STREAM_SINGLE_PART_LIMIT_BYTES = 1 * 1024 * 1024;
const DIRECT_STREAM_PART_SIZE_BYTES = 5 * 1024 * 1024;
const DIRECT_STREAM_UPLOAD_CONCURRENCY = 4;
const DIRECT_STREAM_UPLOAD_SMALL_FILE_LIMIT_BYTES = 8 * 1024 * 1024;
const DIRECT_STREAM_MIN_MULTIPART_PART_SIZE_BYTES = 5 * 1024 * 1024;
const DIRECT_STREAM_UPLOAD_SMALL_PART_SIZE_BYTES = DIRECT_STREAM_MIN_MULTIPART_PART_SIZE_BYTES;
const DIRECT_STREAM_UPLOAD_MEDIUM_FILE_LIMIT_BYTES = 32 * 1024 * 1024;
const DIRECT_STREAM_UPLOAD_LARGE_FILE_LIMIT_BYTES = 96 * 1024 * 1024;
const DIRECT_STREAM_UPLOAD_LARGE_PART_SIZE_BYTES = 8 * 1024 * 1024;
const DIRECT_STREAM_UPLOAD_RETRY_LIMIT = 4;
const PERSISTENT_ARTIFACT_CACHE_TTL_MS = 18 * 60 * 60 * 1000;
const PERSISTENT_ARTIFACT_VERIFY_TTL_MS = 10 * 60 * 1000;
const ITEM_TIP_CACHE_TTL_MS = 5 * 60 * 1000;
const ITEM_ENTITY_CACHE_TTL_MS = 5 * 60 * 1000;
const ITEM_REFS_CACHE_TTL_MS = 2 * 60 * 1000;
const HEALTH_AUTOMATION_SETUP_REVISION = 4;
const REF_CANVAS_HEALTH_SESSION_KEY = 'refCanvasHealth';
const REF_CANVAS_HEALTH_POLL_INTERVAL_MS = 2500;
const REF_CANVAS_HEALTH_POLL_TIMEOUT_MS = 10 * 60 * 1000;
const APS_FETCH_TIMEOUT_MS = 60 * 1000;
const REMOTE_FETCH_TIMEOUT_MS = 2 * 60 * 1000;
const SSE_HEARTBEAT_MS = 20 * 1000;
const SLOW_INSTRUCTIONS_THRESHOLD_MS = readPositiveIntEnv('SLOW_INSTRUCTIONS_THRESHOLD_MS', 30 * 1000);
const SLOW_PUBLISH_QUEUE_THRESHOLD_MS = readPositiveIntEnv('SLOW_PUBLISH_QUEUE_THRESHOLD_MS', 30 * 1000);
const LOW_UPLOAD_THROUGHPUT_MBPS_THRESHOLD = readPositiveIntEnv('LOW_UPLOAD_THROUGHPUT_MBPS_THRESHOLD', 12);

const APP_ROOT = __dirname;
const PUBLIC_DIR = path.join(APP_ROOT, 'public');
const BUNDLES_DIR = path.join(APP_ROOT, 'bundles');
const STORAGE_DIR = path.join(APP_ROOT, 'storage');
const TMP_DIR = path.join(STORAGE_DIR, 'tmp');
const SCRIPT_OVERRIDE_DIR = path.join(STORAGE_DIR, 'script-override');
const SCRIPT_OVERRIDE_FILE = path.join(SCRIPT_OVERRIDE_DIR, 'RunMe.scr');
const SCRIPT_META_FILE = path.join(SCRIPT_OVERRIDE_DIR, 'metadata.json');
const LEGACY_JOBS_FILE = path.join(STORAGE_DIR, 'jobs.json');
const JOBS_DB_FILE = path.join(STORAGE_DIR, 'jobs.db');
const JOBS_EXPORT_DIR = path.join(STORAGE_DIR, 'exports');
const LEGACY_ARTIFACT_STAGE_CACHE_FILE = path.join(STORAGE_DIR, 'artifact-stage-cache.json');
const ARTIFACT_STAGE_CACHE_DB_FILE = path.join(STORAGE_DIR, 'artifact-stage-cache.db');
const SETUP_STATES_FILE = path.join(STORAGE_DIR, 'automation-setups.json');
const SESSION_STORE_FILE = path.join(STORAGE_DIR, 'sessions.json');
const CSRF_HEADER_NAME = 'x-csrf-token';
const CSRF_SESSION_KEY = 'csrfToken';

const LOG_LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};
const ACTIVE_LOG_LEVEL = (() => {
  const requested = cleanEnv(process.env.LOG_LEVEL).toLowerCase();
  return LOG_LEVELS[requested] || LOG_LEVELS.info;
})();

function getLogLevelName(level) {
  const normalized = cleanEnv(level).toLowerCase();
  return Object.prototype.hasOwnProperty.call(LOG_LEVELS, normalized) ? normalized : 'info';
}

function sanitizeLogValue(value, depth = 0) {
  if (value instanceof Error) {
    return serializeError(value);
  }
  if (value === null || value === undefined) {
    return value ?? null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    if (depth >= 3) {
      return `[Array(${value.length})]`;
    }
    return value.slice(0, 25).map((entry) => sanitizeLogValue(entry, depth + 1));
  }
  if (typeof value === 'object') {
    if (depth >= 3) {
      return '[Object]';
    }
    const sanitized = {};
    for (const [key, entry] of Object.entries(value)) {
      const lowered = key.toLowerCase();
      if (lowered.includes('authorization')
        || lowered.includes('cookie')
        || lowered.includes('secret')
        || lowered.includes('token')
        || lowered.includes('password')) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitizeLogValue(entry, depth + 1);
      }
    }
    return sanitized;
  }
  return String(value);
}

function serializeError(error) {
  if (!error) {
    return null;
  }
  return {
    name: error.name || 'Error',
    message: error.message || String(error),
    ...(error.code ? { code: error.code } : {}),
    ...(Number.isFinite(Number(error.status)) ? { status: Number(error.status) } : {}),
    ...(error.stack ? { stack: String(error.stack).split('\n').slice(0, 12).join('\n') } : {}),
    ...(error.payload ? { payload: sanitizeLogValue(error.payload, 1) } : {}),
  };
}

function emitStructuredLog(level, event, context = {}) {
  const normalizedLevel = getLogLevelName(level);
  if ((LOG_LEVELS[normalizedLevel] || LOG_LEVELS.info) < ACTIVE_LOG_LEVEL) {
    return;
  }
  const payload = {
    ts: new Date().toISOString(),
    level: normalizedLevel,
    event,
    service: 'coffee-break',
    ...sanitizeLogValue(context),
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

const logger = {
  debug(event, context) {
    emitStructuredLog('debug', event, context);
  },
  info(event, context) {
    emitStructuredLog('info', event, context);
  },
  warn(event, context) {
    emitStructuredLog('warn', event, context);
  },
  error(event, context) {
    emitStructuredLog('error', event, context);
  },
  child(defaultContext = {}) {
    return {
      debug(event, context) {
        emitStructuredLog('debug', event, { ...defaultContext, ...(context || {}) });
      },
      info(event, context) {
        emitStructuredLog('info', event, { ...defaultContext, ...(context || {}) });
      },
      warn(event, context) {
        emitStructuredLog('warn', event, { ...defaultContext, ...(context || {}) });
      },
      error(event, context) {
        emitStructuredLog('error', event, { ...defaultContext, ...(context || {}) });
      },
    };
  },
};

function initializeRequestContext(req, res, next) {
  req.requestId = cleanEnv(req.get('x-request-id')) || crypto.randomUUID();
  res.set('x-request-id', req.requestId);
  req.log = logger.child({
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    sessionId: req.sessionID || null,
    ip: req.ip || null,
  });
  next();
}

function requestLoggingMiddleware(req, res, next) {
  const startedAt = process.hrtime.bigint();
  req.log?.info('request.start', {
    queryKeys: Object.keys(req.query || {}),
    contentLength: Number(req.get('content-length') || 0) || 0,
  });

  let finished = false;
  res.once('finish', () => {
    finished = true;
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    req.log?.info('request.finish', {
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      responseLength: Number(res.getHeader('content-length') || 0) || 0,
    });
  });

  res.once('close', () => {
    if (finished) {
      return;
    }
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    req.log?.warn('request.aborted', {
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
    });
  });

  next();
}

for (const dir of [STORAGE_DIR, TMP_DIR, SCRIPT_OVERRIDE_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

class SharedJsonSessionStore extends session.Store {
  constructor(options = {}) {
    super();
    this.filePath = options.filePath;
    this.defaultTtlMs = Number(options.defaultTtlMs) > 0 ? Number(options.defaultTtlMs) : 1000 * 60 * 60 * 24 * 7;
    this.queue = Promise.resolve();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, '{}\n', 'utf8');
    }
  }

  async init() {
    await this._ensureFile();
    await this._pruneExpired();
  }

  _runExclusive(work) {
    const op = this.queue.then(work, work);
    this.queue = op.catch(() => {});
    return op;
  }

  async _ensureFile() {
    try {
      await fsp.access(this.filePath);
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        throw error;
      }
      await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
      await fsp.writeFile(this.filePath, '{}\n', 'utf8');
    }
  }

  async _readRecord() {
    await this._ensureFile();
    const parsed = await readJsonFile(this.filePath, {}, { context: 'session store' });
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  }

  async _writeRecord(record) {
    await writeJsonFile(this.filePath, record && typeof record === 'object' && !Array.isArray(record) ? record : {});
  }

  _getExpiresAt(sessionData) {
    const cookieExpires = sessionData?.cookie?.expires ? Date.parse(sessionData.cookie.expires) : NaN;
    if (Number.isFinite(cookieExpires)) {
      return cookieExpires;
    }
    const maxAge = Number(sessionData?.cookie?.maxAge);
    if (Number.isFinite(maxAge) && maxAge > 0) {
      return Date.now() + maxAge;
    }
    return Date.now() + this.defaultTtlMs;
  }

  _isExpired(entry, now = Date.now()) {
    return Number(entry?.expiresAt || 0) > 0 && Number(entry.expiresAt) <= now;
  }

  async _pruneExpired() {
    return this._runExclusive(async () => {
      const record = await this._readRecord();
      const now = Date.now();
      let dirty = false;
      for (const [sid, entry] of Object.entries(record)) {
        if (!entry || this._isExpired(entry, now)) {
          delete record[sid];
          dirty = true;
        }
      }
      if (dirty) {
        await this._writeRecord(record);
      }
    });
  }

  get(sid, callback) {
    this._runExclusive(async () => {
      const record = await this._readRecord();
      const entry = record[String(sid || '').trim()] || null;
      if (!entry) {
        return null;
      }
      if (this._isExpired(entry)) {
        delete record[String(sid || '').trim()];
        await this._writeRecord(record);
        return null;
      }
      return clonePlain(entry.session || null);
    }).then((sessionData) => callback?.(null, sessionData)).catch((error) => callback?.(error));
  }

  set(sid, sessionData, callback) {
    this._runExclusive(async () => {
      const record = await this._readRecord();
      record[String(sid || '').trim()] = {
        expiresAt: this._getExpiresAt(sessionData),
        session: clonePlain(sessionData),
      };
      await this._writeRecord(record);
    }).then(() => callback?.(null)).catch((error) => callback?.(error));
  }

  destroy(sid, callback) {
    this._runExclusive(async () => {
      const record = await this._readRecord();
      delete record[String(sid || '').trim()];
      await this._writeRecord(record);
    }).then(() => callback?.(null)).catch((error) => callback?.(error));
  }

  touch(sid, sessionData, callback) {
    this._runExclusive(async () => {
      const record = await this._readRecord();
      const key = String(sid || '').trim();
      const existing = record[key] || {};
      record[key] = {
        expiresAt: this._getExpiresAt(sessionData),
        session: clonePlain({
          ...(existing.session || {}),
          ...(sessionData || {}),
          cookie: sessionData?.cookie || existing.session?.cookie || undefined,
        }),
      };
      await this._writeRecord(record);
    }).then(() => callback?.(null)).catch((error) => callback?.(error));
  }
}

function createSharedJsonSessionStore(filePath) {
  return new SharedJsonSessionStore({ filePath });
}

const sessionStore = createSharedJsonSessionStore(SESSION_STORE_FILE);

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: sessionStore,
  secret: cleanEnv(process.env.SERVER_SESSION_SECRET) || 'replace-with-a-random-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto',
    maxAge: 1000 * 60 * 60 * 24 * 7,
  },
}));
app.use(initializeRequestContext);
app.use(requestLoggingMiddleware);

function isSafeCsrfMethod(method) {
  const normalized = String(method || '').toUpperCase();
  return normalized === 'GET' || normalized === 'HEAD' || normalized === 'OPTIONS';
}

function getOrCreateCsrfToken(req) {
  if (!req?.session) {
    return '';
  }
  const existing = cleanEnv(req.session[CSRF_SESSION_KEY]);
  if (existing) {
    return existing;
  }
  const token = crypto.randomBytes(32).toString('base64url');
  req.session[CSRF_SESSION_KEY] = token;
  return token;
}

function matchesCsrfToken(expected, provided) {
  const left = Buffer.from(String(expected || ''), 'utf8');
  const right = Buffer.from(String(provided || ''), 'utf8');
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function csrfProtection(req, res, next) {
  getOrCreateCsrfToken(req);
  if (isSafeCsrfMethod(req.method)) {
    next();
    return;
  }

  const providedToken = cleanEnv(req.get(CSRF_HEADER_NAME)) || cleanEnv(req.body?._csrf);
  const expectedToken = cleanEnv(req.session?.[CSRF_SESSION_KEY]);
  if (!matchesCsrfToken(expectedToken, providedToken)) {
    next(httpError(403, 'Invalid CSRF token. Refresh the page and try again.'));
    return;
  }

  next();
}

app.use('/api', csrfProtection);
app.use('/public', express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

const upload = multer({
  dest: TMP_DIR,
  limits: {
    files: 1,
    fileSize: 16 * 1024 * 1024,
  },
});

const syncLocks = new Set();
const jobsStore = createSessionJobStore(JOBS_DB_FILE, { legacyJsonPath: LEGACY_JOBS_FILE });
const artifactStageStore = createPersistentArtifactStore(ARTIFACT_STAGE_CACHE_DB_FILE, { legacyJsonPath: LEGACY_ARTIFACT_STAGE_CACHE_FILE });
const sharedArtifactStageInflight = new Map();
const itemTipCache = createExpiringPromiseCache(ITEM_TIP_CACHE_TTL_MS);
const itemEntityCache = createExpiringPromiseCache(ITEM_ENTITY_CACHE_TTL_MS);
const resolvedItemRefsCache = createExpiringPromiseCache(ITEM_REFS_CACHE_TTL_MS);
const resolvedAutomationItemCache = createExpiringPromiseCache(ITEM_ENTITY_CACHE_TTL_MS);
const preparedAutomationRefGraphCache = createExpiringPromiseCache(ITEM_REFS_CACHE_TTL_MS);
const refCanvasHealthInflight = new Map();
const healthBundleDllCache = new Map();
const cancelledJobSessions = new Set();
const batchPublishQueueInflight = new Map();
const batchWorkMonitorInflight = new Map();
const batchPublishQueueScheduled = new Map();
const sessionEventClients = new Map();

function markSessionJobsCancelled(sessionId) {
  const normalized = String(sessionId || '').trim();
  if (normalized) {
    cancelledJobSessions.add(normalized);
  }
}

function clearSessionJobsCancelled(sessionId) {
  const normalized = String(sessionId || '').trim();
  if (normalized) {
    cancelledJobSessions.delete(normalized);
  }
}

function isSessionJobsCancelled(sessionId) {
  return cancelledJobSessions.has(String(sessionId || '').trim());
}

function assertSessionJobsActive(sessionId) {
  if (isSessionJobsCancelled(sessionId)) {
    throw new Error('The active session queue was cleared before staging completed.');
  }
}

function createLocalAutomationJobId() {
  return `job-${compactTimestamp()}-${crypto.randomBytes(4).toString('hex')}`;
}

function buildQueuedAutomationJobRecord(execution, sessionId, projectId, item, { batchId, batchIndex = 0, batchSize = 1 } = {}) {
  const createdAt = new Date().toISOString();
  return {
    id: createLocalAutomationJobId(),
    workItemId: null,
    sessionId,
    batchId,
    batchIndex,
    batchSize,
    batchSubmissionState: 'submitting',
    status: 'queued',
    createdAt,
    updatedAt: createdAt,
    sourceProjectId: projectId,
    sourceFolderId: item.parentFolderId,
    sourceItemId: item.itemId,
    sourcePath: sanitizeDisplayPath(item.relativePath || item.displayName, item.displayName),
    inputFileName: item.displayName,
    automationFileName: item.displayName,
    automationLocalPath: path.posix.basename(item.displayName || 'input.dwg'),
    reportUrl: null,
    stats: null,
    bucketKey: execution?.config?.bucketKey || null,
    inputObjectKey: null,
    outputObjectKey: null,
    referenceDownload: null,
    accVersionRefs: [],
    accPublishRefs: [],
    accUpload: {
      status: 'pending',
      message: 'Queued for staging.',
      updatedAt: createdAt,
    },
  };
}

function getBatchSubmissionStateRank(state) {
  const normalized = String(state || '').trim().toLowerCase();
  if (normalized === 'ready') {
    return 2;
  }
  if (normalized === 'submitting') {
    return 1;
  }
  return 0;
}

function normalizeBatchSubmissionStateValue(incomingState, existingState, context = {}) {
  const normalizedIncoming = String(incomingState || '').trim().toLowerCase();
  const normalizedExisting = String(existingState || '').trim().toLowerCase();

  if (!normalizedIncoming) {
    return normalizedExisting || null;
  }
  if (!normalizedExisting) {
    return normalizedIncoming;
  }

  if (getBatchSubmissionStateRank(normalizedExisting) > getBatchSubmissionStateRank(normalizedIncoming)) {
    if (normalizedExisting === 'ready' && normalizedIncoming === 'submitting') {
      logger.warn('jobs.batch-submission-state.downgrade-ignored', {
        sessionId: context.sessionId || null,
        jobId: context.jobId || null,
        batchId: context.batchId || null,
        sourceItemId: context.sourceItemId || null,
        sourceName: context.sourceName || null,
        existingState: normalizedExisting,
        incomingState: normalizedIncoming,
      });
    }
    return normalizedExisting;
  }

  return normalizedIncoming;
}

function mergeStoredJobRecord(job, existingJob = null) {
  const sessionId = String(job?.sessionId || existingJob?.sessionId || '').trim();
  const jobId = String(job?.id || existingJob?.id || '').trim();
  if (!sessionId || !jobId) {
    throw new Error('Cannot store a job without both sessionId and id.');
  }

  const now = new Date().toISOString();
  const createdAt = String(job?.createdAt || existingJob?.createdAt || job?.updatedAt || existingJob?.updatedAt || now).trim() || now;
  const updatedAt = String(job?.updatedAt || now).trim() || now;
  const previousBatchSubmissionState = String(existingJob?.batchSubmissionState || '').trim().toLowerCase();
  const nextBatchSubmissionState = normalizeBatchSubmissionStateValue(job?.batchSubmissionState, existingJob?.batchSubmissionState, {
    sessionId,
    jobId,
    batchId: job?.batchId || existingJob?.batchId || null,
    sourceItemId: job?.sourceItemId || existingJob?.sourceItemId || null,
    sourceName: job?.inputFileName || existingJob?.inputFileName || null,
  });

  const nextJob = {
    ...clonePlain(existingJob || {}),
    ...clonePlain(job || {}),
    sessionId,
    id: jobId,
    createdAt,
    updatedAt,
  };

  if (nextBatchSubmissionState) {
    nextJob.batchSubmissionState = nextBatchSubmissionState;
  }

  if (existingJob && nextBatchSubmissionState && nextBatchSubmissionState !== previousBatchSubmissionState) {
    logger.info('jobs.batch-submission-state.changed', {
      sessionId,
      jobId,
      batchId: nextJob.batchId || null,
      sourceItemId: nextJob.sourceItemId || null,
      sourceName: nextJob.inputFileName || null,
      previousState: previousBatchSubmissionState || null,
      nextState: nextBatchSubmissionState,
      status: nextJob.status || null,
      workItemId: nextJob.workItemId || null,
    });
  }

  if (existingJob) {
    const previousStatus = String(existingJob.status || '').trim().toLowerCase() || null;
    const nextStatus = String(nextJob.status || '').trim().toLowerCase() || null;
    const previousUploadStatus = String(existingJob.accUpload?.status || '').trim().toLowerCase() || null;
    const nextUploadStatus = String(nextJob.accUpload?.status || '').trim().toLowerCase() || null;
    const previousQueueState = String(existingJob.publishQueue?.state || '').trim().toLowerCase() || null;
    const nextQueueState = String(nextJob.publishQueue?.state || '').trim().toLowerCase() || null;
    const blockedByJobIds = nextJob?.accUpload?.publishBlockedByJobIds
      || nextJob?.publishQueue?.blockedByJobIds
      || [];
    const blockedBySccId = nextJob?.accUpload?.publishBlockedBySccId
      || nextJob?.publishQueue?.blockedBySccId
      || null;

    if (previousStatus !== nextStatus || previousUploadStatus !== nextUploadStatus || previousQueueState !== nextQueueState) {
      logger.info('job.state.changed', {
        sessionId,
        jobId,
        batchId: nextJob.batchId || null,
        sourceItemId: nextJob.sourceItemId || null,
        sourceName: nextJob.inputFileName || null,
        previousStatus,
        nextStatus,
        previousUploadStatus,
        nextUploadStatus,
        previousQueueState,
        nextQueueState,
        blockerIds: blockedByJobIds,
        blockedBySccId,
        reason: nextJob?.publishQueue?.reason || nextJob?.accUpload?.message || null,
      });
    }
  }

  const terminalUploadStatus = String(nextJob?.accUpload?.status || '').trim().toLowerCase();
  const existingTerminalUploadStatus = String(existingJob?.accUpload?.status || '').trim().toLowerCase();
  if (terminalUploadStatus && isTerminalAccUploadStatus(terminalUploadStatus) && terminalUploadStatus !== existingTerminalUploadStatus) {
    emitJobSummaryLog(nextJob);
    maybeLogThresholdWarnings(nextJob);
  }

  return nextJob;
}

function summarizeBatchJobsForLogging(jobs, { limit = 12 } = {}) {
  return (Array.isArray(jobs) ? jobs : [])
    .filter(Boolean)
    .slice(0, limit)
    .map((job) => ({
      id: job?.id || null,
      batchIndex: Number.isFinite(Number(job?.batchIndex)) ? Number(job.batchIndex) : null,
      sourceItemId: job?.sourceItemId || null,
      sourceName: job?.inputFileName || null,
      status: job?.status || null,
      batchSubmissionState: job?.batchSubmissionState || null,
      workItemId: job?.workItemId || null,
      accUploadStatus: job?.accUpload?.status || null,
    }));
}

async function logBatchSubmissionSnapshot(sessionId, batchId, event, context = {}) {
  const normalizedSessionId = String(sessionId || '').trim();
  const normalizedBatchId = String(batchId || '').trim();
  if (!normalizedSessionId || !normalizedBatchId) {
    return;
  }

  const batchJobs = (await listJobsForSession(normalizedSessionId)).filter((job) => String(job?.batchId || '').trim() === normalizedBatchId);
  if (!batchJobs.length) {
    return;
  }

  const readyCount = batchJobs.filter((job) => String(job?.batchSubmissionState || '').trim().toLowerCase() === 'ready').length;
  const missingWorkItemCount = batchJobs.filter((job) => !String(job?.workItemId || '').trim()).length;
  logger.info(event, {
    sessionId: normalizedSessionId,
    batchId: normalizedBatchId,
    jobCount: batchJobs.length,
    readyCount,
    submittingCount: batchJobs.length - readyCount,
    missingWorkItemCount,
    jobs: summarizeBatchJobsForLogging(batchJobs),
    ...context,
  });
}

async function logBatchSummary(sessionId, batchId, event = 'batch.summary', context = {}) {
  const normalizedSessionId = String(sessionId || '').trim();
  const normalizedBatchId = String(batchId || '').trim();
  if (!normalizedSessionId || !normalizedBatchId) {
    return;
  }

  const batchJobs = (await listJobsForSession(normalizedSessionId))
    .filter((job) => String(job?.batchId || '').trim() === normalizedBatchId);
  if (!batchJobs.length) {
    return;
  }

  const uploadedJobs = batchJobs.filter((job) => String(job?.accUpload?.status || '').toLowerCase() === 'uploaded');
  const completedJobs = batchJobs.filter((job) => isTerminalAccUploadStatus(job?.accUpload?.status || ''));
  const totalInputBytes = batchJobs.reduce((sum, job) => sum + normalizeStorageSize(job?.stats?.bytesDownloaded), 0);
  const totalOutputBytes = batchJobs.reduce((sum, job) => sum + normalizeStorageSize(job?.stats?.bytesUploaded), 0);
  const totalRefBytes = batchJobs.reduce((sum, job) => sum + normalizeStorageSize(job?.referenceDownload?.fileBytesTotal), 0);
  const cacheHits = batchJobs.reduce((sum, job) => sum + Number(job?.referenceDownload?.cacheHits || 0), 0);
  const cacheMisses = batchJobs.reduce((sum, job) => sum + Number(job?.referenceDownload?.cacheMisses || 0), 0);
  const uploadWaits = batchJobs.map((job) => ({
    job,
    waitMs: normalizeTimingMs(job?.accUpload?.publishQueueWaitMs ?? job?.publishQueue?.queueWaitMs, 0),
  }));
  uploadWaits.sort((left, right) => right.waitMs - left.waitMs);
  const criticalWait = uploadWaits[0] || null;

  logger.info(event, {
    sessionId: normalizedSessionId,
    batchId: normalizedBatchId,
    jobCount: batchJobs.length,
    completedCount: completedJobs.length,
    uploadedCount: uploadedJobs.length,
    totalInputBytes,
    totalOutputBytes,
    totalRefBytes,
    cacheHitRatio: cacheHits + cacheMisses > 0 ? roundMetric((cacheHits / (cacheHits + cacheMisses)) * 100) : null,
    criticalPublishWaitJobId: criticalWait?.job?.id || null,
    criticalPublishWaitSourceName: criticalWait?.job?.inputFileName || null,
    criticalPublishWaitMs: criticalWait ? roundDurationMs(criticalWait.waitMs) : null,
    ...context,
  });
}

async function reconcileBatchSubmissionGate(sessionId, batchId, {
  triggerJobId = null,
  triggerSourceItemId = null,
  triggerSourceName = null,
  reason = 'unknown',
} = {}) {
  const normalizedSessionId = String(sessionId || '').trim();
  const normalizedBatchId = String(batchId || '').trim();
  if (!normalizedSessionId || !normalizedBatchId) {
    return { ready: false, jobCount: 0, updatedCount: 0, unresolvedCount: 0 };
  }

  const batchJobs = (await listJobsForSession(normalizedSessionId)).filter((job) => String(job?.batchId || '').trim() === normalizedBatchId);
  if (!batchJobs.length) {
    return { ready: false, jobCount: 0, updatedCount: 0, unresolvedCount: 0 };
  }

  const unresolvedJobs = batchJobs.filter((job) => {
    const status = String(job?.status || '').trim().toLowerCase();
    const workItemId = String(job?.workItemId || '').trim();
    return !workItemId && !isTerminalAutomationStatus(status);
  });

  if (unresolvedJobs.length) {
    logger.info('automation.batch.submission-state.blocked', {
      sessionId: normalizedSessionId,
      batchId: normalizedBatchId,
      reason,
      triggerJobId,
      triggerSourceItemId,
      triggerSourceName,
      jobCount: batchJobs.length,
      unresolvedCount: unresolvedJobs.length,
      unresolvedJobs: summarizeBatchJobsForLogging(unresolvedJobs),
    });
    return {
      ready: false,
      jobCount: batchJobs.length,
      updatedCount: 0,
      unresolvedCount: unresolvedJobs.length,
    };
  }

  const staleJobs = batchJobs.filter((job) => String(job?.batchSubmissionState || '').trim().toLowerCase() !== 'ready');
  if (!staleJobs.length) {
    return {
      ready: true,
      jobCount: batchJobs.length,
      updatedCount: 0,
      unresolvedCount: 0,
    };
  }

  const updatedAt = new Date().toISOString();
  for (const staleJob of staleJobs) {
    await upsertJob({
      ...staleJob,
      batchSubmissionState: 'ready',
      updatedAt,
    });
  }

  const latestBatchJobs = (await listJobsForSession(normalizedSessionId)).filter((job) => String(job?.batchId || '').trim() === normalizedBatchId);
  logger.warn('automation.batch.submission-state.reconciled', {
    sessionId: normalizedSessionId,
    batchId: normalizedBatchId,
    reason,
    triggerJobId,
    triggerSourceItemId,
    triggerSourceName,
    jobCount: latestBatchJobs.length,
    updatedCount: staleJobs.length,
    jobs: summarizeBatchJobsForLogging(latestBatchJobs),
  });

  return {
    ready: true,
    jobCount: latestBatchJobs.length,
    updatedCount: staleJobs.length,
    unresolvedCount: 0,
  };
}

async function updateQueuedJobState(sessionId, jobId, patch = {}) {
  assertSessionJobsActive(sessionId);
  const current = await getSessionJob(sessionId, jobId);
  if (!current) {
    return null;
  }
  const merged = {
    ...current,
    ...clonePlain(patch),
    updatedAt: patch.updatedAt || new Date().toISOString(),
    accUpload: patch.accUpload
      ? {
          ...(current.accUpload || {}),
          ...clonePlain(patch.accUpload),
        }
      : (current.accUpload || null),
  };
  return upsertJob(merged);
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTimingStart() {
  return process.hrtime.bigint();
}

function getDurationMs(start) {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function roundDurationMs(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function normalizeTimingMs(value, fallback = 0) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createTimingWindow() {
  return {
    startedAtMs: Date.now(),
    startedHr: getTimingStart(),
  };
}

function buildTimingFields(window, {
  endedAtMs = null,
  queueWaitMs = 0,
  activeTransferMs = 0,
  activeWorkMs = null,
  criticalPathMs = null,
  timingKind = null,
} = {}) {
  const measuredCriticalPathMs = roundDurationMs(
    criticalPathMs == null ? getDurationMs(window.startedHr) : criticalPathMs,
  );
  const resolvedEndedAtMs = endedAtMs === null || endedAtMs === undefined
    ? Date.now()
    : normalizeTimingMs(endedAtMs, Date.now());
  const normalizedQueueWaitMs = roundDurationMs(Math.max(0, normalizeTimingMs(queueWaitMs, 0)));
  const normalizedActiveTransferMs = roundDurationMs(Math.max(0, normalizeTimingMs(activeTransferMs, 0)));
  const inferredActiveWorkMs = activeWorkMs === null || activeWorkMs === undefined
    ? Math.max(0, measuredCriticalPathMs - normalizedQueueWaitMs - normalizedActiveTransferMs)
    : Math.max(0, normalizeTimingMs(activeWorkMs, 0));
  const normalizedActiveWorkMs = roundDurationMs(inferredActiveWorkMs);
  const resolvedTimingKind = timingKind
    || (normalizedActiveTransferMs > 0
      ? (normalizedActiveWorkMs > 0 ? 'mixed' : 'transfer')
      : (normalizedActiveWorkMs > 0 ? 'work' : 'instant'));

  return {
    startedAt: new Date(window.startedAtMs).toISOString(),
    endedAt: new Date(resolvedEndedAtMs).toISOString(),
    queueWaitMs: normalizedQueueWaitMs,
    activeWorkMs: normalizedActiveWorkMs,
    activeTransferMs: normalizedActiveTransferMs,
    criticalPathMs: measuredCriticalPathMs,
    durationMs: measuredCriticalPathMs,
    timingKind: resolvedTimingKind,
  };
}

function createImmediateTimingFields() {
  const now = new Date().toISOString();
  return {
    startedAt: now,
    endedAt: now,
    queueWaitMs: 0,
    activeWorkMs: 0,
    activeTransferMs: 0,
    criticalPathMs: 0,
    durationMs: 0,
    timingKind: 'instant',
  };
}

function parseTimestampMs(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
}

function buildTimingFieldsFromMs(startedAtMs, endedAtMs = Date.now(), options = {}) {
  const normalizedStartedAtMs = normalizeTimingMs(startedAtMs, Date.now());
  const normalizedEndedAtMs = normalizeTimingMs(endedAtMs, Date.now());
  return buildTimingFields(
    { startedAtMs: normalizedStartedAtMs, startedHr: getTimingStart() },
    {
      endedAtMs: normalizedEndedAtMs,
      criticalPathMs: Math.max(0, normalizedEndedAtMs - normalizedStartedAtMs),
      ...options,
    },
  );
}

function shareInFlightPromise(inFlightMap, key, factory) {
  if (inFlightMap.has(key)) {
    return inFlightMap.get(key);
  }
  const promise = Promise.resolve().then(factory).finally(() => {
    if (inFlightMap.get(key) === promise) {
      inFlightMap.delete(key);
    }
  });
  inFlightMap.set(key, promise);
  return promise;
}

function createExpiringPromiseCache(ttlMs, { maxEntries = 512 } = {}) {
  const entries = new Map();

  function normalizeKey(key) {
    return String(key || '').trim();
  }

  function prune(now = Date.now()) {
    for (const [key, entry] of entries) {
      if ((entry?.expiresAt || 0) <= now) {
        entries.delete(key);
      }
    }
    while (entries.size > maxEntries) {
      const oldestKey = entries.keys().next().value;
      if (!oldestKey) {
        break;
      }
      entries.delete(oldestKey);
    }
  }

  function getValidEntry(key, now = Date.now()) {
    const normalizedKey = normalizeKey(key);
    const existing = entries.get(normalizedKey);
    if (existing && existing.expiresAt > now) {
      return { normalizedKey, existing };
    }
    if (existing) {
      entries.delete(normalizedKey);
    }
    return { normalizedKey, existing: null };
  }

  function setPromise(key, promise, now = Date.now()) {
    const normalizedKey = normalizeKey(key);
    entries.set(normalizedKey, { promise, expiresAt: now + ttlMs });
    promise.catch(() => {
      const current = entries.get(normalizedKey);
      if (current?.promise === promise) {
        entries.delete(normalizedKey);
      }
    });
    prune(now);
    return promise;
  }

  return {
    get(key) {
      return getValidEntry(key).existing?.promise || null;
    },
    getOrCreate(key, factory) {
      const now = Date.now();
      const { normalizedKey, existing } = getValidEntry(key, now);
      if (existing) {
        return existing.promise;
      }
      const promise = Promise.resolve().then(factory);
      entries.set(normalizedKey, { promise, expiresAt: now + ttlMs });
      promise.catch(() => {
        const current = entries.get(normalizedKey);
        if (current?.promise === promise) {
          entries.delete(normalizedKey);
        }
      });
      prune(now);
      return promise;
    },
    set(key, value) {
      return setPromise(key, Promise.resolve(value));
    },
    has(key) {
      return Boolean(getValidEntry(key).existing);
    },
    delete(key) {
      entries.delete(normalizeKey(key));
    },
    clear() {
      entries.clear();
    },
    prune,
  };
}


function createTimedPromiseCache({ ttlMs, maxEntries = 512 } = {}) {
  const normalizedTtlMs = Number(ttlMs);
  if (!Number.isFinite(normalizedTtlMs) || normalizedTtlMs <= 0) {
    throw new Error('createTimedPromiseCache requires a positive ttlMs.');
  }
  return createExpiringPromiseCache(normalizedTtlMs, { maxEntries });
}

function logAutomationTiming(step, details = {}) {
  logger.info('automation.timing', {
    step,
    ...details,
  });
}

function buildBatchRuntimeKey(sessionId, batchId) {
  return `${String(sessionId || '').trim()}|${String(batchId || '').trim()}`;
}

function getJobSizeHintBytes(job) {
  const candidates = [
    job?.accUpload?.fileSizeBytes,
    job?.stats?.bytesUploaded,
    job?.stats?.bytesDownloaded,
  ];
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 8 * 1024 * 1024;
}

function summarizeRelationCounts(dependencies) {
  const summary = { attachment: 0, overlay: 0 };
  for (const dependency of Array.isArray(dependencies) ? dependencies : []) {
    const relationType = normalizeCircularDependencyRelationType(dependency?.relationType);
    if (relationType === 'attachment') {
      summary.attachment += 1;
    } else {
      summary.overlay += 1;
    }
  }
  return summary;
}

function buildCountSummary(values) {
  const counts = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const key = String(value || '').trim() || 'unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, count]) => `${key}:${count}`)
    .join(', ');
}

function dedupeStrings(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)));
}

function buildJobLifecycleSummary(job) {
  const createdAtMs = parseTimestampMs(job?.createdAt);
  const finishedAtMs = parseTimestampMs(job?.stats?.timeFinished || job?.updatedAt);
  const publishStartedAtMs = parseTimestampMs(job?.accUpload?.publishStartedAt || job?.publishQueue?.startedAt);
  const publishCompletedAtMs = parseTimestampMs(job?.accUpload?.publishCompletedAt || job?.accUpload?.uploadedAt || job?.publishQueue?.completedAt);
  const totalMs = createdAtMs !== null && finishedAtMs !== null ? Math.max(0, finishedAtMs - createdAtMs) : null;
  const publishPhaseMs = publishStartedAtMs !== null && publishCompletedAtMs !== null
    ? Math.max(0, publishCompletedAtMs - publishStartedAtMs)
    : null;
  return {
    workItemStatus: String(job?.status || '').toLowerCase() || null,
    accUploadStatus: String(job?.accUpload?.status || '').toLowerCase() || null,
    totalMs: totalMs == null ? null : roundDurationMs(totalMs),
    instructionMs: roundDurationMs(normalizeTimingMs(
      parseTimestampMs(job?.stats?.timeInstructionsEnded) !== null && parseTimestampMs(job?.stats?.timeInstructionsStarted) !== null
        ? parseTimestampMs(job.stats.timeInstructionsEnded) - parseTimestampMs(job.stats.timeInstructionsStarted)
        : 0,
      0,
    )),
    publishQueueWaitMs: roundDurationMs(normalizeTimingMs(job?.accUpload?.publishQueueWaitMs ?? job?.publishQueue?.queueWaitMs, 0)),
    publishPhaseMs: publishPhaseMs == null ? null : roundDurationMs(publishPhaseMs),
    bytesDownloaded: normalizeStorageSize(job?.stats?.bytesDownloaded),
    bytesUploaded: normalizeStorageSize(job?.stats?.bytesUploaded),
    uploadMbps: roundMetric(job?.accUpload?.uploadThroughputMbps),
    cacheHitRate: (() => {
      const hits = Number(job?.referenceDownload?.cacheHits || 0);
      const misses = Number(job?.referenceDownload?.cacheMisses || 0);
      const total = hits + misses;
      return total > 0 ? roundMetric((hits / total) * 100) : null;
    })(),
  };
}

function maybeLogThresholdWarnings(job) {
  const instructionMs = normalizeTimingMs(
    parseTimestampMs(job?.stats?.timeInstructionsEnded) !== null && parseTimestampMs(job?.stats?.timeInstructionsStarted) !== null
      ? parseTimestampMs(job.stats.timeInstructionsEnded) - parseTimestampMs(job.stats.timeInstructionsStarted)
      : 0,
    0,
  );
  const publishQueueWaitMs = normalizeTimingMs(job?.accUpload?.publishQueueWaitMs ?? job?.publishQueue?.queueWaitMs, 0);
  const uploadThroughputMbps = normalizeTimingMs(job?.accUpload?.uploadThroughputMbps, 0);

  if (instructionMs >= SLOW_INSTRUCTIONS_THRESHOLD_MS) {
    logger.warn('threshold.warn', {
      metric: 'slow-instructions',
      thresholdMs: SLOW_INSTRUCTIONS_THRESHOLD_MS,
      measuredMs: roundDurationMs(instructionMs),
      jobId: job?.id || null,
      batchId: job?.batchId || null,
      sourceItemId: job?.sourceItemId || null,
      sourceName: job?.inputFileName || null,
    });
  }

  if (publishQueueWaitMs >= SLOW_PUBLISH_QUEUE_THRESHOLD_MS) {
    logger.warn('threshold.warn', {
      metric: 'slow-publish-queue-wait',
      thresholdMs: SLOW_PUBLISH_QUEUE_THRESHOLD_MS,
      measuredMs: roundDurationMs(publishQueueWaitMs),
      blockerIds: job?.accUpload?.publishBlockedByJobIds || job?.publishQueue?.blockedByJobIds || [],
      blockedBySccId: job?.accUpload?.publishBlockedBySccId || job?.publishQueue?.blockedBySccId || null,
      jobId: job?.id || null,
      batchId: job?.batchId || null,
      sourceItemId: job?.sourceItemId || null,
      sourceName: job?.inputFileName || null,
    });
  }

  if (uploadThroughputMbps > 0 && uploadThroughputMbps <= LOW_UPLOAD_THROUGHPUT_MBPS_THRESHOLD) {
    logger.warn('threshold.warn', {
      metric: 'low-acc-upload-throughput',
      thresholdMbps: LOW_UPLOAD_THROUGHPUT_MBPS_THRESHOLD,
      measuredMbps: roundMetric(uploadThroughputMbps),
      jobId: job?.id || null,
      batchId: job?.batchId || null,
      sourceItemId: job?.sourceItemId || null,
      sourceName: job?.inputFileName || null,
    });
  }
}

function emitJobSummaryLog(job) {
  logger.info('job.summary', {
    jobId: job?.id || null,
    batchId: job?.batchId || null,
    sourceItemId: job?.sourceItemId || null,
    sourceName: job?.inputFileName || null,
    ...buildJobLifecycleSummary(job),
  });
}

function getSessionEventClients(sessionId, { create = false } = {}) {
  const key = String(sessionId || '').trim();
  if (!key) {
    return null;
  }
  if (!sessionEventClients.has(key) && create) {
    sessionEventClients.set(key, new Set());
  }
  return sessionEventClients.get(key) || null;
}

function broadcastSessionEvent(sessionId, payload) {
  const clients = getSessionEventClients(sessionId, { create: false });
  if (!clients?.size) {
    return;
  }
  const message = `data: ${JSON.stringify(sanitizeLogValue(payload))}\n\n`;
  for (const client of Array.from(clients)) {
    try {
      client.write(message);
    } catch {
      clients.delete(client);
    }
  }
  if (!clients.size) {
    sessionEventClients.delete(String(sessionId || '').trim());
  }
}

async function timeAutomationStep(step, details, work) {
  const timingWindow = createTimingWindow();
  try {
    const result = await work();
    logAutomationTiming(step, {
      ...details,
      ...buildTimingFields(timingWindow),
      outcome: 'ok',
    });
    return result;
  } catch (error) {
    logAutomationTiming(step, {
      ...details,
      ...buildTimingFields(timingWindow),
      outcome: 'error',
      error: error?.message || 'Unknown error',
    });
    throw error;
  }
}

function httpError(status, message, payload) {
  const err = new Error(message);
  err.status = status;
  err.payload = payload;
  return err;
}

function cleanEnv(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getOrigin(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function normalizeAutomationRegion(value) {
  const cleaned = cleanEnv(value).toLowerCase();
  if (!cleaned || cleaned === 'us') {
    return 'us-east';
  }
  return cleaned;
}

function inferOssRegionFromAutomationRegion(value) {
  const cleaned = normalizeAutomationRegion(value);
  if (cleaned.startsWith('emea') || cleaned.startsWith('eu')) {
    return 'EMEA';
  }
  if (cleaned.startsWith('aus') || cleaned.startsWith('apac') || cleaned.startsWith('au')) {
    return 'AUS';
  }
  return 'US';
}

function normalizeOssRegion(value) {
  const cleaned = cleanEnv(value).toUpperCase();
  if (!cleaned) {
    return 'US';
  }
  if (['US', 'USA', 'AMER', 'US-EAST', 'US-WEST'].includes(cleaned)) {
    return 'US';
  }
  if (['EU', 'EMEA', 'EUROPE'].includes(cleaned)) {
    return 'EMEA';
  }
  if (['AUS', 'APAC', 'AU', 'AUSTRALIA'].includes(cleaned)) {
    return 'AUS';
  }
  return cleaned;
}

function normalizeBucketKey(value) {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
  return (normalized || 'coffee-break-bucket').slice(0, 128);
}

function sanitizeFileName(value) {
  const base = path.basename(String(value || '').replace(/\\/g, '/'));
  return base.replace(/[^A-Za-z0-9._-]/g, '_') || 'file.dwg';
}

function sanitizeDisplayPath(value, fallback = 'file.dwg') {
  const normalized = String(value || fallback)
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .map((segment) => segment.replace(/[\u0000-\u001F\u007F]/g, '').trim())
    .filter(Boolean)
    .join('/');
  return normalized || fallback;
}

function sanitizeSegment(segment) {
  const cleaned = String(segment || '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .trim();
  return cleaned || 'untitled';
}

function buildTempFilePath(prefix, fileName) {
  const safePrefix = sanitizeSegment(prefix || 'file').replace(/[^A-Za-z0-9._-]/g, '_');
  const safeName = sanitizeFileName(fileName || 'file.dwg');
  return path.join(TMP_DIR, `${Date.now()}-${crypto.randomUUID()}-${safePrefix}-${safeName}`);
}

const ACC_FOLDER_URN_RE = /^urn:adsk\.[^:\s"'<>]+:fs\.folder:co\.[A-Za-z0-9._-]+$/i;
const ACC_ITEM_URN_RE = /^urn:adsk\.[^:\s"'<>]+:dm\.lineage:[A-Za-z0-9._-]+$/i;
const ACC_VERSION_URN_RE = /^urn:adsk\.[^:\s"'<>]+:fs\.file:vf\.[^/?#]+(?:\?version=\d+)?$/i;

function decodeAccIdentifier(value) {
  let text = String(value || '').trim();
  if (!text) {
    return '';
  }

  for (let i = 0; i < 3; i += 1) {
    try {
      const decoded = decodeURIComponent(text);
      if (decoded === text) {
        break;
      }
      text = decoded;
    } catch {
      break;
    }
  }

  return text;
}

function isAccFolderUrn(value) {
  return ACC_FOLDER_URN_RE.test(decodeAccIdentifier(value));
}

function isAccItemUrn(value) {
  return ACC_ITEM_URN_RE.test(decodeAccIdentifier(value));
}

function isAccVersionUrn(value) {
  return ACC_VERSION_URN_RE.test(decodeAccIdentifier(value));
}

const ACC_FOLDER_URN_PATTERN = /urn:adsk\.([^:\s"'<>]+):fs\.folder:(co\.[A-Za-z0-9._-]+)/i;
const ACC_FOLDER_BARE_ID_PATTERN = /^co\.[A-Za-z0-9._-]+$/i;
const ACC_FOLDER_BARE_ID_SEARCH_PATTERN = /(co\.[A-Za-z0-9._-]+)/i;
const KNOWN_ACC_FOLDER_NAMESPACES = ['wipprod', 'wips5jku'];

function extractAccFolderBareId(value) {
  const decoded = decodeAccIdentifier(value);
  if (!decoded) {
    return '';
  }

  const urnMatch = decoded.match(ACC_FOLDER_URN_PATTERN);
  if (urnMatch?.[2] && ACC_FOLDER_BARE_ID_PATTERN.test(urnMatch[2])) {
    return urnMatch[2];
  }

  if (ACC_FOLDER_BARE_ID_PATTERN.test(decoded)) {
    return decoded;
  }

  const fallbackMatch = decoded.match(ACC_FOLDER_BARE_ID_SEARCH_PATTERN);
  return fallbackMatch?.[1] && ACC_FOLDER_BARE_ID_PATTERN.test(fallbackMatch[1])
    ? fallbackMatch[1]
    : '';
}

function extractAccFolderNamespace(value) {
  const match = decodeAccIdentifier(value).match(ACC_FOLDER_URN_PATTERN);
  return match?.[1] ? String(match[1]).trim().toLowerCase() : '';
}

function buildAccFolderUrn(folderId, namespace = 'wipprod') {
  const normalized = extractAccFolderBareId(folderId);
  const normalizedNamespace = String(namespace || '').trim().toLowerCase();
  if (!normalized || !ACC_FOLDER_BARE_ID_PATTERN.test(normalized) || !normalizedNamespace) {
    return '';
  }
  return `urn:adsk.${normalizedNamespace}:fs.folder:${normalized}`;
}

function buildCandidateAccFolderUrns(folderId, namespaces = KNOWN_ACC_FOLDER_NAMESPACES) {
  const bareFolderId = extractAccFolderBareId(folderId);
  if (!bareFolderId) {
    return [];
  }

  const preferredNamespace = extractAccFolderNamespace(folderId);
  const orderedNamespaces = Array.from(new Set([
    preferredNamespace,
    ...(Array.isArray(namespaces) ? namespaces : [namespaces]),
    ...KNOWN_ACC_FOLDER_NAMESPACES,
  ].map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)));

  return orderedNamespaces
    .map((namespace) => buildAccFolderUrn(bareFolderId, namespace))
    .filter(Boolean);
}

function extractAccFolderId(value) {
  const candidates = [];
  const push = (entry) => {
    if (entry === null || entry === undefined) {
      return;
    }
    if (typeof entry === 'string') {
      candidates.push(entry);
      return;
    }
    if (typeof entry === 'object') {
      candidates.push(entry.id, entry.href, entry.url, entry.folderId, entry?.data?.id);
    }
  };

  push(value);

  for (const candidate of candidates) {
    let text = String(candidate || '').trim();
    if (!text) {
      continue;
    }

    for (let i = 0; i < 3; i += 1) {
      try {
        const decoded = decodeURIComponent(text);
        if (decoded === text) {
          break;
        }
        text = decoded;
      } catch {
        break;
      }
    }

    if (text.startsWith('{')) {
      try {
        const parsed = JSON.parse(text);
        const parsedId = extractAccFolderId(parsed);
        if (parsedId) {
          return parsedId;
        }
      } catch {
        // Ignore non-JSON strings.
      }
    }

    const urnMatch = text.match(ACC_FOLDER_URN_PATTERN);
    if (urnMatch?.[0]) {
      return `urn:adsk.${urnMatch[1]}:fs.folder:${urnMatch[2]}`;
    }

    if (ACC_FOLDER_BARE_ID_PATTERN.test(text)) {
      return text;
    }

    const urlMatch = text.match(/\/folders\/([^/?#]+)/i);
    if (urlMatch?.[1]) {
      const nestedId = extractAccFolderId(urlMatch[1]);
      if (nestedId) {
        return nestedId;
      }
      const fallbackFolderId = extractAccFolderBareId(urlMatch[1]);
      if (fallbackFolderId) {
        return fallbackFolderId;
      }
    }

    const fallbackMatch = text.match(ACC_FOLDER_BARE_ID_SEARCH_PATTERN);
    if (fallbackMatch?.[1] && ACC_FOLDER_BARE_ID_PATTERN.test(fallbackMatch[1])) {
      return fallbackMatch[1];
    }
  }

  return '';
}



function extractAccItemId(value) {
  const candidates = [];
  const push = (entry) => {
    if (entry === null || entry === undefined) {
      return;
    }
    if (typeof entry === 'string') {
      candidates.push(entry);
      return;
    }
    if (typeof entry === 'object') {
      candidates.push(entry.id, entry.href, entry.url, entry.itemId, entry?.data?.id, entry?.relationships?.item?.data?.id);
    }
  };

  push(value);

  for (const candidate of candidates) {
    let text = String(candidate || '').trim();
    if (!text) {
      continue;
    }

    for (let i = 0; i < 3; i += 1) {
      try {
        const decoded = decodeURIComponent(text);
        if (decoded === text) {
          break;
        }
        text = decoded;
      } catch {
        break;
      }
    }

    if (text.startsWith('{')) {
      try {
        const parsed = JSON.parse(text);
        const parsedId = extractAccItemId(parsed);
        if (parsedId) {
          return parsedId;
        }
      } catch {
        // Ignore non-JSON strings.
      }
    }

    const urnMatch = text.match(/urn:adsk\.[^\s"'<>]+:dm\.lineage:[^\s"'<>]+/i);
    if (urnMatch?.[0]) {
      return urnMatch[0];
    }

    const urlMatch = text.match(/\/items\/([^/?#]+)/i);
    if (urlMatch?.[1]) {
      const nestedId = extractAccItemId(urlMatch[1]);
      if (nestedId) {
        return nestedId;
      }
      return urlMatch[1];
    }
  }

  return '';
}

function extractAccVersionId(value) {
  const candidates = [];
  const push = (entry) => {
    if (entry === null || entry === undefined) {
      return;
    }
    if (typeof entry === 'string') {
      candidates.push(entry);
      return;
    }
    if (typeof entry === 'object') {
      candidates.push(entry.id, entry.href, entry.url, entry.versionId, entry?.data?.id);
    }
  };

  push(value);

  for (const candidate of candidates) {
    let text = String(candidate || '').trim();
    if (!text) {
      continue;
    }

    for (let i = 0; i < 3; i += 1) {
      try {
        const decoded = decodeURIComponent(text);
        if (decoded === text) {
          break;
        }
        text = decoded;
      } catch {
        break;
      }
    }

    if (text.startsWith('{')) {
      try {
        const parsed = JSON.parse(text);
        const parsedId = extractAccVersionId(parsed);
        if (parsedId) {
          return parsedId;
        }
      } catch {
        // Ignore non-JSON strings.
      }
    }

    const urnMatch = text.match(/urn:adsk\.[^\s"'<>]+:fs\.file:vf\.[^\s"'<>]+(?:\?version=\d+)?/i);
    if (urnMatch?.[0]) {
      return urnMatch[0];
    }

    const urlMatch = text.match(/\/versions\/([^/?#]+)/i);
    if (urlMatch?.[1]) {
      const nestedId = extractAccVersionId(urlMatch[1]);
      if (nestedId) {
        return nestedId;
      }
      return urlMatch[1];
    }
  }

  return '';
}

const DOCS_VISIBLE_TOP_FOLDER_NAMES = new Set(['project files', 'plans']);

function isVisibleDocsTopFolderName(segment) {
  const cleaned = String(segment || '').trim().toLowerCase();
  return DOCS_VISIBLE_TOP_FOLDER_NAMES.has(cleaned);
}

function isLikelyHiddenAccPathSegment(segment) {
  const cleaned = String(segment || '').trim();
  if (!cleaned) {
    return true;
  }
  return cleaned.startsWith('.')
    || /^__.+__$/.test(cleaned)
    || /(?:^|[-_])root[- ]folder$/i.test(cleaned)
    || /^root[- ]folder$/i.test(cleaned);
}

function stripLeadingSegmentsBeforeDocsTopFolder(segments) {
  const list = Array.isArray(segments) ? segments.slice() : [];
  const docsTopIndex = list.findIndex((segment) => isVisibleDocsTopFolderName(segment));
  return docsTopIndex > 0 ? list.slice(docsTopIndex) : list;
}

function normalizeAutomationLocalPath(value, fallback = 'file.dwg') {
  const rawPath = String(value || fallback || 'file.dwg').replace(/\\/g, '/');
  const segments = rawPath
    .split('/')
    .map((segment) => String(segment || '').trim())
    .filter((segment) => segment && segment !== '.' && segment !== '..');

  const normalizedSegments = stripLeadingSegmentsBeforeDocsTopFolder(segments);
  const visibleSegments = [];
  let hiddenSegmentsRemoved = Math.max(0, segments.length - normalizedSegments.length);

  for (const segment of normalizedSegments) {
    if (isLikelyHiddenAccPathSegment(segment)) {
      hiddenSegmentsRemoved += 1;
      continue;
    }
    visibleSegments.push(sanitizeSegment(segment));
  }

  if (!visibleSegments.length) {
    visibleSegments.push(sanitizeSegment(fallback));
  }

  const lastIndex = visibleSegments.length - 1;
  visibleSegments[lastIndex] = sanitizeFileName(visibleSegments[lastIndex] || fallback);

  return {
    localPath: visibleSegments.join('/'),
    hiddenSegmentsRemoved,
  };
}

function insertSuffixIntoLocalPath(localPath, suffix) {
  const normalizedPath = String(localPath || '').trim();
  const normalizedSuffix = String(suffix || '').trim();
  if (!normalizedPath || !normalizedSuffix) {
    return normalizedPath || normalizedSuffix;
  }

  const directory = path.posix.dirname(normalizedPath);
  const extension = path.posix.extname(normalizedPath);
  const stem = path.posix.basename(normalizedPath, extension);
  const nextBaseName = sanitizeFileName(`${stem}-${normalizedSuffix}${extension}`);
  return directory && directory !== '.'
    ? path.posix.join(directory, nextBaseName)
    : nextBaseName;
}

function ensureUniqueAutomationLocalPath(localPath, usedLocalPaths, uniqueSeed = '') {
  const normalized = String(localPath || '').trim() || 'file.dwg';
  const used = usedLocalPaths instanceof Set ? usedLocalPaths : new Set();
  if (!used.has(normalized)) {
    used.add(normalized);
    return {
      localPath: normalized,
      collisionResolved: false,
    };
  }

  const seed = String(uniqueSeed || normalized);
  const hash = crypto.createHash('sha1').update(seed).digest('hex').slice(0, 8);
  let nextValue = insertSuffixIntoLocalPath(normalized, hash);
  let attempt = 1;
  while (used.has(nextValue)) {
    nextValue = insertSuffixIntoLocalPath(normalized, `${hash}-${attempt}`);
    attempt += 1;
  }
  used.add(nextValue);
  return {
    localPath: nextValue,
    collisionResolved: true,
  };
}


function contentDispositionFilename(filename) {
  return String(filename || 'download.dwg').replace(/[\\"]/g, '_');
}

function getRuntimeConfig(req) {
  const sessionConfig = req.session.appConfig || {};
  const daRegion = normalizeAutomationRegion(cleanEnv(sessionConfig.daRegion) || cleanEnv(process.env.APS_DA_REGION) || 'us-east');
  const clientId = cleanEnv(sessionConfig.clientId) || cleanEnv(process.env.APS_CLIENT_ID);
  const clientSecret = cleanEnv(sessionConfig.clientSecret) || cleanEnv(process.env.APS_CLIENT_SECRET);
  const callbackUrl = cleanEnv(sessionConfig.callbackUrl) || cleanEnv(process.env.APS_CALLBACK_URL) || `${getOrigin(req)}/api/auth/callback`;
  const bundleZipName = cleanEnv(process.env.APS_BUNDLE_ZIP) || 'RunScript.bundle.zip';

  return {
    port: Number.parseInt(process.env.PORT || '8080', 10) || 8080,
    clientId,
    clientSecret,
    nickname: cleanEnv(sessionConfig.nickname) || cleanEnv(process.env.APS_NICKNAME),
    callbackUrl,
    daRegion,
    ossRegion: normalizeOssRegion(cleanEnv(sessionConfig.ossRegion) || cleanEnv(process.env.APS_OSS_REGION) || inferOssRegionFromAutomationRegion(daRegion)),
    appBundleId: cleanEnv(process.env.APS_APPBUNDLE_ID) || 'RunScriptAppBundle',
    activityId: cleanEnv(process.env.APS_ACTIVITY_ID) || 'RunScriptActivity',
    alias: cleanEnv(process.env.APS_AUTOMATION_ALIAS) || 'prod',
    autocadCommand: cleanEnv(process.env.APS_AUTOCAD_COMMAND) || 'RunScript',
    defaultEngine: cleanEnv(process.env.APS_AUTOCAD_ENGINE) || 'Autodesk.AutoCAD+25_1',
    bundleZipName,
    bundleZipPath: path.join(BUNDLES_DIR, bundleZipName),
    bundleScriptArchivePath: 'RunScript.bundle/Contents/Scripts/RunMe.scr',
    baseUrl: APS_HOST,
    automationBase: `${APS_HOST}/da/${daRegion}/v3`,
    bucketKey: normalizeBucketKey(cleanEnv(process.env.APS_BUCKET_KEY) || `${(clientId || 'apsapp').toLowerCase()}-coffee-break-bucket`),
  };
}

function normalizeHealthAutomationEngine(engine, fallback = 'Autodesk.AutoCAD+26_0') {
  const value = cleanEnv(engine);
  if (!value) {
    return fallback;
  }
  const civil3dMatch = /^Autodesk\.Civil3D\+(\d+_\d+)$/i.exec(value);
  if (civil3dMatch) {
    return `Autodesk.AutoCAD+${civil3dMatch[1]}`;
  }
  return value;
}

function getHealthAutomationConfig(config) {
  const bundleZipName = cleanEnv(process.env.APS_HEALTH_BUNDLE_ZIP) || 'isHealthy.bundle.zip';
  return {
    appBundleId: cleanEnv(process.env.APS_HEALTH_APPBUNDLE_ID) || 'isHealthyAppBundle',
    activityId: cleanEnv(process.env.APS_HEALTH_ACTIVITY_ID) || 'isHealthyActivity',
    alias: cleanEnv(process.env.APS_HEALTH_ALIAS) || config.alias,
    command: cleanEnv(process.env.APS_HEALTH_COMMAND) || 'ISHEALTHY',
    defaultEngine: normalizeHealthAutomationEngine(cleanEnv(process.env.APS_HEALTH_ENGINE) || 'Autodesk.AutoCAD+26_0'),
    bundleZipName,
    bundleZipPath: path.join(BUNDLES_DIR, bundleZipName),
    bundleDllName: cleanEnv(process.env.APS_HEALTH_BUNDLE_DLL_NAME) || 'isHealthy.dll',
  };
}

function resetSessionAuth(req) {
  delete req.session.apsUser;
  delete req.session.automationToken;
  delete req.session.oauthState;
}

function assertCredentialsConfigured(config) {
  if (!config.clientId || !config.clientSecret) {
    throw httpError(400, 'Enter APS client ID and secret in the UI or provide them in .env first.');
  }
}

function getBasicAuthHeader(config) {
  return `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`;
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function getErrorSummary(payload) {
  if (!payload) {
    return '';
  }
  if (typeof payload === 'string') {
    return payload;
  }
  if (Array.isArray(payload.errors) && payload.errors.length) {
    return payload.errors.map((err) => err.detail || err.title || err.code).filter(Boolean).join('; ');
  }
  return payload.developerMessage || payload.message || payload.detail || payload.error_description || payload.error || payload.errorCode || '';
}

async function assertOk(response, context) {
  if (response.ok) {
    return response;
  }
  const payload = await parseResponseBody(response);
  throw httpError(
    response.status,
    `${context}: ${response.status} ${response.statusText}${getErrorSummary(payload) ? ` - ${getErrorSummary(payload)}` : ''}`,
    payload,
  );
}

async function requestToken(config, params) {
  assertCredentialsConfigured(config);

  const attempt = async (useBasicAuth) => {
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    const bodyParams = new URLSearchParams(params);
    if (useBasicAuth) {
      headers.Authorization = getBasicAuthHeader(config);
    } else {
      bodyParams.set('client_id', config.clientId);
      bodyParams.set('client_secret', config.clientSecret);
    }
    return fetch(`${OAUTH_HOST}/token`, {
      method: 'POST',
      headers,
      body: bodyParams,
    });
  };

  let response = await attempt(true);
  if (!response.ok) {
    response = await attempt(false);
  }
  await assertOk(response, 'APS authentication failed');
  return response.json();
}

function buildAuthorizeUrl(req, state) {
  const config = getRuntimeConfig(req);
  assertCredentialsConfigured(config);

  const url = new URL(`${OAUTH_HOST}/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.callbackUrl);
  url.searchParams.set('scope', ACC_SCOPES.join(' '));
  if (state) {
    url.searchParams.set('state', state);
  }
  return url.toString();
}

async function ensureUserAccessToken(req, allowMissing = false) {
  const config = getRuntimeConfig(req);
  const auth = req.session.apsUser;
  if (!auth) {
    if (allowMissing) {
      return null;
    }
    throw httpError(401, 'Sign in to Autodesk Construction Cloud first.');
  }

  if (Date.now() >= ((auth.expiresAt || 0) - 120000) && auth.refreshToken) {
    const refreshed = await requestToken(config, {
      grant_type: 'refresh_token',
      refresh_token: auth.refreshToken,
      scope: ACC_SCOPES.join(' '),
    });

    req.session.apsUser = {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token || auth.refreshToken,
      expiresAt: Date.now() + ((refreshed.expires_in || 3600) * 1000),
      scope: refreshed.scope || auth.scope,
    };
  }

  return req.session.apsUser.accessToken;
}

async function ensureAutomationToken(req) {
  const config = getRuntimeConfig(req);
  assertCredentialsConfigured(config);

  const auth = req.session.automationToken;
  if (auth && Date.now() < ((auth.expiresAt || 0) - 60000)) {
    return auth.accessToken;
  }

  const token = await requestToken(config, {
    grant_type: 'client_credentials',
    scope: AUTOMATION_SCOPES,
  });

  req.session.automationToken = {
    accessToken: token.access_token,
    expiresAt: Date.now() + ((token.expires_in || 3600) * 1000),
    scope: token.scope || AUTOMATION_SCOPES,
  };

  return req.session.automationToken.accessToken;
}

const requireAccAuth = asyncHandler(async (req, res, next) => {
  req.accessToken = await ensureUserAccessToken(req);
  next();
});

function mergeAbortSignals(parentSignal, timeoutMs) {
  const controller = new AbortController();
  let timeoutHandle = null;

  const abortWithReason = (reason) => {
    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      abortWithReason(parentSignal.reason || new Error('Request aborted.'));
    } else {
      parentSignal.addEventListener('abort', () => abortWithReason(parentSignal.reason || new Error('Request aborted.')), { once: true });
    }
  }

  if (Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0) {
    timeoutHandle = setTimeout(() => abortWithReason(new Error(`Request timed out after ${timeoutMs} ms.`)), Number(timeoutMs));
  }

  return {
    signal: controller.signal,
    clear() {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    },
  };
}

async function fetchWithTimeout(url, options = {}, { timeoutMs = APS_FETCH_TIMEOUT_MS, context = 'Remote request failed' } = {}) {
  const { signal, clear } = mergeAbortSignals(options.signal, timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal,
    });
  } catch (error) {
    const message = String(error?.message || '').trim();
    if (signal.aborted) {
      throw httpError(504, `${context}: ${message || `timed out after ${timeoutMs} ms`}`);
    }
    throw error;
  } finally {
    clear();
  }
}

async function apsJson(urlOrPath, { method = 'GET', token, body, headers = {}, expectedStatus = [200], context = 'APS request failed' } = {}) {
  const url = urlOrPath.startsWith('http') ? urlOrPath : `${APS_HOST}${urlOrPath}`;
  const timingWindow = createTimingWindow();
  const endpoint = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();
  const requestHeaders = {
    Accept: 'application/json',
    ...headers,
  };
  if (token) {
    requestHeaders.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined && !Object.keys(requestHeaders).some((key) => key.toLowerCase() === 'content-type')) {
    requestHeaders['Content-Type'] = 'application/json';
  }

  let response;
  try {
    response = await fetchWithTimeout(url, {
      method,
      headers: requestHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }, { timeoutMs: APS_FETCH_TIMEOUT_MS, context });
  } catch (error) {
    logger.warn('external.call', {
      service: 'aps',
      endpoint,
      method,
      status: Number.isFinite(Number(error?.status)) ? Number(error.status) : null,
      retryCount: 0,
      ...buildTimingFields(timingWindow),
      outcome: 'error',
      error: error?.message || 'Unknown error',
    });
    throw error;
  }

  const text = await response.text();
  logger.info('external.call', {
    service: 'aps',
    endpoint,
    method,
    status: response.status,
    retryCount: 0,
    ...buildTimingFields(timingWindow),
    outcome: expectedStatus.includes(response.status) ? 'ok' : 'error',
  });
  if (!expectedStatus.includes(response.status)) {
    let payload = text;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    throw httpError(
      response.status,
      `${context}: ${response.status} ${response.statusText}${getErrorSummary(payload) ? ` - ${getErrorSummary(payload)}` : ''}`,
      payload,
    );
  }

  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function apsAllPages(urlOrPath, token, context) {
  const items = [];
  let next = urlOrPath;
  do {
    const payload = await apsJson(next, { token, context });
    if (Array.isArray(payload.data)) {
      items.push(...payload.data);
    } else if (payload.data) {
      items.push(payload.data);
    }
    next = payload?.links?.next?.href || null;
  } while (next);
  return items;
}

function getDisplayName(entity) {
  const extensionData = entity?.attributes?.extension?.data;
  return entity?.attributes?.name
    || entity?.attributes?.displayName
    || extensionData?.name
    || extensionData?.displayName
    || extensionData?.folderName
    || extensionData?.title
    || entity?.name
    || entity?.displayName
    || entity?.id
    || 'Unnamed';
}

function getExtensionType(entity) {
  return entity?.attributes?.extension?.type || '';
}

function isAccHub(hub) {
  const extensionType = getExtensionType(hub);
  return extensionType.includes('bim360') || extensionType.includes('construction') || String(hub?.id || '').startsWith('b.');
}

function isFolderEntity(entity) {
  const entityType = String(entity?.type || '').trim().toLowerCase();
  const extensionType = String(getExtensionType(entity) || '').trim().toLowerCase();
  return entityType === 'folders'
    || extensionType.includes('folder')
    || Boolean(entity?.relationships?.contents);
}

function isItemEntity(entity) {
  return entity?.type === 'items';
}

function isDwgName(name) {
  return path.extname(name || '').toLowerCase() === '.dwg';
}

function normalizeHub(hub) {
  return {
    id: hub.id,
    name: getDisplayName(hub),
    extensionType: getExtensionType(hub),
    region: hub?.attributes?.region || null,
  };
}

function normalizeProject(project, hubId) {
  return {
    id: project.id,
    hubId,
    name: getDisplayName(project),
    extensionType: getExtensionType(project),
    lastModifiedTime: project?.attributes?.lastModifiedTime || null,
  };
}

function normalizeFolder(folder) {
  return {
    id: extractAccFolderId(folder?.id)
      || extractAccFolderId(folder?.relationships?.target)
      || extractAccFolderId(folder?.relationships?.contents)
      || extractAccFolderId(folder?.relationships?.contents?.links?.related)
      || extractAccFolderId(folder?.links?.self)
      || extractAccFolderId(folder?.links?.related)
      || '',
    kind: 'folder',
    name: getDisplayName(folder),
    extensionType: getExtensionType(folder),
    objectCount: folder?.attributes?.objectCount ?? null,
    lastModifiedTime: folder?.attributes?.lastModifiedTime || null,
  };
}

function normalizeItem(item) {
  const name = getDisplayName(item);
  return {
    id: item.id,
    kind: 'file',
    name,
    extension: path.extname(name).slice(1).toLowerCase(),
    extensionType: getExtensionType(item),
    lastModifiedTime: item?.attributes?.lastModifiedTime || null,
    size: normalizeStorageSize(item?.attributes?.storageSize ?? item?.attributes?.size),
    reserved: Boolean(item?.attributes?.reserved),
    reservedTime: item?.attributes?.reservedTime || null,
    reservedUserId: item?.attributes?.reservedUserId || null,
    reservedUserName: item?.attributes?.reservedUserName || null,
    webViewUrl: item?.links?.webView?.href || null,
    parentFolderId: item?.relationships?.parent?.data?.id || null,
  };
}

function resourceKey(type, id) {
  return `${type || ''}:${id || ''}`;
}

function buildResourceIndex(payload) {
  const index = new Map();
  const maybeAdd = (resource) => {
    if (resource?.type && resource?.id) {
      index.set(resourceKey(resource.type, resource.id), resource);
    }
  };

  if (Array.isArray(payload?.data)) {
    payload.data.forEach(maybeAdd);
  } else if (payload?.data) {
    maybeAdd(payload.data);
  }

  (Array.isArray(payload?.included) ? payload.included : []).forEach(maybeAdd);
  return index;
}

function normalizePathInProject(resource) {
  const pathInProject = resource?.attributes?.pathInProject
    || resource?.attributes?.extension?.data?.pathInProject
    || resource?.pathInProject
    || '';

  if (Array.isArray(pathInProject)) {
    return pathInProject
      .map((segment) => (typeof segment === 'string' ? segment : segment?.name || segment?.displayName || ''))
      .filter(Boolean)
      .join('/');
  }

  return typeof pathInProject === 'string' ? pathInProject : '';
}

const XREF_REF_EXTENSION_TYPE = 'xrefs:autodesk.core:Xref';

function getRefRelationshipEntries(payload) {
  if (Array.isArray(payload?.data)) {
    return {
      entries: payload.data,
      confidence: 'high',
    };
  }

  if (Array.isArray(payload?.data?.relationships?.refs?.data)) {
    return {
      entries: payload.data.relationships.refs.data,
      confidence: 'high',
    };
  }

  if (Array.isArray(payload?.meta?.refs)) {
    return {
      entries: payload.meta.refs,
      confidence: 'high',
    };
  }

  if (Array.isArray(payload?.meta?.data)) {
    return {
      entries: payload.meta.data,
      confidence: 'high',
    };
  }

  const included = Array.isArray(payload?.included) ? payload.included : [];
  if (included.length) {
    const sharedMeta = payload?.meta && typeof payload.meta === 'object' ? payload.meta : {};
    return {
      entries: included.map((resource) => ({
        type: resource.type,
        id: resource.id,
        meta: sharedMeta,
      })),
      confidence: 'low',
    };
  }

  return {
    entries: [],
    confidence: Array.isArray(payload?.data) ? 'high' : 'low',
  };
}

function buildRefRows({ projectId, itemId, tip, payload, retrievedVia }) {
  const sourceVersionId = tip?.data?.id || '';
  const sourceItemId = tip?.data?.relationships?.item?.data?.id || itemId || '';
  const sourceName = tip?.data?.attributes?.displayName || tip?.data?.attributes?.name || 'selected-file';
  const sourceVersionNumber = normalizeVersionNumber(tip?.data?.attributes?.versionNumber)
    ?? parseVersionNumberFromVersionId(sourceVersionId);
  const sourceVersionLabel = extractVersionLabel(tip?.data) || formatVersionLabel(sourceVersionNumber);
  const resourceIndex = buildResourceIndex(payload);
  const { entries, confidence } = getRefRelationshipEntries(payload);

  const rows = entries.map((entry, index) => {
    const targetIdentifier = entry?.relationships?.target?.data
      || entry?.relationships?.to?.data
      || (entry?.type && entry?.id ? { type: entry.type, id: entry.id } : null);
    const targetResource = targetIdentifier
      ? (resourceIndex.get(resourceKey(targetIdentifier.type, targetIdentifier.id)) || null)
      : null;
    const target = targetResource || (entry?.attributes || entry?.relationships ? entry : null);
    const targetAttributes = target?.attributes || {};
    const relationshipMeta = entry?.meta || {};

    return {
      retrievedVia,
      sourceProjectId: projectId,
      sourceItemId,
      sourceVersionId,
      sourceName,
      sourceVersionNumber,
      sourceVersionLabel,
      relationshipIndex: index + 1,
      refType: relationshipMeta?.refType || '',
      direction: relationshipMeta?.direction || '',
      fromType: relationshipMeta?.fromType || '',
      fromId: relationshipMeta?.fromId || '',
      toType: relationshipMeta?.toType || '',
      toId: relationshipMeta?.toId || '',
      refExtensionType: relationshipMeta?.extension?.type || '',
      refExtensionVersion: relationshipMeta?.extension?.version || '',
      nestedType: relationshipMeta?.extension?.data?.nestedType || relationshipMeta?.extension?.nestedType || '',
      targetResourceType: targetIdentifier?.type || target?.type || '',
      targetResourceId: targetIdentifier?.id || target?.id || '',
      targetItemId: target?.relationships?.item?.data?.id || '',
      targetName: targetAttributes?.displayName || targetAttributes?.name || getDisplayName(target) || '',
      targetVersionNumber: targetAttributes?.versionNumber ?? '',
      targetVersionLabel: extractVersionLabel(target),
      targetMimeType: targetAttributes?.mimeType || '',
      targetExtensionType: targetAttributes?.extension?.type || '',
      targetCreateTime: targetAttributes?.createTime || '',
      targetLastModifiedTime: targetAttributes?.lastModifiedTime || '',
      targetStorageSize: normalizeStorageSize(targetAttributes?.storageSize ?? targetAttributes?.size),
      targetPathInProject: normalizePathInProject(target),
      targetStorageUrn: target?.relationships?.storage?.data?.id || '',
      targetWebViewUrl: target?.links?.webView?.href || '',
    };
  });

  return { rows, confidence };
}

function isOutgoingRefRow(row) {
  const direction = String(row?.direction || '').trim().toLowerCase();
  if (direction === 'from') {
    return true;
  }
  if (direction === 'to') {
    return false;
  }

  const sourceIds = new Set([row?.sourceVersionId, row?.sourceItemId].filter(Boolean));
  if (row?.fromId && sourceIds.has(row.fromId)) {
    return true;
  }
  if (row?.toId && sourceIds.has(row.toId)) {
    return false;
  }

  return false;
}

function isAutodeskXrefRow(row) {
  return String(row?.refExtensionType || '').trim().toLowerCase() === XREF_REF_EXTENSION_TYPE.toLowerCase();
}

function getResolvableTargetItemId(row) {
  if (row?.targetItemId) {
    return row.targetItemId;
  }
  if (String(row?.targetResourceType || '').trim().toLowerCase() === 'items' && row?.targetResourceId) {
    return row.targetResourceId;
  }
  return '';
}

function getAutomationRefRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => isOutgoingRefRow(row) && isAutodeskXrefRow(row));
}

function getAutomationRefTargetKey(row) {
  return [
    getResolvableTargetItemId(row),
    row?.targetResourceType || '',
    row?.targetResourceId || '',
    row?.targetPathInProject || '',
    row?.targetName || '',
  ].join('|');
}

function buildAutomationVersionRef(row, targetVersionId) {
  const normalizedVersionId = String(targetVersionId || '').trim();
  if (!normalizedVersionId) {
    return null;
  }

  return {
    type: 'versions',
    id: normalizedVersionId,
    meta: {
      refType: row?.refType || 'xrefs',
      direction: 'from',
      extension: {
        type: XREF_REF_EXTENSION_TYPE,
        version: row?.refExtensionVersion || '1.1',
        data: {
          nestedType: row?.nestedType || 'overlay',
        },
      },
    },
  };
}

function dedupeAutomationVersionRefs(refs) {
  const unique = [];
  const seen = new Set();

  for (const ref of Array.isArray(refs) ? refs : []) {
    const key = `${ref?.type || ''}:${ref?.id || ''}`;
    if (!ref?.id || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(ref);
  }

  return unique;
}

function normalizePreparedAutomationRefRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  const targetItemId = getResolvableTargetItemId(row);
  const targetResourceType = String(row?.targetResourceType || (row?.targetVersionId ? 'versions' : (targetItemId ? 'items' : ''))).trim();
  const targetResourceId = String(row?.targetResourceId || row?.targetVersionId || targetItemId || '').trim();
  const targetName = String(row?.targetName || row?.displayName || row?.localName || targetResourceId || targetItemId || '').trim();
  if (!targetItemId && !targetResourceId && !targetName) {
    return null;
  }

  return {
    targetItemId: targetItemId || '',
    targetResourceType: targetResourceType || (targetResourceId ? 'versions' : ''),
    targetResourceId,
    targetVersionId: String(row?.targetVersionId || (targetResourceType.toLowerCase() == 'versions' ? targetResourceId : '') || '').trim(),
    targetName,
    targetPathInProject: String(row?.targetPathInProject || '').trim(),
    nestedType: String(row?.nestedType || 'overlay').trim() || 'overlay',
    direction: 'from',
    refExtensionType: String(row?.refExtensionType || XREF_REF_EXTENSION_TYPE).trim() || XREF_REF_EXTENSION_TYPE,
    refExtensionVersion: String(row?.refExtensionVersion || '1.1').trim() || '1.1',
    refType: String(row?.refType || 'xrefs').trim() || 'xrefs',
  };
}

function buildPreparedAutomationFilteredRefs(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => normalizePreparedAutomationRefRow(row))
    .filter(Boolean)
    .map((row) => ({
      targetItemId: row.targetItemId,
      targetResourceId: row.targetResourceId,
      targetVersionId: row.targetVersionId,
      targetName: row.targetName,
      targetPathInProject: row.targetPathInProject,
      nestedType: row.nestedType,
      direction: 'from',
      refExtensionType: row.refExtensionType,
    }));
}

function buildPreparedAutomationRefRowsFromPublishRefs(publishRefs, fallbackRefs) {
  const explicitRows = (Array.isArray(publishRefs) ? publishRefs : [])
    .map((ref) => normalizePreparedAutomationRefRow({
      targetItemId: ref?.itemId || '',
      targetResourceType: ref?.versionId ? 'versions' : 'items',
      targetResourceId: ref?.versionId || ref?.itemId || '',
      targetVersionId: ref?.versionId || '',
      targetName: ref?.targetName || ref?.displayName || ref?.localName || ref?.itemId || '',
      targetPathInProject: ref?.targetPathInProject || '',
      nestedType: ref?.nestedType || 'overlay',
      direction: ref?.direction || 'from',
      refExtensionType: ref?.refExtensionType || XREF_REF_EXTENSION_TYPE,
      refExtensionVersion: ref?.refExtensionVersion || '1.1',
      refType: ref?.refType || 'xrefs',
    }))
    .filter(Boolean);

  if (explicitRows.length) {
    return explicitRows;
  }

  return (Array.isArray(fallbackRefs) ? fallbackRefs : [])
    .map((row) => normalizePreparedAutomationRefRow(row))
    .filter(Boolean);
}

function dedupePreparedAutomationRefRows(rows) {
  const unique = [];
  const seenTargets = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const normalizedRow = normalizePreparedAutomationRefRow(row);
    if (!normalizedRow) {
      continue;
    }
    const key = getAutomationRefTargetKey(normalizedRow);
    if (!key || seenTargets.has(key)) {
      continue;
    }
    seenTargets.add(key);
    unique.push(normalizedRow);
  }
  return unique;
}

function normalizePreparedAutomationRefGraph(graph) {
  if (!graph || typeof graph !== 'object') {
    return null;
  }

  const sourceLocalName = String(graph.sourceLocalName || '').trim();
  if (!sourceLocalName) {
    return null;
  }

  const candidateRows = buildPreparedAutomationRefRowsFromPublishRefs(
    Array.isArray(graph.candidateRows) ? graph.candidateRows : [],
    Array.isArray(graph.filteredRefs) ? graph.filteredRefs : [],
  );
  const uniqueRows = dedupePreparedAutomationRefRows(
    Array.isArray(graph.uniqueRows) && graph.uniqueRows.length ? graph.uniqueRows : candidateRows,
  );
  const filteredRefs = buildPreparedAutomationFilteredRefs(
    Array.isArray(graph.filteredRefs) && graph.filteredRefs.length ? graph.filteredRefs : uniqueRows,
  );

  return {
    retrievedVia: String(graph.retrievedVia || 'cache').trim() || 'cache',
    resolveRefsMs: roundDurationMs(Number(graph.resolveRefsMs) || 0) || 0,
    candidateRows,
    uniqueRows,
    filteredRefs,
    sourceLocalName,
    sourceHiddenSegmentsRemoved: Math.max(0, Number(graph.sourceHiddenSegmentsRemoved) || 0),
  };
}

function buildPreparedAutomationRefGraphFromPreparedRefs(sourceItem, stagedRefs, { retrievedVia = 'artifact-stage-cache' } = {}) {
  const sourceLocalInfo = normalizeAutomationLocalPath(
    stagedRefs?.hostLocalName || sourceItem?.relativePath || sourceItem?.displayName,
    sourceItem?.displayName || 'input.dwg',
  );
  const candidateRows = buildPreparedAutomationRefRowsFromPublishRefs(
    Array.isArray(stagedRefs?.publishRefs) ? stagedRefs.publishRefs : [],
    Array.isArray(stagedRefs?.filteredRefs) ? stagedRefs.filteredRefs : [],
  );
  const uniqueRows = dedupePreparedAutomationRefRows(candidateRows);
  const filteredRefs = buildPreparedAutomationFilteredRefs(
    Array.isArray(stagedRefs?.filteredRefs) && stagedRefs.filteredRefs.length ? stagedRefs.filteredRefs : uniqueRows,
  );

  return normalizePreparedAutomationRefGraph({
    retrievedVia,
    resolveRefsMs: 0,
    candidateRows,
    uniqueRows,
    filteredRefs,
    sourceLocalName: stagedRefs?.hostLocalName || sourceLocalInfo.localPath,
    sourceHiddenSegmentsRemoved: Math.max(0, Number(stagedRefs?.meta?.hiddenSegmentsRemoved || 0)),
  });
}

function buildPreparedAutomationRefGraphFromJob(job, { resolvedDependencyVersionIds = null } = {}) {
  const sourceItem = {
    displayName: job?.inputFileName || 'input.dwg',
    relativePath: job?.automationLocalPath || job?.sourcePath || job?.inputFileName || 'input.dwg',
  };
  const stagedRefs = {
    hostLocalName: job?.automationLocalPath || job?.automationFileName || job?.inputFileName || 'input.dwg',
    publishRefs: Array.isArray(job?.accPublishRefs) ? job.accPublishRefs.map((ref) => ({
      ...ref,
      versionId: String(
        resolvedDependencyVersionIds?.[ref?.itemId]
        || job?.publishDependencyVersions?.[ref?.itemId]
        || job?.accUpload?.publishDependencyVersions?.[ref?.itemId]
        || ref?.versionId
        || ''
      ).trim(),
    })) : [],
    filteredRefs: job?.referenceDownload?.serverOnly?.filteredRefs || [],
    meta: {
      hiddenSegmentsRemoved: Number(job?.referenceDownload?.hiddenSegmentsRemoved || 0),
    },
  };
  return buildPreparedAutomationRefGraphFromPreparedRefs(sourceItem, stagedRefs, { retrievedVia: 'artifact-stage-cache' });
}

function persistPreparedAutomationRefGraphForArtifactEntry(bucketKey, artifactCacheKey, graph) {
  const normalizedGraph = normalizePreparedAutomationRefGraph(graph);
  if (!normalizedGraph) {
    return Promise.resolve(null);
  }
  return artifactStageStore.touch(bucketKey, artifactCacheKey, {
    preparedRefGraph: normalizedGraph,
  });
}

async function getPersistentPreparedAutomationRefGraph(execution, projectId, sourceItem) {
  const artifactCacheKey = buildAutomationArtifactCacheKey(projectId, sourceItem);
  const entry = await artifactStageStore.get(execution.config.bucketKey, artifactCacheKey);
  const graph = normalizePreparedAutomationRefGraph(entry?.preparedRefGraph);
  if (!graph) {
    return null;
  }
  return {
    cacheKey: artifactCacheKey,
    graph: {
      ...graph,
      retrievedVia: 'artifact-stage-cache',
    },
  };
}

async function persistPreparedAutomationRefGraphForSource(execution, projectId, sourceItem, stagedRefs) {
  const graph = buildPreparedAutomationRefGraphFromPreparedRefs(sourceItem, stagedRefs, {
    retrievedVia: stagedRefs?.meta?.retrievedVia || 'artifact-stage-cache',
  });
  if (!graph) {
    return null;
  }

  const artifactCacheKey = buildAutomationArtifactCacheKey(projectId, sourceItem);
  await persistPreparedAutomationRefGraphForArtifactEntry(execution.config.bucketKey, artifactCacheKey, graph);
  preparedAutomationRefGraphCache.getOrCreate(
    buildPreparedAutomationRefGraphCacheKey(projectId, sourceItem),
    () => graph,
  );
  return graph;
}

function buildOutgoingXrefSummaries(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => isOutgoingRefRow(row) && isAutodeskXrefRow(row))
    .map((row) => {
      const targetVersionNumber = normalizeVersionNumber(row?.targetVersionNumber);
      return {
        targetName: row.targetName || row.targetResourceId || '',
        nestedType: row.nestedType || '',
        targetItemId: getResolvableTargetItemId(row),
        targetResourceId: row.targetResourceId || '',
        targetWebViewUrl: row.targetWebViewUrl || '',
        targetVersionNumber,
        targetVersionLabel: row?.targetVersionLabel || formatVersionLabel(targetVersionNumber),
        targetLastModifiedTime: row.targetLastModifiedTime || '',
        targetFileSize: normalizeStorageSize(row?.targetStorageSize),
      };
    });
}

async function resolveItemRefs(projectId, itemId, token) {
  const cacheKey = `${projectId}|${itemId}`;
  return resolvedItemRefsCache.getOrCreate(cacheKey, async () => {
    const tip = await getItemTip(projectId, itemId, token);
    const versionId = tip?.data?.id;

    if (!versionId) {
      throw httpError(500, 'The selected DWG does not expose a latest version ID.');
    }

    let result = {
      tip,
      rows: [],
      retrievedVia: 'ListRefs',
    };

    try {
      const listRefsPayload = await listRefsForVersions(projectId, [versionId], token);
      const parsed = buildRefRows({
        projectId,
        itemId,
        tip,
        payload: listRefsPayload,
        retrievedVia: 'ListRefs',
      });

      result = {
        tip,
        rows: parsed.rows,
        retrievedVia: parsed.confidence === 'high' ? 'ListRefs' : 'ListRefs (low-confidence parse)',
      };

      if (parsed.confidence !== 'high') {
        const fallbackPayload = await getVersionRefRelationships(projectId, versionId, token);
        const fallback = buildRefRows({
          projectId,
          itemId,
          tip,
          payload: fallbackPayload,
          retrievedVia: 'VersionRelationshipsRefs',
        });
        if (fallback.confidence === 'high' || fallback.rows.length) {
          result = {
            tip,
            rows: fallback.rows,
            retrievedVia: 'VersionRelationshipsRefs',
          };
        }
      }
    } catch (error) {
      if (!result.rows.length) {
        throw error;
      }
    }

    return result;
  });
}

function cleanUrl(value) {
  const url = String(value || '').trim();
  return url || null;
}

function buildRefListPayload(projectId, itemId, result) {
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const sourceName = result?.tip?.data?.attributes?.displayName || result?.tip?.data?.attributes?.name || 'ref-list';
  const sourceVersionNumber = normalizeVersionNumber(result?.tip?.data?.attributes?.versionNumber)
    ?? parseVersionNumberFromVersionId(result?.tip?.data?.id || null);
  const sourceVersionLabel = extractVersionLabel(result?.tip?.data) || formatVersionLabel(sourceVersionNumber);
  const sourceExtension = path.extname(sourceName).slice(1).toLowerCase() || 'dwg';

  return {
    data: rows,
    meta: {
      count: rows.length,
      retrievedVia: result?.retrievedVia || 'ListRefs',
      sourceName,
      sourceItemId: result?.tip?.data?.relationships?.item?.data?.id || itemId || '',
      sourceVersionId: result?.tip?.data?.id || '',
      sourceVersionNumber,
      sourceVersionLabel,
      sourceExtension,
      sourceMimeType: result?.tip?.data?.attributes?.mimeType || '',
      sourceFileSize: normalizeStorageSize(result?.tip?.data?.attributes?.storageSize ?? result?.tip?.data?.attributes?.size),
      sourcePathInProject: normalizePathInProject(result?.tip?.data),
      sourceWebViewUrl: cleanUrl(result?.tip?.data?.links?.webView?.href) || '',
      sourceLastModifiedTime: result?.tip?.data?.attributes?.lastModifiedTime || '',
      projectId,
      exportType: 'unfiltered-ref-list',
      includesAllDirections: true,
      includesAllReferenceTypes: true,
      directions: buildCountSummary(rows.map((row) => row?.direction || '')),
      refTypes: buildCountSummary(rows.map((row) => row?.refType || '')),
      refExtensionTypes: buildCountSummary(rows.map((row) => row?.refExtensionType || '')),
      generatedAt: new Date().toISOString(),
    },
  };
}

function getPreferredDrawingWebUrl(itemEntity, tipPayload) {
  const tipData = tipPayload?.data || tipPayload || null;
  const candidates = [
    cleanUrl(tipData?.links?.webView?.href),
    cleanUrl(itemEntity?.links?.webView?.href),
  ].filter(Boolean);

  return candidates.find((candidate) => candidate.includes('web.autocad.com')) || candidates[0] || null;
}


function parseVersionNumberFromVersionId(versionId) {
  const match = String(versionId || '').match(/[?&]version=(\d+)/i);
  if (!match) {
    return null;
  }
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

function normalizeVersionNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeStorageSize(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function resolveUploadTuning(expectedSizeBytes, {
  preferredPartSizeBytes = DIRECT_STREAM_PART_SIZE_BYTES,
  uploadConcurrency = DIRECT_STREAM_UPLOAD_CONCURRENCY,
} = {}) {
  const normalizedSize = normalizeStorageSize(expectedSizeBytes);
  let resolvedPartSizeBytes = Math.max(256 * 1024, Number(preferredPartSizeBytes) || DIRECT_STREAM_PART_SIZE_BYTES);
  let resolvedUploadConcurrency = Math.max(1, Number(uploadConcurrency) || DIRECT_STREAM_UPLOAD_CONCURRENCY);

  if (resolvedPartSizeBytes < DIRECT_STREAM_MIN_MULTIPART_PART_SIZE_BYTES) {
    resolvedPartSizeBytes = DIRECT_STREAM_MIN_MULTIPART_PART_SIZE_BYTES;
  }

  if (normalizedSize && normalizedSize <= DIRECT_STREAM_UPLOAD_SMALL_FILE_LIMIT_BYTES) {
    resolvedPartSizeBytes = Math.min(resolvedPartSizeBytes, DIRECT_STREAM_UPLOAD_SMALL_PART_SIZE_BYTES);
    resolvedUploadConcurrency = Math.max(resolvedUploadConcurrency, 6);
  } else if (normalizedSize && normalizedSize <= DIRECT_STREAM_UPLOAD_MEDIUM_FILE_LIMIT_BYTES) {
    resolvedUploadConcurrency = Math.max(resolvedUploadConcurrency, 6);
  } else if (normalizedSize && normalizedSize <= DIRECT_STREAM_UPLOAD_LARGE_FILE_LIMIT_BYTES) {
    resolvedUploadConcurrency = Math.max(resolvedUploadConcurrency, 8);
  } else if (normalizedSize && normalizedSize > DIRECT_STREAM_UPLOAD_LARGE_FILE_LIMIT_BYTES) {
    resolvedPartSizeBytes = Math.max(resolvedPartSizeBytes, DIRECT_STREAM_UPLOAD_LARGE_PART_SIZE_BYTES);
  }

  return {
    singlePartLimitBytes: DIRECT_STREAM_SINGLE_PART_LIMIT_BYTES,
    preferredPartSizeBytes: resolvedPartSizeBytes,
    uploadConcurrency: resolvedUploadConcurrency,
  };
}

function formatVersionLabel(versionNumber) {
  if (!Number.isFinite(versionNumber)) {
    return null;
  }
  return `V${versionNumber}`;
}

function normalizeVersionLabel(value, fallbackVersionNumber = null) {
  const raw = String(value || '').trim();
  if (!raw) {
    return Number.isFinite(fallbackVersionNumber) ? formatVersionLabel(fallbackVersionNumber) : null;
  }
  if (/^v\d+$/i.test(raw)) {
    return `V${Number.parseInt(raw.slice(1), 10)}`;
  }
  if (/^\d+$/.test(raw)) {
    return `V${Number.parseInt(raw, 10)}`;
  }
  return raw;
}

function extractVersionLabel(resource) {
  const target = resource?.attributes ? resource : { attributes: resource || {} };
  const attributes = target?.attributes || {};
  const extensionData = attributes?.extension?.data || target?.extension?.data || {};
  const versionNumber = normalizeVersionNumber(attributes?.versionNumber ?? target?.versionNumber ?? extensionData?.versionNumber ?? null)
    ?? parseVersionNumberFromVersionId(target?.id || null);
  const candidates = [
    attributes?.sourceVersionLabel,
    attributes?.versionLabel,
    extensionData?.sourceVersionLabel,
    extensionData?.revisionDisplayLabel,
    target?.sourceVersionLabel,
    target?.versionLabel,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeVersionLabel(candidate, versionNumber);
    if (normalized) {
      return normalized;
    }
  }

  return Number.isFinite(versionNumber) ? formatVersionLabel(versionNumber) : null;
}

function buildCountSummary(values) {
  const counts = {};
  for (const value of Array.isArray(values) ? values : []) {
    const key = String(value || '').trim() || '(unspecified)';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  const queuedAt = getTimingStart();
  let index = 0;
  let firstError = null;

  async function worker() {
    while (true) {
      if (firstError || index >= items.length) {
        return;
      }
      const current = index;
      index += 1;
      const queueWaitMs = roundDurationMs(getDurationMs(queuedAt));
      try {
        results[current] = await mapper(items[current], current, queueWaitMs);
      } catch (error) {
        if (!firstError) {
          firstError = error;
        }
        return;
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length || 1) }, () => worker());
  await Promise.allSettled(workers);
  if (firstError) {
    throw firstError;
  }
  return results;
}

function normalizeBudgetWeight(value, maxWeight) {
  const fallbackWeight = 1;
  const normalizedMax = Number.isFinite(Number(maxWeight)) && Number(maxWeight) > 0 ? Number(maxWeight) : 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return normalizedMax ? Math.min(fallbackWeight, normalizedMax) : fallbackWeight;
  }
  if (!normalizedMax) {
    return parsed;
  }
  return Math.min(parsed, normalizedMax);
}

async function mapWithWeightedBudget(items, { limit, maxWeight = 0, weightFn = null } = {}, mapper) {
  const normalizedItems = Array.isArray(items) ? items : [];
  if (!normalizedItems.length) {
    return [];
  }

  const safeLimit = Math.max(1, Number(limit) || 1);
  const safeMaxWeight = Number.isFinite(Number(maxWeight)) && Number(maxWeight) > 0 ? Number(maxWeight) : 0;
  const getWeight = typeof weightFn === 'function'
    ? (item, index) => normalizeBudgetWeight(weightFn(item, index), safeMaxWeight)
    : () => normalizeBudgetWeight(1, safeMaxWeight);

  const results = new Array(normalizedItems.length);
  const queuedAt = getTimingStart();
  let nextIndex = 0;
  let activeCount = 0;
  let inFlightWeight = 0;
  let firstError = null;

  return new Promise((resolve, reject) => {
    const maybeFinish = () => {
      if (firstError && activeCount === 0) {
        reject(firstError);
        return true;
      }
      if (!firstError && nextIndex >= normalizedItems.length && activeCount === 0) {
        resolve(results);
        return true;
      }
      return false;
    };

    const schedule = () => {
      if (maybeFinish()) {
        return;
      }

      while (!firstError && nextIndex < normalizedItems.length && activeCount < Math.min(safeLimit, normalizedItems.length)) {
        const current = nextIndex;
        const weight = getWeight(normalizedItems[current], current);
        if (safeMaxWeight && activeCount > 0 && (inFlightWeight + weight) > safeMaxWeight) {
          break;
        }

        nextIndex += 1;
        activeCount += 1;
        inFlightWeight += weight;
        const queueWaitMs = roundDurationMs(getDurationMs(queuedAt));

        Promise.resolve()
          .then(() => mapper(normalizedItems[current], current, queueWaitMs, weight))
          .then((result) => {
            results[current] = result;
          })
          .catch((error) => {
            if (!firstError) {
              firstError = error;
            }
          })
          .finally(() => {
            activeCount = Math.max(0, activeCount - 1);
            inFlightWeight = Math.max(0, inFlightWeight - weight);
            if (maybeFinish()) {
              return;
            }
            schedule();
          });
      }

      maybeFinish();
    };

    schedule();
  });
}

function createTaskLimiter(limit) {
  const safeLimit = Math.max(1, Number(limit) || 1);
  const inFlight = new Set();

  async function schedule(task) {
    while (inFlight.size >= safeLimit) {
      await Promise.race(inFlight);
    }

    const tracked = Promise.resolve()
      .then(() => task())
      .finally(() => {
        inFlight.delete(tracked);
      });

    inFlight.add(tracked);
    return tracked;
  }

  async function drain() {
    await Promise.allSettled([...inFlight]);
  }

  return {
    schedule,
    drain,
    get size() {
      return inFlight.size;
    },
  };
}

function memoizePromise(cache, key, factory) {
  if (cache.has(key)) {
    return cache.get(key);
  }

  const promise = Promise.resolve().then(factory);
  cache.set(key, promise);
  promise.catch(() => cache.delete(key));
  return promise;
}

async function enrichItemsWithVersionMetadata(projectId, items, token) {
  return mapWithConcurrency(items, 8, async (item) => {
    try {
      const tip = await getItemTip(projectId, item.id, token);
      const versionId = tip?.data?.id || null;
      const versionNumber = normalizeVersionNumber(tip?.data?.attributes?.versionNumber)
        ?? parseVersionNumberFromVersionId(versionId);
      const sourceVersionLabel = extractVersionLabel(tip?.data) || formatVersionLabel(versionNumber);
      return {
        ...item,
        versionId,
        versionNumber,
        sourceVersionLabel,
        versionLabel: sourceVersionLabel,
        size: normalizeStorageSize(tip?.data?.attributes?.storageSize ?? tip?.data?.attributes?.size ?? item.size),
      };
    } catch {
      return {
        ...item,
        versionId: null,
        versionNumber: null,
        sourceVersionLabel: null,
        versionLabel: null,
        size: normalizeStorageSize(item.size),
      };
    }
  });
}

function parseStorageUrn(storageUrn) {
  const prefix = 'urn:adsk.objects:os.object:';
  if (!String(storageUrn || '').startsWith(prefix)) {
    throw httpError(500, `Unsupported storage URN: ${storageUrn}`);
  }
  const remainder = storageUrn.slice(prefix.length);
  const slashIndex = remainder.indexOf('/');
  if (slashIndex < 0) {
    throw httpError(500, `Could not parse storage URN: ${storageUrn}`);
  }
  return {
    bucketKey: decodeURIComponent(remainder.slice(0, slashIndex)),
    objectKey: decodeURIComponent(remainder.slice(slashIndex + 1)),
  };
}


async function getVersionEntity(projectId, versionId, token) {
  const payload = await apsJson(`/data/v1/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}`, {
    token,
    context: 'Could not retrieve the ACC version',
  });
  return payload?.data || null;
}

async function tryResolveAccFolderIdCandidates(projectId, folderId, token, context = 'ACC folder id') {
  const bareFolderId = extractAccFolderBareId(folderId);
  if (!bareFolderId) {
    return '';
  }

  const candidateUrns = buildCandidateAccFolderUrns(folderId);
  let lastError = null;

  for (const candidateUrn of candidateUrns) {
    try {
      const folderEntity = await getFolderEntity(projectId, candidateUrn, token);
      const resolvedFolderId = extractAccFolderId(folderEntity?.id) || candidateUrn;
      if (decodeAccIdentifier(folderId) !== resolvedFolderId) {
        logger.info('acc.folder-id.recovered', {
          projectId,
          context,
          requestedFolderId: decodeAccIdentifier(folderId),
          bareFolderId,
          resolvedFolderId,
        });
      }
      return resolvedFolderId;
    } catch (error) {
      lastError = error;
    }
  }

  if (candidateUrns.length) {
    logger.warn('acc.folder-id.recovery-failed', {
      projectId,
      context,
      requestedFolderId: decodeAccIdentifier(folderId),
      bareFolderId,
      candidateUrns,
      error: lastError?.message || null,
    });
  }

  return '';
}

async function resolveAccFolderId(projectId, folderId, token, context = 'ACC folder id') {
  const normalizedFolderId = extractAccFolderId(folderId);
  if (normalizedFolderId && isAccFolderUrn(normalizedFolderId)) {
    return normalizedFolderId;
  }

  const recoveredFolderId = await tryResolveAccFolderIdCandidates(projectId, folderId, token, context);
  if (recoveredFolderId) {
    return recoveredFolderId;
  }

  const itemId = extractAccItemId(folderId);
  if (itemId) {
    const itemEntity = await getItemEntity(projectId, itemId, token);
    const parentFolderId = extractAccFolderId(itemEntity?.relationships?.parent?.data?.id);
    if (parentFolderId) {
      return parentFolderId;
    }
    throw httpError(400, `${context} does not point to an ACC item with a parent folder.`);
  }

  const versionId = extractAccVersionId(folderId);
  if (versionId) {
    const versionEntity = await getVersionEntity(projectId, versionId, token);
    const parentFolderId = extractAccFolderId(versionEntity?.relationships?.parent?.data?.id);
    if (parentFolderId) {
      return parentFolderId;
    }

    const relatedItemId = extractAccItemId(versionEntity?.relationships?.item?.data?.id);
    if (relatedItemId) {
      return resolveAccFolderId(projectId, relatedItemId, token, context);
    }

    throw httpError(400, `${context} does not point to an ACC version with a resolvable parent folder.`);
  }

  throw httpError(400, `${context} is not in the proper format.`);
}

async function getItemTip(projectId, itemId, token) {
  const cacheKey = `${projectId}|${itemId}`;
  return itemTipCache.getOrCreate(cacheKey, () => apsJson(`/data/v1/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemId)}/tip`, {
    token,
    context: 'Could not retrieve the latest ACC item version',
  }));
}

async function listRefsForVersions(projectId, versionIds, token) {
  const versions = Array.isArray(versionIds) ? versionIds.filter(Boolean) : [];
  if (!versions.length) {
    return { data: [], included: [] };
  }

  return apsJson(`/data/v1/projects/${encodeURIComponent(projectId)}/commands`, {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/vnd.api+json' },
    body: {
      jsonapi: { version: '1.0' },
      data: {
        type: 'commands',
        attributes: {
          extension: {
            type: 'commands:autodesk.core:ListRefs',
            version: '1.0.0',
          },
        },
        relationships: {
          resources: {
            data: versions.map((versionId) => ({
              type: 'versions',
              id: versionId,
            })),
          },
        },
      },
    },
    context: 'Could not list refs for the selected file',
  });
}

async function getVersionRefRelationships(projectId, versionId, token) {
  return apsJson(`/data/v1/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}/relationships/refs`, {
    token,
    context: 'Could not retrieve refs for the selected version',
  });
}

async function getItemEntity(projectId, itemId, token) {
  const cacheKey = `${projectId}|${itemId}`;
  const payload = await itemEntityCache.getOrCreate(cacheKey, () => apsJson(`/data/v1/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemId)}`, {
    token,
    context: 'Could not retrieve the ACC item',
  }));
  return payload?.data || null;
}

async function getVersionEntity(projectId, versionId, token) {
  const normalizedVersionId = decodeAccIdentifier(versionId);
  const payload = await apsJson(`/data/v1/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(normalizedVersionId)}`, {
    token,
    context: 'Could not retrieve the ACC version',
  });
  return payload?.data || null;
}

async function resolveFolderContentsId(projectId, folderLikeId, token) {
  const decodedId = decodeAccIdentifier(folderLikeId);
  const normalizedFolderId = extractAccFolderId(decodedId);
  if (normalizedFolderId && isAccFolderUrn(normalizedFolderId)) {
    return normalizedFolderId;
  }

  if (isAccItemUrn(decodedId)) {
    const itemEntity = await getItemEntity(projectId, decodedId, token);
    const parentFolderId = extractAccFolderId(itemEntity?.relationships?.parent?.data?.id);
    if (parentFolderId && isAccFolderUrn(parentFolderId)) {
      return parentFolderId;
    }
    throw httpError(400, 'Could not resolve the parent ACC folder from the selected item.');
  }

  if (isAccVersionUrn(decodedId)) {
    const versionEntity = await getVersionEntity(projectId, decodedId, token);
    const itemId = versionEntity?.relationships?.item?.data?.id || '';
    if (isAccItemUrn(itemId)) {
      const itemEntity = await getItemEntity(projectId, itemId, token);
      const parentFolderId = extractAccFolderId(itemEntity?.relationships?.parent?.data?.id);
      if (parentFolderId && isAccFolderUrn(parentFolderId)) {
        return parentFolderId;
      }
    }
    throw httpError(400, 'Could not resolve the parent ACC folder from the selected version.');
  }

  throw httpError(400, 'ACC folder id is not in the proper format.');
}


const visibleFolderPathCache = new Map();
const visibleFolderStopCache = new Map();
const folderEntityCache = createTimedPromiseCache({ ttlMs: 2 * 60 * 1000, maxEntries: 4000 });

function normalizeAccFolderId(folderId, context = 'ACC folder') {
  const normalized = extractAccFolderId(folderId);
  if (!normalized) {
    throw httpError(400, `${context} must be a valid ACC folder id (for example urn:adsk.wipprod:fs.folder:co...).`);
  }
  return normalized;
}

async function getFolderEntity(projectId, folderId, token) {
  const normalizedFolderId = normalizeAccFolderId(folderId, 'ACC folder id');
  const cacheKey = `${projectId}|${normalizedFolderId}`;
  return folderEntityCache.getOrCreate(cacheKey, async () => {
    const payload = await apsJson(`/data/v1/projects/${encodeURIComponent(projectId)}/folders/${encodeURIComponent(normalizedFolderId)}`, {
      token,
      context: 'Could not retrieve the ACC folder',
    });
    return payload?.data || null;
  });
}

async function getVisibleFolderSegments(projectId, folderId, token) {
  const cacheKey = `${projectId}|${folderId}`;
  if (visibleFolderPathCache.has(cacheKey)) {
    return visibleFolderPathCache.get(cacheKey);
  }

  const segments = [];
  const seen = new Set();
  let currentFolderId = normalizeAccFolderId(folderId, 'ACC folder id');
  let hiddenSegmentsRemoved = 0;

  while (currentFolderId && !seen.has(currentFolderId)) {
    seen.add(currentFolderId);

    const stopCacheKey = `${projectId}|${currentFolderId}`;
    const stopReason = visibleFolderStopCache.get(stopCacheKey);
    if (stopReason) {
      logger.debug('acc.folder-path.stop-cache-hit', {
        projectId,
        folderId: currentFolderId,
        reason: stopReason,
      });
      break;
    }

    let folderEntity = null;
    try {
      folderEntity = await getFolderEntity(projectId, currentFolderId, token);
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : null;
      const reason = status === 403
        ? 'forbidden'
        : status === 404
          ? 'not-found'
          : status === 400
            ? 'invalid'
            : 'error';
      visibleFolderStopCache.set(stopCacheKey, reason);
      const logContext = {
        projectId,
        folderId: currentFolderId,
        status,
        reason,
        error: error?.message || 'Could not retrieve the ACC folder while building a visible path.',
      };
      if (status === 403 || status === 404) {
        logger.debug('acc.folder-path.segment-skipped', logContext);
      } else {
        logger.warn('acc.folder-path.segment-skipped', logContext);
      }
      break;
    }
    if (!folderEntity) {
      visibleFolderStopCache.set(stopCacheKey, 'missing');
      break;
    }

    const folderName = getDisplayName(folderEntity);
    const hidden = Boolean(folderEntity?.attributes?.hidden);
    if (folderName) {
      if (hidden || isLikelyHiddenAccPathSegment(folderName)) {
        hiddenSegmentsRemoved += 1;
      } else {
        segments.unshift(sanitizeSegment(folderName));
      }
      if (isVisibleDocsTopFolderName(folderName)) {
        visibleFolderStopCache.set(stopCacheKey, 'docs-top');
        logger.debug('acc.folder-path.stop-at-docs-top', {
          projectId,
          folderId: currentFolderId,
          folderName,
        });
        break;
      }
    }

    currentFolderId = extractAccFolderId(folderEntity?.relationships?.parent?.data?.id) || '';
  }

  const normalizedSegments = stripLeadingSegmentsBeforeDocsTopFolder(segments);
  const result = {
    segments: normalizedSegments,
    hiddenSegmentsRemoved: hiddenSegmentsRemoved + Math.max(0, segments.length - normalizedSegments.length),
  };
  visibleFolderPathCache.set(cacheKey, result);
  return result;
}

async function buildVisibleProjectRelativePath(projectId, parentFolderId, fileName, token) {
  const folderInfo = parentFolderId
    ? await getVisibleFolderSegments(projectId, parentFolderId, token)
    : { segments: [], hiddenSegmentsRemoved: 0 };

  const fileSegment = sanitizeFileName(fileName || 'file.dwg');
  const joined = folderInfo.segments.length
    ? `${folderInfo.segments.join('/')}/${fileSegment}`
    : fileSegment;

  return {
    relativePath: sanitizeDisplayPath(joined, fileSegment),
    hiddenSegmentsRemoved: folderInfo.hiddenSegmentsRemoved,
  };
}

function getLockedAccUploadMessage(itemEntity) {
  const reservedBy = itemEntity?.attributes?.reservedUserName;
  return reservedBy
    ? `Skipped ACC upload because the drawing is locked in Autodesk Docs by ${reservedBy}.`
    : 'Skipped ACC upload because the drawing is locked in Autodesk Docs.';
}

function isReservationLockedError(error) {
  const combined = `${error?.message || ''} ${JSON.stringify(error?.payload || '')}`.toLowerCase();
  return combined.includes('reservation_lineage_reserved')
    || combined.includes('target lineage is reserved')
    || combined.includes('can only be modified by the reserving user');
}

function isFolderContentsProjectMismatchError(error) {
  const status = Number(error?.status || 0);
  const combined = `${error?.message || ''} ${JSON.stringify(error?.payload || '')}`.toLowerCase();
  return status === 400 && combined.includes('urn is not in the proper format');
}

async function listFolderEntities(projectId, folderId, token) {
  const normalizedFolderId = await resolveAccFolderId(projectId, folderId, token, 'ACC folder id');
  const requestContents = (resolvedFolderId) => apsAllPages(
    `/data/v1/projects/${encodeURIComponent(projectId)}/folders/${encodeURIComponent(resolvedFolderId)}/contents`,
    token,
    'Could not list ACC folder contents',
  );

  try {
    return await requestContents(normalizedFolderId);
  } catch (error) {
    if (isFolderContentsProjectMismatchError(error) && isAccFolderUrn(normalizedFolderId)) {
      const recoveredFolderId = await tryResolveAccFolderIdCandidates(projectId, normalizedFolderId, token, 'ACC folder id');
      if (recoveredFolderId && recoveredFolderId !== normalizedFolderId) {
        logger.warn('acc.folder-contents.recovered', {
          projectId,
          requestedFolderId: decodeAccIdentifier(folderId),
          normalizedFolderId,
          recoveredFolderId,
        });
        return requestContents(recoveredFolderId);
      }

      logger.warn('acc.folder-contents.project-folder-mismatch', {
        projectId,
        requestedFolderId: decodeAccIdentifier(folderId),
        normalizedFolderId,
        folderNamespace: extractAccFolderNamespace(normalizedFolderId),
        folderBareId: extractAccFolderBareId(normalizedFolderId),
        error: error?.message || null,
      });
      throw httpError(409, 'The selected ACC folder no longer matches the active project. Refresh hubs and open the folder again from the active project tree.', {
        kind: 'project-folder-mismatch',
        projectId,
        folderId: normalizedFolderId,
      });
    }
    throw error;
  }
}

async function getSignedDownloadForStorage(storageUrn, token) {
  const { bucketKey, objectKey } = parseStorageUrn(storageUrn);
  for (let attempt = 1; attempt <= 5; attempt++) {
    const payload = await apsJson(
      `/oss/v2/buckets/${encodeURIComponent(bucketKey)}/objects/${encodeURIComponent(objectKey)}/signeds3download?minutesExpiration=10`,
      {
        token,
        context: 'Could not create a signed download URL',
      },
    );
    const url = payload?.url || payload?.signedUrl || (Array.isArray(payload?.urls) ? payload.urls[0] : null);
    if ((payload?.status === 'complete' || payload?.status === undefined) && url) {
      return { bucketKey, objectKey, url };
    }
    await sleep(1000 * attempt);
  }
  throw httpError(500, 'The requested ACC file is not ready for download yet.');
}

async function getItemDownload(projectId, itemId, token) {
  const tip = await getItemTip(projectId, itemId, token);
  const storageUrn = tip?.data?.relationships?.storage?.data?.id;
  if (!storageUrn) {
    throw httpError(500, 'The selected DWG does not expose a storage relationship.');
  }
  const signed = await getSignedDownloadForStorage(storageUrn, token);
  return {
    displayName: tip?.data?.attributes?.displayName || tip?.data?.attributes?.name || 'download.dwg',
    versionId: tip?.data?.id || null,
    sizeBytes: normalizeStorageSize(tip?.data?.attributes?.storageSize ?? tip?.data?.attributes?.size),
    storageUrn,
    ...signed,
  };
}

async function createStorage(projectId, folderId, displayName, token) {
  const normalizedFolderId = normalizeAccFolderId(folderId, 'ACC folder id');
  const body = {
    jsonapi: { version: '1.0' },
    data: {
      type: 'objects',
      attributes: { name: displayName },
      relationships: {
        target: {
          data: {
            type: 'folders',
            id: normalizedFolderId,
          },
        },
      },
    },
  };

  const payload = await apsJson(`/data/v1/projects/${encodeURIComponent(projectId)}/storage`, {
    method: 'POST',
    token,
    body,
    headers: { 'Content-Type': 'application/vnd.api+json' },
    expectedStatus: [200, 201],
    context: `Could not create ACC storage for ${displayName}`,
  });
  return payload.data;
}

async function createVersion(projectId, itemId, objectId, displayName, token, { refs = [] } = {}) {
  const extensionTypes = ['versions:autodesk.bim360:File', 'versions:autodesk.core:File'];
  const normalizedRefs = dedupeAutomationVersionRefs(refs);
  let lastError = null;

  for (const extensionType of extensionTypes) {
    try {
      const relationships = {
        item: {
          data: {
            type: 'items',
            id: itemId,
          },
        },
        storage: {
          data: {
            type: 'objects',
            id: objectId,
          },
        },
      };

      if (normalizedRefs.length) {
        relationships.refs = {
          data: normalizedRefs,
        };
      }

      const payload = await apsJson(`/data/v1/projects/${encodeURIComponent(projectId)}/versions`, {
        method: 'POST',
        token,
        headers: { 'Content-Type': 'application/vnd.api+json' },
        expectedStatus: [200, 201],
        body: {
          jsonapi: { version: '1.0' },
          data: {
            type: 'versions',
            attributes: {
              name: displayName,
              extension: {
                type: extensionType,
                version: '1.0',
              },
            },
            relationships,
          },
        },
        context: `Could not create a new version for ${displayName}`,
      });
      return payload.data;
    } catch (error) {
      lastError = error;
      if (![400, 406, 409, 422].includes(error.status || 0)) {
        throw error;
      }
    }
  }

  throw lastError || httpError(500, `Could not create a new version for ${displayName}`);
}

async function retryStorageReady(operation) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const payloadText = JSON.stringify(error.payload || '');
      const isStorageDelay =
        error.status === 406 ||
        /storage is not ready/i.test(error.message || '') ||
        payloadText.includes('ERR_STORAGE_NOT_READY');
      if (!isStorageDelay || attempt === 3) {
        throw error;
      }
      await sleep(1500 * attempt);
    }
  }
  throw lastError || httpError(500, 'The ACC storage object was not ready in time.');
}

async function getSignedUploadBatch(bucketKey, objectKey, token, { parts = 1, firstPart = 1, uploadKey, region = null } = {}) {
  const query = new URLSearchParams({
    parts: String(parts),
    firstPart: String(firstPart),
    minutesExpiration: '15',
  });
  if (uploadKey) {
    query.set('uploadKey', uploadKey);
  }
  const headers = region ? { 'x-ads-region': region } : {};
  return apsJson(`/oss/v2/buckets/${encodeURIComponent(bucketKey)}/objects/${encodeURIComponent(objectKey)}/signeds3upload?${query.toString()}`, {
    token,
    headers,
    context: 'Could not create signed upload URLs',
  });
}

async function completeSignedUpload(bucketKey, objectKey, uploadKey, token, { contentType = 'application/octet-stream', region = null } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'x-ads-meta-Content-Type': contentType,
    ...(region ? { 'x-ads-region': region } : {}),
  };
  return apsJson(`/oss/v2/buckets/${encodeURIComponent(bucketKey)}/objects/${encodeURIComponent(objectKey)}/signeds3upload`, {
    method: 'POST',
    token,
    headers,
    body: { uploadKey },
    context: 'Could not finalize the signed upload',
  });
}

function createSignedUploadState() {
  return {
    nextPartToReserve: 1,
    uploadKey: null,
    urls: [],
    reservationQueue: Promise.resolve(),
  };
}

async function withSignedUploadReservationLock(uploadState, work) {
  const previous = uploadState.reservationQueue || Promise.resolve();
  let release;
  uploadState.reservationQueue = new Promise((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}

async function reserveSignedUploadUrl(bucketKey, objectKey, token, uploadState, partNumber, { region = null, refresh = false } = {}) {
  const state = uploadState || createSignedUploadState();
  return withSignedUploadReservationLock(state, async () => {
    const shouldRefresh = refresh || !state.urls.length || state.nextPartToReserve !== partNumber;
    if (shouldRefresh) {
      const uploadParams = await getSignedUploadBatch(bucketKey, objectKey, token, {
        firstPart: partNumber,
        parts: refresh ? 1 : 25,
        uploadKey: state.uploadKey,
        region,
      });
      state.urls = Array.isArray(uploadParams.urls) ? uploadParams.urls.slice() : [];
      state.uploadKey = uploadParams.uploadKey || state.uploadKey;
      state.nextPartToReserve = partNumber;
      if (!state.urls.length || !state.uploadKey) {
        throw httpError(502, 'APS did not return valid signed upload URLs.');
      }
    }

    const uploadUrl = state.urls.shift();
    if (!uploadUrl) {
      throw httpError(502, `APS did not return a signed upload URL for part ${partNumber}.`);
    }
    state.nextPartToReserve = partNumber + 1;
    return uploadUrl;
  });
}

async function putSignedUploadPart(uploadUrl, buffer) {
  return fetchWithTimeout(uploadUrl, {
    method: 'PUT',
    body: buffer,
    headers: {
      'Content-Length': String(buffer.byteLength),
    },
  }, { timeoutMs: REMOTE_FETCH_TIMEOUT_MS, context: 'Could not upload a signed OSS part' });
}

async function uploadBufferToSignedOss(buffer, bucketKey, objectKey, token, { region = null, uploadState, partNumber } = {}) {
  if (!buffer?.length) {
    throw httpError(400, 'Cannot upload an empty file chunk.');
  }

  const state = uploadState || createSignedUploadState();
  const resolvedPartNumber = Number.isFinite(Number(partNumber)) ? Number(partNumber) : state.nextPartToReserve;
  let lastError = null;

  for (let attempt = 1; attempt <= DIRECT_STREAM_UPLOAD_RETRY_LIMIT; attempt += 1) {
    const uploadUrl = await reserveSignedUploadUrl(bucketKey, objectKey, token, state, resolvedPartNumber, {
      region,
      refresh: attempt > 1,
    });
    const response = await putSignedUploadPart(uploadUrl, buffer);

    if (response.status === 403 || response.status === 429 || response.status >= 500) {
      lastError = httpError(response.status || 502, `Failed to upload file part ${resolvedPartNumber}: ${response.statusText || 'Retryable upload error.'}`);
      if (attempt < DIRECT_STREAM_UPLOAD_RETRY_LIMIT) {
        await sleep(150 * attempt);
        continue;
      }
    }

    if (!response.ok) {
      const payload = await parseResponseBody(response);
      throw httpError(response.status || 502, `Failed to upload file part ${resolvedPartNumber}: ${getErrorSummary(payload) || response.statusText}`, payload);
    }

    return state;
  }

  throw lastError || httpError(502, `Failed to upload file part ${resolvedPartNumber}.`);
}

function trackInflightUpload(inFlight, promise) {
  const tracked = promise.finally(() => {
    const index = inFlight.indexOf(tracked);
    if (index >= 0) {
      inFlight.splice(index, 1);
    }
  });
  inFlight.push(tracked);
  return tracked;
}

async function waitForInflightCapacity(inFlight, limit) {
  while (inFlight.length >= limit) {
    await Promise.race(inFlight);
  }
}

async function uploadFileToSignedOss(filePath, bucketKey, objectKey, token, {
  contentType = 'application/octet-stream',
  region = null,
  partSizeBytes = DIRECT_STREAM_PART_SIZE_BYTES,
  uploadConcurrency = DIRECT_STREAM_UPLOAD_CONCURRENCY,
} = {}) {
  const file = await fsp.open(filePath, 'r');
  const stat = await file.stat();
  if (stat.size <= 0) {
    await file.close();
    throw httpError(400, 'Cannot upload an empty file.');
  }

  const uploadTuning = resolveUploadTuning(stat.size, {
    preferredPartSizeBytes: partSizeBytes,
    uploadConcurrency,
  });
  const chunkSize = uploadTuning.preferredPartSizeBytes;
  const totalParts = Math.ceil(stat.size / chunkSize);
  const uploadState = createSignedUploadState();
  const inFlight = [];
  let uploadQueueWaitMs = 0;
  let uploadActiveTransferMs = 0;
  let activeUploadCount = 0;
  let activeUploadWindowStartedAt = null;
  let uploadTimingWindow = null;

  function markUploadStarted() {
    if (!uploadTimingWindow) {
      uploadTimingWindow = createTimingWindow();
    }
    if (activeUploadCount === 0) {
      activeUploadWindowStartedAt = getTimingStart();
    }
    activeUploadCount += 1;
  }

  function markUploadFinished() {
    activeUploadCount = Math.max(0, activeUploadCount - 1);
    if (activeUploadCount === 0 && activeUploadWindowStartedAt) {
      uploadActiveTransferMs += getDurationMs(activeUploadWindowStartedAt);
      activeUploadWindowStartedAt = null;
    }
  }

  try {
    for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
      const queueWaitStartedAt = getTimingStart();
      await waitForInflightCapacity(inFlight, uploadTuning.uploadConcurrency);
      uploadQueueWaitMs += getDurationMs(queueWaitStartedAt);

      const start = (partNumber - 1) * chunkSize;
      const length = Math.min(chunkSize, stat.size - start);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await file.read(buffer, 0, length, start);
      const data = buffer.subarray(0, bytesRead);
      markUploadStarted();
      trackInflightUpload(inFlight, uploadBufferToSignedOss(data, bucketKey, objectKey, token, {
        region,
        uploadState,
        partNumber,
      }).finally(() => {
        markUploadFinished();
      }));
    }

    await Promise.all(inFlight);
  } finally {
    await file.close();
  }

  if (!uploadState.uploadKey) {
    throw httpError(400, 'Cannot upload an empty file.');
  }

  await completeSignedUpload(bucketKey, objectKey, uploadState.uploadKey, token, { contentType, region });
  const uploadTiming = uploadTimingWindow
    ? buildTimingFields(uploadTimingWindow, {
        queueWaitMs: uploadQueueWaitMs,
        activeTransferMs: uploadActiveTransferMs,
        timingKind: 'transfer',
      })
    : createImmediateTimingFields();

  return {
    sizeBytes: stat.size,
    expectedSizeBytes: stat.size,
    partCount: totalParts,
    uploadTiming,
    uploadDurationMs: uploadTiming.criticalPathMs,
  };
}


function roundMetric(value, digits = 2) {
  if (!Number.isFinite(Number(value))) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function buildTransferMetrics(fileSizeBytes, durationMs) {
  const normalizedSize = normalizeStorageSize(fileSizeBytes);
  const normalizedDuration = Number.isFinite(Number(durationMs)) && Number(durationMs) > 0
    ? Number(durationMs)
    : null;

  if (!normalizedSize || !normalizedDuration) {
    return {
      fileSizeBytes: normalizedSize,
      fileSizeMiB: normalizedSize ? roundMetric(normalizedSize / (1024 * 1024)) : null,
      throughputMiBps: null,
      throughputMbps: null,
    };
  }

  const seconds = normalizedDuration / 1000;
  return {
    fileSizeBytes: normalizedSize,
    fileSizeMiB: roundMetric(normalizedSize / (1024 * 1024)),
    throughputMiBps: roundMetric((normalizedSize / (1024 * 1024)) / seconds),
    throughputMbps: roundMetric(((normalizedSize * 8) / 1000 / 1000) / seconds),
  };
}

function createBufferQueue() {
  return {
    chunks: [],
    size: 0,
  };
}

function pushBufferQueue(queue, chunk) {
  if (!chunk || !chunk.length) {
    return;
  }
  queue.chunks.push(chunk);
  queue.size += chunk.length;
}

function shiftBufferQueue(queue, requestedSize = queue.size) {
  const targetSize = Math.min(Math.max(Number(requestedSize) || 0, 0), queue.size);
  if (!targetSize) {
    return Buffer.alloc(0);
  }

  if (queue.chunks.length === 1 && queue.chunks[0].length === targetSize) {
    const only = queue.chunks.shift();
    queue.size = 0;
    return only;
  }

  const result = Buffer.allocUnsafe(targetSize);
  let offset = 0;

  while (offset < targetSize && queue.chunks.length) {
    const chunk = queue.chunks[0];
    const remaining = targetSize - offset;
    if (chunk.length <= remaining) {
      chunk.copy(result, offset);
      offset += chunk.length;
      queue.chunks.shift();
      continue;
    }

    chunk.copy(result, offset, 0, remaining);
    queue.chunks[0] = chunk.subarray(remaining);
    offset += remaining;
  }

  queue.size -= targetSize;
  return result;
}

function buildAutomationArtifactCacheKey(projectId, item, download) {
  const versionId = String(download?.versionId || item?.versionId || '').trim();
  const storageUrn = String(download?.storageUrn || item?.storageUrn || '').trim();
  const itemId = String(item?.itemId || '').trim();
  const project = String(projectId || '').trim();
  const displayName = sanitizeFileName(download?.displayName || item?.displayName || 'artifact.dwg');
  return versionId || storageUrn || `${project}|${itemId}|${displayName}`;
}

function buildSharedAutomationObjectKey(execution, projectId, item, download) {
  const cacheKey = buildAutomationArtifactCacheKey(projectId, item, download);
  const hash = crypto.createHash('sha256').update(cacheKey).digest('hex').slice(0, 16);
  const safeName = sanitizeFileName(download?.displayName || item?.displayName || 'artifact.dwg');
  return `jobs/${execution.executionKey}/shared/${hash}-${safeName}`;
}

async function verifyPersistentArtifactExists(config, automationToken, entry) {
  try {
    await getOssSignedDownload(config, automationToken, entry.bucketKey, entry.objectKey);
    return true;
  } catch (error) {
    if ([400, 404].includes(error?.status || 0)) {
      return false;
    }
    throw error;
  }
}

async function getReusablePersistentArtifact(execution, cacheKey) {
  const config = execution.config;
  const entry = await artifactStageStore.get(config.bucketKey, cacheKey);
  if (!entry) {
    logger.debug('cache.lookup', {
      cacheKind: 'artifact-stage',
      cacheKey,
      bucketKey: config.bucketKey,
      scope: 'persistent',
      hit: false,
      reason: 'missing',
    });
    return null;
  }

  const now = Date.now();
  if (!isPersistentArtifactEntryFresh(entry, now)) {
    await artifactStageStore.delete(config.bucketKey, cacheKey);
    logger.debug('cache.lookup', {
      cacheKind: 'artifact-stage',
      cacheKey,
      bucketKey: config.bucketKey,
      scope: 'persistent',
      hit: false,
      reason: 'stale',
      versionId: entry.versionId || null,
      sizeBytes: normalizeStorageSize(entry.sizeBytes),
    });
    return null;
  }

  if (shouldVerifyPersistentArtifact(entry, now)) {
    const exists = await verifyPersistentArtifactExists(config, execution.automationToken, entry);
    if (!exists) {
      await artifactStageStore.delete(config.bucketKey, cacheKey);
      logger.debug('cache.lookup', {
        cacheKind: 'artifact-stage',
        cacheKey,
        bucketKey: config.bucketKey,
        scope: 'persistent',
        hit: false,
        reason: 'verify-miss',
        versionId: entry.versionId || null,
        sizeBytes: normalizeStorageSize(entry.sizeBytes),
      });
      return null;
    }
    await artifactStageStore.touch(config.bucketKey, cacheKey, { lastVerifiedAt: new Date().toISOString() });
  }

  logger.debug('cache.lookup', {
    cacheKind: 'artifact-stage',
    cacheKey,
    bucketKey: config.bucketKey,
    scope: 'persistent',
    hit: true,
    versionId: entry.versionId || null,
    sizeBytes: normalizeStorageSize(entry.sizeBytes),
  });

  return {
    objectKey: entry.objectKey,
    objectId: buildObjectId(entry.bucketKey, entry.objectKey),
    displayName: entry.displayName,
    versionId: entry.versionId || null,
    storageUrn: entry.storageUrn || '',
    sizeBytes: normalizeStorageSize(entry.sizeBytes),
    bytesTransferred: 0,
    partCount: entry.partCount || 1,
    transferMode: entry.transferMode || 'stream',
    downloadTiming: createImmediateTimingFields(),
    uploadTiming: createImmediateTimingFields(),
    downloadDurationMs: 0,
    uploadDurationMs: 0,
    cacheScope: 'persistent',
    cacheKey,
  };
}

async function getResolvedAccItemDownload(projectId, item, token, preferredName) {
  const storageUrn = String(item?.storageUrn || '').trim();
  if (storageUrn) {
    const signed = await getSignedDownloadForStorage(storageUrn, token);
    return {
      displayName: item?.displayName || preferredName || 'input.dwg',
      versionId: item?.versionId || null,
      sizeBytes: normalizeStorageSize(item?.size),
      storageUrn,
      ...signed,
    };
  }

  const download = await getItemDownload(projectId, item?.itemId, token);
  return {
    ...download,
    displayName: preferredName || item?.displayName || download.displayName || 'input.dwg',
    sizeBytes: normalizeStorageSize(item?.size ?? download?.sizeBytes),
    storageUrn: download.storageUrn || storageUrn,
  };
}

async function streamResponseToSignedOss(response, bucketKey, objectKey, token, {
  contentType = 'application/octet-stream',
  region = null,
  expectedSizeBytes = null,
  preferredPartSizeBytes = DIRECT_STREAM_PART_SIZE_BYTES,
  uploadConcurrency = DIRECT_STREAM_UPLOAD_CONCURRENCY,
  unavailableMessage = 'The remote file stream is unavailable for direct transfer.',
} = {}) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw httpError(500, unavailableMessage);
  }

  const normalizedExpectedSize = normalizeStorageSize(expectedSizeBytes ?? response.headers.get('content-length'));
  const uploadTuning = resolveUploadTuning(normalizedExpectedSize, {
    preferredPartSizeBytes,
    uploadConcurrency,
  });
  const reader = response.body.getReader();
  const queue = createBufferQueue();
  const uploadState = createSignedUploadState();
  const inFlight = [];
  const useSingleBufferedPart = normalizedExpectedSize && normalizedExpectedSize <= uploadTuning.singlePartLimitBytes;
  const chunkSize = useSingleBufferedPart
    ? normalizedExpectedSize
    : uploadTuning.preferredPartSizeBytes;
  let nextPartNumber = 1;
  const downloadTimingWindow = createTimingWindow();
  let downloadEndedAtMs = downloadTimingWindow.startedAtMs;
  let downloadDurationMs = 0;
  let uploadQueueWaitMs = 0;
  let uploadActiveTransferMs = 0;
  let activeUploadCount = 0;
  let activeUploadWindowStartedAt = null;
  let uploadTimingWindow = null;
  let sizeBytes = 0;
  let partCount = 0;

  function markUploadStarted() {
    if (!uploadTimingWindow) {
      uploadTimingWindow = createTimingWindow();
    }
    if (activeUploadCount === 0) {
      activeUploadWindowStartedAt = getTimingStart();
    }
    activeUploadCount += 1;
  }

  function markUploadFinished() {
    activeUploadCount = Math.max(0, activeUploadCount - 1);
    if (activeUploadCount === 0 && activeUploadWindowStartedAt) {
      uploadActiveTransferMs += getDurationMs(activeUploadWindowStartedAt);
      activeUploadWindowStartedAt = null;
    }
  }

  async function schedulePart(buffer) {
    const queueWaitStartedAt = getTimingStart();
    await waitForInflightCapacity(inFlight, uploadTuning.uploadConcurrency);
    uploadQueueWaitMs += getDurationMs(queueWaitStartedAt);
    const currentPartNumber = nextPartNumber;
    nextPartNumber += 1;
    partCount += 1;
    markUploadStarted();
    trackInflightUpload(inFlight, uploadBufferToSignedOss(buffer, bucketKey, objectKey, token, {
      region,
      uploadState,
      partNumber: currentPartNumber,
    }).finally(() => {
      markUploadFinished();
    }));
  }

  try {
    while (true) {
      const readStartedAt = getTimingStart();
      const { done, value } = await reader.read();
      downloadDurationMs += getDurationMs(readStartedAt);

      if (done) {
        downloadEndedAtMs = Date.now();
        break;
      }

      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      sizeBytes += chunk.length;
      pushBufferQueue(queue, chunk);

      while (queue.size >= chunkSize) {
        await schedulePart(shiftBufferQueue(queue, chunkSize));
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore if the stream was already released.
    }
  }

  if (queue.size > 0) {
    await schedulePart(shiftBufferQueue(queue));
  }

  await Promise.all(inFlight);

  if (!sizeBytes || !uploadState.uploadKey) {
    throw httpError(400, 'Cannot upload an empty file.');
  }

  await completeSignedUpload(bucketKey, objectKey, uploadState.uploadKey, token, { contentType, region });
  const downloadTiming = buildTimingFields(downloadTimingWindow, {
    endedAtMs: downloadEndedAtMs,
    activeTransferMs: downloadDurationMs,
    activeWorkMs: 0,
    criticalPathMs: downloadDurationMs,
    timingKind: 'transfer',
  });
  const uploadTiming = uploadTimingWindow
    ? buildTimingFields(uploadTimingWindow, {
        queueWaitMs: uploadQueueWaitMs,
        activeTransferMs: uploadActiveTransferMs,
        timingKind: 'transfer',
      })
    : createImmediateTimingFields();

  return {
    sizeBytes,
    expectedSizeBytes: normalizedExpectedSize,
    partCount,
    downloadTiming,
    uploadTiming,
    downloadDurationMs: downloadTiming.criticalPathMs,
    uploadDurationMs: uploadTiming.criticalPathMs,
  };
}

async function streamUrlToSignedOss(sourceUrl, bucketKey, objectKey, token, {
  expectedSizeBytes = null,
  contentType = 'application/octet-stream',
  region = null,
  preferredPartSizeBytes = DIRECT_STREAM_PART_SIZE_BYTES,
  uploadConcurrency = DIRECT_STREAM_UPLOAD_CONCURRENCY,
  fallbackPrefix = 'input',
  fallbackName = 'file.dwg',
  unavailableMessage = 'The remote file stream is unavailable for direct transfer.',
} = {}) {
  const response = await fetchWithTimeout(sourceUrl, {}, { timeoutMs: REMOTE_FETCH_TIMEOUT_MS, context: 'Could not stream the requested file' });
  await assertOk(response, 'Could not stream the requested file');

  try {
    return {
      ...(await streamResponseToSignedOss(response, bucketKey, objectKey, token, {
        contentType,
        region,
        expectedSizeBytes,
        preferredPartSizeBytes,
        uploadConcurrency,
        unavailableMessage,
      })),
      transferMode: 'stream',
    };
  } catch (error) {
    if (error?.status !== 500 || !String(error?.message || '').includes(unavailableMessage)) {
      throw error;
    }

    const fallbackPath = buildTempFilePath(fallbackPrefix, fallbackName);
    try {
      const downloadTimingWindow = createTimingWindow();
      await downloadUrlToTempFile(sourceUrl, fallbackPath);
      const downloadEndedAtMs = Date.now();
      const fileStat = await fsp.stat(fallbackPath);
      const uploadMetrics = await uploadFileToSignedOss(fallbackPath, bucketKey, objectKey, token, {
        contentType,
        region,
        partSizeBytes: preferredPartSizeBytes,
        uploadConcurrency,
      });
      const downloadTiming = buildTimingFields(downloadTimingWindow, { endedAtMs: downloadEndedAtMs });
      return {
        sizeBytes: fileStat.size,
        expectedSizeBytes: normalizeStorageSize(expectedSizeBytes ?? fileStat.size),
        partCount: uploadMetrics.partCount,
        downloadTiming,
        uploadTiming: uploadMetrics.uploadTiming,
        downloadDurationMs: downloadTiming.criticalPathMs,
        uploadDurationMs: uploadMetrics.uploadDurationMs,
        transferMode: 'temp-file',
      };
    } finally {
      await safeUnlink(fallbackPath);
    }
  }
}

async function streamDownloadToSignedOss(download, bucketKey, objectKey, token, {
  contentType = 'application/octet-stream',
  region = null,
  preferredPartSizeBytes = DIRECT_STREAM_PART_SIZE_BYTES,
  uploadConcurrency = DIRECT_STREAM_UPLOAD_CONCURRENCY,
} = {}) {
  return streamUrlToSignedOss(download.url, bucketKey, objectKey, token, {
    expectedSizeBytes: download?.sizeBytes,
    contentType,
    region,
    preferredPartSizeBytes,
    uploadConcurrency,
    fallbackPrefix: 'input',
    fallbackName: download?.displayName || 'input.dwg',
    unavailableMessage: 'The remote file stream is unavailable for direct ACC to OSS transfer.',
  });
}

async function streamResolvedAccItemToOss(projectId, item, preferredName, execution, resolvedDownload = null) {
  const download = resolvedDownload || await getResolvedAccItemDownload(projectId, item, execution.userToken, preferredName);
  const objectKey = buildSharedAutomationObjectKey(execution, projectId, item, download);
  const metrics = await streamDownloadToSignedOss(download, execution.config.bucketKey, objectKey, execution.automationToken, {
    region: execution.config.ossRegion,
    contentType: 'application/octet-stream',
  });

  return {
    objectKey,
    objectId: buildObjectId(execution.config.bucketKey, objectKey),
    displayName: download.displayName || item?.displayName || preferredName || 'input.dwg',
    versionId: download.versionId || item?.versionId || null,
    storageUrn: download.storageUrn || item?.storageUrn || '',
    sizeBytes: normalizeStorageSize(metrics.expectedSizeBytes ?? metrics.sizeBytes),
    bytesTransferred: metrics.sizeBytes,
    partCount: metrics.partCount,
    transferMode: metrics.transferMode,
    downloadTiming: metrics.downloadTiming || createImmediateTimingFields(),
    uploadTiming: metrics.uploadTiming || createImmediateTimingFields(),
    downloadDurationMs: metrics.downloadDurationMs,
    uploadDurationMs: metrics.uploadDurationMs,
  };
}

async function stageAutomationArtifact(execution, projectId, item, {
  preferredName,
  jobKey,
  cacheStep,
  downloadStep,
  uploadStep,
  logDetails = {},
} = {}) {
  const cacheKey = buildAutomationArtifactCacheKey(projectId, item);
  const executionCacheHit = execution.artifactStageCache.has(cacheKey);
  const waitStartedAt = getTimingStart();

  const staged = await memoizePromise(
    execution.artifactStageCache,
    cacheKey,
    async () => {
      const persistent = await getReusablePersistentArtifact(execution, cacheKey);
      if (persistent) {
        return {
          ...persistent,
          stageDurationMs: 0,
        };
      }

      const persistentStoreKey = buildPersistentArtifactStoreKey(execution.config.bucketKey, cacheKey);
      return shareInFlightPromise(sharedArtifactStageInflight, persistentStoreKey, async () => {
        const existing = await getReusablePersistentArtifact(execution, cacheKey);
        if (existing) {
          return {
            ...existing,
            stageDurationMs: 0,
          };
        }

        const stageStartedAt = getTimingStart();
        const result = await streamResolvedAccItemToOss(projectId, item, preferredName, execution);
        const downloadMetrics = buildTransferMetrics(result.sizeBytes, result.downloadDurationMs);
        const uploadMetrics = buildTransferMetrics(result.sizeBytes, result.uploadDurationMs);

        logAutomationTiming(downloadStep, {
          ...logDetails,
          jobKey,
          cacheHit: false,
          cacheScope: 'none',
          cacheKey,
          transferMode: result.transferMode,
          partCount: result.partCount,
          ...downloadMetrics,
          ...(result.downloadTiming || createImmediateTimingFields()),
          outcome: 'ok',
        });
        logAutomationTiming(uploadStep, {
          ...logDetails,
          jobKey,
          cacheHit: false,
          cacheScope: 'none',
          cacheKey,
          objectKey: result.objectKey,
          bucketKey: execution.config.bucketKey,
          ossRegion: execution.config.ossRegion,
          transferMode: result.transferMode,
          partCount: result.partCount,
          ...uploadMetrics,
          ...(result.uploadTiming || createImmediateTimingFields()),
          outcome: 'ok',
        });

        const stagedResult = {
          ...result,
          cacheScope: 'none',
          cacheKey,
          stageDurationMs: roundDurationMs(getDurationMs(stageStartedAt)),
        };

        await artifactStageStore.upsert({
          bucketKey: execution.config.bucketKey,
          cacheKey,
          objectKey: stagedResult.objectKey,
          displayName: stagedResult.displayName,
          versionId: stagedResult.versionId || null,
          storageUrn: stagedResult.storageUrn || '',
          sizeBytes: stagedResult.sizeBytes || 0,
          partCount: stagedResult.partCount || 1,
          transferMode: stagedResult.transferMode || 'stream',
          createdAt: new Date().toISOString(),
          lastVerifiedAt: new Date().toISOString(),
          projectId,
          itemId: item?.itemId || '',
        });

        return stagedResult;
      });
    },
  );

  const cacheScope = executionCacheHit ? 'batch' : (staged.cacheScope || 'none');
  const cacheHit = cacheScope !== 'none';
  if (cacheHit) {
    logAutomationTiming(cacheStep, {
      ...logDetails,
      jobKey,
      cacheHit: true,
      cacheScope,
      cacheKey,
      objectKey: staged.objectKey,
      bucketKey: execution.config.bucketKey,
      ossRegion: execution.config.ossRegion,
      transferMode: staged.transferMode,
      partCount: staged.partCount || null,
      ...buildTransferMetrics(staged.sizeBytes, 0),
      waitedForSharedStageMs: roundDurationMs(getDurationMs(waitStartedAt)),
      ...createImmediateTimingFields(),
      outcome: 'ok',
    });
  }

  return {
    ...staged,
    cacheHit,
    cacheScope,
  };
}

async function prewarmAutomationBatchArtifacts(execution, projectId, items, { batchId = null } = {}) {
  const candidates = Array.isArray(items) ? items.filter(Boolean) : [];
  const emptyResult = {
    byItemId: new Map(),
    sourceCount: 0,
    targetCount: 0,
    totalSourceBytes: 0,
    totalRefBytes: 0,
  };
  if (!candidates.length) {
    return emptyResult;
  }

  const timingWindow = createTimingWindow();
  const reqLogger = execution?.req?.log || logger;
  const prewarmJobKey = batchId ? `prewarm-${batchId}` : `prewarm-${compactTimestamp()}`;
  reqLogger.info('batch.prewarm.started', {
    batchId,
    projectId,
    itemCount: candidates.length,
    sourceConcurrency: AUTOMATION_BATCH_STAGE_CONCURRENCY,
    referenceConcurrency: AUTOMATION_REFERENCE_STAGE_CONCURRENCY,
    maxInflightBytes: AUTOMATION_BATCH_STAGE_MAX_INFLIGHT_BYTES,
  });

  try {
    const resolvedSources = await mapWithConcurrency(
      candidates,
      Math.max(1, Math.min(8, AUTOMATION_BATCH_STAGE_CONCURRENCY * 2)),
      async (item) => {
        const sourceItem = item?.storageUrn
          ? item
          : await execution.resolveAutomationItem(projectId, item.itemId);
        if (sourceItem?.hidden) {
          return null;
        }
        return sourceItem;
      },
    );

    const uniqueSourceItems = [];
    const sourceItemIds = new Set();
    for (const sourceItem of resolvedSources.filter(Boolean)) {
      const sourceItemId = String(sourceItem?.itemId || '').trim();
      if (!sourceItemId || sourceItemIds.has(sourceItemId)) {
        continue;
      }
      sourceItemIds.add(sourceItemId);
      uniqueSourceItems.push(sourceItem);
    }

    const sourceWarmResults = await mapWithWeightedBudget(
      uniqueSourceItems,
      {
        limit: AUTOMATION_BATCH_STAGE_CONCURRENCY,
        maxWeight: AUTOMATION_BATCH_STAGE_MAX_INFLIGHT_BYTES,
        weightFn: (sourceItem) => normalizeStorageSize(sourceItem?.size) || 0,
      },
      async (sourceItem) => {
        const stagedSource = await stageAutomationArtifact(execution, projectId, sourceItem, {
          preferredName: sourceItem.displayName,
          jobKey: prewarmJobKey,
          cacheStep: 'batch-prewarm-source-cache-hit',
          downloadStep: 'batch-prewarm-source-download',
          uploadStep: 'batch-prewarm-source-oss-upload',
          logDetails: {
            batchId,
            projectId,
            sourceItemId: sourceItem.itemId,
            sourceName: sourceItem.displayName,
          },
        });
        const refGraphResult = await getPreparedAutomationRefGraph(execution, projectId, sourceItem);
        return {
          sourceItem,
          stagedSource,
          refGraph: refGraphResult.graph,
          refGraphCacheHit: refGraphResult.cacheHit,
          refGraphCacheScope: refGraphResult.cacheScope || 'none',
        };
      },
    );

    const targetRowsByItemId = new Map();
    const sourceWarmByItemId = new Map();
    for (const entry of sourceWarmResults.filter(Boolean)) {
      sourceWarmByItemId.set(entry.sourceItem.itemId, entry);
      for (const row of Array.isArray(entry.refGraph?.uniqueRows) ? entry.refGraph.uniqueRows : []) {
        const targetItemId = getResolvableTargetItemId(row);
        if (!targetItemId || targetRowsByItemId.has(targetItemId)) {
          continue;
        }
        targetRowsByItemId.set(targetItemId, row);
      }
    }

    const resolvedTargets = await mapWithConcurrency(
      [...targetRowsByItemId.values()],
      Math.max(1, Math.min(8, AUTOMATION_REFERENCE_STAGE_CONCURRENCY * 2)),
      async (row) => {
        const targetItemId = getResolvableTargetItemId(row);
        if (!targetItemId) {
          return null;
        }
        try {
          const targetItem = await execution.resolveAutomationItem(projectId, targetItemId);
          if (targetItem?.hidden) {
            return null;
          }
          return targetItem;
        } catch (_error) {
          return null;
        }
      },
    );

    const uniqueTargetItems = [];
    const targetItemIds = new Set();
    for (const targetItem of resolvedTargets.filter(Boolean)) {
      const targetItemId = String(targetItem?.itemId || '').trim();
      if (!targetItemId || targetItemIds.has(targetItemId)) {
        continue;
      }
      targetItemIds.add(targetItemId);
      uniqueTargetItems.push(targetItem);
    }

    const targetWarmResults = await mapWithWeightedBudget(
      uniqueTargetItems,
      {
        limit: AUTOMATION_REFERENCE_STAGE_CONCURRENCY,
        maxWeight: AUTOMATION_BATCH_STAGE_MAX_INFLIGHT_BYTES,
        weightFn: (targetItem) => normalizeStorageSize(targetItem?.size) || 0,
      },
      async (targetItem) => {
        const stagedTarget = await stageAutomationArtifact(execution, projectId, targetItem, {
          preferredName: targetItem.displayName,
          jobKey: prewarmJobKey,
          cacheStep: 'batch-prewarm-reference-cache-hit',
          downloadStep: 'batch-prewarm-reference-download',
          uploadStep: 'batch-prewarm-reference-oss-upload',
          logDetails: {
            batchId,
            projectId,
            targetItemId: targetItem.itemId,
            targetName: targetItem.displayName,
          },
        });

        const targetRefGraphResult = await getPreparedAutomationRefGraph(execution, projectId, targetItem)
          .catch(() => null);
        if (targetRefGraphResult?.graph) {
          await persistPreparedAutomationRefGraphForArtifactEntry(
            execution.config.bucketKey,
            stagedTarget.cacheKey,
            targetRefGraphResult.graph,
          );
        }

        return {
          targetItem,
          stagedTarget,
          refGraphCacheHit: Boolean(targetRefGraphResult?.cacheHit),
          refGraphCacheScope: targetRefGraphResult?.cacheScope || 'none',
        };
      },
    );

    const targetWarmByItemId = new Map(targetWarmResults.filter(Boolean).map((entry) => [entry.targetItem.itemId, entry]));
    const byItemId = new Map();
    let totalSourceBytes = 0;
    let totalRefBytes = 0;
    let sourceCacheHits = 0;
    let targetCacheHits = 0;
    let refGraphCacheHits = 0;

    for (const entry of sourceWarmResults.filter(Boolean)) {
      const sourceSizeBytes = normalizeStorageSize(entry.stagedSource?.sizeBytes || entry.sourceItem?.size) || 0;
      const sourceRefRows = Array.isArray(entry.refGraph?.uniqueRows) ? entry.refGraph.uniqueRows : [];
      let refTargetBytesTotal = 0;
      let resolvedTargetCount = 0;
      for (const row of sourceRefRows) {
        const targetItemId = getResolvableTargetItemId(row);
        const targetWarm = targetItemId ? targetWarmByItemId.get(targetItemId) : null;
        if (!targetWarm) {
          continue;
        }
        resolvedTargetCount += 1;
        refTargetBytesTotal += normalizeStorageSize(targetWarm.stagedTarget?.sizeBytes || targetWarm.targetItem?.size) || 0;
      }
      if (entry.stagedSource?.cacheHit) {
        sourceCacheHits += 1;
      }
      if (entry.refGraphCacheHit) {
        refGraphCacheHits += 1;
      }
      totalSourceBytes += sourceSizeBytes;
      totalRefBytes += refTargetBytesTotal;
      byItemId.set(entry.sourceItem.itemId, {
        sourceItem: entry.sourceItem,
        sourceSizeBytes,
        refTargetBytesTotal,
        sizeHintBytes: sourceSizeBytes + refTargetBytesTotal,
        referenceCount: resolvedTargetCount,
        refGraphCacheHit: entry.refGraphCacheHit,
        refGraphCacheScope: entry.refGraphCacheScope,
      });
    }

    for (const targetEntry of targetWarmResults.filter(Boolean)) {
      if (targetEntry.stagedTarget?.cacheHit) {
        targetCacheHits += 1;
      }
    }

    reqLogger.info('batch.prewarm.finished', {
      batchId,
      projectId,
      itemCount: candidates.length,
      sourceCount: uniqueSourceItems.length,
      targetCount: uniqueTargetItems.length,
      totalSourceBytes,
      totalRefBytes,
      sourceCacheHits,
      targetCacheHits,
      refGraphCacheHits,
      ...buildTimingFields(timingWindow),
      outcome: 'ok',
    });

    return {
      byItemId,
      sourceCount: uniqueSourceItems.length,
      targetCount: uniqueTargetItems.length,
      totalSourceBytes,
      totalRefBytes,
    };
  } catch (error) {
    reqLogger.warn('batch.prewarm.failed', {
      batchId,
      projectId,
      itemCount: candidates.length,
      ...buildTimingFields(timingWindow),
      error,
    });
    return emptyResult;
  }
}

async function downloadUrlToTempFile(url, targetPath) {
  const response = await fetchWithTimeout(url, {}, { timeoutMs: REMOTE_FETCH_TIMEOUT_MS, context: 'Could not stream the requested file' });
  await assertOk(response, 'Could not stream the requested file');
  if (!response.body) {
    throw httpError(500, 'The remote file stream is unavailable.');
  }
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(targetPath));
  return targetPath;
}

async function downloadAccItemToTemp(projectId, itemId, token, preferredName) {
  const download = await getItemDownload(projectId, itemId, token);
  const safeName = sanitizeFileName(preferredName || download.displayName || 'input.dwg');
  const tempPath = path.join(TMP_DIR, `${Date.now()}-${crypto.randomUUID()}-${safeName}`);
  await downloadUrlToTempFile(download.url, tempPath);
  return { tempPath, download };
}

async function downloadResolvedAccItemToTemp(projectId, item, token, preferredName) {
  const storageUrn = String(item?.storageUrn || '').trim();
  const download = storageUrn
    ? {
        displayName: item?.displayName || preferredName || 'input.dwg',
        versionId: item?.versionId || null,
        ...(await getSignedDownloadForStorage(storageUrn, token)),
      }
    : await getItemDownload(projectId, item?.itemId, token);

  const safeName = sanitizeFileName(preferredName || item?.displayName || download.displayName || 'input.dwg');
  const tempPath = path.join(TMP_DIR, `${Date.now()}-${crypto.randomUUID()}-${safeName}`);
  await downloadUrlToTempFile(download.url, tempPath);
  return { tempPath, download };
}

async function uploadAccResultAsNewVersionFromUrl(projectId, folderId, itemId, displayName, sourceUrl, sourceSizeBytes, token, { refs = [] } = {}) {
  const storage = await createStorage(projectId, folderId, displayName, token);
  const { bucketKey, objectKey } = parseStorageUrn(storage.id);
  const transfer = await streamUrlToSignedOss(sourceUrl, bucketKey, objectKey, token, {
    expectedSizeBytes: sourceSizeBytes,
    contentType: 'application/octet-stream',
    fallbackPrefix: 'output',
    fallbackName: displayName,
    unavailableMessage: 'The remote file stream is unavailable for direct OSS to ACC transfer.',
  });
  const createVersionTimingWindow = createTimingWindow();
  const version = await retryStorageReady(() => createVersion(projectId, itemId, storage.id, displayName, token, { refs }));
  const createVersionTiming = buildTimingFields(createVersionTimingWindow);
  return {
    storage,
    bucketKey,
    objectKey,
    version,
    createVersionTiming,
    createVersionMs: createVersionTiming.criticalPathMs,
    transfer,
  };
}

async function collectFolderDwgItems(projectId, folderId, token, currentPath = '') {
  const normalizedFolderId = normalizeAccFolderId(folderId, 'ACC folder id');
  const contents = await listFolderEntities(projectId, normalizedFolderId, token);
  const folders = contents.filter(isFolderEntity).sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b)));
  const items = contents
    .filter(isItemEntity)
    .filter((item) => isDwgName(getDisplayName(item)))
    .sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b)));

  const nestedResults = await mapWithConcurrency(folders, 4, async (folder) => {
    const folderName = sanitizeSegment(getDisplayName(folder));
    const nestedPath = currentPath ? path.posix.join(currentPath, folderName) : folderName;
    return collectFolderDwgItems(projectId, folder.id, token, nestedPath);
  });

  const result = nestedResults.flat();
  for (const item of items) {
    const displayName = getDisplayName(item);
    result.push({
      itemId: item.id,
      parentFolderId: normalizedFolderId,
      displayName,
      relativePath: currentPath ? path.posix.join(currentPath, displayName) : displayName,
      lastModifiedTime: item?.attributes?.lastModifiedTime || null,
    });
  }

  return result;
}

async function buildFolderTreeFileSummaries(projectId, folderId, token) {
  const items = await collectFolderDwgItems(projectId, folderId, token);

  return mapWithConcurrency(items, 8, async (item) => {
    let tip = null;
    try {
      tip = await getItemTip(projectId, item.itemId, token);
    } catch {
      tip = null;
    }

    const versionId = tip?.data?.id || null;
    const versionNumber = normalizeVersionNumber(tip?.data?.attributes?.versionNumber)
      ?? parseVersionNumberFromVersionId(versionId);
    const versionLabel = extractVersionLabel(tip?.data) || formatVersionLabel(versionNumber);

    return {
      id: item.itemId,
      itemId: item.itemId,
      kind: 'file',
      name: item.displayName,
      extension: path.extname(item.displayName || '').slice(1).toLowerCase(),
      relativePath: item.relativePath,
      parentFolderId: item.parentFolderId,
      lastModifiedTime: tip?.data?.attributes?.lastModifiedTime || item.lastModifiedTime || null,
      size: normalizeStorageSize(tip?.data?.attributes?.storageSize ?? tip?.data?.attributes?.size),
      versionId,
      versionNumber,
      versionLabel,
      sourceVersionLabel: versionLabel,
      pathInProject: normalizePathInProject(tip?.data),
      webViewUrl: cleanUrl(tip?.data?.links?.webView?.href) || '',
    };
  });
}

function setupStateKey(clientId) {
  return clientId || '_default';
}

function isPlainObjectRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function readSetupStatesRecord() {
  const parsed = await readJsonFile(SETUP_STATES_FILE, {});
  if (isPlainObjectRecord(parsed)) {
    return parsed;
  }
  logger.warn('setup-state.invalid-root', {
    file: path.basename(SETUP_STATES_FILE),
    detectedType: Array.isArray(parsed) ? 'array' : typeof parsed,
    expectedType: 'object keyed by APS client ID',
  });
  return {};
}

async function getSetupStateForClient(clientId) {
  if (!clientId) {
    return null;
  }
  const states = await readSetupStatesRecord();
  return states[setupStateKey(clientId)] || null;
}

async function setSetupStateForClient(clientId, state) {
  if (!clientId) {
    return;
  }
  const states = await readSetupStatesRecord();
  states[setupStateKey(clientId)] = state;
  await writeJsonFile(SETUP_STATES_FILE, states);
}

async function getHealthSetupStateForClient(clientId) {
  if (!clientId) {
    return null;
  }
  const states = await readSetupStatesRecord();
  return states[setupStateKey(clientId)]?.health || null;
}

async function setHealthSetupStateForClient(clientId, state) {
  if (!clientId) {
    return;
  }
  const states = await readSetupStatesRecord();
  const key = setupStateKey(clientId);
  states[key] = {
    ...(states[key] || {}),
    health: state,
  };
  await writeJsonFile(SETUP_STATES_FILE, states);
}

async function getScriptOverrideSummary(config) {
  const exists = await pathExists(SCRIPT_OVERRIDE_FILE);
  if (!exists) {
    return {
      exists: false,
      originalName: null,
      storedName: path.basename(SCRIPT_OVERRIDE_FILE),
      size: 0,
      uploadedAt: null,
      archivePath: config.bundleScriptArchivePath,
    };
  }

  const meta = await readJsonFile(SCRIPT_META_FILE, {});
  const stat = await fsp.stat(SCRIPT_OVERRIDE_FILE);
  return {
    exists: true,
    originalName: meta.originalName || 'RunMe.scr',
    storedName: path.basename(SCRIPT_OVERRIDE_FILE),
    size: stat.size,
    uploadedAt: meta.uploadedAt || stat.mtime.toISOString(),
    archivePath: config.bundleScriptArchivePath,
  };
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function prepareBundleForSetup(config) {
  if (!(await pathExists(config.bundleZipPath))) {
    throw httpError(500, `Missing ${config.bundleZipName} in the /bundles folder.`);
  }

  const scriptOverride = await getScriptOverrideSummary(config);
  if (!scriptOverride.exists) {
    return {
      bundleZipPath: config.bundleZipPath,
      bundleHash: await sha256File(config.bundleZipPath),
      scriptOverride,
      cleanup: async () => {},
    };
  }

  const tempZip = path.join(TMP_DIR, `${config.autocadCommand}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.bundle.zip`);
  const zip = new AdmZip(config.bundleZipPath);
  try {
    zip.deleteFile(config.bundleScriptArchivePath);
  } catch {
    // Ignore if the entry does not exist in the source zip.
  }
  const scriptBuffer = await fsp.readFile(SCRIPT_OVERRIDE_FILE);
  zip.addFile(config.bundleScriptArchivePath, scriptBuffer);
  await fsp.writeFile(tempZip, zip.toBuffer());

  return {
    bundleZipPath: tempZip,
    bundleHash: await sha256File(tempZip),
    scriptOverride,
    cleanup: async () => {
      await safeUnlink(tempZip);
    },
  };
}

async function prepareStaticBundleForSetup(bundleZipPath, bundleZipName) {
  if (!(await pathExists(bundleZipPath))) {
    throw httpError(500, `Missing ${bundleZipName} in the /bundles folder.`);
  }

  return {
    bundleZipPath,
    bundleHash: await sha256File(bundleZipPath),
    cleanup: async () => {},
  };
}


function buildHealthAutomationScript(healthConfig) {
  const command = sanitizeSegment(healthConfig?.command || 'ISHEALTHY') || 'ISHEALTHY';
  return `${command}\n`;
}

function deriveSeriesFromAutomationEngine(engine, fallback = 'R26.0') {
  const value = cleanEnv(engine);
  if (!value) {
    return fallback;
  }
  const match = /^Autodesk\.(?:AutoCAD|Civil3D)\+(\d+)_(\d+)$/i.exec(value);
  if (!match) {
    return fallback;
  }
  return `R${Number.parseInt(match[1], 10)}.${Number.parseInt(match[2], 10)}`;
}

function patchHealthBundlePackageContentsXml(xmlText, engine) {
  const series = deriveSeriesFromAutomationEngine(engine, 'R26.0');
  let xml = String(xmlText || '');
  if (!xml.trim()) {
    throw httpError(500, 'The health bundle PackageContents.xml is empty.');
  }

  if (!/AutodeskProduct\s*=/.test(xml)) {
    xml = xml.replace(/<ApplicationPackage\b/, '<ApplicationPackage\n  AutodeskProduct="AutoCAD"');
  }

  xml = xml.replace(/Platform="Civil3D"/gi, 'Platform="AutoCAD*"');
  xml = xml.replace(/SeriesMin="R[^"]+"/gi, `SeriesMin="${series}"`);
  xml = xml.replace(/SeriesMax="R[^"]+"/gi, `SeriesMax="${series}"`);
  xml = xml.replace(/LoadOnCommandInvocation="True"/gi, 'LoadReasons="LoadOnCommandInvocation"');

  if (!/LoadOnAutoCADStartup\s*=/.test(xml)) {
    xml = xml.replace(/<ComponentEntry\b/, '<ComponentEntry\n      LoadOnAutoCADStartup="False"');
  }

  return xml;
}

async function prepareHealthBundleForSetup(healthConfig, engine) {
  const bundleZipPath = healthConfig?.bundleZipPath;
  const bundleZipName = healthConfig?.bundleZipName || path.basename(bundleZipPath || 'isHealthy.bundle.zip');
  if (!(await pathExists(bundleZipPath))) {
    throw httpError(500, `Missing ${bundleZipName} in the /bundles folder.`);
  }

  const zip = new AdmZip(bundleZipPath);
  const packageEntry = zip.getEntries().find((entry) => /(^|\/)PackageContents\.xml$/i.test(String(entry.entryName || '')));
  if (!packageEntry) {
    throw httpError(500, `Could not find PackageContents.xml inside ${bundleZipName}.`);
  }

  const originalXml = zip.readFile(packageEntry)?.toString('utf8') || '';
  const patchedXml = patchHealthBundlePackageContentsXml(originalXml, engine);
  const tempZip = path.join(TMP_DIR, `${sanitizeSegment(healthConfig?.appBundleId || 'isHealthyAppBundle') || 'isHealthyAppBundle'}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.bundle.zip`);
  zip.updateFile(packageEntry.entryName, Buffer.from(patchedXml, 'utf8'));
  await fsp.writeFile(tempZip, zip.toBuffer());

  return {
    bundleZipPath: tempZip,
    bundleHash: await sha256File(tempZip),
    packageXmlPatched: patchedXml !== originalXml,
    cleanup: async () => {
      await safeUnlink(tempZip);
    },
  };
}

async function getHealthBundleDllAsset(healthConfig) {
  const bundleZipPath = healthConfig?.bundleZipPath;
  if (!bundleZipPath) {
    throw httpError(500, 'The health bundle ZIP path is not configured.');
  }

  const stat = await fsp.stat(bundleZipPath).catch(() => null);
  if (!stat) {
    throw httpError(500, `Missing ${healthConfig.bundleZipName || path.basename(bundleZipPath)} in the /bundles folder.`);
  }

  const cacheKey = `${bundleZipPath}:${stat.size}:${Math.round(stat.mtimeMs)}`;
  const cached = healthBundleDllCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const zip = new AdmZip(bundleZipPath);
  const preferredName = String(healthConfig?.bundleDllName || 'isHealthy.dll').trim().toLowerCase();
  const dllEntry = zip.getEntries().find((entry) => {
    const baseName = path.posix.basename(String(entry.entryName || '')).trim().toLowerCase();
    return baseName === preferredName || baseName.endsWith('.dll');
  });

  if (!dllEntry) {
    throw httpError(500, `Could not find ${healthConfig?.bundleDllName || 'the health plugin DLL'} inside ${healthConfig.bundleZipName || path.basename(bundleZipPath)}.`);
  }

  const dllBuffer = zip.readFile(dllEntry);
  if (!dllBuffer?.length) {
    throw httpError(500, `The health plugin DLL inside ${healthConfig.bundleZipName || path.basename(bundleZipPath)} is empty.`);
  }

  const asset = {
    dllName: sanitizeFileName(path.posix.basename(dllEntry.entryName)) || 'isHealthy.dll',
    dllBuffer,
    dllHash: crypto.createHash('sha256').update(dllBuffer).digest('hex'),
  };
  healthBundleDllCache.set(cacheKey, asset);
  return asset;
}

async function stageHealthPluginDll(execution) {
  if (execution.healthPluginDll) {
    return execution.healthPluginDll;
  }

  const asset = await getHealthBundleDllAsset(execution.healthConfig);
  const objectKey = `jobs/${execution.executionKey}/health/plugin/${sanitizeFileName(asset.dllName)}`;
  const uploadState = createSignedUploadState();
  await uploadBufferToSignedOss(asset.dllBuffer, execution.config.bucketKey, objectKey, execution.automationToken, {
    region: execution.config.ossRegion,
    uploadState,
    partNumber: 1,
  });
  if (!uploadState.uploadKey) {
    throw httpError(500, 'Could not upload the health plugin DLL to OSS.');
  }
  await completeSignedUpload(execution.config.bucketKey, objectKey, uploadState.uploadKey, execution.automationToken, {
    region: execution.config.ossRegion,
    contentType: 'application/octet-stream',
  });

  execution.healthPluginDll = {
    objectKey,
    objectId: buildObjectId(execution.config.bucketKey, objectKey),
    localName: asset.dllName,
    dllHash: asset.dllHash,
  };
  return execution.healthPluginDll;
}

function buildObjectId(bucketKey, objectKey) {
  return `urn:adsk.objects:os.object:${encodeURIComponent(bucketKey)}/${encodeURIComponent(objectKey)}`;
}

function buildQualifiedResourceId(config, localId, alias = config.alias) {
  const owner = config.nickname || config.clientId;
  return owner ? `${owner}.${localId}+${alias}` : `${localId}+${alias}`;
}

function extractQualifiedOwner(qualifiedId) {
  if (!qualifiedId || typeof qualifiedId !== 'string') {
    return null;
  }
  const index = qualifiedId.indexOf('.');
  return index > 0 ? qualifiedId.slice(0, index) : null;
}

async function listAutomationItems(config, resourcePath, token) {
  const items = [];
  let pageToken = null;

  while (true) {
    const suffix = pageToken ? `?page=${encodeURIComponent(pageToken)}` : '';
    const payload = await apsJson(`${config.automationBase}${resourcePath}${suffix}`, {
      token,
      context: `Could not list Automation resources for ${resourcePath}`,
    });
    items.push(...(Array.isArray(payload.data) ? payload.data : []));
    if (!payload.paginationToken) {
      break;
    }
    pageToken = payload.paginationToken;
  }

  return items;
}

async function resolveQualifiedAutomationItem(config, resourcePath, localId, alias, token) {
  const items = await listAutomationItems(config, resourcePath, token);
  const suffix = `.${localId}+${alias}`;
  const matches = items.filter((item) => typeof item === 'string' && item.endsWith(suffix));
  if (!matches.length) {
    return null;
  }

  for (const preferredOwner of [config.nickname, config.clientId]) {
    if (!preferredOwner) {
      continue;
    }
    const preferred = matches.find((item) => item.startsWith(`${preferredOwner}.`));
    if (preferred) {
      return preferred;
    }
  }

  return matches[0];
}

async function createOrUpdateAutomationAlias(config, resourcePath, localId, alias, version, token, label) {
  const createAliasPath = `${config.automationBase}${resourcePath}/${encodeURIComponent(localId)}/aliases`;
  try {
    await apsJson(createAliasPath, {
      method: 'POST',
      token,
      body: { id: alias, version },
      expectedStatus: [200, 201],
      context: `Could not create the ${label} alias`,
    });
    return 'created';
  } catch (error) {
    if (error.status !== 409) {
      throw error;
    }
  }

  await apsJson(`${createAliasPath}/${encodeURIComponent(alias)}`, {
    method: 'PATCH',
    token,
    body: { version },
    expectedStatus: [200, 201],
    context: `Could not update the ${label} alias`,
  });
  return 'updated';
}

async function uploadAppBundleZip(uploadParameters, filePath) {
  if (!uploadParameters?.endpointURL || !uploadParameters?.formData) {
    throw httpError(500, 'APS did not return upload parameters for the AppBundle ZIP.');
  }

  const form = new FormData();
  for (const [key, value] of Object.entries(uploadParameters.formData)) {
    form.append(key, value);
  }
  const blob = await fs.openAsBlob(filePath);
  form.append('file', blob, path.basename(filePath));

  const response = await fetch(uploadParameters.endpointURL, {
    method: 'POST',
    body: form,
  });
  await assertOk(response, 'Failed to upload the AppBundle ZIP');
}

async function ensureBucketExists(bucketKey, token, region) {
  const response = await fetch(`${APS_HOST}/oss/v2/buckets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-ads-region': region,
    },
    body: JSON.stringify({ bucketKey, policyKey: 'transient' }),
  });

  if (response.status === 409) {
    return;
  }
  await assertOk(response, 'Failed to create the OSS bucket');
}

async function ensureAppBundle(config, token, engine, bundleHash, setupState, bundleZipPath) {
  const resolvedAlias = await resolveQualifiedAutomationItem(config, '/appbundles', config.appBundleId, config.alias, token);
  let qualifiedAlias = resolvedAlias || setupState?.appBundleQualifiedId || null;
  const aliasExists = Boolean(resolvedAlias);

  if (aliasExists && setupState?.bundleHash === bundleHash && setupState?.engine === engine) {
    return {
      id: qualifiedAlias,
      action: 'reused',
      reason: 'Bundle hash and engine match the last configured version.',
    };
  }

  let response;
  let action = 'updated';

  if (!aliasExists) {
    try {
      response = await apsJson(`${config.automationBase}/appbundles`, {
        method: 'POST',
        token,
        body: {
          package: config.appBundleId,
          engine,
          id: config.appBundleId,
          description: `AppBundle for ${config.appBundleId}`,
        },
        expectedStatus: [200, 201],
        context: 'Could not create the AppBundle',
      });
      action = 'created';
    } catch (error) {
      if (error.status !== 409) {
        throw error;
      }
    }
  }

  if (!response) {
    response = await apsJson(`${config.automationBase}/appbundles/${encodeURIComponent(config.appBundleId)}/versions`, {
      method: 'POST',
      token,
      body: {
        engine,
        description: aliasExists ? `Updated ${config.appBundleId}` : `Recovered ${config.appBundleId}`,
      },
      expectedStatus: [200, 201],
      context: 'Could not create the next AppBundle version',
    });
    action = aliasExists ? 'updated' : 'recovered';
  }

  await createOrUpdateAutomationAlias(config, '/appbundles', config.appBundleId, config.alias, response.version || 1, token, 'AppBundle');
  await uploadAppBundleZip(response.uploadParameters, bundleZipPath);

  qualifiedAlias = await resolveQualifiedAutomationItem(config, '/appbundles', config.appBundleId, config.alias, token)
    || buildQualifiedResourceId(config, config.appBundleId, config.alias);

  return {
    id: qualifiedAlias,
    action,
    version: response.version || 1,
  };
}

async function ensureActivity(config, token, engine, setupState) {
  const resolvedAlias = await resolveQualifiedAutomationItem(config, '/activities', config.activityId, config.alias, token);
  let qualifiedAlias = resolvedAlias || setupState?.activityQualifiedId || null;
  const aliasExists = Boolean(resolvedAlias);

  const appBundleQualifiedId = await resolveQualifiedAutomationItem(config, '/appbundles', config.appBundleId, config.alias, token)
    || setupState?.appBundleQualifiedId
    || buildQualifiedResourceId(config, config.appBundleId, config.alias);

  const spec = {
    engine,
    appbundles: [appBundleQualifiedId],
    commandLine: [
      `$(engine.path)\\accoreconsole.exe /i "$(args[inputFile].path)" /al "$(appbundles[${config.appBundleId}].path)" /s "$(settings[script].path)" /suppressGraphics`,
    ],
    parameters: {
      inputFile: {
        verb: 'get',
        description: 'Input DWG file',
        required: true,
        localName: 'input.dwg',
      },
      outputFile: {
        verb: 'put',
        description: 'Processed DWG file',
        required: true,
        localName: 'output.dwg',
      },
    },
    settings: {
      script: {
        value: `${config.autocadCommand}\n`,
      },
    },
    description: `Run ${config.autocadCommand} from ${config.appBundleId}`,
  };

  if (!aliasExists) {
    try {
      await apsJson(`${config.automationBase}/activities`, {
        method: 'POST',
        token,
        body: { id: config.activityId, ...spec },
        expectedStatus: [200, 201],
        context: 'Could not create the Activity',
      });

      await createOrUpdateAutomationAlias(config, '/activities', config.activityId, config.alias, 1, token, 'Activity');

      qualifiedAlias = await resolveQualifiedAutomationItem(config, '/activities', config.activityId, config.alias, token)
        || buildQualifiedResourceId(config, config.activityId, config.alias);

      return {
        id: qualifiedAlias,
        action: 'created',
        version: 1,
      };
    } catch (error) {
      if (error.status !== 409) {
        throw error;
      }
    }

    const recovered = await apsJson(`${config.automationBase}/activities/${encodeURIComponent(config.activityId)}/versions`, {
      method: 'POST',
      token,
      body: spec,
      expectedStatus: [200, 201],
      context: 'Could not create the next Activity version',
    });

    await createOrUpdateAutomationAlias(config, '/activities', config.activityId, config.alias, recovered.version, token, 'Activity');

    qualifiedAlias = await resolveQualifiedAutomationItem(config, '/activities', config.activityId, config.alias, token)
      || buildQualifiedResourceId(config, config.activityId, config.alias);

    return {
      id: qualifiedAlias,
      action: 'recovered',
      version: recovered.version,
    };
  }

  if ((setupState?.engine && setupState.engine !== engine) || setupState?.revision !== AUTOMATION_SETUP_REVISION) {
    const response = await apsJson(`${config.automationBase}/activities/${encodeURIComponent(config.activityId)}/versions`, {
      method: 'POST',
      token,
      body: spec,
      expectedStatus: [200, 201],
      context: 'Could not create the next Activity version',
    });

    await createOrUpdateAutomationAlias(config, '/activities', config.activityId, config.alias, response.version, token, 'Activity');

    qualifiedAlias = await resolveQualifiedAutomationItem(config, '/activities', config.activityId, config.alias, token)
      || buildQualifiedResourceId(config, config.activityId, config.alias);

    return {
      id: qualifiedAlias,
      action: 'updated',
      version: response.version,
    };
  }

  return {
    id: qualifiedAlias,
    action: 'reused',
    reason: 'Existing activity alias already points to a compatible definition.',
  };
}

async function configureAutomationResources(req, requestedEngine) {
  const config = getRuntimeConfig(req);
  assertCredentialsConfigured(config);
  const token = await ensureAutomationToken(req);
  const engine = cleanEnv(requestedEngine) || config.defaultEngine;
  const existingSetup = await getSetupStateForClient(config.clientId) || {};
  const preparedBundle = await prepareBundleForSetup(config);

  try {
    await ensureBucketExists(config.bucketKey, token, config.ossRegion);
    const bundleResult = await ensureAppBundle(config, token, engine, preparedBundle.bundleHash, existingSetup, preparedBundle.bundleZipPath);
    const activityResult = await ensureActivity(config, token, engine, existingSetup);
    const nextSetup = {
      engine,
      bundleHash: preparedBundle.bundleHash,
      appBundleQualifiedId: bundleResult.id,
      activityQualifiedId: activityResult.id,
      ownerId: extractQualifiedOwner(activityResult.id) || extractQualifiedOwner(bundleResult.id) || config.nickname || config.clientId || null,
      bundleMode: preparedBundle.scriptOverride.exists ? 'custom-script-override' : 'original-bundle',
      scriptOverride: preparedBundle.scriptOverride.exists
        ? {
            originalName: preparedBundle.scriptOverride.originalName,
            storedName: preparedBundle.scriptOverride.storedName,
            uploadedAt: preparedBundle.scriptOverride.uploadedAt,
          }
        : null,
      revision: AUTOMATION_SETUP_REVISION,
      lastConfiguredAt: new Date().toISOString(),
    };
    await setSetupStateForClient(config.clientId, nextSetup);

    return {
      message: 'Automation resources are ready.',
      engine,
      bucketKey: config.bucketKey,
      bundleMode: nextSetup.bundleMode,
      scriptOverride: preparedBundle.scriptOverride,
      appBundle: bundleResult,
      activity: activityResult,
      setupState: nextSetup,
    };
  } finally {
    await preparedBundle.cleanup();
  }
}

async function ensureHealthAppBundle(config, healthConfig, token, engine, bundleHash, setupState, bundleZipPath) {
  const resolvedAlias = await resolveQualifiedAutomationItem(config, '/appbundles', healthConfig.appBundleId, healthConfig.alias, token);
  let qualifiedAlias = resolvedAlias || setupState?.appBundleQualifiedId || null;
  const aliasExists = Boolean(resolvedAlias);

  if (aliasExists && setupState?.bundleHash === bundleHash && setupState?.engine === engine) {
    return {
      id: qualifiedAlias,
      action: 'reused',
      reason: 'Health bundle hash and engine match the last configured version.',
    };
  }

  let response;
  let action = 'updated';

  if (!aliasExists) {
    try {
      response = await apsJson(`${config.automationBase}/appbundles`, {
        method: 'POST',
        token,
        body: {
          package: healthConfig.appBundleId,
          engine,
          id: healthConfig.appBundleId,
          description: `AppBundle for ${healthConfig.appBundleId}`,
        },
        expectedStatus: [200, 201],
        context: 'Could not create the health AppBundle',
      });
      action = 'created';
    } catch (error) {
      if (error.status !== 409) {
        throw error;
      }
    }
  }

  if (!response) {
    response = await apsJson(`${config.automationBase}/appbundles/${encodeURIComponent(healthConfig.appBundleId)}/versions`, {
      method: 'POST',
      token,
      body: {
        engine,
        description: aliasExists ? `Updated ${healthConfig.appBundleId}` : `Recovered ${healthConfig.appBundleId}`,
      },
      expectedStatus: [200, 201],
      context: 'Could not create the next health AppBundle version',
    });
    action = aliasExists ? 'updated' : 'recovered';
  }

  await createOrUpdateAutomationAlias(config, '/appbundles', healthConfig.appBundleId, healthConfig.alias, response.version || 1, token, 'Health AppBundle');
  await uploadAppBundleZip(response.uploadParameters, bundleZipPath);

  qualifiedAlias = await resolveQualifiedAutomationItem(config, '/appbundles', healthConfig.appBundleId, healthConfig.alias, token)
    || buildQualifiedResourceId(config, healthConfig.appBundleId, healthConfig.alias);

  return {
    id: qualifiedAlias,
    action,
    version: response.version || 1,
  };
}

async function ensureHealthActivity(config, healthConfig, token, engine, setupState) {
  const resolvedAlias = await resolveQualifiedAutomationItem(config, '/activities', healthConfig.activityId, healthConfig.alias, token);
  let qualifiedAlias = resolvedAlias || setupState?.activityQualifiedId || null;
  const aliasExists = Boolean(resolvedAlias);

  const appBundleQualifiedId = await resolveQualifiedAutomationItem(config, '/appbundles', healthConfig.appBundleId, healthConfig.alias, token)
    || setupState?.appBundleQualifiedId
    || buildQualifiedResourceId(config, healthConfig.appBundleId, healthConfig.alias);

  const spec = {
    engine,
    appbundles: [appBundleQualifiedId],
    commandLine: [
      `$(engine.path)\\accoreconsole.exe /i "$(args[inputFile].path)" /al "$(appbundles[${healthConfig.appBundleId}].path)" /s "$(settings[script].path)" /suppressGraphics`,
    ],
    parameters: {
      inputFile: {
        verb: 'get',
        description: 'Input DWG file',
        required: true,
        localName: 'input.dwg',
      },
      outputJson: {
        verb: 'put',
        description: 'Drawing health JSON report',
        required: true,
        localName: 'health-output.json',
      },
    },
    settings: {
      script: {
        value: buildHealthAutomationScript(healthConfig),
      },
    },
    description: `Run ${healthConfig.command} from ${healthConfig.appBundleId}`,
  };

  if (!aliasExists) {
    try {
      await apsJson(`${config.automationBase}/activities`, {
        method: 'POST',
        token,
        body: { id: healthConfig.activityId, ...spec },
        expectedStatus: [200, 201],
        context: 'Could not create the health Activity',
      });

      await createOrUpdateAutomationAlias(config, '/activities', healthConfig.activityId, healthConfig.alias, 1, token, 'Health Activity');

      qualifiedAlias = await resolveQualifiedAutomationItem(config, '/activities', healthConfig.activityId, healthConfig.alias, token)
        || buildQualifiedResourceId(config, healthConfig.activityId, healthConfig.alias);

      return {
        id: qualifiedAlias,
        action: 'created',
        version: 1,
      };
    } catch (error) {
      if (error.status !== 409) {
        throw error;
      }
    }

    const recovered = await apsJson(`${config.automationBase}/activities/${encodeURIComponent(healthConfig.activityId)}/versions`, {
      method: 'POST',
      token,
      body: spec,
      expectedStatus: [200, 201],
      context: 'Could not create the next health Activity version',
    });

    await createOrUpdateAutomationAlias(config, '/activities', healthConfig.activityId, healthConfig.alias, recovered.version, token, 'Health Activity');

    qualifiedAlias = await resolveQualifiedAutomationItem(config, '/activities', healthConfig.activityId, healthConfig.alias, token)
      || buildQualifiedResourceId(config, healthConfig.activityId, healthConfig.alias);

    return {
      id: qualifiedAlias,
      action: 'recovered',
      version: recovered.version,
    };
  }

  if ((setupState?.engine && setupState.engine !== engine) || setupState?.revision !== HEALTH_AUTOMATION_SETUP_REVISION) {
    const response = await apsJson(`${config.automationBase}/activities/${encodeURIComponent(healthConfig.activityId)}/versions`, {
      method: 'POST',
      token,
      body: spec,
      expectedStatus: [200, 201],
      context: 'Could not create the next health Activity version',
    });

    await createOrUpdateAutomationAlias(config, '/activities', healthConfig.activityId, healthConfig.alias, response.version, token, 'Health Activity');

    qualifiedAlias = await resolveQualifiedAutomationItem(config, '/activities', healthConfig.activityId, healthConfig.alias, token)
      || buildQualifiedResourceId(config, healthConfig.activityId, healthConfig.alias);

    return {
      id: qualifiedAlias,
      action: 'updated',
      version: response.version,
    };
  }

  return {
    id: qualifiedAlias,
    action: 'reused',
    reason: 'Existing health activity alias already points to a compatible definition.',
  };
}

async function configureHealthAutomationResources(req, requestedEngine) {
  const config = getRuntimeConfig(req);
  const healthConfig = getHealthAutomationConfig(config);
  assertCredentialsConfigured(config);
  const token = await ensureAutomationToken(req);
  const engine = normalizeHealthAutomationEngine(cleanEnv(requestedEngine) || healthConfig.defaultEngine, healthConfig.defaultEngine);
  const existingSetup = await getHealthSetupStateForClient(config.clientId) || {};
  const preparedBundle = await prepareHealthBundleForSetup(healthConfig, engine);

  try {
    await ensureBucketExists(config.bucketKey, token, config.ossRegion);
    const bundleResult = await ensureHealthAppBundle(config, healthConfig, token, engine, preparedBundle.bundleHash, existingSetup, preparedBundle.bundleZipPath);
    const activityResult = await ensureHealthActivity(config, healthConfig, token, engine, existingSetup);
    const nextSetup = {
      engine,
      bundleHash: preparedBundle.bundleHash,
      appBundleQualifiedId: bundleResult.id,
      activityQualifiedId: activityResult.id,
      ownerId: extractQualifiedOwner(activityResult.id) || extractQualifiedOwner(bundleResult.id) || config.nickname || config.clientId || null,
      revision: HEALTH_AUTOMATION_SETUP_REVISION,
      lastConfiguredAt: new Date().toISOString(),
      packageXmlPatched: Boolean(preparedBundle.packageXmlPatched),
    };
    await setHealthSetupStateForClient(config.clientId, nextSetup);

    return {
      message: 'Health automation resources are ready.',
      engine,
      appBundleQualifiedId: bundleResult.id,
      activityQualifiedId: activityResult.id,
      bundleZipName: healthConfig.bundleZipName,
      command: healthConfig.command,
      packageXmlPatched: Boolean(preparedBundle.packageXmlPatched),
      setupState: nextSetup,
    };
  } finally {
    await preparedBundle.cleanup();
  }
}

async function ensureHealthAutomationReadyForExecution(req) {
  const config = getRuntimeConfig(req);
  const healthConfig = getHealthAutomationConfig(config);
  assertCredentialsConfigured(config);
  let setupState = await getHealthSetupStateForClient(config.clientId);
  const normalizedSetupEngine = normalizeHealthAutomationEngine(setupState?.engine, healthConfig.defaultEngine);
  const requestedEngine = normalizedSetupEngine || healthConfig.defaultEngine;
  if (setupState?.engine && setupState.engine !== normalizedSetupEngine) {
    setupState = {
      ...setupState,
      engine: normalizedSetupEngine,
      revision: 0,
    };
  }
  if (setupState?.activityQualifiedId && setupState?.appBundleQualifiedId && setupState?.revision === HEALTH_AUTOMATION_SETUP_REVISION) {
    return setupState;
  }
  await configureHealthAutomationResources(req, requestedEngine);
  setupState = await getHealthSetupStateForClient(config.clientId);
  if (!setupState?.activityQualifiedId || !setupState?.appBundleQualifiedId) {
    throw httpError(500, 'Health automation setup did not finish correctly.');
  }
  return setupState;
}

async function ensureAutomationReadyForExecution(req) {
  const config = getRuntimeConfig(req);
  assertCredentialsConfigured(config);
  let setupState = await getSetupStateForClient(config.clientId);
  if (setupState?.activityQualifiedId && setupState?.revision === AUTOMATION_SETUP_REVISION) {
    return setupState;
  }
  await configureAutomationResources(req, setupState?.engine || config.defaultEngine);
  setupState = await getSetupStateForClient(config.clientId);
  if (!setupState?.activityQualifiedId) {
    throw httpError(500, 'Automation setup did not finish correctly.');
  }
  return setupState;
}

async function createAutomationExecutionContext(req) {
  const timingWindow = createTimingWindow();
  const sessionId = req?.sessionID || null;
  const config = getRuntimeConfig(req);
  assertCredentialsConfigured(config);

  let userTokenMs = null;
  let automationTokenMs = null;
  let automationReadyMs = null;
  let bucketReadyMs = null;

  try {
    let stepStartedAt = getTimingStart();
    const userToken = await ensureUserAccessToken(req);
    userTokenMs = roundDurationMs(getDurationMs(stepStartedAt));

    stepStartedAt = getTimingStart();
    const automationToken = await ensureAutomationToken(req);
    automationTokenMs = roundDurationMs(getDurationMs(stepStartedAt));

    stepStartedAt = getTimingStart();
    const setupState = await ensureAutomationReadyForExecution(req);
    automationReadyMs = roundDurationMs(getDurationMs(stepStartedAt));

    stepStartedAt = getTimingStart();
    await ensureBucketExists(config.bucketKey, automationToken, config.ossRegion);
    bucketReadyMs = roundDurationMs(getDurationMs(stepStartedAt));

    const automationItemCache = new Map();
    const itemRefsCache = new Map();
    const artifactStageCache = new Map();
    const executionKey = `${compactTimestamp()}-${crypto.randomUUID().slice(0, 8)}`;

    const context = {
      req,
      config,
      userToken,
      automationToken,
      setupState,
      executionKey,
      artifactStageCache,
      resolveAutomationItem(projectId, itemId) {
        return memoizePromise(
          automationItemCache,
          `${projectId}|${itemId}`,
          () => getResolvedAutomationItem(projectId, itemId, userToken),
        );
      },
      resolveRefs(projectId, itemId) {
        return memoizePromise(
          itemRefsCache,
          `${projectId}|${itemId}`,
          () => resolveItemRefs(projectId, itemId, userToken),
        );
      },
    };

    logAutomationTiming('createAutomationExecutionContext', {
      sessionId,
      bucketKey: config.bucketKey,
      ossRegion: config.ossRegion,
      automationRegion: config.automationRegion,
      userTokenMs,
      automationTokenMs,
      automationReadyMs,
      bucketReadyMs,
      ...buildTimingFields(timingWindow),
      outcome: 'ok',
    });

    return context;
  } catch (error) {
    logAutomationTiming('createAutomationExecutionContext', {
      sessionId,
      bucketKey: config.bucketKey,
      ossRegion: config.ossRegion,
      automationRegion: config.automationRegion,
      userTokenMs,
      automationTokenMs,
      automationReadyMs,
      bucketReadyMs,
      ...buildTimingFields(timingWindow),
      outcome: 'error',
      error: error?.message || 'Unknown error',
    });
    throw error;
  }
}

async function createHealthAutomationExecutionContext(req) {
  const sessionId = req?.sessionID || null;
  const config = getRuntimeConfig(req);
  const healthConfig = getHealthAutomationConfig(config);
  assertCredentialsConfigured(config);

  const userToken = await ensureUserAccessToken(req);
  const automationToken = await ensureAutomationToken(req);
  const setupState = await ensureHealthAutomationReadyForExecution(req);
  await ensureBucketExists(config.bucketKey, automationToken, config.ossRegion);

  const automationItemCache = new Map();
  const itemRefsCache = new Map();
  const artifactStageCache = new Map();
  const executionKey = `health-${compactTimestamp()}-${crypto.randomUUID().slice(0, 8)}`;

  return {
    req,
    sessionId,
    config,
    healthConfig,
    userToken,
    automationToken,
    setupState,
    executionKey,
    artifactStageCache,
    resolveAutomationItem(projectId, itemId) {
      return memoizePromise(
        automationItemCache,
        `${projectId}|${itemId}`,
        () => getResolvedAutomationItem(projectId, itemId, userToken),
      );
    },
    resolveRefs(projectId, itemId) {
      return memoizePromise(
        itemRefsCache,
        `${projectId}|${itemId}`,
        () => resolveItemRefs(projectId, itemId, userToken),
      );
    },
  };
}


function createEmptyPreparedAutomationReferences(sourceItem) {
  const localInfo = normalizeAutomationLocalPath(sourceItem?.relativePath || sourceItem?.displayName, sourceItem?.displayName);
  return {
    referenceInputs: [],
    filteredRefs: [],
    resolvedReferences: [],
    publishRefs: [],
    accVersionRefs: [],
    meta: null,
    hostLocalName: localInfo.localPath || sanitizeFileName(sourceItem?.displayName || 'input.dwg'),
  };
}

function startStagedAutomationInputPreparation(execution, projectId, sourceItem, jobKey, {
  preferredName = sourceItem?.displayName,
  cacheStep = 'source-stage-cache-hit',
  downloadStep = 'source-download',
  uploadStep = 'source-oss-upload',
  logDetails = {},
} = {}) {
  return {
    refsPromise: prepareAutomationReferences(execution, projectId, sourceItem, jobKey),
    stagedSourcePromise: stageAutomationArtifact(execution, projectId, sourceItem, {
      preferredName,
      jobKey,
      cacheStep,
      downloadStep,
      uploadStep,
      logDetails,
    }),
  };
}

async function finishStagedAutomationInputPreparation(execution, projectId, sourceItem, preparation, {
  persistPreparedRefGraph = false,
  allowReferenceFailures = false,
  referenceFailureLogEvent = 'automation.reference-staging.skipped',
} = {}) {
  const stagedSource = await preparation.stagedSourcePromise;
  let stagedRefs = null;
  try {
    stagedRefs = await preparation.refsPromise;
    if (persistPreparedRefGraph) {
      await persistPreparedAutomationRefGraphForSource(execution, projectId, sourceItem, stagedRefs);
    }
  } catch (error) {
    if (!allowReferenceFailures) {
      throw error;
    }
    logger.warn(referenceFailureLogEvent, {
      sourceItemName: sourceItem?.displayName || sourceItem?.itemId || 'drawing',
      error: error?.message || error,
    });
    stagedRefs = createEmptyPreparedAutomationReferences(sourceItem);
  }
  return { stagedSource, stagedRefs };
}

async function finalizeRefCanvasHealthSubmissionForSession(req, sessionId, projectId, itemId, execution, submission) {
  const workItemStatus = await pollRefCanvasHealthWorkItem(execution, submission.workItemId);
  const normalizedStatus = String(workItemStatus?.status || '').trim().toLowerCase();

  if (normalizedStatus !== 'success') {
    const failureMessage = normalizedStatus === 'timeout'
      ? 'The health automation work item timed out.'
      : 'The health automation work item did not finish successfully.';
    const failedEntry = await patchStoredRefCanvasHealthEntryIfPresent(req, sessionId, projectId, itemId, () => ({
      projectId,
      itemId,
      inputFileName: submission.sourceItem.displayName,
      workItemId: submission.workItemId,
      reportUrl: workItemStatus?.reportUrl || submission.reportUrl || null,
      status: normalizedStatus || 'failed',
      error: failureMessage,
      diagnosticLog: buildRefCanvasHealthDiagnosticLog(
        httpError(500, failureMessage, workItemStatus),
        `Health work item ${submission.workItemId || ''} did not complete successfully.`.trim(),
      ),
      updatedAt: new Date().toISOString(),
    }));
    return {
      entry: failedEntry,
      ok: false,
      status: normalizedStatus || 'failed',
    };
  }

  const jsonPayload = await downloadRefCanvasHealthJson(execution.config, execution.automationToken, execution.config.bucketKey, submission.outputObjectKey);
  const summary = extractHealthJsonSummary(jsonPayload);

  const completedEntry = await patchStoredRefCanvasHealthEntryIfPresent(req, sessionId, projectId, itemId, () => ({
    projectId,
    itemId,
    inputFileName: submission.sourceItem.displayName,
    workItemId: submission.workItemId,
    reportUrl: workItemStatus?.reportUrl || submission.reportUrl || null,
    status: 'completed',
    healthReport: summary.healthReport,
    normalizedHealth: summary.normalizedHealth,
    header: summary.header,
    counts: summary.counts,
    json: jsonPayload,
    error: '',
    diagnosticLog: '',
    updatedAt: new Date().toISOString(),
  }));

  return {
    entry: completedEntry,
    ok: true,
    status: 'completed',
  };
}

async function getResolvedAutomationItem(projectId, itemId, token) {
  const cacheKey = `${projectId}|${itemId}`;
  return resolvedAutomationItemCache.getOrCreate(cacheKey, () => resolveAutomationItemFromAccItem(projectId, itemId, token));
}

function buildPreparedAutomationRefGraphCacheKey(projectId, sourceItem) {
  return buildAutomationArtifactCacheKey(projectId, sourceItem);
}

async function buildPreparedAutomationRefGraph(execution, projectId, sourceItem) {
  let stepStartedAt = getTimingStart();
  const sourceResult = await execution.resolveRefs(projectId, sourceItem.itemId);
  const resolveRefsMs = roundDurationMs(getDurationMs(stepStartedAt));
  const candidateRows = getAutomationRefRows(sourceResult.rows);
  const uniqueRows = [];
  const seenTargets = new Set();

  for (const row of candidateRows) {
    const key = getAutomationRefTargetKey(row);
    if (seenTargets.has(key)) {
      continue;
    }
    seenTargets.add(key);
    uniqueRows.push(row);
  }

  const sourceLocalInfo = normalizeAutomationLocalPath(sourceItem.relativePath || sourceItem.displayName, sourceItem.displayName);
  const sourceLocalName = ensureUniqueAutomationLocalPath(sourceLocalInfo.localPath, new Set(), `host:${sourceItem.itemId}`);
  const filteredRefs = uniqueRows.map((row) => ({
    targetItemId: getResolvableTargetItemId(row),
    targetResourceId: row?.targetResourceId || '',
    targetVersionId: String(row?.targetResourceType || '').trim().toLowerCase() === 'versions' ? row.targetResourceId || '' : '',
    targetName: row?.targetName || row?.targetResourceId || '',
    targetPathInProject: row?.targetPathInProject || '',
    nestedType: row?.nestedType || '',
    direction: 'from',
    refExtensionType: row?.refExtensionType || XREF_REF_EXTENSION_TYPE,
  }));

  return {
    retrievedVia: sourceResult.retrievedVia,
    resolveRefsMs,
    candidateRows,
    uniqueRows,
    filteredRefs,
    sourceLocalName: sourceLocalName.localPath,
    sourceHiddenSegmentsRemoved: sourceLocalInfo.hiddenSegmentsRemoved,
  };
}

async function getPreparedAutomationRefGraph(execution, projectId, sourceItem) {
  const cacheKey = buildPreparedAutomationRefGraphCacheKey(projectId, sourceItem);
  const memoryGraph = preparedAutomationRefGraphCache.get(cacheKey);
  if (memoryGraph) {
    logger.debug('cache.lookup', {
      cacheKind: 'ref-graph',
      cacheKey,
      projectId,
      sourceItemId: sourceItem?.itemId || null,
      scope: 'memory',
      hit: true,
    });
    return {
      cacheKey,
      cacheHit: true,
      cacheScope: 'memory',
      graph: await memoryGraph,
    };
  }

  const persistentGraph = await getPersistentPreparedAutomationRefGraph(execution, projectId, sourceItem);
  if (persistentGraph?.graph) {
    const graph = await preparedAutomationRefGraphCache.getOrCreate(cacheKey, () => persistentGraph.graph);
    logger.debug('cache.lookup', {
      cacheKind: 'ref-graph',
      cacheKey,
      projectId,
      sourceItemId: sourceItem?.itemId || null,
      scope: 'persistent',
      hit: true,
    });
    return {
      cacheKey,
      cacheHit: true,
      cacheScope: 'persistent',
      graph,
    };
  }

  const graph = await preparedAutomationRefGraphCache.getOrCreate(
    cacheKey,
    async () => {
      const computedGraph = await buildPreparedAutomationRefGraph(execution, projectId, sourceItem);
      await persistPreparedAutomationRefGraphForArtifactEntry(execution.config.bucketKey, cacheKey, computedGraph);
      return computedGraph;
    },
  );
  logger.debug('cache.lookup', {
    cacheKind: 'ref-graph',
    cacheKey,
    projectId,
    sourceItemId: sourceItem?.itemId || null,
    scope: 'none',
    hit: false,
  });
  return { cacheKey, cacheHit: false, cacheScope: 'none', graph };
}

async function resolveAutomationItemFromAccItem(projectId, itemId, token) {
  const normalizedProjectId = String(projectId || '').trim();
  const normalizedItemId = String(itemId || '').trim();
  if (!normalizedProjectId || !normalizedItemId) {
    throw httpError(400, 'A projectId and itemId are required to resolve an ACC automation target.');
  }

  const [itemEntity, tipPayload] = await Promise.all([
    getItemEntity(normalizedProjectId, normalizedItemId, token),
    getItemTip(normalizedProjectId, normalizedItemId, token).catch(() => null),
  ]);

  const displayName = tipPayload?.data?.attributes?.displayName
    || tipPayload?.data?.attributes?.name
    || getDisplayName(itemEntity)
    || normalizedItemId;

  if (!isDwgName(displayName)) {
    throw httpError(400, `${displayName} is not a DWG file.`);
  }

  const parentFolderId = itemEntity?.relationships?.parent?.data?.id || null;
  if (!parentFolderId) {
    throw httpError(500, `The ACC item ${displayName} does not expose a parent folder relationship.`);
  }

  const normalizedPathInProject = normalizePathInProject(tipPayload?.data || itemEntity);

  let relativePathInfo;
  if (normalizedPathInProject) {
    const preferredPathValue = path.posix.extname(normalizedPathInProject)
      ? normalizedPathInProject
      : path.posix.join(normalizedPathInProject, displayName);
    const preferredLocalInfo = normalizeAutomationLocalPath(preferredPathValue, displayName);
    relativePathInfo = {
      relativePath: sanitizeDisplayPath(preferredLocalInfo.localPath, displayName),
      hiddenSegmentsRemoved: preferredLocalInfo.hiddenSegmentsRemoved,
    };
  } else {
    try {
      relativePathInfo = await buildVisibleProjectRelativePath(normalizedProjectId, parentFolderId, displayName, token);
    } catch {
      const fallbackLocalInfo = normalizeAutomationLocalPath(displayName, displayName);
      relativePathInfo = {
        relativePath: sanitizeDisplayPath(fallbackLocalInfo.localPath, displayName),
        hiddenSegmentsRemoved: fallbackLocalInfo.hiddenSegmentsRemoved,
      };
    }
  }

  return {
    itemId: normalizedItemId,
    parentFolderId,
    displayName,
    relativePath: relativePathInfo.relativePath,
    hiddenPathSegmentsRemoved: relativePathInfo.hiddenSegmentsRemoved,
    lastModifiedTime: tipPayload?.data?.attributes?.lastModifiedTime || itemEntity?.attributes?.lastModifiedTime || null,
    versionId: tipPayload?.data?.id || null,
    storageUrn: tipPayload?.data?.relationships?.storage?.data?.id || '',
    size: normalizeStorageSize(
      tipPayload?.data?.attributes?.storageSize
      ?? tipPayload?.data?.attributes?.size
      ?? itemEntity?.attributes?.storageSize
      ?? itemEntity?.attributes?.size
    ),
    webViewUrl: getPreferredDrawingWebUrl(itemEntity, tipPayload) || '',
    hidden: Boolean(tipPayload?.data?.attributes?.hidden || itemEntity?.attributes?.hidden),
  };
}

async function prepareAutomationReferences(execution, projectId, sourceItem, jobKey) {
  const timingWindow = createTimingWindow();
  const sourceName = sourceItem?.displayName || sourceItem?.itemId || 'source';
  const timing = {
    refGraphCacheHit: false,
    refGraphCacheScope: 'none',
    refGraphLookupMs: 0,
    resolveRefsMs: null,
    resolveTargetsMs: null,
    refDownloadMsTotal: 0,
    refUploadMsTotal: 0,
    refFileBytesTotal: 0,
    refTransferredBytesTotal: 0,
    refCacheHits: 0,
  };

  try {
    let stepStartedAt = getTimingStart();
    const refGraphResult = await getPreparedAutomationRefGraph(execution, projectId, sourceItem);
    timing.refGraphLookupMs = roundDurationMs(getDurationMs(stepStartedAt));
    timing.refGraphCacheHit = refGraphResult.cacheHit;
    timing.refGraphCacheScope = refGraphResult.cacheScope || (refGraphResult.cacheHit ? 'memory' : 'none');

    const refGraph = refGraphResult.graph;
    const candidateRows = refGraph.candidateRows;
    const uniqueRows = refGraph.uniqueRows;
    const filteredRefs = refGraph.filteredRefs;

    timing.resolveRefsMs = refGraphResult.cacheHit ? 0 : refGraph.resolveRefsMs;

    const usedLocalPaths = new Set();
    usedLocalPaths.add(refGraph.sourceLocalName);
    let hiddenSegmentsRemoved = Number(sourceItem.hiddenPathSegmentsRemoved || 0) + Number(refGraph.sourceHiddenSegmentsRemoved || 0);
    let localNameCollisionsResolved = 0;
    let hiddenTargetsSkipped = 0;
    let unresolvedTargetsSkipped = 0;

    stepStartedAt = getTimingStart();
    const resolvedTargets = await mapWithConcurrency(uniqueRows, 4, async (row) => {
      const targetItemId = getResolvableTargetItemId(row);
      if (!targetItemId) {
        return { status: 'unresolved', row };
      }

      try {
        const targetItem = await execution.resolveAutomationItem(projectId, targetItemId);
        if (targetItem.hidden) {
          return { status: 'hidden', row, targetItem };
        }
        return { status: 'resolved', row, targetItem };
      } catch {
        return { status: 'unresolved', row };
      }
    });
    timing.resolveTargetsMs = roundDurationMs(getDurationMs(stepStartedAt));

    const stagedCandidates = [];
    for (const result of resolvedTargets) {
      if (result.status === 'unresolved') {
        unresolvedTargetsSkipped += 1;
        continue;
      }
      if (result.status === 'hidden') {
        hiddenTargetsSkipped += 1;
        continue;
      }

      const { row, targetItem } = result;
      const targetLocalInfo = normalizeAutomationLocalPath(
        targetItem.relativePath || row.targetPathInProject || row.targetName || targetItem.displayName,
        targetItem.displayName || row.targetName || 'xref.dwg',
      );
      hiddenSegmentsRemoved += Number(targetItem.hiddenPathSegmentsRemoved || 0) + targetLocalInfo.hiddenSegmentsRemoved;

      const uniqueLocalName = ensureUniqueAutomationLocalPath(
        targetLocalInfo.localPath,
        usedLocalPaths,
        `${targetItem.itemId}|${targetItem.versionId || row.targetResourceId || row.targetName}`,
      );
      if (uniqueLocalName.collisionResolved) {
        localNameCollisionsResolved += 1;
      }

      stagedCandidates.push({
        sequence: stagedCandidates.length + 1,
        row,
        targetItem,
        localName: uniqueLocalName.localPath,
      });
    }

    const stagedResults = await mapWithConcurrency(stagedCandidates, AUTOMATION_REFERENCE_STAGE_CONCURRENCY, async (candidate) => {
      const { row, targetItem, localName, sequence } = candidate;
      const refTimingBase = {
        sourceItemId: sourceItem.itemId,
        sourceName,
        targetItemId: targetItem.itemId,
        targetName: targetItem.displayName,
        sequence,
      };
      const targetPreparedRefGraphPromise = getPreparedAutomationRefGraph(execution, projectId, targetItem)
        .then((result) => result.graph)
        .catch(() => null);

      const stagedReference = await stageAutomationArtifact(execution, projectId, targetItem, {
        preferredName: targetItem.displayName,
        jobKey,
        cacheStep: 'reference-stage-cache-hit',
        downloadStep: 'reference-source-download',
        uploadStep: 'reference-oss-upload',
        logDetails: refTimingBase,
      });

      const targetPreparedRefGraph = await targetPreparedRefGraphPromise;
      if (targetPreparedRefGraph) {
        await persistPreparedAutomationRefGraphForArtifactEntry(
          execution.config.bucketKey,
          stagedReference.cacheKey,
          targetPreparedRefGraph,
        );
      }

      if (stagedReference.cacheHit) {
        timing.refCacheHits += 1;
      } else {
        timing.refDownloadMsTotal += Number(stagedReference.downloadDurationMs || 0);
        timing.refUploadMsTotal += Number(stagedReference.uploadDurationMs || 0);
        timing.refTransferredBytesTotal += Number(stagedReference.bytesTransferred || stagedReference.sizeBytes || 0);
      }
      timing.refFileBytesTotal += Number(stagedReference.sizeBytes || 0);

      const resolvedVersionId = stagedReference.versionId
        || targetItem.versionId
        || (String(row?.targetResourceType || '').trim().toLowerCase() === 'versions' ? row.targetResourceId : '');

      const publishRef = {
        itemId: targetItem.itemId,
        versionId: resolvedVersionId || '',
        displayName: targetItem.displayName,
        targetName: targetItem.displayName,
        localName,
        nestedType: row?.nestedType || '',
        direction: 'from',
        refType: row?.refType || 'xrefs',
        refExtensionType: row?.refExtensionType || XREF_REF_EXTENSION_TYPE,
        refExtensionVersion: row?.refExtensionVersion || '1.1',
      };

      return {
        referenceInput: {
          verb: 'get',
          url: stagedReference.objectId,
          localName,
          headers: { Authorization: `Bearer ${execution.automationToken}` },
        },
        resolvedReference: publishRef,
        versionRef: buildAutomationVersionRef(publishRef, resolvedVersionId),
      };
    });

    const referenceInputs = stagedResults.map((result) => result.referenceInput);
    const resolvedReferences = stagedResults.map((result) => result.resolvedReference);
    const dedupedVersionRefs = dedupeAutomationVersionRefs(stagedResults.map((result) => result.versionRef).filter(Boolean));

    const preparedRefs = {
      hostLocalName: refGraph.sourceLocalName,
      referenceInputs,
      filteredRefs,
      resolvedReferences,
      publishRefs: resolvedReferences,
      accVersionRefs: dedupedVersionRefs,
      meta: {
        retrievedVia: refGraph.retrievedVia,
        refGraphResolvedVia: refGraph.retrievedVia,
        refBlobStagedVia: timing.refCacheHits === referenceInputs.length && referenceInputs.length
          ? 'artifact-stage-cache'
          : 'direct-stage',
        requestedCount: candidateRows.length,
        uniqueTargetCount: uniqueRows.length,
        stagedCount: referenceInputs.length,
        duplicateTargetsRemoved: candidateRows.length - uniqueRows.length,
        localNameCollisionsResolved,
        hiddenSegmentsRemoved,
        hiddenTargetsSkipped,
        unresolvedTargetsSkipped,
        accVersionRefsCount: dedupedVersionRefs.length,
        cacheHits: timing.refCacheHits,
        cacheMisses: referenceInputs.length - timing.refCacheHits,
        fileBytesTotal: normalizeStorageSize(timing.refFileBytesTotal),
        transferredBytesTotal: normalizeStorageSize(timing.refTransferredBytesTotal),
      },
    };

    logAutomationTiming('prepareAutomationReferences', {
      jobKey,
      projectId,
      sourceItemId: sourceItem.itemId,
      sourceName,
      refGraphCacheHit: timing.refGraphCacheHit,
      refGraphCacheScope: timing.refGraphCacheScope,
      refGraphLookupMs: timing.refGraphLookupMs,
      requestedCount: candidateRows.length,
      uniqueTargetCount: uniqueRows.length,
      stagedCount: referenceInputs.length,
      unresolvedTargetsSkipped,
      hiddenTargetsSkipped,
      cacheHits: timing.refCacheHits,
      cacheMisses: referenceInputs.length - timing.refCacheHits,
      resolveRefsMs: timing.resolveRefsMs,
      resolveTargetsMs: timing.resolveTargetsMs,
      refDownloadMsTotal: roundDurationMs(timing.refDownloadMsTotal),
      refUploadMsTotal: roundDurationMs(timing.refUploadMsTotal),
      refFileBytesTotal: normalizeStorageSize(timing.refFileBytesTotal),
      refTransferredBytesTotal: normalizeStorageSize(timing.refTransferredBytesTotal),
      ...buildTimingFields(timingWindow),
      outcome: 'ok',
    });

    return preparedRefs;
  } catch (error) {
    logAutomationTiming('prepareAutomationReferences', {
      jobKey,
      projectId,
      sourceItemId: sourceItem?.itemId || null,
      sourceName,
      refGraphCacheHit: timing.refGraphCacheHit,
      refGraphCacheScope: timing.refGraphCacheScope,
      refGraphLookupMs: timing.refGraphLookupMs,
      resolveRefsMs: timing.resolveRefsMs,
      resolveTargetsMs: timing.resolveTargetsMs,
      refDownloadMsTotal: roundDurationMs(timing.refDownloadMsTotal),
      refUploadMsTotal: roundDurationMs(timing.refUploadMsTotal),
      refFileBytesTotal: normalizeStorageSize(timing.refFileBytesTotal),
      refTransferredBytesTotal: normalizeStorageSize(timing.refTransferredBytesTotal),
      cacheHits: timing.refCacheHits,
      ...buildTimingFields(timingWindow),
      outcome: 'error',
      error: error?.message || 'Unknown error',
    });
    throw error;
  }
}

function dedupeBatchDependencyItems(items) {
  const unique = [];
  const seen = new Set();

  for (const item of Array.isArray(items) ? items : []) {
    const itemId = String(item?.itemId || '').trim();
    if (!itemId || seen.has(itemId)) {
      continue;
    }
    seen.add(itemId);
    unique.push({
      itemId,
      displayName: String(item?.displayName || itemId).trim() || itemId,
      ...(item?.status ? { status: String(item.status).trim() || undefined } : {}),
      ...(item?.relationType ? { relationType: normalizeCircularDependencyRelationType(item.relationType) } : {}),
      ...(item?.isCircular ? { isCircular: true } : {}),
      ...(item?.sccId ? { sccId: String(item.sccId).trim() || undefined } : {}),
      ...(Number.isFinite(Number(item?.sccSize)) ? { sccSize: Number(item.sccSize) } : {}),
      ...(item?.leaderItemId ? { leaderItemId: String(item.leaderItemId).trim() || undefined } : {}),
      ...(item?.leaderDisplayName ? { leaderDisplayName: String(item.leaderDisplayName).trim() || undefined } : {}),
    });
  }

  return unique;
}

function normalizeCircularDependencyRelationType(value) {
  return String(value || '').trim().toLowerCase() === 'attachment' ? 'attachment' : 'overlay';
}

function getCircularDependencyStatusLabel(relationType) {
  return normalizeCircularDependencyRelationType(relationType) === 'attachment'
    ? 'Uploaded w/Circle Attach'
    : 'Uploaded w/Circle Overlay';
}

function compareBatchSubmissionOrder(left, right) {
  const leftIndex = Number.isFinite(Number(left?.batchIndex)) ? Number(left.batchIndex) : Number.MAX_SAFE_INTEGER;
  const rightIndex = Number.isFinite(Number(right?.batchIndex)) ? Number(right.batchIndex) : Number.MAX_SAFE_INTEGER;
  if (leftIndex !== rightIndex) {
    return leftIndex - rightIndex;
  }

  const leftCreatedAt = parseTimestampMs(left?.createdAt);
  const rightCreatedAt = parseTimestampMs(right?.createdAt);
  if (leftCreatedAt !== null && rightCreatedAt !== null && leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt - rightCreatedAt;
  }

  return String(left?.id || left?.sourceItemId || '').localeCompare(String(right?.id || right?.sourceItemId || ''));
}

function createBatchPublishGraph(jobByItemId, dependenciesByItemId) {
  const graph = new Map();
  for (const itemId of jobByItemId.keys()) {
    graph.set(itemId, []);
  }

  for (const [sourceItemId, dependencies] of dependenciesByItemId) {
    const targets = getDependencyItemIds(dependencies).filter((itemId) => jobByItemId.has(itemId));
    graph.set(sourceItemId, targets);
  }

  return graph;
}

function findStronglyConnectedComponents(graph) {
  const indexByNode = new Map();
  const lowLinkByNode = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];
  let index = 0;

  const strongConnect = (node) => {
    indexByNode.set(node, index);
    lowLinkByNode.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);

    for (const neighbor of graph.get(node) || []) {
      if (!indexByNode.has(neighbor)) {
        strongConnect(neighbor);
        lowLinkByNode.set(node, Math.min(lowLinkByNode.get(node), lowLinkByNode.get(neighbor)));
      } else if (onStack.has(neighbor)) {
        lowLinkByNode.set(node, Math.min(lowLinkByNode.get(node), indexByNode.get(neighbor)));
      }
    }

    if (lowLinkByNode.get(node) === indexByNode.get(node)) {
      const component = [];
      let member = null;
      do {
        member = stack.pop();
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      components.push(component);
    }
  };

  for (const node of graph.keys()) {
    if (!indexByNode.has(node)) {
      strongConnect(node);
    }
  }

  return components;
}

function buildBatchPublishSccIndex(jobByItemId, dependenciesByItemId) {
  const graph = createBatchPublishGraph(jobByItemId, dependenciesByItemId);
  const rawComponents = findStronglyConnectedComponents(graph)
    .filter((component) => Array.isArray(component) && component.length > 1)
    .map((component) => component
      .map((itemId) => jobByItemId.get(itemId))
      .filter(Boolean)
      .sort(compareBatchSubmissionOrder))
    .filter((component) => component.length > 1)
    .sort((left, right) => compareBatchSubmissionOrder(left[0], right[0]));

  const sccByItemId = new Map();
  for (const componentJobs of rawComponents) {
    const memberItemIds = componentJobs.map((job) => String(job.sourceItemId || '').trim()).filter(Boolean);
    const sccId = `scc-${crypto.createHash('sha1').update(memberItemIds.join('|')).digest('hex').slice(0, 12)}`;
    const leaderJob = componentJobs[0];
    const sccMeta = {
      id: sccId,
      size: componentJobs.length,
      leaderItemId: leaderJob?.sourceItemId || null,
      leaderDisplayName: leaderJob?.inputFileName || leaderJob?.sourceItemId || null,
      members: componentJobs.map((job) => ({
        itemId: job.sourceItemId,
        displayName: job.inputFileName || job.sourceItemId,
        batchIndex: Number.isFinite(Number(job.batchIndex)) ? Number(job.batchIndex) : null,
      })),
    };

    for (const itemId of memberItemIds) {
      sccByItemId.set(itemId, clonePlain(sccMeta));
    }
  }

  return sccByItemId;
}

function getBatchPublishGroupId(itemId, sccByItemId) {
  const normalizedItemId = String(itemId || '').trim();
  if (!normalizedItemId) {
    return '';
  }
  const scc = sccByItemId.get(normalizedItemId);
  return String(scc?.id || `job-${normalizedItemId}`).trim();
}

function buildBatchPublishExecutionPlan(jobByItemId, dependenciesByItemId, sccByItemId) {
  const groupById = new Map();

  for (const [itemId, job] of jobByItemId.entries()) {
    const groupId = getBatchPublishGroupId(itemId, sccByItemId);
    const scc = sccByItemId.get(itemId) || null;
    if (groupById.has(groupId)) {
      continue;
    }
    const memberJobs = scc
      ? (Array.isArray(scc.members) ? scc.members.map((member) => jobByItemId.get(String(member?.itemId || '').trim())).filter(Boolean) : [job])
      : [job];
    groupById.set(groupId, {
      id: groupId,
      sccId: scc?.id || null,
      members: memberJobs.sort(compareBatchSubmissionOrder),
      leaderJob: memberJobs[0] || job,
    });
  }

  const dependencyGroupIdsByGroupId = new Map();
  for (const groupId of groupById.keys()) {
    dependencyGroupIdsByGroupId.set(groupId, new Set());
  }

  let edgeCount = 0;
  for (const [sourceItemId, dependencies] of dependenciesByItemId.entries()) {
    const sourceGroupId = getBatchPublishGroupId(sourceItemId, sccByItemId);
    const targetGroups = dependencyGroupIdsByGroupId.get(sourceGroupId) || new Set();
    for (const dependency of Array.isArray(dependencies) ? dependencies : []) {
      const dependencyGroupId = getBatchPublishGroupId(dependency?.itemId, sccByItemId);
      if (!dependencyGroupId || dependencyGroupId === sourceGroupId || targetGroups.has(dependencyGroupId)) {
        continue;
      }
      targetGroups.add(dependencyGroupId);
      edgeCount += 1;
    }
    dependencyGroupIdsByGroupId.set(sourceGroupId, targetGroups);
  }

  const depthMemo = new Map();
  const computeDepth = (groupId, stack = new Set()) => {
    if (depthMemo.has(groupId)) {
      return depthMemo.get(groupId);
    }
    if (stack.has(groupId)) {
      return 0;
    }
    stack.add(groupId);
    let depth = 0;
    for (const dependencyGroupId of dependencyGroupIdsByGroupId.get(groupId) || []) {
      depth = Math.max(depth, computeDepth(dependencyGroupId, stack) + 1);
    }
    stack.delete(groupId);
    depthMemo.set(groupId, depth);
    return depth;
  };

  const orderedGroups = Array.from(groupById.values())
    .map((group) => ({
      ...group,
      depth: computeDepth(group.id),
    }))
    .sort((left, right) => left.depth - right.depth || compareBatchSubmissionOrder(left.leaderJob, right.leaderJob));

  const groupOrderById = new Map(orderedGroups.map((group, index) => [group.id, index]));
  const planByItemId = new Map();

  for (const group of orderedGroups) {
    group.members.forEach((memberJob, memberIndex) => {
      const dependencies = dependenciesByItemId.get(memberJob.sourceItemId) || [];
      const externalDependencyItemIds = [];
      const internalDependencyItemIds = [];
      for (const dependency of dependencies) {
        const dependencyGroupId = getBatchPublishGroupId(dependency.itemId, sccByItemId);
        if (dependencyGroupId === group.id) {
          internalDependencyItemIds.push(dependency.itemId);
        } else {
          externalDependencyItemIds.push(dependency.itemId);
        }
      }
      const selectedDependencyVersionIds = Object.fromEntries((Array.isArray(memberJob.accPublishRefs) ? memberJob.accPublishRefs : [])
        .map((ref) => [String(ref?.itemId || '').trim(), String(ref?.versionId || '').trim()])
        .filter(([itemId, versionId]) => itemId && versionId));
      const relationSummary = summarizeRelationCounts(dependencies);
      const blockedByJobIds = dedupeStrings([
        ...externalDependencyItemIds,
        ...(memberIndex > 0 ? [group.members[memberIndex - 1]?.sourceItemId] : []),
      ]);
      planByItemId.set(memberJob.sourceItemId, {
        batchId: memberJob.batchId || null,
        groupId: group.id,
        sccId: group.sccId,
        groupOrder: groupOrderById.get(group.id),
        publishOrder: (groupOrderById.get(group.id) * 1000) + memberIndex,
        memberOrder: memberIndex,
        isSccMember: Boolean(group.sccId),
        selectedDependencyVersionIds,
        externalDependencyItemIds,
        internalDependencyItemIds,
        blockedByJobIds,
        blockedBySccId: memberIndex > 0 ? group.sccId || group.id : null,
        relationSummary,
        fastPublishEligible: AUTOMATION_FAST_OVERLAY_PUBLISH && relationSummary.attachment === 0 && relationSummary.overlay > 0,
        edgeSummary: dependencies.map((dependency) => ({
          itemId: dependency.itemId,
          relationType: normalizeCircularDependencyRelationType(dependency?.relationType),
          isCircular: Boolean(dependency?.isCircular),
        })),
      });
    });
  }

  return {
    summary: {
      groupCount: orderedGroups.length,
      nodeCount: jobByItemId.size,
      edgeCount,
      sccCount: orderedGroups.filter((group) => group.sccId).length,
      sccSizes: orderedGroups.filter((group) => group.sccId).map((group) => group.members.length),
    },
    planByItemId,
  };
}

function getJobPublishScc(job) {
  const scc = job?.publishScc;
  if (!scc || !scc.id || !Array.isArray(scc.members) || scc.members.length < 2) {
    return null;
  }
  return scc;
}

function summarizePublishCircle(dependencies, publishScc = null) {
  const circleDependencies = dedupeBatchDependencyItems((Array.isArray(dependencies) ? dependencies : []).filter((dependency) => dependency?.isCircular));
  if (!circleDependencies.length) {
    return null;
  }

  const relationType = circleDependencies.some((dependency) => normalizeCircularDependencyRelationType(dependency?.relationType) === 'attachment')
    ? 'attachment'
    : 'overlay';

  return {
    relationType,
    statusLabel: getCircularDependencyStatusLabel(relationType),
    dependencies: circleDependencies,
    ...(publishScc?.id ? {
      id: publishScc.id,
      size: Number.isFinite(Number(publishScc.size)) ? Number(publishScc.size) : circleDependencies.length + 1,
      leaderItemId: publishScc.leaderItemId || null,
      leaderDisplayName: publishScc.leaderDisplayName || null,
      members: Array.isArray(publishScc.members) ? publishScc.members : [],
    } : {}),
  };
}

function buildBatchPublishDependencies(job, jobByItemId) {
  const dependencyMap = new Map();

  for (const ref of Array.isArray(job?.accPublishRefs) ? job.accPublishRefs : []) {
    const itemId = String(ref?.itemId || '').trim();
    if (!itemId || itemId === job?.sourceItemId || !jobByItemId.has(itemId)) {
      continue;
    }

    const existing = dependencyMap.get(itemId) || {
      itemId,
      displayName: String(ref?.targetName || ref?.displayName || ref?.localName || itemId).trim() || itemId,
      relationTypes: new Set(),
    };
    existing.displayName = String(ref?.targetName || ref?.displayName || ref?.localName || existing.displayName || itemId).trim() || itemId;
    existing.relationTypes.add(normalizeCircularDependencyRelationType(ref?.nestedType));
    dependencyMap.set(itemId, existing);
  }

  return dedupeBatchDependencyItems(Array.from(dependencyMap.values(), (entry) => ({
    itemId: entry.itemId,
    displayName: entry.displayName,
    relationType: entry.relationTypes.has('attachment') ? 'attachment' : 'overlay',
  })));
}

async function decorateSubmittedAutomationBatch(execution, jobs, { batchId = null } = {}) {
  const submittedJobs = Array.isArray(jobs) ? jobs.filter(Boolean) : [];
  if (!submittedJobs.length) {
    return [];
  }

  const effectiveBatchId = String(batchId || execution.executionKey || submittedJobs[0]?.batchId || '').trim() || execution.executionKey;
  const orderedJobs = submittedJobs
    .map((job, index) => ({
      ...job,
      batchIndex: Number.isFinite(Number(job?.batchIndex)) ? Number(job.batchIndex) : index,
    }))
    .sort(compareBatchSubmissionOrder);
  const jobByItemId = new Map(orderedJobs.map((job) => [job.sourceItemId, job]));
  const dependenciesByItemId = new Map();
  const dependentsByItemId = new Map(Array.from(jobByItemId.keys(), (itemId) => [itemId, []]));

  for (const job of orderedJobs) {
    const publishDependencies = buildBatchPublishDependencies(job, jobByItemId);
    dependenciesByItemId.set(job.sourceItemId, publishDependencies);
  }

  const sccByItemId = buildBatchPublishSccIndex(jobByItemId, dependenciesByItemId);
  const batchPublishExecutionPlan = buildBatchPublishExecutionPlan(jobByItemId, dependenciesByItemId, sccByItemId);
  const decoratedAt = new Date().toISOString();

  execution.req?.log?.info('batch.plan.created', {
    batchId: effectiveBatchId,
    sessionId: orderedJobs[0]?.sessionId || null,
    itemCount: orderedJobs.length,
    groupCount: batchPublishExecutionPlan.summary.groupCount,
    nodeCount: batchPublishExecutionPlan.summary.nodeCount,
    edgeCount: batchPublishExecutionPlan.summary.edgeCount,
    sccCount: batchPublishExecutionPlan.summary.sccCount,
    sccSizes: batchPublishExecutionPlan.summary.sccSizes,
  });

  for (const [sourceItemId, publishDependencies] of dependenciesByItemId) {
    const sourceScc = sccByItemId.get(sourceItemId) || null;
    const enrichedDependencies = publishDependencies.map((dependency) => {
      const dependencyScc = sccByItemId.get(dependency.itemId) || null;
      if (!sourceScc || !dependencyScc || sourceScc.id !== dependencyScc.id) {
        return dependency;
      }

      return {
        ...dependency,
        isCircular: true,
        sccId: sourceScc.id,
        sccSize: sourceScc.size,
        leaderItemId: sourceScc.leaderItemId || undefined,
        leaderDisplayName: sourceScc.leaderDisplayName || undefined,
      };
    });
    dependenciesByItemId.set(sourceItemId, dedupeBatchDependencyItems(enrichedDependencies));
  }

  for (const [sourceItemId, publishDependencies] of dependenciesByItemId) {
    const sourceJob = jobByItemId.get(sourceItemId);
    for (const dependency of publishDependencies) {
      const dependents = dependentsByItemId.get(dependency.itemId) || [];
      dependents.push({
        itemId: sourceItemId,
        displayName: sourceJob?.inputFileName || sourceItemId,
      });
      dependentsByItemId.set(dependency.itemId, dedupeBatchDependencyItems(dependents));
    }
  }

  const decoratedJobs = [];
  for (const job of orderedJobs) {
    const publishScc = sccByItemId.get(job.sourceItemId) || null;
    const plan = batchPublishExecutionPlan.planByItemId.get(job.sourceItemId) || null;
    const decorated = {
      ...job,
      batchId: effectiveBatchId,
      batchSize: orderedJobs.length,
      batchSubmissionState: 'ready',
      publishDependencies: dependenciesByItemId.get(job.sourceItemId) || [],
      publishDependents: dependentsByItemId.get(job.sourceItemId) || [],
      publishScc,
      publishCircle: summarizePublishCircle(dependenciesByItemId.get(job.sourceItemId) || [], publishScc),
      publishPlan: plan ? {
        ...clonePlain(plan),
        batchPlanCreatedAt: decoratedAt,
      } : null,
      publishQueue: plan ? {
        batchId: effectiveBatchId,
        state: 'queued',
        enteredAt: decoratedAt,
        publishOrder: plan.publishOrder,
        groupOrder: plan.groupOrder,
        blockedByJobIds: plan.blockedByJobIds,
        blockedBySccId: plan.blockedBySccId,
        relationSummary: plan.relationSummary,
        fastPublishEligible: Boolean(plan.fastPublishEligible),
        reason: 'Queued for upload after Design Automation completes.',
      } : null,
    };
    await upsertJob(decorated);
    decoratedJobs.push(decorated);
  }

  await logBatchSubmissionSnapshot(orderedJobs[0]?.sessionId || null, effectiveBatchId, 'automation.batch.submission-state.decorated', {
    batchSize: orderedJobs.length,
  });

  return decoratedJobs;
}

async function submitAutomationJobs(execution, projectId, items, { concurrency = AUTOMATION_SUBMISSION_CONCURRENCY } = {}) {
  const timingWindow = createTimingWindow();
  const candidates = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!candidates.length) {
    return [];
  }

  try {
    const jobs = await mapWithConcurrency(candidates, concurrency, (item, _index, queueWaitMs) => stageAccItemForAutomation(execution, projectId, item, { queueWaitMs }));
    const decoratedJobs = await decorateSubmittedAutomationBatch(execution, jobs);
    logAutomationTiming('submitAutomationJobs', {
      projectId,
      itemCount: candidates.length,
      concurrency,
      ...buildTimingFields(timingWindow),
      outcome: 'ok',
    });
    return decoratedJobs;
  } catch (error) {
    logAutomationTiming('submitAutomationJobs', {
      projectId,
      itemCount: candidates.length,
      concurrency,
      ...buildTimingFields(timingWindow),
      outcome: 'error',
      error: error?.message || 'Unknown error',
    });
    throw error;
  }
}

async function runQueuedAutomationBatch(execution, projectId, items, queuedJobs, { concurrency = AUTOMATION_BATCH_STAGE_CONCURRENCY } = {}) {
  const timingWindow = createTimingWindow();
  const candidates = Array.isArray(items) ? items.filter(Boolean) : [];
  const queued = Array.isArray(queuedJobs) ? queuedJobs.filter(Boolean) : [];
  const failures = [];
  const sessionId = execution?.req?.sessionID || queued[0]?.sessionId || '';
  const batchId = queued[0]?.batchId || null;
  const safeConcurrency = Math.max(1, Number(concurrency) || AUTOMATION_BATCH_STAGE_CONCURRENCY);

  execution.req?.log?.info('automation.batch.queue.started', {
    projectId,
    batchId,
    sessionId,
    itemCount: candidates.length,
    concurrency: safeConcurrency,
    maxInflightBytes: AUTOMATION_BATCH_STAGE_MAX_INFLIGHT_BYTES,
  });

  try {
    const emptyPrewarm = {
      byItemId: new Map(),
      sourceCount: 0,
      targetCount: 0,
      totalSourceBytes: 0,
      totalRefBytes: 0,
    };
    const prewarmPromise = prewarmAutomationBatchArtifacts(execution, projectId, candidates, { batchId })
      .catch((error) => {
        execution.req?.log?.warn('batch.prewarm.failed', {
          projectId,
          batchId,
          sessionId,
          itemCount: candidates.length,
          error,
        });
        return emptyPrewarm;
      });
    const workEntries = candidates
      .map((item, index) => {
        const seedJob = queued[index] || null;
        const itemSizeBytes = normalizeStorageSize(item?.size) || normalizeStorageSize(item?.sizeBytes) || 0;
        return {
          item,
          index,
          seedJob,
          resolvedSourceItem: null,
          weightBytes: itemSizeBytes || getJobSizeHintBytes(seedJob || item),
          referenceCount: 0,
        };
      })
      .sort((left, right) => {
        const leftWeight = Number(left.weightBytes || 0);
        const rightWeight = Number(right.weightBytes || 0);
        if (rightWeight !== leftWeight) {
          return rightWeight - leftWeight;
        }
        return Number(left.seedJob?.batchIndex ?? left.index ?? 0) - Number(right.seedJob?.batchIndex ?? right.index ?? 0);
      });

    // Baseline bounded-concurrency shape retained for regression checks:
    // const stagedResults = await mapWithConcurrency(candidates, safeConcurrency, async (item, index, queueWaitMs) => {
    const stagedResults = await mapWithWeightedBudget(
      workEntries,
      {
        limit: safeConcurrency,
        maxWeight: AUTOMATION_BATCH_STAGE_MAX_INFLIGHT_BYTES,
        weightFn: (entry) => entry.weightBytes,
      },
      async (entry, _scheduledIndex, queueWaitMs) => {
        if (isSessionJobsCancelled(sessionId)) {
          return null;
        }

        const { item, seedJob, resolvedSourceItem, weightBytes, referenceCount } = entry;
        try {
          return await stageAccItemForAutomation(execution, projectId, item, {
            queueWaitMs,
            seedJob,
            resolvedSourceItem,
          });
        } catch (error) {
          failures.push({
            itemId: item?.itemId || null,
            displayName: item?.displayName || null,
            error: error?.message || 'Unknown error',
          });
          execution.req?.log?.warn('automation.batch.item-failed', {
            projectId,
            batchId,
            sourceItemId: item?.itemId || null,
            sourceName: item?.displayName || null,
            queueWaitMs,
            weightBytes,
            referenceCount,
            error,
          });
          return null;
        }
      },
    );

    const prewarm = await prewarmPromise;
    const batchJobsForDecoration = (await listJobsForSession(sessionId))
      .filter((job) => String(job?.batchId || '').trim() === String(batchId || '').trim())
      .sort(compareBatchSubmissionOrder);
    const decoratedBatchJobs = batchJobsForDecoration.length
      ? await decorateSubmittedAutomationBatch(execution, batchJobsForDecoration, { batchId })
      : [];
    const submittedJobs = decoratedBatchJobs.filter((job) => String(job?.workItemId || '').trim());

    execution.req?.log?.info('automation.batch.queue.finished', {
      projectId,
      batchId,
      sessionId,
      itemCount: candidates.length,
      concurrency: safeConcurrency,
      maxInflightBytes: AUTOMATION_BATCH_STAGE_MAX_INFLIGHT_BYTES,
      submitted: submittedJobs.length,
      failedCount: failures.length,
      prewarmSourceCount: prewarm.sourceCount,
      prewarmTargetCount: prewarm.targetCount,
      prewarmSourceBytes: prewarm.totalSourceBytes,
      prewarmRefBytes: prewarm.totalRefBytes,
      cancelled: isSessionJobsCancelled(sessionId),
    });
    await logBatchSubmissionSnapshot(sessionId, batchId, 'automation.batch.submission-state.queue-finished', {
      projectId,
      itemCount: candidates.length,
      submitted: submittedJobs.length,
      failedCount: failures.length,
      concurrency: safeConcurrency,
      maxInflightBytes: AUTOMATION_BATCH_STAGE_MAX_INFLIGHT_BYTES,
      prewarmSourceCount: prewarm.sourceCount,
      prewarmTargetCount: prewarm.targetCount,
      prewarmSourceBytes: prewarm.totalSourceBytes,
      prewarmRefBytes: prewarm.totalRefBytes,
      cancelled: isSessionJobsCancelled(sessionId),
    });

    logAutomationTiming('submitAutomationJobs.background', {
      projectId,
      itemCount: candidates.length,
      concurrency: safeConcurrency,
      maxInflightBytes: AUTOMATION_BATCH_STAGE_MAX_INFLIGHT_BYTES,
      submitted: submittedJobs.length,
      failedCount: failures.length,
      prewarmSourceCount: prewarm.sourceCount,
      prewarmTargetCount: prewarm.targetCount,
      prewarmSourceBytes: prewarm.totalSourceBytes,
      prewarmRefBytes: prewarm.totalRefBytes,
      cancelled: isSessionJobsCancelled(sessionId),
      ...buildTimingFields(timingWindow),
      outcome: failures.length ? 'partial' : 'ok',
    });
    return submittedJobs;
  } catch (error) {
    logAutomationTiming('submitAutomationJobs.background', {
      projectId,
      itemCount: candidates.length,
      concurrency: safeConcurrency,
      maxInflightBytes: AUTOMATION_BATCH_STAGE_MAX_INFLIGHT_BYTES,
      failedCount: failures.length,
      cancelled: isSessionJobsCancelled(sessionId),
      ...buildTimingFields(timingWindow),
      outcome: 'error',
      error: error?.message || 'Unknown error',
    });
    throw error;
  }
}

function scheduleBatchPublishQueue(req, sessionId, batchId, { reason = 'unknown' } = {}) {
  const key = buildBatchRuntimeKey(sessionId, batchId);
  if (!key.trim() || batchPublishQueueInflight.has(key)) {
    return batchPublishQueueInflight.get(key) || null;
  }
  if (batchPublishQueueScheduled.has(key)) {
    return batchPublishQueueScheduled.get(key);
  }

  const scheduled = new Promise((resolve) => {
    setTimeout(() => {
      batchPublishQueueScheduled.delete(key);
      const work = Promise.resolve()
        .then(() => runBatchPublishQueue(req, sessionId, batchId, { reason }))
        .finally(() => {
          batchPublishQueueInflight.delete(key);
        });
      batchPublishQueueInflight.set(key, work);
      resolve(work);
    }, AUTOMATION_PUBLISH_TRIGGER_DEBOUNCE_MS);
  });
  batchPublishQueueScheduled.set(key, scheduled);
  return scheduled;
}

async function queueSuccessfulJobForPublish(req, job, reason = 'unknown') {
  if (!job?.sessionId || !job?.batchId || String(job?.status || '').toLowerCase() !== 'success') {
    return job;
  }

  const uploadStatus = String(job?.accUpload?.status || '').toLowerCase();
  let queuedJob = job;
  if (!isTerminalAccUploadStatus(uploadStatus) && uploadStatus !== 'publishing' && uploadStatus !== 'waiting-dependencies') {
    const updatedAt = new Date().toISOString();
    queuedJob = await upsertJob({
      ...job,
      publishQueue: {
        ...(job.publishQueue || {}),
        enteredAt: String(job?.publishQueue?.enteredAt || job?.accUpload?.publishQueueEnteredAt || updatedAt).trim() || updatedAt,
        state: 'queued',
        reason: 'Queued for upload.',
      },
      accUpload: {
        ...(job.accUpload || {}),
        status: 'pending',
        message: 'Queued for upload.',
        updatedAt,
        publishQueueEnteredAt: String(job?.accUpload?.publishQueueEnteredAt || updatedAt).trim() || updatedAt,
      },
    });
  }

  scheduleBatchPublishQueue(req, queuedJob.sessionId, queuedJob.batchId, { reason });
  return queuedJob;
}

async function runBatchPublishQueue(req, sessionId, batchId, { reason = 'unknown' } = {}) {
  const timingWindow = createTimingWindow();
  const key = buildBatchRuntimeKey(sessionId, batchId);
  req.log?.info('publish.queue.started', { sessionId, batchId, reason });

  let publishedCount = 0;
  let blockedCount = 0;
  let waitingCount = 0;

  while (!isSessionJobsCancelled(sessionId)) {
    const sessionJobs = await listJobsForSession(sessionId);
    const batchJobs = sessionJobs
      .filter((candidate) => candidate?.batchId === batchId)
      .sort((left, right) => {
        const leftOrder = Number(left?.publishPlan?.publishOrder ?? left?.publishQueue?.publishOrder ?? left?.batchIndex ?? 0);
        const rightOrder = Number(right?.publishPlan?.publishOrder ?? right?.publishQueue?.publishOrder ?? right?.batchIndex ?? 0);
        return leftOrder - rightOrder || compareBatchSubmissionOrder(left, right);
      });

    const pendingJobs = batchJobs.filter((job) => String(job?.status || '').toLowerCase() === 'success' && !isTerminalAccUploadStatus(job?.accUpload?.status || '') && !syncLocks.has(job.id));
    if (!pendingJobs.length) {
      break;
    }

    const readyCandidates = [];
    blockedCount = 0;
    waitingCount = 0;

    for (const job of pendingJobs) {
      const publishPlan = await buildAccPublishPlan(job);
      logPublishPlanDecision(job, publishPlan);
      const publishPlanReason = publishPlan.status === 'ready'
        ? 'Ready for ACC publish.'
        : (publishPlan.status === 'blocked'
          ? 'Waiting on dependency publish state.'
          : 'Waiting for dependency publish state.');
      const persisted = await persistPublishPlanSnapshot(job, publishPlan, {
        reason: publishPlanReason,
        queueState: publishPlan.status === 'ready' ? 'ready' : (publishPlan.status === 'blocked' ? 'blocked' : 'waiting'),
      });
      if (publishPlan.status === 'ready') {
        readyCandidates.push({
          job: persisted,
          publishPlan,
          sizeHintBytes: getJobSizeHintBytes(persisted),
        });
      } else if (publishPlan.status === 'blocked') {
        blockedCount += 1;
      } else {
        waitingCount += 1;
      }
    }

    if (!readyCandidates.length) {
      break;
    }

    const prioritizedReadyCandidates = readyCandidates
      .map((candidate) => {
        const dependentCount = batchJobs.filter((otherJob) => {
          if (!otherJob || otherJob.id === candidate.job.id) {
            return false;
          }
          if (!shouldCountPendingPublishDependent(otherJob)) {
            return false;
          }
          return getDependencyItemIds(otherJob.publishDependencies).includes(String(candidate.job?.sourceItemId || '').trim());
        }).length;
        return {
          ...candidate,
          dependentCount,
          sizeHintBytes: Number(candidate.sizeHintBytes || getJobSizeHintBytes(candidate.job)),
        };
      })
      .sort((left, right) => right.dependentCount - left.dependentCount || left.sizeHintBytes - right.sizeHintBytes || compareBatchSubmissionOrder(left.job, right.job));

    let bytesBudget = AUTOMATION_PUBLISH_MAX_INFLIGHT_BYTES;
    const selected = [];
    for (const candidate of prioritizedReadyCandidates) {
      const remainingSlots = AUTOMATION_PUBLISH_MAX_CONCURRENCY - selected.length;
      if (remainingSlots <= 0) {
        break;
      }
      if (selected.length > 0 && candidate.sizeHintBytes > bytesBudget) {
        continue;
      }
      selected.push(candidate);
      bytesBudget -= candidate.sizeHintBytes;
      if (bytesBudget <= 0) {
        break;
      }
    }

    if (!selected.length) {
      selected.push(prioritizedReadyCandidates[0]);
    }

    logger.info('publish.queue.selection', {
      sessionId,
      batchId,
      readyCount: prioritizedReadyCandidates.length,
      selectedCount: selected.length,
      selected: selected.map((candidate) => ({
        jobId: candidate.job.id,
        sourceItemId: candidate.job.sourceItemId,
        sourceName: candidate.job.inputFileName,
        dependentCount: candidate.dependentCount,
        sizeHintBytes: candidate.sizeHintBytes,
        publishOrder: candidate.job?.publishPlan?.publishOrder ?? candidate.job?.publishQueue?.publishOrder ?? null,
      })),
    });

    await mapWithConcurrency(selected, selected.length, async (candidate) => {
      await syncSuccessfulJobToAcc(req, candidate.job, {
        publishPlan: candidate.publishPlan,
        publishQueueReason: reason,
      });
      publishedCount += 1;
    });
  }

  logger.info('publish.queue.finished', {
    sessionId,
    batchId,
    reason,
    key,
    publishedCount,
    blockedCount,
    waitingCount,
    ...buildTimingFields(timingWindow),
  });

  await logBatchSummary(sessionId, batchId, 'publish.queue.finished', {
    publishedCount,
    blockedCount,
    waitingCount,
  });
}

async function monitorBatchWorkItems(req, sessionId, batchId, { reason = 'queued' } = {}) {
  const key = buildBatchRuntimeKey(sessionId, batchId);
  const timingWindow = createTimingWindow();
  req.log?.info('automation.batch.monitor.started', { sessionId, batchId, reason, key });
  let activeCount = 0;

  try {
    while (!isSessionJobsCancelled(sessionId)) {
      const sessionJobs = await listJobsForSession(sessionId);
      const batchJobs = sessionJobs.filter((candidate) => candidate?.batchId === batchId);
      const activeJobs = batchJobs.filter((job) => !isTerminalAutomationStatus(job?.status));
      activeCount = activeJobs.length;
      if (!activeJobs.length) {
        break;
      }

      await mapWithConcurrency(activeJobs, AUTOMATION_WORKITEM_POLL_CONCURRENCY, async (job) => {
        const latest = await getSessionJob(sessionId, job.id) || job;
        if (isTerminalAutomationStatus(latest.status)) {
          if (String(latest.status || '').toLowerCase() === 'success' && !isTerminalAccUploadStatus(latest.accUpload?.status || '')) {
            await queueSuccessfulJobForPublish(req, latest, 'monitor-terminal-success');
          }
          return latest;
        }
        return refreshJobStatus(req, latest);
      });

      await sleep(AUTOMATION_BATCH_MONITOR_INTERVAL_MS);
    }

    await scheduleBatchPublishQueue(req, sessionId, batchId, { reason: 'monitor-finished' });
    req.log?.info('automation.batch.monitor.finished', {
      sessionId,
      batchId,
      reason,
      activeCount,
      ...buildTimingFields(timingWindow),
    });
    await logBatchSummary(sessionId, batchId, 'automation.batch.monitor.finished', {
      activeCount,
    });
  } finally {
    batchWorkMonitorInflight.delete(key);
  }
}

function scheduleBatchWorkMonitor(req, sessionId, batchId, { reason = 'queued' } = {}) {
  const key = buildBatchRuntimeKey(sessionId, batchId);
  if (!key.trim() || batchWorkMonitorInflight.has(key)) {
    return batchWorkMonitorInflight.get(key) || null;
  }
  const work = Promise.resolve().then(() => monitorBatchWorkItems(req, sessionId, batchId, { reason }));
  batchWorkMonitorInflight.set(key, work);
  return work;
}

async function enqueueAutomationBatch(execution, projectId, items) {
  const candidates = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!candidates.length) {
    return [];
  }

  const sessionId = execution?.req?.sessionID;
  const batchId = execution.executionKey;
  clearSessionJobsCancelled(sessionId);
  const queuedJobs = [];
  for (const [batchIndex, item] of candidates.entries()) {
    const queuedJob = buildQueuedAutomationJobRecord(execution, sessionId, projectId, item, {
      batchId,
      batchIndex,
      batchSize: candidates.length,
    });
    await upsertJob(queuedJob);
    queuedJobs.push(queuedJob);
  }

  execution.req?.log?.info('automation.batch.enqueued', {
    projectId,
    batchId,
    sessionId,
    itemCount: candidates.length,
    concurrency: AUTOMATION_BATCH_STAGE_CONCURRENCY,
  });

  Promise.resolve()
    .then(() => runQueuedAutomationBatch(execution, projectId, candidates, queuedJobs, {
      concurrency: AUTOMATION_BATCH_STAGE_CONCURRENCY,
    }))
    .then(() => scheduleBatchWorkMonitor(execution.req, sessionId, batchId, { reason: 'batch-enqueued' }))
    .catch((error) => {
      execution.req?.log?.error('automation.batch.background-failed', {
        projectId,
        batchId,
        error,
      });
    });

  return queuedJobs;
}

async function stageAccItemForAutomation(execution, projectId, item, { queueWaitMs = 0, seedJob = null, resolvedSourceItem = null } = {}) {
  const timingWindow = createTimingWindow();
  const { config, setupState } = execution;
  const sourceItem = resolvedSourceItem
    || (item?.storageUrn
      ? item
      : await execution.resolveAutomationItem(projectId, item.itemId));
  if (sourceItem.hidden) {
    throw httpError(400, `${sourceItem.displayName} is hidden in ACC and cannot be submitted to Design Automation.`);
  }

  const jobKey = `${compactTimestamp()}-${crypto.randomUUID().slice(0, 8)}`;
  const timingBase = {
    jobKey,
    projectId,
    sourceItemId: sourceItem.itemId,
    sourceName: sourceItem.displayName,
  };
  const activityQualifiedId = setupState?.activityQualifiedId || buildQualifiedResourceId(config, config.activityId, config.alias);

  let stagedSource = null;
  let stagedRefs = null;
  let refsPromise = null;
  let currentJob = seedJob || null;
  let stageStep = 'resolve-source';
  const sourceArtifactCacheKey = buildAutomationArtifactCacheKey(projectId, sourceItem);

  async function updateStage(status, message, extra = {}) {
    if (!seedJob) {
      return currentJob;
    }
    currentJob = await updateQueuedJobState(seedJob.sessionId, seedJob.id, {
      status,
      sourceProjectId: projectId,
      sourceFolderId: sourceItem.parentFolderId,
      sourceItemId: sourceItem.itemId,
      sourcePath: sanitizeDisplayPath(sourceItem.relativePath || sourceItem.displayName, sourceItem.displayName),
      inputFileName: sourceItem.displayName,
      automationFileName: sourceItem.displayName,
      automationLocalPath: path.posix.basename(sourceItem.displayName || 'input.dwg'),
      bucketKey: config.bucketKey,
      ...extra,
      accUpload: {
        ...(extra.accUpload || {}),
        status: extra.accUpload?.status || 'pending',
        message,
        updatedAt: new Date().toISOString(),
      },
    });
    logAutomationTiming('job-stage-state', {
      ...timingBase,
      localJobId: currentJob?.id || seedJob.id,
      localStatus: status,
      message,
      ...createImmediateTimingFields(),
      outcome: 'ok',
    });
    return currentJob;
  }

  try {
    stageStep = 'staging-source';
    await updateStage('staging-source', 'Staging source DWG to OSS and prefetching references.');
    const inputPreparation = startStagedAutomationInputPreparation(execution, projectId, sourceItem, jobKey, {
      preferredName: sourceItem.displayName,
      cacheStep: 'source-stage-cache-hit',
      downloadStep: 'source-download',
      uploadStep: 'source-oss-upload',
      logDetails: timingBase,
    });
    refsPromise = inputPreparation.refsPromise;
    stagedSource = await inputPreparation.stagedSourcePromise;

    stageStep = 'staging-refs';
    await updateStage('staging-refs', 'Finalizing DWG reference staging metadata.');
    stagedRefs = await finishStagedAutomationInputPreparation(execution, projectId, sourceItem, inputPreparation, {
      persistPreparedRefGraph: true,
      allowReferenceFailures: false,
    }).then((prepared) => prepared.stagedRefs);

    stageStep = 'submitting';
    await updateStage('submitting', 'Creating the Design Automation workitem.', {
      inputObjectKey: stagedSource.objectKey,
      referenceDownload: {
        ...stagedRefs.meta,
        workItemArguments: {
          inputReferences: stagedRefs.referenceInputs.length,
        },
      },
    });

    const bearer = `Bearer ${execution.automationToken}`;
    const workItem = await timeAutomationStep('workitems-post', {
      ...timingBase,
      localJobId: currentJob?.id || seedJob?.id || null,
      activityId: activityQualifiedId,
      referenceCount: stagedRefs.referenceInputs.length,
      submissionConcurrency: AUTOMATION_SUBMISSION_CONCURRENCY,
      sourceCacheHit: stagedSource.cacheHit,
      sourceTransferMode: stagedSource.transferMode,
      sourceFileSizeBytes: stagedSource.sizeBytes,
      sourceFileSizeMiB: stagedSource.sizeBytes ? roundMetric(Number(stagedSource.sizeBytes) / (1024 * 1024)) : null,
    }, () => apsJson(`${config.automationBase}/workitems`, {
      method: 'POST',
      token: execution.automationToken,
      expectedStatus: [200, 201, 202],
      context: `Could not submit the work item for ${sourceItem.displayName}`,
      body: {
        activityId: activityQualifiedId,
        arguments: {
          inputFile: {
            verb: 'get',
            url: stagedSource.objectId,
            localName: stagedRefs.hostLocalName,
            headers: { Authorization: bearer },
            references: stagedRefs.referenceInputs,
          },
          outputFile: {
            verb: 'put',
            url: buildObjectId(config.bucketKey, `jobs/${jobKey}/output-${sanitizeFileName(sourceItem.displayName)}`),
            localName: stagedRefs.hostLocalName,
            headers: { Authorization: bearer },
          },
          adskMask: true,
        },
        limitProcessingTimeSec: 900,
      },
    }));

    const outputObjectKey = `jobs/${jobKey}/output-${sanitizeFileName(sourceItem.displayName)}`;
    const createdAt = currentJob?.createdAt || new Date().toISOString();
    const updatedAt = new Date().toISOString();
    const jobRecord = {
      ...(currentJob || {}),
      sessionId: execution.req?.sessionID,
      id: currentJob?.id || workItem.id,
      workItemId: workItem.id,
      status: workItem.status || 'pending',
      batchSubmissionState: currentJob?.batchSubmissionState || 'submitting',
      createdAt,
      updatedAt,
      sourceProjectId: projectId,
      sourceFolderId: sourceItem.parentFolderId,
      sourceItemId: sourceItem.itemId,
      sourcePath: sanitizeDisplayPath(sourceItem.relativePath || sourceItem.displayName, sourceItem.displayName),
      inputFileName: sourceItem.displayName,
      automationFileName: path.posix.basename(stagedRefs.hostLocalName),
      automationLocalPath: stagedRefs.hostLocalName,
      bucketKey: config.bucketKey,
      inputObjectKey: stagedSource.objectKey,
      outputObjectKey,
      reportUrl: workItem.reportUrl || null,
      stats: workItem.stats || null,
      referenceDownload: {
        ...stagedRefs.meta,
        workItemArguments: {
          inputReferences: stagedRefs.referenceInputs.length,
        },
        serverOnly: {
          filteredRefs: stagedRefs.filteredRefs,
          resolvedReferences: stagedRefs.resolvedReferences,
        },
      },
      accVersionRefs: stagedRefs.accVersionRefs,
      accPublishRefs: stagedRefs.publishRefs,
      accUpload: {
        status: 'pending',
        message: 'Waiting for Automation output before pushing a new ACC version.',
        updatedAt,
      },
    };

    await upsertJob(jobRecord);
    logAutomationTiming('stageAccItemForAutomation', {
      ...timingBase,
      localJobId: jobRecord.id,
      referenceCount: stagedRefs.referenceInputs.length,
      activityId: activityQualifiedId,
      workItemId: workItem.id,
      sourceCacheHit: stagedSource.cacheHit,
      sourceTransferMode: stagedSource.transferMode,
      sourceFileSizeBytes: stagedSource.sizeBytes,
      sourceDownloadMs: stagedSource.cacheHit ? 0 : stagedSource.downloadDurationMs,
      sourceUploadMs: stagedSource.cacheHit ? 0 : stagedSource.uploadDurationMs,
      referenceCacheHits: stagedRefs.meta?.cacheHits || 0,
      referenceCacheMisses: stagedRefs.meta?.cacheMisses || 0,
      referenceFileBytesTotal: stagedRefs.meta?.fileBytesTotal || 0,
      ...buildTimingFields(timingWindow, { queueWaitMs }),
      outcome: 'ok',
    });
    return jobRecord;
  } catch (error) {
    if (refsPromise) {
      refsPromise.catch(() => {});
    }
    if (seedJob && !isSessionJobsCancelled(seedJob.sessionId)) {
      try {
        currentJob = await updateQueuedJobState(seedJob.sessionId, seedJob.id, {
          status: 'failed-staging',
          reportUrl: null,
          stats: null,
          batchSubmissionState: 'ready',
          accUpload: {
            status: 'failed',
            message: `Failed during staging or submission: ${error?.message || 'Unknown error'}`,
            updatedAt: new Date().toISOString(),
          },
        });
        logger.error('job.failed-staging', {
          sessionId: seedJob.sessionId,
          batchId: currentJob?.batchId || seedJob?.batchId || null,
          jobId: currentJob?.id || seedJob.id,
          itemId: sourceItem?.itemId || item?.itemId || null,
          sourceName: sourceItem?.displayName || item?.displayName || null,
          projectId,
          cacheKey: sourceArtifactCacheKey || null,
          stageStep,
          error,
        });
        await wakeDependentBatchJobs(execution.req, currentJob || seedJob);
      } catch {
        // Ignore secondary persistence failures while surfacing the primary staging error.
      }
    }
    logAutomationTiming('stageAccItemForAutomation', {
      ...timingBase,
      localJobId: currentJob?.id || seedJob?.id || null,
      activityId: activityQualifiedId,
      sourceCacheHit: stagedSource?.cacheHit || false,
      sourceTransferMode: stagedSource?.transferMode || null,
      sourceFileSizeBytes: stagedSource?.sizeBytes || null,
      referenceCacheHits: stagedRefs?.meta?.cacheHits || 0,
      referenceCacheMisses: stagedRefs?.meta?.cacheMisses || 0,
      ...buildTimingFields(timingWindow, { queueWaitMs }),
      outcome: 'error',
      error: error?.message || 'Unknown error',
    });
    throw error;
  }
}


function serializeJob(job) {
  const normalizedStatus = String(job.status || '').toLowerCase();
  const referenceDownload = job?.referenceDownload
    ? {
        retrievedVia: job.referenceDownload.retrievedVia,
        refGraphResolvedVia: job.referenceDownload.refGraphResolvedVia || job.referenceDownload.retrievedVia,
        refBlobStagedVia: job.referenceDownload.refBlobStagedVia || job.referenceDownload.retrievedVia,
        requestedCount: job.referenceDownload.requestedCount,
        uniqueTargetCount: job.referenceDownload.uniqueTargetCount,
        stagedCount: job.referenceDownload.stagedCount,
        duplicateTargetsRemoved: job.referenceDownload.duplicateTargetsRemoved,
        localNameCollisionsResolved: job.referenceDownload.localNameCollisionsResolved,
        hiddenSegmentsRemoved: job.referenceDownload.hiddenSegmentsRemoved,
        hiddenTargetsSkipped: job.referenceDownload.hiddenTargetsSkipped,
        unresolvedTargetsSkipped: job.referenceDownload.unresolvedTargetsSkipped,
        accVersionRefsCount: job.referenceDownload.accVersionRefsCount,
        cacheHits: job.referenceDownload.cacheHits,
        cacheMisses: job.referenceDownload.cacheMisses,
        fileBytesTotal: job.referenceDownload.fileBytesTotal,
        transferredBytesTotal: job.referenceDownload.transferredBytesTotal,
        workItemArguments: job.referenceDownload.workItemArguments || { inputReferences: 0 },
      }
    : null;

  return {
    id: job.id,
    workItemId: job.workItemId || null,
    batchId: job.batchId || null,
    batchIndex: Number.isFinite(Number(job.batchIndex)) ? Number(job.batchIndex) : null,
    batchSize: Number.isFinite(Number(job.batchSize)) ? Number(job.batchSize) : null,
    batchSubmissionState: job.batchSubmissionState || null,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    sourceProjectId: job.sourceProjectId,
    sourceFolderId: job.sourceFolderId,
    sourceItemId: job.sourceItemId,
    sourcePath: job.sourcePath,
    inputFileName: job.inputFileName,
    automationFileName: job.automationFileName,
    automationLocalPath: job.automationLocalPath,
    reportUrl: job.reportUrl || null,
    stats: job.stats || null,
    accUpload: job.accUpload || null,
    publishQueue: job.publishQueue || null,
    publishPlan: job.publishPlan || null,
    publishDependencies: job.publishDependencies || [],
    publishDependents: job.publishDependents || [],
    publishScc: job.publishScc || null,
    publishCircle: job.publishCircle || null,
    referenceDownload,
    downloadUrl: normalizedStatus === 'success' ? `/api/jobs/${encodeURIComponent(job.id)}/download` : null,
  };
}

function isFileNotFoundError(error) {
  return error?.code === 'ENOENT';
}

async function readJsonFile(filePath, fallback, options = {}) {
  const {
    allowMissing = fallback !== undefined,
    context = path.basename(filePath),
  } = options;

  try {
    const text = await fsp.readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch (error) {
    if (allowMissing && isFileNotFoundError(error)) {
      return fallback;
    }

    const wrapped = new Error(error instanceof SyntaxError
      ? `Could not parse ${context} JSON at ${filePath}: ${error.message}`
      : `Could not read ${context} JSON at ${filePath}: ${error.message}`);
    wrapped.cause = error;
    logger.error('json.read.failed', { filePath, context, error: wrapped });
    throw wrapped;
  }
}

async function writeJsonFile(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const serialized = `${JSON.stringify(value, null, 2)}
`;
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`,
  );
  let completed = false;
  try {
    await fsp.writeFile(tempPath, serialized, 'utf8');
    try {
      await fsp.rename(tempPath, filePath);
    } catch (error) {
      if (!['EPERM', 'EACCES', 'EEXIST'].includes(error?.code)) {
        throw error;
      }
      await fsp.writeFile(filePath, serialized, 'utf8');
      await safeUnlink(tempPath);
    }
    completed = true;
  } finally {
    if (!completed) {
      await safeUnlink(tempPath);
    }
  }
}

async function ensureJsonFile(filePath, fallback) {
  try {
    await fsp.access(filePath);
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw error;
    }
    await writeJsonFile(filePath, fallback);
  }
}

async function openUrlInDefaultBrowser(targetUrl) {
  const url = cleanEnv(targetUrl);
  if (!url) {
    throw httpError(400, 'A browser URL is required.');
  }

  let command = null;
  let args = [];
  if (process.platform === 'win32') {
    command = 'cmd.exe';
    args = ['/c', 'start', '', url];
  } else if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  await new Promise((resolve, reject) => {
    let settled = false;
    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });

      child.once('error', (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      });

      child.once('spawn', () => {
        if (!settled) {
          settled = true;
          child.unref();
          resolve();
        }
      });
    } catch (error) {
      reject(error);
    }
  }).catch((error) => {
    throw httpError(500, `Could not open ${url} in the default web browser: ${error.message}`);
  });
}

async function openFileInBrowser(filePath, { fallback = [] } = {}) {
  await ensureJsonFile(filePath, fallback);
  await openUrlInDefaultBrowser(pathToFileURL(filePath).href);
}

function createAsyncTaskQueue() {
  let tail = Promise.resolve();
  return async function withLock(task) {
    const run = tail.then(() => task(), () => task());
    tail = run.catch(() => {});
    return run;
  };
}

function clonePlain(value) {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function invalidateProjectItemCaches(projectId, itemId) {
  const cacheKey = `${projectId}|${itemId}`;
  itemTipCache.delete(cacheKey);
  itemEntityCache.delete(cacheKey);
  resolvedItemRefsCache.delete(cacheKey);
  resolvedAutomationItemCache.delete(cacheKey);
}

function buildPersistentArtifactStoreKey(bucketKey, cacheKey) {
  return `${bucketKey}|${cacheKey}`;
}

function isPersistentArtifactEntryFresh(entry, now = Date.now()) {
  const createdAt = Date.parse(entry?.createdAt || entry?.updatedAt || 0);
  return Number.isFinite(createdAt) && (now - createdAt) <= PERSISTENT_ARTIFACT_CACHE_TTL_MS;
}

function shouldVerifyPersistentArtifact(entry, now = Date.now()) {
  const lastVerifiedAt = Date.parse(entry?.lastVerifiedAt || 0);
  if (!Number.isFinite(lastVerifiedAt)) {
    return true;
  }
  return (now - lastVerifiedAt) > PERSISTENT_ARTIFACT_VERIFY_TTL_MS;
}

function createJsonPersistentArtifactStore(filePath) {
  const entries = new Map();
  const withLock = createAsyncTaskQueue();
  let initialized = false;

  function pruneLocked(now = Date.now()) {
    for (const [key, entry] of entries) {
      if (!isPersistentArtifactEntryFresh(entry, now)) {
        entries.delete(key);
      }
    }
  }

  function serializeLocked() {
    return Array.from(entries.values()).map((entry) => clonePlain(entry));
  }

  async function persistLocked() {
    await writeJsonFile(filePath, serializeLocked());
  }

  return {
    backend: 'json',
    filePath,

    async init() {
      return withLock(async () => {
        if (initialized) {
          return;
        }
        const snapshot = await readJsonFile(filePath, [], { context: 'artifact stage cache' });
        entries.clear();
        for (const entry of Array.isArray(snapshot) ? snapshot : []) {
          const key = buildPersistentArtifactStoreKey(entry?.bucketKey, entry?.cacheKey);
          if (!entry?.bucketKey || !entry?.cacheKey || !entry?.objectKey) {
            continue;
          }
          entries.set(key, clonePlain(entry));
        }
        pruneLocked();
        initialized = true;
        await persistLocked();
      });
    },

    async get(bucketKey, cacheKey) {
      await this.init();
      return withLock(async () => {
        pruneLocked();
        return clonePlain(entries.get(buildPersistentArtifactStoreKey(bucketKey, cacheKey)) || null);
      });
    },

    async upsert(entry) {
      await this.init();
      return withLock(async () => {
        const nextEntry = {
          ...clonePlain(entry),
          createdAt: entry?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const key = buildPersistentArtifactStoreKey(nextEntry.bucketKey, nextEntry.cacheKey);
        entries.set(key, nextEntry);
        pruneLocked();
        await persistLocked();
        return clonePlain(nextEntry);
      });
    },

    async touch(bucketKey, cacheKey, updates = {}) {
      await this.init();
      return withLock(async () => {
        const key = buildPersistentArtifactStoreKey(bucketKey, cacheKey);
        const current = entries.get(key);
        if (!current) {
          return null;
        }
        const nextEntry = {
          ...current,
          ...clonePlain(updates),
          updatedAt: new Date().toISOString(),
        };
        entries.set(key, nextEntry);
        pruneLocked();
        await persistLocked();
        return clonePlain(nextEntry);
      });
    },

    async clear() {
      await this.init();
      return withLock(async () => {
        const cleared = entries.size;
        entries.clear();
        await persistLocked();
        return cleared;
      });
    },

    async delete(bucketKey, cacheKey) {
      await this.init();
      return withLock(async () => {
        const key = buildPersistentArtifactStoreKey(bucketKey, cacheKey);
        const existed = entries.delete(key);
        if (existed) {
          await persistLocked();
        }
        return existed;
      });
    },
  };
}

function createSqlitePersistentArtifactStore(filePath, { legacyJsonPath = null } = {}) {
  if (!DatabaseSync) {
    return null;
  }

  const withLock = createAsyncTaskQueue();
  let initialized = false;
  let db = null;
  let statements = null;

  function openDatabaseLocked() {
    if (db) {
      return db;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    db = new DatabaseSync(filePath);
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS artifact_stage_cache (
        bucket_key TEXT NOT NULL,
        cache_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (bucket_key, cache_key)
      );
      CREATE INDEX IF NOT EXISTS idx_artifact_stage_cache_updated_at
        ON artifact_stage_cache (updated_at DESC, bucket_key ASC, cache_key ASC);
    `);
    return db;
  }

  function prepareStatementsLocked() {
    if (statements) {
      return statements;
    }
    const database = openDatabaseLocked();
    statements = {
      get: database.prepare('SELECT payload_json FROM artifact_stage_cache WHERE bucket_key = ? AND cache_key = ?'),
      list: database.prepare('SELECT bucket_key, cache_key, payload_json FROM artifact_stage_cache'),
      count: database.prepare('SELECT COUNT(*) AS count FROM artifact_stage_cache'),
      upsert: database.prepare(`
        INSERT INTO artifact_stage_cache (bucket_key, cache_key, created_at, updated_at, payload_json)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(bucket_key, cache_key) DO UPDATE SET
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          payload_json = excluded.payload_json
      `),
      delete: database.prepare('DELETE FROM artifact_stage_cache WHERE bucket_key = ? AND cache_key = ?'),
      clear: database.prepare('DELETE FROM artifact_stage_cache'),
    };
    return statements;
  }

  function deserializeEntry(row) {
    if (!row?.payload_json) {
      return null;
    }
    try {
      return clonePlain(JSON.parse(row.payload_json));
    } catch (error) {
      logger.error('artifact-stage.sqlite.deserialize-failed', { filePath, error });
      return null;
    }
  }

  function normalizeEntry(entry, existingEntry = null) {
    const nextEntry = {
      ...clonePlain(existingEntry || {}),
      ...clonePlain(entry || {}),
      bucketKey: String(entry?.bucketKey || existingEntry?.bucketKey || '').trim(),
      cacheKey: String(entry?.cacheKey || existingEntry?.cacheKey || '').trim(),
      objectKey: String(entry?.objectKey || existingEntry?.objectKey || '').trim(),
      createdAt: String(entry?.createdAt || existingEntry?.createdAt || new Date().toISOString()).trim() || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (!nextEntry.bucketKey || !nextEntry.cacheKey || !nextEntry.objectKey) {
      throw new Error('Artifact cache entries require bucketKey, cacheKey, and objectKey.');
    }
    return nextEntry;
  }

  function deleteLocked(bucketKey, cacheKey) {
    const { delete: deleteStmt } = prepareStatementsLocked();
    const result = deleteStmt.run(String(bucketKey || '').trim(), String(cacheKey || '').trim());
    return Number(result?.changes || 0) > 0;
  }

  function pruneExpiredLocked(now = Date.now()) {
    const { list } = prepareStatementsLocked();
    for (const row of list.all()) {
      const entry = deserializeEntry(row);
      if (!entry || !isPersistentArtifactEntryFresh(entry, now)) {
        deleteLocked(row?.bucket_key, row?.cache_key);
      }
    }
  }

  async function migrateLegacyJsonLocked() {
    if (!legacyJsonPath || !(await pathExists(legacyJsonPath))) {
      return;
    }
    const { count, upsert } = prepareStatementsLocked();
    const existingCount = Number(count.get()?.count || 0);
    if (existingCount > 0) {
      return;
    }

    let snapshot = [];
    try {
      snapshot = await readJsonFile(legacyJsonPath, [], {
        allowMissing: true,
        context: 'legacy artifact stage cache',
      });
    } catch (error) {
      const backupPath = `${legacyJsonPath}.corrupt-${compactTimestamp()}`;
      try {
        await fsp.rename(legacyJsonPath, backupPath);
      } catch (_renameError) {
        // Ignore best-effort corruption backup failures.
      }
      logger.warn('artifact-stage.sqlite.migrate-legacy-read-failed', { filePath, legacyJsonPath, backupPath, error });
      return;
    }

    const entries = (Array.isArray(snapshot) ? snapshot : [])
      .filter((entry) => entry?.bucketKey && entry?.cacheKey && entry?.objectKey)
      .map((entry) => normalizeEntry(entry));
    if (!entries.length) {
      return;
    }

    const transaction = openDatabaseLocked().transaction((migrateEntries) => {
      let migratedCount = 0;
      for (const entry of migrateEntries) {
        upsert.run(entry.bucketKey, entry.cacheKey, entry.createdAt, entry.updatedAt, JSON.stringify(entry));
        migratedCount += 1;
      }
      return migratedCount;
    });

    const migratedCount = transaction(entries);
    const backupPath = `${legacyJsonPath}.migrated-${compactTimestamp()}`;
    try {
      await fsp.rename(legacyJsonPath, backupPath);
      logger.info('artifact-stage.sqlite.migrated-legacy-json', { filePath, legacyJsonPath, backupPath, migratedCount });
    } catch (error) {
      logger.warn('artifact-stage.sqlite.migrate-rename-failed', { filePath, legacyJsonPath, migratedCount, error });
    }
  }

  return {
    backend: 'sqlite',
    filePath,

    async init() {
      return withLock(async () => {
        if (initialized) {
          return;
        }
        openDatabaseLocked();
        prepareStatementsLocked();
        await migrateLegacyJsonLocked();
        pruneExpiredLocked();
        initialized = true;
      });
    },

    async get(bucketKey, cacheKey) {
      await this.init();
      return withLock(async () => {
        const { get } = prepareStatementsLocked();
        const normalizedBucketKey = String(bucketKey || '').trim();
        const normalizedCacheKey = String(cacheKey || '').trim();
        const entry = deserializeEntry(get.get(normalizedBucketKey, normalizedCacheKey));
        if (!entry) {
          return null;
        }
        if (!isPersistentArtifactEntryFresh(entry)) {
          deleteLocked(normalizedBucketKey, normalizedCacheKey);
          return null;
        }
        return clonePlain(entry);
      });
    },

    async upsert(entry) {
      await this.init();
      return withLock(async () => {
        const { get, upsert } = prepareStatementsLocked();
        const existingEntry = deserializeEntry(get.get(String(entry?.bucketKey || '').trim(), String(entry?.cacheKey || '').trim()));
        const nextEntry = normalizeEntry(entry, existingEntry);
        upsert.run(nextEntry.bucketKey, nextEntry.cacheKey, nextEntry.createdAt, nextEntry.updatedAt, JSON.stringify(nextEntry));
        return clonePlain(nextEntry);
      });
    },

    async touch(bucketKey, cacheKey, updates = {}) {
      await this.init();
      return withLock(async () => {
        const { get, upsert } = prepareStatementsLocked();
        const normalizedBucketKey = String(bucketKey || '').trim();
        const normalizedCacheKey = String(cacheKey || '').trim();
        const currentEntry = deserializeEntry(get.get(normalizedBucketKey, normalizedCacheKey));
        if (!currentEntry) {
          return null;
        }
        const nextEntry = normalizeEntry({
          ...currentEntry,
          ...clonePlain(updates),
          bucketKey: normalizedBucketKey,
          cacheKey: normalizedCacheKey,
        }, currentEntry);
        upsert.run(nextEntry.bucketKey, nextEntry.cacheKey, nextEntry.createdAt, nextEntry.updatedAt, JSON.stringify(nextEntry));
        return clonePlain(nextEntry);
      });
    },

    async clear() {
      await this.init();
      return withLock(async () => {
        const { count, clear } = prepareStatementsLocked();
        const existingCount = Number(count.get()?.count || 0);
        clear.run();
        return existingCount;
      });
    },

    async delete(bucketKey, cacheKey) {
      await this.init();
      return withLock(async () => deleteLocked(bucketKey, cacheKey));
    },
  };
}

function createPersistentArtifactStore(filePath, { legacyJsonPath = null } = {}) {
  if (DatabaseSync) {
    logger.info('artifact-stage.store.selected', { backend: 'sqlite', filePath, legacyJsonPath });
    return createSqlitePersistentArtifactStore(filePath, { legacyJsonPath });
  }
  logger.warn('artifact-stage.store.fallback-json', {
    backend: 'json',
    filePath: legacyJsonPath || filePath,
    reason: 'node:sqlite was unavailable in this Node runtime.',
  });
  return createJsonPersistentArtifactStore(legacyJsonPath || filePath);
}

function createJsonSessionJobStore(filePath) {
  const sessions = new Map();
  const withLock = createAsyncTaskQueue();
  let initialized = false;

  function flattenJobsLocked() {
    const jobs = [];
    for (const sessionJobs of sessions.values()) {
      for (const job of sessionJobs.values()) {
        jobs.push(job);
      }
    }
    return jobs;
  }

  function loadSnapshotIntoMemoryLocked(snapshot) {
    sessions.clear();
    const jobs = Array.isArray(snapshot) ? snapshot : [];
    for (const entry of jobs) {
      const sessionId = String(entry?.sessionId || '').trim();
      const jobId = String(entry?.id || '').trim();
      if (!sessionId || !jobId) {
        continue;
      }
      let sessionJobs = sessions.get(sessionId);
      if (!sessionJobs) {
        sessionJobs = new Map();
        sessions.set(sessionId, sessionJobs);
      }
      sessionJobs.set(jobId, clonePlain(entry));
    }
  }

  async function persistLocked() {
    await writeJsonFile(filePath, flattenJobsLocked());
  }

  async function recoverCorruptSnapshotLocked(error) {
    const backupPath = `${filePath}.corrupt-${compactTimestamp()}`;
    try {
      if (await pathExists(filePath)) {
        await fsp.rename(filePath, backupPath);
        logger.error('jobs.snapshot.recovered-corrupt', { filePath, backupPath });
      }
    } catch (renameError) {
      logger.error('jobs.snapshot.recover-rename-failed', { filePath, error: renameError });
    }
    logger.error('jobs.snapshot.reset-after-recovery', { filePath, error });
    loadSnapshotIntoMemoryLocked([]);
    await persistLocked();
  }

  return {
    backend: 'json',
    filePath,

    async init() {
      return withLock(async () => {
        if (initialized) {
          return;
        }
        const fileExisted = await pathExists(filePath);
        try {
          const snapshot = await readJsonFile(filePath, [], { context: 'job snapshot' });
          if (!Array.isArray(snapshot)) {
            throw new Error(`Expected ${filePath} to contain a JSON array.`);
          }
          loadSnapshotIntoMemoryLocked(snapshot);
          if (!fileExisted) {
            await persistLocked();
          }
        } catch (error) {
          await recoverCorruptSnapshotLocked(error);
        }
        initialized = true;
      });
    },

    async upsert(job) {
      await this.init();
      return withLock(async () => {
        const sessionId = String(job?.sessionId || '').trim();
        const jobId = String(job?.id || '').trim();
        if (!sessionId || !jobId) {
          throw new Error('Cannot store a job without both sessionId and id.');
        }

        let sessionJobs = sessions.get(sessionId);
        if (!sessionJobs) {
          sessionJobs = new Map();
          sessions.set(sessionId, sessionJobs);
        }

        const currentJob = sessionJobs.get(jobId) || null;
        const nextJob = mergeStoredJobRecord(job, currentJob);
        const changed = JSON.stringify(currentJob) !== JSON.stringify(nextJob);
        if (changed) {
          sessionJobs.set(jobId, nextJob);
          await persistLocked();
        }
        return clonePlain(sessionJobs.get(jobId));
      });
    },

    async get(sessionId, id) {
      await this.init();
      return withLock(async () => {
        const sessionJobs = sessions.get(String(sessionId || '').trim());
        if (!sessionJobs) {
          return null;
        }
        return clonePlain(sessionJobs.get(String(id || '').trim()) || null);
      });
    },

    async list(sessionId) {
      await this.init();
      return withLock(async () => {
        const sessionJobs = sessions.get(String(sessionId || '').trim());
        if (!sessionJobs) {
          return [];
        }
        return Array.from(sessionJobs.values(), (job) => clonePlain(job));
      });
    },

    async clear(sessionId) {
      await this.init();
      return withLock(async () => {
        const key = String(sessionId || '').trim();
        if (!sessions.has(key)) {
          return 0;
        }
        sessions.delete(key);
        await persistLocked();
        return 1;
      });
    },
  };
}

function createSqliteSessionJobStore(filePath, { legacyJsonPath = null } = {}) {
  if (!DatabaseSync) {
    return null;
  }

  const withLock = createAsyncTaskQueue();
  let initialized = false;
  let db = null;
  let statements = null;

  function openDatabaseLocked() {
    if (db) {
      return db;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    db = new DatabaseSync(filePath);
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS session_jobs (
        session_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (session_id, job_id)
      );
      CREATE INDEX IF NOT EXISTS idx_session_jobs_session_created_at
        ON session_jobs (session_id, created_at DESC, job_id ASC);
    `);
    return db;
  }

  function prepareStatementsLocked() {
    if (statements) {
      return statements;
    }
    const database = openDatabaseLocked();
    statements = {
      get: database.prepare('SELECT payload_json FROM session_jobs WHERE session_id = ? AND job_id = ?'),
      list: database.prepare('SELECT payload_json FROM session_jobs WHERE session_id = ? ORDER BY created_at DESC, job_id ASC'),
      count: database.prepare('SELECT COUNT(*) AS count FROM session_jobs'),
      upsert: database.prepare(`
        INSERT INTO session_jobs (session_id, job_id, created_at, updated_at, payload_json)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(session_id, job_id) DO UPDATE SET
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          payload_json = excluded.payload_json
      `),
      clear: database.prepare('DELETE FROM session_jobs WHERE session_id = ?'),
    };
    return statements;
  }

  function deserializeJobPayload(row) {
    if (!row?.payload_json) {
      return null;
    }
    try {
      return clonePlain(JSON.parse(row.payload_json));
    } catch (error) {
      logger.error('jobs.sqlite.deserialize-failed', { filePath, error });
      return null;
    }
  }

  async function migrateLegacyJsonLocked() {
    if (!legacyJsonPath || !(await pathExists(legacyJsonPath))) {
      return;
    }

    const { count, upsert } = prepareStatementsLocked();
    const existingCount = Number(count.get()?.count || 0);
    if (existingCount > 0) {
      return;
    }

    let snapshot = [];
    try {
      snapshot = await readJsonFile(legacyJsonPath, [], {
        allowMissing: true,
        context: 'legacy job snapshot',
      });
    } catch (error) {
      const backupPath = `${legacyJsonPath}.corrupt-${compactTimestamp()}`;
      try {
        await fsp.rename(legacyJsonPath, backupPath);
      } catch (_renameError) {
        // Ignore rename issues during best-effort migration recovery.
      }
      logger.warn('jobs.sqlite.migrate-legacy-read-failed', { filePath, legacyJsonPath, backupPath, error });
      return;
    }
    const jobs = Array.isArray(snapshot) ? snapshot : [];
    if (!jobs.length) {
      return;
    }

    const transaction = openDatabaseLocked().transaction((entries) => {
      let migratedCount = 0;
      for (const entry of entries) {
        const sessionId = String(entry?.sessionId || '').trim();
        const jobId = String(entry?.id || '').trim();
        if (!sessionId || !jobId) {
          continue;
        }
        const storedJob = {
          ...clonePlain(entry),
          sessionId,
          id: jobId,
          createdAt: String(entry?.createdAt || entry?.updatedAt || new Date().toISOString()),
          updatedAt: String(entry?.updatedAt || entry?.createdAt || new Date().toISOString()),
        };
        upsert.run(sessionId, jobId, storedJob.createdAt, storedJob.updatedAt, JSON.stringify(storedJob));
        migratedCount += 1;
      }
      return migratedCount;
    });

    const migratedCount = transaction(jobs);
    const backupPath = `${legacyJsonPath}.migrated-${compactTimestamp()}`;
    try {
      await fsp.rename(legacyJsonPath, backupPath);
      logger.info('jobs.sqlite.migrated-legacy-json', { filePath, legacyJsonPath, backupPath, migratedCount });
    } catch (error) {
      logger.warn('jobs.sqlite.migrate-rename-failed', { filePath, legacyJsonPath, migratedCount, error });
    }
  }

  function normalizeStoredJob(job, existingJob = null) {
    return mergeStoredJobRecord(job, existingJob);
  }

  return {
    backend: 'sqlite',
    filePath,

    async init() {
      return withLock(async () => {
        if (initialized) {
          return;
        }
        openDatabaseLocked();
        prepareStatementsLocked();
        await migrateLegacyJsonLocked();
        initialized = true;
      });
    },

    async upsert(job) {
      await this.init();
      return withLock(async () => {
        const { get, upsert } = prepareStatementsLocked();
        const sessionId = String(job?.sessionId || '').trim();
        const jobId = String(job?.id || '').trim();
        const existingJob = deserializeJobPayload(get.get(sessionId, jobId));
        const nextJob = normalizeStoredJob(job, existingJob);
        upsert.run(sessionId, jobId, nextJob.createdAt, nextJob.updatedAt, JSON.stringify(nextJob));
        return clonePlain(nextJob);
      });
    },

    async get(sessionId, id) {
      await this.init();
      return withLock(async () => {
        const { get } = prepareStatementsLocked();
        return deserializeJobPayload(get.get(String(sessionId || '').trim(), String(id || '').trim()));
      });
    },

    async list(sessionId) {
      await this.init();
      return withLock(async () => {
        const { list } = prepareStatementsLocked();
        return list
          .all(String(sessionId || '').trim())
          .map((row) => deserializeJobPayload(row))
          .filter(Boolean);
      });
    },

    async clear(sessionId) {
      await this.init();
      return withLock(async () => {
        const { clear } = prepareStatementsLocked();
        const result = clear.run(String(sessionId || '').trim());
        return Number(result?.changes || 0);
      });
    },
  };
}

function createSessionJobStore(filePath, { legacyJsonPath = null } = {}) {
  if (DatabaseSync) {
    logger.info('jobs.store.selected', { backend: 'sqlite', filePath, legacyJsonPath });
    return createSqliteSessionJobStore(filePath, { legacyJsonPath });
  }
  logger.warn('jobs.store.fallback-json', {
    backend: 'json',
    filePath: legacyJsonPath || filePath,
    reason: 'node:sqlite was unavailable in this Node runtime.',
  });
  return createJsonSessionJobStore(legacyJsonPath || filePath);
}

async function exportJobsSnapshotToJsonFile(sessionId) {
  const jobs = await listJobsForSession(sessionId);
  const safeSessionId = String(sessionId || 'session').replace(/[^a-z0-9._-]+/gi, '-').replace(/\.+/g, '_').replace(/^-+|-+$/g, '') || 'session';
  const exportFilePath = path.join(JOBS_EXPORT_DIR, `jobs-${safeSessionId}.json`);
  await writeJsonFile(exportFilePath, jobs);
  return exportFilePath;
}

async function upsertJob(job) {
  const stored = await jobsStore.upsert(job);
  broadcastSessionEvent(stored?.sessionId, {
    type: 'job-updated',
    job: serializeJob(stored),
  });
  return stored;
}

async function getSessionJob(sessionId, id) {
  return jobsStore.get(sessionId, id);
}

async function listJobsForSession(sessionId) {
  return jobsStore.list(sessionId);
}

async function clearJobsForSession(sessionId) {
  const cleared = await jobsStore.clear(sessionId);
  broadcastSessionEvent(sessionId, {
    type: 'jobs-cleared',
    sessionId,
  });
  return cleared;
}

async function clearArtifactStageCache() {
  return artifactStageStore.clear();
}

function isTerminalAutomationStatus(status) {
  const normalized = String(status || '').toLowerCase();
  return normalized === 'success'
    || normalized === 'cancelled'
    || normalized === 'timeout'
    || normalized.startsWith('failed');
}

function isTerminalAccUploadStatus(status) {
  const normalized = String(status || '').toLowerCase();
  return normalized === 'uploaded'
    || normalized === 'failed'
    || normalized === 'skipped-locked'
    || normalized === 'locked'
    || normalized === 'pending-auth'
    || normalized === 'not-applicable';
}

function isDependencyWaitingAccUpload(job) {
  const status = String(job?.accUpload?.status || '').toLowerCase();
  if (status === 'waiting-dependencies') {
    return true;
  }
  return status === 'pending'
    && Array.isArray(job?.accUpload?.pendingDependencies)
    && job.accUpload.pendingDependencies.length > 0;
}

function getDependencyItemIds(dependencies) {
  return (Array.isArray(dependencies) ? dependencies : [])
    .map((dependency) => String(dependency?.itemId || '').trim())
    .filter(Boolean);
}

function normalizePendingDependencies(dependencies) {
  const unique = [];
  const seen = new Set();

  for (const dependency of Array.isArray(dependencies) ? dependencies : []) {
    const itemId = String(dependency?.itemId || '').trim();
    if (!itemId || seen.has(itemId)) {
      continue;
    }
    seen.add(itemId);
    unique.push({
      itemId,
      displayName: String(dependency?.displayName || itemId).trim() || itemId,
      status: String(dependency?.status || '').trim() || undefined,
    });
  }

  return unique;
}

function buildPendingDependencySignature(dependencies) {
  return normalizePendingDependencies(dependencies)
    .map((dependency) => `${dependency.itemId}:${dependency.status || ''}`)
    .sort()
    .join('|');
}

function shouldWakeBatchDependents(job) {
  const uploadStatus = String(job?.accUpload?.status || '').toLowerCase();
  return uploadStatus === 'uploaded'
    || uploadStatus === 'failed'
    || uploadStatus === 'skipped-locked'
    || uploadStatus === 'locked'
    || uploadStatus === 'pending-auth'
    || uploadStatus === 'not-applicable';
}

function dedupeFailedDependencyItems(dependencies) {
  const unique = [];
  const seen = new Set();

  for (const dependency of Array.isArray(dependencies) ? dependencies : []) {
    const itemId = String(dependency?.itemId || '').trim();
    if (!itemId || seen.has(itemId)) {
      continue;
    }
    seen.add(itemId);
    unique.push({
      itemId,
      displayName: String(dependency?.displayName || itemId).trim() || itemId,
      status: String(dependency?.status || '').trim() || undefined,
      reason: String(dependency?.reason || '').trim() || undefined,
    });
  }

  return unique;
}

function getPublishSccMemberJobs(scc, batchJobsByItemId) {
  if (!scc || !Array.isArray(scc.members)) {
    return [];
  }
  return scc.members
    .map((member) => batchJobsByItemId.get(String(member?.itemId || '').trim()))
    .filter(Boolean)
    .sort(compareBatchSubmissionOrder);
}

function isInternalPublishSccDependency(job, dependency) {
  const currentScc = getJobPublishScc(job);
  return Boolean(currentScc && dependency?.isCircular && String(dependency?.sccId || '').trim() === String(currentScc.id || '').trim());
}

function assessExternalPublishDependencies(job, batchJobsByItemId) {
  const pendingDependencies = [];
  const failedDependencies = [];
  const resolvedDependencyVersionIds = {};

  for (const dependency of Array.isArray(job?.publishDependencies) ? job.publishDependencies : []) {
    if (isInternalPublishSccDependency(job, dependency)) {
      continue;
    }

    const dependencyJob = batchJobsByItemId.get(dependency.itemId);
    if (!dependencyJob) {
      pendingDependencies.push({
        ...dependency,
        status: 'pending',
      });
      continue;
    }

    const automationStatus = String(dependencyJob.status || '').toLowerCase();
    const accUploadStatus = String(dependencyJob.accUpload?.status || '').toLowerCase();
    const publishedVersionId = String(dependencyJob.accUpload?.versionId || '').trim();

    if (automationStatus === 'success' && accUploadStatus === 'uploaded' && publishedVersionId) {
      resolvedDependencyVersionIds[dependency.itemId] = publishedVersionId;
      continue;
    }

    if (isTerminalAutomationStatus(automationStatus) && automationStatus !== 'success') {
      failedDependencies.push({
        ...dependency,
        status: automationStatus,
        reason: dependencyJob.accUpload?.message || 'The dependency did not complete successfully in Design Automation.',
      });
      continue;
    }

    if (automationStatus === 'success' && isTerminalAccUploadStatus(accUploadStatus) && accUploadStatus !== 'uploaded') {
      failedDependencies.push({
        ...dependency,
        status: accUploadStatus || 'failed',
        reason: dependencyJob.accUpload?.message || 'The dependency could not be published back to ACC.',
      });
      continue;
    }

    pendingDependencies.push({
      ...dependency,
      status: accUploadStatus || automationStatus || 'pending',
    });
  }

  return {
    pendingDependencies: normalizePendingDependencies(pendingDependencies),
    failedDependencies: dedupeFailedDependencyItems(failedDependencies),
    resolvedDependencyVersionIds,
  };
}

function buildSccSyntheticPendingDependencies(entries, status, excludeItemId = null) {
  return normalizePendingDependencies((Array.isArray(entries) ? entries : []).map((entry) => {
    const job = entry?.job || entry;
    const itemId = String(job?.sourceItemId || job?.itemId || '').trim();
    if (!itemId || itemId === String(excludeItemId || '').trim()) {
      return null;
    }
    return {
      itemId,
      displayName: String(job?.inputFileName || job?.displayName || itemId).trim() || itemId,
      status,
    };
  }).filter(Boolean));
}

function buildSccSyntheticFailedDependencies(entries, status, excludeItemId = null, defaultReason = '') {
  return dedupeFailedDependencyItems((Array.isArray(entries) ? entries : []).map((entry) => {
    const job = entry?.job || entry;
    const itemId = String(job?.sourceItemId || job?.itemId || '').trim();
    if (!itemId || itemId === String(excludeItemId || '').trim()) {
      return null;
    }
    const dependencyNames = Array.isArray(entry?.dependencies)
      ? entry.dependencies.map((dependency) => String(dependency?.displayName || dependency?.itemId || '').trim()).filter(Boolean)
      : [];
    const reason = String(entry?.reason || '').trim()
      || (dependencyNames.length ? `Waiting on ${dependencyNames.join(', ')}.` : '')
      || String(job?.accUpload?.message || '').trim()
      || defaultReason;
    return {
      itemId,
      displayName: String(job?.inputFileName || job?.displayName || itemId).trim() || itemId,
      status,
      reason,
    };
  }).filter(Boolean));
}

function shouldCountPendingPublishDependent(job) {
  if (!job) {
    return false;
  }
  const automationStatus = String(job?.status || '').toLowerCase();
  const accUploadStatus = String(job?.accUpload?.status || '').toLowerCase();
  return automationStatus === 'success' && !isTerminalAccUploadStatus(accUploadStatus);
}

function buildPublishSccCandidateMetrics(candidateJob, publishScc, batchJobsByItemId) {
  const candidateItemId = String(candidateJob?.sourceItemId || '').trim();
  const currentSccId = String(publishScc?.id || '').trim();
  let internalDependentCount = 0;
  let externalDependentCount = 0;
  let waitingDependentCount = 0;

  for (const otherJob of batchJobsByItemId.values()) {
    if (!otherJob || String(otherJob?.sourceItemId || '').trim() === candidateItemId) {
      continue;
    }
    if (!shouldCountPendingPublishDependent(otherJob)) {
      continue;
    }
    if (!getDependencyItemIds(otherJob?.publishDependencies).includes(candidateItemId)) {
      continue;
    }
    const otherSccId = String(getJobPublishScc(otherJob)?.id || '').trim();
    if (currentSccId && otherSccId && currentSccId === otherSccId) {
      internalDependentCount += 1;
    } else {
      externalDependentCount += 1;
    }
    if (String(otherJob?.accUpload?.status || '').toLowerCase() === 'waiting-dependencies') {
      waitingDependentCount += 1;
    }
  }

  const sizeHintBytes = getJobSizeHintBytes(candidateJob);
  const batchIndex = Number.isFinite(Number(candidateJob?.batchIndex)) ? Number(candidateJob.batchIndex) : Number.MAX_SAFE_INTEGER;
  const releaseScore = (externalDependentCount * 100) + (internalDependentCount * 10) + (waitingDependentCount * 5);
  return {
    itemId: candidateItemId,
    displayName: String(candidateJob?.inputFileName || candidateItemId).trim() || candidateItemId,
    internalDependentCount,
    externalDependentCount,
    waitingDependentCount,
    dependentCount: internalDependentCount + externalDependentCount,
    sizeHintBytes,
    batchIndex,
    releaseScore,
  };
}

function comparePublishSccCandidateMetrics(left, right) {
  const leftScore = Number(left?.releaseScore || 0);
  const rightScore = Number(right?.releaseScore || 0);
  if (leftScore !== rightScore) {
    return rightScore - leftScore;
  }
  const leftDependents = Number(left?.dependentCount || 0);
  const rightDependents = Number(right?.dependentCount || 0);
  if (leftDependents !== rightDependents) {
    return rightDependents - leftDependents;
  }
  const leftSize = Number(left?.sizeHintBytes || 0);
  const rightSize = Number(right?.sizeHintBytes || 0);
  if (leftSize !== rightSize) {
    return leftSize - rightSize;
  }
  return Number(left?.batchIndex || Number.MAX_SAFE_INTEGER) - Number(right?.batchIndex || Number.MAX_SAFE_INTEGER);
}

function buildPublishSccReleaseState(job, batchJobsByItemId) {
  const publishScc = getJobPublishScc(job);
  if (!publishScc) {
    return null;
  }

  const memberJobs = getPublishSccMemberJobs(publishScc, batchJobsByItemId);
  const failedAutomationMembers = [];
  const pendingAutomationMembers = [];

  for (const memberJob of memberJobs) {
    const automationStatus = String(memberJob?.status || '').toLowerCase();
    if (automationStatus === 'success') {
      continue;
    }
    if (isTerminalAutomationStatus(automationStatus) && automationStatus !== 'success') {
      failedAutomationMembers.push({
        job: memberJob,
        status: automationStatus || 'failed',
        reason: memberJob?.accUpload?.message || 'The SCC member did not complete successfully in Design Automation.',
      });
      continue;
    }
    pendingAutomationMembers.push({
      job: memberJob,
      status: automationStatus || 'pending',
    });
  }

  if (failedAutomationMembers.length) {
    return {
      status: 'blocked-automation',
      memberJobs,
      failedMembers: failedAutomationMembers,
    };
  }

  if (pendingAutomationMembers.length) {
    return {
      status: 'waiting-automation',
      memberJobs,
      pendingMembers: pendingAutomationMembers,
    };
  }

  const unpublishedMembers = memberJobs.filter((memberJob) => String(memberJob?.accUpload?.status || '').toLowerCase() !== 'uploaded');
  const eligibleMembers = [];
  const pendingExternalMembers = [];
  const blockedExternalMembers = [];

  for (const memberJob of unpublishedMembers) {
    const memberUploadStatus = String(memberJob?.accUpload?.status || '').toLowerCase();
    if (memberUploadStatus && isTerminalAccUploadStatus(memberUploadStatus) && memberUploadStatus !== 'uploaded') {
      blockedExternalMembers.push({
        job: memberJob,
        reason: memberJob?.accUpload?.message || 'The SCC member could not be published back to ACC.',
        dependencies: [],
      });
      continue;
    }

    const externalState = assessExternalPublishDependencies(memberJob, batchJobsByItemId);
    if (externalState.failedDependencies.length) {
      blockedExternalMembers.push({
        job: memberJob,
        dependencies: externalState.failedDependencies,
      });
      continue;
    }
    if (externalState.pendingDependencies.length) {
      pendingExternalMembers.push({
        job: memberJob,
        dependencies: externalState.pendingDependencies,
      });
      continue;
    }
    eligibleMembers.push({
      job: memberJob,
      resolvedDependencyVersionIds: externalState.resolvedDependencyVersionIds,
    });
  }

  if (eligibleMembers.length) {
    const rankedEligibleMembers = eligibleMembers
      .map((entry) => ({
        ...entry,
        metrics: buildPublishSccCandidateMetrics(entry.job, publishScc, batchJobsByItemId),
      }))
      .sort((left, right) => comparePublishSccCandidateMetrics(left.metrics, right.metrics) || compareBatchSubmissionOrder(left.job, right.job));
    const activeLeaderEntry = rankedEligibleMembers[0];
    logger.info('publish.scc.release-selected', {
      batchId: job?.batchId || null,
      sccId: publishScc?.id || null,
      sourceItemId: job?.sourceItemId || null,
      sourceName: job?.inputFileName || null,
      candidateCount: rankedEligibleMembers.length,
      activeLeaderItemId: activeLeaderEntry?.job?.sourceItemId || null,
      activeLeaderDisplayName: activeLeaderEntry?.job?.inputFileName || null,
      candidateScores: rankedEligibleMembers.map((entry) => ({
        itemId: entry.metrics.itemId,
        displayName: entry.metrics.displayName,
        releaseScore: entry.metrics.releaseScore,
        externalDependentCount: entry.metrics.externalDependentCount,
        internalDependentCount: entry.metrics.internalDependentCount,
        waitingDependentCount: entry.metrics.waitingDependentCount,
        sizeHintBytes: entry.metrics.sizeHintBytes,
        batchIndex: entry.metrics.batchIndex,
      })),
    });
    return {
      status: 'ready',
      memberJobs,
      activeLeader: activeLeaderEntry.job,
      activeLeaderResolvedDependencyVersionIds: activeLeaderEntry.resolvedDependencyVersionIds,
      eligibleMembers: rankedEligibleMembers,
      pendingMembers: pendingExternalMembers,
      blockedMembers: blockedExternalMembers,
      candidateScores: rankedEligibleMembers.map((entry) => entry.metrics),
    };
  }

  if (pendingExternalMembers.length) {
    return {
      status: 'waiting-external',
      memberJobs,
      pendingMembers: pendingExternalMembers,
      blockedMembers: blockedExternalMembers,
    };
  }

  if (blockedExternalMembers.length) {
    return {
      status: 'blocked-external',
      memberJobs,
      blockedMembers: blockedExternalMembers,
    };
  }

  return {
    status: 'complete',
    memberJobs,
  };
}

async function wakeDependentBatchJobs(req, job) {
  if (!shouldWakeBatchDependents(job) || !job?.sessionId || !job?.batchId || !job?.sourceItemId) {
    return;
  }

  const sessionJobs = await listJobsForSession(job.sessionId);
  const currentScc = getJobPublishScc(job);
  const dependents = sessionJobs.filter((candidate) => {
    if (!candidate || candidate.id === job.id || candidate.batchId !== job.batchId) {
      return false;
    }
    const directDependency = getDependencyItemIds(candidate.publishDependencies).includes(String(job.sourceItemId || '').trim());
    const sharedScc = Boolean(currentScc && getJobPublishScc(candidate)?.id === currentScc.id);
    return directDependency || sharedScc;
  });

  const uniqueDependents = Array.from(new Map(dependents.map((candidate) => [candidate.id, candidate])).values());

  await mapWithConcurrency(uniqueDependents, 2, async (candidate) => {
    const latest = await getSessionJob(candidate.sessionId, candidate.id) || candidate;
    const automationStatus = String(latest?.status || '').toLowerCase();
    const uploadStatus = String(latest?.accUpload?.status || '').toLowerCase();
    if (automationStatus !== 'success') {
      return;
    }
    if (isTerminalAccUploadStatus(uploadStatus) || syncLocks.has(latest.id)) {
      return;
    }

    if (uploadStatus === 'waiting-dependencies') {
      const publishPlan = await buildAccPublishPlan(latest);
      logPublishPlanDecision(latest, publishPlan);
      if (publishPlan.status === 'waiting') {
        let waitingJob = await updateWaitingDependencyJob(latest, publishPlan.pendingDependencies);
        waitingJob = await persistPublishPlanSnapshot(waitingJob, publishPlan, {
          reason: buildWaitingDependenciesMessage(publishPlan.pendingDependencies),
          queueState: 'blocked',
        });
        return;
      }
    }

    await queueSuccessfulJobForPublish(req, latest, 'wake-dependent-batch-jobs');
  });

  scheduleBatchPublishQueue(req, job.sessionId, job.batchId, { reason: 'wake-dependent-batch-jobs' });
}

function summarizeDependencyDisplayNames(dependencies, { limit = 4 } = {}) {
  const list = (Array.isArray(dependencies) ? dependencies : [])
    .map((dependency) => String(dependency?.displayName || dependency?.itemId || '').trim())
    .filter(Boolean);
  if (!list.length) {
    return 'selected references';
  }
  const shown = list.slice(0, limit);
  return shown.length < list.length
    ? `${shown.join(', ')} (+${list.length - shown.length} more)`
    : shown.join(', ');
}

function buildWaitingDependenciesMessage(pendingDependencies) {
  return `Waiting to publish until selected referenced files finish publishing new ACC versions: ${summarizeDependencyDisplayNames(pendingDependencies)}.`;
}

function summarizeDependencyStatusesForLogging(dependencies) {
  return buildCountSummary((Array.isArray(dependencies) ? dependencies : []).map((dependency) => {
    const status = String(dependency?.status || dependency?.reason || '').trim();
    return status || 'pending';
  }));
}

function logPublishPlanDecision(job, publishPlan) {
  const publishScc = getJobPublishScc(job);
  logAutomationTiming('publish-plan', {
    workItemId: job?.workItemId || job?.id || null,
    sourceProjectId: job?.sourceProjectId || null,
    sourceItemId: job?.sourceItemId || null,
    sourceName: job?.inputFileName || null,
    planStatus: publishPlan?.status || 'unknown',
    refsCount: Array.isArray(publishPlan?.refs) ? publishPlan.refs.length : 0,
    pendingDependencyCount: Array.isArray(publishPlan?.pendingDependencies) ? publishPlan.pendingDependencies.length : 0,
    failedDependencyCount: Array.isArray(publishPlan?.failedDependencies) ? publishPlan.failedDependencies.length : 0,
    resolvedDependencyCount: Object.keys(publishPlan?.resolvedDependencyVersionIds || {}).length,
    releasedCircularDependencyCount: Array.isArray(publishPlan?.releasedCircularDependencies) ? publishPlan.releasedCircularDependencies.length : 0,
    pendingDependencyStatuses: summarizeDependencyStatusesForLogging(publishPlan?.pendingDependencies),
    failedDependencyStatuses: summarizeDependencyStatusesForLogging(publishPlan?.failedDependencies),
    sccId: publishScc?.id || null,
    sccSize: publishScc?.size || 0,
    sccLeaderItemId: publishScc?.leaderItemId || null,
    sccLeaderDisplayName: publishScc?.leaderDisplayName || null,
    sccCandidateScores: Array.isArray(publishPlan?.sccRelease?.candidateScores)
      ? publishPlan.sccRelease.candidateScores.map((entry) => `${entry.displayName}:${entry.releaseScore}`)
      : [],
    activeSccLeaderItemId: publishPlan?.sccRelease?.activeLeaderItemId || null,
    activeSccLeaderDisplayName: publishPlan?.sccRelease?.activeLeaderDisplayName || null,
    ...createImmediateTimingFields(),
    outcome: 'ok',
  });
}

function buildPublishPlanBlockers(job, publishPlan) {
  const dependencies = publishPlan?.status === 'blocked'
    ? (publishPlan.failedDependencies || [])
    : (publishPlan?.pendingDependencies || []);
  const blockerIds = dedupeStrings(dependencies.map((dependency) => dependency?.itemId));
  const blockerNames = dedupeStrings(dependencies.map((dependency) => dependency?.displayName));
  const currentSccId = String(job?.publishScc?.id || '').trim();
  const blockedBySccId = String(
    dependencies.find((dependency) => String(dependency?.sccId || '').trim() && String(dependency?.sccId || '').trim() === currentSccId)?.sccId
    || dependencies.find((dependency) => String(dependency?.sccId || '').trim())?.sccId
    || job?.publishQueue?.blockedBySccId
    || '',
  ).trim() || null;
  return { blockerIds, blockerNames, blockedBySccId };
}

async function persistPublishPlanSnapshot(job, publishPlan, { reason = '', queueState = '' } = {}) {
  const normalizedReason = String(reason || '').trim();
  const nextQueueState = String(queueState || '').trim()
    || (publishPlan?.status === 'ready'
      ? 'ready'
      : (publishPlan?.status === 'waiting' ? 'waiting' : (publishPlan?.status === 'blocked' ? 'blocked' : 'queued')));
  const { blockerIds, blockerNames, blockedBySccId } = buildPublishPlanBlockers(job, publishPlan);
  const updatedAt = new Date().toISOString();
  const enteredAt = String(job?.publishQueue?.enteredAt || job?.accUpload?.publishQueueEnteredAt || updatedAt).trim() || updatedAt;
  const nextJob = {
    ...job,
    publishPlan: {
      ...(job.publishPlan || {}),
      status: publishPlan?.status || 'unknown',
      lastEvaluatedAt: updatedAt,
      refsCount: Array.isArray(publishPlan?.refs) ? publishPlan.refs.length : 0,
      pendingDependencies: clonePlain(publishPlan?.pendingDependencies || []),
      failedDependencies: clonePlain(publishPlan?.failedDependencies || []),
      resolvedDependencyVersionIds: clonePlain(publishPlan?.resolvedDependencyVersionIds || {}),
      releasedCircularDependencies: clonePlain(publishPlan?.releasedCircularDependencies || []),
      sccRelease: clonePlain(publishPlan?.sccRelease || null),
    },
    publishQueue: {
      ...(job.publishQueue || {}),
      enteredAt,
      state: nextQueueState,
      blockedByJobIds: blockerIds,
      blockerNames,
      blockedBySccId,
      reason: normalizedReason || (publishPlan?.status === 'ready'
        ? 'Ready for ACC publish.'
        : (publishPlan?.status === 'blocked'
          ? 'Waiting on dependency publish state.'
          : 'Waiting for dependency publish state.')),
      lastEvaluatedAt: updatedAt,
    },
    accUpload: {
      ...(job.accUpload || {}),
      publishQueueEnteredAt: enteredAt,
      publishBlockedByJobIds: blockerIds,
      publishBlockedBySccId: blockedBySccId,
    },
  };

  const previousSignature = JSON.stringify({
    publishPlan: job?.publishPlan || null,
    publishQueue: job?.publishQueue || null,
    queue: {
      publishQueueEnteredAt: job?.accUpload?.publishQueueEnteredAt || null,
      publishBlockedByJobIds: job?.accUpload?.publishBlockedByJobIds || [],
      publishBlockedBySccId: job?.accUpload?.publishBlockedBySccId || null,
    },
  });
  const nextSignature = JSON.stringify({
    publishPlan: nextJob.publishPlan,
    publishQueue: nextJob.publishQueue,
    queue: {
      publishQueueEnteredAt: nextJob.accUpload.publishQueueEnteredAt,
      publishBlockedByJobIds: nextJob.accUpload.publishBlockedByJobIds,
      publishBlockedBySccId: nextJob.accUpload.publishBlockedBySccId,
    },
  });
  if (previousSignature === nextSignature) {
    return job;
  }
  return upsertJob(nextJob);
}

async function updateWaitingDependencyJob(job, pendingDependencies, { durationMs = null, waitStartedAt = null } = {}) {
  const normalizedPendingDependencies = normalizePendingDependencies(pendingDependencies);
  const nextMessage = buildWaitingDependenciesMessage(normalizedPendingDependencies);
  const previousPendingSignature = buildPendingDependencySignature(job?.accUpload?.pendingDependencies);
  const nextPendingSignature = buildPendingDependencySignature(normalizedPendingDependencies);
  const previousStatus = String(job?.accUpload?.status || '').toLowerCase();
  const previousMessage = String(job?.accUpload?.message || '');
  const previousWaitStartedAt = String(job?.accUpload?.waitStartedAt || '').trim();
  const updatedAt = new Date().toISOString();
  const resolvedWaitStartedAt = previousStatus === 'waiting-dependencies' && previousWaitStartedAt
    ? previousWaitStartedAt
    : (String(waitStartedAt || '').trim() || updatedAt);

  if (previousStatus === 'waiting-dependencies'
    && previousPendingSignature === nextPendingSignature
    && previousMessage === nextMessage
    && previousWaitStartedAt === resolvedWaitStartedAt) {
    return job;
  }

  const waitingJob = {
    ...job,
    accUpload: {
      ...(job.accUpload || {}),
      status: 'waiting-dependencies',
      message: nextMessage,
      pendingDependencies: normalizedPendingDependencies,
      waitStartedAt: resolvedWaitStartedAt,
      updatedAt,
      ...(durationMs == null ? {} : { durationMs }),
    },
  };
  await upsertJob(waitingJob);
  return waitingJob;
}

async function buildAccPublishPlan(job) {
  const publishRefs = Array.isArray(job.accPublishRefs) ? job.accPublishRefs : [];
  const defaultRefs = publishRefs.length
    ? dedupeAutomationVersionRefs(publishRefs.map((ref) => buildAutomationVersionRef(ref, ref.versionId)).filter(Boolean))
    : dedupeAutomationVersionRefs(Array.isArray(job.accVersionRefs) ? job.accVersionRefs : []);
  const publishDependencies = Array.isArray(job.publishDependencies) ? job.publishDependencies : [];
  const publishScc = getJobPublishScc(job);

  if (!job.batchId || (!publishDependencies.length && !publishScc) || !job.sessionId) {
    return {
      status: 'ready',
      refs: defaultRefs,
      resolvedDependencyVersionIds: {},
      releasedCircularDependencies: [],
      sccRelease: null,
    };
  }

  const sessionJobs = await listJobsForSession(job.sessionId);
  const batchJobs = sessionJobs.filter((candidate) => candidate?.batchId && candidate.batchId === job.batchId);
  const batchJobsByItemId = new Map(batchJobs.map((candidate) => [candidate.sourceItemId, candidate]));
  const pendingDependencies = [];
  const failedDependencies = [];
  const resolvedDependencyVersionIds = {};
  const releasedCircularDependencies = [];
  const sccReleaseState = publishScc ? buildPublishSccReleaseState(job, batchJobsByItemId) : null;
  const activeSccLeaderItemId = String(sccReleaseState?.activeLeader?.sourceItemId || '').trim();

  if (sccReleaseState?.status === 'blocked-automation') {
    failedDependencies.push(...buildSccSyntheticFailedDependencies(
      sccReleaseState.failedMembers,
      'scc-automation-failed',
      job.sourceItemId,
      'The circular publish group could not be released because at least one member failed Design Automation.',
    ));
  } else if (sccReleaseState?.status === 'blocked-external') {
    failedDependencies.push(...buildSccSyntheticFailedDependencies(
      sccReleaseState.blockedMembers,
      'scc-dependency-blocked',
      job.sourceItemId,
      'The circular publish group could not be released because all remaining members were blocked by external publish dependencies.',
    ));
  } else if (sccReleaseState?.status === 'waiting-automation') {
    pendingDependencies.push(...buildSccSyntheticPendingDependencies(sccReleaseState.pendingMembers, 'waiting-scc-members', job.sourceItemId));
  } else if (sccReleaseState?.status === 'waiting-external') {
    pendingDependencies.push(...buildSccSyntheticPendingDependencies(sccReleaseState.pendingMembers, 'waiting-scc-external', job.sourceItemId));
  } else if (sccReleaseState?.status === 'ready' && activeSccLeaderItemId && activeSccLeaderItemId !== String(job.sourceItemId || '').trim()) {
    pendingDependencies.push(...buildSccSyntheticPendingDependencies([sccReleaseState.activeLeader], 'waiting-scc-order', job.sourceItemId));
  }

  for (const dependency of publishDependencies) {
    const dependencyJob = batchJobsByItemId.get(dependency.itemId);
    if (!dependencyJob) {
      pendingDependencies.push(dependency);
      continue;
    }

    const automationStatus = String(dependencyJob.status || '').toLowerCase();
    const accUploadStatus = String(dependencyJob.accUpload?.status || '').toLowerCase();
    const publishedVersionId = String(dependencyJob.accUpload?.versionId || '').trim();

    if (automationStatus === 'success' && accUploadStatus === 'uploaded' && publishedVersionId) {
      resolvedDependencyVersionIds[dependency.itemId] = publishedVersionId;
      continue;
    }

    const fastOverlayVersionId = AUTOMATION_FAST_OVERLAY_PUBLISH
      && Boolean(job?.publishPlan?.fastPublishEligible)
      && normalizeCircularDependencyRelationType(dependency?.relationType) === 'overlay'
      ? String(job?.publishPlan?.selectedDependencyVersionIds?.[dependency.itemId] || dependency?.versionId || '').trim()
      : '';
    if (
      fastOverlayVersionId
      && automationStatus !== 'failed'
      && automationStatus !== 'cancelled'
      && automationStatus !== 'timeout'
      && accUploadStatus !== 'failed'
      && accUploadStatus !== 'locked'
      && accUploadStatus !== 'skipped-locked'
    ) {
      resolvedDependencyVersionIds[dependency.itemId] = fastOverlayVersionId;
      releasedCircularDependencies.push({
        ...dependency,
        status: 'released-overlay',
      });
      continue;
    }

    if (isInternalPublishSccDependency(job, dependency)) {
      if (sccReleaseState?.status === 'ready' && activeSccLeaderItemId === String(job.sourceItemId || '').trim()) {
        releasedCircularDependencies.push({
          ...dependency,
          status: 'released-scc',
        });
      }
      continue;
    }

    if (isTerminalAutomationStatus(automationStatus) && automationStatus !== 'success') {
      failedDependencies.push({
        ...dependency,
        status: automationStatus,
        reason: dependencyJob.accUpload?.message || 'The dependency did not complete successfully in Design Automation.',
      });
      continue;
    }

    if (automationStatus === 'success' && isTerminalAccUploadStatus(accUploadStatus) && accUploadStatus !== 'uploaded') {
      failedDependencies.push({
        ...dependency,
        status: accUploadStatus || 'failed',
        reason: dependencyJob.accUpload?.message || 'The dependency could not be published back to ACC.',
      });
      continue;
    }

    pendingDependencies.push({
      ...dependency,
      status: accUploadStatus || automationStatus || 'pending',
    });
  }

  const normalizedPendingDependencies = normalizePendingDependencies(pendingDependencies);
  const normalizedFailedDependencies = dedupeFailedDependencyItems(failedDependencies);

  if (normalizedFailedDependencies.length) {
    return {
      status: 'blocked',
      refs: defaultRefs,
      failedDependencies: normalizedFailedDependencies,
      resolvedDependencyVersionIds,
      releasedCircularDependencies,
      sccRelease: sccReleaseState ? {
        status: sccReleaseState.status,
        activeLeaderItemId: sccReleaseState.activeLeader?.sourceItemId || null,
        activeLeaderDisplayName: sccReleaseState.activeLeader?.inputFileName || null,
        candidateScores: clonePlain(sccReleaseState.candidateScores || []),
      } : null,
    };
  }

  if (normalizedPendingDependencies.length) {
    return {
      status: 'waiting',
      refs: defaultRefs,
      pendingDependencies: normalizedPendingDependencies,
      resolvedDependencyVersionIds,
      releasedCircularDependencies,
      sccRelease: sccReleaseState ? {
        status: sccReleaseState.status,
        activeLeaderItemId: sccReleaseState.activeLeader?.sourceItemId || null,
        activeLeaderDisplayName: sccReleaseState.activeLeader?.inputFileName || null,
        candidateScores: clonePlain(sccReleaseState.candidateScores || []),
      } : null,
    };
  }

  const resolvedRefs = publishRefs.length
    ? dedupeAutomationVersionRefs(
        publishRefs
          .map((ref) => buildAutomationVersionRef(ref, resolvedDependencyVersionIds[ref.itemId] || ref.versionId))
          .filter(Boolean),
      )
    : defaultRefs;

  return {
    status: 'ready',
    refs: resolvedRefs,
    resolvedDependencyVersionIds,
    releasedCircularDependencies,
    sccRelease: sccReleaseState ? {
      status: sccReleaseState.status,
      activeLeaderItemId: sccReleaseState.activeLeader?.sourceItemId || null,
      activeLeaderDisplayName: sccReleaseState.activeLeader?.inputFileName || null,
      candidateScores: clonePlain(sccReleaseState.candidateScores || []),
    } : null,
  };
}

async function promotePublishedArtifactToStageCache(config, job, published, publishedSizeBytes, { resolvedDependencyVersionIds = null } = {}) {
  const versionId = String(published?.version?.id || '').trim();
  const storageUrn = String(published?.storage?.id || '').trim();
  const cacheEntries = [];
  const preparedRefGraph = buildPreparedAutomationRefGraphFromJob(job, {
    resolvedDependencyVersionIds,
  });

  if (versionId) {
    cacheEntries.push({
      cacheKey: buildAutomationArtifactCacheKey(job.sourceProjectId, {
        itemId: job.sourceItemId,
        displayName: job.inputFileName,
        versionId,
      }),
      versionId,
      storageUrn,
    });
  }

  if (storageUrn) {
    const storageCacheKey = buildAutomationArtifactCacheKey(job.sourceProjectId, {
      itemId: job.sourceItemId,
      displayName: job.inputFileName,
      storageUrn,
    });
    if (!cacheEntries.some((entry) => entry.cacheKey === storageCacheKey)) {
      cacheEntries.push({
        cacheKey: storageCacheKey,
        versionId,
        storageUrn,
      });
    }
  }

  for (const entry of cacheEntries) {
    await artifactStageStore.upsert({
      bucketKey: config.bucketKey,
      cacheKey: entry.cacheKey,
      objectKey: job.outputObjectKey,
      displayName: job.inputFileName,
      versionId: entry.versionId || null,
      storageUrn: entry.storageUrn || '',
      sizeBytes: normalizeStorageSize(publishedSizeBytes ?? job?.stats?.bytesUploaded) || 0,
      partCount: Math.max(1, Number(published?.transfer?.partCount) || 1),
      transferMode: published?.transfer?.transferMode || 'stream',
      createdAt: new Date().toISOString(),
      lastVerifiedAt: new Date().toISOString(),
      projectId: job.sourceProjectId,
      itemId: job.sourceItemId,
      preparedRefGraph: preparedRefGraph || undefined,
    });
  }
}

async function getOssSignedDownload(config, token, bucketKey, objectKey) {
  const payload = await apsJson(
    `${APS_HOST}/oss/v2/buckets/${encodeURIComponent(bucketKey)}/objects/${encodeURIComponent(objectKey)}/signeds3download?minutesExpiration=5`,
    {
      token,
      headers: { 'x-ads-region': config.ossRegion },
      context: 'Could not create an OSS signed download URL',
    },
  );
  const url = payload?.url || payload?.signedUrl || (Array.isArray(payload?.urls) ? payload.urls[0] : null);
  if (!url) {
    throw httpError(500, 'APS did not return a signed download URL.');
  }
  return { url };
}

async function syncSuccessfulJobToAcc(req, job, { publishPlan: initialPublishPlan = null, publishQueueReason = 'unknown' } = {}) {
  if (syncLocks.has(job.id)) {
    const latest = await getSessionJob(job.sessionId, job.id);
    return latest || job;
  }
  syncLocks.add(job.id);

  const queueEnteredAt = String(job?.publishQueue?.enteredAt || job?.accUpload?.publishQueueEnteredAt || new Date().toISOString()).trim() || new Date().toISOString();
  const queueEnteredAtMs = parseTimestampMs(queueEnteredAt) || Date.now();
  const waitTimingWindow = {
    startedAtMs: queueEnteredAtMs,
    startedHr: getTimingStart(),
  };
  const timingBase = {
    parentStep: 'syncSuccessfulJobToAcc',
    workItemId: job.workItemId || job.id,
    sourceProjectId: job.sourceProjectId,
    sourceItemId: job.sourceItemId,
    sourceName: job.inputFileName,
    bucketKey: job.bucketKey,
    outputObjectKey: job.outputObjectKey,
    batchId: job.batchId || null,
    publishQueueReason,
  };
  const buildWaitTiming = (currentJob) => {
    const persistedWaitStartMs = parseTimestampMs(
      currentJob?.accUpload?.waitStartedAt
      || currentJob?.publishQueue?.enteredAt
      || currentJob?.accUpload?.publishQueueEnteredAt
      || currentJob?.accUpload?.updatedAt,
    );
    return String(currentJob?.accUpload?.status || '').toLowerCase() === 'waiting-dependencies' && persistedWaitStartMs !== null
      ? buildTimingFieldsFromMs(persistedWaitStartMs)
      : buildTimingFields(waitTimingWindow);
  };
  let phaseStep = 'wait-dependencies';
  let phaseTimingWindow = waitTimingWindow;

  try {
    const publishPlan = initialPublishPlan || await buildAccPublishPlan(job);
    logPublishPlanDecision(job, publishPlan);
    job = await persistPublishPlanSnapshot(job, publishPlan, {
      reason: publishPlan.status === 'ready'
        ? 'Ready for ACC publish.'
        : (publishPlan.status === 'blocked'
          ? 'Waiting on dependency publish state.'
          : 'Waiting for dependency publish state.'),
      queueState: publishPlan.status === 'ready' ? 'ready' : (publishPlan.status === 'blocked' ? 'blocked' : 'waiting'),
    });

    if (publishPlan.status === 'blocked') {
      const updatedAt = new Date().toISOString();
      const waitTiming = buildWaitTiming(job);
      const blockedJob = {
        ...job,
        publishQueue: {
          ...(job.publishQueue || {}),
          state: 'blocked',
          completedAt: updatedAt,
          queueWaitMs: waitTiming.criticalPathMs,
          reason: 'Skipped ACC publish because one or more dependencies could not be published.',
        },
        accUpload: {
          ...(job.accUpload || {}),
          status: 'failed',
          message: `Skipped ACC publish because selected referenced files did not complete a new ACC version: ${summarizeDependencyDisplayNames(publishPlan.failedDependencies)}.`,
          updatedAt,
          durationMs: waitTiming.criticalPathMs,
          publishQueueEnteredAt: queueEnteredAt,
          publishQueueWaitMs: waitTiming.criticalPathMs,
          publishCompletedAt: updatedAt,
          publishBlockedByJobIds: job?.publishQueue?.blockedByJobIds || [],
          publishBlockedBySccId: job?.publishQueue?.blockedBySccId || null,
        },
      };
      await upsertJob(blockedJob);
      await wakeDependentBatchJobs(req, blockedJob);
      logger.info('publish.queue.finished', {
        sessionId: blockedJob.sessionId,
        batchId: blockedJob.batchId,
        jobId: blockedJob.id,
        sourceItemId: blockedJob.sourceItemId,
        sourceName: blockedJob.inputFileName,
        outcome: 'blocked',
        failedDependencyCount: publishPlan.failedDependencies.length,
        waitMs: waitTiming.criticalPathMs,
      });
      logAutomationTiming('wait-dependencies', {
        ...timingBase,
        publishState: 'blocked-dependencies',
        failedDependencyCount: publishPlan.failedDependencies.length,
        ...waitTiming,
        outcome: 'error',
        error: blockedJob.accUpload.message,
      });
      return blockedJob;
    }

    if (publishPlan.status === 'waiting') {
      const waitTiming = buildWaitTiming(job);
      const alreadyWaiting = String(job?.accUpload?.status || '').toLowerCase() === 'waiting-dependencies';
      let waitingJob = await updateWaitingDependencyJob(job, publishPlan.pendingDependencies, {
        durationMs: waitTiming.criticalPathMs,
        waitStartedAt: queueEnteredAt,
      });
      waitingJob = await persistPublishPlanSnapshot(waitingJob, publishPlan, {
        reason: buildWaitingDependenciesMessage(publishPlan.pendingDependencies),
        queueState: 'blocked',
      });
      waitingJob = await upsertJob({
        ...waitingJob,
        publishQueue: {
          ...(waitingJob.publishQueue || {}),
          state: 'blocked',
          queueWaitMs: waitTiming.criticalPathMs,
          reason: buildWaitingDependenciesMessage(publishPlan.pendingDependencies),
        },
        accUpload: {
          ...(waitingJob.accUpload || {}),
          publishQueueEnteredAt: queueEnteredAt,
          publishQueueWaitMs: waitTiming.criticalPathMs,
          publishBlockedByJobIds: waitingJob?.publishQueue?.blockedByJobIds || [],
          publishBlockedBySccId: waitingJob?.publishQueue?.blockedBySccId || null,
        },
      });
      if (!alreadyWaiting) {
        logger.info('publish.queue.entered', {
          sessionId: waitingJob.sessionId,
          batchId: waitingJob.batchId,
          jobId: waitingJob.id,
          sourceItemId: waitingJob.sourceItemId,
          sourceName: waitingJob.inputFileName,
          blockerIds: waitingJob?.publishQueue?.blockedByJobIds || [],
          blockedBySccId: waitingJob?.publishQueue?.blockedBySccId || null,
          pendingDependencyCount: publishPlan.pendingDependencies.length,
        });
        logAutomationTiming('wait-dependencies', {
          ...timingBase,
          publishState: 'waiting-dependencies',
          pendingDependencyCount: publishPlan.pendingDependencies.length,
          ...waitTiming,
          outcome: 'ok',
        });
      }
      return waitingJob;
    }

    const waitTiming = buildWaitTiming(job);
    logAutomationTiming('wait-dependencies', {
      ...timingBase,
      publishState: 'dependencies-ready',
      refsCount: Array.isArray(publishPlan.refs) ? publishPlan.refs.length : 0,
      ...waitTiming,
      outcome: 'ok',
    });

    phaseStep = 'publish-to-acc';
    phaseTimingWindow = createTimingWindow();

    const userToken = await ensureUserAccessToken(req, true);
    if (!userToken) {
      const updatedAt = new Date().toISOString();
      const publishTiming = buildTimingFields(phaseTimingWindow);
      const pendingAuthJob = {
        ...job,
        publishQueue: {
          ...(job.publishQueue || {}),
          state: 'pending-auth',
          queueWaitMs: roundDurationMs(Date.now() - queueEnteredAtMs),
          completedAt: updatedAt,
          reason: 'Sign in again to publish the processed DWG back to ACC.',
        },
        accUpload: {
          ...(job.accUpload || {}),
          status: 'pending-auth',
          message: 'Sign in again to upload the processed DWG back to ACC as a new version.',
          updatedAt,
          durationMs: publishTiming.criticalPathMs,
          publishQueueEnteredAt: queueEnteredAt,
          publishQueueWaitMs: roundDurationMs(Date.now() - queueEnteredAtMs),
          publishCompletedAt: updatedAt,
        },
      };
      await upsertJob(pendingAuthJob);
      await wakeDependentBatchJobs(req, pendingAuthJob);
      logger.info('publish.queue.finished', {
        sessionId: pendingAuthJob.sessionId,
        batchId: pendingAuthJob.batchId,
        jobId: pendingAuthJob.id,
        sourceItemId: pendingAuthJob.sourceItemId,
        sourceName: pendingAuthJob.inputFileName,
        outcome: 'pending-auth',
        waitMs: pendingAuthJob.accUpload.publishQueueWaitMs,
      });
      logAutomationTiming('publish-to-acc', {
        ...timingBase,
        publishState: 'pending-auth',
        ...publishTiming,
        outcome: 'ok',
      });
      return pendingAuthJob;
    }

    const sourceItem = await getItemEntity(job.sourceProjectId, job.sourceItemId, userToken);
    if (sourceItem?.attributes?.reserved) {
      const updatedAt = new Date().toISOString();
      const publishTiming = buildTimingFields(phaseTimingWindow);
      const lockedJob = {
        ...job,
        publishQueue: {
          ...(job.publishQueue || {}),
          state: 'locked',
          queueWaitMs: roundDurationMs(Date.now() - queueEnteredAtMs),
          completedAt: updatedAt,
          reason: getLockedAccUploadMessage(sourceItem),
        },
        accUpload: {
          ...(job.accUpload || {}),
          status: 'skipped-locked',
          message: getLockedAccUploadMessage(sourceItem),
          updatedAt,
          durationMs: publishTiming.criticalPathMs,
          publishQueueEnteredAt: queueEnteredAt,
          publishQueueWaitMs: roundDurationMs(Date.now() - queueEnteredAtMs),
          publishCompletedAt: updatedAt,
        },
      };
      await upsertJob(lockedJob);
      await wakeDependentBatchJobs(req, lockedJob);
      logger.info('publish.queue.finished', {
        sessionId: lockedJob.sessionId,
        batchId: lockedJob.batchId,
        jobId: lockedJob.id,
        sourceItemId: lockedJob.sourceItemId,
        sourceName: lockedJob.inputFileName,
        outcome: 'locked',
        waitMs: lockedJob.accUpload.publishQueueWaitMs,
      });
      logAutomationTiming('publish-to-acc', {
        ...timingBase,
        publishState: 'skipped-locked',
        ...publishTiming,
        outcome: 'ok',
      });
      return lockedJob;
    }

    const publishStartedAt = new Date().toISOString();
    const publishQueueWaitMs = roundDurationMs(Date.now() - queueEnteredAtMs);
    logger.info('publish.queue.started', {
      sessionId: job.sessionId,
      batchId: job.batchId,
      jobId: job.id,
      sourceItemId: job.sourceItemId,
      sourceName: job.inputFileName,
      publishOrder: job?.publishPlan?.publishOrder ?? job?.publishQueue?.publishOrder ?? null,
      publishQueueWaitMs,
      fastPublishEligible: Boolean(job?.publishPlan?.fastPublishEligible),
    });

    const publishingJob = {
      ...job,
      accVersionRefs: publishPlan.refs,
      publishQueue: {
        ...(job.publishQueue || {}),
        state: 'publishing',
        startedAt: publishStartedAt,
        queueWaitMs: publishQueueWaitMs,
        blockedByJobIds: [],
        blockedBySccId: null,
        reason: 'Publishing processed DWG back to ACC.',
      },
      accUpload: {
        ...(job.accUpload || {}),
        status: 'publishing',
        message: Array.isArray(publishPlan.refs) && publishPlan.refs.length
          ? 'Publishing processed DWG back to ACC as a new version with dependency-aware ListRefs xref relationships.'
          : 'Publishing processed DWG back to ACC as a new version.',
        updatedAt: publishStartedAt,
        pendingDependencies: [],
        publishStartedAt,
        publishQueueEnteredAt: queueEnteredAt,
        publishQueueWaitMs,
        publishBlockedByJobIds: [],
        publishBlockedBySccId: null,
      },
    };
    await upsertJob(publishingJob);
    job = publishingJob;

    const config = getRuntimeConfig(req);
    const automationToken = await ensureAutomationToken(req);
    const signedDownload = await getOssSignedDownload(config, automationToken, job.bucketKey, job.outputObjectKey);
    const expectedOutputSizeBytes = normalizeStorageSize(job?.stats?.bytesUploaded);
    const published = await uploadAccResultAsNewVersionFromUrl(
      job.sourceProjectId,
      job.sourceFolderId,
      job.sourceItemId,
      job.inputFileName,
      signedDownload.url,
      expectedOutputSizeBytes,
      userToken,
      {
        refs: publishPlan.refs,
      },
    );

    const publishedSizeBytes = normalizeStorageSize(published.transfer?.expectedSizeBytes ?? published.transfer?.sizeBytes);
    const downloadMetrics = buildTransferMetrics(publishedSizeBytes, published.transfer?.downloadDurationMs);
    const uploadMetrics = buildTransferMetrics(publishedSizeBytes, published.transfer?.uploadDurationMs);
    const cachePromotionTiming = createTimingWindow();
    try {
      await promotePublishedArtifactToStageCache(config, job, published, publishedSizeBytes, {
        resolvedDependencyVersionIds: publishPlan.resolvedDependencyVersionIds || null,
      });
      logAutomationTiming('artifact-stage-cache-promote', {
        ...timingBase,
        versionId: published.version?.id || null,
        storageUrn: published.storage?.id || null,
        ...buildTimingFields(cachePromotionTiming),
        outcome: 'ok',
      });
    } catch (cachePromotionError) {
      logAutomationTiming('artifact-stage-cache-promote', {
        ...timingBase,
        versionId: published.version?.id || null,
        storageUrn: published.storage?.id || null,
        ...buildTimingFields(cachePromotionTiming),
        outcome: 'error',
        error: cachePromotionError?.message || 'Unknown error',
      });
    }

    logAutomationTiming('output-download-from-oss', {
      ...timingBase,
      ossRegion: config.ossRegion,
      transferMode: published.transfer?.transferMode || null,
      partCount: published.transfer?.partCount || null,
      ...downloadMetrics,
      ...(published.transfer?.downloadTiming || createImmediateTimingFields()),
      outcome: 'ok',
    });
    logAutomationTiming('acc-output-upload', {
      ...timingBase,
      transferMode: published.transfer?.transferMode || null,
      partCount: published.transfer?.partCount || null,
      targetBucketKey: published.bucketKey,
      targetObjectKey: published.objectKey,
      storageUrn: published.storage?.id || null,
      ...uploadMetrics,
      ...(published.transfer?.uploadTiming || createImmediateTimingFields()),
      outcome: 'ok',
    });
    logAutomationTiming('acc-create-version', {
      ...timingBase,
      refsCount: Array.isArray(publishPlan.refs) ? publishPlan.refs.length : 0,
      resolvedDependencyVersionIds: publishPlan.resolvedDependencyVersionIds || {},
      publishRefVersionIds: Array.isArray(publishPlan.refs) ? publishPlan.refs.map((ref) => ref?.id).filter(Boolean) : [],
      storageUrn: published.storage?.id || null,
      versionId: published.version?.id || null,
      versionLabel: extractVersionLabel(published.version),
      ...(published.createVersionTiming || createImmediateTimingFields()),
      outcome: 'ok',
    });

    const updatedAt = new Date().toISOString();
    const publishTiming = buildTimingFields(phaseTimingWindow);
    const uploadedJob = {
      ...job,
      accVersionRefs: publishPlan.refs,
      publishPlan: {
        ...(job.publishPlan || {}),
        resolvedDependencyVersionIds: clonePlain(publishPlan.resolvedDependencyVersionIds || {}),
        publishRefVersionIds: Array.isArray(publishPlan.refs) ? publishPlan.refs.map((ref) => ref?.id).filter(Boolean) : [],
        publishedAt: updatedAt,
      },
      publishQueue: {
        ...(job.publishQueue || {}),
        state: 'uploaded',
        startedAt: publishStartedAt,
        completedAt: updatedAt,
        queueWaitMs: publishQueueWaitMs,
        blockedByJobIds: [],
        blockedBySccId: null,
        reason: 'Published to ACC.',
      },
      accUpload: {
        ...(job.accUpload || {}),
        status: 'uploaded',
        message: Array.isArray(publishPlan.refs) && publishPlan.refs.length
          ? 'Uploaded back to ACC as a new file version with dependency-aware ListRefs xref relationships.'
          : 'Uploaded back to ACC as a new file version.',
        uploadedAt: updatedAt,
        updatedAt,
        transferMode: published.transfer?.transferMode || 'stream',
        fileSizeBytes: publishedSizeBytes,
        fileSizeMiB: roundMetric((publishedSizeBytes || 0) / (1024 * 1024)),
        partCount: published.transfer?.partCount || null,
        ossDownloadMs: published.transfer?.downloadDurationMs || 0,
        accUploadMs: published.transfer?.uploadDurationMs || 0,
        createVersionMs: published.createVersionMs || 0,
        durationMs: publishTiming.criticalPathMs,
        downloadThroughputMiBps: downloadMetrics.throughputMiBps,
        downloadThroughputMbps: downloadMetrics.throughputMbps,
        uploadThroughputMiBps: uploadMetrics.throughputMiBps,
        uploadThroughputMbps: uploadMetrics.throughputMbps,
        storageUrn: published.storage?.id || null,
        storageObjectKey: published.objectKey || null,
        versionId: published.version?.id || null,
        versionLabel: extractVersionLabel(published.version),
        publishDependencyVersions: publishPlan.resolvedDependencyVersionIds || {},
        publishStartedAt,
        publishCompletedAt: updatedAt,
        publishQueueEnteredAt: queueEnteredAt,
        publishQueueWaitMs,
        publishBlockedByJobIds: [],
        publishBlockedBySccId: null,
      },
    };
    invalidateProjectItemCaches(job.sourceProjectId, job.sourceItemId);
    await upsertJob(uploadedJob);
    await wakeDependentBatchJobs(req, uploadedJob);
    logger.info('publish.queue.finished', {
      sessionId: uploadedJob.sessionId,
      batchId: uploadedJob.batchId,
      jobId: uploadedJob.id,
      sourceItemId: uploadedJob.sourceItemId,
      sourceName: uploadedJob.inputFileName,
      outcome: 'uploaded',
      waitMs: publishQueueWaitMs,
      durationMs: publishTiming.criticalPathMs,
      versionId: uploadedJob.accUpload.versionId,
      versionLabel: uploadedJob.accUpload.versionLabel,
    });
    logAutomationTiming('publish-to-acc', {
      ...timingBase,
      publishState: 'uploaded',
      transferMode: uploadedJob.accUpload.transferMode,
      fileSizeBytes: uploadedJob.accUpload.fileSizeBytes,
      versionId: uploadedJob.accUpload.versionId,
      versionLabel: uploadedJob.accUpload.versionLabel,
      refsCount: Array.isArray(publishPlan.refs) ? publishPlan.refs.length : 0,
      ...publishTiming,
      outcome: 'ok',
    });
    return uploadedJob;
  } catch (error) {
    const updatedAt = new Date().toISOString();
    const phaseTiming = phaseStep === 'wait-dependencies' ? buildWaitTiming(job) : buildTimingFields(phaseTimingWindow);
    const failedJob = {
      ...job,
      publishQueue: {
        ...(job.publishQueue || {}),
        state: 'failed',
        completedAt: updatedAt,
        queueWaitMs: roundDurationMs(Math.max(0, Date.now() - queueEnteredAtMs)),
        reason: error?.message || 'ACC publish failed.',
      },
      accUpload: {
        ...(job.accUpload || {}),
        status: isReservationLockedError(error) ? 'skipped-locked' : 'failed',
        message: isReservationLockedError(error) ? 'Skipped ACC upload because the drawing became locked in Autodesk Docs.' : error.message,
        updatedAt,
        durationMs: phaseTiming.criticalPathMs,
        publishQueueEnteredAt: queueEnteredAt,
        publishCompletedAt: updatedAt,
        publishQueueWaitMs: roundDurationMs(Math.max(0, Date.now() - queueEnteredAtMs)),
        publishBlockedByJobIds: job?.publishQueue?.blockedByJobIds || [],
        publishBlockedBySccId: job?.publishQueue?.blockedBySccId || null,
      },
    };
    await upsertJob(failedJob);
    await wakeDependentBatchJobs(req, failedJob);
    logger.info('publish.queue.finished', {
      sessionId: failedJob.sessionId,
      batchId: failedJob.batchId,
      jobId: failedJob.id,
      sourceItemId: failedJob.sourceItemId,
      sourceName: failedJob.inputFileName,
      outcome: 'failed',
      waitMs: failedJob.accUpload.publishQueueWaitMs,
      error: error?.message || 'Unknown error',
    });
    logAutomationTiming(phaseStep, {
      ...timingBase,
      publishState: phaseStep === 'wait-dependencies' ? 'dependency-check-failed' : 'publish-failed',
      ...phaseTiming,
      outcome: 'error',
      error: error?.message || 'Unknown error',
    });
    return failedJob;
  } finally {
    syncLocks.delete(job.id);
  }
}

async function refreshJobStatus(req, job) {
  const latestQueuedJob = !job?.workItemId ? await getSessionJob(req.sessionID, job.id) : null;
  if (latestQueuedJob && !latestQueuedJob.workItemId) {
    return latestQueuedJob;
  }
  if (latestQueuedJob?.workItemId) {
    job = latestQueuedJob;
  }

  const previousStatus = String(job.status || '').toLowerCase();
  if (isTerminalAutomationStatus(previousStatus)) {
    let merged = {
      ...job,
      updatedAt: new Date().toISOString(),
    };

    if (previousStatus === 'success'
      && !isTerminalAccUploadStatus(merged.accUpload?.status || '')) {
      if (String(merged.batchSubmissionState || '').toLowerCase() !== 'ready') {
        const batchGate = await reconcileBatchSubmissionGate(req.sessionID, merged.batchId, {
          triggerJobId: merged.id,
          triggerSourceItemId: merged.sourceItemId,
          triggerSourceName: merged.inputFileName,
          reason: 'refresh-terminal-success',
        });
        if (batchGate.ready) {
          merged = {
            ...merged,
            batchSubmissionState: 'ready',
          };
        }
      }
      if (String(merged.batchSubmissionState || '').toLowerCase() !== 'ready') {
        merged = {
          ...merged,
          publishQueue: {
            ...(merged.publishQueue || {}),
            state: 'queued',
            reason: 'Waiting for batch submission to settle before ACC publish evaluation.',
          },
          accUpload: {
            ...(merged.accUpload || {}),
            status: 'pending',
            message: 'Waiting for the selected batch to finish submission before ACC publish evaluation.',
            updatedAt: new Date().toISOString(),
          },
        };
        await upsertJob(merged);
        return merged;
      }
      return queueSuccessfulJobForPublish(req, merged, 'refresh-terminal-success');
    }

    if (previousStatus !== 'success' && !merged.accUpload) {
      merged = {
        ...merged,
        accUpload: {
          status: 'not-applicable',
          message: 'The Automation work item did not finish successfully, so no ACC version was uploaded.',
          updatedAt: new Date().toISOString(),
        },
      };
      await upsertJob(merged);
      await wakeDependentBatchJobs(req, merged);
    }

    return merged;
  }

  const config = getRuntimeConfig(req);
  const automationToken = await ensureAutomationToken(req);
  const timingWindow = createTimingWindow();
  let status;
  try {
    status = await apsJson(`${config.automationBase}/workitems/${encodeURIComponent(job.workItemId || job.id)}`, {
      token: automationToken,
      context: 'Could not fetch the work item status',
    });
    logAutomationTiming('workitem-status-poll', {
      workItemId: job.workItemId || job.id,
      sourceProjectId: job.sourceProjectId,
      sourceItemId: job.sourceItemId,
      sourceName: job.inputFileName,
      previousStatus: previousStatus || null,
      polledStatus: status?.status || null,
      ...buildTimingFields(timingWindow),
      outcome: 'ok',
    });
  } catch (error) {
    logAutomationTiming('workitem-status-poll', {
      workItemId: job.workItemId || job.id,
      sourceProjectId: job.sourceProjectId,
      sourceItemId: job.sourceItemId,
      sourceName: job.inputFileName,
      previousStatus: previousStatus || null,
      ...buildTimingFields(timingWindow),
      outcome: 'error',
      error: error?.message || 'Unknown error',
    });
    throw error;
  }

  let merged = {
    ...job,
    status: status.status || job.status,
    updatedAt: new Date().toISOString(),
    reportUrl: status.reportUrl || job.reportUrl || null,
    stats: status.stats || job.stats || null,
  };
  const nextStatus = String(merged.status || '').toLowerCase();

  if (previousStatus !== nextStatus) {
    logAutomationTiming('workitem-status-change', {
      workItemId: job.workItemId || job.id,
      sourceProjectId: job.sourceProjectId,
      sourceItemId: job.sourceItemId,
      sourceName: job.inputFileName,
      previousStatus: previousStatus || null,
      nextStatus: nextStatus || null,
      reportUrlAvailable: Boolean(merged.reportUrl),
      ...createImmediateTimingFields(),
      outcome: 'ok',
    });
  }

  if (!isTerminalAutomationStatus(previousStatus) && isTerminalAutomationStatus(nextStatus)) {
    logAutomationTiming('workitem-status-terminal', {
      workItemId: job.workItemId || job.id,
      sourceProjectId: job.sourceProjectId,
      sourceItemId: job.sourceItemId,
      sourceName: job.inputFileName,
      terminalStatus: nextStatus,
      reportUrlAvailable: Boolean(merged.reportUrl),
      ...createImmediateTimingFields(),
      outcome: 'ok',
    });
  }

  if ((merged.status || '').toLowerCase() === 'success'
    && !isTerminalAccUploadStatus(merged.accUpload?.status || '')) {
    if (String(merged.batchSubmissionState || '').toLowerCase() !== 'ready') {
      const batchGate = await reconcileBatchSubmissionGate(req.sessionID, merged.batchId, {
        triggerJobId: merged.id,
        triggerSourceItemId: merged.sourceItemId,
        triggerSourceName: merged.inputFileName,
        reason: 'refresh-live-success',
      });
      if (batchGate.ready) {
        merged = {
          ...merged,
          batchSubmissionState: 'ready',
        };
      }
    }
    if (String(merged.batchSubmissionState || '').toLowerCase() !== 'ready') {
      merged = {
        ...merged,
        publishQueue: {
          ...(merged.publishQueue || {}),
          state: 'queued',
          reason: 'Waiting for batch submission to settle before ACC publish evaluation.',
        },
        accUpload: {
          ...(merged.accUpload || {}),
          status: 'pending',
          message: 'Waiting for the selected batch to finish submission before ACC publish evaluation.',
          updatedAt: new Date().toISOString(),
        },
      };
      await upsertJob(merged);
    } else {
      if (!isTerminalAutomationStatus(previousStatus)) {
        await upsertJob(merged);
      }
      merged = await queueSuccessfulJobForPublish(req, merged, 'refresh-live-success');
    }
  } else if (isTerminalAutomationStatus(merged.status) && (merged.status || '').toLowerCase() !== 'success' && !merged.accUpload) {
    merged = {
      ...merged,
      accUpload: {
        status: 'not-applicable',
        message: 'The Automation work item did not finish successfully, so no ACC version was uploaded.',
        updatedAt: new Date().toISOString(),
      },
    };
    await upsertJob(merged);
    await wakeDependentBatchJobs(req, merged);
  } else {
    await upsertJob(merged);
  }

  return merged;
}

function compactTimestamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

async function safeUnlink(filePath) {
  try {
    await fsp.unlink(filePath);
  } catch {
    // ignore cleanup errors
  }
}

async function pathExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function buildRefCanvasHealthEntryKey(projectId, itemId) {
  return `${String(projectId || '').trim()}|${String(itemId || '').trim()}`;
}

function getRefCanvasHealthContainer(sessionObject, { create = false } = {}) {
  if (!sessionObject || typeof sessionObject !== 'object') {
    return create ? { byKey: {} } : null;
  }

  if (!sessionObject[REF_CANVAS_HEALTH_SESSION_KEY] && create) {
    sessionObject[REF_CANVAS_HEALTH_SESSION_KEY] = { byKey: {} };
  }

  const container = sessionObject[REF_CANVAS_HEALTH_SESSION_KEY] || null;
  if (container && (!container.byKey || typeof container.byKey !== 'object')) {
    container.byKey = {};
  }
  return container;
}

function normalizeHealthReportStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'healthy') {
    return 'healthy';
  }
  if (normalized === 'unhealthy') {
    return 'unhealthy';
  }
  return 'unknown';
}

function extractHealthJsonSummary(payload) {
  const root = payload && typeof payload === 'object' ? payload : {};
  const header = root.Header && typeof root.Header === 'object'
    ? root.Header
    : (root.header && typeof root.header === 'object' ? root.header : {});
  const counts = root.Counts && typeof root.Counts === 'object'
    ? root.Counts
    : (root.counts && typeof root.counts === 'object' ? root.counts : {});
  const healthReport = String(
    header.HealthReport
    || header.healthReport
    || root.HealthReport
    || root.healthReport
    || ''
  ).trim();

  return {
    header,
    counts,
    healthReport,
    normalizedHealth: normalizeHealthReportStatus(healthReport),
  };
}

function buildRefCanvasHealthDiagnosticLog(error, context = 'Ref Canvas health automation failed.') {
  const normalizedContext = String(context || 'Ref Canvas health automation failed.').trim();
  const payload = error?.payload === undefined ? null : error.payload;
  const cause = error?.cause;
  const lines = [
    normalizedContext,
    `Timestamp: ${new Date().toISOString()}`,
    `Message: ${error?.message || 'Unknown error'}`,
  ];

  if (error?.status) {
    lines.push(`HTTP Status: ${error.status}`);
  }

  if (payload) {
    lines.push('', 'Payload:', JSON.stringify(payload, null, 2));
  }

  if (cause?.message && cause.message !== error?.message) {
    lines.push('', `Cause: ${cause.message}`);
  }

  if (error?.stack) {
    lines.push('', 'Stack:', error.stack);
  }

  return `${lines.join('\n')}\n`;
}

function serializeRefCanvasHealthEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  return {
    projectId: entry.projectId || '',
    itemId: entry.itemId || '',
    status: entry.status || 'idle',
    inputFileName: entry.inputFileName || '',
    workItemId: entry.workItemId || null,
    reportUrl: entry.reportUrl || null,
    hasLog: Boolean(entry.reportUrl || entry.diagnosticLog),
    healthReport: entry.healthReport || '',
    normalizedHealth: entry.normalizedHealth || 'unknown',
    counts: entry.counts || {},
    header: entry.header || {},
    error: entry.error || '',
    updatedAt: entry.updatedAt || null,
    batchId: entry.batchId || null,
    batchIndex: Number.isFinite(Number(entry.batchIndex)) ? Number(entry.batchIndex) : null,
    batchSize: Number.isFinite(Number(entry.batchSize)) ? Number(entry.batchSize) : null,
  };
}

function broadcastRefCanvasHealthEvent(sessionId, entry) {
  const serializedEntry = serializeRefCanvasHealthEntry(entry);
  if (!serializedEntry) {
    return;
  }
  broadcastSessionEvent(sessionId, {
    type: 'ref-canvas-health-updated',
    entry: serializedEntry,
  });
}

function saveRequestSession(req) {
  return new Promise((resolve, reject) => {
    if (!req?.session || typeof req.session.save !== 'function') {
      resolve();
      return;
    }
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function sessionStoreGet(store, sessionId) {
  return new Promise((resolve, reject) => {
    if (!store || !sessionId || typeof store.get !== 'function') {
      resolve(null);
      return;
    }
    store.get(sessionId, (error, sessionData) => (error ? reject(error) : resolve(sessionData || null)));
  });
}

function sessionStoreSet(store, sessionId, sessionData) {
  return new Promise((resolve, reject) => {
    if (!store || !sessionId || typeof store.set !== 'function') {
      resolve();
      return;
    }
    store.set(sessionId, sessionData, (error) => (error ? reject(error) : resolve()));
  });
}

async function mutateStoredRefCanvasHealthSession(req, sessionId, mutator) {
  if (!sessionId) {
    return null;
  }

  if (sessionId === req.sessionID && req.session) {
    const container = getRefCanvasHealthContainer(req.session, { create: true });
    await Promise.resolve(mutator(container, req.session));
    req.session[REF_CANVAS_HEALTH_SESSION_KEY] = container;
    await saveRequestSession(req);
    return container;
  }

  const sessionData = await sessionStoreGet(req.sessionStore, sessionId);
  if (!sessionData) {
    return null;
  }
  const container = getRefCanvasHealthContainer(sessionData, { create: true });
  await Promise.resolve(mutator(container, sessionData));
  sessionData[REF_CANVAS_HEALTH_SESSION_KEY] = container;
  await sessionStoreSet(req.sessionStore, sessionId, sessionData);
  return container;
}

async function getStoredRefCanvasHealthEntry(req, sessionId, projectId, itemId) {
  const key = buildRefCanvasHealthEntryKey(projectId, itemId);
  const sessionData = sessionId === req.sessionID && req.session
    ? req.session
    : await sessionStoreGet(req.sessionStore, sessionId);
  const container = getRefCanvasHealthContainer(sessionData, { create: false });
  return container?.byKey?.[key] || null;
}

async function patchStoredRefCanvasHealthEntryIfPresent(req, sessionId, projectId, itemId, patch) {
  const key = buildRefCanvasHealthEntryKey(projectId, itemId);

  if (sessionId === req.sessionID && req.session) {
    const container = getRefCanvasHealthContainer(req.session, { create: false });
    const existing = container?.byKey?.[key] || null;
    if (!existing) {
      return null;
    }
    const patchValue = await Promise.resolve(typeof patch === 'function' ? patch(existing) : patch);
    container.byKey[key] = {
      ...existing,
      ...(patchValue || {}),
    };
    req.session[REF_CANVAS_HEALTH_SESSION_KEY] = container;
    await saveRequestSession(req);
    broadcastRefCanvasHealthEvent(sessionId, container.byKey[key]);
    return container.byKey[key];
  }

  const sessionData = await sessionStoreGet(req.sessionStore, sessionId);
  const container = getRefCanvasHealthContainer(sessionData, { create: false });
  const existing = container?.byKey?.[key] || null;
  if (!existing || !sessionData) {
    return null;
  }
  const patchValue = await Promise.resolve(typeof patch === 'function' ? patch(existing) : patch);
  container.byKey[key] = {
    ...existing,
    ...(patchValue || {}),
  };
  sessionData[REF_CANVAS_HEALTH_SESSION_KEY] = container;
  await sessionStoreSet(req.sessionStore, sessionId, sessionData);
  broadcastRefCanvasHealthEvent(sessionId, container.byKey[key]);
  return container.byKey[key];
}

async function clearStoredRefCanvasHealthSession(req, sessionId = req.sessionID) {
  if (!sessionId) {
    return;
  }
  if (sessionId === req.sessionID && req.session) {
    delete req.session[REF_CANVAS_HEALTH_SESSION_KEY];
    await saveRequestSession(req);
    broadcastSessionEvent(sessionId, { type: 'ref-canvas-health-cleared' });
    return;
  }

  const sessionData = await sessionStoreGet(req.sessionStore, sessionId);
  if (!sessionData) {
    return;
  }
  delete sessionData[REF_CANVAS_HEALTH_SESSION_KEY];
  await sessionStoreSet(req.sessionStore, sessionId, sessionData);
  broadcastSessionEvent(sessionId, { type: 'ref-canvas-health-cleared' });
}

async function pollRefCanvasHealthWorkItem(execution, workItemId) {
  const deadline = Date.now() + REF_CANVAS_HEALTH_POLL_TIMEOUT_MS;
  let lastStatus = null;

  while (Date.now() < deadline) {
    const status = await apsJson(`${execution.config.automationBase}/workitems/${encodeURIComponent(workItemId)}`, {
      token: execution.automationToken,
      context: 'Could not fetch the health work item status',
    });
    lastStatus = status;
    if (isTerminalAutomationStatus(status?.status || '')) {
      return status;
    }
    await sleep(REF_CANVAS_HEALTH_POLL_INTERVAL_MS);
  }

  return {
    ...(lastStatus || {}),
    status: 'timeout',
  };
}

async function downloadRefCanvasHealthJson(config, automationToken, bucketKey, objectKey) {
  const signedDownload = await getOssSignedDownload(config, automationToken, bucketKey, objectKey);
  const response = await fetch(signedDownload.url);
  await assertOk(response, 'Could not download the health JSON output');
  const bodyText = await response.text();
  if (!bodyText) {
    throw httpError(500, 'The health JSON output is empty.');
  }
  try {
    return JSON.parse(bodyText);
  } catch (error) {
    throw httpError(500, `Could not parse the health JSON output: ${error.message}`);
  }
}

function buildRefCanvasHealthOutputLocalName(localName) {
  const normalizedLocalName = String(localName || 'input.dwg').trim() || 'input.dwg';
  const parsed = path.posix.parse(normalizedLocalName);
  const baseName = sanitizeSegment(parsed.name || 'drawing');
  return parsed.dir ? path.posix.join(parsed.dir, `${baseName}_health.json`) : `${baseName}_health.json`;
}

async function submitRefCanvasHealthAutomation(execution, projectId, item, { queueWaitMs = 0 } = {}) {
  const sourceItem = item?.storageUrn
    ? item
    : await execution.resolveAutomationItem(projectId, item.itemId);

  if (sourceItem.hidden) {
    throw httpError(400, `${sourceItem.displayName} is hidden in ACC and cannot be submitted to Design Automation.`);
  }

  const localInfo = normalizeAutomationLocalPath(sourceItem.relativePath || sourceItem.displayName, sourceItem.displayName);
  const localName = localInfo.localPath || sanitizeFileName(sourceItem.displayName);
  const outputLocalName = buildRefCanvasHealthOutputLocalName(localName);
  const outputObjectKey = `jobs/${execution.executionKey}/health/${sanitizeFileName(path.posix.basename(outputLocalName))}`;
  const jobKey = `health-${compactTimestamp()}-${crypto.randomUUID().slice(0, 8)}`;
  const timingBase = {
    jobKey,
    projectId,
    sourceItemId: sourceItem.itemId,
    sourceName: sourceItem.displayName,
  };

  const preparation = startStagedAutomationInputPreparation(execution, projectId, sourceItem, jobKey, {
    preferredName: sourceItem.displayName,
    cacheStep: 'health-source-stage-cache-hit',
    downloadStep: 'health-source-download',
    uploadStep: 'health-source-oss-upload',
    logDetails: timingBase,
  });
  const { stagedSource, stagedRefs } = await finishStagedAutomationInputPreparation(execution, projectId, sourceItem, preparation, {
    persistPreparedRefGraph: true,
    allowReferenceFailures: false,
  });

  const activityQualifiedId = execution.setupState?.activityQualifiedId
    || buildQualifiedResourceId(execution.config, execution.healthConfig.activityId, execution.healthConfig.alias);
  const bearer = `Bearer ${execution.automationToken}`;
  const inputFile = {
    verb: 'get',
    url: stagedSource.objectId,
    localName: stagedRefs.hostLocalName || localName,
    headers: { Authorization: bearer },
  };
  if (Array.isArray(stagedRefs.referenceInputs) && stagedRefs.referenceInputs.length) {
    inputFile.references = stagedRefs.referenceInputs;
  }

  const workItem = await timeAutomationStep('health-workitems-post', {
    ...timingBase,
    activityId: activityQualifiedId,
    referenceCount: stagedRefs.referenceInputs.length,
    sourceCacheHit: stagedSource.cacheHit,
    sourceTransferMode: stagedSource.transferMode,
    sourceFileSizeBytes: stagedSource.sizeBytes,
    sourceFileSizeMiB: stagedSource.sizeBytes ? roundMetric(Number(stagedSource.sizeBytes) / (1024 * 1024)) : null,
  }, () => apsJson(`${execution.config.automationBase}/workitems`, {
    method: 'POST',
    token: execution.automationToken,
    expectedStatus: [200, 201, 202],
    context: `Could not submit the health work item for ${sourceItem.displayName}`,
    body: {
      activityId: activityQualifiedId,
      arguments: {
        inputFile,
        outputJson: {
          verb: 'put',
          url: buildObjectId(execution.config.bucketKey, outputObjectKey),
          localName: outputLocalName,
          headers: { Authorization: bearer },
        },
        adskMask: true,
      },
      limitProcessingTimeSec: 900,
    },
  }));

  return {
    sourceItem,
    workItemId: workItem.id,
    reportUrl: workItem.reportUrl || null,
    status: workItem.status || 'pending',
    outputObjectKey,
    outputLocalName,
    queueWaitMs,
    referenceCount: stagedRefs.referenceInputs.length,
    sourceCacheHit: stagedSource.cacheHit,
    sourceTransferMode: stagedSource.transferMode,
    sourceFileSizeBytes: stagedSource.sizeBytes,
  };
}

async function runRefCanvasHealthAutomationForSession(req, sessionId, projectId, itemId) {
  const inflightKey = `${sessionId}|${projectId}|${itemId}`;
  return shareInFlightPromise(refCanvasHealthInflight, inflightKey, async () => {
    const preparingEntry = await patchStoredRefCanvasHealthEntryIfPresent(req, sessionId, projectId, itemId, () => ({
      projectId,
      itemId,
      status: 'preparing',
      error: '',
      diagnosticLog: '',
      updatedAt: new Date().toISOString(),
    }));
    if (!preparingEntry) {
      return;
    }

    try {
      const execution = await createHealthAutomationExecutionContext(req);
      const sourceItem = await execution.resolveAutomationItem(projectId, itemId);

      const submittingEntry = await patchStoredRefCanvasHealthEntryIfPresent(req, sessionId, projectId, itemId, () => ({
        projectId,
        itemId,
        inputFileName: sourceItem.displayName,
        status: 'submitting',
        error: '',
        diagnosticLog: '',
        updatedAt: new Date().toISOString(),
      }));
      if (!submittingEntry) {
        return;
      }

      const submission = await submitRefCanvasHealthAutomation(execution, projectId, sourceItem);

      const pendingEntry = await patchStoredRefCanvasHealthEntryIfPresent(req, sessionId, projectId, itemId, () => ({
        projectId,
        itemId,
        inputFileName: submission.sourceItem.displayName,
        workItemId: submission.workItemId,
        reportUrl: submission.reportUrl,
        status: submission.status || 'pending',
        error: '',
        diagnosticLog: '',
        updatedAt: new Date().toISOString(),
      }));
      if (!pendingEntry) {
        return;
      }

      await finalizeRefCanvasHealthSubmissionForSession(req, sessionId, projectId, itemId, execution, submission);
    } catch (error) {
      await patchStoredRefCanvasHealthEntryIfPresent(req, sessionId, projectId, itemId, (existing) => ({
        projectId,
        itemId,
        inputFileName: existing?.inputFileName || '',
        workItemId: existing?.workItemId || null,
        reportUrl: existing?.reportUrl || null,
        status: 'failed',
        error: error?.message || 'Could not run the health automation.',
        diagnosticLog: buildRefCanvasHealthDiagnosticLog(error),
        updatedAt: new Date().toISOString(),
      }));
    }
  });
}


async function runRefCanvasHealthBatchForSession(req, sessionId, projectId, itemIds) {
  const normalizedItemIds = dedupeStrings((Array.isArray(itemIds) ? itemIds : [])
    .map((itemId) => String(itemId || '').trim())
    .filter(Boolean));
  if (!normalizedItemIds.length) {
    return;
  }

  const inflightKey = `${sessionId}|${projectId}|batch|${normalizedItemIds.join(',')}`;
  return shareInFlightPromise(refCanvasHealthInflight, inflightKey, async () => {
    const execution = await createHealthAutomationExecutionContext(req);
    const batchStartedAt = getTimingStart();
    const resolutionResults = await mapWithConcurrency(
      normalizedItemIds,
      Math.min(AUTOMATION_BATCH_STAGE_CONCURRENCY, normalizedItemIds.length),
      async (itemId) => {
        try {
          return {
            itemId,
            item: await execution.resolveAutomationItem(projectId, itemId),
            error: null,
          };
        } catch (error) {
          await patchStoredRefCanvasHealthEntryIfPresent(req, sessionId, projectId, itemId, (existing) => ({
            projectId,
            itemId,
            inputFileName: existing?.inputFileName || '',
            workItemId: existing?.workItemId || null,
            reportUrl: existing?.reportUrl || null,
            status: 'failed',
            error: error?.message || 'Could not resolve the selected ACC file.',
            diagnosticLog: buildRefCanvasHealthDiagnosticLog(error),
            updatedAt: new Date().toISOString(),
          }));
          req.log?.warn('ref-canvas.health.batch.item-resolution-failed', {
            sessionId,
            projectId,
            itemId,
            error,
          });
          return {
            itemId,
            item: null,
            error,
          };
        }
      },
    );

    const resolvedItems = resolutionResults
      .filter((result) => result?.item)
      .map((result) => result.item);

    if (!resolvedItems.length) {
      req.log?.warn('ref-canvas.health.batch.finished', {
        sessionId,
        projectId,
        itemCount: normalizedItemIds.length,
        submittedCount: 0,
        completedCount: 0,
        failedCount: resolutionResults.length,
        failureItemIds: resolutionResults.map((result) => result?.itemId).filter(Boolean),
        outcome: 'error',
        reason: 'No Ref Canvas health items could be resolved.',
      });
      return;
    }

    const workEntries = resolvedItems
      .map((item, index) => {
        return {
          item,
          index,
          weightBytes: getJobSizeHintBytes(item),
        };
      })
      .sort((left, right) => {
        const leftWeight = Number(left.weightBytes || 0);
        const rightWeight = Number(right.weightBytes || 0);
        if (rightWeight !== leftWeight) {
          return rightWeight - leftWeight;
        }
        return left.index - right.index;
      });

    req.log?.info('ref-canvas.health.batch.started', {
      sessionId,
      projectId,
      itemCount: normalizedItemIds.length,
      concurrency: AUTOMATION_BATCH_STAGE_CONCURRENCY,
      maxInflightBytes: AUTOMATION_BATCH_STAGE_MAX_INFLIGHT_BYTES,
      finalizeConcurrency: AUTOMATION_WORKITEM_POLL_CONCURRENCY,
      mode: 'streaming-submit',
    });

    const submissionFailures = [];
    const finalizeFailures = [];
    const finalizeTasks = [];
    const finalizeLimiter = createTaskLimiter(AUTOMATION_WORKITEM_POLL_CONCURRENCY);
    let firstWorkItemPosted = false;
    let submittedCount = 0;
    let completedCount = 0;

    await mapWithWeightedBudget(
      workEntries,
      {
        limit: AUTOMATION_BATCH_STAGE_CONCURRENCY,
        maxWeight: AUTOMATION_BATCH_STAGE_MAX_INFLIGHT_BYTES,
        weightFn: (entry) => entry.weightBytes,
      },
      async (entry, _scheduledIndex, queueWaitMs) => {
        const itemId = String(entry?.item?.itemId || '').trim();
        try {
          await patchStoredRefCanvasHealthEntryIfPresent(req, sessionId, projectId, itemId, (existing) => ({
            projectId,
            itemId,
            inputFileName: existing?.inputFileName || entry.item.displayName,
            status: 'preparing',
            error: '',
            diagnosticLog: '',
            updatedAt: new Date().toISOString(),
          }));

          const submission = await submitRefCanvasHealthAutomation(execution, projectId, entry.item, {
            queueWaitMs,
          });
          await patchStoredRefCanvasHealthEntryIfPresent(req, sessionId, projectId, itemId, () => ({
            projectId,
            itemId,
            inputFileName: submission.sourceItem.displayName,
            workItemId: submission.workItemId,
            reportUrl: submission.reportUrl,
            status: submission.status || 'pending',
            error: '',
            diagnosticLog: '',
            updatedAt: new Date().toISOString(),
          }));

          submittedCount += 1;

          if (!firstWorkItemPosted) {
            firstWorkItemPosted = true;
            req.log?.info('ref-canvas.health.batch.first-workitem-posted', {
              sessionId,
              projectId,
              itemId,
              inputFileName: submission.sourceItem.displayName,
              workItemId: submission.workItemId,
              firstSubmitLagMs: roundDurationMs(getDurationMs(batchStartedAt)),
              submittedCount,
              itemCount: normalizedItemIds.length,
            });
          }

          req.log?.info('ref-canvas.health.batch.item-submitted', {
            sessionId,
            projectId,
            itemId,
            inputFileName: submission.sourceItem.displayName,
            workItemId: submission.workItemId,
            queueWaitMs,
            referenceCount: submission.referenceCount,
            sourceCacheHit: submission.sourceCacheHit,
            sourceTransferMode: submission.sourceTransferMode,
            sourceFileSizeBytes: submission.sourceFileSizeBytes,
          });

          req.log?.info('ref-canvas.health.batch.progress', {
            sessionId,
            projectId,
            phase: 'submitted',
            itemId,
            submittedCount,
            completedCount,
            failedCount: submissionFailures.length + finalizeFailures.length,
            itemCount: normalizedItemIds.length,
          });

          const finalizeTask = finalizeLimiter.schedule(async () => {
            try {
              const result = await finalizeRefCanvasHealthSubmissionForSession(req, sessionId, projectId, itemId, execution, submission);
              if (result?.ok) {
                completedCount += 1;
              } else {
                finalizeFailures.push({
                  itemId,
                  inputFileName: submission.sourceItem.displayName,
                  error: result?.status || 'failed',
                });
              }
              req.log?.info('ref-canvas.health.batch.progress', {
                sessionId,
                projectId,
                phase: 'finalized',
                itemId,
                submittedCount,
                completedCount,
                failedCount: submissionFailures.length + finalizeFailures.length,
                itemCount: normalizedItemIds.length,
                terminalStatus: result?.status || 'failed',
              });
            } catch (error) {
              finalizeFailures.push({
                itemId,
                inputFileName: submission.sourceItem.displayName,
                error: error?.message || 'Could not finalize the health automation.',
              });
              req.log?.warn('ref-canvas.health.batch.item-finalize-failed', {
                sessionId,
                projectId,
                itemId,
                error,
              });
            }
          });
          finalizeTasks.push(finalizeTask);

          return { itemId, workItemId: submission.workItemId };
        } catch (error) {
          submissionFailures.push({
            itemId,
            inputFileName: entry?.item?.displayName || itemId,
            error: error?.message || 'Could not run the health automation.',
          });
          await patchStoredRefCanvasHealthEntryIfPresent(req, sessionId, projectId, itemId, (existing) => ({
            projectId,
            itemId,
            inputFileName: existing?.inputFileName || entry?.item?.displayName || '',
            workItemId: existing?.workItemId || null,
            reportUrl: existing?.reportUrl || null,
            status: 'failed',
            error: error?.message || 'Could not run the health automation.',
            diagnosticLog: buildRefCanvasHealthDiagnosticLog(error),
            updatedAt: new Date().toISOString(),
          }));
          req.log?.warn('ref-canvas.health.batch.item-submit-failed', {
            sessionId,
            projectId,
            itemId,
            error,
          });
          req.log?.info('ref-canvas.health.batch.progress', {
            sessionId,
            projectId,
            phase: 'submit-failed',
            itemId,
            submittedCount,
            completedCount,
            failedCount: submissionFailures.length + finalizeFailures.length,
            itemCount: normalizedItemIds.length,
          });
          return null;
        }
      },
    );

    await Promise.allSettled(finalizeTasks);
    await finalizeLimiter.drain();

    req.log?.info('ref-canvas.health.batch.finished', {
      sessionId,
      projectId,
      itemCount: normalizedItemIds.length,
      submittedCount,
      completedCount,
      failedCount: submissionFailures.length + finalizeFailures.length,
      failureItemIds: [...submissionFailures, ...finalizeFailures].map((entry) => entry.itemId),
    });
  });
}


app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/events', asyncHandler(async (req, res) => {
  const sessionId = String(req.sessionID || '').trim();
  if (!sessionId) {
    throw httpError(400, 'A session is required for the event stream.');
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write('retry: 3000\n');
  res.write(`data: ${JSON.stringify({ type: 'connected', sessionId })}\n\n`);

  const clients = getSessionEventClients(sessionId, { create: true });
  clients.add(res);
  const heartbeat = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch {
      // handled by close below
    }
  }, SSE_HEARTBEAT_MS);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
    if (!clients.size) {
      sessionEventClients.delete(sessionId);
    }
  });
}));

app.get('/api/bootstrap', asyncHandler(async (req, res) => {
  const config = getRuntimeConfig(req);
  const credentialsSource = req.session.appConfig ? 'session' : (config.clientId || config.clientSecret ? 'env' : 'none');
  const setupState = await getSetupStateForClient(config.clientId);
  const authenticated = Boolean(await ensureUserAccessToken(req, true));
  const jobs = await listJobsForSession(req.sessionID);
  jobs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  let engines = [];
  if (authenticated && config.clientId && config.clientSecret) {
    try {
      const automationToken = await ensureAutomationToken(req);
      const payload = await apsAllPages(`${config.automationBase}/engines`, automationToken, 'Could not list Design Automation engines');
      engines = Array.from(new Set((Array.isArray(payload) ? payload : []).map((entry) => String(entry?.id || entry || '').trim()).filter(Boolean))).sort();
    } catch (error) {
      req.log?.warn('bootstrap.engines.failed', { error });
      engines = [];
    }
  }

  res.json({
    config: {
      credentials: {
        configured: Boolean(config.clientId && config.clientSecret),
        source: credentialsSource,
        clientId: config.clientId || '',
        nickname: config.nickname || '',
        hasClientSecret: Boolean(config.clientSecret),
      },
      auth: {
        authenticated,
        callbackUrl: config.callbackUrl,
        scopes: ACC_SCOPES,
      },
      automation: {
        appBundleId: config.appBundleId,
        activityId: config.activityId,
        alias: config.alias,
        defaultEngine: config.defaultEngine,
        daRegion: config.daRegion,
        ossRegion: config.ossRegion,
        bucketKey: config.bucketKey,
        bundleZipName: config.bundleZipName,
        bundleScriptArchivePath: config.bundleScriptArchivePath,
        setupState,
        scriptOverride: await getScriptOverrideSummary(config),
      },
      security: {
        csrfToken: getOrCreateCsrfToken(req),
        csrfHeaderName: CSRF_HEADER_NAME,
      },
    },
    jobs: jobs.map(serializeJob),
    engines,
  });
}));

app.get('/api/config', asyncHandler(async (req, res) => {
  const config = getRuntimeConfig(req);
  const credentialsSource = req.session.appConfig ? 'session' : (config.clientId || config.clientSecret ? 'env' : 'none');
  const setupState = await getSetupStateForClient(config.clientId);
  const authenticated = Boolean(await ensureUserAccessToken(req, true));
  res.json({
    credentials: {
      configured: Boolean(config.clientId && config.clientSecret),
      source: credentialsSource,
      clientId: config.clientId || '',
      nickname: config.nickname || '',
      hasClientSecret: Boolean(config.clientSecret),
    },
    auth: {
      authenticated,
      callbackUrl: config.callbackUrl,
      scopes: ACC_SCOPES,
    },
    automation: {
      appBundleId: config.appBundleId,
      activityId: config.activityId,
      alias: config.alias,
      defaultEngine: config.defaultEngine,
      daRegion: config.daRegion,
      ossRegion: config.ossRegion,
      bucketKey: config.bucketKey,
      bundleZipName: config.bundleZipName,
      bundleScriptArchivePath: config.bundleScriptArchivePath,
      setupState,
      scriptOverride: await getScriptOverrideSummary(config),
    },
    security: {
      csrfToken: getOrCreateCsrfToken(req),
      csrfHeaderName: CSRF_HEADER_NAME,
    },
  });
}));

app.post('/api/config/credentials', asyncHandler(async (req, res) => {
  const clientId = cleanEnv(req.body?.clientId);
  const clientSecret = cleanEnv(req.body?.clientSecret);
  const nickname = cleanEnv(req.body?.nickname);
  if (!clientId || !clientSecret) {
    throw httpError(400, 'Client ID and client secret are required.');
  }

  req.session.appConfig = { clientId, clientSecret, nickname };
  resetSessionAuth(req);
  res.json({ ok: true });
}));

app.post('/api/config/credentials/clear', asyncHandler(async (req, res) => {
  delete req.session.appConfig;
  resetSessionAuth(req);
  res.json({ ok: true });
}));

app.get('/api/auth/status', asyncHandler(async (req, res) => {
  const config = getRuntimeConfig(req);
  res.json({
    authenticated: Boolean(await ensureUserAccessToken(req, true)),
    credentialsConfigured: Boolean(config.clientId && config.clientSecret),
    callbackUrl: config.callbackUrl,
    scopes: ACC_SCOPES,
  });
}));

app.get('/api/auth/login', asyncHandler(async (req, res) => {
  const config = getRuntimeConfig(req);
  assertCredentialsConfigured(config);
  const state = crypto.randomBytes(24).toString('hex');
  req.session.oauthState = state;
  res.redirect(buildAuthorizeUrl(req, state));
}));

app.get('/api/auth/callback', asyncHandler(async (req, res) => {
  const redirectToAppWithError = (message) => {
    const destination = new URL(getOrigin(req));
    destination.searchParams.set('authError', message);
    res.redirect(destination.toString());
  };

  try {
    const { code, error, error_description: errorDescription, state } = req.query;
    if (error) {
      delete req.session.oauthState;
      redirectToAppWithError(errorDescription || error || 'Autodesk sign-in failed.');
      return;
    }
    if (!code) {
      delete req.session.oauthState;
      redirectToAppWithError('Missing authorization code in the Autodesk callback.');
      return;
    }
    if (!state || String(state) !== req.session.oauthState) {
      delete req.session.oauthState;
      redirectToAppWithError('OAuth state mismatch. Clear the session and try signing in again.');
      return;
    }

    const config = getRuntimeConfig(req);
    const token = await requestToken(config, {
      grant_type: 'authorization_code',
      code: String(code),
      redirect_uri: config.callbackUrl,
    });

    delete req.session.oauthState;
    req.session.apsUser = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + ((token.expires_in || 3600) * 1000),
      scope: token.scope || ACC_SCOPES.join(' '),
    };

    res.redirect('/');
  } catch (error) {
    delete req.session.oauthState;
    redirectToAppWithError(error.message || 'Autodesk sign-in failed.');
  }
}));

app.post('/api/auth/logout', asyncHandler(async (req, res) => {
  await new Promise((resolve, reject) => req.session.destroy((error) => (error ? reject(error) : resolve())));
  res.status(204).end();
}));

app.get('/api/automation/script', asyncHandler(async (req, res) => {
  res.json(await getScriptOverrideSummary(getRuntimeConfig(req)));
}));

app.post('/api/automation/script', upload.single('script'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw httpError(400, 'Choose a .scr file first.');
  }

  const filename = sanitizeFileName(req.file.originalname || 'script.scr');
  if (!/\.scr$/i.test(filename)) {
    await safeUnlink(req.file.path);
    throw httpError(400, 'Only SCR files are supported for the script override.');
  }

  try {
    if (req.file.size <= 0) {
      throw httpError(400, 'The uploaded SCR file is empty.');
    }
    await fsp.copyFile(req.file.path, SCRIPT_OVERRIDE_FILE);
    const summary = {
      exists: true,
      originalName: filename,
      storedName: path.basename(SCRIPT_OVERRIDE_FILE),
      size: req.file.size,
      uploadedAt: new Date().toISOString(),
      archivePath: getRuntimeConfig(req).bundleScriptArchivePath,
    };
    await writeJsonFile(SCRIPT_META_FILE, summary);
    res.json(summary);
  } finally {
    await safeUnlink(req.file.path);
  }
}));

app.delete('/api/automation/script', asyncHandler(async (req, res) => {
  await safeUnlink(SCRIPT_OVERRIDE_FILE);
  await safeUnlink(SCRIPT_META_FILE);
  res.json({
    exists: false,
    message: 'Custom SCR override cleared. The original RunMe.scr from the bundle will be used.',
    archivePath: getRuntimeConfig(req).bundleScriptArchivePath,
  });
}));

app.get('/api/automation/engines', asyncHandler(async (req, res) => {
  const config = getRuntimeConfig(req);
  if (!config.clientId || !config.clientSecret) {
    res.json([config.defaultEngine]);
    return;
  }

  const token = await ensureAutomationToken(req);
  const engines = await listAutomationItems(config, '/engines', token);
  const autoCad = engines
    .map((engine) => (typeof engine === 'string' ? engine : engine?.id || engine?.engine || engine?.description))
    .filter(Boolean)
    .filter((engine) => engine.includes('AutoCAD'));

  const unique = Array.from(new Set(autoCad));
  unique.sort();
  if (!unique.includes(config.defaultEngine)) {
    unique.unshift(config.defaultEngine);
  }
  res.json(unique);
}));

app.post('/api/automation/setup', asyncHandler(async (req, res) => {
  const payload = await configureAutomationResources(req, cleanEnv(req.body?.engine) || getRuntimeConfig(req).defaultEngine);
  res.json(payload);
}));

app.get('/api/hubs', requireAccAuth, asyncHandler(async (req, res) => {
  const hubs = await apsAllPages('/project/v1/hubs', req.accessToken, 'Could not list ACC hubs');
  res.json({
    data: hubs
      .filter(isAccHub)
      .map(normalizeHub)
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
}));

app.get('/api/hubs/:hubId/projects', requireAccAuth, asyncHandler(async (req, res) => {
  const hubId = decodeURIComponent(req.params.hubId);
  const projects = await apsAllPages(`/project/v1/hubs/${encodeURIComponent(hubId)}/projects`, req.accessToken, 'Could not list ACC projects');
  res.json({
    data: projects
      .map((project) => normalizeProject(project, hubId))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
}));

app.get('/api/hubs/:hubId/projects/:projectId/top-folders', requireAccAuth, asyncHandler(async (req, res) => {
  const hubId = decodeURIComponent(req.params.hubId);
  const projectId = decodeURIComponent(req.params.projectId);
  const payload = await apsJson(`/project/v1/hubs/${encodeURIComponent(hubId)}/projects/${encodeURIComponent(projectId)}/topFolders`, {
    token: req.accessToken,
    context: 'Could not list the ACC top folders',
  });
  const folders = Array.isArray(payload.data) ? payload.data : [];
  res.json({
    data: folders
      .filter(isFolderEntity)
      .map(normalizeFolder)
      .filter((folder) => folder.id)
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
}));

app.get('/api/projects/:projectId/folders/:folderId/contents', requireAccAuth, asyncHandler(async (req, res) => {
  const projectId = decodeURIComponent(req.params.projectId);
  const folderId = decodeURIComponent(req.params.folderId);
  const contents = await listFolderEntities(projectId, folderId, req.accessToken);
  const folders = contents.filter(isFolderEntity).map(normalizeFolder).filter((folder) => folder.id).sort((a, b) => a.name.localeCompare(b.name));
  const rawFiles = contents
    .filter(isItemEntity)
    .map(normalizeItem)
    .filter((file) => file.extension === 'dwg')
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = await enrichItemsWithVersionMetadata(projectId, rawFiles, req.accessToken);
  res.json({
    data: [...folders, ...files],
    counts: {
      folders: folders.length,
      files: files.length,
    },
  });
}));

app.get('/api/projects/:projectId/folders/:folderId/tree-files', requireAccAuth, asyncHandler(async (req, res) => {
  const projectId = decodeURIComponent(req.params.projectId);
  const folderId = decodeURIComponent(req.params.folderId);
  const files = await buildFolderTreeFileSummaries(projectId, folderId, req.accessToken);
  res.json({
    data: files.sort((a, b) => String(a.relativePath || a.name || '').localeCompare(String(b.relativePath || b.name || ''))),
    counts: {
      files: files.length,
    },
  });
}));

app.get('/api/projects/:projectId/items/:itemId/refs', requireAccAuth, asyncHandler(async (req, res) => {
  const projectId = decodeURIComponent(req.params.projectId);
  const itemId = decodeURIComponent(req.params.itemId);
  const result = await resolveItemRefs(projectId, itemId, req.accessToken);
  const sourceName = result.tip?.data?.attributes?.displayName || result.tip?.data?.attributes?.name || 'refs';
  const refs = buildOutgoingXrefSummaries(result.rows);

  res.json({
    data: refs,
    meta: {
      count: refs.length,
      retrievedVia: result.retrievedVia,
      sourceName,
      sourceVersionId: result.tip?.data?.id || '',
      filters: {
        direction: 'from',
        refExtensionType: XREF_REF_EXTENSION_TYPE,
      },
    },
  });
}));

app.get('/api/projects/:projectId/items/:itemId/ref-list', requireAccAuth, asyncHandler(async (req, res) => {
  const projectId = decodeURIComponent(req.params.projectId);
  const itemId = decodeURIComponent(req.params.itemId);
  const result = await resolveItemRefs(projectId, itemId, req.accessToken);
  res.json(buildRefListPayload(projectId, itemId, result));
}));

app.get('/api/projects/:projectId/items/:itemId/ref-list.json', requireAccAuth, asyncHandler(async (req, res) => {
  const projectId = decodeURIComponent(req.params.projectId);
  const itemId = decodeURIComponent(req.params.itemId);
  const result = await resolveItemRefs(projectId, itemId, req.accessToken);
  const payload = buildRefListPayload(projectId, itemId, result);
  const sourceName = payload.meta?.sourceName || 'ref-list';
  const fileStem = sanitizeSegment(path.basename(sourceName, path.extname(sourceName)));

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${contentDispositionFilename(`${fileStem}.ref-list.json`)}"`);
  res.send(JSON.stringify(payload, null, 2));
}));

app.get('/api/projects/:projectId/items/:itemId/download', requireAccAuth, asyncHandler(async (req, res) => {
  const projectId = decodeURIComponent(req.params.projectId);
  const itemId = decodeURIComponent(req.params.itemId);
  const download = await getItemDownload(projectId, itemId, req.accessToken);
  const remoteResponse = await fetch(download.url);
  await assertOk(remoteResponse, 'Could not download the ACC DWG');
  if (!remoteResponse.body) {
    throw httpError(500, 'The ACC download stream is unavailable.');
  }

  res.setHeader('Content-Type', remoteResponse.headers.get('content-type') || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${contentDispositionFilename(download.displayName)}"`);
  const contentLength = remoteResponse.headers.get('content-length');
  if (contentLength) {
    res.setHeader('Content-Length', contentLength);
  }
  Readable.fromWeb(remoteResponse.body).pipe(res);
}));

app.get('/api/projects/:projectId/items/:itemId/open-drawing', requireAccAuth, asyncHandler(async (req, res) => {
  const projectId = decodeURIComponent(req.params.projectId);
  const itemId = decodeURIComponent(req.params.itemId);

  const [tipPayload, itemEntity] = await Promise.all([
    getItemTip(projectId, itemId, req.accessToken).catch(() => null),
    getItemEntity(projectId, itemId, req.accessToken).catch(() => null),
  ]);

  const targetUrl = getPreferredDrawingWebUrl(itemEntity, tipPayload);
  if (!targetUrl) {
    throw httpError(404, 'No specific web drawing link is available for this ACC item.');
  }

  res.setHeader('Cache-Control', 'no-store');
  res.redirect(302, targetUrl);
}));

app.post('/api/ref-canvas/health/run', requireAccAuth, asyncHandler(async (req, res) => {
  const projectId = decodeURIComponent(req.body?.projectId || '');
  const rawItemIds = Array.isArray(req.body?.itemIds)
    ? req.body.itemIds
    : [req.body?.itemId];
  const itemIds = dedupeStrings(rawItemIds.map((value) => decodeURIComponent(value || '')).filter(Boolean));
  if (!projectId || !itemIds.length) {
    throw httpError(400, 'projectId and itemId or itemIds are required.');
  }

  const container = getRefCanvasHealthContainer(req.session, { create: true });
  const queuedItemIds = [];
  const queuedAt = new Date().toISOString();
  const batchId = itemIds.length > 1
    ? `ref-canvas-health-${compactTimestamp()}-${crypto.randomUUID().slice(0, 8)}`
    : null;

  for (const [index, itemId] of itemIds.entries()) {
    const entryKey = buildRefCanvasHealthEntryKey(projectId, itemId);
    const existing = container.byKey[entryKey];
    const existingStatus = String(existing?.status || '').trim().toLowerCase();
    const shouldReuse = existing && (existingStatus === 'queued' || existingStatus === 'completed' || existingStatus === 'preparing' || existingStatus === 'submitting' || existingStatus === 'pending' || existingStatus === 'inprogress' || existingStatus === 'running');
    container.byKey[entryKey] = {
      ...(existing || {}),
      projectId,
      itemId,
      batchId,
      batchIndex: batchId ? index : null,
      batchSize: batchId ? itemIds.length : null,
      updatedAt: queuedAt,
      ...(shouldReuse ? {} : {
        status: 'queued',
        workItemId: null,
        reportUrl: null,
        healthReport: '',
        normalizedHealth: 'unknown',
        counts: {},
        header: {},
        error: '',
        diagnosticLog: '',
      }),
    };
    if (!shouldReuse) {
      queuedItemIds.push(itemId);
    }
  }

  req.session[REF_CANVAS_HEALTH_SESSION_KEY] = container;
  await saveRequestSession(req);
  for (const itemId of itemIds) {
    broadcastRefCanvasHealthEvent(req.sessionID, container.byKey[buildRefCanvasHealthEntryKey(projectId, itemId)]);
  }

  if (queuedItemIds.length) {
    if (queuedItemIds.length > 1) {
      req.log?.info('ref-canvas.health.batch.enqueued', {
        sessionId: req.sessionID,
        projectId,
        batchId,
        itemCount: queuedItemIds.length,
        itemIds: queuedItemIds,
      });
      runRefCanvasHealthBatchForSession(req, req.sessionID, projectId, queuedItemIds).catch((error) => {
        req.log?.error('ref-canvas.health.batch.failed', { error, projectId, batchId, itemIds: queuedItemIds });
      });
    } else {
      runRefCanvasHealthAutomationForSession(req, req.sessionID, projectId, queuedItemIds[0]).catch((error) => {
        req.log?.error('ref-canvas.health.run.failed', { error, projectId, itemId: queuedItemIds[0] });
      });
    }
  }

  const serialized = itemIds.map((itemId) => serializeRefCanvasHealthEntry(container.byKey[buildRefCanvasHealthEntryKey(projectId, itemId)])).filter(Boolean);
  res.status(202).json({
    data: itemIds.length === 1 ? serialized[0] || null : serialized,
  });
}));

app.get('/api/ref-canvas/health', requireAccAuth, asyncHandler(async (req, res) => {
  const projectId = decodeURIComponent(req.query?.projectId || '');
  const itemId = decodeURIComponent(req.query?.itemId || '');
  if (!projectId || !itemId) {
    throw httpError(400, 'projectId and itemId are required.');
  }

  const entry = await getStoredRefCanvasHealthEntry(req, req.sessionID, projectId, itemId);
  res.json({
    data: serializeRefCanvasHealthEntry(entry),
  });
}));

app.get('/api/ref-canvas/health/log', requireAccAuth, asyncHandler(async (req, res) => {
  const projectId = decodeURIComponent(req.query?.projectId || '');
  const itemId = decodeURIComponent(req.query?.itemId || '');
  if (!projectId || !itemId) {
    throw httpError(400, 'projectId and itemId are required.');
  }

  const entry = await getStoredRefCanvasHealthEntry(req, req.sessionID, projectId, itemId);
  const baseName = path.parse(entry?.inputFileName || 'drawing').name || 'drawing';
  const filename = sanitizeFileName(`${baseName}-health-automation.log`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

  if (entry?.reportUrl) {
    const response = await fetch(entry.reportUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/plain, text/html;q=0.9, */*;q=0.8',
      },
    });
    await assertOk(response, 'Could not download the health automation output log');
    const bodyText = await response.text();
    if (!bodyText) {
      throw httpError(404, 'The health automation output log is empty.');
    }

    res.setHeader('Content-Type', response.headers.get('content-type') || 'text/plain; charset=utf-8');
    res.send(bodyText);
    return;
  }

  if (entry?.diagnosticLog) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(entry.diagnosticLog);
    return;
  }

  throw httpError(404, 'No automation output log is available for this drawing yet.');
}));

app.delete('/api/ref-canvas/health', requireAccAuth, asyncHandler(async (req, res) => {
  await clearStoredRefCanvasHealthSession(req, req.sessionID);
  res.status(204).end();
}));

app.post('/api/automation/run-selected', requireAccAuth, asyncHandler(async (req, res) => {
  const projectId = decodeURIComponent(req.body?.projectId || '');
  const requestedItemIds = Array.isArray(req.body?.itemIds)
    ? req.body.itemIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];

  if (!projectId || !requestedItemIds.length) {
    throw httpError(400, 'projectId and one or more itemIds are required.');
  }

  const uniqueItemIds = Array.from(new Set(requestedItemIds));
  const execution = await createAutomationExecutionContext(req);

  const resolutionResults = await mapWithConcurrency(uniqueItemIds, 5, async (itemId) => {
    try {
      return {
        ok: true,
        item: await execution.resolveAutomationItem(projectId, itemId),
      };
    } catch (error) {
      return {
        ok: false,
        itemId,
        reason: error.message || 'Could not resolve the ACC item.',
        error,
      };
    }
  });

  const items = resolutionResults
    .filter((entry) => entry?.ok && entry.item)
    .map((entry) => entry.item);
  const skippedItems = resolutionResults
    .filter((entry) => !entry?.ok)
    .map((entry) => ({
      itemId: entry.itemId,
      reason: entry.reason,
    }));

  if (!items.length) {
    const criticalFailure = resolutionResults.find((entry) => (
      !entry?.ok && ([401, 403, 429].includes(entry.error?.status || 0) || (entry.error?.status || 0) >= 500)
    ));
    if (criticalFailure?.error) {
      throw criticalFailure.error;
    }
    throw httpError(404, 'No selectable DWG source or reference files were resolved for the requested selection.', {
      skippedItems,
    });
  }

  const jobs = await enqueueAutomationBatch(execution, projectId, items);

  res.status(202).json({
    requested: requestedItemIds.length,
    uniqueRequested: uniqueItemIds.length,
    duplicatesRemoved: requestedItemIds.length - uniqueItemIds.length,
    skipped: skippedItems.length,
    skippedItems,
    queued: jobs.length,
    jobs: jobs.map(serializeJob),
  });
}));


app.post('/api/automation/run-references', requireAccAuth, asyncHandler(async (req, res) => {
  const projectId = decodeURIComponent(req.body?.projectId || '');
  const requestedItemIds = Array.isArray(req.body?.itemIds)
    ? req.body.itemIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];

  if (!projectId || !requestedItemIds.length) {
    throw httpError(400, 'projectId and one or more itemIds are required.');
  }

  const uniqueItemIds = Array.from(new Set(requestedItemIds));
  const execution = await createAutomationExecutionContext(req);

  const resolutionResults = await mapWithConcurrency(uniqueItemIds, 5, async (itemId) => {
    try {
      return {
        ok: true,
        item: await execution.resolveAutomationItem(projectId, itemId),
      };
    } catch (error) {
      return {
        ok: false,
        itemId,
        reason: error.message || 'Could not resolve the ACC item.',
        error,
      };
    }
  });

  const items = resolutionResults
    .filter((entry) => entry?.ok && entry.item)
    .map((entry) => entry.item);
  const skippedItems = resolutionResults
    .filter((entry) => !entry?.ok)
    .map((entry) => ({
      itemId: entry.itemId,
      reason: entry.reason,
    }));

  if (!items.length) {
    const criticalFailure = resolutionResults.find((entry) => (
      !entry?.ok && ([401, 403, 429].includes(entry.error?.status || 0) || (entry.error?.status || 0) >= 500)
    ));
    if (criticalFailure?.error) {
      throw criticalFailure.error;
    }
    throw httpError(404, 'No selectable DWG reference files were resolved for the requested selection.', {
      skippedItems,
    });
  }

  const jobs = await enqueueAutomationBatch(execution, projectId, items);

  res.status(202).json({
    requested: requestedItemIds.length,
    uniqueRequested: uniqueItemIds.length,
    duplicatesRemoved: requestedItemIds.length - uniqueItemIds.length,
    skipped: skippedItems.length,
    skippedItems,
    queued: jobs.length,
    jobs: jobs.map(serializeJob),
  });
}));

app.post('/api/automation/run-folder', requireAccAuth, asyncHandler(async (req, res) => {
  const projectId = decodeURIComponent(req.body?.projectId || '');
  const folderId = await resolveAccFolderId(projectId, decodeURIComponent(req.body?.folderId || ''), req.accessToken, 'ACC folder id');
  if (!projectId || !folderId) {
    throw httpError(400, 'projectId and folderId are required.');
  }

  const items = await collectFolderDwgItems(projectId, folderId, req.accessToken);
  if (!items.length) {
    throw httpError(404, 'No DWG files were found in the selected folder tree.');
  }

  const execution = await createAutomationExecutionContext(req);

  const jobs = await enqueueAutomationBatch(execution, projectId, items);

  res.status(202).json({
    queued: jobs.length,
    jobs: jobs.map(serializeJob),
  });
}));

app.post('/api/jobs/clear', asyncHandler(async (req, res) => {
  markSessionJobsCancelled(req.sessionID);
  await clearJobsForSession(req.sessionID);
  await clearStoredRefCanvasHealthSession(req, req.sessionID);
  res.status(204).end();
}));

app.post('/api/jobs/open-file', asyncHandler(async (_req, res) => {
  const exportFilePath = await exportJobsSnapshotToJsonFile(_req.sessionID);
  await openFileInBrowser(exportFilePath, { fallback: [] });
  res.status(204).end();
}));

app.get('/api/jobs', asyncHandler(async (req, res) => {
  const jobs = await listJobsForSession(req.sessionID);
  jobs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  res.json(jobs.map(serializeJob));
}));

app.get('/api/jobs/:id', asyncHandler(async (req, res) => {
  const id = decodeURIComponent(req.params.id);
  const job = await getSessionJob(req.sessionID, id);
  if (!job) {
    throw httpError(404, 'Unknown work item id.');
  }

  const refreshed = await refreshJobStatus(req, job);
  res.json(serializeJob(refreshed));
}));

app.get('/api/jobs/:id/download', asyncHandler(async (req, res) => {
  const id = decodeURIComponent(req.params.id);
  const job = await getSessionJob(req.sessionID, id);
  if (!job) {
    throw httpError(404, 'Unknown work item id.');
  }
  if ((job.status || '').toLowerCase() !== 'success') {
    throw httpError(409, 'The work item has not completed successfully yet.');
  }

  const config = getRuntimeConfig(req);
  const automationToken = await ensureAutomationToken(req);
  const signedDownload = await getOssSignedDownload(config, automationToken, job.bucketKey, job.outputObjectKey);
  const remoteResponse = await fetch(signedDownload.url);
  await assertOk(remoteResponse, 'Failed to download the processed DWG from OSS');
  if (!remoteResponse.body) {
    throw httpError(500, 'The Automation output stream is unavailable.');
  }

  const contentLength = remoteResponse.headers.get('content-length');
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${contentDispositionFilename(job.inputFileName)}"`,
    ...(contentLength ? { 'Content-Length': contentLength } : {}),
  });
  await pipeline(Readable.fromWeb(remoteResponse.body), res);
}));

app.use((error, req, res, next) => {
  req.log?.error('request.failed', { error });
  if (res.headersSent) {
    return next(error);
  }
  res.status(error.status || 500).json({
    error: {
      message: error.message || 'Unexpected server error.',
      details: getErrorSummary(error.payload),
      requestId: req.requestId || null,
    },
  });
});

process.on('unhandledRejection', (reason) => {
  logger.error('process.unhandled-rejection', { error: reason instanceof Error ? reason : new Error(String(reason)) });
});

process.on('uncaughtExceptionMonitor', (error, origin) => {
  logger.error('process.uncaught-exception', { origin, error });
});

async function main() {
  await sessionStore.init();
  await jobsStore.init();
  await artifactStageStore.init();
  await ensureJsonFile(SETUP_STATES_FILE, {});
  app.listen(Number.parseInt(process.env.PORT || '8080', 10) || 8080, () => {
    logger.info('server.started', { url: `http://localhost:${process.env.PORT || '8080'}` });
  });
}

main().catch((error) => {
  logger.error('server.startup.failed', { error });
  process.exitCode = 1;
});
