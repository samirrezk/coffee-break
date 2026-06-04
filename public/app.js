const state = {
  config: null,
  csrfToken: '',
  layout: {
    leftCollapsed: false,
    rightCollapsed: false,
  },
  hubs: [],
  projects: [],
  topFolders: [],
  currentHubId: null,
  currentProject: null,
  currentFolderPath: [],
  currentEntries: [],
  engines: [],
  selectedItemIds: new Set(),
  jobs: new Map(),
  pollers: new Map(),
  eventStream: null,
  browserGeneration: 0,
  bootstrapLoadedAt: '',
  entryFilter: 'all',
  activeSubmissionLabel: '',
  activeSubmissionCount: null,
  expandedRefItemIds: new Set(),
  refsByItemId: new Map(),
  expandedRefListItemIds: new Set(),
  refListsByItemId: new Map(),
  selectedReferenceSourceIds: new Set(),
  manualReferenceIncludeIds: new Set(),
  manualReferenceExcludeIds: new Set(),
  currentEntriesById: new Map(),
  currentFolderFilesByName: new Map(),
  latestJobsBySourceItemId: new Map(),
  openRowMenuItemId: null,
  refCanvas: {
    open: false,
    loading: false,
    error: '',
    scopeKey: '',
    scopeLabel: '',
    mode: 'idle',
    activeNodeId: '',
    selectedNodeIds: new Set(),
    seedItemIds: [],
    expandedItemIds: new Set(),
    treeFilesByFolderId: new Map(),
    graph: {
      nodes: new Map(),
      links: new Map(),
    },
    viewport: { x: 0, y: 0, k: 1 },
    simulation: {
      raf: 0,
      running: false,
      alpha: 0,
      lastTs: 0,
    },
    interaction: {
      mode: '',
      pointerId: null,
      startX: 0,
      startY: 0,
      originX: 0,
      originY: 0,
      nodeId: '',
      pointerDownNodeId: '',
      pointerOffsetX: 0,
      pointerOffsetY: 0,
      dragged: false,
      selectionModifier: false,
      skipClickSelection: false,
      handledSelectionOnPointerUp: false,
    },
    renderRefs: null,
    health: {
      byKey: new Map(),
      activeKey: '',
      pollTimer: 0,
      requestSerial: 0,
    },
  },
};

const els = {
  workspaceShell: document.getElementById('workspace-shell'),
  contentLayout: document.getElementById('content-layout'),
  leftPanel: document.getElementById('left-panel'),
  rightPanel: document.getElementById('right-panel'),
  leftPanelToggleBtn: document.getElementById('left-panel-toggle-btn'),
  rightPanelToggleBtn: document.getElementById('right-panel-toggle-btn'),
  clientId: document.getElementById('client-id'),
  clientSecret: document.getElementById('client-secret'),
  nicknameInput: document.getElementById('nickname-input'),
  saveCredentialsBtn: document.getElementById('save-credentials-btn'),
  loginBtn: document.getElementById('login-btn'),
  projectTree: document.getElementById('project-tree'),
  refreshHubsBtn: document.getElementById('refresh-hubs-btn'),
  currentHub: document.getElementById('current-hub'),
  currentProject: document.getElementById('current-project'),
  browserState: document.getElementById('browser-state'),
  selectedCount: document.getElementById('selected-count'),
  selectedSummary: document.getElementById('selected-summary'),
  selectionPill: document.getElementById('selection-pill'),
  topFolderPills: document.getElementById('top-folder-pills'),
  breadcrumb: document.getElementById('breadcrumb'),
  selectAll: document.getElementById('select-all'),
  fileTableBody: document.getElementById('file-table-body'),
  filterButtons: [...document.querySelectorAll('.chip[data-filter]')],
  refreshJobsBtn: document.getElementById('refresh-jobs-btn'),
  refCanvasBtn: document.getElementById('ref-canvas-btn'),
  refCanvasShell: document.getElementById('ref-canvas-shell'),
  refCanvasSvg: document.getElementById('ref-canvas-svg'),
  refCanvasStage: document.getElementById('ref-canvas-stage'),
  refCanvasEmpty: document.getElementById('ref-canvas-empty'),
  refCanvasStatus: document.getElementById('ref-canvas-status'),
  refCanvasSubtitle: document.getElementById('ref-canvas-subtitle'),
  refCanvasHealthPanel: document.getElementById('ref-canvas-health-panel'),
  refCanvasHealthBadge: document.getElementById('ref-canvas-health-badge'),
  refCanvasHealthCopy: document.getElementById('ref-canvas-health-copy'),
  refCanvasHealthJson: document.getElementById('ref-canvas-health-json'),
  refCanvasFitBtn: document.getElementById('ref-canvas-fit-btn'),
  refCanvasResetBtn: document.getElementById('ref-canvas-reset-btn'),
  refCanvasCloseBtn: document.getElementById('ref-canvas-close-btn'),
  clearSelectionBtn: document.getElementById('clear-selection-btn'),
  jobsSummary: document.getElementById('jobs-summary'),
  jobsSummaryDuplicate: document.getElementById('jobs-summary-duplicate'),
  openJobsFileBtn: document.getElementById('open-jobs-file-btn'),
  jobsEmpty: document.getElementById('jobs-empty'),
  jobList: document.getElementById('job-list'),
  miniJobList: document.getElementById('mini-job-list'),
  engineSelect: document.getElementById('engine-select'),
  scriptFile: document.getElementById('script-file'),
  scriptName: document.getElementById('script-name'),
  uploadScriptBtn: document.getElementById('upload-script-btn'),
  clearScriptBtn: document.getElementById('clear-script-btn'),
  createBundleBtn: document.getElementById('create-bundle-btn'),
  refreshFolderBtn: document.getElementById('refresh-folder-btn'),
  runSelectedBtn: document.getElementById('run-selected-btn'),
  runReferencesBtn: document.getElementById('run-references-btn'),
  runFolderBtn: document.getElementById('run-folder-btn'),
  progressCard: document.getElementById('progress-card'),
  progressLabel: document.getElementById('progress-label'),
  progressDetail: document.getElementById('progress-detail'),
  progressPhases: document.getElementById('progress-phases'),
  notice: document.getElementById('top-notice'),
  noticeCopy: document.querySelector('#top-notice .notice-copy'),
  noticeIconSlot: document.getElementById('notice-icon-slot'),
  dismissNotice: document.getElementById('dismiss-notice'),
  statusText: document.getElementById('status-text'),
  toast: document.getElementById('toast'),
  tooltip: document.getElementById('global-tooltip'),
};

function setCurrentEntries(entries) {
  state.currentEntries = Array.isArray(entries) ? entries : [];
  state.openRowMenuItemId = null;
  rebuildCurrentEntryIndexes();
}

function rebuildCurrentEntryIndexes() {
  const byId = new Map();
  const byName = new Map();

  for (const entry of state.currentEntries) {
    byId.set(entry.id, entry);
    if (entry?.kind !== 'file') {
      continue;
    }
    const nameKey = String(entry.name || '').trim().toLowerCase();
    if (!nameKey) {
      continue;
    }
    if (!byName.has(nameKey)) {
      byName.set(nameKey, entry);
    } else {
      byName.set(nameKey, null);
    }
  }

  state.currentEntriesById = byId;
  state.currentFolderFilesByName = byName;
}

function rebuildJobIndexes() {
  const latest = new Map();

  for (const job of state.jobs.values()) {
    const key = String(job?.sourceItemId || '').trim();
    if (!key) {
      continue;
    }
    const previous = latest.get(key);
    const previousTime = new Date(previous?.updatedAt || previous?.createdAt || 0).getTime();
    const nextTime = new Date(job.updatedAt || job.createdAt || 0).getTime();
    if (!previous || nextTime >= previousTime) {
      latest.set(key, job);
    }
  }

  state.latestJobsBySourceItemId = latest;
}

function getCurrentEntryById(id) {
  return state.currentEntriesById.get(String(id || '').trim()) || null;
}


function readStoredPanelCollapse(side) {
  const key = panelStorageKeys[side];
  if (!key) {
    return false;
  }
  try {
    return window.sessionStorage.getItem(key) === '1';
  } catch (error) {
    return false;
  }
}

function persistPanelCollapse(side, collapsed) {
  const key = panelStorageKeys[side];
  if (!key) {
    return;
  }
  try {
    if (collapsed) {
      window.sessionStorage.setItem(key, '1');
    } else {
      window.sessionStorage.removeItem(key);
    }
  } catch (error) {
    // Ignore storage failures.
  }
}

function loadPanelLayoutState() {
  state.layout.leftCollapsed = readStoredPanelCollapse('left');
  state.layout.rightCollapsed = readStoredPanelCollapse('right');
}

function renderPanelToggleButton(button, side, collapsed) {
  if (!button) {
    return;
  }

  const isLeft = side === 'left';
  const icon = isLeft
    ? (collapsed ? panelToggleIcons.right : panelToggleIcons.left)
    : (collapsed ? panelToggleIcons.left : panelToggleIcons.right);
  const actionLabel = `${collapsed ? 'Open' : 'Close'} ${isLeft ? 'left' : 'right'} panel`;

  button.innerHTML = `<span class="panel-toggle-btn__icon" aria-hidden="true">${icon}</span>`;
  button.setAttribute('aria-label', actionLabel);
  button.setAttribute('title', actionLabel);
  button.setAttribute('aria-expanded', String(!collapsed));
  button.dataset.collapsed = collapsed ? 'true' : 'false';
}

function renderPanelLayout() {
  const leftCollapsed = Boolean(state.layout.leftCollapsed);
  const rightCollapsed = Boolean(state.layout.rightCollapsed);

  els.workspaceShell?.classList.toggle('panel-left-collapsed', leftCollapsed);
  els.contentLayout?.classList.toggle('panel-right-collapsed', rightCollapsed);
  els.leftPanel?.classList.toggle('is-collapsed', leftCollapsed);
  els.rightPanel?.classList.toggle('is-collapsed', rightCollapsed);

  renderPanelToggleButton(els.leftPanelToggleBtn, 'left', leftCollapsed);
  renderPanelToggleButton(els.rightPanelToggleBtn, 'right', rightCollapsed);
}

function togglePanelLayout(side) {
  if (side === 'left') {
    state.layout.leftCollapsed = !state.layout.leftCollapsed;
    persistPanelCollapse('left', state.layout.leftCollapsed);
  } else if (side === 'right') {
    state.layout.rightCollapsed = !state.layout.rightCollapsed;
    persistPanelCollapse('right', state.layout.rightCollapsed);
  }

  hideTooltip();
  renderPanelLayout();
}

function resetBrowserState() {
  beginBrowserGeneration();
  state.hubs = [];
  state.projects = [];
  state.topFolders = [];
  state.currentHubId = null;
  state.currentProject = null;
  state.currentFolderPath = [];
  setCurrentEntries([]);
  state.selectedItemIds.clear();
  resetReferenceState();
  resetRefCanvas({ keepPanel: false });
}

function clearSessionJobState() {
  stopAllPolling();
  state.jobs.clear();
  rebuildJobIndexes();
  clearSubmissionProgress();
  resetRefCanvas({ keepPanel: false, preserveTreeCache: true });
}

function beginBrowserGeneration() {
  state.browserGeneration += 1;
  return state.browserGeneration;
}

function hasExplicitBrowserGeneration(generation) {
  return generation !== null
    && generation !== undefined
    && generation !== ''
    && Number.isFinite(Number(generation));
}

function resolveBrowserGeneration(generation, { bumpIfMissing = true } = {}) {
  if (hasExplicitBrowserGeneration(generation)) {
    return Number(generation);
  }
  return bumpIfMissing ? beginBrowserGeneration() : Number(state.browserGeneration || 0);
}

function isActiveBrowserGeneration(generation) {
  return Number(generation || 0) === Number(state.browserGeneration || 0);
}

function renderWorkspaceShell() {
  renderProjectTree();
  renderTopFolders();
  renderBreadcrumb();
  renderEntries();
}

function applyBootstrapPayload(payload) {
  state.bootstrapLoadedAt = new Date().toISOString();
  state.config = payload?.config || null;
  state.csrfToken = String(state.config?.security?.csrfToken || '');
  state.engines = Array.isArray(payload?.engines) ? payload.engines : [];

  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  const activeIds = new Set(jobs.map((job) => job.id));
  for (const id of [...state.pollers.keys()]) {
    if (!activeIds.has(id)) {
      stopPolling(id);
    }
  }
  state.jobs.clear();
  for (const job of jobs) {
    state.jobs.set(job.id, job);
    if (jobNeedsPolling(job)) {
      ensurePolling(job.id);
    }
  }
  rebuildJobIndexes();
  renderConfig();
  renderJobs();
  renderEntries();
}

async function loadBootstrap() {
  const payload = await api('/api/bootstrap');
  applyBootstrapPayload(payload);
  return payload;
}

function closeEventStream() {
  if (state.eventStream) {
    state.eventStream.close();
    state.eventStream = null;
  }
}

function applyRefCanvasHealthEvent(entry) {
  if (!entry || typeof entry !== 'object' || !entry.projectId || !entry.itemId) {
    return;
  }
  const entryKey = createRefCanvasHealthKey(entry.itemId, entry.projectId);
  state.refCanvas.health.byKey.set(entryKey, entry);
  applyRefCanvasHealthEntryToNode(entry);
  updateRefCanvasScenePositions();
  renderRefCanvas();
}

function clearRefCanvasHealthEventState() {
  stopRefCanvasHealthPolling();
  if (!state.refCanvas?.health) {
    return;
  }
  state.refCanvas.health.byKey = new Map();
  state.refCanvas.health.activeKey = '';
  state.refCanvas.health.requestSerial = 0;
  for (const node of getRefCanvasNodes()) {
    node.healthStatus = 'unknown';
    node.healthReport = '';
    node.healthCounts = null;
    node.healthHeader = null;
  }
  updateRefCanvasScenePositions();
  renderRefCanvas();
}

function handleSessionEvent(payload) {
  if (!payload || typeof payload !== 'object') {
    return;
  }
  if (payload.type === 'jobs-cleared') {
    clearSessionJobState();
    renderJobs();
    renderEntries();
    return;
  }
  if (payload.type === 'ref-canvas-health-cleared') {
    clearRefCanvasHealthEventState();
    return;
  }
  if (payload.type === 'ref-canvas-health-updated' && payload.entry) {
    applyRefCanvasHealthEvent(payload.entry);
    return;
  }
  if (payload.type !== 'job-updated' || !payload.job?.id) {
    return;
  }

  const job = payload.job;
  state.jobs.set(job.id, job);
  if (jobNeedsPolling(job)) {
    ensurePolling(job.id);
  } else {
    stopPolling(job.id);
  }
  rebuildJobIndexes();
  renderJobs();
  renderEntries();
}

function initEventStream() {
  closeEventStream();
  if (!window.EventSource) {
    return;
  }

  const stream = new window.EventSource('/api/events');
  stream.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data || '{}');
      handleSessionEvent(payload);
    } catch (error) {
      console.error(error);
    }
  };
  stream.onerror = () => {
    // Native EventSource will retry automatically.
  };
  state.eventStream = stream;
}

async function refreshShellData() {
  await loadBootstrap();
  initEventStream();
  renderWorkspaceShell();
}

const statusIcons = {
  success: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.8"></circle>
      <path d="m7.4 12.3 3.1 3.1 6.2-6.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>`,
  error: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5 21 12l-9 8.5L3 12Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>
      <path d="M12 8.2v5.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
      <circle cx="12" cy="16.7" r="1.1" fill="currentColor"></circle>
    </svg>`,
  warning: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4.4 20 18.2H4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>
      <path d="M12 9.2v4.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
      <circle cx="12" cy="17" r="1.1" fill="currentColor"></circle>
    </svg>`,
  running: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.3 7.7A7 7 0 1 1 5.1 15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"></path>
      <path d="M6 4.8v4h4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>`,
  queued: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.8" fill="none" stroke="currentColor" stroke-width="1.7"></circle>
      <path d="M12 7.8v4.6l3 1.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>`,
  ready: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.4 9.2 16.6 19 7.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>`,
  idle: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.8" fill="none" stroke="currentColor" stroke-width="1.7"></circle>
      <circle cx="12" cy="12" r="1.8" fill="currentColor"></circle>
    </svg>`,
  log: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 4.5h8.5L19 8v11.5H7z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"></path>
      <path d="M15.5 4.5V8H19" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"></path>
      <path d="M10 11.5h6M10 15h6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path>
    </svg>`,
};

function buildOpenDrawingHref(projectId, itemId) {
  const normalizedProjectId = String(projectId || '').trim();
  const normalizedItemId = String(itemId || '').trim();
  if (!normalizedProjectId || !normalizedItemId) {
    return '#';
  }
  return `/api/projects/${encodeURIComponent(normalizedProjectId)}/items/${encodeURIComponent(normalizedItemId)}/open-drawing`;
}

function getAutoCadWebHref(entry) {
  return buildOpenDrawingHref(state.currentProject?.id, entry?.id);
}

function normalizeExternalHref(value) {
  const href = String(value || '').trim();
  if (!href) {
    return '';
  }
  try {
    const url = new URL(href, window.location.origin);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return '';
    }
    return url.href;
  } catch {
    return '';
  }
}

function findCurrentFolderFileByName(name) {
  const wanted = String(name || '').trim().toLowerCase();
  if (!wanted) {
    return null;
  }

  return state.currentFolderFilesByName.get(wanted) || null;
}


function getReferenceSelectionItemId(ref) {
  const directTargetItemId = String(ref?.targetItemId || '').trim();
  if (directTargetItemId) {
    return directTargetItemId;
  }

  const currentFolderMatch = findCurrentFolderFileByName(ref?.targetName);
  return String(currentFolderMatch?.id || '').trim();
}

function getEligibleReferenceIds(refs) {
  return Array.from(new Set(
    (Array.isArray(refs) ? refs : [])
      .map((ref) => getReferenceSelectionItemId(ref))
      .filter(Boolean),
  ));
}

function getEffectiveSelectedReferenceItemIds() {
  const selected = new Set();

  for (const sourceId of state.selectedReferenceSourceIds) {
    const sourceState = getReferenceState(sourceId);
    const refs = Array.isArray(sourceState?.refs) ? sourceState.refs : [];
    for (const ref of refs) {
      const itemId = getReferenceSelectionItemId(ref);
      if (itemId) {
        selected.add(itemId);
      }
    }
  }

  for (const itemId of state.manualReferenceIncludeIds) {
    if (itemId) {
      selected.add(itemId);
    }
  }

  for (const itemId of state.manualReferenceExcludeIds) {
    selected.delete(itemId);
  }

  return selected;
}

function getReferenceSourceSelectionState(entryId, effectiveSelectedIds = getEffectiveSelectedReferenceItemIds()) {
  const referenceState = getReferenceState(entryId);
  const refs = Array.isArray(referenceState?.refs) ? referenceState.refs : [];
  const eligibleIds = getEligibleReferenceIds(refs);
  const selectedCount = eligibleIds.filter((itemId) => effectiveSelectedIds.has(itemId)).length;
  const unresolvedCount = refs.filter((ref) => !getReferenceSelectionItemId(ref)).length;
  const checked = eligibleIds.length > 0
    && state.selectedReferenceSourceIds.has(entryId)
    && eligibleIds.every((itemId) => !state.manualReferenceExcludeIds.has(itemId));
  const indeterminate = !checked && selectedCount > 0;

  return {
    eligibleIds,
    selectableCount: eligibleIds.length,
    selectedCount,
    unresolvedCount,
    checked,
    indeterminate,
  };
}

function toggleReferenceSourceSelection(entryId, checked) {
  const { eligibleIds } = getReferenceSourceSelectionState(entryId);
  if (!eligibleIds.length) {
    return;
  }

  if (checked) {
    state.selectedReferenceSourceIds.add(entryId);
    eligibleIds.forEach((itemId) => state.manualReferenceExcludeIds.delete(itemId));
  } else {
    state.selectedReferenceSourceIds.delete(entryId);
  }

  renderEntries();
}

function toggleReferenceItemSelection(itemId, checked) {
  const normalizedItemId = String(itemId || '').trim();
  if (!normalizedItemId) {
    return;
  }

  if (checked) {
    state.manualReferenceIncludeIds.add(normalizedItemId);
    state.manualReferenceExcludeIds.delete(normalizedItemId);
  } else {
    state.manualReferenceIncludeIds.delete(normalizedItemId);
    state.manualReferenceExcludeIds.add(normalizedItemId);
  }

  renderEntries();
}

function formatSelectionSummary(fileCount, referenceCount) {
  const parts = [];
  if (fileCount > 0) {
    parts.push(`${fileCount} ${fileCount === 1 ? 'file' : 'files'}`);
  }
  if (referenceCount > 0) {
    parts.push(`${referenceCount} ${referenceCount === 1 ? 'ref' : 'refs'}`);
  }

  const longLabel = parts.length ? parts.join(' • ') : '0 items';
  const shortLabel = parts.length ? parts.join(' · ') : '0 selected';
  return { longLabel, shortLabel };
}

function getReferenceOpenHref(ref) {
  const resolvedItemId = getReferenceSelectionItemId(ref);
  if (resolvedItemId) {
    return buildOpenDrawingHref(state.currentProject?.id, resolvedItemId);
  }

  return normalizeExternalHref(ref?.targetWebViewUrl);
}

function renderReferenceTargetName(ref) {
  const targetName = escapeHtml(ref?.targetName || '—');
  const href = getReferenceOpenHref(ref);
  if (!href || href === '#') {
    return targetName;
  }

  const resolvedViaNameMatch = !String(ref?.targetItemId || '').trim() && Boolean(getReferenceSelectionItemId(ref));
  const tooltipFooter = resolvedViaNameMatch
    ? 'Resolved by matching a DWG in the current folder.'
    : 'Resolved from Autodesk Docs reference metadata.';

  return `<a class="refs-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" data-tooltip-title="Open referenced drawing" data-tooltip="Open ${targetName} directly in ACC Docs." data-tooltip-footer="${escapeHtml(tooltipFooter)}" data-tooltip-icon="file">${targetName}</a>`;
}

const weaveIcons = {
  folder24: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11.79 6L9 4H2V20H21V6H11.79ZM3 5H9L10.8 6.42L10 7H3V5ZM20 19H3V8H10.26L11.78 7H20V19Z" fill="currentColor"></path>
    </svg>`,
  file24: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 3H4V21H20V8L15 3ZM16 5.41L17.59 7H16V5.41ZM19 20H5V4H15V8H19V20Z" fill="currentColor"></path>
    </svg>`,
  ellipsis16: `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="2" r="2" fill="currentColor"></circle>
      <circle cx="8" cy="8" r="2" fill="currentColor"></circle>
      <circle cx="8" cy="14" r="2" fill="currentColor"></circle>
    </svg>`,
};

function renderFileTypeIcon(kind = 'file', extraClassName = '') {
  const classes = ['file-icon', kind === 'folder' ? 'folder' : 'file'];
  if (extraClassName) {
    classes.push(extraClassName);
  }
  const icon = kind === 'folder' ? weaveIcons.folder24 : weaveIcons.file24;
  return `<span class="${classes.join(' ')}" aria-hidden="true">${icon}</span>`;
}

function renderEllipsisIcon() {
  return weaveIcons.ellipsis16;
}

const noticeIcons = {
  info: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.8"></circle>
      <path d="M12 10.4v6.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
      <circle cx="12" cy="7" r="1.1" fill="currentColor"></circle>
    </svg>`,
  success: statusIcons.success,
  error: statusIcons.error,
};

const tooltipIcons = {
  info: noticeIcons.info,
  log: statusIcons.log,
  refresh: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22 13.81L21.78 4.21001L18.91 6.28001C16.8917 3.85472 13.7508 2.66343 10.6319 3.14028C7.51288 3.61713 4.87139 5.69247 3.66999 8.61001L7.46999 9.91001C8.28422 8.14041 10.0521 7.00478 12 7.00001C13.4055 7.00144 14.7439 7.60153 15.68 8.65001L12.86 10.71L22 13.81ZM16.42 8.00001C15.1903 6.61418 13.3844 5.8815 11.5368 6.0188C9.68911 6.1561 8.01134 7.14765 6.99999 8.70001L5.05999 8.00001C6.37442 5.73857 8.71138 4.26254 11.3182 4.0473C13.925 3.83205 16.4724 4.90479 18.14 6.92001L18.74 7.64001L20.74 6.16001L20.89 12.4L14.97 10.4L17.17 8.80001L16.42 8.00001ZM12.7553 16.9206C14.4097 16.6653 15.8266 15.599 16.53 14.08L20.34 15.42C19.1491 18.3578 16.5005 20.4524 13.3673 20.9342C10.2342 21.4161 7.07862 20.2142 5.05999 17.77L2.26999 19.77L2.04999 10.17L11.14 13.27L8.29999 15.35C9.42856 16.5863 11.1009 17.1759 12.7553 16.9206ZM5.82999 17.09C7.34929 18.9322 9.61209 19.9995 12 20C14.8837 20.0258 17.5582 18.4976 19 16L17 15.29C15.9791 16.8333 14.3033 17.8192 12.4584 17.9619C10.6135 18.1045 8.806 17.388 7.55999 16.02L6.81999 15.2L8.99999 13.6L3.07999 11.58L3.22999 17.83L5.22999 16.36L5.82999 17.09Z" fill="currentColor"></path>
    </svg>`,
  bundle: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.2 5.2h7.6l3 3.1v10.5H5.2V5.2Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"></path>
      <path d="M15.8 5.2v3.1h3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"></path>
      <path d="M8.8 12.1h6.4M8.8 15.5h6.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
    </svg>`,
  bolt: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13.6 3.8 7.4 12h4.2l-1.2 8.2L16.6 12h-4.2z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"></path>
    </svg>`,
  clear: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19 5H16V3.13C16.0287 2.54432 15.5848 2.04273 15 2H8C7.42253 2.05736 6.9867 2.54984 7 3.13V5H4V9H5V22H18V9H19V5ZM15 3V5H14V4H9V5H8V3H15ZM17 21H6V9H17V21ZM18 8H5V6H18V8Z" fill="currentColor"></path>
    </svg>`,
  folder: weaveIcons.folder24,
  file: weaveIcons.file24,
  status: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.8" fill="none" stroke="currentColor" stroke-width="1.7"></circle>
      <path d="M12 8.4v4.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"></path>
      <circle cx="12" cy="16.2" r="1" fill="currentColor"></circle>
    </svg>`,
};


const panelToggleIcons = {
  left: `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10 3L5 8L10 13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>`,
  right: `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 3L11 8L6 13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>`,
};

const panelStorageKeys = {
  left: 'coffee-break:left-panel-collapsed',
  right: 'coffee-break:right-panel-collapsed',
};

const treeIcons = {
  chevronRight: `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 3L11 8L6 13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>`,
  chevronDown: `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 6L8 11L13 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>`,
  hub: `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M16 0H2V3H10.41L15 7.59V12C15.5523 12 16 11.5523 16 11V0ZM14 8L10 4V8H14ZM9 14H12V9H14V16H0V4H9V6H2V14H7V12H6V13H3V7H5V9H6V7H9V9H11V13H10V12H9V14Z" fill="currentColor"></path>
    </svg>`,
  folder: weaveIcons.folder24,
  project: weaveIcons.folder24,
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


function getPendingAuthError() {
  const params = new URLSearchParams(window.location.search);
  const message = params.get('authError');
  if (!message) {
    return '';
  }
  params.delete('authError');
  const nextQuery = params.toString();
  const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash || ''}`;
  window.history.replaceState({}, '', nextUrl);
  return message;
}

function applyTooltipConfig(element, config = {}) {
  if (!element) {
    return;
  }

  const mappings = {
    tooltipTitle: config.title,
    tooltip: config.body,
    tooltipFooter: config.footer,
    tooltipIcon: config.icon,
    tooltipMeta: Array.isArray(config.meta) ? config.meta.filter(Boolean).join('|') : config.meta,
  };

  Object.entries(mappings).forEach(([key, value]) => {
    if (value) {
      element.dataset[key] = String(value);
    } else {
      delete element.dataset[key];
    }
  });

  if (config.side) {
    element.dataset.tooltipSide = config.side;
  }
}

function getTooltipPayload(target) {
  if (!target) {
    return null;
  }

  const rawTitle = (target.getAttribute('data-tooltip-title') || '').trim();
  const rawBody = (target.getAttribute('data-tooltip') || '').trim();
  const rawFooter = (target.getAttribute('data-tooltip-footer') || '').trim();
  const rawMeta = target.getAttribute('data-tooltip-meta') || '';
  const icon = (target.getAttribute('data-tooltip-icon') || 'info').trim();

  if (!rawTitle && !rawBody && !rawFooter) {
    return null;
  }

  let title = rawTitle;
  let body = rawBody;
  if (!title) {
    const parts = rawBody.split('\n').map((part) => part.trim()).filter(Boolean);
    title = parts.shift() || 'Details';
    body = parts.join('\n');
  }

  return {
    title,
    body,
    footer: rawFooter,
    meta: rawMeta.split('|').map((item) => item.trim()).filter(Boolean),
    icon,
  };
}

function clearSelection() {
  state.selectedItemIds.clear();
  state.selectedReferenceSourceIds.clear();
  state.manualReferenceIncludeIds.clear();
  state.manualReferenceExcludeIds.clear();
  els.fileTableBody?.querySelectorAll('.row-check').forEach((checkbox) => {
    checkbox.checked = false;
  });
  if (els.selectAll) {
    els.selectAll.checked = false;
    els.selectAll.indeterminate = false;
  }
  updateSelectionUI();
}

function closeRowMenu({ render = false } = {}) {
  if (!state.openRowMenuItemId) {
    return;
  }
  state.openRowMenuItemId = null;
  if (render) {
    renderEntries();
  }
}

function currentFolder() {
  return state.currentFolderPath[state.currentFolderPath.length - 1] || null;
}

function isAuthenticated() {
  return Boolean(state.config?.auth?.authenticated);
}

function isAutomationReady() {
  return Boolean(state.config?.automation?.setupState?.activityQualifiedId);
}

function isFailedAutomationStatus(status) {
  return String(status || '').toLowerCase().startsWith('failed');
}

function isTerminalAutomationStatus(status) {
  const normalized = String(status || '').toLowerCase();
  return normalized === 'success'
    || normalized === 'cancelled'
    || normalized === 'timeout'
    || isFailedAutomationStatus(normalized);
}

function jobNeedsPolling(job) {
  if (Number(job?.pollError?.status) === 404) {
    return false;
  }
  const status = String(job?.status || '').toLowerCase();
  if (!isTerminalAutomationStatus(status)) {
    return Boolean(job);
  }
  if (status === 'success') {
    const uploadStatus = String(job?.accUpload?.status || '').toLowerCase();
    return !['uploaded', 'failed', 'skipped-locked', 'locked', 'pending-auth', 'not-applicable'].includes(uploadStatus);
  }
  return false;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  window.clearTimeout(showToast._timer);
  showToast._timer = window.setTimeout(() => {
    els.toast.classList.add('hidden');
  }, 4200);
}

function setNotice(type, title, detail) {
  if (!els.notice || !els.noticeCopy || !els.noticeIconSlot) {
    return;
  }
  els.notice.classList.remove('notice--info', 'notice--success', 'notice--error', 'hidden');
  els.notice.classList.add(`notice--${type}`);
  els.noticeIconSlot.innerHTML = noticeIcons[type] || noticeIcons.info;
  els.noticeCopy.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span>`;
  els.statusText.textContent = detail;
}

async function api(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const request = {
    method,
    credentials: 'same-origin',
    cache: options.cache || 'no-store',
    headers: {
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  };

  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && state.csrfToken) {
    request.headers['x-csrf-token'] = state.csrfToken;
  }

  if (options.body && !(options.body instanceof FormData)) {
    request.headers['Content-Type'] = 'application/json';
    request.body = JSON.stringify(options.body);
  } else if (options.body) {
    request.body = options.body;
  }

  const response = await fetch(url, request);
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof payload === 'string'
      ? payload
      : payload?.error?.message || payload?.error?.details || payload?.message || `Request failed with ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function formatDate(value) {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}


function formatAccVersionLabel(value) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  const textValue = String(value).trim();
  if (!textValue) {
    return '—';
  }
  if (/^V\d+$/i.test(textValue)) {
    return textValue.toUpperCase();
  }
  const parsed = Number.parseInt(textValue, 10);
  return Number.isFinite(parsed) ? `V${parsed}` : textValue;
}

function formatCountMap(counts) {
  const pairs = Object.entries(counts || {}).filter(([, count]) => Number(count) > 0);
  if (!pairs.length) {
    return '';
  }
  return pairs
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, count]) => `${label}: ${count}`)
    .join(', ');
}

function beginSubmissionProgress(label, count = null) {
  state.activeSubmissionLabel = label || '';
  state.activeSubmissionCount = Number.isFinite(Number(count)) ? Number(count) : null;
  renderProgressCard();
}

function clearSubmissionProgress() {
  state.activeSubmissionLabel = '';
  state.activeSubmissionCount = null;
  renderProgressCard();
}

function getProgressPhaseSummary() {
  const summary = { staging: state.activeSubmissionLabel ? (state.activeSubmissionCount || 1) : 0, automation: 0, publish: 0, complete: 0 };
  for (const job of state.jobs.values()) {
    if (!job) {
      continue;
    }
    if (Number(job?.pollError?.status) === 404) {
      summary.complete += 1;
      continue;
    }
    const status = String(job.status || '').toLowerCase();
    const uploadStatus = String(job.accUpload?.status || '').toLowerCase();
    const hasWorkItemId = Boolean(job.workItemId);
    if (!hasWorkItemId || ['queued', 'staging-source', 'staging-refs', 'submitting'].includes(status)) {
      summary.staging += 1;
      continue;
    }
    if (!isTerminalAutomationStatus(status)) {
      summary.automation += 1;
      continue;
    }
    if (status === 'success' && !['uploaded', 'failed', 'skipped-locked', 'locked', 'pending-auth', 'not-applicable'].includes(uploadStatus)) {
      summary.publish += 1;
      continue;
    }
    summary.complete += 1;
  }
  summary.active = summary.staging + summary.automation + summary.publish;
  return summary;
}

function renderProgressPhaseChip(label, count, active = false) {
  return `<span class="progress-phase${active ? ' is-active' : ''}"><span>${escapeHtml(label)}</span><span class="progress-phase__count">${escapeHtml(String(count))}</span></span>`;
}

function formatFileSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size < 0) {
    return '—';
  }
  if (size < 1024) {
    return `${Math.round(size)} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let current = size / 1024;
  let unitIndex = 0;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  const rounded = current >= 100 ? Math.round(current) : current >= 10 ? current.toFixed(1) : current.toFixed(1);
  const normalized = String(rounded).replace(/\.0$/, '');
  return `${normalized} ${units[unitIndex]}`;
}

function formatHubRegionLabel(value) {
  const textValue = String(value || '').trim();
  return textValue ? textValue.toUpperCase() : 'UNKNOWN';
}

function download(url) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.rel = 'noopener';
  anchor.click();
}

function resetReferenceState() {
  state.expandedRefItemIds.clear();
  state.refsByItemId.clear();
  state.expandedRefListItemIds.clear();
  state.refListsByItemId.clear();
  state.selectedReferenceSourceIds.clear();
  state.manualReferenceIncludeIds.clear();
  state.manualReferenceExcludeIds.clear();
}

function getReferenceState(itemId) {
  return state.refsByItemId.get(itemId) || {
    status: 'idle',
    refs: [],
    meta: null,
    error: '',
  };
}

function getRefListState(itemId) {
  return state.refListsByItemId.get(itemId) || {
    status: 'idle',
    payload: null,
    error: '',
  };
}

function isReferenceExpanded(itemId) {
  return state.expandedRefItemIds.has(itemId);
}

function isRefListExpanded(itemId) {
  return state.expandedRefListItemIds.has(itemId);
}

function syntaxHighlightJson(value) {
  const json = typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2);
  const tokenPattern = /("(?:\u[a-zA-Z0-9]{4}|\[^u]|[^\"])*"\s*:|"(?:\u[a-zA-Z0-9]{4}|\[^u]|[^\"])*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)/g;
  let result = '';
  let lastIndex = 0;

  for (const match of json.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    result += escapeHtml(json.slice(lastIndex, index));
    const token = match[0];
    let className = 'json-number';
    if (/^"/.test(token)) {
      className = /:\s*$/.test(token) ? 'json-key' : 'json-string';
    } else if (token === 'true' || token === 'false') {
      className = 'json-boolean';
    } else if (token === 'null') {
      className = 'json-null';
    }
    result += `<span class="${className}">${escapeHtml(token)}</span>`;
    lastIndex = index + token.length;
  }

  result += escapeHtml(json.slice(lastIndex));
  return result;
}

function renderJsonEditor(value, label = 'Formatted JSON editor') {
  const jsonText = JSON.stringify(value ?? {}, null, 2);
  const lineCount = jsonText.split('\n').length;
  return `
    <div class="json-editor-shell">
      <div class="json-editor-shell__top">
        <span class="meta-label">Formatted editor</span>
        <span class="json-editor-shell__meta">${escapeHtml(`${lineCount} lines`)}</span>
      </div>
      <pre class="json-editor" tabindex="0" aria-label="${escapeHtml(label)}"><code>${syntaxHighlightJson(jsonText)}</code></pre>
    </div>
  `;
}

function renderReferencePanel(entry, referenceState = getReferenceState(entry.id)) {
  const refs = Array.isArray(referenceState?.refs) ? referenceState.refs : [];
  const effectiveSelectedIds = getEffectiveSelectedReferenceItemIds();
  const sourceSelection = getReferenceSourceSelectionState(entry.id, effectiveSelectedIds);

  if (referenceState?.status === 'loading') {
    return `
      <div class="refs-panel">
        <div class="refs-panel__empty">Loading references...</div>
      </div>
    `;
  }

  if (referenceState?.status === 'error') {
    return `
      <div class="refs-panel refs-panel--error">
        <div class="refs-panel__empty">${escapeHtml(referenceState.error || 'Could not load references.')}</div>
      </div>
    `;
  }

  if (!refs.length) {
    return `
      <div class="refs-panel">
        <div class="refs-panel__empty">No from-direction references were returned for this file.</div>
      </div>
    `;
  }

  const metaParts = [
    `${refs.length} reference${refs.length === 1 ? '' : 's'}`,
    `${sourceSelection.selectedCount}/${sourceSelection.selectableCount} selected`,
  ];
  if (sourceSelection.unresolvedCount > 0) {
    metaParts.push(`${sourceSelection.unresolvedCount} not selectable`);
  }

  return `
    <div class="refs-panel">
      <div class="refs-panel__header">
        <div>
          <strong>${escapeHtml(entry.name)} references</strong>
          <div class="refs-panel__meta">${escapeHtml(metaParts.join(' • '))}</div>
        </div>
      </div>
      <div class="refs-table-wrap">
        <table class="refs-table" aria-label="From references for ${escapeHtml(entry.name)}">
          <thead>
            <tr>
              <th class="select-col">
                <label class="check-wrap header-check${sourceSelection.selectableCount ? '' : ' is-disabled'}" aria-label="Select all refs for ${escapeHtml(entry.name)}" data-tooltip-title="Select all refs" data-tooltip="Select or clear the resolved references for ${escapeHtml(entry.name)}." data-tooltip-footer="Only resolved reference files can be submitted to Design Automation." data-tooltip-icon="file">
                  <input type="checkbox" data-select-ref-source="${escapeHtml(entry.id)}" data-indeterminate="${sourceSelection.indeterminate ? 'true' : 'false'}" ${sourceSelection.checked ? 'checked' : ''} ${sourceSelection.selectableCount ? '' : 'disabled'} />
                  <span></span>
                </label>
              </th>
              <th>Name</th>
              <th>Version</th>
              <th>Date Modified</th>
              <th>File Size</th>
              <th>Job Status</th>
              <th>Nested Type</th>
            </tr>
          </thead>
          <tbody>
            ${refs.map((ref, index) => {
              const targetName = ref?.targetName || `Reference ${index + 1}`;
              const selectionItemId = getReferenceSelectionItemId(ref);
              const selectable = Boolean(selectionItemId);
              const checked = selectable && effectiveSelectedIds.has(selectionItemId);
              const versionLabel = formatAccVersionLabel(ref?.targetVersionLabel || ref?.targetVersionNumber);
              const hasVersion = versionLabel !== '—';
              const disabledTooltip = selectable
                ? ''
                : 'data-tooltip-title="Reference not selectable" data-tooltip="Autodesk did not return a resolvable ACC Docs item for this reference." data-tooltip-footer="Open the link if available, or resolve the reference in the current folder first." data-tooltip-icon="status"';
              const refStatusInfo = selectable
                ? buildStatusInfo({ kind: 'file', id: selectionItemId }, state.latestJobsBySourceItemId.get(selectionItemId) || null)
                : {
                    kind: 'warning',
                    label: 'Unresolved',
                    helper: 'Resolve target first',
                    tooltip: 'Autodesk did not return a resolvable ACC Docs item for this reference in the current folder.',
                    reportUrl: null,
                  };
              return `
                <tr>
                  <td>
                    <label class="check-wrap${selectable ? '' : ' is-disabled'}" aria-label="Select ${escapeHtml(targetName)}" ${disabledTooltip}>
                      <input class="ref-row-check" type="checkbox" data-select-ref-item="${escapeHtml(selectionItemId)}" ${checked ? 'checked' : ''} ${selectable ? '' : 'disabled'} />
                      <span></span>
                    </label>
                  </td>
                  <td>
                    <div class="row-main row-main--compact">
                      ${renderFileTypeIcon('file', 'file-icon--ref')}
                      <div class="refs-target-copy row-title">${renderReferenceTargetName(ref)}</div>
                    </div>
                  </td>
                  <td><span class="version-pill${hasVersion ? '' : ' neutral'}">${escapeHtml(versionLabel)}</span></td>
                  <td>${escapeHtml(formatDate(ref?.targetLastModifiedTime))}</td>
                  <td>${escapeHtml(formatFileSize(ref?.targetFileSize ?? ref?.targetStorageSize ?? ref?.targetSize))}</td>
                  <td><div class="status-stack status-stack--compact">${renderStatusControl(refStatusInfo, { helper: Boolean(refStatusInfo?.helper && refStatusInfo.helper.startsWith('Uploaded w/Circle')) })}</div></td>
                  <td>${escapeHtml(ref.nestedType || '—')}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderRefListPanel(entry, refListState = getRefListState(entry.id)) {
  if (refListState?.status === 'loading') {
    return `
      <div class="ref-json-panel">
        <div class="ref-json-panel__empty">Loading unfiltered ListRef JSON...</div>
      </div>
    `;
  }

  if (refListState?.status === 'error') {
    return `
      <div class="ref-json-panel ref-json-panel--error">
        <div class="ref-json-panel__empty">${escapeHtml(refListState.error || 'Could not load the Reference JSON.')}</div>
      </div>
    `;
  }

  const payload = refListState?.payload || { data: [], meta: {} };
  const rowCount = Array.isArray(payload.data) ? payload.data.length : 0;
  const directionSummary = formatCountMap(payload.meta?.directions);
  const refTypeSummary = formatCountMap(payload.meta?.refTypes);
  const metaParts = [
    `${rowCount} relationship${rowCount === 1 ? '' : 's'}`,
    payload.meta?.retrievedVia || 'ListRefs',
    payload.meta?.sourceVersionLabel || payload.meta?.sourceVersionNumber ? `Source ${formatAccVersionLabel(payload.meta?.sourceVersionLabel || payload.meta?.sourceVersionNumber)}` : '',
    directionSummary ? `Directions ${directionSummary}` : 'All directions',
    refTypeSummary ? `Types ${refTypeSummary}` : 'All reference types',
    payload.meta?.sourceLastModifiedTime ? formatDate(payload.meta?.sourceLastModifiedTime) : '',
  ].filter(Boolean);
  const detail = payload.meta?.generatedAt
    ? `Generated ${formatDate(payload.meta.generatedAt)} from the latest ACC tip version. Includes from/to directions and all returned reference types.`
    : 'Unfiltered ListRef JSON from the latest ACC tip version. Includes from/to directions and all returned reference types.';

  return `
    <div class="ref-json-panel">
      <div class="ref-json-panel__header">
        <div>
          <strong>${escapeHtml(entry.name)} ListRef JSON</strong>
          <div class="refs-panel__meta">${escapeHtml(metaParts.join(' • '))}</div>
        </div>
        <span class="status-helper">${escapeHtml(detail)}</span>
      </div>
      ${renderJsonEditor(payload, `Unfiltered ListRef JSON for ${entry.name}`)}
    </div>
  `;
}

async function loadReferences(entry, { force = false } = {}) {
  if (!state.currentProject || !entry?.id) {
    return;
  }

  const existing = getReferenceState(entry.id);
  if (!force && (existing.status === 'loading' || existing.status === 'loaded')) {
    return;
  }

  state.refsByItemId.set(entry.id, {
    status: 'loading',
    refs: existing.refs || [],
    meta: existing.meta || null,
    error: '',
  });
  renderEntries();

  try {
    const payload = await api(`/api/projects/${encodeURIComponent(state.currentProject.id)}/items/${encodeURIComponent(entry.id)}/refs`);
    state.refsByItemId.set(entry.id, {
      status: 'loaded',
      refs: Array.isArray(payload.data) ? payload.data : [],
      meta: payload.meta || null,
      error: '',
    });
    renderEntries();
  } catch (error) {
    state.refsByItemId.set(entry.id, {
      status: 'error',
      refs: [],
      meta: null,
      error: error.message || 'Could not load references.',
    });
    renderEntries();
    throw error;
  }
}

async function loadRefList(entry, { force = false } = {}) {
  if (!state.currentProject || !entry?.id) {
    return;
  }

  const existing = getRefListState(entry.id);
  if (!force && (existing.status === 'loading' || existing.status === 'loaded')) {
    return;
  }

  state.refListsByItemId.set(entry.id, {
    status: 'loading',
    payload: existing.payload || null,
    error: '',
  });
  renderEntries();

  try {
    const payload = await api(`/api/projects/${encodeURIComponent(state.currentProject.id)}/items/${encodeURIComponent(entry.id)}/ref-list`);
    state.refListsByItemId.set(entry.id, {
      status: 'loaded',
      payload,
      error: '',
    });
    renderEntries();
  } catch (error) {
    state.refListsByItemId.set(entry.id, {
      status: 'error',
      payload: null,
      error: error.message || 'Could not load the Reference JSON.',
    });
    renderEntries();
    throw error;
  }
}

async function toggleReferences(entry) {
  if (!entry || entry.kind !== 'file') {
    return;
  }

  if (state.expandedRefItemIds.has(entry.id)) {
    state.expandedRefItemIds.delete(entry.id);
    renderEntries();
    return;
  }

  state.expandedRefItemIds.add(entry.id);
  renderEntries();
  await loadReferences(entry);
}

async function toggleRefList(entry) {
  if (!entry || entry.kind !== 'file') {
    return;
  }

  if (state.expandedRefListItemIds.has(entry.id)) {
    state.expandedRefListItemIds.delete(entry.id);
    renderEntries();
    return;
  }

  state.expandedRefListItemIds.add(entry.id);
  renderEntries();
  await loadRefList(entry);
}

function renderEntryDetailPanels(entry, referenceState = getReferenceState(entry.id), refListState = getRefListState(entry.id)) {
  const panels = [];
  if (isReferenceExpanded(entry.id)) {
    panels.push(renderReferencePanel(entry, referenceState));
  }
  if (isRefListExpanded(entry.id)) {
    panels.push(renderRefListPanel(entry, refListState));
  }
  return panels.join('');
}

function getAvatarLabel() {
  const nickname = state.config?.credentials?.nickname?.trim();
  if (nickname) {
    return nickname
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('') || 'APS';
  }
  const clientId = state.config?.credentials?.clientId?.trim();
  if (clientId) {
    return clientId.slice(0, 3).toUpperCase();
  }
  return 'APS';
}

function getCredentialStateLabel() {
  if (!state.config?.credentials?.configured) {
    return { text: 'No credentials', className: 'status-tag neutral inline-state' };
  }
  if (isAuthenticated()) {
    return { text: 'Connected', className: 'status-tag success inline-state' };
  }
  return {
    text: state.config?.credentials?.source === 'session' ? 'Session credentials' : 'Env credentials',
    className: 'status-tag ready inline-state',
  };
}
function formatStatusWords(value) {
  return String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function getCircularUploadStatusLabel(job) {
  const relationType = String(job?.publishCircle?.relationType || '').trim().toLowerCase();
  if (relationType === 'attachment') {
    return 'Uploaded w/Circle Attach';
  }
  if (relationType === 'overlay') {
    return 'Uploaded w/Circle Overlay';
  }
  return '';
}

function formatAccUploadStatusLabel(status, job = null) {
  const normalized = String(status || 'pending').toLowerCase();
  if (normalized === 'uploaded') {
    return getCircularUploadStatusLabel(job) || 'Uploaded';
  }
  if (normalized === 'pending-auth') {
    return 'Sign in';
  }
  if (normalized === 'skipped-locked' || normalized === 'locked') {
    return 'Locked';
  }
  if (normalized === 'failed') {
    return 'Failed';
  }
  if (normalized === 'pending') {
    return 'Pending';
  }
  if (normalized === 'not-applicable') {
    return 'Not applicable';
  }
  if (normalized === 'queued') {
    return 'Queued for upload';
  }
  if (normalized === 'publishing') {
    return 'Publishing new version';
  }
  return formatStatusWords(normalized);
}


function getLatestJobForEntry(entry) {
  if (entry?.kind !== 'file') {
    return null;
  }
  return state.latestJobsBySourceItemId.get(entry.id) || null;
}

function renderCurrentContext() {
  els.currentHub.textContent = state.hubs.find((hub) => hub.id === state.currentHubId)?.name || '—';
  els.currentProject.textContent = state.currentProject?.name || '—';
}

function formatDurationLabel(value) {
  const durationMs = Number(value);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return '';
  }
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function summarizeBlockerNames(names, limit = 2) {
  const values = Array.isArray(names) ? names.filter(Boolean) : [];
  if (!values.length) {
    return '';
  }
  const head = values.slice(0, limit).join(', ');
  return values.length > limit ? `${head} +${values.length - limit} more` : head;
}

function getAutomationJobDaBadgeInfo(job) {
  const status = String(job?.status || '').trim().toLowerCase();
  if (['queued', 'staging-source', 'staging-refs', 'submitting'].includes(status)) {
    return {
      label: 'Staging',
      tone: status === 'queued' ? 'queued' : 'running',
      tooltip: `Design Automation\n${formatStatusWords(status || 'queued')}\n${String(job?.accUpload?.message || '').trim() || 'Preparing the workitem inputs.'}`.trim(),
    };
  }
  if (status === 'pending' || status === 'inprogress') {
    return {
      label: 'Running',
      tone: 'running',
      tooltip: `Design Automation\n${formatStatusWords(status)}\n${String(job?.accUpload?.message || '').trim() || 'Waiting for Automation output.'}`.trim(),
    };
  }
  if (status === 'success') {
    return {
      label: 'Success',
      tone: 'success',
      tooltip: `Design Automation\nSuccess\n${String(job?.reportUrl ? 'Output log available.' : 'Waiting for output log URL.')}`.trim(),
    };
  }
  if (status && (status.startsWith('failed') || status === 'cancelled' || status === 'timeout')) {
    return {
      label: 'Fail',
      tone: 'error',
      tooltip: `Design Automation\n${formatStatusWords(status)}\n${String(job?.accUpload?.message || 'The workitem did not complete successfully.')}`.trim(),
    };
  }
  return {
    label: 'Staging',
    tone: 'queued',
    tooltip: 'Design Automation\nPreparing the workitem inputs.',
  };
}

function getAutomationJobAccBadgeInfo(job) {
  const queueInfo = getPublishQueueInfo(job);
  const uploadStatus = String(job?.accUpload?.status || '').trim().toLowerCase();
  if (uploadStatus === 'locked' || uploadStatus === 'skipped-locked') {
    return {
      label: 'Locked',
      tone: 'warning',
      tooltip: String(job?.accUpload?.message || 'ACC upload skipped because the drawing is locked.').trim(),
    };
  }
  if (uploadStatus === 'uploaded') {
    const circularLabel = getCircularUploadStatusLabel(job);
    return {
      label: 'Uploaded',
      tone: 'success',
      tooltip: [String(job?.accUpload?.message || 'Uploaded back to ACC.').trim(), circularLabel ? `Upload detail: ${circularLabel}` : ''].filter(Boolean).join('\n'),
    };
  }
  if (uploadStatus === 'publishing' || queueInfo.state === 'publishing') {
    return {
      label: 'Publishing',
      tone: 'running',
      tooltip: String(job?.accUpload?.message || queueInfo.reason || 'Publishing the new ACC version.').trim(),
    };
  }
  if (queueInfo.state === 'waiting' || queueInfo.state === 'blocked') {
    return {
      label: 'Waiting',
      tone: 'warning',
      tooltip: [String(queueInfo.reason || job?.accUpload?.message || 'Waiting on dependency publish state.').trim(), queueInfo.blockedBy ? `Waiting on: ${queueInfo.blockedBy}` : ''].filter(Boolean).join('\n'),
    };
  }
  if (uploadStatus === 'failed') {
    return {
      label: 'Waiting',
      tone: 'warning',
      tooltip: String(job?.accUpload?.message || 'ACC upload did not complete.').trim(),
    };
  }
  return {
    label: 'Queued',
    tone: 'queued',
    tooltip: [String(queueInfo.reason || job?.accUpload?.message || 'Queued for ACC upload.').trim(), queueInfo.waitLabel ? `Queue wait: ${queueInfo.waitLabel}` : '', queueInfo.orderLabel || '', queueInfo.blockedBy ? `Waiting on: ${queueInfo.blockedBy}` : ''].filter(Boolean).join('\n'),
  };
}

function getPublishQueueInfo(job) {
  const queue = job?.publishQueue || {};
  const queueState = String(queue.state || '').trim().toLowerCase();
  const publishOrderValue = Number(job?.publishPlan?.publishOrder ?? queue.publishOrder);
  const waitMs = Number(job?.accUpload?.publishQueueWaitMs ?? queue.queueWaitMs);
  const blockerNames = Array.isArray(queue.blockerNames) ? queue.blockerNames.filter(Boolean) : [];
  const blockedBy = summarizeBlockerNames(blockerNames, 2);
  const orderLabel = Number.isFinite(publishOrderValue) ? `Order ${publishOrderValue}` : '';
  const waitLabel = formatDurationLabel(waitMs);
  let label = '';
  let tone = 'neutral';
  if (queueState === 'queued') {
    label = 'Queued for upload';
    tone = 'queued';
  } else if (queueState === 'waiting') {
    label = 'Waiting';
    tone = 'queued';
  } else if (queueState === 'blocked') {
    label = 'Waiting';
    tone = 'warning';
  } else if (queueState === 'publishing') {
    label = 'Publishing new version';
    tone = 'running';
  } else if (queueState === 'uploaded') {
    label = 'Uploaded';
    tone = 'success';
  }
  return {
    state: queueState,
    label,
    tone,
    reason: String(queue.reason || job?.accUpload?.message || '').trim(),
    blockedBy,
    blockerNames,
    waitMs,
    waitLabel,
    orderLabel,
    blockedBySccId: String(queue.blockedBySccId || '').trim(),
  };
}

function buildStatusInfo(entry, job) {
  if (!job) {
    if (entry.kind === 'folder') {
      return {
        kind: 'ready',
        label: 'Ready',
        helper: 'Folder tree available',
        tooltip: 'Run automation with no files selected to submit all DWGs in this folder and its subfolders to Design Automation.',
        reportUrl: null,
      };
    }
    return {
      kind: 'idle',
      label: 'Idle',
      helper: 'No workitem yet',
      tooltip: 'No Design Automation workitem has been submitted for this DWG in the current browser session.',
      reportUrl: null,
    };
  }

  const rawStatus = String(job.status || '').trim();
  const status = rawStatus.toLowerCase();
  const uploadStatus = String(job.accUpload?.status || '').toLowerCase();
  const updatedAt = formatDate(job.updatedAt || job.createdAt);
  const reportAvailable = Boolean(job.reportUrl);
  const reportHint = reportAvailable ? 'Open the Design Automation output log from this status control.' : 'The output log URL is not available yet.';
  const uploadMessage = job.accUpload?.message ? `Upload: ${job.accUpload.message}` : 'Upload back to ACC has not started yet.';
  const circularUploadLabel = getCircularUploadStatusLabel(job);
  const rawStatusLabel = rawStatus ? formatStatusWords(rawStatus) : 'Pending';
  const queueInfo = getPublishQueueInfo(job);
  const queueTooltipParts = [];
  if (queueInfo.label) {
    queueTooltipParts.push(`Publish queue: ${queueInfo.label}`);
  }
  if (queueInfo.reason) {
    queueTooltipParts.push(`Queue detail: ${queueInfo.reason}`);
  }
  if (queueInfo.orderLabel) {
    queueTooltipParts.push(queueInfo.orderLabel);
  }
  if (queueInfo.waitLabel) {
    queueTooltipParts.push(`Queue wait: ${queueInfo.waitLabel}`);
  }
  if (queueInfo.blockedBy) {
    queueTooltipParts.push(`Waiting for: ${queueInfo.blockedBy}`);
  }

  if (['queued', 'staging-source', 'staging-refs', 'submitting'].includes(status)) {
    const helper = status === 'queued'
      ? 'Waiting to stage'
      : status === 'staging-source'
        ? 'Staging source DWG'
        : status === 'staging-refs'
          ? 'Staging references'
          : 'Creating workitem';
    const label = status === 'submitting' ? 'Submitting' : 'Staging';
    return {
      kind: status === 'queued' ? 'queued' : 'running',
      label,
      helper,
      tooltip: `Status: ${formatStatusWords(status)}
${uploadMessage}
Updated: ${updatedAt}
${reportHint}`,
      reportUrl: job.reportUrl || null,
      queueInfo,
    };
  }

  if (status === 'success') {
    if (uploadStatus === 'uploaded') {
      const helperParts = [circularUploadLabel || 'Uploaded'];
      if (queueInfo.waitLabel) {
        helperParts.push(`Queue ${queueInfo.waitLabel}`);
      }
      return {
        kind: reportAvailable ? 'success' : 'success-pill',
        label: 'Success',
        helper: helperParts.filter(Boolean).join(' • '),
        tooltip: `Status: Success
${uploadMessage}
${queueTooltipParts.join('\n')}
Updated: ${updatedAt}
${reportHint}`,
        reportUrl: job.reportUrl || null,
        queueInfo,
      };
    }
    if (uploadStatus === 'skipped-locked' || uploadStatus === 'locked') {
      return {
        kind: 'warning',
        label: 'Locked',
        helper: 'Skipped ACC upload',
        tooltip: `Status: Success
${uploadMessage}
${queueTooltipParts.join('\n')}
Updated: ${updatedAt}
${reportHint}`,
        reportUrl: job.reportUrl || null,
        queueInfo,
      };
    }
    if (uploadStatus === 'failed' || uploadStatus === 'pending-auth') {
      return {
        kind: uploadStatus === 'failed' ? 'error' : 'warning',
        label: uploadStatus === 'pending-auth' ? 'Needs sign-in' : 'Upload failed',
        helper: queueInfo.blockedBy ? `Waiting for ${queueInfo.blockedBy}` : 'Review upload state',
        tooltip: `Status: Success
${uploadMessage}
${queueTooltipParts.join('\n')}
Updated: ${updatedAt}
${reportHint}`,
        reportUrl: job.reportUrl || null,
        queueInfo,
      };
    }

    if (queueInfo.state === 'blocked') {
      return {
        kind: 'warning',
        label: 'Waiting',
        helper: queueInfo.blockedBy ? `Waiting for ${queueInfo.blockedBy}` : 'Resolve dependency blockers',
        tooltip: `Status: Success
${uploadMessage}
${queueTooltipParts.join('\n')}
Updated: ${updatedAt}
${reportHint}`,
        reportUrl: job.reportUrl || null,
        queueInfo,
      };
    }

    if (queueInfo.state === 'waiting' || uploadStatus === 'waiting-dependencies') {
      const helperParts = [];
      if (queueInfo.blockedBy) {
        helperParts.push(`Waiting for ${queueInfo.blockedBy}`);
      }
      if (queueInfo.waitLabel) {
        helperParts.push(queueInfo.waitLabel);
      }
      return {
        kind: 'queued',
        label: 'Waiting refs',
        helper: helperParts.join(' • ') || 'Waiting for publish blockers',
        tooltip: `Status: Success
${uploadMessage}
${queueTooltipParts.join('\n')}
Updated: ${updatedAt}
${reportHint}`,
        reportUrl: job.reportUrl || null,
        queueInfo,
      };
    }

    if (queueInfo.state === 'queued') {
      const helperParts = [];
      if (queueInfo.orderLabel) {
        helperParts.push(queueInfo.orderLabel);
      }
      if (queueInfo.waitLabel) {
        helperParts.push(queueInfo.waitLabel);
      }
      return {
        kind: 'queued',
        label: 'Queued for upload',
        helper: helperParts.join(' • ') || 'Queued for upload',
        tooltip: `Status: Success
${uploadMessage}
${queueTooltipParts.join('\n')}
Updated: ${updatedAt}
${reportHint}`,
        reportUrl: job.reportUrl || null,
        queueInfo,
      };
    }

    return {
      kind: 'running',
      label: 'Publishing new version',
      helper: [queueInfo.orderLabel, queueInfo.waitLabel ? `Queue ${queueInfo.waitLabel}` : '', 'Uploading output'].filter(Boolean).join(' • '),
      tooltip: `Status: Success
${uploadMessage}
${queueTooltipParts.join('\n')}
Updated: ${updatedAt}
${reportHint}`,
      reportUrl: job.reportUrl || null,
      queueInfo,
    };
  }

  if (isFailedAutomationStatus(status) || ['cancelled', 'timeout'].includes(status)) {
    const label = status === 'timeout' ? 'Timeout' : status === 'cancelled' ? 'Cancelled' : 'Failed';
    return {
      kind: reportAvailable ? 'error' : 'error-pill',
      label,
      helper: 'Review output log',
      tooltip: `Status: ${rawStatusLabel}
${job.accUpload?.message ? `Upload: ${job.accUpload.message}` : 'No ACC version was uploaded.'}
${queueTooltipParts.join('\n')}
Updated: ${updatedAt}
${reportHint}`,
      reportUrl: job.reportUrl || null,
      queueInfo,
    };
  }

  if (['pending', 'inprogress'].includes(status)) {
    return {
      kind: status === 'pending' ? 'queued' : 'running',
      label: status === 'pending' ? 'Queued' : 'Running',
      helper: 'Workitem active',
      tooltip: `Status: ${status === 'pending' ? 'Queued' : 'Running'}
${uploadMessage}
Updated: ${updatedAt}
${reportHint}`,
      reportUrl: job.reportUrl || null,
      queueInfo,
    };
  }

  return {
    kind: 'queued',
    label: rawStatusLabel,
    helper: 'Workitem active',
    tooltip: `Status: ${rawStatusLabel}
${uploadMessage}
Updated: ${updatedAt}
${reportHint}`,
    reportUrl: job.reportUrl || null,
    queueInfo,
  };
}

function getStatusVisual(statusInfo) {
  const kind = String(statusInfo?.kind || 'idle');
  if (kind === 'success' || kind === 'success-pill') {
    return { tone: 'success', icon: statusIcons.success };
  }
  if (kind === 'error' || kind === 'error-pill') {
    return { tone: 'error', icon: statusIcons.error };
  }
  if (kind === 'warning') {
    return { tone: 'warning', icon: statusIcons.warning };
  }
  if (kind === 'running') {
    return { tone: 'running', icon: statusIcons.running };
  }
  if (kind === 'queued') {
    return { tone: 'queued', icon: statusIcons.queued };
  }
  if (kind === 'ready') {
    return { tone: 'ready', icon: statusIcons.ready };
  }
  return { tone: 'idle', icon: statusIcons.idle };
}

function getStatusTagTone(statusInfo) {
  const kind = String(statusInfo?.kind || 'idle');
  if (kind === 'success' || kind === 'success-pill') {
    return 'success';
  }
  if (kind === 'error' || kind === 'error-pill') {
    return 'error';
  }
  if (kind === 'warning') {
    return 'warning';
  }
  if (kind === 'running') {
    return 'running';
  }
  if (kind === 'queued') {
    return 'queued';
  }
  if (kind === 'ready') {
    return 'ready';
  }
  return 'neutral';
}

function buildStatusTooltipAttributes(statusInfo) {
  const meta = [];
  if (statusInfo.reportUrl) {
    meta.push('LOG');
  }
  if (statusInfo.kind === 'success' || statusInfo.kind === 'success-pill') {
    meta.push('DONE');
  } else if (statusInfo.kind === 'warning') {
    meta.push('WARN');
  } else if (statusInfo.kind === 'error' || statusInfo.kind === 'error-pill') {
    meta.push('REVIEW');
  }

  const tooltipAttrs = [
    `data-tooltip-title="${escapeHtml(statusInfo.label || 'Status')}"`,
    `data-tooltip="${escapeHtml(statusInfo.tooltip || '')}"`,
    `data-tooltip-icon="${escapeHtml(statusInfo.reportUrl ? 'log' : 'status')}"`,
  ];
  if (statusInfo.helper) {
    tooltipAttrs.push(`data-tooltip-footer="${escapeHtml(statusInfo.helper)}"`);
  }
  if (meta.length) {
    tooltipAttrs.push(`data-tooltip-meta="${escapeHtml(meta.join('|'))}"`);
  }
  return tooltipAttrs;
}

function renderStatusControl(statusInfo, { helper = true } = {}) {
  const tooltipAttrs = buildStatusTooltipAttributes(statusInfo);
  const visual = getStatusVisual(statusInfo);
  const helperMarkup = helper && statusInfo.helper
    ? `
    <span class="status-helper">${escapeHtml(statusInfo.helper || '')}</span>`
    : '';
  const ariaLabel = `${statusInfo.label || 'Status'}. ${statusInfo.tooltip || ''}`.trim();

  if (statusInfo.reportUrl) {
    return `
      <button
        type="button"
        class="status-icon-button status-${visual.tone}"
        data-report-url="${escapeHtml(statusInfo.reportUrl || '')}"
        ${tooltipAttrs.join(' ')}
        aria-label="${escapeHtml(ariaLabel)}"
      >
        ${visual.icon}
      </button>${helperMarkup}
    `;
  }

  return `
    <span
      class="status-icon-button status-${visual.tone}"
      tabindex="0"
      role="img"
      ${tooltipAttrs.join(' ')}
      aria-label="${escapeHtml(ariaLabel)}"
    >
      ${visual.icon}
    </span>${helperMarkup}
  `;
}

function renderStatusTag(statusInfo) {
  return `<span class="status-tag ${escapeHtml(getStatusTagTone(statusInfo))}" ${buildStatusTooltipAttributes(statusInfo).join(' ')}>${escapeHtml(statusInfo.label || 'Status')}</span>`;
}

function renderProjectTree() {
  els.projectTree.innerHTML = '';
  renderCurrentContext();

  if (!isAuthenticated()) {
    els.projectTree.innerHTML = '<div class="tree-empty">Sign in with Autodesk to load ACC hubs and projects.</div>';
    return;
  }

  if (!state.hubs.length) {
    els.projectTree.innerHTML = '<div class="tree-empty">No ACC hubs were returned for this account.</div>';
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const hub of state.hubs) {
    const isCurrentHub = hub.id === state.currentHubId;
    const group = document.createElement('div');
    group.className = `tree-node${isCurrentHub ? ' is-expanded' : ''}`;

    const hubButton = document.createElement('button');
    hubButton.type = 'button';
    hubButton.className = `tree-row tree-row--hub${isCurrentHub ? ' is-current' : ''}`;
    hubButton.innerHTML = `
      <span class="tree-chevron" aria-hidden="true">${isCurrentHub ? treeIcons.chevronDown : treeIcons.chevronRight}</span>
      <span class="tree-node-icon tree-node-icon--hub" aria-hidden="true">${treeIcons.hub}</span>
      <span class="tree-copy tree-copy--single-line">
        <span class="tree-label">${escapeHtml(hub.name)}</span>
      </span>
      <span class="tree-region-tag">${escapeHtml(formatHubRegionLabel(hub.region))}</span>
    `;
    hubButton.addEventListener('click', () => selectHub(hub.id));
    group.appendChild(hubButton);

    if (isCurrentHub) {
      const children = document.createElement('div');
      children.className = 'tree-children';

      if (!state.projects.length) {
        const empty = document.createElement('div');
        empty.className = 'tree-empty tree-empty--nested';
        empty.textContent = 'No projects returned for this hub.';
        children.appendChild(empty);
      } else {
        for (const project of state.projects) {
          const projectButton = document.createElement('button');
          projectButton.type = 'button';
          projectButton.className = `tree-row tree-row--project${project.id === state.currentProject?.id ? ' is-active' : ''}`;
          projectButton.innerHTML = `
            <span class="tree-spacer" aria-hidden="true"></span>
            <span class="tree-node-icon tree-node-icon--project" aria-hidden="true">${treeIcons.project}</span>
            <span class="tree-copy tree-copy--single-line">
              <span class="tree-label">${escapeHtml(project.name)}</span>
            </span>
          `;
          projectButton.addEventListener('click', () => selectProject(project.id));
          children.appendChild(projectButton);
        }
      }

      group.appendChild(children);
    }

    fragment.appendChild(group);
  }

  els.projectTree.appendChild(fragment);
}

function renderTopFolders() {
  els.topFolderPills.innerHTML = '';
  const hasFolders = state.topFolders.length > 0;
  els.topFolderPills.classList.toggle('is-empty', !hasFolders);

  if (!hasFolders) {
    els.topFolderPills.innerHTML = '<span class="status-tag neutral">No top folders</span>';
    return;
  }

  for (const folder of state.topFolders) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `top-folder-pill${folder.id === currentFolder()?.id ? ' is-active' : ''}`;
    button.textContent = folder.name;
    button.setAttribute('data-tooltip', `Open the ${folder.name} top folder.`);
    button.addEventListener('click', () => openTopFolder(folder));
    els.topFolderPills.appendChild(button);
  }
}

function renderBreadcrumb() {
  els.breadcrumb.innerHTML = '';
  const hasBreadcrumb = state.currentFolderPath.length > 0;
  els.breadcrumb.classList.toggle('is-empty', !hasBreadcrumb);

  if (!hasBreadcrumb) {
    els.breadcrumb.innerHTML = '<span class="status-tag neutral">No folder selected</span>';
    return;
  }

  state.currentFolderPath.forEach((folder, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `breadcrumb-pill${index === state.currentFolderPath.length - 1 ? ' is-active' : ''}`;
    button.textContent = folder.name;
    button.setAttribute('data-tooltip', `Jump to ${folder.name}.`);
    button.addEventListener('click', () => goToBreadcrumb(index));
    els.breadcrumb.appendChild(button);

    if (index < state.currentFolderPath.length - 1) {
      const separator = document.createElement('span');
      separator.className = 'breadcrumb-separator';
      separator.textContent = '›';
      els.breadcrumb.appendChild(separator);
    }
  });
}

function updateSelectionUI() {
  const visibleRows = [...els.fileTableBody.querySelectorAll('tr[data-kind="file"]:not(.filtered-out)')];
  const selectedVisibleRows = visibleRows.filter((row) => row.querySelector('.row-check')?.checked);

  [...els.fileTableBody.querySelectorAll('tr[data-kind="file"]')].forEach((row) => {
    row.classList.toggle('is-selected', row.querySelector('.row-check')?.checked);
  });

  const fileCount = state.selectedItemIds.size;
  const referenceCount = getEffectiveSelectedReferenceItemIds().size;
  const summary = formatSelectionSummary(fileCount, referenceCount);
  if (els.selectedCount) {
    els.selectedCount.textContent = summary.longLabel;
  }
  if (els.selectedSummary) {
    els.selectedSummary.textContent = summary.longLabel === '0 items' ? '' : `${summary.longLabel} selected.`;
  }
  if (els.selectionPill) {
    els.selectionPill.textContent = summary.shortLabel;
  }

  const checkedVisible = selectedVisibleRows.length;
  const visibleCount = visibleRows.length;
  if (els.selectAll) {
    els.selectAll.checked = visibleCount > 0 && checkedVisible === visibleCount;
    els.selectAll.indeterminate = checkedVisible > 0 && checkedVisible < visibleCount;
  }

  toggleControls();
}

function applyEntryFilter() {
  [...els.fileTableBody.querySelectorAll('tr[data-kind]')].forEach((row) => {
    const matches = state.entryFilter === 'all' || row.dataset.kind === state.entryFilter;
    row.classList.toggle('filtered-out', !matches);
  });

  [...els.fileTableBody.querySelectorAll('tr.refs-detail-row, tr.ref-detail-row')].forEach((row) => {
    const parentKind = row.dataset.parentKind || 'file';
    const matches = state.entryFilter === 'all' || parentKind === state.entryFilter;
    row.classList.toggle('filtered-out', !matches);
  });

  updateSelectionUI();
}

function renderEntries() {
  if (!state.currentProject || !currentFolder()) {
    els.fileTableBody.innerHTML = '<tr><td colspan="7" class="table-empty-cell">Select a project and folder to browse DWG content.</td></tr>';
    els.browserState.textContent = 'No folder selected';
    updateSelectionUI();
    return;
  }

  els.browserState.textContent = `Viewing ${currentFolder().name}`;

  if (!state.currentEntries.length) {
    els.fileTableBody.innerHTML = '<tr><td colspan="7" class="table-empty-cell">No subfolders or DWG files were found in this ACC folder.</td></tr>';
    updateSelectionUI();
    return;
  }

  const rows = [];
  for (const entry of state.currentEntries) {
    const isFolder = entry.kind === 'folder';
    const checked = state.selectedItemIds.has(entry.id);
    const latestJob = getLatestJobForEntry(entry);
    const statusInfo = buildStatusInfo(entry, latestJob);
    const versionLabel = isFolder ? '-' : (entry.versionLabel || '—');
    const versionClass = isFolder || !entry.versionLabel ? 'version-pill neutral' : 'version-pill';
    const fileSizeLabel = isFolder ? '—' : formatFileSize(entry.size ?? entry.fileSize ?? entry.storageSize);
    const subtitle = isFolder
      ? `Folder - ${entry.objectCount ?? 'Unknown'} objects`
      : `DWG - ${latestJob ? `Latest workitem ${latestJob.workItemId || latestJob.id}` : 'No workitem submitted yet'}`;

    const referenceState = isFolder ? null : getReferenceState(entry.id);
    const refListState = isFolder ? null : getRefListState(entry.id);
    const refsExpanded = !isFolder && isReferenceExpanded(entry.id);
    const refListExpanded = !isFolder && isRefListExpanded(entry.id);
    const rowMenuOpen = !isFolder && state.openRowMenuItemId === entry.id;
    const refsButtonLabel = referenceState?.status === 'loading' ? 'Loading ref...' : refsExpanded ? 'Hide Ref' : 'View Ref';
    const refsButtonTitle = refsExpanded ? 'Hide Ref' : 'View Ref';
    const refListButtonLabel = refListState?.status === 'loading' ? 'Loading JSON...' : refListExpanded ? 'Hide JSON' : 'View JSON';
    const refListButtonTitle = refListExpanded ? 'Hide JSON' : 'View JSON';

    const actions = [];
    if (!isFolder) {
      const menuItems = [
        `<button type="button" class="row-menu-item" role="menuitem" data-action="toggle-ref-list" data-id="${escapeHtml(entry.id)}" aria-expanded="${refListExpanded ? 'true' : 'false'}" ${refListState?.status === 'loading' ? 'disabled' : ''}>${escapeHtml(refListButtonLabel)}</button>`,
        `<button type="button" class="row-menu-item" role="menuitem" data-action="export-ref-list" data-id="${escapeHtml(entry.id)}" data-name="${escapeHtml(entry.name)}">Export JSON</button>`,
      ];
      if (latestJob?.reportUrl) {
        menuItems.push(`<a class="row-menu-item row-menu-item--link" role="menuitem" href="${escapeHtml(latestJob.reportUrl)}" target="_blank" rel="noreferrer">Output log</a>`);
      }

      actions.push(`<button type="button" class="ghost-btn refs-toggle-btn${refsExpanded ? ' is-expanded' : ''}" data-action="toggle-refs" data-id="${escapeHtml(entry.id)}" aria-expanded="${refsExpanded ? 'true' : 'false'}" ${referenceState?.status === 'loading' ? 'disabled' : ''} data-tooltip-title="${escapeHtml(refsButtonTitle)}" data-tooltip="Expand ${escapeHtml(entry.name)} to keep the filtered References cascade view in place." data-tooltip-footer="Shows the referenced drawing name, version, date modified, file size, and nested type for from-direction references only." data-tooltip-icon="file">${escapeHtml(refsButtonLabel)}</button>`);
      actions.push(`
        <div class="row-menu${rowMenuOpen ? ' is-open' : ''}">
          <button
            type="button"
            class="row-menu-trigger"
            data-action="toggle-row-menu"
            data-id="${escapeHtml(entry.id)}"
            aria-haspopup="menu"
            aria-expanded="${rowMenuOpen ? 'true' : 'false'}"
            aria-label="More actions for ${escapeHtml(entry.name)}"
            data-tooltip-title="More actions"
            data-tooltip="Open additional actions for ${escapeHtml(entry.name)}."
            data-tooltip-icon="file"
          >
${renderEllipsisIcon()}
          </button>
          <div class="row-menu-popover" role="menu" aria-label="More actions for ${escapeHtml(entry.name)}">
            ${menuItems.join('')}
          </div>
        </div>
      `);
    }

    const nameMarkup = isFolder
      ? `<button type="button" class="row-title row-title-button" data-action="open" data-id="${escapeHtml(entry.id)}" data-tooltip-title="Open folder" data-tooltip="Open ${escapeHtml(entry.name)} and browse its contents." data-tooltip-icon="folder">${escapeHtml(entry.name)}</button>`
      : `<a class="row-title row-title-link" href="${escapeHtml(getAutoCadWebHref(entry))}" target="_blank" rel="noopener noreferrer" data-tooltip-title="Open drawing" data-tooltip="Open the specific ACC drawing directly in a new tab for ${escapeHtml(entry.name)}." data-tooltip-footer="Uses the latest Autodesk web drawing link available for this file." data-tooltip-icon="file">${escapeHtml(entry.name)}</a>`;

    rows.push(`
      <tr data-kind="${escapeHtml(entry.kind)}"${checked && !isFolder ? ' class="is-selected"' : ''}>
        <td>
          ${isFolder ? '<span class="status-helper">—</span>' : `
            <label class="check-wrap" aria-label="Select ${escapeHtml(entry.name)}">
              <input class="row-check" type="checkbox" data-select-item="${escapeHtml(entry.id)}" ${checked ? 'checked' : ''} />
              <span></span>
            </label>
          `}
        </td>
        <td>
          <div class="row-main">
${renderFileTypeIcon(isFolder ? 'folder' : 'file')}
            <div class="row-copy">
              ${nameMarkup}
              <div class="row-subtitle">${escapeHtml(subtitle)}</div>
            </div>
          </div>
        </td>
        <td><span class="${versionClass}">${escapeHtml(versionLabel)}</span></td>
        <td>${escapeHtml(formatDate(entry.lastModifiedTime))}</td>
        <td>${escapeHtml(fileSizeLabel)}</td>
        <td>
          <div class="status-stack">
            ${renderStatusControl(statusInfo)}
          </div>
        </td>
        <td>
          <div class="row-actions">${actions.join('')}</div>
        </td>
      </tr>
    `);

    if (!isFolder && (refsExpanded || refListExpanded)) {
      rows.push(`
        <tr class="refs-detail-row" data-parent-kind="${escapeHtml(entry.kind)}">
          <td colspan="7">
            <div class="detail-panel-stack">
              ${renderEntryDetailPanels(entry, referenceState, refListState)}
            </div>
          </td>
        </tr>
      `);
    }
  }

  els.fileTableBody.innerHTML = rows.join('');
  els.fileTableBody.querySelectorAll('[data-indeterminate="true"]').forEach((input) => {
    input.indeterminate = true;
  });
  applyEntryFilter();
}

async function handleFileTableClick(event) {
  const reportTrigger = event.target.closest('[data-report-url]');
  if (reportTrigger && els.fileTableBody.contains(reportTrigger)) {
    const reportUrl = String(reportTrigger.dataset.reportUrl || '').trim();
    if (reportUrl) {
      window.open(reportUrl, '_blank', 'noopener,noreferrer');
    }
    return;
  }

  const actionButton = event.target.closest('[data-action]');
  if (!actionButton || !els.fileTableBody.contains(actionButton)) {
    return;
  }

  const action = actionButton.dataset.action;
  const entryId = actionButton.dataset.id;
  const entry = getCurrentEntryById(entryId);

  try {
    if (action === 'toggle-row-menu') {
      state.openRowMenuItemId = state.openRowMenuItemId === entryId ? null : entryId;
      renderEntries();
      return;
    }

    closeRowMenu();

    if (action === 'export-ref-list') {
      renderEntries();
      exportRefListJson(entryId, actionButton.dataset.name || entry?.name || 'selected DWG');
      return;
    }
    if (!entry) {
      renderEntries();
      return;
    }
    if (action === 'open') {
      await openFolder(entry);
    } else if (action === 'toggle-refs') {
      await toggleReferences(entry);
    } else if (action === 'toggle-ref-list') {
      await toggleRefList(entry);
    } else if (action === 'retry-refs') {
      await loadReferences(entry, { force: true });
    }
  } catch (error) {
    console.error(error);
    showToast(error.message);
    setNotice('error', action === 'retry-refs' ? 'Could not load references.' : 'Action failed.', error.message);
  }
}

async function handleFileTableChange(event) {
  const target = event.target;
  if (!els.fileTableBody.contains(target)) {
    return;
  }

  if (target.matches('input[data-select-item]')) {
    const itemId = target.dataset.selectItem;
    if (target.checked) {
      state.selectedItemIds.add(itemId);
    } else {
      state.selectedItemIds.delete(itemId);
    }
    updateSelectionUI();
    if (state.refCanvas.open) {
      await syncRefCanvasSelectionFromCurrentItems({ focusItemId: itemId });
    }
    return;
  }

  if (target.matches('[data-select-ref-source]')) {
    toggleReferenceSourceSelection(target.dataset.selectRefSource, target.checked);
    return;
  }

  if (target.matches('[data-select-ref-item]')) {
    toggleReferenceItemSelection(target.dataset.selectRefItem, target.checked);
  }
}

function summarizeJobs() {
  const jobs = Array.from(state.jobs.values());
  const running = jobs.filter((job) => jobNeedsPolling(job)).length;
  const complete = jobs.filter((job) => !jobNeedsPolling(job)).length;
  const attention = jobs.filter((job) => ['failed', 'cancelled', 'timeout'].includes(String(job.status || '').toLowerCase()) || ['failed', 'pending-auth', 'skipped-locked', 'locked'].includes(String(job.accUpload?.status || '').toLowerCase())).length;
  if (!jobs.length) {
    return '0 jobs';
  }
  return `${running} running, ${complete} complete, ${attention} attention`;
}

function renderJobs() {
  const jobs = Array.from(state.jobs.values()).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  els.jobList.innerHTML = '';
  if (els.miniJobList) {
    els.miniJobList.innerHTML = '';
  }
  els.jobsEmpty.classList.toggle('hidden', jobs.length > 0);

  const summary = summarizeJobs();
  els.jobsSummary.textContent = summary;
  els.jobsSummaryDuplicate.textContent = summary;

  if (!jobs.length) {
    if (els.miniJobList) {
      els.miniJobList.innerHTML = '<div class="mini-job-empty">No jobs to summarize yet.</div>';
    }
    renderProgressCard();
    return;
  }

  for (const job of jobs) {
    const statusInfo = buildStatusInfo({ kind: 'file', id: job.sourceItemId }, job);
    const daBadge = getAutomationJobDaBadgeInfo(job);
    const accBadge = getAutomationJobAccBadgeInfo(job);
    const queueInfo = statusInfo.queueInfo || getPublishQueueInfo(job);
    const queueMeta = [
      queueInfo.orderLabel,
      queueInfo.waitLabel ? `Queue ${queueInfo.waitLabel}` : '',
      queueInfo.blockedBy ? `Waiting for ${queueInfo.blockedBy}` : '',
    ].filter(Boolean);
    const queueTag = queueInfo.label && queueInfo.state && queueInfo.state !== 'uploaded'
      ? `<span class="status-tag ${escapeHtml(queueInfo.tone || 'neutral')}" data-tooltip-title="${escapeHtml(queueInfo.label)}" data-tooltip="${escapeHtml([queueInfo.reason, queueInfo.orderLabel, queueInfo.waitLabel ? `Queue wait: ${queueInfo.waitLabel}` : '', queueInfo.blockedBy ? `Waiting for: ${queueInfo.blockedBy}` : ''].filter(Boolean).join('\n'))}" data-tooltip-icon="bundle">${escapeHtml(queueInfo.label)}</span>`
      : '';
    const item = document.createElement('article');
    item.className = 'job-item';
    item.innerHTML = `
      <div class="job-copy">
        <h3>${escapeHtml(job.sourcePath || job.inputFileName || job.id)}</h3>
        <p>${escapeHtml(job.accUpload?.message || 'Waiting for Design Automation to finish.')}</p>
        <div class="job-meta-line">
          <span><code>${escapeHtml(job.workItemId || job.id)}</code></span>
          <span>Created ${escapeHtml(formatDate(job.createdAt))}</span>
          <span>Updated ${escapeHtml(formatDate(job.updatedAt || job.createdAt))}</span>
        </div>
        ${queueMeta.length ? `<div class="job-meta-line">${queueMeta.map((part) => `<span>${escapeHtml(part)}</span>`).join('')}</div>` : ''}
        <div class="job-links"></div>
      </div>
      <div class="job-tags">
        <span class="status-tag ${escapeHtml(daBadge.tone)}" data-tooltip-title="${escapeHtml(daBadge.label)}" data-tooltip="${escapeHtml(daBadge.tooltip || '')}" data-tooltip-icon="status">${escapeHtml(daBadge.label)}</span>
        <span class="status-tag ${escapeHtml(accBadge.tone)}" data-tooltip-title="ACC state" data-tooltip="${escapeHtml(accBadge.tooltip || '')}" data-tooltip-icon="bundle">${escapeHtml(accBadge.label)}</span>
      </div>
    `;

    const links = item.querySelector('.job-links');
    if (job.reportUrl) {
      const report = document.createElement('a');
      report.className = 'ghost-btn row-link';
      report.href = job.reportUrl;
      report.target = '_blank';
      report.rel = 'noreferrer';
      report.textContent = 'Output log';
      report.dataset.tooltipTitle = 'Output log';
      report.dataset.tooltip = 'Open the Design Automation report and output log for this workitem.';
      report.dataset.tooltipFooter = 'Opens in a new tab.';
      report.dataset.tooltipIcon = 'log';
      report.dataset.tooltipMeta = 'LOG';
      links.appendChild(report);
    }
    if (job.downloadUrl) {
      const output = document.createElement('a');
      output.className = 'ghost-btn row-link';
      output.href = job.downloadUrl;
      output.textContent = 'Processed DWG';
      output.dataset.tooltipTitle = 'Processed output';
      output.dataset.tooltip = 'Download the latest processed DWG output.';
      output.dataset.tooltipIcon = 'file';
      output.dataset.tooltipMeta = 'DWG';
      links.appendChild(output);
    }
    if (!links.children.length) {
      links.innerHTML = '<span class="status-helper">Links will appear when logs or outputs are available.</span>';
    }
    els.jobList.appendChild(item);
  }

  if (els.miniJobList) {
    for (const job of jobs.slice(0, 4)) {
      const statusInfo = buildStatusInfo({ kind: 'file', id: job.sourceItemId }, job);
      const mini = document.createElement('div');
      mini.className = 'mini-job';
      mini.innerHTML = `
        <div>
          <strong>${escapeHtml(job.inputFileName || job.sourcePath || job.id)}</strong>
          <span>${escapeHtml(job.accUpload?.message || statusInfo.label)}</span>
        </div>
        <span class="status-tag ${escapeHtml(statusInfo.kind === 'success-pill' ? 'success' : statusInfo.kind === 'error-pill' ? 'error' : statusInfo.kind)}" data-tooltip-title="${escapeHtml(statusInfo.label)}" data-tooltip="${escapeHtml(statusInfo.tooltip || '')}" data-tooltip-icon="status">${escapeHtml(statusInfo.label)}</span>
      `;
      els.miniJobList.appendChild(mini);
    }
  }

  renderProgressCard();
}

function renderProgressCard() {
  if (!els.progressCard || !els.progressLabel) {
    return;
  }
  const phaseSummary = getProgressPhaseSummary();
  const label = state.activeSubmissionLabel || (phaseSummary.active ? `${phaseSummary.active} active workitem${phaseSummary.active === 1 ? '' : 's'}` : '');
  const visible = Boolean(label);
  els.progressCard.classList.toggle('hidden', !visible);
  if (!visible) {
    if (els.progressDetail) {
      els.progressDetail.textContent = 'Staging inputs and monitoring Design Automation phases.';
    }
    if (els.progressPhases) {
      els.progressPhases.innerHTML = '';
    }
    return;
  }

  els.progressLabel.textContent = label;
  if (els.progressDetail) {
    const detailParts = [];
    if (phaseSummary.staging) {
      detailParts.push(`${phaseSummary.staging} staging input${phaseSummary.staging === 1 ? '' : 's'}`);
    }
    if (phaseSummary.automation) {
      detailParts.push(`${phaseSummary.automation} in Design Automation`);
    }
    if (phaseSummary.publish) {
      detailParts.push(`${phaseSummary.publish} publishing back to ACC`);
    }
    if (phaseSummary.complete) {
      detailParts.push(`${phaseSummary.complete} complete in this session`);
    }
    els.progressDetail.textContent = detailParts.join(' • ') || 'Staging inputs and monitoring Design Automation phases.';
  }
  if (els.progressPhases) {
    els.progressPhases.innerHTML = [
      renderProgressPhaseChip('Staging', phaseSummary.staging, phaseSummary.staging > 0),
      renderProgressPhaseChip('Design Automation', phaseSummary.automation, phaseSummary.automation > 0),
      renderProgressPhaseChip('ACC Publish', phaseSummary.publish, phaseSummary.publish > 0),
      renderProgressPhaseChip('Complete', phaseSummary.complete, phaseSummary.complete > 0 && phaseSummary.active === 0),
    ].join('');
  }
}

function getJobPollInterval(job) {
  const status = String(job?.status || '').toLowerCase();
  if (['queued', 'staging-source', 'staging-refs', 'submitting'].includes(status)) {
    return 1800;
  }
  if (status === 'success') {
    const uploadStatus = String(job?.accUpload?.status || '').toLowerCase();
    if (['waiting-dependencies', 'publishing', 'pending', 'pending-auth'].includes(uploadStatus)) {
      return 5000;
    }
  }
  return 3000;
}

function stopPolling(id) {
  const entry = state.pollers.get(id);
  if (entry?.timer) {
    window.clearTimeout(entry.timer);
  }
  state.pollers.delete(id);
}

function ensurePolling(id) {
  if (state.pollers.has(id)) {
    return;
  }

  const entry = {
    timer: 0,
    inFlight: false,
  };

  const runPoll = async () => {
    const current = state.pollers.get(id);
    if (!current || current.inFlight) {
      return;
    }

    const existingJob = state.jobs.get(id);
    if (!jobNeedsPolling(existingJob)) {
      stopPolling(id);
      return;
    }

    current.inFlight = true;
    try {
      const job = await api(`/api/jobs/${encodeURIComponent(id)}`);
      upsertJob(job);
    } catch (error) {
      if (Number(error?.status) === 404) {
        stopPolling(id);
        const existing = state.jobs.get(id);
        if (existing) {
          state.jobs.set(id, {
            ...existing,
            pollError: {
              status: 404,
              message: error.message || 'The server could not find the local workitem record.',
              updatedAt: new Date().toISOString(),
            },
            updatedAt: new Date().toISOString(),
          });
          rebuildJobIndexes();
          renderEntries();
          renderJobs();
          renderProgressCard();
        }
        setNotice('error', 'Workitem tracking lost', 'The server could not find the local record for this workitem, so polling was stopped to avoid repeated 404 requests.');
        return;
      }
      console.error(error);
    } finally {
      const latestEntry = state.pollers.get(id);
      if (!latestEntry) {
        return;
      }
      latestEntry.inFlight = false;
      const latestJob = state.jobs.get(id);
      if (!jobNeedsPolling(latestJob)) {
        stopPolling(id);
        return;
      }
      latestEntry.timer = window.setTimeout(runPoll, getJobPollInterval(latestJob));
    }
  };

  state.pollers.set(id, entry);
  entry.timer = window.setTimeout(runPoll, 0);
}

function handleJobTransition(previous, nextJob) {
  if (!previous) {
    return;
  }
  const prevStatus = String(previous.status || '').toLowerCase();
  const nextStatus = String(nextJob.status || '').toLowerCase();
  const prevUpload = String(previous.accUpload?.status || '').toLowerCase();
  const nextUpload = String(nextJob.accUpload?.status || '').toLowerCase();

  if (prevStatus !== nextStatus && (isFailedAutomationStatus(nextStatus) || ['cancelled', 'timeout'].includes(nextStatus))) {
    setNotice('error', `${nextJob.inputFileName || 'Workitem'} returned an error.`, 'Hover the row status or use the output log action to inspect the Design Automation report.');
  }

  if (prevUpload !== nextUpload && nextUpload === 'uploaded') {
    showToast(`${nextJob.inputFileName} was uploaded back to ACC as a new version.`);
    setNotice('success', 'ACC version published.', `${nextJob.inputFileName} finished successfully and the processed DWG was uploaded back to ACC as a new version.`);
    if (state.currentProject?.id === nextJob.sourceProjectId && currentFolder()?.id === nextJob.sourceFolderId) {
      loadCurrentFolder().catch((error) => console.error(error));
    }
  }
}

function upsertJob(job) {
  const previous = state.jobs.get(job.id);
  state.jobs.set(job.id, job);
  if (jobNeedsPolling(job)) {
    ensurePolling(job.id);
  } else {
    stopPolling(job.id);
  }
  rebuildJobIndexes();
  renderEntries();
  renderJobs();
  handleJobTransition(previous, job);
}

function stopAllPolling() {
  for (const id of state.pollers.keys()) {
    stopPolling(id);
  }
}

function toggleControls() {
  const configured = Boolean(state.config?.credentials?.configured);
  const authenticated = isAuthenticated();
  const hasFolder = Boolean(currentFolder() && state.currentProject);
  const automationReady = isAutomationReady();
  const hasJobs = state.jobs.size > 0;
  const hasSelectedReferences = getEffectiveSelectedReferenceItemIds().size > 0;

  if (els.loginBtn) {
    els.loginBtn.classList.toggle('is-authenticated', authenticated);
    els.loginBtn.textContent = authenticated ? 'Sign out' : 'Sign in';
    els.loginBtn.disabled = !authenticated && !configured;
  }
  if (els.saveCredentialsBtn) {
    els.saveCredentialsBtn.classList.toggle('is-saved', configured);
    els.saveCredentialsBtn.title = configured
      ? 'APS credentials are configured for this session.'
      : 'Save APS Client ID and Client Secret into the current server session.';
  }
  if (els.refreshHubsBtn) {
    els.refreshHubsBtn.disabled = !authenticated;
  }
  if (els.engineSelect) {
    els.engineSelect.disabled = !configured;
  }
  if (els.uploadScriptBtn) {
    els.uploadScriptBtn.disabled = !configured;
  }
  if (els.clearScriptBtn) {
    els.clearScriptBtn.disabled = !state.config?.automation?.scriptOverride?.exists;
  }
  if (els.createBundleBtn) {
    els.createBundleBtn.disabled = !configured;
  }
  if (els.refreshFolderBtn) {
    els.refreshFolderBtn.disabled = !hasFolder || !authenticated;
  }
  if (els.refCanvasBtn) {
    els.refCanvasBtn.disabled = !hasFolder || !authenticated;
  }
  if (els.runSelectedBtn) {
    els.runSelectedBtn.disabled = !hasFolder || !authenticated || !automationReady;
  }
  if (els.runReferencesBtn) {
    els.runReferencesBtn.disabled = !hasFolder || !authenticated || !automationReady || !hasSelectedReferences;
  }
  if (els.runFolderBtn) {
    els.runFolderBtn.disabled = !hasFolder || !authenticated || !automationReady;
  }
  if (els.clearSelectionBtn) {
    els.clearSelectionBtn.disabled = !hasJobs;
  }

}

function renderConfig() {
  if (!state.config) {
    return;
  }

  const config = state.config;
  if (els.clientId) {
    els.clientId.value = config.credentials.clientId || '';
  }
  if (els.clientSecret) {
    els.clientSecret.placeholder = config.credentials.hasClientSecret ? 'Stored in server session or .env' : 'APS Client Secret';
    els.clientSecret.value = '';
  }
  if (els.nicknameInput) {
    els.nicknameInput.value = config.credentials.nickname || '';
  }

  const scriptOverride = config.automation.scriptOverride;
  if (els.scriptName) {
    els.scriptName.textContent = scriptOverride?.exists
      ? `${scriptOverride.originalName || scriptOverride.storedName} uploaded ${formatDate(scriptOverride.uploadedAt)}`
      : 'Using bundle default script';
  }

  const setupState = config.automation.setupState;
  let bundleState = 'Needs setup';
  let bundleTone = 'warning';
  if (!config.credentials.configured) {
    bundleState = 'No credentials';
    bundleTone = 'neutral';
  } else if (setupState?.activityQualifiedId) {
    bundleState = 'Ready';
    bundleTone = 'success';
  } else if (scriptOverride?.exists) {
    bundleState = 'Script staged';
    bundleTone = 'ready';
  }



  applyTooltipConfig(els.createBundleBtn, {
    title: 'Bundle status',
    body: [
      `Credentials: ${config.credentials.configured ? (config.credentials.source === 'session' ? 'Session' : 'Environment') : 'Not configured'}`,
      `Engine: ${setupState?.engine || config.automation.defaultEngine || 'Autodesk.AutoCAD+25_1'}`,
      `AppBundle: ${setupState?.appBundleQualifiedId || config.automation.appBundleId || 'Not created yet'}`,
      `Activity: ${setupState?.activityQualifiedId || config.automation.activityId || 'Not created yet'}`,
      scriptOverride?.exists ? `Override script: ${scriptOverride.originalName || scriptOverride.storedName}` : 'Override script: bundle default script',
      `Region: ${String(config.automation.ossRegion || config.automation.daRegion || 'US').toUpperCase()}`,
    ].join('\n'),
    footer: bundleState === 'Ready'
      ? 'Automation resources are ready.'
      : 'Create Bundle to stage or refresh the Automation resources.',
    icon: 'bundle',
    side: 'left',
    meta: [bundleState, String(config.automation.ossRegion || config.automation.daRegion || 'US').toUpperCase()],
  });

  toggleControls();
}

async function refreshConfig() {
  state.config = await api('/api/config');
  state.csrfToken = String(state.config?.security?.csrfToken || '');
  renderConfig();
}

async function loadEngines() {
  els.engineSelect.innerHTML = '';
  const preferredEngines = Array.isArray(state.engines) ? state.engines.filter(Boolean) : [];
  if (!state.config?.credentials?.configured) {
    const option = document.createElement('option');
    option.value = state.config?.automation?.defaultEngine || 'Autodesk.AutoCAD+25_1';
    option.textContent = option.value;
    els.engineSelect.appendChild(option);
    return;
  }

  if (preferredEngines.length) {
    for (const engine of preferredEngines) {
      const option = document.createElement('option');
      option.value = engine;
      option.textContent = engine;
      if (engine === state.config.automation.setupState?.engine || engine === state.config.automation.defaultEngine) {
        option.selected = true;
      }
      els.engineSelect.appendChild(option);
    }
    return;
  }

  try {
    const engines = await api('/api/automation/engines');
    const unique = Array.from(new Set(engines || []));
    unique.sort();
    state.engines = unique;
    for (const engine of unique) {
      const option = document.createElement('option');
      option.value = engine;
      option.textContent = engine;
      if (engine === state.config.automation.setupState?.engine || engine === state.config.automation.defaultEngine) {
        option.selected = true;
      }
      els.engineSelect.appendChild(option);
    }
  } catch (error) {
    console.error(error);
    const option = document.createElement('option');
    option.value = state.config.automation.defaultEngine;
    option.textContent = state.config.automation.defaultEngine;
    option.selected = true;
    els.engineSelect.appendChild(option);
  }
}

async function loadJobs() {
  const jobs = await api('/api/jobs');
  const activeIds = new Set(jobs.map((job) => job.id));
  for (const id of [...state.pollers.keys()]) {
    if (!activeIds.has(id)) {
      stopPolling(id);
    }
  }

  state.jobs.clear();
  for (const job of jobs) {
    state.jobs.set(job.id, job);
    if (jobNeedsPolling(job)) {
      ensurePolling(job.id);
    }
  }
  rebuildJobIndexes();
  renderJobs();
  renderEntries();
}

async function loadHubs({ preserveSelection = true, generation = null } = {}) {
  const activeGeneration = resolveBrowserGeneration(generation);
  const previousHubId = preserveSelection ? state.currentHubId : null;
  const previousProjectId = preserveSelection ? state.currentProject?.id || null : null;
  const previousFolderPathIds = preserveSelection
    ? state.currentFolderPath.map((folder) => folder?.id).filter(Boolean)
    : [];

  const payload = await api('/api/hubs');
  if (!isActiveBrowserGeneration(activeGeneration)) {
    return;
  }
  state.hubs = payload.data || [];
  renderProjectTree();

  if (!state.hubs.length) {
    resetBrowserState();
    renderTopFolders();
    renderBreadcrumb();
    renderEntries();
    setNotice('info', 'No ACC hubs returned.', 'This Autodesk account does not expose any ACC hubs for the configured credentials.');
    return;
  }

  const preferredHub = state.hubs.find((hub) => hub.id === previousHubId) || state.hubs[0];
  await selectHub(preferredHub.id, {
    preferredProjectId: previousProjectId,
    preferredFolderPathIds: previousFolderPathIds,
    generation: activeGeneration,
  });
}

async function selectHub(hubId, { preferredProjectId = null, preferredFolderPathIds = [], generation = null } = {}) {
  const activeGeneration = resolveBrowserGeneration(generation);
  state.currentHubId = hubId;
  state.currentProject = null;
  state.projects = [];
  state.topFolders = [];
  state.currentFolderPath = [];
  setCurrentEntries([]);
  state.selectedItemIds.clear();
  resetReferenceState();
  renderProjectTree();
  renderTopFolders();
  renderBreadcrumb();
  renderEntries();

  const payload = await api(`/api/hubs/${encodeURIComponent(hubId)}/projects`);
  if (!isActiveBrowserGeneration(activeGeneration)) {
    return;
  }
  state.projects = payload.data || [];
  renderProjectTree();

  if (!state.projects.length) {
    setNotice('info', 'No projects returned.', 'The selected hub loaded successfully but did not return any ACC projects.');
    return;
  }

  const preferredProject = state.projects.find((project) => project.id === preferredProjectId) || state.projects[0];
  await selectProject(preferredProject.id, { preferredFolderPathIds, generation: activeGeneration });
}

async function selectProject(projectId, { preferredFolderPathIds = [], generation = null } = {}) {
  const activeGeneration = resolveBrowserGeneration(generation);
  state.currentProject = state.projects.find((project) => project.id === projectId) || null;
  state.topFolders = [];
  state.currentFolderPath = [];
  setCurrentEntries([]);
  state.selectedItemIds.clear();
  resetReferenceState();
  renderProjectTree();
  renderTopFolders();
  renderBreadcrumb();
  renderEntries();

  if (!state.currentProject) {
    return;
  }

  const payload = await api(`/api/hubs/${encodeURIComponent(state.currentHubId)}/projects/${encodeURIComponent(projectId)}/top-folders`);
  if (!isActiveBrowserGeneration(activeGeneration)) {
    return;
  }
  state.topFolders = (payload.data || []).filter((folder) => folder?.id);
  renderTopFolders();

  const preferredTopFolderId = Array.isArray(preferredFolderPathIds) ? preferredFolderPathIds[0] : null;
  const preferredFolder = state.topFolders.find((folder) => folder.id === preferredTopFolderId)
    || state.topFolders.find((folder) => /project files/i.test(folder.name))
    || state.topFolders[0];
  if (preferredFolder) {
    await openTopFolder(preferredFolder, { suppressNotice: true, generation: activeGeneration });
    if (preferredTopFolderId && preferredFolder.id === preferredTopFolderId && isActiveBrowserGeneration(activeGeneration)) {
      await restoreFolderPathFromIdsWithOptions(preferredFolderPathIds, { generation: activeGeneration });
    }
    if (isActiveBrowserGeneration(activeGeneration) && !state.currentEntries.length && !currentFolder()) {
      renderEntries();
    }
  } else {
    setNotice('info', 'No top folders returned.', 'The selected project loaded, but ACC did not return any top folders.');
  }
}

async function openTopFolder(folder, options = {}) {
  const activeGeneration = resolveBrowserGeneration(options?.generation);
  if (!folder?.id) {
    setNotice('warning', 'Folder unavailable.', 'The selected top folder did not include a valid ACC folder id.');
    return;
  }
  state.currentFolderPath = [folder];
  setCurrentEntries([]);
  state.selectedItemIds.clear();
  resetReferenceState();
  renderTopFolders();
  renderBreadcrumb();
  renderEntries();
  await loadCurrentFolder({ ...options, generation: activeGeneration });
}

async function openFolder(folder, options = {}) {
  const activeGeneration = resolveBrowserGeneration(options?.generation);
  if (!folder?.id) {
    setNotice('warning', 'Folder unavailable.', 'The selected folder did not include a valid ACC folder id.');
    return;
  }
  state.currentFolderPath = [...state.currentFolderPath, folder];
  setCurrentEntries([]);
  state.selectedItemIds.clear();
  resetReferenceState();
  renderBreadcrumb();
  renderEntries();
  await loadCurrentFolder({ ...options, generation: activeGeneration });
}

async function goToBreadcrumb(index, options = {}) {
  const activeGeneration = resolveBrowserGeneration(options?.generation);
  state.currentFolderPath = state.currentFolderPath.slice(0, index + 1);
  setCurrentEntries([]);
  state.selectedItemIds.clear();
  resetReferenceState();
  renderBreadcrumb();
  renderEntries();
  await loadCurrentFolder({ ...options, generation: activeGeneration });
}

async function restoreFolderPathFromIds(folderPathIds) {
  return restoreFolderPathFromIdsWithOptions(folderPathIds);
}

async function restoreFolderPathFromIdsWithOptions(folderPathIds, { generation = null } = {}) {
  const activeGeneration = resolveBrowserGeneration(generation);
  const normalizedIds = Array.isArray(folderPathIds) ? folderPathIds.filter(Boolean) : [];
  if (!normalizedIds.length || !currentFolder()) {
    return;
  }

  for (const targetFolderId of normalizedIds.slice(1)) {
    if (!isActiveBrowserGeneration(activeGeneration)) {
      return;
    }
    const nextFolder = state.currentEntries.find((entry) => entry?.kind === 'folder' && entry.id === targetFolderId);
    if (!nextFolder) {
      break;
    }
    await openFolder(nextFolder, { suppressNotice: true, generation: activeGeneration });
  }

  if (isActiveBrowserGeneration(activeGeneration) && currentFolder()) {
    setNotice('info', 'Folder loaded.', `Showing ${state.currentEntries.length} visible entries in ${currentFolder().name}.`);
  }
}

async function loadCurrentFolder({ suppressNotice = false, generation = null } = {}) {
  const activeGeneration = resolveBrowserGeneration(generation);
  const folder = currentFolder();
  if (!folder || !folder.id || !state.currentProject) {
    renderEntries();
    return;
  }

  const projectId = state.currentProject.id;
  const folderId = folder.id;
  const payload = await api(`/api/projects/${encodeURIComponent(projectId)}/folders/${encodeURIComponent(folderId)}/contents`);
  if (!isActiveBrowserGeneration(activeGeneration)) {
    return;
  }
  if (!state.currentProject || state.currentProject.id !== projectId) {
    return;
  }
  if (!currentFolder() || currentFolder().id !== folderId) {
    return;
  }
  setCurrentEntries(payload.data || []);
  state.selectedItemIds.clear();
  resetReferenceState();
  resetRefCanvas({ keepPanel: false, preserveTreeCache: false });
  renderTopFolders();
  renderBreadcrumb();
  renderEntries();
  if (!suppressNotice) {
    setNotice('info', 'Folder loaded.', `Showing ${state.currentEntries.length} visible entries in ${folder.name}.`);
  }
}

function downloadFile(itemId) {
  if (!state.currentProject) {
    return;
  }
  download(`/api/projects/${encodeURIComponent(state.currentProject.id)}/items/${encodeURIComponent(itemId)}/download`);
}

function exportRefListJson(itemId, itemName = 'selected DWG') {
  if (!state.currentProject) {
    return;
  }
  showToast('Exporting Reference JSON...');
  setNotice('info', 'JSON export started.', `Generating an unfiltered ListRef JSON export for ${itemName} with all returned directions and reference types.`);
  download(`/api/projects/${encodeURIComponent(state.currentProject.id)}/items/${encodeURIComponent(itemId)}/ref-list.json`);
}

async function runSelected() {
  const folder = currentFolder();
  if (!state.currentProject || !folder) {
    return;
  }

  const selectedSourceIds = Array.from(state.selectedItemIds);
  const selectedReferenceIds = Array.from(getEffectiveSelectedReferenceItemIds());
  const itemIds = Array.from(new Set([...selectedSourceIds, ...selectedReferenceIds]));

  if (!itemIds.length) {
    await runFolder();
    return;
  }

  beginSubmissionProgress(`Submitting ${itemIds.length} selected DWG${itemIds.length === 1 ? '' : 's'}`, itemIds.length);

  try {
    const payload = await api('/api/automation/run-selected', {
      method: 'POST',
      body: {
        projectId: state.currentProject.id,
        itemIds,
      },
    });

    for (const job of payload.jobs || []) {
      upsertJob(job);
    }

    const count = payload.queued ?? payload.submitted ?? 0;
    const duplicatesRemoved = payload.duplicatesRemoved || 0;
    const skipped = payload.skipped || 0;
    const detailParts = [
      `${count} selected source or reference DWG${count === 1 ? '' : 's'} were queued for staging and Design Automation with reference graph inputs.`,
    ];
    if (selectedSourceIds.length > 0) {
      detailParts.push(`${selectedSourceIds.length} source ${selectedSourceIds.length === 1 ? 'file was' : 'files were'} included.`);
    }
    if (selectedReferenceIds.length > 0) {
      detailParts.push(`${selectedReferenceIds.length} reference ${selectedReferenceIds.length === 1 ? 'file was' : 'files were'} included.`);
    }
    if (duplicatesRemoved > 0) {
      detailParts.push(`${duplicatesRemoved} duplicate selection ${duplicatesRemoved === 1 ? 'was' : 'were'} removed before submission.`);
    }
    if (skipped > 0) {
      detailParts.push(`${skipped} selection ${skipped === 1 ? 'was' : 'were'} skipped because the ACC item could not be resolved.`);
    }

    showToast(`Queued ${count} workitem${count === 1 ? '' : 's'}.`);
    setNotice('info', 'Workitems queued.', detailParts.join(' '));
  } finally {
    clearSubmissionProgress();
  }
}

async function runReferences() {
  const folder = currentFolder();
  if (!state.currentProject || !folder) {
    return;
  }

  const selectedReferenceItemIds = Array.from(getEffectiveSelectedReferenceItemIds());
  if (!selectedReferenceItemIds.length) {
    showToast('Select one or more references first.');
    return;
  }

  beginSubmissionProgress(`Submitting ${selectedReferenceItemIds.length} unique reference DWG${selectedReferenceItemIds.length === 1 ? '' : 's'}`, selectedReferenceItemIds.length);

  try {
    const payload = await api('/api/automation/run-references', {
      method: 'POST',
      body: {
        projectId: state.currentProject.id,
        itemIds: selectedReferenceItemIds,
      },
    });

    for (const job of payload.jobs || []) {
      upsertJob(job);
    }

    const count = payload.queued ?? payload.submitted ?? 0;
    const skipped = payload.skipped || 0;
    const duplicatesRemoved = payload.duplicatesRemoved || 0;
    const detailParts = [
      `${count} reference DWG${count === 1 ? '' : 's'} were queued for staging and Design Automation with ListRefs-based reference inputs.`,
    ];
    if (duplicatesRemoved > 0) {
      detailParts.push(`${duplicatesRemoved} duplicate reference ${duplicatesRemoved === 1 ? 'entry was' : 'entries were'} removed before submission.`);
    }
    if (skipped > 0) {
      detailParts.push(`${skipped} reference ${skipped === 1 ? 'was' : 'were'} skipped because the ACC item could not be resolved.`);
    }

    showToast(`Queued ${count} reference workitem${count === 1 ? '' : 's'}.`);
    setNotice('info', 'Reference workitems queued.', detailParts.join(' '));
  } finally {
    clearSubmissionProgress();
  }
}

async function runFolder(folderId = currentFolder()?.id, folderName = currentFolder()?.name) {
  if (!state.currentProject || !folderId) {
    return;
  }

  beginSubmissionProgress(`Submitting ${folderName || 'selected'} folder tree`);
  const payload = await api('/api/automation/run-folder', {
    method: 'POST',
    body: {
      projectId: state.currentProject.id,
      folderId,
    },
  });

  clearSubmissionProgress();
  for (const job of payload.jobs || []) {
    upsertJob(job);
  }
  const count = payload.queued ?? payload.submitted ?? 0;
  showToast(`Queued ${count} workitem${count === 1 ? '' : 's'} from the folder tree.`);
  setNotice('info', 'Folder tree queued.', `${count} DWG workitem${count === 1 ? '' : 's'} were queued from ${folderName || 'the selected folder tree'} with ListRefs-based reference inputs.`);
}

function positionTooltip(target) {
  const tooltip = els.tooltip;
  if (!tooltip) {
    return;
  }

  const payload = getTooltipPayload(target);
  if (!payload) {
    return;
  }

  const badge = tooltip.querySelector('.coffee-tooltip__badge');
  const title = tooltip.querySelector('.coffee-tooltip__title');
  const body = tooltip.querySelector('.coffee-tooltip__body');
  const footer = tooltip.querySelector('.coffee-tooltip__footer');
  const meta = tooltip.querySelector('.coffee-tooltip__meta');
  const arrow = tooltip.querySelector('.coffee-tooltip__arrow');
  if (!badge || !title || !body || !footer || !meta || !arrow) {
    return;
  }

  badge.innerHTML = tooltipIcons[payload.icon] || tooltipIcons.info;
  title.textContent = payload.title;
  body.textContent = payload.body;
  footer.textContent = payload.footer;
  meta.innerHTML = payload.meta.map((item) => `<span>${escapeHtml(item)}</span>`).join('');

  tooltip.classList.remove('hidden');
  tooltip.setAttribute('aria-hidden', 'false');
  tooltip.style.left = '0px';
  tooltip.style.top = '0px';
  target.setAttribute('aria-describedby', 'global-tooltip');

  const rect = target.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const margin = 14;
  let side = target.getAttribute('data-tooltip-side') || 'top';

  if (side === 'top' && rect.top - tooltipRect.height - margin < 0) {
    side = 'bottom';
  }
  if (side === 'bottom' && rect.bottom + tooltipRect.height + margin > window.innerHeight) {
    side = 'top';
  }
  if (side === 'left' && rect.left - tooltipRect.width - margin < 0) {
    side = 'right';
  }
  if (side === 'right' && rect.right + tooltipRect.width + margin > window.innerWidth) {
    side = 'left';
  }

  let top = 0;
  let left = 0;
  if (side === 'left' || side === 'right') {
    top = rect.top + (rect.height / 2) - (tooltipRect.height / 2);
    top = Math.max(8, Math.min(top, window.innerHeight - tooltipRect.height - 8));
    left = side === 'left' ? rect.left - tooltipRect.width - margin : rect.right + margin;
    left = Math.max(8, Math.min(left, window.innerWidth - tooltipRect.width - 8));
    arrow.style.left = '';
    arrow.style.top = `${Math.max(70, Math.min(tooltipRect.height - 16, rect.top + (rect.height / 2) - top - 6))}px`;
  } else {
    left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
    left = Math.max(8, Math.min(left, window.innerWidth - tooltipRect.width - 8));
    top = side === 'top' ? rect.top - tooltipRect.height - margin : rect.bottom + margin;
    top = Math.max(8, Math.min(top, window.innerHeight - tooltipRect.height - 8));
    arrow.style.top = '';
    arrow.style.left = `${Math.max(12, Math.min(tooltipRect.width - 24, rect.left + (rect.width / 2) - left - 6))}px`;
  }

  tooltip.dataset.side = side;
  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
}

function hideTooltip() {
  const tooltip = els.tooltip;
  if (!tooltip) {
    return;
  }
  tooltip.classList.add('hidden');
  tooltip.setAttribute('aria-hidden', 'true');
  tooltip.style.left = '-9999px';
  tooltip.style.top = '-9999px';
  document.querySelectorAll('[aria-describedby="global-tooltip"]').forEach((node) => node.removeAttribute('aria-describedby'));
}

function handleTooltipOver(event) {
  const target = event.target.closest('[data-tooltip]');
  if (!target || target.closest('#global-tooltip')) {
    return;
  }
  positionTooltip(target);
}

function handleTooltipOut(event) {
  const from = event.target.closest('[data-tooltip]');
  const to = event.relatedTarget?.closest?.('[data-tooltip]');
  if (from && from !== to) {
    hideTooltip();
  }
}

function createRefCanvasState({ open = false, treeFilesByFolderId = new Map() } = {}) {
  return {
    open,
    loading: false,
    error: '',
    scopeKey: '',
    scopeLabel: '',
    mode: 'idle',
    activeNodeId: '',
    selectedNodeIds: new Set(),
    seedItemIds: [],
    expandedItemIds: new Set(),
    treeFilesByFolderId,
    graph: {
      nodes: new Map(),
      links: new Map(),
    },
    viewport: { x: 0, y: 0, k: 1 },
    simulation: {
      raf: 0,
      running: false,
      alpha: 0,
      lastTs: 0,
    },
    interaction: {
      mode: '',
      pointerId: null,
      startX: 0,
      startY: 0,
      originX: 0,
      originY: 0,
      nodeId: '',
      pointerDownNodeId: '',
      pointerOffsetX: 0,
      pointerOffsetY: 0,
      dragged: false,
      selectionModifier: false,
      skipClickSelection: false,
      handledSelectionOnPointerUp: false,
    },
    renderRefs: null,
    health: {
      byKey: new Map(),
      activeKey: '',
      pollTimer: 0,
      requestSerial: 0,
    },
  };
}

function createRefCanvasHealthKey(itemId, projectId = state.currentProject?.id) {
  return `${String(projectId || '').trim()}|${String(itemId || '').trim()}`;
}

function isRefCanvasHealthTerminalStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'completed'
    || normalized === 'success'
    || normalized === 'failed'
    || normalized.startsWith('failed')
    || normalized === 'timeout'
    || normalized === 'cancelled'
    || normalized === 'canceled';
}

function isRefCanvasHealthActiveStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'queued'
    || normalized === 'preparing'
    || normalized === 'submitting'
    || normalized === 'pending'
    || normalized === 'inprogress'
    || normalized === 'running';
}

function stopRefCanvasHealthPolling() {
  const health = state.refCanvas?.health;
  if (health?.pollTimer) {
    window.clearTimeout(health.pollTimer);
    health.pollTimer = 0;
  }
}

function resetRefCanvasHealthClientState({ clearNodeHealth = false } = {}) {
  stopRefCanvasHealthPolling();
  if (!state.refCanvas?.health) {
    return;
  }
  state.refCanvas.health.byKey = new Map();
  state.refCanvas.health.activeKey = '';
  state.refCanvas.health.requestSerial = 0;
  if (clearNodeHealth) {
    for (const node of getRefCanvasNodes()) {
      node.healthStatus = 'unknown';
      node.healthReport = '';
      node.healthCounts = null;
      node.healthHeader = null;
    }
  }
}

function applyRefCanvasHealthEntryToNode(entry) {
  const itemId = String(entry?.itemId || '').trim();
  if (!itemId) {
    return;
  }
  const node = state.refCanvas.graph.nodes.get(createRefCanvasNodeIdFromItemId(itemId));
  if (!node) {
    return;
  }
  node.healthStatus = String(entry?.normalizedHealth || 'unknown').trim().toLowerCase() || 'unknown';
  node.healthReport = String(entry?.healthReport || '').trim();
  node.healthCounts = entry?.counts && typeof entry.counts === 'object' ? entry.counts : null;
  node.healthHeader = entry?.header && typeof entry.header === 'object' ? entry.header : null;
}

function getRefCanvasHealthEntryForNode(node) {
  const itemId = String(node?.itemId || '').trim();
  if (!itemId) {
    return null;
  }
  return state.refCanvas.health.byKey.get(createRefCanvasHealthKey(itemId)) || null;
}

function getRefCanvasHealthBatchProgress(entry) {
  const batchId = String(entry?.batchId || '').trim();
  const batchSize = Number(entry?.batchSize || 0);
  if (!batchId || batchSize <= 1) {
    return null;
  }

  const progress = {
    total: batchSize,
    queued: 0,
    preparing: 0,
    submitted: 0,
    completed: 0,
    failed: 0,
  };

  for (const candidate of state.refCanvas.health.byKey.values()) {
    if (String(candidate?.batchId || '').trim() !== batchId) {
      continue;
    }
    const status = String(candidate?.status || '').trim().toLowerCase();
    if (status === 'queued') {
      progress.queued += 1;
      continue;
    }
    if (status === 'preparing' || status === 'submitting') {
      progress.preparing += 1;
      continue;
    }
    if (isRefCanvasHealthTerminalStatus(status)) {
      if (status === 'completed' || status === 'success') {
        progress.completed += 1;
      } else {
        progress.failed += 1;
      }
      progress.submitted += 1;
      continue;
    }
    progress.submitted += 1;
  }

  return progress;
}

function describeRefCanvasHealthProgress(entry) {
  const progress = getRefCanvasHealthBatchProgress(entry);
  if (!progress) {
    return 'Running drawing health automation, please wait for output report.';
  }

  const segments = [];
  if (progress.submitted > 0) {
    segments.push(`${progress.submitted}/${progress.total} submitted`);
  }
  if (progress.completed > 0) {
    segments.push(`${progress.completed}/${progress.total} completed`);
  }
  if (progress.failed > 0) {
    segments.push(`${progress.failed}/${progress.total} failed`);
  }
  if (!segments.length) {
    segments.push(`${progress.preparing + progress.queued}/${progress.total} preparing`);
  }

  return `Running drawing health automation, please wait for output report. Batch progress: ${segments.join(', ')}.`;
}

function getRefCanvasHealthTone(entry) {
  const normalizedHealth = String(entry?.normalizedHealth || '').trim().toLowerCase();
  if (normalizedHealth === 'healthy') {
    return 'healthy';
  }
  if (normalizedHealth === 'unhealthy') {
    return 'unhealthy';
  }
  if (entry?.error) {
    return 'error';
  }
  if (isRefCanvasHealthActiveStatus(entry?.status)) {
    return 'running';
  }
  return 'neutral';
}

function canDownloadRefCanvasHealthLog(entry) {
  const normalizedStatus = String(entry?.status || '').trim().toLowerCase();
  return Boolean((entry?.hasLog || entry?.reportUrl) && (entry?.error || isRefCanvasHealthTerminalStatus(normalizedStatus)));
}

function openRefCanvasHealthLog(entry) {
  const projectId = String(entry?.projectId || state.currentProject?.id || '').trim();
  const itemId = String(entry?.itemId || '').trim();
  if (!projectId || !itemId) {
    showToast('No automation output log is available for this bubble yet.');
    return;
  }
  const url = `/api/ref-canvas/health/log?projectId=${encodeURIComponent(projectId)}&itemId=${encodeURIComponent(itemId)}`;
  const popup = window.open(url, '_blank', 'noopener');
  if (!popup) {
    download(url);
  }
}

function handleRefCanvasHealthBadgeClick(event) {
  event?.preventDefault?.();
  const activeNode = getActiveRefCanvasNode();
  if (!activeNode?.itemId) {
    return;
  }
  const entry = state.refCanvas.health.byKey.get(createRefCanvasHealthKey(activeNode.itemId)) || null;
  if (!canDownloadRefCanvasHealthLog(entry)) {
    return;
  }
  openRefCanvasHealthLog(entry);
}

function renderRefCanvasHealthPanel() {
  const panel = els.refCanvasHealthPanel;
  const badge = els.refCanvasHealthBadge;
  const copy = els.refCanvasHealthCopy;
  const json = els.refCanvasHealthJson;
  if (!panel || !badge || !copy || !json) {
    return;
  }

  const activeNode = getActiveRefCanvasNode();
  const selectedNodeIds = getRefCanvasSelectedNodeIds();
  const shouldShow = Boolean(state.refCanvas.open && activeNode?.itemId && selectedNodeIds.has(activeNode.id));

  panel.classList.toggle('hidden', !shouldShow);
  panel.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');

  if (!shouldShow) {
    state.refCanvas.health.activeKey = '';
    stopRefCanvasHealthPolling();
    badge.className = 'ref-canvas-health-badge';
    badge.textContent = 'Idle';
    badge.disabled = true;
    badge.classList.remove('is-downloadable');
    badge.title = '';
    copy.textContent = 'Select a DWG bubble to run the drawing health automation.';
    json.textContent = '';
    json.classList.add('hidden');
    return;
  }

  const entryKey = createRefCanvasHealthKey(activeNode.itemId);
  const entry = state.refCanvas.health.byKey.get(entryKey) || null;
  state.refCanvas.health.activeKey = entryKey;

  const statusLabel = entry?.healthReport
    ? entry.healthReport
    : (entry?.status ? String(entry.status).replace(/(^.|[-_].)/g, (segment) => segment.replace(/[-_]/g, ' ').toUpperCase()) : 'Queued');
  const tone = getRefCanvasHealthTone(entry);

  const canDownloadLog = canDownloadRefCanvasHealthLog(entry);
  badge.className = `ref-canvas-health-badge is-${tone}`;
  badge.textContent = statusLabel || 'Queued';
  badge.disabled = !canDownloadLog;
  badge.classList.toggle('is-downloadable', canDownloadLog);
  badge.title = canDownloadLog ? 'Open the automation output log' : '';

  if (entry?.error) {
    copy.textContent = canDownloadLog
      ? `${entry.error} Click ${statusLabel || 'the status badge'} to open the automation output log.`
      : entry.error;
    json.textContent = '';
    json.classList.add('hidden');
    return;
  }

  if (isRefCanvasHealthActiveStatus(entry?.status)) {
    copy.textContent = 'Running drawing health automation, please wait for output report.';
    const progressCopy = describeRefCanvasHealthProgress(entry);
    if (progressCopy) {
      copy.textContent = progressCopy;
    }
    json.textContent = '';
    json.classList.add('hidden');
    return;
  }

  if (entry?.counts && Object.keys(entry.counts).length) {
    copy.textContent = 'Drawing primary ingredients';
    json.textContent = JSON.stringify(entry.counts, null, 2);
    json.classList.remove('hidden');
    return;
  }

  copy.textContent = 'No count section was returned in the drawing health JSON output.';
  json.textContent = '';
  json.classList.add('hidden');
}

async function pollRefCanvasHealthEntry(projectId, itemId, entryKey, requestSerial) {
  stopRefCanvasHealthPolling();

  async function pollOnce() {
    if (!state.refCanvas.open || requestSerial !== state.refCanvas.health.requestSerial || state.refCanvas.health.activeKey !== entryKey) {
      stopRefCanvasHealthPolling();
      return;
    }

    try {
      const payload = await api(`/api/ref-canvas/health?projectId=${encodeURIComponent(projectId)}&itemId=${encodeURIComponent(itemId)}`);
      const data = payload?.data || null;
      if (data) {
        state.refCanvas.health.byKey.set(entryKey, data);
        applyRefCanvasHealthEntryToNode(data);
        updateRefCanvasScenePositions();
        renderRefCanvas();
      }

      if (!data || isRefCanvasHealthTerminalStatus(data.status)) {
        stopRefCanvasHealthPolling();
        return;
      }
    } catch (error) {
      const existing = state.refCanvas.health.byKey.get(entryKey) || { projectId, itemId };
      state.refCanvas.health.byKey.set(entryKey, {
        ...existing,
        status: 'failed',
        error: error.message || 'Could not retrieve the drawing health status.',
      });
      updateRefCanvasScenePositions();
      renderRefCanvas();
      stopRefCanvasHealthPolling();
      return;
    }

    state.refCanvas.health.pollTimer = window.setTimeout(pollOnce, 1800);
  }

  state.refCanvas.health.pollTimer = window.setTimeout(pollOnce, 1100);
}


async function queueRefCanvasHealthForSelection(itemIds) {
  if (!state.refCanvas.open || !state.currentProject?.id) {
    return [];
  }

  const normalizedItemIds = Array.from(new Set((Array.isArray(itemIds) ? itemIds : [])
    .map((itemId) => String(itemId || '').trim())
    .filter(Boolean)));
  if (!normalizedItemIds.length) {
    return [];
  }

  const payload = await api('/api/ref-canvas/health/run', {
    method: 'POST',
    body: {
      projectId: state.currentProject.id,
      itemIds: normalizedItemIds,
    },
  });

  const entries = Array.isArray(payload?.data)
    ? payload.data
    : (payload?.data ? [payload.data] : []);
  for (const entry of entries) {
    if (!entry?.itemId) {
      continue;
    }
    const entryKey = createRefCanvasHealthKey(entry.itemId, entry.projectId || state.currentProject.id);
    state.refCanvas.health.byKey.set(entryKey, entry);
    applyRefCanvasHealthEntryToNode(entry);
  }
  updateRefCanvasScenePositions();
  renderRefCanvas();
  return entries;
}

async function triggerRefCanvasHealthForNode(node, { force = false } = {}) {
  if (!state.refCanvas.open || !state.currentProject?.id) {
    renderRefCanvasHealthPanel();
    return;
  }

  const itemId = String(node?.itemId || '').trim();
  if (!itemId) {
    renderRefCanvasHealthPanel();
    return;
  }

  const projectId = state.currentProject.id;
  const entryKey = createRefCanvasHealthKey(itemId, projectId);
  const existing = state.refCanvas.health.byKey.get(entryKey) || null;
  state.refCanvas.health.activeKey = entryKey;

  if (!force && existing) {
    applyRefCanvasHealthEntryToNode(existing);
    renderRefCanvas();
    if (!isRefCanvasHealthTerminalStatus(existing.status)) {
      const requestSerial = ++state.refCanvas.health.requestSerial;
      await pollRefCanvasHealthEntry(projectId, itemId, entryKey, requestSerial);
    }
    return;
  }

  const placeholder = {
    projectId,
    itemId,
    inputFileName: node.name || node.label || '',
    status: 'queued',
    normalizedHealth: 'unknown',
    counts: {},
    header: {},
    error: '',
  };
  state.refCanvas.health.byKey.set(entryKey, placeholder);
  renderRefCanvas();

  try {
    const payload = await api('/api/ref-canvas/health/run', {
      method: 'POST',
      body: {
        projectId,
        itemId,
      },
    });
    const entry = payload?.data ? { ...placeholder, ...payload.data } : placeholder;
    state.refCanvas.health.byKey.set(entryKey, entry);
    applyRefCanvasHealthEntryToNode(entry);
    updateRefCanvasScenePositions();
    renderRefCanvas();

    if (!isRefCanvasHealthTerminalStatus(entry.status)) {
      const requestSerial = ++state.refCanvas.health.requestSerial;
      await pollRefCanvasHealthEntry(projectId, itemId, entryKey, requestSerial);
    }
  } catch (error) {
    state.refCanvas.health.byKey.set(entryKey, {
      ...placeholder,
      status: 'failed',
      error: error.message || 'Could not run the drawing health automation.',
    });
    updateRefCanvasScenePositions();
    renderRefCanvas();
  }
}

function stopRefCanvasSimulation() {
  const simulation = state.refCanvas?.simulation;
  if (!simulation) {
    return;
  }
  if (simulation.raf) {
    window.cancelAnimationFrame(simulation.raf);
    simulation.raf = 0;
  }
  simulation.running = false;
  simulation.lastTs = 0;
  simulation.alpha = 0;
}

function resetRefCanvas({ keepPanel = false, preserveTreeCache = true } = {}) {
  stopRefCanvasSimulation();
  stopRefCanvasHealthPolling();
  const treeFilesByFolderId = preserveTreeCache ? state.refCanvas.treeFilesByFolderId : new Map();
  const next = createRefCanvasState({
    open: keepPanel && state.refCanvas.open,
    treeFilesByFolderId,
  });
  state.refCanvas = next;
  renderRefCanvas();
}

function getRefCanvasNodes() {
  return Array.from(state.refCanvas.graph.nodes.values());
}

function getRefCanvasLinks() {
  return Array.from(state.refCanvas.graph.links.values());
}

function getRefCanvasSelectedSeedIds() {
  return Array.from(state.selectedItemIds).filter(Boolean);
}

function getCachedTreeFileById(itemId) {
  const wanted = String(itemId || '').trim();
  if (!wanted) {
    return null;
  }

  for (const files of state.refCanvas.treeFilesByFolderId.values()) {
    const match = (Array.isArray(files) ? files : []).find((file) => String(file?.id || file?.itemId || '').trim() === wanted);
    if (match) {
      return match;
    }
  }

  return null;
}

function extractFileExtension(value, fallback = '') {
  const text = String(value || '').trim();
  const fallbackText = String(fallback || '').trim().toLowerCase();
  const match = text.match(/\.([^.\/\\]+)$/);
  if (match) {
    return match[1].toLowerCase();
  }
  if (fallbackText.includes('/')) {
    return fallbackText.split('/').pop().toLowerCase();
  }
  if (fallbackText.includes(':')) {
    return fallbackText.split(':').pop().toLowerCase();
  }
  return fallbackText;
}

function truncateBubbleLabel(value, maxLength = 32) {
  const text = String(value || '').trim();
  if (!text) {
    return 'Unnamed';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function wrapBubbleLabel(label) {
  const words = truncateBubbleLabel(label, 38).split(/\s+/).filter(Boolean);
  if (!words.length) {
    return ['Unnamed'];
  }

  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= 13 || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === 1) {
      continue;
    }
    break;
  }

  if (current && lines.length < 2) {
    lines.push(current);
  }

  return lines.slice(0, 2).map((line, index, arr) => {
    if (index === arr.length - 1 && words.join(' ').length > arr.join(' ').length) {
      return `${line.slice(0, 12)}…`;
    }
    return line;
  });
}

function hashString(value) {
  const text = String(value || '');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

async function mapWithConcurrencyClient(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  const size = Math.max(1, Number(limit) || 1);
  const results = new Array(list.length);
  let cursor = 0;

  async function pump() {
    while (cursor < list.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await worker(list[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(size, list.length || 1) }, () => pump());
  await Promise.all(workers);
  return results;
}

async function fetchRefListPayload(itemId, { force = false } = {}) {
  const normalizedItemId = String(itemId || '').trim();
  if (!normalizedItemId || !state.currentProject?.id) {
    throw new Error('Choose a project and DWG first.');
  }

  const existing = state.refListsByItemId.get(normalizedItemId);
  if (!force && existing?.status === 'loaded' && existing.payload) {
    return existing.payload;
  }
  if (!force && existing?.promise) {
    return existing.promise;
  }

  const request = api(`/api/projects/${encodeURIComponent(state.currentProject.id)}/items/${encodeURIComponent(normalizedItemId)}/ref-list`)
    .then((payload) => {
      state.refListsByItemId.set(normalizedItemId, {
        status: 'loaded',
        payload,
        error: '',
      });
      return payload;
    })
    .catch((error) => {
      state.refListsByItemId.set(normalizedItemId, {
        status: 'error',
        payload: null,
        error: error.message || 'Could not load the Reference JSON.',
      });
      throw error;
    });

  state.refListsByItemId.set(normalizedItemId, {
    status: 'loading',
    payload: existing?.payload || null,
    error: '',
    promise: request,
  });

  try {
    return await request;
  } finally {
    const next = state.refListsByItemId.get(normalizedItemId);
    if (next?.promise === request) {
      delete next.promise;
      state.refListsByItemId.set(normalizedItemId, next);
    }
  }
}

async function loadFolderTreeFiles(folderId, { force = false } = {}) {
  const normalizedFolderId = String(folderId || '').trim();
  if (!normalizedFolderId || !state.currentProject?.id) {
    throw new Error('Choose a folder first.');
  }

  if (!force && state.refCanvas.treeFilesByFolderId.has(normalizedFolderId)) {
    return state.refCanvas.treeFilesByFolderId.get(normalizedFolderId) || [];
  }

  const payload = await api(`/api/projects/${encodeURIComponent(state.currentProject.id)}/folders/${encodeURIComponent(normalizedFolderId)}/tree-files`);
  const files = Array.isArray(payload.data) ? payload.data : [];
  state.refCanvas.treeFilesByFolderId.set(normalizedFolderId, files);
  return files;
}

function createRefCanvasNodeIdFromItemId(itemId) {
  return `item:${String(itemId || '').trim()}`;
}

function createRefCanvasExternalNodeId(sourceItemId, row, index = 0) {
  return [
    'external',
    String(sourceItemId || '').trim() || 'unknown',
    String(row?.targetResourceType || '').trim() || 'resource',
    String(row?.targetResourceId || '').trim() || String(row?.targetPathInProject || '').trim() || `row-${index}`,
    String(row?.targetName || '').trim() || 'unnamed',
  ].join('|');
}

function initializeRefCanvasNodePosition(index, pinToCenter = false) {
  const angle = ((index * 137.508) % 360) * (Math.PI / 180);
  const radius = pinToCenter ? 24 + (index * 8) : 70 + (Math.sqrt(index + 1) * 58);
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

function upsertRefCanvasNode(data, { pinToCenter = false } = {}) {
  const nodes = state.refCanvas.graph.nodes;
  const nextId = String(data?.id || '').trim();
  if (!nextId) {
    return null;
  }

  const existing = nodes.get(nextId);
  const seedIndex = nodes.size;
  const initialPosition = existing || initializeRefCanvasNodePosition(seedIndex, pinToCenter);
  const next = {
    id: nextId,
    itemId: String(data?.itemId || existing?.itemId || '').trim(),
    label: truncateBubbleLabel(data?.label || data?.name || existing?.label || nextId),
    name: data?.name || existing?.name || data?.label || nextId,
    extension: String(data?.extension || existing?.extension || '').trim().toLowerCase(),
    sizeBytes: Math.max(0, Number(data?.sizeBytes ?? existing?.sizeBytes) || 0),
    versionLabel: data?.versionLabel || existing?.versionLabel || '',
    lastModifiedTime: data?.lastModifiedTime || existing?.lastModifiedTime || '',
    relativePath: data?.relativePath || existing?.relativePath || '',
    pathInProject: data?.pathInProject || existing?.pathInProject || '',
    webViewUrl: normalizeExternalHref(data?.webViewUrl || existing?.webViewUrl || ''),
    isSeed: Boolean(data?.isSeed || existing?.isSeed),
    isFolderTreeMember: Boolean(data?.isFolderTreeMember || existing?.isFolderTreeMember),
    hasRelationshipsLoaded: Boolean(data?.hasRelationshipsLoaded || existing?.hasRelationshipsLoaded),
    relationshipCount: Math.max(0, Number(data?.relationshipCount ?? existing?.relationshipCount) || 0),
    healthStatus: String(data?.healthStatus || existing?.healthStatus || 'unknown').trim().toLowerCase() || 'unknown',
    healthReport: String(data?.healthReport || existing?.healthReport || '').trim(),
    healthCounts: data?.healthCounts ?? existing?.healthCounts ?? null,
    healthHeader: data?.healthHeader ?? existing?.healthHeader ?? null,
    x: existing?.x ?? initialPosition.x,
    y: existing?.y ?? initialPosition.y,
    vx: existing?.vx || 0,
    vy: existing?.vy || 0,
    r: existing?.r || 24,
    fx: Number.isFinite(existing?.fx) ? existing.fx : (Number.isFinite(data?.fx) ? Number(data.fx) : null),
    fy: Number.isFinite(existing?.fy) ? existing.fy : (Number.isFinite(data?.fy) ? Number(data.fy) : null),
  };

  if (data?.sizeBytes && next.sizeBytes < Number(data.sizeBytes)) {
    next.sizeBytes = Number(data.sizeBytes) || next.sizeBytes;
  }
  if (pinToCenter && !existing) {
    next.x = initialPosition.x;
    next.y = initialPosition.y;
  }

  nodes.set(nextId, next);
  return next;
}

function resolveRefCanvasLinkDirection(row, sourceNodeId, targetNodeId, sourceMeta = {}) {
  const direction = String(row?.direction || '').trim().toLowerCase();
  if (direction === 'to') {
    return { from: sourceNodeId, to: targetNodeId, direction: 'to' };
  }
  if (direction === 'from') {
    return { from: targetNodeId, to: sourceNodeId, direction: 'from' };
  }

  const sourceIds = new Set([sourceMeta.sourceVersionId, sourceMeta.sourceItemId].filter(Boolean).map((value) => String(value).trim()));
  if (row?.toId && sourceIds.has(String(row.toId).trim())) {
    return { from: sourceNodeId, to: targetNodeId, direction: 'to' };
  }

  return { from: targetNodeId, to: sourceNodeId, direction: 'from' };
}

function buildRefCanvasLinkDedupKey({ sourceId, targetId, isOverlay = false, isNonDwg = false, targetExtension = '', refType = '' }) {
  return [
    String(sourceId || '').trim(),
    String(targetId || '').trim(),
    isOverlay ? 'overlay' : 'attachment',
    isNonDwg ? `ext:${String(targetExtension || '').trim().toLowerCase() || 'other'}` : 'ext:dwg',
    String(refType || '').trim().toLowerCase() || 'xref',
  ].join('|');
}

function findExistingRefCanvasLinkByDedupKey(dedupKey) {
  return getRefCanvasLinks().find((link) => link?.dedupeKey === dedupKey) || null;
}

function recalculateRefCanvasNodeRadii() {
  const nodes = getRefCanvasNodes();
  const values = nodes.map((node) => Math.max(0, Number(node.sizeBytes) || 0)).filter((value) => value > 0);
  const sqrtMin = values.length ? Math.sqrt(Math.min(...values)) : 0;
  const sqrtMax = values.length ? Math.sqrt(Math.max(...values)) : 0;
  const range = Math.max(1, sqrtMax - sqrtMin);

  for (const node of nodes) {
    const sizeValue = Math.max(0, Number(node.sizeBytes) || 0);
    if (!sizeValue) {
      node.r = node.isSeed ? 30 : 22;
      continue;
    }
    const scaled = (Math.sqrt(sizeValue) - sqrtMin) / range;
    node.r = Math.round(20 + (scaled * 24) + (node.isSeed ? 4 : 0));
  }
}

function mergeRefCanvasPayload(payload, { sourceEntry = null, markSeed = false } = {}) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const meta = payload?.meta || {};
  const sourceItemId = String(meta.sourceItemId || sourceEntry?.id || sourceEntry?.itemId || '').trim();
  if (!sourceItemId) {
    return null;
  }

  const sourceNodeId = createRefCanvasNodeIdFromItemId(sourceItemId);
  const sourceNode = upsertRefCanvasNode({
    id: sourceNodeId,
    itemId: sourceItemId,
    label: meta.sourceName || sourceEntry?.name || sourceEntry?.displayName || sourceItemId,
    name: meta.sourceName || sourceEntry?.name || sourceEntry?.displayName || sourceItemId,
    extension: meta.sourceExtension || sourceEntry?.extension || extractFileExtension(meta.sourceName || sourceEntry?.name, 'dwg'),
    sizeBytes: meta.sourceFileSize ?? sourceEntry?.size ?? 0,
    versionLabel: meta.sourceVersionLabel || sourceEntry?.versionLabel || sourceEntry?.sourceVersionLabel || '',
    lastModifiedTime: meta.sourceLastModifiedTime || sourceEntry?.lastModifiedTime || '',
    relativePath: sourceEntry?.relativePath || '',
    pathInProject: meta.sourcePathInProject || sourceEntry?.pathInProject || '',
    webViewUrl: meta.sourceWebViewUrl || sourceEntry?.webViewUrl || '',
    isSeed: markSeed,
    isFolderTreeMember: Boolean(sourceEntry?.relativePath || sourceEntry?.isFolderTreeMember),
    hasRelationshipsLoaded: true,
    relationshipCount: rows.length,
  }, { pinToCenter: markSeed });

  for (const [index, row] of rows.entries()) {
    const targetItemId = String(row?.targetItemId || (String(row?.targetResourceType || '').trim().toLowerCase() === 'items' ? row?.targetResourceId : '') || '').trim();
    const targetNodeId = targetItemId
      ? createRefCanvasNodeIdFromItemId(targetItemId)
      : createRefCanvasExternalNodeId(sourceItemId, row, index + 1);
    const targetExtension = extractFileExtension(row?.targetName, row?.targetExtensionType);
    const targetNode = upsertRefCanvasNode({
      id: targetNodeId,
      itemId: targetItemId,
      label: row?.targetName || row?.targetPathInProject || row?.targetResourceId || `Reference ${index + 1}`,
      name: row?.targetName || row?.targetPathInProject || row?.targetResourceId || `Reference ${index + 1}`,
      extension: targetExtension,
      sizeBytes: row?.targetStorageSize ?? 0,
      versionLabel: row?.targetVersionLabel || '',
      lastModifiedTime: row?.targetLastModifiedTime || '',
      relativePath: row?.targetPathInProject || '',
      pathInProject: row?.targetPathInProject || '',
      webViewUrl: row?.targetWebViewUrl || '',
      isFolderTreeMember: Boolean(getCurrentEntryById(targetItemId)?.id || getCachedTreeFileById(targetItemId)?.id),
    });

    const endpoints = resolveRefCanvasLinkDirection(row, sourceNodeId, targetNodeId, {
      sourceVersionId: meta.sourceVersionId,
      sourceItemId,
    });
    const nestedType = String(row?.nestedType || '').trim().toLowerCase();
    const isOverlay = nestedType === 'overlay';
    const isNonDwg = targetExtension && targetExtension !== 'dwg';

    const refType = String(row?.refType || '').trim() || 'xref';
    const dedupeKey = buildRefCanvasLinkDedupKey({
      sourceId: endpoints.from,
      targetId: endpoints.to,
      isOverlay,
      isNonDwg,
      targetExtension,
      refType,
    });
    const duplicateLink = findExistingRefCanvasLinkByDedupKey(dedupeKey);

    if (duplicateLink) {
      duplicateLink.rawDirection = duplicateLink.rawDirection || endpoints.direction;
      duplicateLink.relationshipIndex = Math.min(Number(duplicateLink.relationshipIndex) || index + 1, row?.relationshipIndex || index + 1);
      duplicateLink.targetName = duplicateLink.targetName || row?.targetName || '';
      duplicateLink.originItemId = duplicateLink.originItemId || sourceItemId;
      duplicateLink.mergedCount = Math.max(2, Number(duplicateLink.mergedCount || 1) + 1);
    } else {
      const linkId = [
        sourceItemId,
        endpoints.from,
        endpoints.to,
        endpoints.direction,
        refType,
        String(row?.refExtensionType || '').trim(),
        nestedType,
        String(row?.targetResourceId || row?.targetItemId || row?.targetPathInProject || row?.targetName || index + 1).trim(),
      ].join('|');

      state.refCanvas.graph.links.set(linkId, {
        id: linkId,
        dedupeKey,
        sourceId: endpoints.from,
        targetId: endpoints.to,
        originItemId: sourceItemId,
        rawDirection: endpoints.direction,
        nestedType,
        refType,
        refExtensionType: String(row?.refExtensionType || '').trim(),
        targetExtension,
        isOverlay,
        isNonDwg,
        strokeColor: isOverlay ? '#2e8b57' : '#171717',
        markerId: isOverlay ? 'ref-canvas-arrow-green' : 'ref-canvas-arrow-black',
        activeMarkerId: isOverlay ? 'ref-canvas-arrow-green-active' : 'ref-canvas-arrow-black-active',
        targetName: row?.targetName || '',
        relationshipIndex: row?.relationshipIndex || index + 1,
        mergedCount: 1,
      });
    }

    if (targetNode) {
      targetNode.relationshipCount = Math.max(0, Number(targetNode.relationshipCount) || 0);
    }
  }

  state.refCanvas.expandedItemIds.add(sourceItemId);
  if (markSeed) {
    sourceNode.isSeed = true;
  }
  if (!state.refCanvas.activeNodeId) {
    state.refCanvas.activeNodeId = sourceNode.id;
  }
  recalculateRefCanvasNodeRadii();
  return sourceNode;
}

function getActiveRefCanvasNode() {
  return state.refCanvas.graph.nodes.get(state.refCanvas.activeNodeId) || null;
}

function getRefCanvasSelectedNodeIds() {
  return state.refCanvas.selectedNodeIds instanceof Set ? state.refCanvas.selectedNodeIds : new Set();
}

function getRefCanvasSelectedNodes() {
  return Array.from(getRefCanvasSelectedNodeIds())
    .map((nodeId) => state.refCanvas.graph.nodes.get(nodeId))
    .filter(Boolean);
}

function getRefCanvasSelectedItemIds(nodeIds = getRefCanvasSelectedNodeIds()) {
  const normalizedNodeIds = Array.isArray(nodeIds) ? nodeIds : Array.from(nodeIds || []);
  return Array.from(new Set(normalizedNodeIds
    .map((nodeId) => state.refCanvas.graph.nodes.get(String(nodeId || '').trim())?.itemId)
    .map((itemId) => String(itemId || '').trim())
    .filter(Boolean)));
}

function syncFileTableSelectionInputsFromState() {
  if (!els.fileTableBody) {
    return;
  }

  els.fileTableBody.querySelectorAll('input[data-select-item]').forEach((input) => {
    const itemId = String(input.dataset.selectItem || '').trim();
    input.checked = Boolean(itemId && state.selectedItemIds.has(itemId));
  });

  updateSelectionUI();
}

function syncSelectionStateFromRefCanvas(nodeIds) {
  const nextItemIds = getRefCanvasSelectedItemIds(nodeIds);
  state.selectedItemIds = new Set(nextItemIds);
  syncFileTableSelectionInputsFromState();
}

function setRefCanvasSelectedNodes(nodeIds, { activeNodeId = '', center = false, zoom = null } = {}) {
  const validIds = Array.from(new Set((Array.isArray(nodeIds) ? nodeIds : [nodeIds])
    .map((value) => String(value || '').trim())
    .filter((value) => value && state.refCanvas.graph.nodes.has(value))));

  state.refCanvas.selectedNodeIds = new Set(validIds);

  if (validIds.length) {
    const requestedActiveId = String(activeNodeId || '').trim();
    state.refCanvas.activeNodeId = validIds.includes(requestedActiveId) ? requestedActiveId : validIds[validIds.length - 1];
  } else if (activeNodeId && state.refCanvas.graph.nodes.has(String(activeNodeId || '').trim())) {
    state.refCanvas.activeNodeId = String(activeNodeId || '').trim();
  }

  updateRefCanvasScenePositions();
  renderRefCanvas();

  if (center && state.refCanvas.activeNodeId) {
    centerRefCanvasOnNode(state.refCanvas.activeNodeId, {
      zoom: zoom !== null ? zoom : Math.max(state.refCanvas.viewport.k || 0.96, 1.04),
    });
  }

  const activeGroup = state.refCanvas.renderRefs?.nodeEls.get(state.refCanvas.activeNodeId)?.group;
  if (activeGroup?.focus) {
    window.requestAnimationFrame(() => {
      activeGroup.focus({ preventScroll: true });
    });
  }
}

async function syncRefCanvasSelectionFromCurrentItems({ focusItemId = '', center = true } = {}) {
  if (!state.refCanvas.open || !state.currentProject) {
    return;
  }

  const selectedItemIds = getRefCanvasSelectedSeedIds();
  if (!selectedItemIds.length) {
    state.refCanvas.selectedNodeIds = new Set();
    state.refCanvas.activeNodeId = '';
    updateRefCanvasScenePositions();
    renderRefCanvas();
    return;
  }

  const missingItemIds = selectedItemIds.filter((itemId) => !state.refCanvas.graph.nodes.has(createRefCanvasNodeIdFromItemId(itemId)));
  if (missingItemIds.length) {
    const previousLoading = state.refCanvas.loading;
    state.refCanvas.loading = true;
    renderRefCanvas();
    try {
      await mapWithConcurrencyClient(missingItemIds, Math.min(3, missingItemIds.length), async (itemId) => {
        const sourceMeta = getCurrentEntryById(itemId) || getCachedTreeFileById(itemId) || null;
        await ensureRefCanvasExpandedForItem(itemId, {
          seed: false,
          sourceMeta,
          quiet: true,
        });
      });
    } finally {
      state.refCanvas.loading = previousLoading;
      renderRefCanvas();
    }
  }

  const selectedNodeIds = selectedItemIds
    .map((itemId) => createRefCanvasNodeIdFromItemId(itemId))
    .filter((nodeId) => state.refCanvas.graph.nodes.has(nodeId));

  if (!selectedNodeIds.length) {
    return;
  }

  const preferredActiveNodeId = focusItemId && state.refCanvas.graph.nodes.has(createRefCanvasNodeIdFromItemId(focusItemId))
    ? createRefCanvasNodeIdFromItemId(focusItemId)
    : selectedNodeIds[selectedNodeIds.length - 1];

  setRefCanvasSelectedNodes(selectedNodeIds, {
    activeNodeId: preferredActiveNodeId,
    center,
    zoom: Math.max(state.refCanvas.viewport.k || 0.96, 1.06),
  });

  const activeNode = getActiveRefCanvasNode();
  if (activeNode?.itemId) {
    await triggerRefCanvasHealthForNode(activeNode);
  } else {
    renderRefCanvasHealthPanel();
  }
}

function updateRefCanvasStatusSurface(message = '', tone = 'neutral') {
  if (!els.refCanvasStatus) {
    return;
  }
  const text = String(message || '').trim();
  els.refCanvasStatus.textContent = text;
  els.refCanvasStatus.className = `ref-canvas-status${text ? '' : ' hidden'} ref-canvas-status--${tone}`;
}

function renderRefCanvasSelectionCopy() {}

function updateRefCanvasActionButtons() {}

function renderRefCanvas() {
  const panel = els.refCanvasShell;
  if (!panel) {
    return;
  }

  const isOpen = Boolean(state.refCanvas.open);
  const nodeCount = state.refCanvas.graph.nodes.size;
  panel.classList.toggle('is-open', isOpen);
  panel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');

  if (els.refCanvasBtn) {
    els.refCanvasBtn.classList.toggle('is-active', isOpen);
  }
  if (els.refCanvasFitBtn) {
    els.refCanvasFitBtn.disabled = !isOpen || state.refCanvas.loading || nodeCount < 1;
  }
  if (els.refCanvasResetBtn) {
    els.refCanvasResetBtn.disabled = !isOpen || state.refCanvas.loading || nodeCount < 1;
  }
  if (els.refCanvasCloseBtn) {
    els.refCanvasCloseBtn.disabled = !isOpen;
  }
  if (els.refCanvasSubtitle) {
    els.refCanvasSubtitle.textContent = state.refCanvas.loading
      ? (state.refCanvas.error ? state.refCanvas.error : 'Loading unfiltered relationship graphs and sizing bubbles from file metadata.')
      : 'Pan, zoom, drag bubbles into place, Ctrl/Cmd-select multiple files, and select a bubble to focus it and expand first-level relationships for the selected DWG or current folder tree.';
  }

  updateRefCanvasStatusSurface(state.refCanvas.error || (state.refCanvas.loading ? 'Loading relationship graph…' : ''), state.refCanvas.error ? 'error' : 'neutral');
  renderRefCanvasSelectionCopy();
  updateRefCanvasActionButtons();
  renderRefCanvasHealthPanel();

  if (els.refCanvasEmpty) {
    els.refCanvasEmpty.classList.toggle('hidden', !isOpen || state.refCanvas.loading || nodeCount > 0 || Boolean(state.refCanvas.error));
    if (!nodeCount && !state.refCanvas.loading) {
      els.refCanvasEmpty.textContent = 'No DWG relationships are available for the current selection.';
    }
  }

  if (!isOpen) {
    return;
  }

  renderRefCanvasGraph();
}

function ensureRefCanvasSvgBindings() {
  if (!els.refCanvasSvg || els.refCanvasSvg.dataset.bound === 'true') {
    return;
  }
  els.refCanvasSvg.dataset.bound = 'true';
  els.refCanvasSvg.addEventListener('wheel', handleRefCanvasWheel, { passive: false });
  els.refCanvasSvg.addEventListener('pointerdown', handleRefCanvasPointerDown);
  els.refCanvasSvg.addEventListener('pointermove', handleRefCanvasPointerMove);
  els.refCanvasSvg.addEventListener('pointerup', handleRefCanvasPointerUp);
  els.refCanvasSvg.addEventListener('pointercancel', handleRefCanvasPointerUp);
  els.refCanvasSvg.addEventListener('click', handleRefCanvasClick);
  els.refCanvasSvg.addEventListener('keydown', handleRefCanvasKeydown);
}

function renderRefCanvasGraph() {
  const svg = els.refCanvasSvg;
  if (!svg) {
    return;
  }

  ensureRefCanvasSvgBindings();

  const nodes = getRefCanvasNodes();
  const links = getRefCanvasLinks();
  if (!nodes.length) {
    svg.innerHTML = '';
    state.refCanvas.renderRefs = null;
    return;
  }

  svg.innerHTML = `
    <defs>
      <marker id="ref-canvas-arrow-black" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="userSpaceOnUse">
        <path d="M0,0 L10,5 L0,10 z" fill="#171717"></path>
      </marker>
      <marker id="ref-canvas-arrow-black-active" markerWidth="12" markerHeight="12" refX="10.5" refY="6" orient="auto" markerUnits="userSpaceOnUse">
        <path d="M0,0 L12,6 L0,12 z" fill="#111827"></path>
      </marker>
      <marker id="ref-canvas-arrow-green" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="userSpaceOnUse">
        <path d="M0,0 L10,5 L0,10 z" fill="#2e8b57"></path>
      </marker>
      <marker id="ref-canvas-arrow-green-active" markerWidth="12" markerHeight="12" refX="10.5" refY="6" orient="auto" markerUnits="userSpaceOnUse">
        <path d="M0,0 L12,6 L0,12 z" fill="#2e8b57"></path>
      </marker>
    </defs>
    <rect class="ref-canvas-hitbox" x="0" y="0" width="1200" height="720"></rect>
    <g class="ref-canvas-viewport-group">
      <g class="ref-canvas-links-layer"></g>
      <g class="ref-canvas-nodes-layer"></g>
    </g>
  `;

  const viewportGroup = svg.querySelector('.ref-canvas-viewport-group');
  const linksLayer = svg.querySelector('.ref-canvas-links-layer');
  const nodesLayer = svg.querySelector('.ref-canvas-nodes-layer');

  const linkEls = new Map();
  const nodeEls = new Map();

  for (const link of links) {
    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('class', `ref-canvas-link${link.isNonDwg ? ' is-dashed' : ''}${link.isOverlay ? ' is-overlay' : ''}`);
    pathEl.setAttribute('fill', 'none');
    pathEl.setAttribute('stroke', link.strokeColor);
    pathEl.setAttribute('stroke-width', link.isOverlay ? '2.6' : '2.1');
    if (link.isNonDwg) {
      pathEl.setAttribute('stroke-dasharray', '7 6');
    }
    pathEl.setAttribute('marker-end', `url(#${link.markerId})`);
    pathEl.dataset.linkId = link.id;
    pathEl.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'title')).textContent = [
      `${link.targetName || 'Reference'}`,
      link.rawDirection ? `Direction: ${link.rawDirection}` : '',
      link.nestedType ? `nestedType: ${link.nestedType}` : '',
      link.targetExtension ? `Extension: ${link.targetExtension}` : '',
    ].filter(Boolean).join(' • ');
    linksLayer.appendChild(pathEl);
    linkEls.set(link.id, pathEl);
  }

  for (const node of nodes) {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('class', 'ref-canvas-node');
    group.dataset.nodeId = node.id;
    group.setAttribute('tabindex', '0');
    group.setAttribute('role', 'button');
    group.setAttribute('aria-label', node.name || node.label);

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('class', 'ref-canvas-bubble');
    circle.setAttribute('r', String(node.r));
    group.appendChild(circle);

    const labelLines = wrapBubbleLabel(node.label);
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('class', 'ref-canvas-label');
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'middle');
    const baseY = labelLines.length > 1 ? -6 : -2;
    labelLines.forEach((line, index) => {
      const tsp = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      tsp.setAttribute('x', '0');
      tsp.setAttribute('y', String(baseY + (index * 12)));
      tsp.textContent = line;
      label.appendChild(tsp);
    });
    group.appendChild(label);

    const meta = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    meta.setAttribute('class', 'ref-canvas-label ref-canvas-label--meta');
    meta.setAttribute('text-anchor', 'middle');
    meta.setAttribute('dominant-baseline', 'middle');
    meta.setAttribute('y', '13');
    meta.textContent = node.extension ? node.extension.toUpperCase() : (node.sizeBytes ? formatFileSize(node.sizeBytes) : 'FILE');
    group.appendChild(meta);

    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = [
      node.name || node.label,
      node.extension ? `Extension: ${node.extension.toUpperCase()}` : '',
      node.sizeBytes ? `Size: ${formatFileSize(node.sizeBytes)}` : '',
      node.versionLabel ? `Version: ${node.versionLabel}` : '',
      node.relativePath ? `Path: ${node.relativePath}` : (node.pathInProject ? `Path: ${node.pathInProject}` : ''),
    ].filter(Boolean).join(' • ');
    group.appendChild(title);

    nodesLayer.appendChild(group);
    nodeEls.set(node.id, {
      group,
      circle,
      label,
      meta,
    });
  }

  state.refCanvas.renderRefs = {
    svg,
    viewportGroup,
    linkEls,
    nodeEls,
  };

  applyRefCanvasViewport();
  updateRefCanvasScenePositions();

  if (!state.refCanvas.viewport.k || state.refCanvas.viewport.k === 1) {
    fitRefCanvasView({ padding: 86 });
  }
}

function applyRefCanvasViewport() {
  const viewportGroup = state.refCanvas.renderRefs?.viewportGroup;
  if (!viewportGroup) {
    return;
  }
  const { x, y, k } = state.refCanvas.viewport;
  viewportGroup.setAttribute('transform', `translate(${x} ${y}) scale(${k})`);
}

function buildRefCanvasPath(link, sourceNode, targetNode) {
  if (!sourceNode || !targetNode) {
    return '';
  }

  if (sourceNode.id === targetNode.id) {
    const loopRadius = sourceNode.r + 18;
    return `M ${sourceNode.x} ${sourceNode.y - sourceNode.r} C ${sourceNode.x + loopRadius} ${sourceNode.y - loopRadius}, ${sourceNode.x + loopRadius} ${sourceNode.y + loopRadius}, ${sourceNode.x} ${sourceNode.y + sourceNode.r}`;
  }

  const dx = targetNode.x - sourceNode.x;
  const dy = targetNode.y - sourceNode.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / distance;
  const uy = dy / distance;
  const startX = sourceNode.x + (ux * sourceNode.r);
  const startY = sourceNode.y + (uy * sourceNode.r);
  const endX = targetNode.x - (ux * targetNode.r);
  const endY = targetNode.y - (uy * targetNode.r);
  const perpX = -uy;
  const perpY = ux;
  const curveScale = distance > 190 ? 42 : 24;
  const curveSign = (hashString(link.id) % 2 === 0) ? 1 : -1;
  const curve = curveScale * curveSign;
  const midX = ((startX + endX) / 2) + (perpX * curve);
  const midY = ((startY + endY) / 2) + (perpY * curve);
  return `M ${startX} ${startY} Q ${midX} ${midY} ${endX} ${endY}`;
}

function updateRefCanvasScenePositions() {
  const renderRefs = state.refCanvas.renderRefs;
  if (!renderRefs) {
    return;
  }

  const selectedNodeIds = getRefCanvasSelectedNodeIds();
  const activeNodeId = String(state.refCanvas.activeNodeId || '').trim();
  const connectedNodeIds = new Set(selectedNodeIds.size ? Array.from(selectedNodeIds) : []);

  for (const link of getRefCanvasLinks()) {
    const sourceNode = state.refCanvas.graph.nodes.get(link.sourceId);
    const targetNode = state.refCanvas.graph.nodes.get(link.targetId);
    const pathEl = renderRefs.linkEls.get(link.id);
    if (!sourceNode || !targetNode || !pathEl) {
      continue;
    }

    pathEl.setAttribute('d', buildRefCanvasPath(link, sourceNode, targetNode));

    const isSelectedLink = selectedNodeIds.size
      ? (selectedNodeIds.has(link.sourceId) || selectedNodeIds.has(link.targetId))
      : false;
    const isActiveLink = activeNodeId
      ? (link.sourceId === activeNodeId || link.targetId === activeNodeId)
      : false;

    pathEl.classList.toggle('is-selected', isSelectedLink);
    pathEl.classList.toggle('is-highlighted', isSelectedLink);
    pathEl.classList.toggle('is-active-link', isSelectedLink && isActiveLink);
    pathEl.setAttribute('marker-end', `url(#${isActiveLink ? (link.activeMarkerId || link.markerId) : link.markerId})`);
    pathEl.style.opacity = selectedNodeIds.size
      ? (isSelectedLink ? (isActiveLink ? '1' : '0.96') : '0.1')
      : '0.72';

    if (isSelectedLink) {
      connectedNodeIds.add(link.sourceId);
      connectedNodeIds.add(link.targetId);
    }
  }

  for (const node of getRefCanvasNodes()) {
    const refs = renderRefs.nodeEls.get(node.id);
    if (!refs) {
      continue;
    }
    refs.group.setAttribute('transform', `translate(${node.x} ${node.y})`);
    refs.circle.setAttribute('r', String(node.r));

    const baseFontSize = Math.max(9, Math.min(15, (node.r * 0.32) + 5));
    refs.label.setAttribute('font-size', String(baseFontSize));
    refs.meta.setAttribute('font-size', String(Math.max(8, baseFontSize - 3)));
    refs.label.style.display = node.r < 18 ? 'none' : 'block';
    refs.meta.style.display = node.r < 20 ? 'none' : 'block';

    const isSelected = selectedNodeIds.has(node.id);
    const isActive = isSelected && node.id === activeNodeId;
    const isConnected = connectedNodeIds.has(node.id);
    const normalizedHealth = String(node.healthStatus || 'unknown').trim().toLowerCase();

    refs.group.classList.toggle('is-selected', isSelected);
    refs.group.classList.toggle('is-active', isActive);
    refs.group.classList.toggle('is-connected', isConnected && !isSelected);
    refs.group.classList.toggle('is-health-healthy', normalizedHealth === 'healthy');
    refs.group.classList.toggle('is-health-unhealthy', normalizedHealth === 'unhealthy');
    refs.group.style.opacity = selectedNodeIds.size ? (isConnected ? '1' : '0.34') : '1';
  }
}

function getRefCanvasViewSize() {
  const stage = els.refCanvasStage;
  const width = Math.max(640, Math.round(stage?.clientWidth || 1200));
  const height = Math.max(420, Math.round(stage?.clientHeight || 720));
  return { width, height };
}

function fitRefCanvasView({ padding = 72 } = {}) {
  const nodes = getRefCanvasNodes();
  if (!nodes.length) {
    return;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.r);
    minY = Math.min(minY, node.y - node.r);
    maxX = Math.max(maxX, node.x + node.r);
    maxY = Math.max(maxY, node.y + node.r);
  }

  const { width, height } = getRefCanvasViewSize();
  const graphWidth = Math.max(1, maxX - minX);
  const graphHeight = Math.max(1, maxY - minY);
  const scale = Math.max(0.22, Math.min(1.55, Math.min((width - (padding * 2)) / graphWidth, (height - (padding * 2)) / graphHeight)));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  state.refCanvas.viewport = {
    x: (width / 2) - (centerX * scale),
    y: (height / 2) - (centerY * scale),
    k: scale,
  };
  applyRefCanvasViewport();
}

function resetRefCanvasView() {
  state.refCanvas.viewport = { x: 0, y: 0, k: 1 };
  fitRefCanvasView({ padding: 86 });
}

function centerRefCanvasOnNode(nodeId, { zoom = null } = {}) {
  const node = state.refCanvas.graph.nodes.get(String(nodeId || '').trim());
  if (!node) {
    return;
  }
  const { width, height } = getRefCanvasViewSize();
  const nextScale = zoom !== null
    ? Math.max(0.28, Math.min(2.6, Number(zoom) || state.refCanvas.viewport.k || 1))
    : Math.max(state.refCanvas.viewport.k || 1, 0.95);
  state.refCanvas.viewport = {
    x: (width / 2) - (node.x * nextScale),
    y: (height / 2) - (node.y * nextScale),
    k: nextScale,
  };
  applyRefCanvasViewport();
}

function resetRefCanvasLayout() {
  const nodes = getRefCanvasNodes();
  nodes.forEach((node, index) => {
    const initial = initializeRefCanvasNodePosition(index, node.isSeed);
    node.x = initial.x;
    node.y = initial.y;
    node.vx = 0;
    node.vy = 0;
    node.fx = null;
    node.fy = null;
  });
  updateRefCanvasScenePositions();
  fitRefCanvasView({ padding: 86 });
  kickRefCanvasSimulation(0.32);
}

function screenToWorldPoint(clientX, clientY) {
  const svg = els.refCanvasSvg;
  const rect = svg?.getBoundingClientRect();
  const { x, y, k } = state.refCanvas.viewport;
  if (!rect || !k) {
    return { x: 0, y: 0 };
  }
  return {
    x: (clientX - rect.left - x) / k,
    y: (clientY - rect.top - y) / k,
  };
}

function handleRefCanvasWheel(event) {
  if (!state.refCanvas.open) {
    return;
  }
  event.preventDefault();

  const rect = els.refCanvasSvg?.getBoundingClientRect();
  if (!rect) {
    return;
  }

  const zoomDelta = Math.exp(-event.deltaY * 0.0014);
  const nextScale = Math.max(0.18, Math.min(3.2, state.refCanvas.viewport.k * zoomDelta));
  const anchorX = event.clientX - rect.left;
  const anchorY = event.clientY - rect.top;
  const worldBefore = screenToWorldPoint(event.clientX, event.clientY);

  state.refCanvas.viewport = {
    x: anchorX - (worldBefore.x * nextScale),
    y: anchorY - (worldBefore.y * nextScale),
    k: nextScale,
  };
  applyRefCanvasViewport();
}

function handleRefCanvasPointerDown(event) {
  if (!state.refCanvas.open) {
    return;
  }

  const svg = els.refCanvasSvg;
  if (!svg) {
    return;
  }

  const nodeGroup = event.target.closest('.ref-canvas-node');
  const interaction = state.refCanvas.interaction;
  interaction.pointerId = event.pointerId;
  interaction.startX = event.clientX;
  interaction.startY = event.clientY;
  interaction.originX = state.refCanvas.viewport.x;
  interaction.originY = state.refCanvas.viewport.y;
  interaction.dragged = false;
  interaction.selectionModifier = Boolean(event.ctrlKey || event.metaKey);
  interaction.skipClickSelection = false;
  interaction.handledSelectionOnPointerUp = false;

  if (nodeGroup) {
    const nodeId = nodeGroup.dataset.nodeId || '';
    const world = screenToWorldPoint(event.clientX, event.clientY);
    const node = state.refCanvas.graph.nodes.get(nodeId);
    interaction.mode = 'drag-node';
    interaction.nodeId = nodeId;
    interaction.pointerDownNodeId = nodeId;
    interaction.pointerOffsetX = world.x - (node?.x || 0);
    interaction.pointerOffsetY = world.y - (node?.y || 0);
    if (node) {
      node.fx = node.x;
      node.fy = node.y;
    }
    nodeGroup.classList.add('is-dragging');
  } else {
    interaction.mode = 'pan';
    interaction.nodeId = '';
    interaction.pointerDownNodeId = '';
  }

  svg.setPointerCapture?.(event.pointerId);
}

function handleRefCanvasPointerMove(event) {
  const interaction = state.refCanvas.interaction;
  if (!state.refCanvas.open || interaction.pointerId !== event.pointerId || !interaction.mode) {
    return;
  }

  const deltaX = event.clientX - interaction.startX;
  const deltaY = event.clientY - interaction.startY;
  if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
    interaction.dragged = true;
  }

  if (interaction.mode === 'pan') {
    state.refCanvas.viewport.x = interaction.originX + deltaX;
    state.refCanvas.viewport.y = interaction.originY + deltaY;
    applyRefCanvasViewport();
    return;
  }

  if (interaction.mode === 'drag-node' && interaction.nodeId) {
    const node = state.refCanvas.graph.nodes.get(interaction.nodeId);
    if (!node) {
      return;
    }
    const world = screenToWorldPoint(event.clientX, event.clientY);
    node.x = world.x - interaction.pointerOffsetX;
    node.y = world.y - interaction.pointerOffsetY;
    node.fx = node.x;
    node.fy = node.y;
    node.vx = 0;
    node.vy = 0;
    updateRefCanvasScenePositions();
    state.refCanvas.simulation.alpha = Math.max(state.refCanvas.simulation.alpha, 0.08);
  }
}

function handleRefCanvasPointerUp(event) {
  const interaction = state.refCanvas.interaction;
  if (interaction.pointerId !== event.pointerId) {
    return;
  }

  const wasDragged = interaction.dragged;
  const clickedNodeId = !wasDragged ? String(interaction.pointerDownNodeId || '').trim() : '';
  const appendToSelection = Boolean(event.ctrlKey || event.metaKey || interaction.selectionModifier);

  if (interaction.nodeId) {
    const group = state.refCanvas.renderRefs?.nodeEls.get(interaction.nodeId)?.group;
    group?.classList.remove('is-dragging');
  }

  interaction.mode = '';
  interaction.pointerId = null;
  interaction.nodeId = '';
  interaction.pointerDownNodeId = '';
  interaction.pointerOffsetX = 0;
  interaction.pointerOffsetY = 0;
  interaction.dragged = false;
  interaction.selectionModifier = false;
  interaction.handledSelectionOnPointerUp = false;
  interaction.skipClickSelection = wasDragged;

  if (wasDragged) {
    kickRefCanvasSimulation(0.03);
    return;
  }

  if (clickedNodeId) {
    interaction.skipClickSelection = true;
    interaction.handledSelectionOnPointerUp = true;
    focusRefCanvasNode(clickedNodeId, { expand: true, appendToSelection }).catch((error) => {
      console.error(error);
      setNotice('error', 'Could not expand the relationship graph.', error.message || 'Could not load additional references.');
      showToast(error.message || 'Could not load additional references.');
    }).finally(() => {
      interaction.handledSelectionOnPointerUp = false;
    });
  }
}

function handleRefCanvasClick(event) {
  if (!state.refCanvas.open) {
    return;
  }
  const interaction = state.refCanvas.interaction;
  const nodeGroup = event.target.closest('.ref-canvas-node');
  if (!nodeGroup || interaction.dragged || interaction.skipClickSelection || interaction.handledSelectionOnPointerUp) {
    interaction.skipClickSelection = false;
    interaction.handledSelectionOnPointerUp = false;
    return;
  }
  const nodeId = nodeGroup.dataset.nodeId || '';
  if (nodeId) {
    event.preventDefault();
    const appendToSelection = Boolean(event.ctrlKey || event.metaKey || interaction.selectionModifier);
    interaction.selectionModifier = false;
    focusRefCanvasNode(nodeId, { expand: true, appendToSelection }).catch((error) => {
      console.error(error);
      setNotice('error', 'Could not expand the relationship graph.', error.message || 'Could not load additional references.');
      showToast(error.message || 'Could not expand the relationship graph.');
    });
  }
}

function handleRefCanvasKeydown(event) {
  if (!state.refCanvas.open) {
    return;
  }
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }
  const nodeGroup = event.target.closest('.ref-canvas-node');
  if (!nodeGroup) {
    return;
  }
  event.preventDefault();
  const nodeId = nodeGroup.dataset.nodeId || '';
  if (nodeId) {
    focusRefCanvasNode(nodeId, { expand: true, appendToSelection: Boolean(event.ctrlKey || event.metaKey) }).catch((error) => {
      console.error(error);
      setNotice('error', 'Could not expand the relationship graph.', error.message || 'Could not load additional references.');
      showToast(error.message || 'Could not expand the relationship graph.');
    });
  }
}

async function focusRefCanvasNode(nodeId, { expand = true, appendToSelection = false } = {}) {
  const node = state.refCanvas.graph.nodes.get(String(nodeId || '').trim());
  if (!node) {
    return;
  }

  const nextSelectedNodeIds = appendToSelection ? new Set(getRefCanvasSelectedNodeIds()) : new Set();
  if (appendToSelection && nextSelectedNodeIds.has(node.id) && nextSelectedNodeIds.size > 1) {
    nextSelectedNodeIds.delete(node.id);
  } else {
    nextSelectedNodeIds.add(node.id);
  }

  const nextActiveNodeId = nextSelectedNodeIds.has(node.id)
    ? node.id
    : Array.from(nextSelectedNodeIds).pop() || node.id;

  const nextSelectedNodeIdList = Array.from(nextSelectedNodeIds);

  setRefCanvasSelectedNodes(nextSelectedNodeIdList, {
    activeNodeId: nextActiveNodeId,
    center: true,
    zoom: Math.max(state.refCanvas.viewport.k || 0.98, 1.14),
  });
  syncSelectionStateFromRefCanvas(nextSelectedNodeIdList);

  await triggerRefCanvasHealthForNode(node);

  if (expand && node.itemId && !state.refCanvas.expandedItemIds.has(node.itemId)) {
    state.refCanvas.loading = true;
    state.refCanvas.scopeLabel = 'Expanding bubble';
    renderRefCanvas();
    try {
      await ensureRefCanvasExpandedForItem(node.itemId, {
        seed: node.isSeed,
        sourceMeta: getCurrentEntryById(node.itemId) || getCachedTreeFileById(node.itemId) || null,
        quiet: true,
      });
      centerRefCanvasOnNode(node.id, {
        zoom: Math.max(state.refCanvas.viewport.k || 1.08, 1.16),
      });
      kickRefCanvasSimulation(0.1);
    } finally {
      state.refCanvas.loading = false;
      state.refCanvas.scopeLabel = state.refCanvas.seedItemIds.length
        ? `${state.refCanvas.seedItemIds.length} selected DWG${state.refCanvas.seedItemIds.length === 1 ? '' : 's'}`
        : `${getRefCanvasNodes().filter((entry) => entry.isFolderTreeMember).length || getRefCanvasNodes().length} folder-tree file${getRefCanvasNodes().length === 1 ? '' : 's'}`;
      renderRefCanvas();
      centerRefCanvasOnNode(node.id, {
        zoom: Math.max(state.refCanvas.viewport.k || 1.12, 1.18),
      });
    }
  }
}

function kickRefCanvasSimulation(alpha = 1) {
  const simulation = state.refCanvas.simulation;
  simulation.alpha = Math.max(simulation.alpha, alpha);
  if (simulation.running) {
    return;
  }
  simulation.running = true;
  simulation.raf = window.requestAnimationFrame(stepRefCanvasSimulation);
}

function stepRefCanvasSimulation(timestamp) {
  const simulation = state.refCanvas.simulation;
  const nodes = getRefCanvasNodes();
  const links = getRefCanvasLinks();
  if (!state.refCanvas.open || !nodes.length) {
    stopRefCanvasSimulation();
    return;
  }

  const dt = simulation.lastTs ? Math.min(2, (timestamp - simulation.lastTs) / 16.6667) : 1;
  simulation.lastTs = timestamp;
  simulation.alpha *= 0.9;
  const alpha = Math.max(0.028, simulation.alpha);

  for (let i = 0; i < nodes.length; i += 1) {
    const nodeA = nodes[i];
    for (let j = i + 1; j < nodes.length; j += 1) {
      const nodeB = nodes[j];
      const dx = nodeB.x - nodeA.x;
      const dy = nodeB.y - nodeA.y;
      const distanceSquared = Math.max(900, (dx * dx) + (dy * dy));
      const distance = Math.sqrt(distanceSquared);
      const force = (980 * alpha) / distanceSquared;
      const pushX = (dx / distance) * force;
      const pushY = (dy / distance) * force;
      nodeA.vx -= pushX;
      nodeA.vy -= pushY;
      nodeB.vx += pushX;
      nodeB.vy += pushY;

      const minimumDistance = nodeA.r + nodeB.r + 10;
      if (distance < minimumDistance) {
        const overlap = ((minimumDistance - distance) / minimumDistance) * 0.1;
        const overlapX = (dx / distance) * overlap * 6;
        const overlapY = (dy / distance) * overlap * 6;
        nodeA.vx -= overlapX;
        nodeA.vy -= overlapY;
        nodeB.vx += overlapX;
        nodeB.vy += overlapY;
      }
    }
  }

  for (const link of links) {
    const sourceNode = state.refCanvas.graph.nodes.get(link.sourceId);
    const targetNode = state.refCanvas.graph.nodes.get(link.targetId);
    if (!sourceNode || !targetNode) {
      continue;
    }
    const dx = targetNode.x - sourceNode.x;
    const dy = targetNode.y - sourceNode.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const desired = sourceNode.r + targetNode.r + (link.isNonDwg ? 70 : 86);
    const spring = (distance - desired) * 0.0046 * alpha;
    const ux = dx / distance;
    const uy = dy / distance;
    sourceNode.vx += ux * spring;
    sourceNode.vy += uy * spring;
    targetNode.vx -= ux * spring;
    targetNode.vy -= uy * spring;
  }

  for (const node of nodes) {
    if (Number.isFinite(node.fx) && Number.isFinite(node.fy)) {
      node.x = node.fx;
      node.y = node.fy;
      node.vx = 0;
      node.vy = 0;
      continue;
    }

    const centerStrength = node.isSeed ? 0.008 : 0.0032;
    node.vx += (-node.x) * centerStrength * alpha * 0.04;
    node.vy += (-node.y) * centerStrength * alpha * 0.04;
    node.vx *= 0.7;
    node.vy *= 0.7;
    node.x += node.vx * dt;
    node.y += node.vy * dt;
  }

  updateRefCanvasScenePositions();

  if (simulation.alpha < 0.012 && !state.refCanvas.interaction.mode) {
    stopRefCanvasSimulation();
    return;
  }

  simulation.raf = window.requestAnimationFrame(stepRefCanvasSimulation);
}

async function ensureRefCanvasExpandedForItem(itemId, { seed = false, sourceMeta = null, quiet = false, force = false } = {}) {
  const normalizedItemId = String(itemId || '').trim();
  if (!normalizedItemId) {
    return null;
  }

  if (!force && state.refCanvas.expandedItemIds.has(normalizedItemId)) {
    return state.refCanvas.graph.nodes.get(createRefCanvasNodeIdFromItemId(normalizedItemId)) || null;
  }

  const payload = await fetchRefListPayload(normalizedItemId, { force });
  const sourceNode = mergeRefCanvasPayload(payload, { sourceEntry: sourceMeta, markSeed: seed });
  if (!quiet) {
    renderEntries();
  }
  renderRefCanvas();
  kickRefCanvasSimulation(seed ? 0.28 : 0.18);
  return sourceNode;
}

async function openRefCanvasForCurrentContext({ force = false } = {}) {
  const folder = currentFolder();
  if (!state.currentProject || !folder) {
    showToast('Choose a folder first.');
    return;
  }

  const seedIds = getRefCanvasSelectedSeedIds().sort();
  const nextScopeKey = seedIds.length ? `selection:${seedIds.join(',')}` : `folder:${folder.id}`;
  const reusingScope = state.refCanvas.scopeKey === nextScopeKey && state.refCanvas.graph.nodes.size > 0;

  if (!force && reusingScope) {
    state.refCanvas.open = !state.refCanvas.open;
    if (!state.refCanvas.open) {
      closeRefCanvas();
      return;
    }
    renderRefCanvas();
    if (state.refCanvas.open) {
      fitRefCanvasView({ padding: 86 });
      kickRefCanvasSimulation(0.04);
      els.refCanvasShell?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    return;
  }

  const preservedTreeCache = state.refCanvas.treeFilesByFolderId;
  state.refCanvas = createRefCanvasState({ open: true, treeFilesByFolderId: preservedTreeCache });
  state.refCanvas.scopeKey = nextScopeKey;
  state.refCanvas.seedItemIds = seedIds;
  state.refCanvas.mode = seedIds.length ? 'selection' : 'folder-tree';
  state.refCanvas.loading = true;
  state.refCanvas.scopeLabel = seedIds.length
    ? `${seedIds.length} selected DWG${seedIds.length === 1 ? '' : 's'}`
    : 'Folder tree';
  renderRefCanvas();

  try {
    if (seedIds.length) {
      await mapWithConcurrencyClient(seedIds, Math.min(4, seedIds.length), async (itemId, index) => {
        const entry = getCurrentEntryById(itemId) || getCachedTreeFileById(itemId);
        await ensureRefCanvasExpandedForItem(itemId, {
          seed: index === 0,
          sourceMeta: entry,
          quiet: true,
        });
      });
    } else {
      const files = await loadFolderTreeFiles(folder.id);
      files.forEach((file, index) => {
        upsertRefCanvasNode({
          id: createRefCanvasNodeIdFromItemId(file.id || file.itemId),
          itemId: file.id || file.itemId,
          label: file.name,
          name: file.name,
          extension: file.extension || extractFileExtension(file.name, 'dwg'),
          sizeBytes: file.size || 0,
          versionLabel: file.versionLabel || file.sourceVersionLabel || '',
          lastModifiedTime: file.lastModifiedTime || '',
          relativePath: file.relativePath || '',
          pathInProject: file.pathInProject || '',
          webViewUrl: file.webViewUrl || '',
          isFolderTreeMember: true,
          isSeed: index === 0,
        }, { pinToCenter: index === 0 });
      });
      recalculateRefCanvasNodeRadii();
      if (files[0]) {
        state.refCanvas.activeNodeId = createRefCanvasNodeIdFromItemId(files[0].id || files[0].itemId);
      }
      renderRefCanvas();
      kickRefCanvasSimulation(0.24);

      await mapWithConcurrencyClient(files, Math.min(4, files.length || 1), async (file, index) => {
        state.refCanvas.scopeLabel = `Folder tree • ${index + 1}/${files.length}`;
        renderRefCanvas();
        await ensureRefCanvasExpandedForItem(file.id || file.itemId, {
          seed: index === 0,
          sourceMeta: file,
          quiet: true,
        });
      });
      state.refCanvas.scopeLabel = `${files.length} folder-tree file${files.length === 1 ? '' : 's'}`;
    }

    state.refCanvas.loading = false;
    const initialSelectedNodeIds = seedIds
      .map((itemId) => createRefCanvasNodeIdFromItemId(itemId))
      .filter((nodeId) => state.refCanvas.graph.nodes.has(nodeId));
    if (initialSelectedNodeIds.length) {
      state.refCanvas.selectedNodeIds = new Set(initialSelectedNodeIds);
      state.refCanvas.activeNodeId = initialSelectedNodeIds[initialSelectedNodeIds.length - 1];
    } else {
      state.refCanvas.selectedNodeIds = new Set();
    }
    renderRefCanvas();
    fitRefCanvasView({ padding: 88 });
    if (state.refCanvas.activeNodeId && initialSelectedNodeIds.length === 1) {
      centerRefCanvasOnNode(state.refCanvas.activeNodeId, {
        zoom: Math.max(state.refCanvas.viewport.k || 0.96, 1.06),
      });
    }

    const initialActiveNode = getActiveRefCanvasNode();
    if (seedIds.length) {
      await queueRefCanvasHealthForSelection(seedIds);
    }
    if (initialActiveNode?.itemId && initialSelectedNodeIds.length) {
      await triggerRefCanvasHealthForNode(initialActiveNode);
    } else {
      renderRefCanvasHealthPanel();
    }

    kickRefCanvasSimulation(0.04);
    els.refCanvasShell?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setNotice('info', 'Reference Canvas ready.', seedIds.length
      ? `Loaded the unfiltered relationship graph for ${seedIds.length} selected DWG${seedIds.length === 1 ? '' : 's'}. Click any bubble to expand additional references on the same canvas.`
      : 'Loaded the unfiltered relationship graphs for the current folder tree. Click any bubble to expand additional references on the same canvas.');
  } catch (error) {
    console.error(error);
    state.refCanvas.loading = false;
    state.refCanvas.error = error.message || 'Could not load the relationship graph.';
    renderRefCanvas();
    throw error;
  }
}

function closeRefCanvas() {
  state.refCanvas.open = false;
  stopRefCanvasSimulation();
  resetRefCanvasHealthClientState({ clearNodeHealth: true });
  renderRefCanvas();
  if (isAuthenticated()) {
    api('/api/ref-canvas/health', { method: 'DELETE' }).catch((error) => {
      console.error(error);
    });
  }
}


async function init() {
  try {
    loadPanelLayoutState();
    renderPanelLayout();
    const pendingAuthError = getPendingAuthError();
    await refreshShellData();

    if (isAuthenticated()) {
      await loadHubs();
    } else if (pendingAuthError) {
      setNotice('error', 'Autodesk sign-in failed.', pendingAuthError);
      showToast('Autodesk sign-in failed.');
    } else {
      setNotice(
        state.config?.credentials?.configured ? 'info' : 'error',
        state.config?.credentials?.configured ? 'Ready to sign in.' : 'Save credentials first.',
        state.config?.credentials?.configured
          ? 'Use Sign in to authorize ACC access and start browsing hubs and DWG content.'
          : 'Enter APS Client ID and Client Secret, save them to the server session, then Sign in with Autodesk.'
      );
    }
  } catch (error) {
    console.error(error);
    setNotice('error', 'Initialization failed.', error.message);
    showToast(error.message);
  }
}

els.leftPanelToggleBtn?.addEventListener('click', () => {
  togglePanelLayout('left');
});

els.rightPanelToggleBtn?.addEventListener('click', () => {
  togglePanelLayout('right');
});

els.saveCredentialsBtn.addEventListener('click', async () => {
  try {
    await api('/api/config/credentials', {
      method: 'POST',
      body: {
        clientId: els.clientId.value.trim(),
        clientSecret: els.clientSecret.value.trim(),
        nickname: els.nicknameInput.value.trim(),
      },
    });

    clearSessionJobState();
    resetBrowserState();

    await refreshShellData();
    setNotice('info', 'Credentials saved.', 'APS credentials are stored in the current server session. Sign in with Autodesk to continue.');
    showToast('Credentials saved in the current server session.');
  } catch (error) {
    console.error(error);
    setNotice('error', 'Could not save credentials.', error.message);
    showToast(error.message);
  }
});


async function handleSignOut() {
  await api('/api/auth/logout', { method: 'POST' });
  clearSessionJobState();
  resetBrowserState();
  await refreshShellData();
  setNotice('info', 'Signed out.', 'The Autodesk session was cleared. Sign in again to browse ACC or upload successful outputs back as new versions.');
}

els.loginBtn?.addEventListener('click', async () => {
  try {
    if (isAuthenticated()) {
      await handleSignOut();
      return;
    }
    window.location.href = '/api/auth/login';
  } catch (error) {
    console.error(error);
    setNotice('error', 'Could not update the session.', error.message);
    showToast(error.message);
  }
});


els.uploadScriptBtn.addEventListener('click', async () => {
  try {
    const file = els.scriptFile.files?.[0];
    if (!file) {
      showToast('Choose a .scr file first.');
      return;
    }
    const formData = new FormData();
    formData.append('script', file);
    await api('/api/automation/script', {
      method: 'POST',
      body: formData,
    });
    els.scriptFile.value = '';
    await refreshConfig();
    setNotice('info', 'Override script uploaded.', 'The custom script is staged. Use Create Bundle to publish a new bundle version.');
    showToast('Override script uploaded.');
  } catch (error) {
    console.error(error);
    setNotice('error', 'SCR upload failed.', error.message);
    showToast(error.message);
  }
});

els.clearScriptBtn.addEventListener('click', async () => {
  try {
    await api('/api/automation/script', { method: 'DELETE' });
    await refreshConfig();
    setNotice('info', 'Override script cleared.', 'The bundle default script will be used for future bundle updates.');
    showToast('Override script cleared.');
  } catch (error) {
    console.error(error);
    setNotice('error', 'Could not clear the override script.', error.message);
    showToast(error.message);
  }
});

els.createBundleBtn.addEventListener('click', async () => {
  try {
    els.createBundleBtn.disabled = true;
    setNotice('info', 'Creating bundle.', 'Creating or refreshing the Automation bundle for the selected engine.');
    const payload = await api('/api/automation/setup', {
      method: 'POST',
      body: { engine: els.engineSelect.value },
    });
    await refreshConfig();
    await loadEngines();
    setNotice('success', 'Bundle ready.', 'The Automation bundle is ready. You can now run selected DWGs or a folder tree.');
    showToast('Automation resources are ready.');
  } catch (error) {
    console.error(error);
    setNotice('error', 'Automation setup failed.', error.message);
    showToast(error.message);
  } finally {
    toggleControls();
  }
});

els.refreshHubsBtn?.addEventListener('click', async () => {
  try {
    await loadHubs({ preserveSelection: true });
    showToast('Hubs refreshed.');
  } catch (error) {
    console.error(error);
    setNotice('error', 'Could not refresh hubs.', error.message);
    showToast(error.message);
  }
});

els.refreshFolderBtn?.addEventListener('click', async () => {
  try {
    await loadCurrentFolder();
    showToast('Folder refreshed.');
  } catch (error) {
    console.error(error);
    setNotice('error', 'Could not refresh folder.', error.message);
    showToast(error.message);
  }
});

els.refreshJobsBtn?.addEventListener('click', async () => {
  try {
    if (currentFolder()) {
      await loadCurrentFolder();
    }
    await loadJobs();
    showToast('Workspace refreshed.');
  } catch (error) {
    console.error(error);
    setNotice('error', 'Could not refresh the workspace.', error.message);
    showToast(error.message);
  }
});

els.refCanvasBtn?.addEventListener('click', async () => {
  try {
    await openRefCanvasForCurrentContext();
  } catch (error) {
    console.error(error);
    setNotice('error', 'Could not open Reference Canvas.', error.message || 'Could not load the relationship graph.');
    showToast(error.message || 'Could not load the relationship graph.');
  }
});

els.refCanvasFitBtn?.addEventListener('click', () => {
  fitRefCanvasView({ padding: 86 });
  kickRefCanvasSimulation(0.04);
});

els.refCanvasResetBtn?.addEventListener('click', () => {
  resetRefCanvasLayout();
});

els.refCanvasCloseBtn?.addEventListener('click', () => {
  closeRefCanvas();
});

els.refCanvasHealthBadge?.addEventListener('click', handleRefCanvasHealthBadgeClick);
els.refCanvasHealthBadge?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    handleRefCanvasHealthBadgeClick(event);
  }
});

els.runSelectedBtn?.addEventListener('click', async () => {
  try {
    await runSelected();
  } catch (error) {
    console.error(error);
    clearSubmissionProgress();
    setNotice('error', 'Run automation failed.', error.message);
    showToast(error.message);
  }
});

els.runReferencesBtn?.addEventListener('click', async () => {
  try {
    await runReferences();
  } catch (error) {
    console.error(error);
    clearSubmissionProgress();
    setNotice('error', 'Run refs only failed.', error.message);
    showToast(error.message);
  }
});

els.clearSelectionBtn?.addEventListener('click', async () => {
  try {
    await api('/api/jobs/clear', { method: 'POST' });
    stopAllPolling();
    state.jobs.clear();
    rebuildJobIndexes();
    clearSubmissionProgress();
    renderEntries();
    renderJobs();
    toggleControls();
    setNotice('info', 'Automation log cleared.', 'Removed the job history for this browser session.');
    showToast('Automation log cleared.');
  } catch (error) {
    console.error(error);
    setNotice('error', 'Could not clear the automation log.', error.message);
    showToast(error.message);
  }
});

els.openJobsFileBtn?.addEventListener('click', async () => {
  try {
    await api('/api/jobs/open-file', { method: 'POST' });
    showToast('Opened jobs.json in your default browser.');
  } catch (error) {
    console.error(error);
    setNotice('error', 'Could not open jobs.json in the default browser.', error.message);
    showToast(error.message);
  }
});

if (els.runFolderBtn) {
  els.runFolderBtn.addEventListener('click', async () => {
    try {
      await runFolder();
    } catch (error) {
      console.error(error);
      clearSubmissionProgress();
      setNotice('error', 'Run folder failed.', error.message);
      showToast(error.message);
    }
  });
}

els.fileTableBody?.addEventListener('click', (event) => {
  handleFileTableClick(event).catch((error) => {
    console.error(error);
  });
});
els.fileTableBody?.addEventListener('change', (event) => {
  handleFileTableChange(event).catch((error) => {
    console.error(error);
    showToast(error.message || 'Could not update the file selection.');
  });
});

document.addEventListener('click', (event) => {
  if (!state.openRowMenuItemId) {
    return;
  }
  if (event.target.closest('.row-menu')) {
    return;
  }
  closeRowMenu({ render: true });
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.openRowMenuItemId) {
    closeRowMenu({ render: true });
  }
});

els.selectAll?.addEventListener('change', async () => {
  let focusItemId = '';
  [...els.fileTableBody.querySelectorAll('tr[data-kind="file"]:not(.filtered-out) .row-check')].forEach((input) => {
    input.checked = els.selectAll.checked;
    const id = input.dataset.selectItem;
    if (input.checked) {
      state.selectedItemIds.add(id);
      focusItemId = id;
    } else {
      state.selectedItemIds.delete(id);
    }
  });
  updateSelectionUI();
  if (state.refCanvas.open) {
    try {
      await syncRefCanvasSelectionFromCurrentItems({ focusItemId });
    } catch (error) {
      console.error(error);
      showToast(error.message || 'Could not sync the canvas selection.');
    }
  }
});

els.filterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    els.filterButtons.forEach((chip) => chip.classList.remove('is-active'));
    button.classList.add('is-active');
    state.entryFilter = button.dataset.filter || 'all';
    applyEntryFilter();
  });
});

els.dismissNotice?.addEventListener('click', () => {
  els.notice.classList.add('hidden');
});

els.scriptFile?.addEventListener('change', () => {
  els.scriptName.textContent = els.scriptFile.files?.[0]?.name || 'Using bundle default script';
});

document.addEventListener('mouseover', handleTooltipOver);
document.addEventListener('focusin', handleTooltipOver);
document.addEventListener('mouseout', handleTooltipOut);
document.addEventListener('focusout', hideTooltip);
window.addEventListener('scroll', hideTooltip, true);
window.addEventListener('resize', hideTooltip);
window.addEventListener('resize', () => {
  if (!state.refCanvas.open || !state.refCanvas.graph.nodes.size) {
    return;
  }
  fitRefCanvasView({ padding: 86 });
  kickRefCanvasSimulation(0.03);
});

window.addEventListener('DOMContentLoaded', init);
