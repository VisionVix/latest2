'use strict';

// ══════════════════════════════
//  STATE
// ══════════════════════════════

// ── Workspace system ──
// Each workspace holds all per-folder state
let workspaces = [];     // array of workspace objects
let activeWsId = null;   // id of the active workspace

function createWorkspace(name) {
  return {
    id: Date.now() + Math.random(),
    name,
    fileHandles: {},
    dirHandles: {},
    fileContents: {},
    modifiedFiles: new Set(),
    openTabs: [],
    activeTab: null,
    editorModels: {},
    collapsedDirs: new Set(),
    allFilePaths: [],
  };
}

// Shorthand getters — always read from active workspace
function ws()           { return workspaces.find(w => w.id === activeWsId) || null; }
function get(key)       { const w = ws(); return w ? w[key] : (key === 'modifiedFiles' || key === 'collapsedDirs' ? new Set() : key.endsWith('s') || key === 'openTabs' || key === 'allFilePaths' ? [] : {}); }

// Per-workspace state accessors
Object.defineProperties(window, {
  fileHandles:   { get: () => ws()?.fileHandles   ?? {}, set: v => { if(ws()) ws().fileHandles   = v; } },
  dirHandles:    { get: () => ws()?.dirHandles    ?? {}, set: v => { if(ws()) ws().dirHandles    = v; } },
  fileContents:  { get: () => ws()?.fileContents  ?? {}, set: v => { if(ws()) ws().fileContents  = v; } },
  modifiedFiles: { get: () => ws()?.modifiedFiles ?? new Set(), set: v => { if(ws()) ws().modifiedFiles = v; } },
  openTabs:      { get: () => ws()?.openTabs      ?? [], set: v => { if(ws()) ws().openTabs      = v; } },
  activeTab:     { get: () => ws()?.activeTab     ?? null, set: v => { if(ws()) ws().activeTab   = v; } },
  editorModels:  { get: () => ws()?.editorModels  ?? {}, set: v => { if(ws()) ws().editorModels  = v; } },
  collapsedDirs: { get: () => ws()?.collapsedDirs ?? new Set(), set: v => { if(ws()) ws().collapsedDirs = v; } },
  allFilePaths:  { get: () => ws()?.allFilePaths  ?? [], set: v => { if(ws()) ws().allFilePaths  = v; } },
});

let rootHandle = null;
let editor = null;
let vexHistory = [];
let vexTyping = false;
let vexChatOpen = false;
let termOpen = true;

// ══════════════════════════════
//  MONACO INIT
// ══════════════════════════════
require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });

require(['vs/editor/editor.main'], function() {
  monaco.editor.defineTheme('vex-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '55556a', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'a78bfa' },
      { token: 'string', foreground: '4ade80' },
      { token: 'number', foreground: '8B35C8' },
      { token: 'type', foreground: '60a5fa' },
    ],
    colors: {
      'editor.background': '#0a0a0f',
      'editor.foreground': '#e8e8f0',
      'editorLineNumber.foreground': '#2a2a3a',
      'editorLineNumber.activeForeground': '#55556a',
      'editor.selectionBackground': '#8B35C820',
      'editor.lineHighlightBackground': '#0f0f16',
      'editorCursor.foreground': '#8B35C8',
      'editor.findMatchBackground': '#8B35C830',
      'editorBracketMatch.background': '#8B35C820',
      'editorBracketMatch.border': '#8B35C8',
    }
  });

  editor = monaco.editor.create(document.getElementById('editor'), {
    theme: 'vex-dark',
    language: 'typescript',
    fontSize: 12,
    fontFamily: "'JetBrains Mono', monospace",
    fontLigatures: true,
    lineHeight: 20,
    minimap: { enabled: true, scale: 1 },
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    renderWhitespace: 'selection',
    bracketPairColorization: { enabled: true },
    padding: { top: 10 },
    automaticLayout: true,
  });

  editor.onDidChangeCursorPosition(e => {
    document.getElementById('sbPos').textContent =
      `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
  });

  editor.onDidChangeModelContent(() => {
    if (activeTab) {
      const m = editor.getModel();
      if (m) fileContents[activeTab] = m.getValue();
      // Auto-refresh preview if open
      if (previewOpen && activeTab && activeTab.endsWith('.html')) schedulePreviewRefresh();
      modifiedFiles.add(activeTab);
      updateTabModified(activeTab);
      updateModifiedCount();
    }
  });

  // Ctrl+S to save
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveCurrentFile());

  termLog('success', '✓ Monaco editor initialized');
});

// ══════════════════════════════
//  FOLDER / FILE SYSTEM
// ══════════════════════════════
function showNewWsMenu(e) {
  document.querySelectorAll('.ctx-menu').forEach(function(m){ m.remove(); });
  var btn = e.currentTarget;
  var rect = btn.getBoundingClientRect();
  var menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.cssText = 'position:fixed;z-index:99999;background:#0f1923;border:1px solid #1e3044;border-radius:8px;padding:4px 0;font-family:"IBM Plex Sans",sans-serif;font-size:12px;min-width:190px;box-shadow:0 8px 24px rgba(0,0,0,.6)';
  menu.style.left = rect.left + 'px';
  menu.style.top = (rect.bottom + 4) + 'px';
  var items = [
    { icon: '📂', label: 'Open Folder', sub: 'Load a local folder', a: function(){ openFolder(); } },
    { icon: '✦',  label: 'New Empty Workspace', sub: 'Start from scratch', a: function(){ createEmptyWorkspace(); } },
  ];
  items.forEach(function(item) {
    var el = document.createElement('div');
    el.style.cssText = 'padding:8px 14px;cursor:pointer;color:#c8c8e0;display:flex;align-items:center;gap:10px;';
    el.innerHTML = '<span style="font-size:15px">' + item.icon + '</span>'
      + '<div><div style="font-weight:600">' + item.label + '</div>'
      + '<div style="font-size:10px;color:#556677;margin-top:1px">' + item.sub + '</div></div>';
    el.onmouseenter = function(){ el.style.background='#15202b'; el.style.color='#d4a853'; };
    el.onmouseleave = function(){ el.style.background=''; el.style.color='#c8c8e0'; };
    el.onclick = function(){ menu.remove(); item.a(); };
    menu.appendChild(el);
  });
  document.body.appendChild(menu);
  setTimeout(function(){ document.addEventListener('click', function(){ menu.remove(); }, {once:true}); }, 50);
}

function createEmptyWorkspace() {
  setTimeout(function(){
    var name = prompt('Workspace name:', 'New Project');
    if (!name || !name.trim()) return;
    var newWs = createWorkspace(name.trim());
    workspaces.push(newWs);
    activeWsId = newWs.id;
    syncWorkspaceUI();
    renderTree();
    renderWsTabs();
    toast('\u2756 Created: ' + name.trim(), 'success');
  }, 50);
}

function openFolder() {
  const input = document.getElementById('folderInput');
  input.value = '';
  input.click();
}

async function handleFolderInput(input) {
  const files = Array.from(input.files);
  if (!files.length) return;

  const folderName = files[0].webkitRelativePath.split('/')[0] || 'project';

  // Create a new workspace for this folder
  const newWs = createWorkspace(folderName);
  workspaces.push(newWs);
  activeWsId = newWs.id;

  termLog('info', `📂 Loading: ${folderName}`);

  const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__', '.cache']);

  for (const file of files) {
    const parts = file.webkitRelativePath.split('/');
    if (parts.some(p => SKIP.has(p))) continue;
    const relPath = parts.slice(1).join('/');
    if (!relPath) continue;
    newWs.fileHandles[relPath] = file;
    newWs.allFilePaths.push(relPath);
    for (let i = 1; i < parts.length - 1; i++) {
      const dirPath = parts.slice(1, i + 1).join('/');
      if (!newWs.dirHandles[dirPath]) newWs.dirHandles[dirPath] = true;
    }
  }

  syncWorkspaceUI();
  renderTree();
  renderWsTabs();
  termLog('success', `✓ Loaded ${newWs.allFilePaths.length} files`);
  toast(`✓ Opened ${folderName} — ${newWs.allFilePaths.length} files`, 'success');
  _wsScanned = false;
  setTimeout(() => _runWorkspaceScan(), 500);
}

function addFiles() {
  if (!ws()) { toast('Open a workspace first', 'error'); return; }
  var input = document.getElementById('fileInput');
  input.value = '';
  input.click();
}

async function handleFileInput(input) {
  var files = Array.from(input.files);
  if (!files.length) return;
  var added = 0;
  for (var file of files) {
    var path = file.name;
    ws().fileHandles[path] = file;
    if (!ws().allFilePaths.includes(path)) ws().allFilePaths.push(path);
    try { ws().fileContents[path] = await file.text(); } catch(e) {}
    added++;
  }
  renderTree();
  toast('✓ Added ' + added + ' file' + (added > 1 ? 's' : ''), 'success');
  if (files.length === 1) openFile(files[0].name);
  // Detect translation JSON — 2-char lang code like hi.json, es.json
  var jsonFiles = Array.from(files).filter(function(f){
    return /^[a-z]{2}\.json$/.test(f.name) && f.name !== 'en.json';
  });
  if (jsonFiles.length > 0) {
    var jf = jsonFiles[0];
    var langCode = jf.name.replace('.json','');
    var content = ws().fileContents[jf.name];
    try {
      var parsed = JSON.parse(content);
      if (Object.keys(parsed).length > 3) {
        if (!vexChatOpen) vexToggleChat();
        setTimeout(function(){
          vexAddMsg('I see <b>' + jf.name + '</b> — a <b>' + langCode.toUpperCase() + '</b> translation with ' + Object.keys(parsed).length + ' strings.<br><br>Which HTML file should I inject it into?');
          var htmlFiles = allFilePaths.filter(function(p){ return p.endsWith('.html'); });
          if (htmlFiles.length > 0) {
            vexAddBtns(htmlFiles.slice(0,4).map(function(p){
              var captured = p;
              return {label: captured.split('/').pop(), action: function(){ injectTranslationFromJSON(captured, langCode, parsed); }};
            }));
          } else {
            vexAddMsg('No HTML files in workspace. Open your game file first.');
          }
        }, 500);
      }
    } catch(e) {}
  }
}

function newFolderPrompt() {
  if (!ws()) { toast('Open a workspace first', 'error'); return; }
  var name = prompt('New folder name:', 'my-folder');
  if (!name || !name.trim()) return;
  var folderPath = name.trim().replace(/\/+$/, '');
  // Create a .gitkeep placeholder so the folder appears in the tree
  var keepPath = folderPath + '/.gitkeep';
  if (ws().allFilePaths.includes(keepPath)) { toast('Folder already exists', 'error'); return; }
  ws().fileContents[keepPath] = '';
  ws().allFilePaths.push(keepPath);
  renderTree();
  toast('✓ Created folder: ' + folderPath, 'success');
}

function newFilePrompt(folder) {
  if (!ws()) { toast('Open a workspace first', 'error'); return; }
  var defaultName = folder ? folder + '/untitled.ts' : 'untitled.ts';
  var hint = folder ? 'New file in ' + folder + ':' : 'New file name:';
  var name = prompt(hint, defaultName);
  if (!name || !name.trim()) return;
  var path = name.trim();
  if (ws().allFilePaths.includes(path)) { toast('File already exists', 'error'); return; }
  ws().fileContents[path] = '';
  ws().allFilePaths.push(path);
  ws().modifiedFiles.add(path);
  renderTree();
  openFile(path);
  toast('✓ Created ' + path, 'success');
}

function switchWorkspace(id) {
  if (activeWsId === id) return;

  // Save editor content back to current workspace before switching
  const cur = ws();
  if (cur && cur.activeTab && editor) {
    const model = cur.editorModels[cur.activeTab];
    if (model) cur.fileContents[cur.activeTab] = model.getValue();
  }

  // Save current workspace chat before switching
  const oldId = activeWsId;

  activeWsId = id;
  syncWorkspaceUI();

  // Restore editor for new workspace
  const next = ws();
  if (next && next.activeTab && next.editorModels[next.activeTab]) {
    document.getElementById('editorPlaceholder').style.display = 'none';
    document.getElementById('editor').style.display = 'block';
    editor.setModel(next.editorModels[next.activeTab]);
  } else {
    document.getElementById('editorPlaceholder').style.display = 'flex';
    document.getElementById('editor').style.display = 'none';
  }

  renderWsTabs();
  renderTree();
  renderTabs();
  _wsScanned = false;
  setTimeout(() => _runWorkspaceScan(), 300);

  // Switch chat to new workspace
  _wsOnWorkspaceSwitch(oldId, id);

  // Show workspace name in chat if open
  const overlay = document.getElementById('vexWsOverlay');
  if (overlay?.classList.contains('open') && next) {
    const badge = document.createElement('div');
    badge.style.cssText = 'font-size:9px;color:#334455;padding:4px 0;text-align:center;border-top:1px solid #1e3044;margin-top:4px';
    badge.textContent = `── switched to ${next.name} ──`;
    document.getElementById('vexWsBody')?.appendChild(badge);
  }
}

function closeWorkspace(id, e) {
  e && e.stopPropagation();
  const idx = workspaces.findIndex(w => w.id === id);
  if (idx === -1) return;
  const name = workspaces[idx].name;
  const hasModified = workspaces[idx].modifiedFiles && workspaces[idx].modifiedFiles.size > 0;

  // Ask VEX to confirm
  if (!vexChatOpen) vexToggleChat();
  vexAddMsg('⚠️ <b>Close workspace "' + name + '"?</b><br><br>'
    + (hasModified
      ? '🔴 You have <b>unsaved changes</b> — closing will lose them permanently.<br><br>'
      : 'Any work not pushed to GitHub will be lost.<br><br>')
    + 'Are you sure?');
  vexAddBtns([
    { label: '✅ Yes, close it', action: function() {
      Object.values(workspaces[idx].editorModels).forEach(m => m.dispose && m.dispose());
      workspaces.splice(idx, 1);
      if (workspaces.length === 0) {
        activeWsId = null;
        resetUI();
      } else {
        const next = workspaces[Math.min(idx, workspaces.length - 1)];
        activeWsId = next.id;
        switchWorkspace(activeWsId);
      }
      renderWsTabs();
      termLog('info', `📁 Closed workspace: ${name}`);
      toast(`Closed ${name}`);
    }},
    { label: '✕ Cancel', action: function() {} }
  ]);
}

function syncWorkspaceUI() {
  const w = ws();
  if (!w) { resetUI(); return; }
  document.getElementById('repoName').textContent = w.name;
  document.getElementById('repoIndicator').classList.toggle('live', w.allFilePaths.length > 0);
  document.getElementById('sbBranch').textContent = `⎇ ${w.name}`;
  document.getElementById('sidebarTitle').textContent = w.name;
  const af = w.activeTab;
  if (af) {
    document.getElementById('sbFile').textContent = `📄 ${af.split('/').pop()}`;
    document.getElementById('sbLang').textContent = getLang(af).toUpperCase();
    document.getElementById('vexCtxFile').textContent = af.split('/').pop();
  } else {
    document.getElementById('sbFile').textContent = '📄 —';
    document.getElementById('sbLang').textContent = '—';
    document.getElementById('vexCtxFile').textContent = 'no file open';
  }
  updateModifiedCount();
  abRefreshPanels();
}

function resetUI() {
  document.getElementById('repoName').textContent = 'No folder open';
  document.getElementById('repoIndicator').classList.remove('live');
  document.getElementById('sbBranch').textContent = '⎇ —';
  document.getElementById('sbFile').textContent = '📄 —';
  document.getElementById('sbLang').textContent = '—';
  document.getElementById('sbModified').textContent = '0 modified';
  document.getElementById('sidebarTitle').textContent = 'Explorer';
  document.getElementById('vexCtxFile').textContent = 'no file open';
  document.getElementById('tabBar').innerHTML = '';
  document.getElementById('editorPlaceholder').style.display = 'flex';
  document.getElementById('editor').style.display = 'none';
  document.getElementById('fileTree').innerHTML = `
    <div class="tree-empty">
      <div class="tree-empty-icon">📁</div>
      Click <strong>＋</strong> or <strong>Open Folder</strong><br>to load a repo<br><br>
      <span style="font-size:9px;color:var(--tx2)">Multiple repos supported via workspace tabs.</span>
    </div>`;
}

function renderWsTabs() {
  const bar = document.getElementById('wsBar');
  bar.innerHTML = '';

  // Render all tabs
  for (const w of workspaces) {
    const tab = document.createElement('div');
    tab.className = `ws-tab ${w.id === activeWsId ? 'active' : ''}`;
    tab.dataset.wsId = w.id;
    tab.innerHTML = `
      <div class="ws-tab-dot"></div>
      <span>${w.name}</span>
      <span class="ws-tab-close" onclick="closeWorkspace(${w.id},event)">✕</span>`;
    tab.onclick = () => switchWorkspace(w.id);
    bar.appendChild(tab);
  }

  // ＋ New button — always visible, flex-shrink:0
  const addBtn = document.createElement('div');
  addBtn.className = 'ws-add';
  addBtn.title = 'New workspace';
  addBtn.textContent = '＋';
  addBtn.style.cssText = 'flex-shrink:0;padding:0 8px;font-size:14px';
  addBtn.onclick = function(e){ showNewWsMenu(e); };
  bar.appendChild(addBtn);

  // Overflow › button — shown when tabs overflow
  const overflowBtn = document.createElement('div');
  overflowBtn.className = 'ws-overflow-btn';
  overflowBtn.id = 'wsOverflowBtn';
  overflowBtn.title = 'All workspaces';
  overflowBtn.textContent = '›';
  overflowBtn.style.display = 'none';
  overflowBtn.onclick = function(e) { e.stopPropagation(); showWsOverflowMenu(overflowBtn); };
  bar.appendChild(overflowBtn);

  // Check overflow after render
  requestAnimationFrame(checkWsOverflow);
}

function checkWsOverflow() {
  const bar = document.getElementById('wsBar');
  const overflowBtn = document.getElementById('wsOverflowBtn');
  if (!bar || !overflowBtn) return;

  // Collect all tabs
  const tabs = Array.from(bar.querySelectorAll('.ws-tab'));
  if (!tabs.length) { overflowBtn.style.display = 'none'; return; }

  // Available width = bar width minus ＋ button (~32px) minus overflow btn (~24px)
  const barW = bar.clientWidth - 56;
  const tabW = Math.floor(barW / tabs.length);
  const minTab = 40;

  if (tabW < minTab) {
    // Show overflow: only show tabs that fit, rest go into dropdown
    const visibleCount = Math.max(1, Math.floor(barW / minTab) - 1);
    // Always keep active tab visible
    const activeIdx = tabs.findIndex(t => t.dataset.wsId === String(activeWsId));
    let visibleIds = new Set();

    // Start with active
    if (activeIdx >= 0) visibleIds.add(activeIdx);
    // Fill remaining slots from start
    for (let i = 0; i < tabs.length && visibleIds.size < visibleCount; i++) {
      visibleIds.add(i);
    }

    tabs.forEach(function(t, i) {
      t.style.display = visibleIds.has(i) ? 'flex' : 'none';
      t.style.flex = '1 1 0';
      t.style.maxWidth = '120px';
    });
    overflowBtn.style.display = 'flex';
    // Show count of hidden
    const hidden = tabs.length - visibleIds.size;
    overflowBtn.textContent = '› ' + (hidden > 0 ? '+' + hidden : '');
  } else {
    // All fit — show all, hide overflow
    tabs.forEach(function(t) {
      t.style.display = 'flex';
      t.style.flex = '1 1 0';
      t.style.maxWidth = '140px';
    });
    overflowBtn.style.display = 'none';
  }
}

function showWsOverflowMenu(btn) {
  document.querySelectorAll('.ctx-menu').forEach(function(m){ m.remove(); });
  var rect = btn.getBoundingClientRect();
  var menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.cssText = 'position:fixed;z-index:99999;background:#0f1923;border:1px solid #1e3044;border-radius:8px;padding:4px 0;font-family:"IBM Plex Sans",sans-serif;font-size:11px;min-width:200px;box-shadow:0 8px 24px rgba(0,0,0,.6)';
  menu.style.left = Math.max(0, rect.right - 200) + 'px';
  menu.style.top = (rect.bottom + 4) + 'px';

  var label = document.createElement('div');
  label.style.cssText = 'padding:6px 14px 4px;font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#334455';
  label.textContent = 'All Workspaces';
  menu.appendChild(label);

  workspaces.forEach(function(w) {
    var item = document.createElement('div');
    var isActive = w.id === activeWsId;
    item.style.cssText = 'padding:7px 14px;cursor:pointer;color:' + (isActive ? '#d4a853' : '#c8c8e0') + ';display:flex;align-items:center;gap:8px;';
    item.innerHTML = '<div style="width:6px;height:6px;border-radius:50%;background:' + (isActive ? 'var(--gold)' : '#334455') + ';flex-shrink:0"></div>'
      + '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + w.name + '</span>'
      + '<span style="font-size:9px;color:#334455">' + w.allFilePaths.length + ' files</span>';
    item.onmouseenter = function(){ item.style.background='#15202b'; };
    item.onmouseleave = function(){ item.style.background=''; };
    item.onclick = function(){ menu.remove(); switchWorkspace(w.id); };
    menu.appendChild(item);
  });

  document.body.appendChild(menu);
  setTimeout(function(){ document.addEventListener('click', function(){ menu.remove(); }, {once:true}); }, 50);
}

async function refreshTree() {
  if (!ws() || !ws().allFilePaths.length) { toast('No folder open'); return; }
  renderTree();
  toast('↺ Tree refreshed');
}

// ══════════════════════════════
//  TREE RENDERING
// ══════════════════════════════
function renderTree() {
  const container = document.getElementById('fileTree');
  if (allFilePaths.length === 0) {
    container.innerHTML = '<div class="tree-empty"><div class="tree-empty-icon">📭</div>No files found</div>';
    return;
  }

  // Build tree structure
  const tree = {};
  for (const path of allFilePaths) {
    const parts = path.split('/');
    let node = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      const dir = parts[i];
      if (!node[dir]) node[dir] = { __files: [], __dirs: {} };
      node = node[dir].__dirs || (node[dir].__dirs = {});
    }
    const fileName = parts[parts.length - 1];
    const parentKey = parts.slice(0, -1).join('/');
    if (!tree.__root) tree.__root = [];
    // Just collect flat paths, render them sorted
  }

  container.innerHTML = '';
  const sorted = [...allFilePaths].sort();
  renderFlatTree(container, sorted);
}

function renderFlatTree(container, paths) {
  // renderDirGroup handles both root files and subdirectories — no separate loop needed
  renderDirGroup(container, paths, '', 0);
}

function renderDirGroup(container, paths, prefix, depth) {
  const dirs = new Set();
  const files = [];

  for (const path of paths) {
    const rel = prefix ? path.slice(prefix.length + 1) : path;
    const parts = rel.split('/');
    if (parts.length === 1) {
      files.push(path);
    } else {
      const dir = prefix ? `${prefix}/${parts[0]}` : parts[0];
      dirs.add(dir);
    }
  }

  // Dirs first
  for (const dir of [...dirs].sort()) {
    const name = dir.split('/').pop();
    const isCollapsed = collapsedDirs.has(dir);
    const dirEl = document.createElement('div');
    dirEl.className = 'tree-item dir';
    dirEl.style.paddingLeft = `${14 + depth * 14}px`;
    dirEl.dataset.dir = dir;
    dirEl.innerHTML = `
      <span class="tree-dir-toggle ${isCollapsed ? '' : 'open'}">▶</span>
      <span class="tree-icon">📁</span>
      <span>${name}</span>
    `;
    dirEl.onclick = () => toggleDir(dir);
    dirEl.oncontextmenu = (e) => { e.preventDefault(); showDirContextMenu(e.clientX, e.clientY, dir); };
    container.appendChild(dirEl);

    if (!isCollapsed) {
      const children = paths.filter(p => p.startsWith(dir + '/'));
      renderDirGroup(container, children, dir, depth + 1);
    }
  }

  // Then files
  for (const file of files.sort()) {
    container.appendChild(makeFileItem(file, file.split('/').pop(), depth));
  }
}

function makeFileItem(path, name, depth) {
  const el = document.createElement('div');
  el.className = `tree-item ${modifiedFiles.has(path) ? 'modified' : ''} ${activeTab === path ? 'active' : ''}`;
  el.style.paddingLeft = `${14 + depth * 14}px`;
  el.dataset.path = path;
  el.innerHTML = `<span class="tree-icon">${fileIcon(name)}</span><span class="tree-name">${name}</span>`;
  el.onclick = () => openFile(path);
  el.oncontextmenu = (e) => { e.preventDefault(); showFileContextMenu(e.clientX, e.clientY, path, name); };
  return el;
}

function toggleDir(dir) {
  if (collapsedDirs.has(dir)) collapsedDirs.delete(dir);
  else collapsedDirs.add(dir);
  renderTree();
}

function collapseAll() {
  const dirs = Object.keys(dirHandles);
  dirs.forEach(d => collapsedDirs.add(d));
  renderTree();
}

function fileIcon(name) {
  if (name.endsWith('.ts') || name.endsWith('.tsx')) return '🔷';
  if (name.endsWith('.js') || name.endsWith('.jsx')) return '🟨';
  if (name.endsWith('.json')) return '📋';
  if (name.endsWith('.md')) return '📝';
  if (name.endsWith('.html')) return '🌐';
  if (name.endsWith('.css')) return '🎨';
  if (name.endsWith('.env') || name.startsWith('.')) return '⚙';
  if (name.endsWith('.sh')) return '⚡';
  if (name.endsWith('.yml') || name.endsWith('.yaml')) return '🔧';
  return '📄';
}

// ══════════════════════════════
//  FILE OPEN / EDIT / SAVE
// ══════════════════════════════
async function openFile(path) {
  const fileObj = fileHandles[path];

  // Load content if not cached — skip if content already exists (default project)
  if (fileContents[path] === undefined) {
    if (!fileObj) return; // no handle and no content, can't open
    try {
      fileContents[path] = await fileObj.text();
    } catch (err) {
      toast(`Cannot read file: ${err.message}`, 'error');
      return;
    }
  }

  // Add tab if not open
  if (!openTabs.find(t => t.path === path)) {
    openTabs.push({ path, name: path.split('/').pop() });
    renderTabs();
  }

  setActiveTab(path);

  // Passive VEX warning for large/compiled files
  const content = fileContents[path] || '';
  if (content) setTimeout(() => _fgWarnVex(path, content), 600);
}

function setActiveTab(path) {
  activeTab = path;

  // Show editor
  document.getElementById('editorPlaceholder').style.display = 'none';
  document.getElementById('editor').style.display = 'block';

  // Get or create model
  if (!editorModels[path]) {
    const lang = getLang(path);
    editorModels[path] = monaco.editor.createModel(fileContents[path] || '', lang);
  }

  editor.setModel(editorModels[path]);

  // Update UI
  renderTabs();
  updateTreeActive(path);
  const name = path.split('/').pop();
  document.getElementById('sbFile').textContent = `📄 ${name}`;
  document.getElementById('sbLang').textContent = getLang(path).toUpperCase();

  // Update scratch button visibility
  setTimeout(_updateScratchBtn, 50);
  setTimeout(_vexUpdateRegexBtn, 50);
  // Show preview button only for HTML files
  var prevBtn = document.getElementById('previewBtn');
  if (prevBtn) prevBtn.style.display = path.endsWith('.html') ? 'inline-flex' : 'none';
  // Close preview if switching to non-HTML
  if (!path.endsWith('.html') && previewOpen) togglePreview();
  // Update VEX context
  const ctxEl = document.getElementById('vexCtxFile');
  if (ctxEl) ctxEl.textContent = name;
  // Trigger VEX bubble
  triggerAIFileOpen(name);
}

function getLang(path) {
  if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript';
  if (path.endsWith('.js') || path.endsWith('.jsx')) return 'javascript';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.html')) return 'html';
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.md')) return 'markdown';
  if (path.endsWith('.yml') || path.endsWith('.yaml')) return 'yaml';
  if (path.endsWith('.sh')) return 'shell';
  return 'plaintext';
}

async function saveCurrentFile() {
  if (!activeTab) return;
  await saveFile(activeTab);
}

async function saveAllFiles() {
  for (const path of modifiedFiles) {
    await saveFile(path);
  }
  toast(`✓ All files saved`, 'success');
}

async function saveFile(path) {
  try {
    // Get current content from model
    let content;
    if (path === activeTab && editor && editor.getModel()) {
      content = editor.getModel().getValue();
    } else {
      const model = editorModels[path];
      content = model ? model.getValue() : (fileContents[path] || '');
    }

    // Download the file (can't write to disk inside an iframe)
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = path.split('/').pop();
    a.click();
    URL.revokeObjectURL(url);

    fileContents[path] = content;
    modifiedFiles.delete(path);

    updateTabModified(path);
    updateTreeModified(path);
    updateModifiedCount();
    termLog('success', `✓ Downloaded: ${path}`);
    toast(`✓ Downloaded ${path.split('/').pop()}`, 'success');
  } catch (err) {
    toast(`Save failed: ${err.message}`, 'error');
    termLog('error', `✗ Save failed: ${path} — ${err.message}`);
  }
}

// ══════════════════════════════
//  TABS
// ══════════════════════════════
function renderTabs() {
  const bar = document.getElementById('tabBar');
  bar.innerHTML = '';
  for (const tab of openTabs) {
    const el = document.createElement('div');
    el.className = `tab ${tab.path === activeTab ? 'active' : ''} ${modifiedFiles.has(tab.path) ? 'modified' : ''}`;
    el.innerHTML = `
      <span class="tree-icon" style="font-size:10px">${fileIcon(tab.name)}</span>
      <span class="tab-name">${tab.name}</span>
      <span class="tab-close" onclick="closeTab('${tab.path}',event)">✕</span>
    `;
    el.onclick = () => setActiveTab(tab.path);
    bar.appendChild(el);
  }
}

function deleteFile(path) {
  const name = path.split('/').pop();
  if (!confirm('Delete ' + name + '? This removes it from the workspace (not your disk).')) return;
  // Close tab if open
  if (openTabs.find(t => t.path === path)) {
    openTabs = openTabs.filter(t => t.path !== path);
    if (editorModels[path]) { editorModels[path].dispose(); delete editorModels[path]; }
    if (activeTab === path) {
      const next = openTabs[openTabs.length - 1];
      if (next) setActiveTab(next.path);
      else { activeTab = null; document.getElementById('editorPlaceholder').style.display = 'flex'; document.getElementById('editor').style.display = 'none'; }
    }
    renderTabs();
  }
  // Remove from file lists
  delete fileContents[path];
  delete fileHandles[path];
  modifiedFiles.delete(path);
  allFilePaths = allFilePaths.filter(p => p !== path);
  renderTree();
  toast('🗑 Deleted ' + name, 'success');
}

function closeTab(path, e) {
  e.stopPropagation();
  if (modifiedFiles.has(path)) {
    if (!confirm(`${path.split('/').pop()} has unsaved changes. Close anyway?`)) return;
  }
  openTabs = openTabs.filter(t => t.path !== path);
  if (editorModels[path]) {
    editorModels[path].dispose();
    delete editorModels[path];
  }
  if (activeTab === path) {
    const next = openTabs[openTabs.length - 1];
    if (next) setActiveTab(next.path);
    else {
      activeTab = null;
      document.getElementById('editorPlaceholder').style.display = 'flex';
      document.getElementById('editor').style.display = 'none';
    }
  }
  renderTabs();
}

function updateTabModified(path) {
  renderTabs();
}

function updateTreeActive(path) {
  document.querySelectorAll('.tree-item').forEach(el => {
    el.classList.toggle('active', el.dataset.path === path);
  });
}

function updateTreeModified(path) {
  document.querySelectorAll('.tree-item').forEach(el => {
    if (el.dataset.path === path) {
      el.classList.toggle('modified', modifiedFiles.has(path));
    }
  });
}

function updateModifiedCount() {
  const n = modifiedFiles.size;
  document.getElementById('sbModified').textContent = `${n} modified`;
}

// ══════════════════════════════
//  SEARCH
// ══════════════════════════════
let searchIdx = 0;
let searchMatches = [];

function openSearch() {
  document.getElementById('searchOverlay').classList.add('open');
  setTimeout(() => document.getElementById('searchInput').focus(), 50);
  filterSearch('');
}

function closeSearch() {
  document.getElementById('searchOverlay').classList.remove('open');
}

function filterSearch(q) {
  q = q.toLowerCase().trim();
  const paths = q
    ? allFilePaths.filter(p => p.toLowerCase().includes(q))
    : allFilePaths.slice(0, 50);

  searchMatches = paths.slice(0, 30);
  searchIdx = 0;

  const container = document.getElementById('searchResults');
  container.innerHTML = '';
  for (let i = 0; i < searchMatches.length; i++) {
    const p = searchMatches[i];
    const el = document.createElement('div');
    el.className = `search-result ${i === 0 ? 'active' : ''}`;
    const parts = p.split('/');
    const name = parts.pop();
    const dir = parts.join('/');
    el.innerHTML = `
      <span style="font-size:12px">${fileIcon(name)}</span>
      <div>
        <div>${name}</div>
        <div class="search-result-path">${dir}</div>
      </div>
    `;
    el.onclick = () => { openFile(p); closeSearch(); };
    container.appendChild(el);
  }
}

function handleSearchKey(e) {
  if (e.key === 'Escape') { closeSearch(); return; }
  if (e.key === 'ArrowDown') {
    searchIdx = Math.min(searchIdx + 1, searchMatches.length - 1);
  } else if (e.key === 'ArrowUp') {
    searchIdx = Math.max(searchIdx - 1, 0);
  } else if (e.key === 'Enter') {
    if (searchMatches[searchIdx]) {
      openFile(searchMatches[searchIdx]);
      closeSearch();
    }
    return;
  } else return;

  document.querySelectorAll('.search-result').forEach((el, i) => {
    el.classList.toggle('active', i === searchIdx);
    if (i === searchIdx) el.scrollIntoView({ block: 'nearest' });
  });
}

// ══════════════════════════════
//  TERMINAL
// ══════════════════════════════
function termLog(type, text) {
  const body = document.getElementById('termBody');
  const el = document.createElement('div');
  el.className = `t-${type}`;
  el.textContent = text;
  body.appendChild(el);
  body.scrollTop = body.scrollHeight;
}

function handleTermKey(e) {
  if (e.key === 'Enter') {
    const input = document.getElementById('termInput');
    const val = input.value.trim();
    if (!val) return;
    input.value = '';

    const el = document.createElement('div');
    el.className = 't-line';
    el.innerHTML = `<span class="t-prompt">studio:~$</span><span class="t-cmd">${escHtml(val)}</span>`;
    document.getElementById('termBody').appendChild(el);

    // ── Built-in commands ──
    const cmd = val.toLowerCase().trim();

    if (cmd === 'open' || cmd === 'open folder' || cmd === 'open .') {
      termLog('info', '📂 Opening folder picker…');
      openFolder();
    }
    else if (
      cmd === 'close' || cmd === 'close folder' ||
      cmd === 'rm -rf .' || cmd === 'rm -rf *' ||
      cmd === 'delete folder' || cmd === 'clear folder' ||
      cmd === 'reset'
    ) {
      if (activeWsId) closeWorkspace(activeWsId);
      else termLog('warn', '⚠ No folder is open.');
    }
    else if (cmd === 'clear' || cmd === 'cls') {
      clearTerm();
    }
    else if (cmd === 'ls' || cmd === 'dir') {
      if (!allFilePaths.length) {
        termLog('warn', '⚠ No folder open. Run: open');
      } else {
        const roots = [...new Set(allFilePaths.map(p => p.split('/')[0]))].sort();
        roots.forEach(r => termLog('out', `  ${r}`));
        termLog('info', `${allFilePaths.length} total files`);
      }
    }
    else if (cmd === 'help' || cmd === '?') {
      termLog('info', 'Built-in commands:');
      termLog('out',  '  open          — open a folder');
      termLog('out',  '  close         — close current folder');
      termLog('out',  '  rm -rf .      — close current folder');
      termLog('out',  '  ls / dir      — list root entries');
      termLog('out',  '  clear / cls   — clear terminal');
      termLog('warn', '⚠ Other commands must be run in your system terminal.');
    }
    else {
      termLog('warn', '⚠ Run in your system terminal. Type "help" for built-in commands.');
    }

    document.getElementById('termBody').scrollTop = 99999;
  }
}

function toggleTerminal() {
  termOpen = !termOpen;
  document.getElementById('terminalPanel').classList.toggle('collapsed', !termOpen);
}

function copyTermOutput() {
  const text = document.getElementById('termBody').innerText;
  navigator.clipboard.writeText(text).then(() => toast('📋 Terminal copied'));
}

function clearTerm() {
  document.getElementById('termBody').innerHTML =
    '<div class="t-info">ℹ Terminal cleared</div>';
}

// ══════════════════════════════
//  AI PANEL
// ══════════════════════════════
//  VEX ROBOT AI ENGINE
// ══════════════════════════════
(function() {
  const vc = document.getElementById('vexC');
  const vBot = document.getElementById('vexBot');
  const vGlow = document.getElementById('vexGlow');
  let vDrag = false, vSX=0, vSY=0, vIX=0, vIY=0;

  vc.addEventListener('mousedown', e => {
    if (!e.target.closest('.vex-robot')) return;
    let moved = false;
    const r = vc.getBoundingClientRect();
    vSX=e.clientX; vSY=e.clientY; vIX=r.left; vIY=r.top;
    const mm = ev => {
      const dx=ev.clientX-vSX, dy=ev.clientY-vSY;
      if (!moved && Math.abs(dx)<4 && Math.abs(dy)<4) return;
      moved=true; vDrag=true; vc.classList.add('dragging');
      let x=Math.max(0,Math.min(window.innerWidth-100,vIX+dx));
      let y=Math.max(0,Math.min(window.innerHeight-115,vIY+dy));
      vc.style.right='auto'; vc.style.bottom='auto';
      vc.style.left=x+'px'; vc.style.top=y+'px';
    };
    const mu=()=>{ document.removeEventListener('mousemove',mm); document.removeEventListener('mouseup',mu); setTimeout(()=>vDrag=false,50); };
    document.addEventListener('mousemove',mm);
    document.addEventListener('mouseup',mu);
  });

  window.vexState = function(state, duration) {
    vc.classList.remove('vex-active','vex-celebrate','vex-thinking');
    if (state) vc.classList.add('vex-'+state);
    if (duration) setTimeout(()=>{ vc.classList.remove('vex-'+state); if(vexChatOpen)vc.classList.add('vex-active'); }, duration);
  };
  window.vexCelebrate = ()=>vexState('celebrate',700);
  window.vexThink = ()=>vexState('thinking');

  vBot.addEventListener('click', e=>{
    if (vDrag) return;
    vBot.classList.add('happy','clicked');
    vGlow.classList.add('bright');
    setTimeout(()=>{ vBot.classList.remove('happy','clicked'); vGlow.classList.remove('bright'); },400);
    vexToggleChat();
  });

  const vBub = document.getElementById('vexBubble');
  vBub.addEventListener('click', ()=>{
    const p=vBub._prefill;
    vBub.classList.remove('show');
    if(!vexChatOpen) vexToggleChat();
    if(p) setTimeout(()=>{ const i=document.getElementById('vexInput'); i.value=p; i.focus(); },250);
  });
})();

let vBubTimer=null;
function vexShowBubble(text,prefill){
  const b=document.getElementById('vexBubble');
  b.textContent=text; b._prefill=prefill||null;
  b.classList.add('show');
  clearTimeout(vBubTimer);
  vBubTimer=setTimeout(()=>b.classList.remove('show'),7000);
}

function vexToggleChat(){
  vexChatOpen=!vexChatOpen;
  document.getElementById('vexChat').classList.toggle('open',vexChatOpen);
  if(vexChatOpen){
    vexState('active');
    if(document.getElementById('vexBody').children.length===0) vexWelcome();
    setTimeout(()=>{ document.getElementById('vexInput').focus(); if(window._vexSyncChatPos) _vexSyncChatPos(); },50);
  } else {
    vexState(null);
  }
}

function toggleAI(){ vexToggleChat(); }
function openAI(msg,prefill){ if(!vexChatOpen)vexToggleChat(); if(prefill)setTimeout(()=>{ document.getElementById('vexInput').value=prefill; },250); }
function closeAI(){ if(vexChatOpen)vexToggleChat(); }

// ══════════════════════════════
//  REGEX SCANNER — deterministic, zero AI
// ══════════════════════════════

let _vexRegexDecorations = null; // Monaco decoration collection

function _vexUpdateRegexBtn() {
  const btn = document.getElementById('vexRegexBtn');
  if (!btn) return;
  const path = activeTab || '';
  // Show for code files only
  const isCode = /\.(js|ts|jsx|tsx|html|vue|py|rb|go|java|cs|php|rs|swift|kt|c|cpp|h)$/.test(path);
  btn.style.display = isCode ? '' : 'none';
}

function vexScanRegex() {
  const path = activeTab;
  if (!path) { vexAddMsg('⚠ No file open.', 'bot'); return; }

  const w = ws();
  const content = (w && w.editorModels[path]) ? w.editorModels[path].getValue()
    : (w && w.fileContents[path]) || (editor && editor.getModel() ? editor.getModel().getValue() : '');

  if (!content.trim()) { vexAddMsg('⚠ File is empty.', 'bot'); return; }

  // ── Find all regex ──
  const hits = [];
  const lines = content.split('\n');

  lines.forEach((line, lineIdx) => {
    // 1. Literal regex:  /pattern/flags  (skip // comments and URLs)
    const litRe = /(?<![:/])\/(?![/*\s])([^\/\n\\]|\\.)+\/[gimsuy]*/g;
    let m;
    while ((m = litRe.exec(line)) !== null) {
      hits.push({
        line: lineIdx + 1,
        col: m.index + 1,
        colEnd: m.index + m[0].length + 1,
        raw: m[0],
        type: 'literal'
      });
    }

    // 2. new RegExp('...') or new RegExp("...")
    const newRe = /new\s+RegExp\s*\(\s*(['"`])([^'"` ]+)\1\s*(?:,\s*['"`]([gimsuy]+)['"`])?\s*\)/g;
    while ((m = newRe.exec(line)) !== null) {
      const pat = '/' + m[2] + '/' + (m[3] || '');
      hits.push({
        line: lineIdx + 1,
        col: m.index + 1,
        colEnd: m.index + m[0].length + 1,
        raw: pat,
        type: 'new RegExp'
      });
    }
  });

  // ── Clear old decorations ──
  if (_vexRegexDecorations) { _vexRegexDecorations.clear(); _vexRegexDecorations = null; }

  if (hits.length === 0) {
    vexAddMsg('No regex found in <code>' + path.split('/').pop() + '</code>.', 'bot');
    return;
  }

  // ── Highlight in Monaco ──
  const decorations = hits.map(h => ({
    range: new monaco.Range(h.line, h.col, h.line, h.colEnd),
    options: {
      inlineClassName: 'vex-regex-highlight',
      hoverMessage: { value: '🔍 **Regex** `' + h.raw + '`  (' + h.type + ')' }
    }
  }));
  _vexRegexDecorations = editor.createDecorationsCollection(decorations);

  // ── Render results in chat ──
  if (!vexChatOpen) vexToggleChat();
  const body = document.getElementById('vexBody');

  const hdr = document.createElement('div');
  hdr.className = 'vex-ws-msg bot';
  hdr.innerHTML = '🔍 Found <b>' + hits.length + ' regex pattern' + (hits.length === 1 ? '' : 's') + '</b>'
    + ' in <code>' + path.split('/').pop() + '</code> — click to jump:';
  body.appendChild(hdr);

  hits.forEach(h => {
    const row = document.createElement('div');
    row.className = 'vex-regex-hit';
    row.title = 'Jump to line ' + h.line;
    row.innerHTML = '<span class="rh-line">L' + h.line + '</span>'
      + '<span class="rh-pat">' + h.raw.replace(/</g,'&lt;') + '</span>'
      + '<span class="rh-type">' + h.type + '</span>';
    row.onclick = () => {
      editor.revealLineInCenter(h.line);
      editor.setPosition({ lineNumber: h.line, column: h.col });
      editor.focus();
    };
    body.appendChild(row);
  });

  const clear = document.createElement('button');
  clear.textContent = '✕ Clear highlights';
  clear.style.cssText = 'margin-top:6px;padding:3px 10px;border-radius:5px;border:1px solid #334455;background:none;color:#556677;cursor:pointer;font-size:10px';
  clear.onclick = () => {
    if (_vexRegexDecorations) { _vexRegexDecorations.clear(); _vexRegexDecorations = null; }
    clear.textContent = '✓ Cleared';
    clear.disabled = true;
  };
  body.appendChild(clear);
  body.scrollTop = body.scrollHeight;
}



function triggerAIFileOpen(filename){
  const el=document.getElementById('vexCtxFile');
  if(el) el.textContent=filename;
  const isHtml = filename.endsWith('.html');
  const isTsx = filename.endsWith('.tsx') || filename.endsWith('.ts') || filename.endsWith('.jsx');

  // Auto-detect inline CSS in TSX files — offer to fix
  if (isTsx && activeTab) {
    var content = fileContents[activeTab] || '';
    var hasStyleBlock = /<style[\s>]/i.test(content);
    if (hasStyleBlock) {
      // Show bubble immediately
      vexShowBubble('⚠ Inline CSS detected — Fix it?', null);
      // If chat is open, show fix prompt
      if (vexChatOpen) {
        vexShowTsxFixPrompt(filename);
      } else {
        // Open chat and show fix prompt after delay
        setTimeout(function(){
          if(!vexChatOpen) vexToggleChat();
          setTimeout(function(){ vexShowTsxFixPrompt(filename); }, 300);
        }, 600);
      }
      return;
    }
  }

  if(vexChatOpen){
    if(isHtml) vexShowHtmlActions(filename);
    return;
  }
  vexShowBubble('Opened '+filename, isHtml ? null : 'Explain this file: '+filename);
  if(isHtml){
    setTimeout(function(){
      if(!vexChatOpen) vexToggleChat();
      setTimeout(function(){ vexShowHtmlActions(filename); }, 300);
    }, 400);
  }
}

function vexShowHtmlActions(filename){
  document.querySelectorAll('.vex-html-actions').forEach(function(el){ el.remove(); });
  var body = document.getElementById('vexBody');
  if(!body) return;
  var note = document.createElement('div');
  note.className = 'vex-msg bot vex-html-actions';
  note.innerHTML = 'Opened <code>' + filename + '</code> — what would you like to do?';
  body.appendChild(note);
  var wrap = document.createElement('div');
  wrap.className = 'vex-html-actions';
  wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;padding:4px 10px 8px';
  var btns = [
    {label:'📖 Explain', fn:function(){ document.getElementById('vexInput').value='Explain this file in detail'; vexSend(); }},
    {label:'🐛 Find issues', fn:function(){ document.getElementById('vexInput').value='Find all bugs and issues'; vexSend(); }},
    {label:'🌐 Extract strings', fn:function(){ openTransPanel(activeTab); }},
    {label:'💉 Inject translation', fn:function(){ openTransPanel(activeTab); }},
  ];
  btns.forEach(function(b){
    var btn = document.createElement('button');
    btn.textContent = b.label;
    btn.style.cssText = 'background:#15202b;border:1px solid #1e3044;color:#c8c8e0;border-radius:20px;padding:5px 11px;font-size:11px;cursor:pointer;font-family:"IBM Plex Sans",sans-serif;white-space:nowrap;transition:all 0.15s';
    btn.onmouseenter=function(){ btn.style.borderColor='#d4a853'; btn.style.color='#d4a853'; };
    btn.onmouseleave=function(){ btn.style.borderColor='#1e3044'; btn.style.color='#c8c8e0'; };
    btn.onclick=function(){ b.fn(); };
    wrap.appendChild(btn);
  });
  body.appendChild(wrap);
  body.scrollTop = body.scrollHeight;
}
let vEditTimer=null;
function vexShowTsxFixPrompt(filename) {
  document.querySelectorAll('.vex-tsx-fix').forEach(function(el){ el.remove(); });
  var body = document.getElementById('vexBody');
  if(!body) return;

  var note = document.createElement('div');
  note.className = 'vex-msg bot vex-tsx-fix';
  note.innerHTML = '⚠ <b>' + filename + '</b> has inline <code>&lt;style&gt;</code> blocks — that\'s why Monaco shows red.<br><br>I can extract them into a proper <code>page.module.css</code> file automatically.';
  body.appendChild(note);

  var wrap = document.createElement('div');
  wrap.className = 'vex-tsx-fix';
  wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;padding:4px 10px 8px';

  var fixBtn = document.createElement('button');
  fixBtn.textContent = '✨ Fix it — extract CSS';
  fixBtn.style.cssText = 'background:linear-gradient(135deg,#d4a853,#c9973f);border:none;color:#0a1628;border-radius:20px;padding:6px 14px;font-size:11px;cursor:pointer;font-family:"IBM Plex Sans",sans-serif;font-weight:700;white-space:nowrap';
  fixBtn.onclick = function() {
    wrap.remove();
    note.remove();
    vexFixTsxCss(activeTab);
  };

  var skipBtn = document.createElement('button');
  skipBtn.textContent = 'Leave as-is';
  skipBtn.style.cssText = 'background:#15202b;border:1px solid #1e3044;color:#556677;border-radius:20px;padding:6px 11px;font-size:11px;cursor:pointer;font-family:"IBM Plex Sans",sans-serif;white-space:nowrap';
  skipBtn.onclick = function() { wrap.remove(); note.remove(); };

  wrap.appendChild(fixBtn);
  wrap.appendChild(skipBtn);
  body.appendChild(wrap);
  body.scrollTop = body.scrollHeight;
}

function triggerAIEdit(filename){
  if(vexChatOpen) return;
  clearTimeout(vEditTimer);
  vEditTimer=setTimeout(()=>vexShowBubble('Editing '+filename+' — need help?',null),6000);
}
function triggerAIAction(action,filename){
  const p={explain:'Explain in detail: '+filename,issues:'Find all bugs in: '+filename,refactor:'Refactor for better performance: '+filename,tests:'Write tests for: '+filename,connections:'How does '+filename+' connect to the repo?'};
  if(!vexChatOpen) vexToggleChat();
  setTimeout(()=>{ const i=document.getElementById('vexInput'); i.value=p[action]||'Help with '+filename; i.focus(); },250);
}

function showDirContextMenu(x, y, dir) {
  document.querySelectorAll('.ctx-menu').forEach(function(m){ m.remove(); });
  var menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.cssText = 'position:fixed;z-index:99999;background:#0f1923;border:1px solid #1e3044;border-radius:8px;padding:4px 0;font-family:"IBM Plex Sans",sans-serif;font-size:11px;min-width:160px;box-shadow:0 8px 24px rgba(0,0,0,.6)';
  menu.style.left = Math.min(x, window.innerWidth - 170) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - 120) + 'px';
  var items = [
    {icon: '+', label: 'New file here', a: function(){ newFilePrompt(dir); }},
    {icon: 'x', label: 'Delete folder', a: function(){ deleteFolderConfirm(dir); }},
  ];
  items.forEach(function(item) {
    var el = document.createElement('div');
    el.style.cssText = 'padding:7px 14px;cursor:pointer;color:#c8c8e0;display:flex;align-items:center;gap:8px;';
    el.innerHTML = '<span>' + item.icon + '</span><span>' + item.label + '</span>';
    el.onmouseenter = function(){ el.style.background='#15202b'; el.style.color='#d4a853'; };
    el.onmouseleave = function(){ el.style.background=''; el.style.color='#c8c8e0'; };
    el.onclick = function(){ menu.remove(); item.a(); };
    menu.appendChild(el);
  });
  document.body.appendChild(menu);
  setTimeout(function(){ document.addEventListener('click', function(){ menu.remove(); }, {once:true}); }, 50);
}

function deleteFolderConfirm(dir) {
  var files = allFilePaths.filter(function(p){ return p === dir || p.startsWith(dir + '/'); });
  if (!confirm('Delete folder "' + dir.split('/').pop() + '" and ' + files.length + ' file(s) from workspace?')) return;
  files.forEach(function(p) {
    if (openTabs.find(function(t){ return t.path === p; })) {
      openTabs = openTabs.filter(function(t){ return t.path !== p; });
      if (editorModels[p]) { editorModels[p].dispose(); delete editorModels[p]; }
    }
    delete fileContents[p];
    delete fileHandles[p];
    modifiedFiles.delete(p);
  });
  allFilePaths = allFilePaths.filter(function(p){ return p !== dir && !p.startsWith(dir + '/'); });
  if (files.indexOf(activeTab) !== -1) {
    activeTab = null;
    var next = openTabs[openTabs.length - 1];
    if (next) setActiveTab(next.path);
    else {
      document.getElementById('editorPlaceholder').style.display = 'flex';
      document.getElementById('editor').style.display = 'none';
    }
  }
  renderTabs();
  renderTree();
  toast('Deleted ' + dir.split('/').pop(), 'success');
}


function showFileContextMenu(x,y,path,name){
  const old=document.getElementById('vexCtxMenu');
  if(old) old.remove();
  const menu=document.createElement('div');
  menu.id='vexCtxMenu';
  menu.style.cssText='position:fixed;left:'+x+'px;top:'+y+'px;z-index:9999;background:#0f1923;border:1px solid #1e3044;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,.7);padding:4px 0;min-width:190px;font-family:"IBM Plex Sans",sans-serif;font-size:11px';
  [{icon:'📖',label:'Explain with VEX',a:()=>triggerAIAction('explain',name)},{icon:'🐛',label:'Find Issues',a:()=>triggerAIAction('issues',name)},{icon:'⚡',label:'Refactor',a:()=>triggerAIAction('refactor',name)},{icon:'🧪',label:'Write Tests',a:()=>triggerAIAction('tests',name)},{icon:'🔗',label:'Connections',a:()=>triggerAIAction('connections',name)},null,...(name.endsWith('.html')?[{icon:'🌐',label:'Extract strings',a:()=>extractStrings(path)},{icon:'💉',label:'Inject translation',a:()=>injectTranslationPrompt(path)},null]:[]),{icon:'📄',label:'Open File',a:()=>openFile(path)},{icon:'🗑',label:'Delete from workspace',a:()=>deleteFile(path)}].forEach(item=>{
    if(!item){const s=document.createElement('div');s.style.cssText='height:1px;background:#1e3044;margin:3px 0';menu.appendChild(s);return;}
    const row=document.createElement('div');
    row.style.cssText='padding:7px 14px;cursor:pointer;color:#8899aa;display:flex;align-items:center;gap:8px';
    row.innerHTML='<span>'+item.icon+'</span><span>'+item.label+'</span>';
    row.onmouseenter=()=>{row.style.background='#15202b';row.style.color='#d4a853';};
    row.onmouseleave=()=>{row.style.background='';row.style.color='#8899aa';};
    row.onclick=()=>{menu.remove();item.a();};
    menu.appendChild(row);
  });
  document.body.appendChild(menu);
  setTimeout(()=>{const c=e=>{if(!menu.contains(e.target)){menu.remove();document.removeEventListener('mousedown',c);}};document.addEventListener('mousedown',c);},0);
}

function vexSaveKey(val){
  localStorage.setItem('vex_studio_key',val);
  const k=document.getElementById('vexKey');
  if(k) k.style.borderColor=val.startsWith('sk-ant-')?'rgba(74,222,128,.4)':'#1e3044';
}
function vexGetKey(){
  const k=document.getElementById('vexKey');
  return (k?k.value.trim():'')||localStorage.getItem('vex_studio_key')||'';
}
function saveKey(v){ vexSaveKey(v); }

function vexPasteFile(){
  if(!activeTab) return;
  const model=editorModels[activeTab];
  const txt=model?model.getValue():fileContents[activeTab]||'';
  const name=activeTab.split('/').pop();
  const inp=document.getElementById('vexInput');
  inp.value='Here is '+name+':\n```\n'+txt.slice(0,3000)+(txt.length>3000?'\n...(truncated)':'')+' \n```\n\nPlease analyze this.';
  inp.focus();
}
function pasteFileToChat(){ vexPasteFile(); }

function vexAddMsg(html,type){
  type=type||'bot';
  const d=document.createElement('div');
  d.className='vex-msg '+type;
  d.innerHTML=html;
  const b=document.getElementById('vexBody');
  b.appendChild(d);
  b.scrollTop=b.scrollHeight;
  return d;
}
function vexAddBtns(btns){
  const wrap=document.createElement('div');
  wrap.className='vex-btns';
  btns.forEach(b=>{
    const btn=document.createElement('button');
    btn.className='vex-btn';
    btn.textContent=b.label;
    btn.onclick=()=>{vexAddMsg(b.label,'user');wrap.remove();vexCelebrate();setTimeout(()=>b.action(),250);};
    wrap.appendChild(btn);
  });
  const body=document.getElementById('vexBody');
  body.appendChild(wrap);
  body.scrollTop=body.scrollHeight;
}

function vexFormatReply(text){
  return text
    .replace(/```(\w+)?\n([\s\S]*?)```/g,(_,lang,code)=>'<pre><code>'+escHtml(code.trim())+'</code></pre>')
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\n/g,'<br>');
}

function vexWelcome(){
  const fname=activeTab?activeTab.split('/').pop():null;
  vexAddMsg('👋 Hey! I\'m <b>VEX</b>, your IDE assistant.<br><br>I see your open files, repo structure, and know VEX architecture.'+(fname?'<br><br>Currently in: <code>'+fname+'</code>':'<br><br>Open a file to give me context.'));
  vexAddBtns([
    {label:'📖 Explain file',action:()=>{document.getElementById('vexInput').value='Explain this file in detail';vexSend();}},
    {label:'🐛 Find issues',action:()=>{document.getElementById('vexInput').value='Find all bugs and issues';vexSend();}},
    {label:'⚡ Refactor',action:()=>{document.getElementById('vexInput').value='Refactor for better performance';vexSend();}},
    {label:'🔗 Connections',action:()=>{document.getElementById('vexInput').value='How does this connect to the rest of the repo?';vexSend();}},
  ]);
  vexAddBtns([
    {label:'🧪 Write tests',action:()=>{document.getElementById('vexInput').value='Write comprehensive tests for this code';vexSend();}},
    {label:'📄 Paste file',action:vexPasteFile},
  ]);
}

function vexSend(){
  if(vexTyping) return;
  const inp=document.getElementById('vexInput');
  const msg=inp.value.trim();
  if(!msg) return;
  inp.value='';
  vexAddMsg(msg,'user');
  vexHistory.push({role:'user',content:msg});
  vexCelebrate();
  const key=vexGetKey();
  if(!key){ vexAddMsg('⚙ Paste your Anthropic API key at the bottom to activate VEX.'); return; }
  vexTyping=true;
  vexThink();
  const body=document.getElementById('vexBody');
  const tel=document.createElement('div');
  tel.className='vex-msg bot';
  tel.innerHTML='<div class="vex-typing"><span></span><span></span><span></span></div>';
  body.appendChild(tel); body.scrollTop=body.scrollHeight;
  const fileCtx=activeTab&&editorModels[activeTab]?editorModels[activeTab].getValue().slice(0,800):'';
  const repoFiles=Object.keys(editorModels).map(p=>p.split('/').pop()).slice(0,20).join(', ')||'none';
  const allPaths=allFilePaths.slice(0,60).join('\n')||'(no repo)';
  const fileCode=fileCtx?('```\n'+fileCtx+'\n```'):'(no file open)';
  const sys=['You are VEX — the AI layer of VEX Studio IDE. Technical, concise, direct.',
    'VEX: vex-core (registry/agents), vex-tools (seo/analytics/content), vex-agents (orchestration), vex-dashboard (React)',
    'ToolFn=(args:{input:unknown;ctx:ExecutionContext})=>Promise<unknown>',
    "registry.register('domain.name',fn) — always update registerTools.ts",
    'Patterns: deterministic/ | simple-agent/ | hybrid-tool/',
    'File: '+(activeTab||'none'),'Preview: '+fileCode,'Tabs: '+repoFiles,'Repo: '+allPaths,
    'Use ```ts blocks. Reference filenames. Point bugs out. Short unless full impl requested.'
  ].join('\n');
  fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
    body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:1500,system:sys,messages:vexHistory.slice(-12)})
  }).then(r=>r.json()).then(data=>{
    tel.remove();
    if(data.error){ vexAddMsg('❌ '+(data.error.message||'API error')); }
    else { const r=data.content?.[0]?.text||'No response'; vexHistory.push({role:'assistant',content:r}); vexAddMsg(vexFormatReply(r)); vexCelebrate(); }
    vexTyping=false;
    if(vexChatOpen) vexState('active');
  }).catch(err=>{ tel.remove(); vexAddMsg('❌ '+err.message); vexTyping=false; if(vexChatOpen)vexState('active'); });
}

// ══════════════════════════════
//  STRING EXTRACTION
// ══════════════════════════════
function extractStrings(path) {
  var content = fileContents[path];
  if (!content) { toast('Open the file first', 'error'); return; }

  // Parse HTML in a temporary DOM
  var parser = new DOMParser();
  var doc = parser.parseFromString(content, 'text/html');

  var strings = {};
  var skipTags = new Set(['script','style','meta','link','head','noscript','template']);
  var counter = {};

  function makeKey(text, tag) {
    // slugify text to a key
    var slug = text.toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 32);
    if (!slug) return null;
    var tag_prefix = tag || 'text';
    var base = tag_prefix + '.' + slug;
    if (!counter[base]) { counter[base] = 1; return base; }
    return base + '_' + (++counter[base]);
  }

  function walk(node) {
    if (node.nodeType === 3) { // text node
      var text = node.textContent.trim();
      if (text.length < 2) return;
      if (/^[\d\s\.,!?:;\-_/]+$/.test(text)) return; // skip pure numbers/punctuation
      var parent = node.parentElement;
      if (!parent || skipTags.has(parent.tagName.toLowerCase())) return;
      var tag = parent.tagName.toLowerCase();
      var key = makeKey(text, tag);
      if (key) strings[key] = text;
    } else if (node.nodeType === 1) {
      if (skipTags.has(node.tagName.toLowerCase())) return;
      // Also check placeholder, title, alt attributes
      ['placeholder','title','alt','aria-label'].forEach(function(attr){
        var val = node.getAttribute(attr);
        if (val && val.trim().length > 1) {
          var key = makeKey(val.trim(), attr);
          if (key) strings[key] = val.trim();
        }
      });
      node.childNodes.forEach(walk);
    }
  }

  walk(doc.body);

  var count = Object.keys(strings).length;
  if (count === 0) { toast('No strings found in this file', 'error'); return; }

  var json = JSON.stringify(strings, null, 2);
  var blob = new Blob([json], {type:'application/json'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'en.json'; a.click();
  URL.revokeObjectURL(url);

  // Store for later injection reference
  window._lastExtractedStrings = strings;
  window._lastExtractedFrom = path;

  toast('\u2713 Extracted ' + count + ' strings to en.json', 'success');

  // Offer next step in VEX chat
  if (!vexChatOpen) vexToggleChat();
  setTimeout(function(){
    vexAddMsg('Extracted <b>' + count + ' strings</b> from <code>' + path.split('/').pop() + '</code> into <b>en.json</b>.<br><br>Now take it to <b>VEX Translate Studio</b> to generate translations.<br><br>When you come back with <code>hi.json</code>, <code>es.json</code> etc — add them here and I will inject with a language switcher.');
  }, 300);
}

function injectTranslationPrompt(htmlPath) {
  // Find JSON files in workspace that could be translations
  var jsonFiles = allFilePaths.filter(function(p){
    var name = p.split('/').pop();
    return name.endsWith('.json') && /^[a-z]{2}\.json$/.test(name) && name !== 'en.json';
  });
  if (!vexChatOpen) vexToggleChat();
  setTimeout(function(){
    if (jsonFiles.length === 0) {
      vexAddMsg('No translation JSON files found in workspace.<br><br>Add a file like <code>hi.json</code> or <code>es.json</code> using the <b>Add Files</b> button first.');
    } else {
      vexAddMsg('Which translation should I inject into <code>' + htmlPath.split('/').pop() + '</code>?');
      vexAddBtns(jsonFiles.map(function(p){
        var langCode = p.split('/').pop().replace('.json','');
        return {
          label: langCode.toUpperCase() + ' (' + p.split('/').pop() + ')',
          action: function(){
            try {
              var parsed = JSON.parse(fileContents[p] || '{}');
              injectTranslationFromJSON(htmlPath, langCode, parsed);
            } catch(e) {
              vexAddMsg('Could not parse ' + p + ': ' + e.message);
            }
          }
        };
      }));
    }
  }, 300);
}

async function injectTranslationFromJSON(htmlPath, langCode, translations) {
  var key = vexGetKey();
  if (!key) { vexAddMsg('\u2699 Add your API key first.'); return; }

  var html = fileContents[htmlPath];
  if (!html) { vexAddMsg('Open ' + htmlPath + ' first.'); return; }

  vexAddMsg('Injecting <b>' + langCode.toUpperCase() + '</b> into <code>' + htmlPath.split('/').pop() + '</code>...');
  vexThink();
  vexTyping = true;

  var existingLangs = window._injectedLangs || {};
  existingLangs[langCode] = translations;

  // Check if file already has our switcher
  var hasInjection = html.includes('__VEX_LANGS__');

  var prompt;
  if (hasInjection) {
    // Just update the LANGS object
    prompt = 'This HTML file already has a VEX language switcher. The LANGS object is defined as window.__VEX_LANGS__. Update only the LANGS data to add or update the "' + langCode + '" key. Current translations to add: ' + JSON.stringify(translations) + '\n\nReturn ONLY the full updated HTML, no explanation.';
  } else {
    // Fresh injection - AI picks placement
    var switcherHtml = [
      '<div id="__vex_lang_switcher" style="position:fixed;top:12px;right:12px;z-index:9999;font-family:sans-serif">',
      '  <button id="__vex_lang_btn" onclick="var u=this.parentElement.querySelector(\'ul\');u.style.display=u.style.display===\'none\'?\'block\':\'none\'" style="background:#1a1a2e;color:#d4a853;border:1px solid #d4a853;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px;font-weight:700">EN</button>',
      '  <ul style="display:none;position:absolute;right:0;top:30px;background:#1a1a2e;border:1px solid #d4a853;border-radius:6px;list-style:none;padding:4px 0;margin:0;min-width:60px">',
      '    <li onclick="__vexApplyLang(\'en\');this.closest(\'ul\').style.display=\'none\'" style="padding:6px 14px;cursor:pointer;color:#c8c8e0;font-size:12px">EN</li>',
      '    <li onclick="__vexApplyLang(\'' + langCode + '\');this.closest(\'ul\').style.display=\'none\'" style="padding:6px 14px;cursor:pointer;color:#c8c8e0;font-size:12px">' + langCode.toUpperCase() + '</li>',
      '  </ul>',
      '</div>'
    ].join('\n');
    var langsObj = 'window.__VEX_LANGS__ = { en: {}, ' + langCode + ': ' + JSON.stringify(translations) + ' };';
    prompt = 'You are injecting a multilingual language switcher into an HTML app or game.\n\n'
           + 'Here is the HTML file (first 4000 chars):\n'
           + html.slice(0, 4000)
           + '\n\n---\n\n'
           + 'Translation JSON for language code "' + langCode + '":\n'
           + JSON.stringify(translations).slice(0, 800)
           + '\n\n---\n\n'
           + 'INSTRUCTIONS:\n'
           + '1. Add this exact script block immediately after the opening <body> tag:\n'
           + '<script>\n'
           + langsObj + '\n'
           + 'window.__VEX_ACTIVE_LANG__ = "en";\n'
           + 'function __vexT(key){ return (window.__VEX_LANGS__[window.__VEX_ACTIVE_LANG__]||{})[key]||(window.__VEX_LANGS__.en||{})[key]||key; }\n'
           + 'function __vexApplyLang(lang){ window.__VEX_ACTIVE_LANG__=lang; document.querySelectorAll("[data-i18n]").forEach(function(el){el.textContent=__vexT(el.dataset.i18n);}); var btn=document.getElementById("__vex_lang_btn"); if(btn)btn.textContent=lang.toUpperCase(); }\n'
           + '<\/script>\n\n'
           + '2. For each text node that matches a value in the translation JSON, add a data-i18n="key" attribute to its parent element.\n\n'
           + '3. Inject this language switcher in the most natural visible position (avoid overlapping main content):\n'
           + switcherHtml
           + '\n\nReturn ONLY the complete modified HTML file. No markdown fences. No explanation.';
  }

  var body = document.getElementById('vexBody');
  var tel = document.createElement('div');
  tel.className = 'vex-msg bot';
  tel.innerHTML = '<div class="vex-typing"><span></span><span></span><span></span></div>';
  body.appendChild(tel); body.scrollTop = body.scrollHeight;

  fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
    body: JSON.stringify({model:'claude-sonnet-4-20250514', max_tokens:4096, messages:[{role:'user',content:prompt}]})
  }).then(function(r){ return r.json(); }).then(function(data){
    tel.remove();
    vexTyping = false;
    if (vexChatOpen) vexState('active');
    if (data.error) { vexAddMsg('Error: ' + (data.error.message||'API error')); return; }

    var newHtml = (data.content?.[0]?.text || '').trim();
    // Strip markdown fences if present
    newHtml = newHtml.replace(/^```html\s*/i,'').replace(/^```\s*/i,'').replace(/\s*```$/,'').trim();

    if (!newHtml.includes('<html') && !newHtml.includes('<!DOCTYPE')) {
      vexAddMsg('Could not parse the injected HTML. Try again or check the file.');
      return;
    }

    // Save back to workspace
    fileContents[htmlPath] = newHtml;
    if (editorModels[htmlPath]) {
      editorModels[htmlPath].setValue(newHtml);
    }
    modifiedFiles.add(htmlPath);
    updateTabModified(htmlPath);
    window._injectedLangs = existingLangs;

    vexCelebrate();
    vexAddMsg('Done! <b>' + langCode.toUpperCase() + '</b> injected into <code>' + htmlPath.split('/').pop() + '</code> with a language switcher button.<br><br>Hit <b>Save</b> (Ctrl+S) to download the updated file.');

  }).catch(function(err){
    tel.remove();
    vexTyping = false;
    if (vexChatOpen) vexState('active');
    vexAddMsg('Error: ' + err.message);
  });
}


// ══════════════════════════════
//  PREVIEW MODE
// ══════════════════════════════
var _previewMode = 'static'; // 'static' | 'node'

function setPreviewMode(mode) {
  _previewMode = mode;
  document.getElementById('prevModeStatic').classList.toggle('active', mode === 'static');
  document.getElementById('prevModeNode').classList.toggle('active', mode === 'node');
  var staticFrame = document.getElementById('previewFrame');
  var sbFrame = document.getElementById('sbFrame');
  if (mode === 'static') {
    staticFrame.style.display = '';
    sbFrame.style.display = 'none';
    refreshPreview();
  } else {
    staticFrame.style.display = 'none';
    sbFrame.style.display = '';
    sbFrame.innerHTML = '';
    runWithWebContainers(sbFrame);
  }
}

function refreshActivePreview() {
  if (_previewMode === 'static') refreshPreview();
  else { var sb = document.getElementById('sbFrame'); sb.innerHTML=''; runWithWebContainers(sb); }
}

function buildWcProject() {
  var files = {};
  var paths = allFilePaths || [];
  var hasVite = paths.some(function(p){ return p.endsWith('vite.config.ts') || p.endsWith('vite.config.js'); });
  var hasNext = paths.some(function(p){ return p.endsWith('next.config.js') || p.endsWith('next.config.ts'); });
  var hasPkg  = paths.some(function(p){ return p.endsWith('package.json'); });
  var hasTsx  = paths.some(function(p){ return p.endsWith('.tsx') || p.endsWith('.jsx'); });
  paths.forEach(function(p) {
    var content = fileContents[p];
    if (content === undefined) return;
    var parts = p.split('/');
    var key = parts.length > 1 ? parts.slice(1).join('/') : p;
    if (!key) return;
    files[key] = content;
  });
  if (!hasPkg) {
    if (hasTsx) {
      files['package.json'] = JSON.stringify({name:'vex-preview',private:true,version:'0.0.0',type:'module',scripts:{dev:'vite',build:'vite build'},dependencies:{react:'^18.2.0','react-dom':'^18.2.0'},devDependencies:{'@vitejs/plugin-react':'^4.0.0',vite:'^5.0.0',typescript:'^5.0.0'}}, null, 2);
      files['vite.config.ts'] = "import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\nexport default defineConfig({ plugins: [react()] })";
    } else {
      files['package.json'] = JSON.stringify({name:'vex-preview',private:true,version:'0.0.0',scripts:{dev:'vite'},devDependencies:{vite:'^5.0.0'}}, null, 2);
    }
  }
  var template = hasNext ? 'nextjs' : 'node';
  var startCmd = 'npm run dev';
  try {
    var pkg = JSON.parse(files['package.json'] || '{}');
    if (pkg.scripts && pkg.scripts.dev) startCmd = 'npm run dev';
    else if (pkg.scripts && pkg.scripts.start) startCmd = 'npm start';
  } catch(e) {}
  return { files: files, template: template, startCmd: startCmd };
}

function checkWebContainersSupport() {
  // WebContainers needs COOP/COEP headers — only works when served from a proper server
  try {
    // If SharedArrayBuffer is available, COOP/COEP headers are set correctly
    return typeof SharedArrayBuffer !== 'undefined';
  } catch(e) {
    return false;
  }
}

function runWithWebContainers(container) {
  var dot = document.getElementById('previewDot');
  var fname = document.getElementById('previewFileName');
  if (dot) dot.classList.add('updating');

  var proj = buildWcProject();
  if (Object.keys(proj.files).length === 0) {
    container.innerHTML = emptyWorkspaceCard();
    if (dot) dot.classList.remove('updating');
    return;
  }

  // Check if WebContainers can run (needs COOP/COEP headers)
  if (!checkWebContainersSupport()) {
    showWebContainersNotReady(container, proj);
    if (dot) dot.classList.remove('updating');
    return;
  }

  // Headers are set — boot WebContainers
  bootWebContainers(container, proj);
}

function showWebContainersNotReady(container, proj) {
  var wsName = ws() ? ws().name : 'VEX Project';
  var fileCount = Object.keys(proj.files).length;
  container.innerHTML = '';

  var card = document.createElement('div');
  card.style.cssText = 'padding:32px;font-family:"IBM Plex Sans",sans-serif;color:#c8c8e0;background:#0d1b2a;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;box-sizing:border-box;text-align:center';
  card.innerHTML = '<div style="font-size:36px">🚀</div>'
    + '<div style="font-size:15px;font-weight:700;color:#fff">WebContainers ready — needs deploy</div>'
    + '<div style="font-size:12px;color:#556677;max-width:360px;line-height:1.7">'
    + 'Your project has <b style="color:#d4a853">' + fileCount + ' files</b>. '
    + 'WebContainers runs Node.js directly in the browser but requires two HTTP headers that only a real server can set.<br><br>'
    + '<code style="color:#4ade80;font-size:11px">Cross-Origin-Opener-Policy: same-origin</code><br>'
    + '<code style="color:#4ade80;font-size:11px">Cross-Origin-Embedder-Policy: require-corp</code><br><br>'
    + 'These are already in your <code style="color:#d4a853">vercel.json</code>. Deploy VEX Studio to Vercel and ▶ Run will work natively.'
    + '</div>';

  var btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:4px';

  var scaffoldBtn = document.createElement('button');
  scaffoldBtn.style.cssText = 'background:linear-gradient(135deg,#d4a853,#c9973f);border:none;border-radius:8px;color:#0a1628;font-size:12px;font-weight:700;padding:9px 18px;cursor:pointer;font-family:inherit';
  scaffoldBtn.textContent = '⚡ Wrap in Vite + Vercel';
  scaffoldBtn.onclick = function() { openScaffoldPanel(); };

  var ghBtn = document.createElement('button');
  ghBtn.style.cssText = 'background:#15202b;border:1px solid #1e3044;border-radius:8px;color:#c8c8e0;font-size:12px;font-weight:700;padding:9px 18px;cursor:pointer;font-family:inherit';
  ghBtn.textContent = '⎇ Push to GitHub';
  ghBtn.onclick = function() { _ghTab='push'; openGithubPanel(); };

  btnRow.appendChild(scaffoldBtn);
  btnRow.appendChild(ghBtn);
  card.appendChild(btnRow);

  var note = document.createElement('div');
  note.style.cssText = 'font-size:10px;color:#334455;margin-top:2px';
  note.textContent = 'Once on Vercel: full Node.js, npm install, hot reload — all in this panel';
  card.appendChild(note);

  container.appendChild(card);
}

function emptyWorkspaceCard() {
  return '<div style="padding:32px;font-family:sans-serif;color:#c8c8e0;background:#0d1b2a;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px">'
    + '<div style="font-size:32px">📂</div>'
    + '<div style="font-size:14px;font-weight:700">No files in workspace</div>'
    + '<div style="font-size:12px;color:#556677">Add files or open a folder first.</div>'
    + '</div>';
}

async function bootWebContainers(container, proj) {
  // This runs when COOP/COEP headers ARE set (i.e. on Vercel)
  var dot = document.getElementById('previewDot');
  var fname = document.getElementById('previewFileName');

  container.innerHTML = '<div style="padding:24px;font-family:sans-serif;color:#c8c8e0;background:#0d1b2a;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px">'
    + '<div style="font-size:28px">⚙</div>'
    + '<div style="font-size:13px;font-weight:700" id="wcStatus">Booting WebContainers…</div>'
    + '<div style="font-size:11px;color:#556677" id="wcSubStatus">Installing Node.js in browser</div>'
    + '</div>';

  try {
    // Dynamically import WebContainers (only works when headers are set)
    var { WebContainer } = await import('https://esm.sh/@webcontainer/api');

    var wcStatus = document.getElementById('wcStatus');
    var wcSub = document.getElementById('wcSubStatus');
    if (wcStatus) wcStatus.textContent = 'Mounting files…';

    var wc = await WebContainer.boot();

    // Mount all files
    var mountFiles = {};
    Object.keys(proj.files).forEach(function(path) {
      var parts = path.split('/');
      var cur = mountFiles;
      for (var i = 0; i < parts.length - 1; i++) {
        if (!cur[parts[i]]) cur[parts[i]] = { directory: {} };
        cur = cur[parts[i]].directory;
      }
      cur[parts[parts.length - 1]] = { file: { contents: proj.files[path] } };
    });
    await wc.mount(mountFiles);

    if (wcStatus) wcStatus.textContent = 'Installing dependencies…';
    if (wcSub) wcSub.textContent = 'npm install';

    var installProc = await wc.spawn('npm', ['install']);
    await installProc.exit;

    if (wcStatus) wcStatus.textContent = 'Starting dev server…';
    if (wcSub) wcSub.textContent = proj.startCmd;

    var devProc = await wc.spawn('npm', ['run', 'dev']);

    // Wait for server ready URL
    wc.on('server-ready', function(port, url) {
      container.innerHTML = '<iframe src="' + url + '" style="width:100%;height:100%;border:none" allow="cross-origin-isolated"></iframe>';
      if (fname) fname.textContent = (ws() ? ws().name : 'app') + ' · localhost:' + port;
      if (dot) dot.classList.remove('updating');
    });

  } catch(e) {
    container.innerHTML = '<div style="padding:24px;font-family:sans-serif;color:#f87171;background:#0d1b2a;height:100%">'
      + '<b>WebContainers error:</b><br>' + e.message + '</div>';
    if (dot) dot.classList.remove('updating');
  }
}




// ══════════════════════════════
//  SPLIT PREVIEW
// ══════════════════════════════
var previewOpen = false;
var previewTimer = null;

function togglePreview() {
  var resizer  = document.getElementById('splitResizer');
  var pane     = document.getElementById('previewPane');
  var btn      = document.getElementById('previewBtn');
  var edPane   = document.getElementById('editorPane');
  var frame    = document.getElementById('previewFrame');
  var sbFrame  = document.getElementById('sbFrame');

  previewOpen = !previewOpen;

  if (previewOpen) {
    // Reset pane widths so split starts 50/50
    edPane.style.flex  = '1';
    edPane.style.width = '';
    pane.style.flex    = '1';
    pane.style.width   = '';

    resizer.style.display = 'block';
    pane.style.display    = 'flex';
    btn.classList.add('active');

    // Always static mode for HTML preview
    _previewMode = 'static';
    document.getElementById('prevModeStatic').classList.add('active');
    document.getElementById('prevModeNode').classList.remove('active');
    frame.style.display  = '';
    sbFrame.style.display = 'none';

    initSplitResizer();

    // Small delay so DOM settles before rendering
    setTimeout(function() { refreshPreview(); }, 50);

  } else {
    resizer.style.display = 'none';
    pane.style.display    = 'none';
    btn.classList.remove('active');

    // Full width back to editor
    edPane.style.flex  = '1';
    edPane.style.width = '';
    pane.style.flex    = '';
    pane.style.width   = '';
  }

  if (editor) setTimeout(function(){ editor.layout(); }, 60);
}

// ── TIER 2 PREVIEW: multi-file blob stitcher ──
// Resolves all relative imports (CSS, JS, images) from workspace fileContents
// and inlines them as blob URLs so the iframe is fully self-contained.

var _blobRegistry = {}; // path → blob URL, for cleanup

function revokeAllBlobs() {
  Object.values(_blobRegistry).forEach(function(u){ URL.revokeObjectURL(u); });
  _blobRegistry = {};
}

function getMimeType(path) {
  if (path.endsWith('.css'))  return 'text/css';
  if (path.endsWith('.js') || path.endsWith('.mjs')) return 'application/javascript';
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.svg'))  return 'image/svg+xml';
  if (path.endsWith('.png'))  return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.gif'))  return 'image/gif';
  if (path.endsWith('.woff') || path.endsWith('.woff2')) return 'font/woff2';
  return 'text/plain';
}

function resolvePath(base, relative) {
  // base = 'my-app/index.html', relative = './style.css' → 'my-app/style.css'
  if (relative.startsWith('http://') || relative.startsWith('https://') ||
      relative.startsWith('//') || relative.startsWith('data:') ||
      relative.startsWith('blob:')) return null; // external, leave as-is
  var baseDir = base.includes('/') ? base.slice(0, base.lastIndexOf('/')) : '';
  var parts = (baseDir ? baseDir + '/' : '') + relative.replace(/^\.\//, '');
  // normalize ../ segments
  var stack = [];
  parts.split('/').forEach(function(p){
    if (p === '..') stack.pop();
    else if (p !== '.') stack.push(p);
  });
  return stack.join('/');
}

function makeBlobForPath(path, visited) {
  visited = visited || new Set();
  if (visited.has(path)) return null;
  visited.add(path);
  if (_blobRegistry[path]) return _blobRegistry[path];

  var content = fileContents[path];
  if (content === undefined) return null;

  var mime = getMimeType(path);

  // For CSS: rewrite url(...) references
  if (mime === 'text/css') {
    content = content.replace(/url\(['"]?([^'")]+)['"]?\)/g, function(match, ref) {
      var resolved = resolvePath(path, ref);
      if (!resolved) return match;
      var blobUrl = makeBlobForPath(resolved, visited);
      return blobUrl ? 'url("' + blobUrl + '")' : match;
    });
    // Rewrite @import
    content = content.replace(/@import\s+['"]([^'"]+)['"]/g, function(match, ref) {
      var resolved = resolvePath(path, ref);
      if (!resolved) return match;
      var blobUrl = makeBlobForPath(resolved, visited);
      return blobUrl ? '@import "' + blobUrl + '"' : match;
    });
  }

  // For JS: rewrite ES module imports from relative paths
  if (mime === 'application/javascript') {
    content = content.replace(/from\s+['"](\.[^'"]+)['"]/g, function(match, ref) {
      var resolved = resolvePath(path, ref.endsWith('.js') ? ref : ref + '.js');
      if (!resolved) return match;
      var blobUrl = makeBlobForPath(resolved, visited);
      return blobUrl ? 'from "' + blobUrl + '"' : match;
    });
    content = content.replace(/import\s+['"](\.[^'"]+)['"]/g, function(match, ref) {
      var resolved = resolvePath(path, ref);
      if (!resolved) return match;
      var blobUrl = makeBlobForPath(resolved, visited);
      return blobUrl ? 'import "' + blobUrl + '"' : match;
    });
  }

  var blob = new Blob([content], {type: mime});
  var url = URL.createObjectURL(blob);
  _blobRegistry[path] = url;
  return url;
}

function stitchHtml(htmlPath, htmlContent) {
  var isFileProtocol = window.location.protocol === 'file:';

  if (isFileProtocol) {
    // On file:// blob URLs don't work — inline everything directly
    // Inline <link rel="stylesheet" href="...">
    htmlContent = htmlContent.replace(/<link([^>]*)\shref=['"]([^'"]+)['"]([^>]*)>/gi, function(match, pre, href, post) {
      if (href.startsWith('http') || href.startsWith('//') || href.startsWith('data:')) return match;
      var resolved = resolvePath(htmlPath, href);
      if (!resolved) return match;
      var css = fileContents[resolved];
      if (css === undefined) return match;
      return '<style>' + css + '</style>';
    });
    // Inline <script src="...">
    htmlContent = htmlContent.replace(/<script([^>]*)\ssrc=['"]([^'"]+)['"]([^>]*)><\/script>/gi, function(match, pre, src, post) {
      if (src.startsWith('http') || src.startsWith('//') || src.startsWith('data:')) return match;
      var resolved = resolvePath(htmlPath, src);
      if (!resolved) return match;
      var js = fileContents[resolved];
      if (js === undefined) return match;
      return '<script' + pre + post + '>' + js + '<\/script>';
    });
    return htmlContent;
  }

  // On http(s):// use blob URLs as before
  var visited = new Set([htmlPath]);
  var baseDir = htmlPath.includes('/') ? htmlPath.slice(0, htmlPath.lastIndexOf('/')) : '';

  // Replace <link href="..."> stylesheet references
  htmlContent = htmlContent.replace(/<link([^>]*)\shref=['"]([^'"]+)['"]([^>]*)>/gi, function(match, pre, href, post) {
    var resolved = resolvePath(htmlPath, href);
    if (!resolved) return match;
    var blobUrl = makeBlobForPath(resolved, new Set(visited));
    return blobUrl ? '<link' + pre + ' href="' + blobUrl + '"' + post + '>' : match;
  });

  // Replace <script src="..."> references
  htmlContent = htmlContent.replace(/<script([^>]*)\ssrc=['"]([^'"]+)['"]([^>]*)>/gi, function(match, pre, src, post) {
    var resolved = resolvePath(htmlPath, src);
    if (!resolved) return match;
    var blobUrl = makeBlobForPath(resolved, new Set(visited));
    return blobUrl ? '<script' + pre + ' src="' + blobUrl + '"' + post + '>' : match;
  });

  // Replace <img src="..."> references
  htmlContent = htmlContent.replace(/<img([^>]*)\ssrc=['"]([^'"]+)['"]([^>]*)>/gi, function(match, pre, src, post) {
    var resolved = resolvePath(htmlPath, src);
    if (!resolved) return match;
    var blobUrl = makeBlobForPath(resolved, new Set(visited));
    return blobUrl ? '<img' + pre + ' src="' + blobUrl + '"' + post + '>' : match;
  });

  // Replace inline style url() references
  htmlContent = htmlContent.replace(/url\(['"]?([^'")]+)['"]?\)/g, function(match, ref) {
    if (ref.startsWith('http') || ref.startsWith('data:') || ref.startsWith('blob:')) return match;
    var resolved = resolvePath(htmlPath, ref);
    if (!resolved) return match;
    var blobUrl = makeBlobForPath(resolved, new Set(visited));
    return blobUrl ? 'url("' + blobUrl + '")' : match;
  });

  return htmlContent;
}

function refreshPreview() {
  if (!previewOpen) return;
  var path = activeTab;
  if (!path || !path.endsWith('.html')) return;
  var dot = document.getElementById('previewDot');
  var fname = document.getElementById('previewFileName');
  if (dot) dot.classList.add('updating');
  if (fname) fname.textContent = path.split('/').pop();

  var content = (editor && editor.getModel()) ? editor.getModel().getValue() : (fileContents[path] || '');
  revokeAllBlobs();
  var stitched = stitchHtml(path, content);

  var frame = document.getElementById('previewFrame');
  if (!frame) return;

  // Try blob URL first; fall back to srcdoc if we're on file:// (blob:null)
  try {
    var blob = new Blob([stitched], {type: 'text/html'});
    var url = URL.createObjectURL(blob);
    if (!url || url.startsWith('blob:null')) {
      // file:// context — use srcdoc instead
      if (frame._blobUrl) { URL.revokeObjectURL(frame._blobUrl); frame._blobUrl = null; }
      frame.removeAttribute('src');
      frame.srcdoc = stitched;
    } else {
      if (frame._blobUrl) URL.revokeObjectURL(frame._blobUrl);
      frame._blobUrl = url;
      frame.removeAttribute('srcdoc');
      frame.src = url;
    }
  } catch(e) {
    frame.srcdoc = stitched;
  }

  setTimeout(function(){ if(dot) dot.classList.remove('updating'); }, 600);
}

function schedulePreviewRefresh() {
  if (!previewOpen) return;
  var dot = document.getElementById('previewDot');
  if (dot) dot.classList.add('updating');
  clearTimeout(previewTimer);
  previewTimer = setTimeout(refreshPreview, 900);
}

function initSplitResizer() {
  var resizer = document.getElementById('splitResizer');
  if (resizer._inited) return; // only init once
  resizer._inited = true;

  var edPane = document.getElementById('editorPane');
  var prePane = document.getElementById('previewPane');
  var split = document.getElementById('editorSplit');
  var dragging = false;
  var startX, startEdW;

  resizer.addEventListener('mousedown', function(e) {
    dragging = true;
    startX = e.clientX;
    startEdW = edPane.getBoundingClientRect().width;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    // Cover iframe so it doesn't eat mouse events during drag
    var cover = document.getElementById('previewCover');
    if (!cover) {
      cover = document.createElement('div');
      cover.id = 'previewCover';
      cover.style.cssText = 'position:absolute;inset:0;z-index:999;cursor:col-resize;';
      prePane.style.position = 'relative';
      prePane.appendChild(cover);
    }
    cover.style.display = 'block';
    e.preventDefault();
  });

  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    var dx = e.clientX - startX;
    var totalW = split.getBoundingClientRect().width - 5; // minus resizer width
    var newEdW = Math.max(150, Math.min(totalW - 150, startEdW + dx));
    edPane.style.flex = 'none';
    edPane.style.width = newEdW + 'px';
    prePane.style.flex = '1';
    prePane.style.width = '';
    if (editor) editor.layout();
  });

  document.addEventListener('mouseup', function() {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    var cover = document.getElementById('previewCover');
    if (cover) cover.style.display = 'none';
    if (editor) editor.layout();
  });
}


// ══════════════════════════════
//  NEXT.JS CONVERTER
// ══════════════════════════════
// ===== VITE + REACT + SUPABASE CONVERTER =====
var _vtcConverting = false;
var _vtcMode = 'supabase'; // 'supabase' | 'vite'

function openViteConverter() {
  if (!vexChatOpen) vexToggleChat();
  vexAddMsg('⚡ <b>Convert to Vite + React</b><br><br>Two options:<br><br>'
    + '🔋 <b>Vite + Supabase</b> — adds a login gate, user accounts. Best for paid tools or anything that needs auth.<br><br>'
    + '⚡ <b>Vite only</b> — tool loads directly, no login. Best for free public tools or when you want to add auth later.<br><br>'
    + 'Both preserve your original tool in <code>public/tool.html</code> untouched. Opening converter now…');
  setTimeout(function() {
    document.getElementById('vtcOverlay').classList.add('open');
    renderVtcPanel();
  }, 800);
}
function closeViteConverter() {
  if (_vtcConverting) return;
  document.getElementById('vtcOverlay').classList.remove('open');
}

// Auto-detect API keys needed from HTML source
function detectApiKeys(htmlContent) {
  var found = [];
  var already = {};
  function suggest(name, hint) {
    if (!already[name]) { already[name] = true; found.push({ name: name, hint: hint, value: '' }); }
  }
  // VITE_ vars already referenced in code
  var viteRe = /VITE_([A-Z0-9_]+)/g;
  var vm;
  while ((vm = viteRe.exec(htmlContent)) !== null) {
    if (vm[1] !== 'SUPABASE_URL' && vm[1] !== 'SUPABASE_ANON_KEY') {
      suggest('VITE_' + vm[1], 'referenced in code');
    }
  }
  // localStorage key patterns — common API key storage
  var lsRe = /localStorage\.(getItem|setItem)\(['"]([^'"]+)['"]/g;
  var lm;
  while ((lm = lsRe.exec(htmlContent)) !== null) {
    var k = lm[2];
    if (/key|token|secret|api/i.test(k)) {
      var envName = 'VITE_' + k.replace(/[^a-zA-Z0-9]/g,'_').toUpperCase();
      suggest(envName, 'from localStorage("' + k + '")');
    }
  }
  // Known API endpoint → suggest key name
  var endpoints = [
    { pattern: 'api.anthropic.com', name: 'VITE_ANTHROPIC_API_KEY', hint: 'Claude / Anthropic API' },
    { pattern: 'api.openai.com',    name: 'VITE_OPENAI_API_KEY',    hint: 'OpenAI API' },
    { pattern: 'generativelanguage.googleapis.com', name: 'VITE_GEMINI_API_KEY', hint: 'Google Gemini API' },
    { pattern: 'api.github.com',    name: 'VITE_GITHUB_TOKEN',      hint: 'GitHub API' },
    { pattern: 'api.stripe.com',    name: 'VITE_STRIPE_PUBLIC_KEY', hint: 'Stripe' },
    { pattern: 'maps.googleapis.com', name: 'VITE_GOOGLE_MAPS_KEY', hint: 'Google Maps' },
  ];
  endpoints.forEach(function(e) {
    if (htmlContent.indexOf(e.pattern) !== -1) suggest(e.name, e.hint);
  });
  return found;
}

function renderVtcPanel() {
  var body = document.getElementById('vtcBody');
  body.innerHTML = '';
  _vtcConverting = false;

  if (!ws() || ws().allFilePaths.length === 0) {
    body.innerHTML = '<div class="nxc-info">Open a project with HTML files first.</div>';
    return;
  }

  var htmlFiles = ws().allFilePaths.filter(function(p) {
    if (!p.endsWith('.html')) return false;
    var lower = p.toLowerCase();
    if (lower.includes('/node_modules/')) return false;
    if (lower.includes('/dist/')) return false;
    if (lower.includes('/vendor/')) return false;
    return true;
  });

  if (htmlFiles.length === 0) {
    body.innerHTML = '<div class="nxc-info">No HTML files found in the current workspace.</div>';
    return;
  }

  var nameDiv = document.createElement('div');
  nameDiv.innerHTML = '<div class="nxc-section-title">Project Name</div>'
    + '<input class="nxc-input" id="vtcProjName" value="' + (ws().name.toLowerCase().replace(/[^a-z0-9-]/g,'-') || 'my-app') + '" placeholder="my-vite-app" />';
  body.appendChild(nameDiv);

  var sbDiv = document.createElement('div');
  sbDiv.id = 'vtcSbSection';
  sbDiv.style.cssText = 'margin-top:10px';
  var sbTitleRow = document.createElement('div');
  sbTitleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px';
  sbTitleRow.innerHTML = '<div class="nxc-section-title" style="margin:0">Supabase Credentials <span style="color:#556677;font-weight:400;text-transform:none;font-size:10px">(optional — add later in .env)</span></div>';
  var sbHelpBtn = document.createElement('button');
  sbHelpBtn.textContent = '? What is this';
  sbHelpBtn.style.cssText = 'background:none;border:1px solid #1e3044;border-radius:5px;color:#556677;font-size:10px;padding:2px 8px;cursor:pointer;font-family:inherit';
  sbHelpBtn.onmouseenter = function(){ sbHelpBtn.style.color='#a78bfa'; sbHelpBtn.style.borderColor='rgba(167,139,250,0.4)'; };
  sbHelpBtn.onmouseleave = function(){ sbHelpBtn.style.color='#556677'; sbHelpBtn.style.borderColor='#1e3044'; };
  sbHelpBtn.onclick = function() {
    closeViteConverter();
    if (!vexChatOpen) vexToggleChat();
    vexAddMsg(
      '🔋 <b>What is Supabase and do you need it?</b><br><br>'
      + 'Supabase is a free backend that gives your tool <b>user login, accounts and a database</b>. Think of it as your app\'s backend without writing any server code.<br><br>'
      + '<b>Do you need it?</b><br>'
      + '• <b>No</b> — if your tool is public and anyone can use it (no login needed)<br>'
      + '• <b>Yes</b> — if you want users to sign up, save their work, or you want to charge for access<br><br>'
      + '<b>How to set it up (free):</b><br><br>'
      + '<b>1.</b> Go to <a href="https://supabase.com" target="_blank" style="color:#a78bfa">supabase.com</a> and click <b>Start for free</b><br>'
      + '<b>2.</b> Sign up with GitHub or email<br>'
      + '<b>3.</b> Click <b>New project</b> — give it the name of your tool<br>'
      + '<b>4.</b> Pick a region close to your users (e.g. EU West)<br>'
      + '<b>5.</b> Set a database password (save it somewhere)<br>'
      + '<b>6.</b> Wait ~1 min for it to provision<br>'
      + '<b>7.</b> Go to <b>Project Settings → API</b><br>'
      + '<b>8.</b> Copy <b>Project URL</b> → paste into the URL field<br>'
      + '<b>9.</b> Copy <b>Publishable API Key</b> → paste into the key field<br><br>'
      + '📌 Direct link once logged in: <a href="https://supabase.com/dashboard" target="_blank" style="color:#a78bfa">supabase.com/dashboard</a><br>'
      + '📖 Docs: <a href="https://supabase.com/docs" target="_blank" style="color:#a78bfa">supabase.com/docs</a><br><br>'
      + '<b>Free tier includes:</b> 50,000 monthly active users, 500MB database, unlimited auth — plenty to launch with.<br><br>'
      + 'Leave the fields blank for now if you haven\'t set it up yet — you can add the keys to <code>.env</code> later.'
    );
    vexAddBtns([
      { label: '↩ Back to converter', action: function() { openViteConverter(); } },
      { label: '🌐 Open Supabase', action: function() { window.open('https://supabase.com','_blank'); } }
    ]);
  };
  sbTitleRow.appendChild(sbHelpBtn);
  sbDiv.appendChild(sbTitleRow);
  var sbInputs = document.createElement('div');
  sbInputs.innerHTML = '<input class="nxc-input" id="vtcSbUrl" placeholder="Project URL — https://xxx.supabase.co" style="margin-bottom:6px" />'
    + '<input class="nxc-input" id="vtcSbKey" placeholder="Publishable API Key (anon public)" />';
  sbDiv.appendChild(sbInputs);
  body.appendChild(sbDiv);

  // --- API KEYS SECTION ---
  var allHtml = ws().allFilePaths
    .filter(function(p){ return p.endsWith('.html'); })
    .map(function(p){ return ws().fileContents[p] || ''; })
    .join('\n');
  var detectedKeys = detectApiKeys(allHtml);

  // All known presets
  var VTC_PRESETS = [
    { emoji:'🤖', label:'Claude',        name:'VITE_ANTHROPIC_API_KEY',      url:'console.anthropic.com' },
    { emoji:'🧠', label:'OpenAI',        name:'VITE_OPENAI_API_KEY',         url:'platform.openai.com/api-keys' },
    { emoji:'♊', label:'Gemini',        name:'VITE_GEMINI_API_KEY',         url:'aistudio.google.com' },
    { emoji:'🌀', label:'Mistral',       name:'VITE_MISTRAL_API_KEY',        url:'console.mistral.ai' },
    { emoji:'🦙', label:'Together AI',   name:'VITE_TOGETHER_API_KEY',       url:'api.together.ai' },
    { emoji:'⚡', label:'Groq',          name:'VITE_GROQ_API_KEY',           url:'console.groq.com' },
    { emoji:'🐙', label:'GitHub',        name:'VITE_GITHUB_TOKEN',           url:'github.com/settings/tokens' },
    { emoji:'💳', label:'Stripe',        name:'VITE_STRIPE_PUBLIC_KEY',      url:'dashboard.stripe.com/apikeys' },
    { emoji:'🗺️', label:'Google Maps',   name:'VITE_GOOGLE_MAPS_KEY',        url:'console.cloud.google.com' },
    { emoji:'🔍', label:'Google Search', name:'VITE_GOOGLE_SEARCH_KEY',      url:'console.cloud.google.com' },
    { emoji:'🌤️', label:'OpenWeather',   name:'VITE_OPENWEATHER_KEY',        url:'openweathermap.org/api_keys' },
    { emoji:'✉️', label:'Resend',        name:'VITE_RESEND_API_KEY',         url:'resend.com/api-keys' },
    { emoji:'📧', label:'SendGrid',      name:'VITE_SENDGRID_API_KEY',       url:'app.sendgrid.com' },
    { emoji:'💬', label:'Twilio',        name:'VITE_TWILIO_API_KEY',         url:'console.twilio.com' },
    { emoji:'🖼️', label:'Cloudinary',    name:'VITE_CLOUDINARY_KEY',         url:'cloudinary.com/console' },
    { emoji:'🌍', label:'Mapbox',        name:'VITE_MAPBOX_TOKEN',           url:'account.mapbox.com' },
    { emoji:'🔎', label:'Algolia',       name:'VITE_ALGOLIA_APP_ID',         url:'dashboard.algolia.com' },
    { emoji:'📊', label:'Airtable',      name:'VITE_AIRTABLE_API_KEY',       url:'airtable.com/account' },
    { emoji:'🪄', label:'Replicate',     name:'VITE_REPLICATE_API_TOKEN',    url:'replicate.com/account' },
    { emoji:'🎨', label:'Stability AI',  name:'VITE_STABILITY_API_KEY',      url:'platform.stability.ai' },
  ];

  var apiSection = document.createElement('div');
  apiSection.style.cssText = 'margin-top:12px';

  var apiTitle = document.createElement('div');
  apiTitle.className = 'nxc-section-title';
  apiTitle.style.cssText = 'margin-bottom:8px';
  apiTitle.textContent = 'API Keys';
  apiSection.appendChild(apiTitle);

  // Preset grid
  var presetGrid = document.createElement('div');
  presetGrid.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px';

  VTC_PRESETS.forEach(function(preset) {
    var alreadyAdded = false;
    var btn = document.createElement('button');
    btn.dataset.presetName = preset.name;
    btn.style.cssText = 'display:flex;align-items:center;gap:4px;background:#0d1b2a;border:1px solid #1e3044;border-radius:6px;color:#c8c8e0;font-size:11px;padding:4px 8px;cursor:pointer;font-family:inherit;transition:all 0.15s';
    btn.innerHTML = '<span>' + preset.emoji + '</span><span>' + preset.label + '</span>';
    // highlight if auto-detected
    var isDetected = detectedKeys.some(function(k){ return k.name === preset.name; });
    if (isDetected) {
      btn.style.cssText = 'display:flex;align-items:center;gap:4px;background:rgba(74,222,128,0.08);border:1px solid rgba(74,222,128,0.4);border-radius:6px;color:#4ade80;font-size:11px;padding:4px 8px;cursor:pointer;font-family:inherit;transition:all 0.15s';
      btn.title = 'Detected in your code — click to add';
    }
    btn.onmouseenter = function(){ if(!btn.dataset.added) btn.style.borderColor='#a78bfa'; btn.style.color=btn.dataset.added?'#a78bfa':'#a78bfa'; };
    btn.onmouseleave = function(){
      if(!btn.dataset.added) {
        btn.style.borderColor = isDetected ? 'rgba(74,222,128,0.4)' : '#1e3044';
        btn.style.color = isDetected ? '#4ade80' : '#c8c8e0';
      }
    };
    btn.onclick = function() {
      if (btn.dataset.added) return;
      btn.dataset.added = '1';
      btn.style.cssText = 'display:flex;align-items:center;gap:4px;background:rgba(167,139,250,0.12);border:1px solid rgba(167,139,250,0.5);border-radius:6px;color:#a78bfa;font-size:11px;padding:4px 8px;cursor:default;font-family:inherit;opacity:0.7';
      addKeyRow(preset.name, '', preset.label + ' — ' + preset.url, btn);
    };
    presetGrid.appendChild(btn);
  });

  apiSection.appendChild(presetGrid);

  // Active keys list
  var keyList = document.createElement('div');
  keyList.id = 'vtcKeyList';
  keyList.style.cssText = 'display:flex;flex-direction:column;gap:6px';
  apiSection.appendChild(keyList);

  // Env preview hint
  var envHint = document.createElement('div');
  envHint.id = 'vtcEnvHint';
  envHint.style.cssText = 'font-size:10px;color:#556677;font-family:monospace;background:#060f18;border:1px solid #1e3044;border-radius:6px;padding:7px 10px;margin-top:6px;display:none;line-height:1.7';
  apiSection.appendChild(envHint);

  // Custom key row at bottom
  var customRow = document.createElement('div');
  customRow.style.cssText = 'display:flex;align-items:center;gap:5px;margin-top:4px';
  customRow.innerHTML = '<input class="nxc-input" id="vtcCustomKeyName" placeholder="VITE_MY_CUSTOM_KEY" style="flex:1;font-size:11px;padding:6px 10px;font-family:monospace" />'
    + '<button onclick="vtcAddCustomKey()" style="background:none;border:1px solid #1e3044;border-radius:5px;color:#a78bfa;font-size:11px;padding:5px 10px;cursor:pointer;font-family:inherit;white-space:nowrap">+ Add custom</button>';
  apiSection.appendChild(customRow);

  body.appendChild(apiSection);

  function updateEnvHint() {
    var rows = keyList.querySelectorAll('.vtc-key-row');
    if (rows.length === 0) { envHint.style.display='none'; return; }
    envHint.style.display = 'block';
    var lines = ['<span style="color:#556677"># .env preview</span>'];
    rows.forEach(function(row) {
      var n = row.querySelector('.vtc-key-name').value || 'VITE_KEY';
      var v = row.querySelector('.vtc-key-val').value || 'your-key-here';
      lines.push('<span style="color:#a78bfa">' + n + '</span>=<span style="color:#4ade80">' + (v === 'your-key-here' ? v : '••••••') + '</span>');
    });
    envHint.innerHTML = lines.join('<br>');
  }

  function addKeyRow(name, value, hint, presetBtn) {
    var row = document.createElement('div');
    row.className = 'vtc-key-row';
    row.style.cssText = 'display:flex;gap:5px;align-items:center';

    var nameIn = document.createElement('input');
    nameIn.className = 'nxc-input vtc-key-name';
    nameIn.value = name || '';
    nameIn.readOnly = !!presetBtn;
    nameIn.style.cssText = 'flex:1;font-size:11px;padding:6px 10px;font-family:monospace;color:#a78bfa;' + (presetBtn ? 'opacity:0.8;cursor:default;' : '');

    var valIn = document.createElement('input');
    valIn.className = 'nxc-input vtc-key-val';
    valIn.placeholder = value ? value : 'paste key here (optional)';
    valIn.value = '';
    valIn.type = 'password';
    valIn.title = hint || '';
    valIn.style.cssText = 'flex:1.4;font-size:11px;padding:6px 10px';
    valIn.oninput = updateEnvHint;

    var delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.style.cssText = 'background:none;border:none;color:#556677;cursor:pointer;font-size:12px;padding:0 4px;font-family:inherit';
    delBtn.onclick = function() {
      row.remove();
      if (presetBtn) { delete presetBtn.dataset.added; presetBtn.style.cssText = 'display:flex;align-items:center;gap:4px;background:#0d1b2a;border:1px solid #1e3044;border-radius:6px;color:#c8c8e0;font-size:11px;padding:4px 8px;cursor:pointer;font-family:inherit;transition:all 0.15s'; }
      updateEnvHint();
    };

    row.appendChild(nameIn);
    row.appendChild(valIn);
    row.appendChild(delBtn);
    keyList.appendChild(row);
    updateEnvHint();
    valIn.focus();
  }

  // Just highlight detected keys in green — don't auto-add anything
  // User clicks what they actually need

  window.vtcAddCustomKey = function() {
    var inp = document.getElementById('vtcCustomKeyName');
    var val = inp.value.trim().toUpperCase().replace(/[^A-Z0-9_]/g,'_');
    if (!val) return;
    if (!val.startsWith('VITE_')) val = 'VITE_' + val;
    inp.value = '';
    addKeyRow(val, '', 'custom key', null);
  };

  var filesDiv = document.createElement('div');
  filesDiv.innerHTML = '<div class="nxc-section-title" style="margin-top:10px">HTML Tool File</div>';
  var fileList = document.createElement('div');
  fileList.className = 'nxc-file-list';
  htmlFiles.forEach(function(p) {
    var row = document.createElement('div');
    row.className = 'nxc-file-row';
    var fname = p.split('/').slice(1).join('/');
    row.innerHTML = '<input type="radio" name="vtcFile" class="nxc-file-check" value="' + p + '" ' + (htmlFiles.indexOf(p)===0?'checked':'') + '>'
      + '<span class="nxc-file-name">' + fname + '</span>'
      + '<span class="nxc-file-route" style="background:rgba(167,139,250,0.1);color:#a78bfa">main tool</span>';
    fileList.appendChild(row);
  });
  filesDiv.appendChild(fileList);
  body.appendChild(filesDiv);

  var infoDiv = document.createElement('div');
  infoDiv.className = 'nxc-info';
  infoDiv.style.cssText = 'background:rgba(167,139,250,0.06);border-color:rgba(167,139,250,0.2);margin-top:4px';
  infoDiv.innerHTML = '<strong style="color:#a78bfa">What gets generated:</strong><br>'
    + '🔑 <code>src/supabase.ts</code> — Supabase client<br>'
    + '⚙️ <code>src/config.ts</code> — all API keys exported<br>'
    + '⚛ <code>src/App.tsx</code> — React shell with auth gate<br>'
    + '🔐 <code>src/components/Auth.tsx</code> — login/signup UI<br>'
    + '📋 <code>src/components/Dashboard.tsx</code> — tool wrapper<br>'
    + '🌐 <code>public/tool.html</code> — your original tool (preserved)<br>'
    + '📦 <code>package.json</code>, <code>vite.config.ts</code>, <code>vercel.json</code>, <code>.env</code>';
  body.appendChild(infoDiv);

  var btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;margin-top:4px;flex-wrap:wrap';
  var convertBtn = document.createElement('button');
  convertBtn.className = 'nxc-btn';
  convertBtn.style.cssText = 'background:linear-gradient(135deg,#7c3aed,#a78bfa);color:#fff;font-size:12px;padding:10px 16px;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-family:inherit';
  convertBtn.textContent = '🔋 Vite + Supabase';
  convertBtn.title = 'With login/auth gate';
  convertBtn.onclick = function(){ _vtcMode = 'supabase'; if(sbDiv) sbDiv.style.display=''; runViteConverter(); };
  var convertBtnSimple = document.createElement('button');
  convertBtnSimple.className = 'nxc-btn';
  convertBtnSimple.style.cssText = 'background:linear-gradient(135deg,#1e3a5f,#3b82f6);color:#fff;font-size:12px;padding:10px 16px;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-family:inherit';
  convertBtnSimple.textContent = '⚡ Vite only';
  convertBtnSimple.title = 'No login, tool loads directly';
  convertBtnSimple.onclick = function(){ _vtcMode = 'vite'; if(sbDiv) sbDiv.style.display='none'; runViteConverter(); };
  btnRow.appendChild(convertBtn);
  btnRow.appendChild(convertBtnSimple);
  body.appendChild(btnRow);
}

async function runViteConverter() {
  var body = document.getElementById('vtcBody');
  var projName = (document.getElementById('vtcProjName').value.trim() || 'my-app').toLowerCase().replace(/[^a-z0-9-]/g,'-');
  var sbUrl = document.getElementById('vtcSbUrl').value.trim();
  var sbKey = document.getElementById('vtcSbKey').value.trim();

  // Collect API keys from the key list
  var extraKeys = [];
  document.querySelectorAll('#vtcKeyList .vtc-key-row').forEach(function(row) {
    var nameIn = row.querySelector('.vtc-key-name');
    var valIn = row.querySelector('.vtc-key-val');
    if (nameIn && nameIn.value.trim()) {
      extraKeys.push({ name: nameIn.value.trim(), value: valIn ? valIn.value.trim() : '' });
    }
  });
  var selectedFile = document.querySelector('input[name="vtcFile"]:checked');
  if (!selectedFile) { alert('Select an HTML file first.'); return; }
  var htmlPath = selectedFile.value;
  var htmlContent = ws().fileContents[htmlPath] || '';

  _vtcConverting = true;
  body.innerHTML = '';

  var progressDiv = document.createElement('div');
  progressDiv.className = 'nxc-progress';
  progressDiv.innerHTML = '<div style="display:flex;justify-content:space-between;margin-bottom:6px">'
    + '<span id="vtcStatus" style="font-size:11px;color:#a78bfa;font-weight:600">Converting…</span>'
    + '<span id="vtcPct" style="font-size:11px;color:#556677">0%</span></div>'
    + '<div class="nxc-progress-bar-wrap"><div class="nxc-progress-bar" id="vtcBar" style="background:linear-gradient(90deg,#7c3aed,#a78bfa);width:0%"></div></div>';
  body.appendChild(progressDiv);

  var logEl = document.createElement('div');
  logEl.className = 'nxc-log';
  body.appendChild(logEl);

  function setProgress(pct) {
    document.getElementById('vtcBar').style.width = pct + '%';
    document.getElementById('vtcPct').textContent = pct + '%';
  }
  function setStatus(s) { var el = document.getElementById('vtcStatus'); if(el) el.textContent = s; }
  function log(msg, cls) {
    var line = document.createElement('div');
    line.className = 'nxc-log-line' + (cls ? ' ' + cls : '');
    line.innerHTML = msg;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  log('Extracting CSS, JS and HTML…');
  setProgress(10);

  // Extract JS first (before stripping), then strip scripts before extracting CSS
  // This prevents JS strings containing '</style>' from polluting globals.css
  var jsContent = '';
  var scriptRe = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  var scrm;
  while ((scrm = scriptRe.exec(htmlContent)) !== null) {
    if (scrm[1].indexOf('src=') === -1 && scrm[2].trim().length > 0) {
      jsContent += scrm[2].trim() + '\n\n';
    }
  }

  // Strip all script blocks before extracting CSS — prevents JS code (which may contain
  // strings like '<style>' or '</style>') from being captured by the style regex
  var htmlNoScripts = htmlContent.replace(/<script[\s\S]*?<\/script>/gi, '');

  var cssContent = '';
  var styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  var sm;
  while ((sm = styleRe.exec(htmlNoScripts)) !== null) cssContent += sm[1].trim() + '\n\n';

  var cdnLinks = extractCdnLinksFromHtml(htmlContent);
  var cleanHtml = htmlNoScripts
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  setProgress(30);
  log('✓ Extracted ' + Math.round(cssContent.length/1024) + 'KB CSS, ' + Math.round(jsContent.length/1024) + 'KB JS', 'done');
  log('Generating Vite project files…');
  setProgress(40);

  var isSupabase = _vtcMode === 'supabase';
  var prefix = projName + '-vite/';
  var newWs = { id: 'ws-' + Date.now(), name: projName + '-vite', fileContents: {}, allFilePaths: [], fileHandles: {}, dirHandles: {}, modifiedFiles: new Set(), openTabs: [], activeTab: null, editorModels: {}, collapsedDirs: new Set() };

  function addFile(path, fileContent) {
    newWs.fileContents[prefix + path] = fileContent;
    newWs.allFilePaths.push(prefix + path);
  }

  var deps = { react: '^18.3.1', 'react-dom': '^18.3.1' };
  if (isSupabase) deps['@supabase/supabase-js'] = '^2.45.0';

  addFile('package.json', JSON.stringify({
    name: projName, version: '0.1.0', private: true,
    scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
    dependencies: deps,
    devDependencies: {
      '@types/react': '^18.3.1', '@types/react-dom': '^18.3.1',
      '@vitejs/plugin-react': '^4.3.1', typescript: '^5.5.3', vite: '^5.4.8'
    }
  }, null, 2));

  addFile('vite.config.ts',
    'import { defineConfig } from "vite"\nimport react from "@vitejs/plugin-react"\nexport default defineConfig({\n  plugins: [react()],\n  build: { outDir: "dist" }\n})');

  addFile('vercel.json', JSON.stringify({
    rewrites: [{ source: '/(.*)', destination: '/index.html' }]
  }, null, 2));

  addFile('tsconfig.json', JSON.stringify({
    compilerOptions: {
      target: 'ES2020', useDefineForClassFields: true,
      lib: ['ES2020','DOM','DOM.Iterable'], module: 'ESNext',
      skipLibCheck: true, moduleResolution: 'bundler',
      allowImportingTsExtensions: true, isolatedModules: true,
      moduleDetection: 'force', noEmit: true, jsx: 'react-jsx', strict: false
    },
    include: ['src']
  }, null, 2));

  addFile('.gitignore', 'node_modules\ndist\n.env\n.env.local\n.DS_Store');
  var envContent = isSupabase
    ? 'VITE_SUPABASE_URL=' + (sbUrl || 'https://your-project.supabase.co') + '\nVITE_SUPABASE_ANON_KEY=' + (sbKey || 'your-anon-key-here')
    : '# Add your environment variables here';
  if (extraKeys.length) {
    envContent += '\n\n# API Keys';
    extraKeys.forEach(function(k) {
      envContent += '\n' + k.name + '=' + (k.value || 'your-key-here');
    });
  }
  addFile('.env', envContent);

  if (isSupabase) {
    addFile('src/supabase.ts',
      'import { createClient } from "@supabase/supabase-js"\n\nconst supabaseUrl = import.meta.env.VITE_SUPABASE_URL\nconst supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY\n\nexport const supabase = createClient(supabaseUrl, supabaseKey)');
  }

  // src/config.ts — all env vars in one place
  var configLines = ['// Auto-generated env config — edit values in .env', ''];
  if (extraKeys.length) {
    extraKeys.forEach(function(k) {
      var camel = k.name.replace(/^VITE_/,'').toLowerCase().replace(/_([a-z])/g, function(_, l){ return l.toUpperCase(); });
      configLines.push('export const ' + camel + ' = import.meta.env.' + k.name + ' as string');
    });
  } else {
    configLines.push('// Add your API keys here as: export const myKey = import.meta.env.VITE_MY_KEY');
  }
  addFile('src/config.ts', configLines.join('\n'));

  // Balance CSS braces before writing — unmatched } causes PostCSS to fail on Vercel
  function balanceCss(css) {
    var open = (css.match(/\{/g) || []).length;
    var close = (css.match(/\}/g) || []).length;
    if (close > open) {
      // Strip trailing unmatched closing braces
      var diff = close - open;
      var fixed = css;
      for (var i = 0; i < diff; i++) {
        var last = fixed.lastIndexOf('}');
        if (last !== -1) fixed = fixed.slice(0, last) + fixed.slice(last + 1);
      }
      return fixed;
    }
    if (open > close) {
      // Add missing closing braces at end
      return css + '\n}'.repeat(open - close);
    }
    return css;
  }

  // Only extract CSS separately for Supabase mode — Vite-only keeps everything in tool.html
  if (isSupabase) {
    addFile('public/globals.css', balanceCss(cssContent) || '/* Add global styles here */');
  }

  setProgress(55);
  log('✓ Config files created', 'done');

  if (isSupabase) {
    addFile('src/App.tsx',
      'import { useState, useEffect } from "react"\n'
      + 'import { supabase } from "./supabase"\n'
      + 'import { Auth } from "./components/Auth"\n'
      + 'import { Dashboard } from "./components/Dashboard"\n'
      + '// styles loaded via public/globals.css in index.html\n\n'
      + 'export default function App() {\n'
      + '  const [session, setSession] = useState<any>(null)\n'
      + '  const [loading, setLoading] = useState(true)\n\n'
      + '  useEffect(() => {\n'
      + '    supabase.auth.getSession().then(({ data: { session } }) => {\n'
      + '      setSession(session)\n'
      + '      setLoading(false)\n'
      + '    })\n'
      + '    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {\n'
      + '      setSession(session)\n'
      + '    })\n'
      + '    return () => subscription.unsubscribe()\n'
      + '  }, [])\n\n'
      + '  if (loading) return (\n'
      + '    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"#0a1628", color:"#a78bfa", fontFamily:"sans-serif", fontSize:"14px" }}>\n'
      + '      Loading ' + projName + '…\n'
      + '    </div>\n'
      + '  )\n\n'
      + '  if (!session) return <Auth />\n'
      + '  return <Dashboard session={session} />\n'
      + '}');
  } else {
    // Vite only — tool loads directly, no auth
    addFile('src/App.tsx',
      '// styles loaded via public/globals.css in index.html\n\n'
      + 'export default function App() {\n'
      + '  return (\n'
      + '    <div style={{ display:"flex", flexDirection:"column", height:"100vh", background:"#0a1628" }}>\n'
      + '      <iframe\n'
      + '        src="/tool.html"\n'
      + '        style={{ flex:1, border:"none", width:"100%", height:"100%" }}\n'
      + '        title="' + projName + '"\n'
      + '      />\n'
      + '    </div>\n'
      + '  )\n'
      + '}');
  }

  addFile('src/main.tsx',
    'import { StrictMode } from "react"\nimport { createRoot } from "react-dom/client"\nimport App from "./App"\n\ncreateRoot(document.getElementById("root")!).render(\n  <StrictMode>\n    <App />\n  </StrictMode>\n)');

  if (isSupabase) {
    addFile('src/components/Auth.tsx',
      'import { useState } from "react"\n'
      + 'import { supabase } from "../supabase"\n\n'
      + 'export function Auth() {\n'
      + '  const [email, setEmail] = useState("")\n'
      + '  const [password, setPassword] = useState("")\n'
      + '  const [loading, setLoading] = useState(false)\n'
      + '  const [mode, setMode] = useState<"login"|"signup">("login")\n'
    + '  const [msg, setMsg] = useState("")\n\n'
    + '  async function handleSubmit(e: React.FormEvent) {\n'
    + '    e.preventDefault()\n'
    + '    setLoading(true)\n'
    + '    setMsg("")\n'
    + '    const { error } = mode === "login"\n'
    + '      ? await supabase.auth.signInWithPassword({ email, password })\n'
    + '      : await supabase.auth.signUp({ email, password })\n'
    + '    if (error) setMsg(error.message)\n'
    + '    else if (mode === "signup") setMsg("Check your email to confirm your account!")\n'
    + '    setLoading(false)\n'
    + '  }\n\n'
    + '  return (\n'
    + '    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"#0a1628", fontFamily:"sans-serif" }}>\n'
    + '      <div style={{ background:"#0d1b2a", border:"1px solid #1e3044", borderRadius:"16px", padding:"40px", width:"100%", maxWidth:"400px", boxShadow:"0 20px 60px rgba(0,0,0,0.4)" }}>\n'
    + '        <div style={{ textAlign:"center", marginBottom:"32px" }}>\n'
    + '          <div style={{ fontSize:"32px", marginBottom:"8px" }}>🔋</div>\n'
    + '          <h1 style={{ color:"#fff", fontSize:"22px", fontWeight:"700", margin:"0 0 6px" }}>' + projName + '</h1>\n'
    + '          <p style={{ color:"#556677", fontSize:"13px", margin:0 }}>{mode === "login" ? "Sign in to continue" : "Create your account"}</p>\n'
    + '        </div>\n'
    + '        <form onSubmit={handleSubmit} style={{ display:"flex", flexDirection:"column", gap:"14px" }}>\n'
    + '          <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required\n'
    + '            style={{ background:"rgba(255,255,255,0.04)", border:"1px solid #1e3044", borderRadius:"8px", padding:"12px 16px", color:"#fff", fontSize:"14px", outline:"none", fontFamily:"inherit" }} />\n'
    + '          <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required\n'
    + '            style={{ background:"rgba(255,255,255,0.04)", border:"1px solid #1e3044", borderRadius:"8px", padding:"12px 16px", color:"#fff", fontSize:"14px", outline:"none", fontFamily:"inherit" }} />\n'
    + '          {msg && <div style={{ fontSize:"12px", color: msg.includes("Check") ? "#4ade80" : "#f87171", textAlign:"center" }}>{msg}</div>}\n'
    + '          <button type="submit" disabled={loading}\n'
    + '            style={{ background:"linear-gradient(135deg,#7c3aed,#a78bfa)", color:"#fff", border:"none", borderRadius:"8px", padding:"13px", fontSize:"14px", fontWeight:"700", cursor:"pointer", fontFamily:"inherit", opacity: loading ? 0.6 : 1 }}>\n'
    + '            {loading ? "…" : mode === "login" ? "Sign In" : "Create Account"}\n'
    + '          </button>\n'
    + '        </form>\n'
    + '        <div style={{ textAlign:"center", marginTop:"20px", fontSize:"13px", color:"#556677" }}>\n'
    + '          {mode === "login" ? "No account? " : "Have an account? "}\n'
    + '          <span onClick={() => setMode(mode === "login" ? "signup" : "login")} style={{ color:"#a78bfa", cursor:"pointer", fontWeight:"600" }}>\n'
    + '            {mode === "login" ? "Sign up" : "Sign in"}\n'
    + '          </span>\n'
    + '        </div>\n'
    + '      </div>\n'
    + '    </div>\n'
    + '  )\n'
    + '}');

  addFile('src/components/Dashboard.tsx',
    'import { supabase } from "../supabase"\n\n'
    + 'interface Props { session: any }\n\n'
    + 'export function Dashboard({ session }: Props) {\n'
    + '  async function signOut() { await supabase.auth.signOut() }\n\n'
    + '  return (\n'
    + '    <div style={{ display:"flex", flexDirection:"column", height:"100vh", background:"#0a1628" }}>\n'
    + '      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 16px", background:"#0d1b2a", borderBottom:"1px solid #1e3044", flexShrink:0 }}>\n'
    + '        <span style={{ color:"#a78bfa", fontFamily:"sans-serif", fontSize:"13px", fontWeight:"700" }}>🔋 ' + projName + '</span>\n'
    + '        <div style={{ display:"flex", alignItems:"center", gap:"12px" }}>\n'
    + '          <span style={{ color:"#556677", fontFamily:"sans-serif", fontSize:"12px" }}>{session.user.email}</span>\n'
    + '          <button onClick={signOut} style={{ background:"none", border:"1px solid #1e3044", borderRadius:"6px", color:"#556677", fontSize:"12px", padding:"4px 12px", cursor:"pointer", fontFamily:"sans-serif" }}>Sign out</button>\n'
    + '        </div>\n'
    + '      </div>\n'
    + '      <iframe src="/tool.html" style={{ flex:1, border:"none", width:"100%", height:"100%" }} title="' + projName + ' Tool" />\n'
    + '    </div>\n'
    + '  )\n'
    + '}');
  } // end isSupabase components

  setProgress(75);
  log('✓ React components created', 'done');
  log('Building public/tool.html…');

  // Vite-only: preserve original HTML completely untouched — no strip/re-inject needed
  // Supabase: re-inject extracted CSS/JS so the iframe gets clean standalone HTML
  if (isSupabase) {
    var headLinks2 = cdnLinks.links.length ? '\n' + cdnLinks.links.map(function(l){ return '  ' + l.replace(' />', '>'); }).join('\n') : '';
    var toolHtml = cleanHtml
      .replace('</head>', headLinks2 + '\n  <style>\n' + cssContent + '\n  </style>\n</head>')
      .replace('</body>', '<script>\n' + jsContent + '\n<\/script>\n</body>');
    addFile('public/tool.html', toolHtml);
  } else {
    // Vite-only: original file goes in untouched
    addFile('public/tool.html', htmlContent);
  }

  addFile('index.html', isSupabase
    ? '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>' + projName + '</title>\n  <link rel="stylesheet" href="/globals.css" />\n</head>\n<body>\n  <div id="root"></div>\n  <script type="module" src="/src/main.tsx"><\/script>\n</body>\n</html>'
    : '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>' + projName + '</title>\n</head>\n<body>\n  <div id="root"></div>\n  <script type="module" src="/src/main.tsx"><\/script>\n</body>\n</html>');

  setProgress(90);
  log('✓ public/tool.html ready', 'done');
  log('Finalising workspace…');

  workspaces.push(newWs);
  activeWsId = newWs.id;
  syncWorkspaceUI();
  renderTree();
  renderWsTabs();

  setProgress(100);
  setStatus('✓ Done!');
  log('✓ ' + projName + '-vite ready — ' + newWs.allFilePaths.length + ' files generated', 'done');

  var resultDiv = document.createElement('div');
  resultDiv.className = 'nxc-result';
  resultDiv.style.cssText = 'background:rgba(124,58,237,0.08);border-color:rgba(167,139,250,0.25);color:#a78bfa';
  resultDiv.innerHTML = '✓ <b>' + projName + '-vite</b> created.<br>Fill in <code>.env</code> with your Supabase keys, push to GitHub, connect Vercel.';
  body.appendChild(resultDiv);

  var finalBtnRow = document.createElement('div');
  finalBtnRow.style.cssText = 'display:flex;gap:8px;margin-top:4px';
  var ghBtn2 = document.createElement('button');
  ghBtn2.className = 'nxc-btn';
  ghBtn2.style.cssText = 'background:#15202b;border:1px solid #1e3044;color:#c8c8e0;font-size:12px;padding:8px 16px;border-radius:7px;cursor:pointer;font-family:inherit;font-weight:700';
  ghBtn2.textContent = '⎇ Push to GitHub';
  ghBtn2.onclick = function() { closeViteConverter(); _ghTab='push'; openGithubPanel(); };
  var closeBtn3 = document.createElement('button');
  closeBtn3.className = 'nxc-btn';
  closeBtn3.style.cssText = 'background:#060f18;border:1px solid #1e3044;color:#556677;font-size:12px;padding:8px 16px;border-radius:7px;cursor:pointer;font-family:inherit;font-weight:700';
  closeBtn3.textContent = 'Close';
  closeBtn3.onclick = function() { _vtcConverting = false; closeViteConverter(); };
  finalBtnRow.appendChild(ghBtn2);
  finalBtnRow.appendChild(closeBtn3);
  body.appendChild(finalBtnRow);

  _vtcConverting = false;
  setTimeout(function() {
    var configPath = prefix + 'src/config.ts';
    var envPath = prefix + '.env';
    var openPath = (extraKeys.length && newWs.allFilePaths.indexOf(configPath) !== -1) ? configPath : envPath;
    if (newWs.allFilePaths.indexOf(openPath) !== -1) openFile(openPath);
    // VEX message
    if (!vexChatOpen) vexToggleChat();
    var origWs = workspaces.find(function(w){ return w.id !== newWs.id && w.name !== newWs.name; });
    vexAddMsg('✅ <b>' + newWs.name + '</b> is ready — ' + newWs.allFilePaths.length + ' files generated in a new workspace.<br><br>'
      + (origWs ? '📁 Your original <b>' + origWs.name + '</b> is still here — switch back any time using the workspace tabs at the top of the sidebar.<br><br>' : '')
      + 'Next steps:');
    vexAddBtns([
      { label: '⎇ Push to GitHub', action: function() { closeViteConverter(); _ghTab='push'; openGithubPanel(); } },
      { label: '📄 Open .env', action: function() { if (newWs.allFilePaths.indexOf(envPath) !== -1) openFile(envPath); } },
    ]);
  }, 300);
}

var _nxcPages = []; // {path, route, selected}
var _nxcConverting = false;

function openNextjsConverter() {
  if (!vexChatOpen) vexToggleChat();
  vexAddMsg('▲ <b>Convert to Next.js</b><br><br>This takes your <b>HTML website</b> and turns it into a proper <b>Next.js App Router</b> project — React components, extracted CSS, CDN links preserved, inline JS bundled in.<br><br>Best for: <b>marketing sites, landing pages, content sites</b> that need SEO and server rendering.<br><br>Want me to open the converter?');
  vexAddBtns([
    { label: '✅ Yes, convert it', action: function() { document.getElementById('nxcOverlay').classList.add('open'); renderNxcPanel(); } },
    { label: '✕ Not now', action: function() {} }
  ]);
}
function closeNextjsConverter() {
  if (_nxcConverting) return;
  document.getElementById('nxcOverlay').classList.remove('open');
}

// ══════════════════════════════
//  VITE → STANDALONE HTML CONVERTER
// ══════════════════════════════
let _vthConverting = false;

function openViteToHtmlConverter() {
  const w = ws();
  if (!w || !w.allFilePaths.length) {
    toast('Open a Vite project first', 'error');
    return;
  }

  // Check it looks like a Vite project
  const hasViteConfig = w.allFilePaths.some(p => p.includes('vite.config'));
  const hasPackageJson = w.allFilePaths.some(p => p.endsWith('package.json'));
  const hasIndexHtml = w.allFilePaths.some(p => p.endsWith('index.html'));

  if (!hasViteConfig && !hasPackageJson) {
    toast('No Vite project detected in workspace', 'error');
    return;
  }

  if (!vexChatOpen) vexToggleChat();
  vexAddMsg(`🗜 <b>Vite → Standalone HTML</b><br><br>
I'll convert your Vite project into a <b>single self-contained HTML file</b> — all CSS and JS inlined, no build step needed.<br><br>
<b>Works best for:</b> vanilla JS, simple Vue/React, tools, calculators, dashboards<br>
<b>Not ideal for:</b> complex routing, heavy npm deps, SSR<br><br>
Ready to convert <b>${w.name}</b>?`);

  vexAddBtns([
    { label: '✅ Convert now', action: runViteToHtml },
    { label: '✕ Cancel', action: function() {} }
  ]);
}

async function runViteToHtml() {
  if (_vthConverting) return;
  const w = ws();
  if (!w) { toast('No workspace', 'error'); return; }
  _vthConverting = true;

  const SKIP = /node_modules|dist\/|\.git|\.next|build\/|\.(png|jpg|jpeg|gif|ico|woff|ttf|eot|map|lock)$/;

  // ── 1. Find entry files ──
  const indexHtml = w.allFilePaths.find(p => p.endsWith('index.html')) || '';
  const mainJs = w.allFilePaths.find(p => /main\.(js|ts|jsx|tsx)$/.test(p)) || '';
  const appFile = w.allFilePaths.find(p => /App\.(js|ts|jsx|tsx|vue)$/.test(p)) || '';
  const cssFiles = w.allFilePaths.filter(p => p.endsWith('.css') && !SKIP.test(p));
  const jsFiles = w.allFilePaths.filter(p => /\.(js|ts|jsx|tsx|vue)$/.test(p) && !SKIP.test(p));

  vexAddMsg(`🔍 Found ${jsFiles.length} JS/TS files, ${cssFiles.length} CSS files…`);

  // ── 2. Collect all CSS ──
  let allCss = '';
  cssFiles.forEach(p => {
    let css = getFileContent(p) || w.fileContents[p] || '';
    // Strip @import statements (we're inlining everything)
    css = css.replace(/@import\s+['""][^'"]+['""];?\n?/g, '');
    allCss += `/* ${p.split('/').pop()} */\n${css}\n\n`;
  });

  // ── 3. Collect all JS — strip imports/exports ──
  let allJs = '';
  const processedPaths = new Set();

  function stripModuleSyntax(code) {
    return code
      // Remove import statements
      .replace(/^import\s+.*?from\s+['"][^'"]+['"]\s*;?\n?/gm, '')
      .replace(/^import\s+['"][^'"]+['"]\s*;?\n?/gm, '')
      // Remove export keywords (keep the declaration)
      .replace(/^export\s+default\s+/gm, '')
      .replace(/^export\s+(const|let|var|function|class)\s+/gm, '$1 ')
      .replace(/^export\s+\{[^}]*\}\s*;?\n?/gm, '')
      // Remove "use client" / "use server"
      .replace(/^['"]use (client|server)['"]\s*;?\n?/gm, '')
      // Convert JSX-style comments
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      // Simple JSX → DOM: React.createElement patterns already in JS
      .trim();
  }

  // Process entry files first, then rest
  const ordered = [...new Set([mainJs, appFile, ...jsFiles].filter(Boolean))];
  ordered.forEach(p => {
    if (processedPaths.has(p)) return;
    processedPaths.add(p);
    let code = getFileContent(p) || w.fileContents[p] || '';
    if (!code.trim()) return;
    code = stripModuleSyntax(code);
    if (code.trim()) allJs += `/* ${p.split('/').pop()} */\n${code}\n\n`;
  });

  // ── 4. Parse index.html base ──
  let baseHtml = getFileContent(indexHtml) || w.fileContents[indexHtml] || '';
  let title = 'App';
  let bodyContent = '';
  let headExtras = '';

  if (baseHtml) {
    const titleM = baseHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleM) title = titleM[1].trim();

    // Extract any CDN links/scripts from head
    const linkRe = /<link[^>]+href=["']https?:\/\/[^"']+["'][^>]*>/gi;
    const scriptCdnRe = new RegExp('<script[^>]+src=["\']https?:\\/\\/[^"\']+["\'][^>]*><\\/script>', 'gi');
    let m;
    while ((m = linkRe.exec(baseHtml)) !== null) headExtras += '\n  ' + m[0];
    while ((m = scriptCdnRe.exec(baseHtml)) !== null) headExtras += '\n  ' + m[0];

    // Get body content
    const bodyM = baseHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyM) {
      bodyContent = bodyM[1]
        // Strip vite module scripts
        .replace(new RegExp('<script[^>]+type=["\']module["\'][^>]*>[\\s\\S]*?<\\/script>', 'gi'), '')
        .replace(new RegExp('<script[^>]+src=["\'][^"\']*\\.(js|ts)["\'][^>]*><\\/script>', 'gi'), '')
        .trim();
    }
  }

  // ── 5. Build standalone HTML ──
  const outPath = (w.name || 'app') + '-standalone.html';
  const scriptClose = '<' + '/script>';
  const scriptOpen = '<script>';
  const outContent = '<!DOCTYPE html>\n'
    + '<html lang="en">\n'
    + '<head>\n'
    + '  <meta charset="UTF-8">\n'
    + '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
    + '  <title>' + title + '</title>' + headExtras + '\n'
    + '  <style>\n'
    + (allCss.trim() || '/* no CSS found */') + '\n'
    + '  </style>\n'
    + '</head>\n'
    + '<body>\n'
    + (bodyContent || '  <div id="app"></div>') + '\n'
    + '  ' + scriptOpen + '\n'
    + (allJs.trim() || '/* no JS found */') + '\n'
    + '  ' + scriptClose + '\n'
    + '</body>\n'
    + '</html>';

  // ── 6. Write to workspace ──
  if (!w.allFilePaths.includes(outPath)) w.allFilePaths.push(outPath);
  w.fileContents[outPath] = outContent;
  w.modifiedFiles.add(outPath);
  if (w.editorModels[outPath]) {
    w.editorModels[outPath].setValue(outContent);
  } else {
    w.editorModels[outPath] = monaco.editor.createModel(outContent, 'html');
  }
  if (!w.openTabs.find(t => t.path === outPath)) {
    w.openTabs.push({ path: outPath, name: outPath.split('/').pop() });
  }
  w.activeTab = outPath;
  editor.setModel(w.editorModels[outPath]);
  renderTabs();
  renderTree();

  const lines = outContent.split('\n').length;
  vexAddMsg('✅ <b>Converted!</b> <code>' + outPath + '</code> (' + lines + ' lines)<br><br>'
    + 'All CSS inlined · JS imports stripped · CDN links preserved<br>'
    + '<span style="color:#f59e0b;font-size:11px">⚠ If app uses React/Vue JSX, check for render errors — complex component trees may need manual fixes.</span>');

  vexAddBtns([
    { label: '👁 Preview', action: function() { if(typeof showPreview === 'function') showPreview(outPath); } },
    { label: '✓ Done', action: function() {} }
  ]);
  vexCelebrate();
  _vthConverting = false;
}

function htmlPathToNextRoute(path) {
  // my-site/index.html → / (home)
  // my-site/about.html → /about
  // my-site/blog/post.html → /blog/post
  var parts = path.split('/');
  var file = parts[parts.length - 1];
  if (!file.endsWith('.html')) return null;
  var name = file.replace('.html', '');
  // Build route from folder structure (strip workspace prefix)
  var routeParts = parts.slice(1, -1); // remove workspace prefix and filename
  if (name === 'index') {
    return '/' + routeParts.join('/');
  }
  return '/' + [...routeParts, name].join('/');
}

function renderNxcPanel() {
  var body = document.getElementById('nxcBody');
  body.innerHTML = '';
  _nxcConverting = false;

  if (!ws() || ws().allFilePaths.length === 0) {
    body.innerHTML = '<div class="nxc-info">Open a project with HTML files first.</div>';
    return;
  }

  // Find HTML files — skip assets/, node_modules/, .next/, vendor/ folders
  var htmlFiles = ws().allFilePaths.filter(function(p) {
    if (!p.endsWith('.html')) return false;
    var lower = p.toLowerCase();
    if (lower.includes('/node_modules/')) return false;
    if (lower.includes('/.next/')) return false;
    if (lower.includes('/assets/')) return false;
    if (lower.includes('/vendor/')) return false;
    if (lower.includes('/dist/')) return false;
    return true;
  });

  if (htmlFiles.length === 0) {
    body.innerHTML = '<div class="nxc-info">No HTML files found in the current workspace.<br>Open a folder containing .html files to convert.</div>';
    return;
  }

  // Info box
  var info = document.createElement('div');
  info.className = 'nxc-info';
  info.innerHTML = '▲ VEX will convert each HTML page into a Next.js <code style="color:#fff">app/page.tsx</code> component.<br>'
    + 'Your styles, images and assets stay in <code style="color:#fff">public/</code>. CSS becomes <code style="color:#fff">globals.css</code>.<br>'
    + 'The result is a fully deployable Next.js project — push to GitHub, connect Vercel, get SEO.';
  body.appendChild(info);

  // Page list
  var listLabel = document.createElement('div');
  listLabel.className = 'nxc-section-title';
  listLabel.textContent = 'Pages to convert (' + htmlFiles.length + ' found)';
  body.appendChild(listLabel);

  _nxcPages = htmlFiles.map(function(path) {
    return { path: path, route: htmlPathToNextRoute(path), selected: true };
  });

  // If only one HTML file, always map it to root / regardless of filename
  if (_nxcPages.length === 1 && _nxcPages[0].route !== null) {
    _nxcPages[0].route = '/';
  }

  var list = document.createElement('div');
  list.className = 'nxc-file-list';
  _nxcPages.forEach(function(page, i) {
    var row = document.createElement('div');
    row.className = 'nxc-file-row';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'nxc-file-check';
    cb.checked = true;
    cb.onchange = function() { _nxcPages[i].selected = cb.checked; };
    var nameEl = document.createElement('span');
    nameEl.className = 'nxc-file-name';
    nameEl.textContent = page.path.split('/').slice(1).join('/');
    var routeEl = document.createElement('span');
    if (page.route !== null) {
      routeEl.className = 'nxc-file-route';
      routeEl.textContent = page.route || '/';
    } else {
      routeEl.className = 'nxc-file-skip';
      routeEl.textContent = 'skip (not a page)';
      cb.checked = false;
      _nxcPages[i].selected = false;
    }
    row.appendChild(cb);
    row.appendChild(nameEl);
    row.appendChild(routeEl);
    list.appendChild(row);
  });
  body.appendChild(list);

  // Project name
  var nameLabel = document.createElement('div');
  nameLabel.className = 'nxc-section-title';
  nameLabel.style.marginTop = '6px';
  nameLabel.textContent = 'New project name';
  body.appendChild(nameLabel);

  var nameRow = document.createElement('div');
  nameRow.style.cssText = 'display:flex;gap:8px;align-items:center';
  var nameInp = document.createElement('input');
  nameInp.className = 'nxc-input';
  nameInp.value = (ws() ? ws().name : 'my-site') + '-nextjs';
  nameInp.style.flex = '1';
  var goBtn = document.createElement('button');
  goBtn.className = 'nxc-btn';
  goBtn.textContent = '▲ Convert to Next.js';
  goBtn.onclick = function() { runNxcConversion(nameInp.value.trim() || 'my-nextjs-site', body); };
  nameRow.appendChild(nameInp);
  nameRow.appendChild(goBtn);
  body.appendChild(nameRow);
}

async function runNxcConversion(projectName, body) {
  console.log('[nxc] runNxcConversion started, projectName=', projectName);
  var key = vexGetKey();
  console.log('[nxc] key present:', !!key, 'length:', key.length);
  if (!key) {
    body.innerHTML += '<div class="nxc-info" style="border-color:rgba(248,113,113,0.3);color:#f87171">No Claude API key — enter it in the sidebar first.</div>';
    return;
  }

  var pagesToConvert = _nxcPages.filter(function(p) { return p.selected && p.route !== null; });
  console.log('[nxc] pages to convert:', pagesToConvert.length, pagesToConvert.map(function(p){return p.path;}));
  if (pagesToConvert.length === 0) {
    body.innerHTML += '<div class="nxc-info" style="border-color:rgba(248,113,113,0.3);color:#f87171">No pages selected.</div>';
    return;
  }

  _nxcConverting = true;

  // Replace body content with progress UI
  body.innerHTML = '';
  var progress = document.createElement('div');
  progress.className = 'nxc-progress';
  var barWrap = document.createElement('div');
  barWrap.className = 'nxc-progress-bar-wrap';
  var bar = document.createElement('div');
  bar.className = 'nxc-progress-bar';
  bar.style.width = '0%';
  barWrap.appendChild(bar);
  var logEl = document.createElement('div');
  logEl.className = 'nxc-log';
  progress.appendChild(barWrap);
  progress.appendChild(logEl);
  body.appendChild(progress);

  function log(msg, type) {
    var line = document.createElement('div');
    line.className = 'nxc-log-line' + (type ? ' ' + type : '');
    line.innerHTML = msg;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setProgress(pct) {
    bar.style.width = pct + '%';
  }

  // Create new workspace for Next.js project
  var newWs = createWorkspace(projectName);
  var prefix = projectName + '/';

  log('Creating Next.js project structure…');
  setProgress(5);

  // Add base Next.js files
  var nextFiles = {
    'package.json': JSON.stringify({name:projectName,version:'0.1.0',private:true,scripts:{dev:'next dev',build:'next build',start:'next start'},dependencies:{next:'15.3.6',react:'^18','react-dom':'^18'},devDependencies:{'@types/node':'^22','@types/react':'^18','@types/react-dom':'^18',typescript:'^5'}}, null, 2),
    'next.config.js': "/** @type {import('next').NextConfig} */\nconst nextConfig = {\n  reactStrictMode: true,\n  typescript: { ignoreBuildErrors: true },\n  eslint: { ignoreDuringBuilds: true },\n}\nmodule.exports = nextConfig",
    'tsconfig.json': JSON.stringify({compilerOptions:{lib:['dom','dom.iterable','esnext'],allowJs:true,skipLibCheck:true,strict:false,noEmit:true,esModuleInterop:true,module:'esnext',moduleResolution:'bundler',resolveJsonModule:true,isolatedModules:true,jsx:'preserve',incremental:true,paths:{'@/*':['./*']}},include:['next-env.d.ts','**/*.ts','**/*.tsx'],exclude:['node_modules']}, null, 2),
    'next-env.d.ts': '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n// NOTE: This file should not be edited\n// see https://nextjs.org/docs/app/building-your-application/configuring/typescript for more information.',
    'vercel.json': JSON.stringify({framework:'nextjs',buildCommand:'next build',headers:[{source:'/(.*)',headers:[{key:'Cross-Origin-Opener-Policy',value:'same-origin'},{key:'Cross-Origin-Embedder-Policy',value:'require-corp'}]}]}, null, 2),
    '.gitignore': 'node_modules\n.next\ndist\n.env\n.env.local',
    'app/globals.css': '',
  };

  // Copy CSS files into globals.css
  var cssFiles = ws().allFilePaths.filter(function(p){ return p.endsWith('.css'); });
  var combinedCss = '';
  cssFiles.forEach(function(p) {
    combinedCss += '/* from: ' + p.split('/').slice(1).join('/') + ' */\n';
    combinedCss += (ws().fileContents[p] || '') + '\n\n';
  });
  nextFiles['app/globals.css'] = combinedCss;

  // Copy non-HTML, non-CSS assets to public/ (preserving folder structure)
  // e.g. my-site/images/hero.png → public/images/hero.png → served at /images/hero.png
  ws().allFilePaths.forEach(function(p) {
    var ext = p.split('.').pop().toLowerCase();
    var assets = ['png','jpg','jpeg','gif','webp','svg','ico','mp4','mp3','pdf','woff','woff2','ttf','otf','eot'];
    if (assets.includes(ext)) {
      var relativePath = p.split('/').slice(1).join('/'); // strip workspace prefix
      var publicPath = 'public/' + relativePath;
      var content = ws().fileContents[p];
      if (content !== undefined && content !== '') {
        nextFiles[publicPath] = content;
      }
      // Note: binary files not loaded into memory are skipped but path mapping is correct
    }
  });

  // Add layout.tsx
  // Extract CDN links from all source HTML pages for layout.tsx
  var _cdnLinks = [];
  var _cdnScripts = [];
  pagesToConvert.forEach(function(pg) {
    var _html = ws().fileContents[pg.path] || '';
    var _cdn = extractCdnLinksFromHtml(_html);
    _cdn.links.forEach(function(l) { if (_cdnLinks.indexOf(l) === -1) _cdnLinks.push(l); });
    _cdn.scripts.forEach(function(s) { if (_cdnScripts.indexOf(s) === -1) _cdnScripts.push(s); });
  });
  var _headTags = _cdnLinks.length ? '\n        ' + _cdnLinks.join('\n        ') : '';
  var _scriptTags = _cdnScripts.length ? '\n        ' + _cdnScripts.join('\n        ') : '';
  nextFiles['app/layout.tsx'] = "import './globals.css'\nexport const metadata = { title: '" + projectName + "', description: 'Converted by VEX Studio' }\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return (\n    <html lang=\"en\">\n      <head>" + _headTags + "\n      </head>\n      <body>{children}" + _scriptTags + "\n      </body>\n    </html>\n  )\n}";

  // Write base files to workspace
  Object.keys(nextFiles).forEach(function(path) {
    newWs.fileContents[prefix + path] = nextFiles[path];
    newWs.allFilePaths.push(prefix + path);
  });

  log('✓ Base structure created', 'done');
  setProgress(10);

  // Convert each HTML page with Claude
  var total = pagesToConvert.length;
  for (var i = 0; i < total; i++) {
    var page = pagesToConvert[i];
    var htmlContent = ws().fileContents[page.path] || '';
    var route = page.route || '/';
    var isHome = route === '/';
    var nextPath = isHome ? 'app/page.jsx' : 'app' + route + '/page.jsx';

    log('Converting <code>' + page.path.split('/').slice(1).join('/') + '</code> → <code>' + nextPath + '</code>…');
    setProgress(10 + Math.round((i / total) * 80));

    try {
      console.log('[nxc] calling API for page:', page.path, 'html length:', htmlContent.length);
      var streamLog = null;
      log('⚡ Converting… (instant local conversion, no API needed)');
      var result = await convertHtmlToNextPage(htmlContent, route, projectName, key, function(partial) {
        if (!streamLog) {
          streamLog = document.createElement('div');
          streamLog.className = 'nxc-log-line';
          streamLog.style.cssText = 'font-family:monospace;font-size:10px;color:#4ade80;max-height:60px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis';
          logEl.appendChild(streamLog);
        }
        streamLog.textContent = '↳ ' + partial.slice(-120);
        logEl.scrollTop = logEl.scrollHeight;
      });
      // Save inline JS to public/page-scripts.js
      if (result.js && result.js.trim()) {
        var jsFilePath = prefix + 'public/page-scripts.js';
        var existingJs = newWs.fileContents[jsFilePath] || '';
        newWs.fileContents[jsFilePath] = existingJs + result.js;
        if (newWs.allFilePaths.indexOf(jsFilePath) === -1) newWs.allFilePaths.push(jsFilePath);
      }
      // Inject Next.js Script tag + import into tsx
      var finalTsx = result.tsx;
      // Ensure eslint-disable is present
      if (!finalTsx.startsWith('/* eslint-disable */')) {
        finalTsx = '/* eslint-disable */\n' + finalTsx;
      }
      if (result.js && result.js.trim()) {
        finalTsx = finalTsx.replace(
          'import Link from "next/link"',
          'import Link from "next/link"\nimport Script from "next/script"'
        );
        finalTsx = finalTsx.replace(
          '\n    <>\n',
          '\n    <>\n      <Script src="/page-scripts.js" strategy="afterInteractive" />\n'
        );
      }
      newWs.fileContents[prefix + nextPath] = finalTsx;
      newWs.allFilePaths.push(prefix + nextPath);
      // Append extracted CSS to globals.css
      if (result.css) {
        var existingCss = newWs.fileContents[prefix + 'app/globals.css'] || '';
        var newCss = existingCss + '\n\n/* from ' + page.path.split('/').pop() + ' */\n' + result.css;
        // Balance braces to prevent PostCSS syntax errors on Vercel
        var open = (newCss.match(/\{/g) || []).length;
        var close = (newCss.match(/\}/g) || []).length;
        if (close > open) {
          var diff = close - open;
          for (var bi = 0; bi < diff; bi++) { var last = newCss.lastIndexOf('}'); if (last !== -1) newCss = newCss.slice(0, last) + newCss.slice(last + 1); }
        } else if (open > close) { newCss += '\n}'.repeat(open - close); }
        newWs.fileContents[prefix + 'app/globals.css'] = newCss;
      }
      log('✓ ' + nextPath, 'done');
    } catch(e) {
      log('✗ Failed: ' + e.message, 'err');
      // Fallback: wrap raw HTML in a basic component
      newWs.fileContents[prefix + nextPath] = fallbackNextPage(htmlContent, route);
      newWs.allFilePaths.push(prefix + nextPath);
      log('↩ Used fallback wrapper for ' + nextPath, '');
    }
  }

  setProgress(95);
  log('Finalising workspace…');

  workspaces.push(newWs);
  activeWsId = newWs.id;
  syncWorkspaceUI();
  renderTree();
  renderWsTabs();

  setProgress(100);
  log('✓ Done! ' + total + ' page' + (total===1?'':'s') + ' converted.', 'done');

  // Result card
  var result = document.createElement('div');
  result.className = 'nxc-result';
  result.innerHTML = '✓ <b>' + projectName + '</b> created with <b>' + total + ' page' + (total===1?'':'s') + '</b>.<br>'
    + 'Next: push to GitHub → connect Vercel → your site is live with full SEO.';
  body.appendChild(result);

  var btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;margin-top:4px';
  var ghBtn = document.createElement('button');
  ghBtn.className = 'nxc-btn';
  ghBtn.style.cssText = 'background:#15202b;border:1px solid #1e3044;color:#c8c8e0;font-size:12px;padding:8px 16px;border-radius:7px;cursor:pointer;font-family:inherit;font-weight:700';
  ghBtn.textContent = '⎇ Push to GitHub';
  ghBtn.onclick = function() { closeNextjsConverter(); _ghTab='push'; openGithubPanel(); };
  var closeBtn = document.createElement('button');
  closeBtn.className = 'nxc-btn';
  closeBtn.style.cssText = 'background:#060f18;border:1px solid #1e3044;color:#556677;font-size:12px;padding:8px 16px;border-radius:7px;cursor:pointer;font-family:inherit;font-weight:700';
  closeBtn.textContent = 'Close';
  closeBtn.onclick = function() { _nxcConverting=false; closeNextjsConverter(); };
  btnRow.appendChild(ghBtn);
  btnRow.appendChild(closeBtn);
  body.appendChild(btnRow);

  _nxcConverting = false;

  // Open layout.tsx
  setTimeout(function() {
    var layoutPath = prefix + 'app/layout.tsx';
    if (newWs.allFilePaths.includes(layoutPath)) openFile(layoutPath);
    // VEX message
    if (!vexChatOpen) vexToggleChat();
    var origWs = workspaces.find(function(w){ return w.id !== newWs.id; });
    vexAddMsg('✅ <b>' + newWs.name + '</b> is ready — ' + total + ' page' + (total===1?'':'s') + ' converted, ' + newWs.allFilePaths.length + ' files in a new workspace.<br><br>'
      + (origWs ? '📁 Your original <b>' + origWs.name + '</b> is still here — switch back any time using the workspace tabs at the top of the sidebar.<br><br>' : '')
      + 'Next steps:');
    vexAddBtns([
      { label: '⎇ Push to GitHub', action: function() { closeNextjsConverter(); _ghTab='push'; openGithubPanel(); } },
      { label: '📄 View layout.tsx', action: function() { var p = prefix+'app/layout.tsx'; if(newWs.allFilePaths.includes(p)) openFile(p); } },
    ]);
  }, 300);
}

async function extractCssFromHtml(html, apiKey, onChunk) {
  // Strip script blocks first to prevent JS strings like '</style>' from being captured
  var htmlNoScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  var styleMatches = [];
  var styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  var match;
  while ((match = styleRe.exec(htmlNoScripts)) !== null) {
    styleMatches.push(match[1].trim());
  }
  // If CSS is short enough, just return it directly without API call
  var combined = styleMatches.join('\n\n');
  if (combined.length < 500) return combined; // tiny or no CSS
  return combined; // return raw CSS - no need for AI to process CSS
}


function extractCdnLinksFromHtml(html) {
  // Extract CDN stylesheet links and scripts from HTML head/body
  // Uses simple string indexOf scanning to avoid regex conflicts
  var links = [];
  var scripts = [];
  var pos = 0;
  // scan all <link ...> tags
  while (true) {
    var start = html.toLowerCase().indexOf('<link', pos);
    if (start === -1) break;
    var end = html.indexOf('>', start);
    if (end === -1) break;
    var tag = html.slice(start, end + 1);
    var tagLow = tag.toLowerCase();
    var isStyle = tagLow.indexOf('stylesheet') !== -1 || tagLow.indexOf('preconnect') !== -1;
    if (isStyle) {
      var hStart = tagLow.indexOf('href=');
      if (hStart !== -1) {
        var q = tag[hStart + 5];
        var hEnd = tag.indexOf(q, hStart + 6);
        var href = tag.slice(hStart + 6, hEnd);
        if (href.indexOf('http') === 0 || href.indexOf('//') === 0) {
          // self-close the tag for JSX — strip any existing /> first
          var clean = tag.replace(/\s*\/?>$/, ' />');
          if (links.indexOf(clean) === -1) links.push(clean);
        }
      }
    }
    pos = end + 1;
  }
  // scan all <script ...> tags
  pos = 0;
  while (true) {
    var sStart = html.toLowerCase().indexOf('<script', pos);
    if (sStart === -1) break;
    var sEnd = html.indexOf('>', sStart);
    if (sEnd === -1) break;
    var stag = html.slice(sStart, sEnd + 1);
    var srcIdx = stag.toLowerCase().indexOf('src=');
    if (srcIdx !== -1) {
      var sq = stag[srcIdx + 4];
      var seEnd = stag.indexOf(sq, srcIdx + 5);
      var src = stag.slice(srcIdx + 5, seEnd);
      if (src.indexOf('http') === 0 || src.indexOf('//') === 0) {
        var fullScript = stag + '<' + '/script>';
        if (scripts.indexOf(fullScript) === -1) scripts.push(fullScript);
      }
    }
    pos = sEnd + 1;
  }
  return { links: links, scripts: scripts };
}

function convertHtmlToNextPage(html, route, siteName, apiKey, onChunk) {
  // Pure regex conversion — no API call needed
  var isHome = route === "/" || route === "";

  // 1. Extract inline scripts first (before stripping), then strip scripts before CSS extraction
  // This prevents JS strings containing '</style>' from polluting globals.css
  var inlineScripts = "";
  var scriptRe2 = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  var scrm;
  while ((scrm = scriptRe2.exec(html)) !== null) {
    var sAttrs = scrm[1] || "";
    var sBody = scrm[2] || "";
    if (sAttrs.indexOf("src=") === -1 && sBody.trim().length > 0) {
      inlineScripts += sBody.trim() + "\n\n";
    }
  }

  // Strip script blocks before extracting CSS to avoid JS code leaking into CSS output
  var htmlNoScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '');

  var cssContent = "";
  var styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  var sm;
  while ((sm = styleRe.exec(htmlNoScripts)) !== null) cssContent += sm[1].trim() + "\n\n";

  // 2. Extract metadata
  var titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  var metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  var pageTitle = titleMatch ? titleMatch[1].trim().replace(/â/g,"—") : siteName;
  var pageDesc = metaDesc ? metaDesc[1].trim() : "Converted by VEX Studio";

  // 3. Extract body
  var bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  var body = bodyMatch ? bodyMatch[1] : html;

  // 4. Strip style/script/link tags
  // Truncate at first <script — avoids regex breaking on script-close inside JS string literals
  var firstScriptIdx = body.toLowerCase().indexOf('<script');
  if (firstScriptIdx > -1) body = body.slice(0, firstScriptIdx);
  // Use split string concat to avoid HTML parser treating these as real closing tags
  var styleCloseRe = new RegExp('<style[^>]*>[\\s\\S]*?<\\/' + 'style>', 'gi');
  var linkRe = new RegExp('<link[^>]+>', 'gi');
  body = body.replace(styleCloseRe, '').replace(linkRe, '').trim();

  // 5. HTML comments → JSX comments
  body = body.replace(/<!--([\s\S]*?)-->/g, function(m, t) { return "{/*" + t + "*/}"; });

  // 6. HTML attributes → JSX attributes
  body = body
    .replace(/\sclass=/g, " className=")
    .replace(/\sfor=/g, " htmlFor=")
    .replace(/\stabindex=/g, " tabIndex=")
    .replace(/\scolspan=/g, " colSpan=")
    .replace(/\srowspan=/g, " rowSpan=")
    .replace(/\scellpadding=/g, " cellPadding=")
    .replace(/\scellspacing=/g, " cellSpacing=")
    .replace(/\snovalidate/g, " noValidate")
    .replace(/\sreadonly/g, " readOnly")
    .replace(/\smaxlength=/g, " maxLength=")
    .replace(/\sautocomplete=/g, " autoComplete=")
    .replace(/\sautofocus/g, " autoFocus")
    .replace(/\senctype=/g, " encType=")
    .replace(/\scrossorigin=/g, " crossOrigin=");

  // 7. SVG attributes → camelCase
  body = body
    .replace(/\sstroke-width=/g, " strokeWidth=")
    .replace(/\sstroke-linecap=/g, " strokeLinecap=")
    .replace(/\sstroke-linejoin=/g, " strokeLinejoin=")
    .replace(/\sstroke-dasharray=/g, " strokeDasharray=")
    .replace(/\sstroke-dashoffset=/g, " strokeDashoffset=")
    .replace(/\sfill-rule=/g, " fillRule=")
    .replace(/\sclip-rule=/g, " clipRule=")
    .replace(/\sclip-path=/g, " clipPath=")
    .replace(/\sview-box=/g, " viewBox=")
    .replace(/\sfont-size=/g, " fontSize=")
    .replace(/\sfont-family=/g, " fontFamily=")
    .replace(/\sfont-weight=/g, " fontWeight=")
    .replace(/\stext-anchor=/g, " textAnchor=")
    .replace(/\sdominant-baseline=/g, " dominantBaseline=")
    .replace(/\smarker-end=/g, " markerEnd=");

  // 8. Event handlers → JSX
  // Wrap bare function calls with (window as any). so TS doesn't error on unknown names.
  // Matches: word( or word.word( at the start of a call expression
  function wrapGlobals(code) {
    return code.replace(/"/g, "'");
  }
  body = body.replace(/\sonclick="([^"]*)"/g, function(m, code) {
    return " onClick={() => { " + wrapGlobals(code) + " }}";
  });
  body = body.replace(/\sonchange="([^"]*)"/g, function(m, code) {
    return " onChange={(e) => { " + wrapGlobals(code) + " }}";
  });
  body = body.replace(/\sonsubmit="([^"]*)"/g, function(m, code) {
    return " onSubmit={(e) => { e.preventDefault(); " + wrapGlobals(code) + " }}";
  });
  body = body.replace(/\sonkeyup="([^"]*)"/g, function(m, code) {
    return " onKeyUp={(e) => { " + wrapGlobals(code) + " }}";
  });
  body = body.replace(/\sonkeydown="([^"]*)"/g, function(m, code) {
    return " onKeyDown={(e) => { " + wrapGlobals(code) + " }}";
  });
  body = body.replace(/\sonmouseout="([^"]*)"/g, function(m, code) {
    return " onMouseOut={() => { " + wrapGlobals(code) + " }}";
  });
  body = body.replace(/\sonblur="([^"]*)"/g, function(m, code) {
    return " onBlur={(e) => { " + wrapGlobals(code) + " }}";
  });
  body = body.replace(/\sonfocus="([^"]*)"/g, function(m, code) {
    return " onFocus={(e) => { " + code.replace(/"/g, "'") + " }}";
  });
  body = body.replace(/\sonmouseover="([^"]*)"/g, function(m, code) {
    return " onMouseOver={() => { " + code.replace(/"/g, "'") + " }}";
  });

  // 9. Self-close void elements
  // Self-close void elements - but only outside of JSX expressions
  var voids = "area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr|canvas";
  // First protect arrow functions by temporarily replacing =>
  body = body.replace(/=>/g, "__ARROW__");
  body = body.replace(new RegExp("<(" + voids + ")([^>]*?)(?<!/)>", "gi"), "<$1$2 />");
  // Restore arrow functions
  body = body.replace(/__ARROW__/g, "=>");
  body = body.replace(new RegExp("<\/(" + voids + ")>", "gi"), "");

  // 10. style="..." string → style={{...}} object
  body = body.replace(/\sstyle="([^"]*)"/g, function(m, css) {
    var obj = css.replace(/\s*([a-z-]+)\s*:\s*([^;]+);?\s*/g, function(_, prop, val) {
      var camel = prop.replace(/-([a-z])/g, function(_, l) { return l.toUpperCase(); });
      val = val.trim();
      var numericProps = ["opacity","zIndex","flexGrow","flexShrink","order","fontWeight","lineHeight"];
      var isNum = numericProps.indexOf(camel) >= 0 && !isNaN(val);
      return camel + ":" + (isNum ? val : '"' + val.replace(/"/g, "'") + '"') + ",";
    });
    obj = obj.replace(/,$/, "");
    return " style={{" + obj + "}}";
  });

  // 11. Fix encoding artifacts (UTF-8 mojibake)
  body = body
    .replace(/Â£/g, "£").replace(/Â©/g, "©").replace(/Â·/g, "·")
    .replace(/Â±/g, "±").replace(/Ã—/g, "×").replace(/Ã·/g, "÷")
    .replace(/Î£/g, "Σ").replace(/Ï‚/g, "π")
    .replace(/Â/g, "")
    .replace(/â/g, "–");

  // 12. Remove html/head/body wrapper tags
  body = body.replace(/<\/?(html|head|body)[^>]*>/gi, "").trim();

  // 12b. Safety strip — remove any remaining script blocks that slipped through
  body = body.replace(new RegExp('<script[\\s\\S]*?<\\/scr' + 'ipt>', 'gi'), "").trim();

  // 13. Wrap in Next.js component
  var safeTitle = pageTitle.replace(/"/g, '\"');
  var safeDesc = pageDesc.replace(/"/g, '\"');
  var tsx = '/* eslint-disable */\n'
    + '"use client"\n\n'
    + 'import Image from "next/image"\n'
    + 'import Link from "next/link"\n\n'
    + 'export default function HomePage() {\n'
    + '  return (\n'
    + '    <>\n'
    + body.split("\n").map(function(l){ return "      " + l; }).join("\n")
    + '\n    </>\n  )\n}';
  if (onChunk) onChunk("Done!");
  return Promise.resolve({ tsx: tsx, css: cssContent, js: inlineScripts });
}
function fallbackNextPage(html, route) {
  var bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  var content = bodyMatch ? bodyMatch[1] : html;
  content = content.replace(/\sclass=/g, ' className=');
  return 'export default function Page() {\n  return (\n    <div dangerouslySetInnerHTML={{ __html: `' + content.replace(/`/g, '\\`') + '` }} />\n  )\n}';
}


// ══════════════════════════════
//  SCAFFOLD / VITE WRAPPER
// ══════════════════════════════
var _scaffoldMode = 'new'; // 'new' | 'wrap'
var _scaffoldSelected = null;

var SCAFFOLD_TEMPLATES = [
  {
    id: 'vite-react-ts',
    icon: '⚛',
    title: 'Vite + React + TypeScript',
    desc: 'Modern React app with TypeScript, hot reload, fast builds.',
    tags: ['Vite', 'React', 'TypeScript'],
    files: function(name) { return {
      'package.json': JSON.stringify({name:name,private:true,version:'0.0.0',type:'module',scripts:{dev:'vite',build:'vite build',preview:'vite preview'},dependencies:{react:'^18.3.1','react-dom':'^18.3.1'},devDependencies:{'@types/react':'^18.3.1','@types/react-dom':'^18.3.1','@vitejs/plugin-react':'^4.3.1',typescript:'^5.5.3',vite:'^5.4.1'}}, null, 2),
      'vite.config.ts': "import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\nexport default defineConfig({ plugins: [react()] })",
      'tsconfig.json': JSON.stringify({compilerOptions:{target:'ES2020',useDefineForClassFields:true,lib:['ES2020','DOM','DOM.Iterable'],module:'ESNext',skipLibCheck:true,moduleResolution:'bundler',allowImportingTsExtensions:true,isolatedModules:true,moduleDetection:'force',noEmit:true,jsx:'react-jsx',strict:true}}, null, 2),
      'index.html': '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>' + name + '</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <scr' + 'ipt type="module" src="/src/main.tsx"></scr' + 'ipt>\n  </body>\n</html>',
      'src/main.tsx': "import { StrictMode } from 'react'\nimport { createRoot } from 'react-dom/client'\nimport './index.css'\nimport App from './App.tsx'\ncreateRoot(document.getElementById('root')!).render(\n  <StrictMode><App /></StrictMode>,\n)",
      'src/App.tsx': "import { useState } from 'react'\nexport default function App() {\n  const [count, setCount] = useState(0)\n  return (\n    <div>\n      <h1>" + name + "</h1>\n      <button onClick={() => setCount(c => c + 1)}>Count: {count}</button>\n    </div>\n  )\n}",
      'src/index.css': 'body { margin: 0; font-family: system-ui, sans-serif; }',
      'vercel.json': JSON.stringify({headers:[{source:'/(.*)',headers:[{key:'Cross-Origin-Opener-Policy',value:'same-origin'},{key:'Cross-Origin-Embedder-Policy',value:'require-corp'}]}]}, null, 2),
      '.gitignore': 'node_modules\ndist\n.env\n.env.local',
      'README.md': '# ' + name + '\n\nVite + React + TypeScript.\n\n```\nnpm install\nnpm run dev\n```'
    };}
  },
  {
    id: 'vite-react-js',
    icon: '⚛',
    title: 'Vite + React + JavaScript',
    desc: 'React without TypeScript. Simpler, faster to start.',
    tags: ['Vite', 'React', 'JavaScript'],
    files: function(name) { return {
      'package.json': JSON.stringify({name:name,private:true,version:'0.0.0',type:'module',scripts:{dev:'vite',build:'vite build'},dependencies:{react:'^18.3.1','react-dom':'^18.3.1'},devDependencies:{'@vitejs/plugin-react':'^4.3.1',vite:'^5.4.1'}}, null, 2),
      'vite.config.js': "import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\nexport default defineConfig({ plugins: [react()] })",
      'index.html': '<!doctype html>\n<html lang="en">\n  <head><meta charset="UTF-8" /><title>' + name + '</title></head>\n  <body>\n    <div id="root"></div>\n    <scr' + 'ipt type="module" src="/src/main.jsx"></scr' + 'ipt>\n  </body>\n</html>',
      'src/main.jsx': "import { createRoot } from 'react-dom/client'\nimport App from './App.jsx'\ncreateRoot(document.getElementById('root')).render(<App />)",
      'src/App.jsx': "import { useState } from 'react'\nexport default function App() {\n  const [count, setCount] = useState(0)\n  return <div><h1>" + name + "</h1><button onClick={() => setCount(c=>c+1)}>Count: {count}</button></div>\n}",
      'vercel.json': JSON.stringify({headers:[{source:'/(.*)',headers:[{key:'Cross-Origin-Opener-Policy',value:'same-origin'},{key:'Cross-Origin-Embedder-Policy',value:'require-corp'}]}]}, null, 2),
      '.gitignore': 'node_modules\ndist\n.env\n.env.local'
    };}
  },
  {
    id: 'nextjs',
    icon: '▲',
    title: 'Next.js App Router',
    desc: 'Full-stack React with server components, API routes, SSR.',
    tags: ['Next.js', 'React', 'TypeScript', 'SSR'],
    files: function(name) { return {
      'package.json': JSON.stringify({name:name,version:'0.1.0',private:true,scripts:{dev:'next dev',build:'next build',start:'next start'},dependencies:{next:'15.3.6',react:'^18','react-dom':'^18'},devDependencies:{'@types/node':'^22','@types/react':'^18','@types/react-dom':'^18',typescript:'^5'}}, null, 2),
      'next.config.js': "/** @type {import('next').NextConfig} */\nconst nextConfig = {\n  reactStrictMode: true,\n  typescript: { ignoreBuildErrors: true },\n  eslint: { ignoreDuringBuilds: true },\n}\nmodule.exports = nextConfig",
      'tsconfig.json': JSON.stringify({compilerOptions:{lib:['dom','dom.iterable','esnext'],allowJs:true,skipLibCheck:true,strict:true,noEmit:true,esModuleInterop:true,module:'esnext',moduleResolution:'bundler',resolveJsonModule:true,isolatedModules:true,jsx:'preserve',incremental:true,plugins:[{name:'next'}],paths:{'@/*':['./*']}},include:['next-env.d.ts','**/*.ts','**/*.tsx','.next/types/**/*.ts'],exclude:['node_modules']}, null, 2),
      'app/layout.tsx': "export const metadata = { title: '" + name + "', description: 'Generated by VEX Studio' }\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return (<html lang=\"en\"><body>{children}</body></html>)\n}",
      'app/page.tsx': "export default function Home() {\n  return (\n    <main style={{padding:'2rem',fontFamily:'system-ui'}}>\n      <h1>" + name + "</h1>\n      <p>Edit <code>app/page.tsx</code> to get started.</p>\n    </main>\n  )\n}",
      'app/globals.css': 'body { margin: 0; font-family: system-ui, sans-serif; }',
      'next-env.d.ts': '/// <reference types="next" />\n/// <reference types="next/image-types/global" />',
      'vercel.json': JSON.stringify({framework:'nextjs',buildCommand:'next build',headers:[{source:'/(.*)',headers:[{key:'Cross-Origin-Opener-Policy',value:'same-origin'},{key:'Cross-Origin-Embedder-Policy',value:'require-corp'}]}]}, null, 2),
      '.gitignore': 'node_modules\n.next\ndist\n.env\n.env.local',
      'README.md': '# ' + name + '\n\nNext.js app.\n\n```\nnpm install\nnpm run dev\n```'
    };}
  },
  {
    id: 'vite-vanilla',
    icon: '⚡',
    title: 'Vite + Vanilla JS',
    desc: 'Pure JS/CSS/HTML with Vite bundler. No framework.',
    tags: ['Vite', 'JavaScript', 'CSS'],
    files: function(name) { return {
      'package.json': JSON.stringify({name:name,private:true,version:'0.0.0',type:'module',scripts:{dev:'vite',build:'vite build'},devDependencies:{vite:'^5.4.1'}}, null, 2),
      'vite.config.js': "import { defineConfig } from 'vite'\nexport default defineConfig({})",
      'index.html': '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <title>' + name + '</title>\n  <link rel="stylesheet" href="/style.css" />\n</head>\n<body>\n  <h1>' + name + '</h1>\n  <scr' + 'ipt type="module" src="/main.js"></scr' + 'ipt>\n</body>\n</html>',
      'main.js': "document.querySelector('h1').textContent = '" + name + " is running!'",
      'style.css': 'body { margin: 0; padding: 2rem; font-family: system-ui, sans-serif; background: #0d1b2a; color: #c8c8e0; }',
      'vercel.json': JSON.stringify({headers:[{source:'/(.*)',headers:[{key:'Cross-Origin-Opener-Policy',value:'same-origin'},{key:'Cross-Origin-Embedder-Policy',value:'require-corp'}]}]}, null, 2),
      '.gitignore': 'node_modules\ndist\n.env'
    };}
  },
  {
    id: 'vite-supabase',
    icon: '🔋',
    title: 'Vite + React + Supabase',
    desc: 'React app with Supabase auth and database pre-wired.',
    tags: ['Vite', 'React', 'Supabase', 'Auth'],
    files: function(name) { return {
      'package.json': JSON.stringify({name:name,private:true,version:'0.0.0',type:'module',scripts:{dev:'vite',build:'vite build'},dependencies:{react:'^18.3.1','react-dom':'^18.3.1','@supabase/supabase-js':'^2'},devDependencies:{'@vitejs/plugin-react':'^4.3.1',vite:'^5.4.1',typescript:'^5.5.3','@types/react':'^18','@types/react-dom':'^18'}}, null, 2),
      'vite.config.ts': "import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\nexport default defineConfig({ plugins: [react()] })",
      '.env.local': 'VITE_SUPABASE_URL=your-project-url\nVITE_SUPABASE_ANON_KEY=your-anon-key',
      'src/supabase.ts': "import { createClient } from '@supabase/supabase-js'\nexport const supabase = createClient(\n  import.meta.env.VITE_SUPABASE_URL,\n  import.meta.env.VITE_SUPABASE_ANON_KEY\n)",
      'src/main.tsx': "import { createRoot } from 'react-dom/client'\nimport App from './App'\ncreateRoot(document.getElementById('root')!).render(<App />)",
      'src/App.tsx': "import { useEffect, useState } from 'react'\nimport { supabase } from './supabase'\nexport default function App() {\n  const [session, setSession] = useState<any>(null)\n  useEffect(() => {\n    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))\n    supabase.auth.onAuthStateChange((_e, session) => setSession(session))\n  }, [])\n  return session\n    ? <div><p>Logged in as {session.user.email}</p><button onClick={() => supabase.auth.signOut()}>Sign out</button></div>\n    : <button onClick={() => supabase.auth.signInWithOAuth({ provider: 'github' })}>Sign in with GitHub</button>\n}",
      'index.html': '<!doctype html>\n<html lang="en">\n<head><meta charset="UTF-8" /><title>' + name + '</title></head>\n<body><div id="root"></div><scr' + 'ipt type="module" src="/src/main.tsx"></scr' + 'ipt></body>\n</html>',
      'vercel.json': JSON.stringify({headers:[{source:'/(.*)',headers:[{key:'Cross-Origin-Opener-Policy',value:'same-origin'},{key:'Cross-Origin-Embedder-Policy',value:'require-corp'}]}]}, null, 2),
      '.gitignore': 'node_modules\ndist\n.env\n.env.local',
      'README.md': '# ' + name + '\n\nVite + React + Supabase.\n\n1. Create a project at supabase.com\n2. Copy URL and anon key into `.env.local`\n3. `npm install && npm run dev`'
    };}
  },
  {
    id: 'html-wrap',
    icon: '🌐',
    title: 'Wrap HTML Tool in Vite',
    desc: 'Add Vite to your existing HTML/CSS/JS tool. Your code stays untouched.',
    tags: ['Wrap', 'HTML', 'Vite'],
    wrap: true,
    files: function(name) { return {
      'package.json': JSON.stringify({name:name,private:true,version:'0.0.0',type:'module',scripts:{dev:'vite',build:'vite build',preview:'vite preview'},devDependencies:{vite:'^5.4.1'}}, null, 2),
      'vite.config.js': "import { defineConfig } from 'vite'\nexport default defineConfig({})",
      'vercel.json': JSON.stringify({headers:[{source:'/(.*)',headers:[{key:'Cross-Origin-Opener-Policy',value:'same-origin'},{key:'Cross-Origin-Embedder-Policy',value:'require-corp'}]}]}, null, 2),
      '.gitignore': 'node_modules\ndist\n.env\n.env.local'
    };}
  }
];

function openScaffoldPanel() {
  _scaffoldSelected = null;
  _scaffoldMode = ws() && ws().allFilePaths.length > 0 ? 'wrap' : 'new';
  document.getElementById('scaffoldOverlay').classList.add('open');
  renderScaffoldPanel();
}

function closeScaffoldPanel() {
  document.getElementById('scaffoldOverlay').classList.remove('open');
}

function renderScaffoldPanel() {
  var body = document.getElementById('scaffoldBody');
  var title = document.getElementById('scaffoldTitle');
  var nameInp = document.getElementById('scaffoldNameInput');
  var goBtn = document.getElementById('scaffoldGoBtn');

  title.textContent = _scaffoldMode === 'wrap' ? '⚡ Wrap in Vite / New Project' : '⚡ New Project';

  body.innerHTML = '';

  // If workspace has files, show wrap notice
  if (ws() && ws().allFilePaths.length > 0) {
    var notice = document.createElement('div');
    notice.className = 'scaffold-wrap-notice';
    notice.innerHTML = '📁 Current workspace: <b style="color:#fff">' + ws().name + '</b> ('
      + ws().allFilePaths.length + ' files)<br>'
      + 'Selecting <b>Wrap HTML Tool in Vite</b> adds config files only — your existing code stays untouched.<br>'
      + 'Other templates create a <b>new separate workspace</b>.';
    body.appendChild(notice);
  }

  // Template grid
  var label = document.createElement('div');
  label.className = 'scaffold-section-title';
  label.textContent = 'Choose a template';
  body.appendChild(label);

  var grid = document.createElement('div');
  grid.className = 'scaffold-grid';

  SCAFFOLD_TEMPLATES.forEach(function(tpl) {
    var card = document.createElement('div');
    card.className = 'scaffold-card' + (_scaffoldSelected === tpl.id ? ' selected' : '');
    card.innerHTML = '<div class="scaffold-card-icon">' + tpl.icon + '</div>'
      + '<div class="scaffold-card-title">' + tpl.title + '</div>'
      + '<div class="scaffold-card-desc">' + tpl.desc + '</div>'
      + '<div class="scaffold-card-tags">' + tpl.tags.map(function(t){
          var cls = t === 'TypeScript' || t === 'SSR' ? ' blue' : t === 'Supabase' || t === 'Auth' ? ' green' : '';
          return '<span class="scaffold-tag' + cls + '">' + t + '</span>';
        }).join('') + '</div>';
    card.onclick = function() {
      _scaffoldSelected = tpl.id;
      if (!nameInp.value.trim()) {
        nameInp.value = tpl.wrap && ws() ? ws().name : 'my-app';
      }
      goBtn.disabled = false;
      renderScaffoldPanel();
    };
    grid.appendChild(card);
  });
  body.appendChild(grid);
}

function scaffoldGenerate() {
  if (!_scaffoldSelected) return;
  var name = document.getElementById('scaffoldNameInput').value.trim() || 'my-app';
  var tpl = SCAFFOLD_TEMPLATES.find(function(t){ return t.id === _scaffoldSelected; });
  if (!tpl) return;

  var files = tpl.files(name);
  closeScaffoldPanel();

  if (tpl.wrap && ws() && ws().allFilePaths.length > 0) {
    // Inject files into CURRENT workspace
    var curWs = ws();
    var prefix = curWs.allFilePaths.length ? curWs.allFilePaths[0].split('/')[0] + '/' : '';
    Object.keys(files).forEach(function(path) {
      var fullPath = prefix + path;
      if (!curWs.allFilePaths.includes(fullPath)) {
        curWs.fileContents[fullPath] = files[path];
        curWs.allFilePaths.push(fullPath);
        curWs.modifiedFiles.add(fullPath);
      }
    });
    renderTree();
    renderWsTabs();
    toast('✓ Vite wrapper added to ' + curWs.name, 'success');
    // Open package.json
    var pkgPath = prefix + 'package.json';
    if (curWs.allFilePaths.includes(pkgPath)) setTimeout(function(){ openFile(pkgPath); }, 200);
  } else {
    // Create NEW workspace with scaffolded files
    var newWs = createWorkspace(name);
    Object.keys(files).forEach(function(path) {
      newWs.fileContents[name + '/' + path] = files[path];
      newWs.allFilePaths.push(name + '/' + path);
    });
    workspaces.push(newWs);
    activeWsId = newWs.id;
    syncWorkspaceUI();
    renderTree();
    renderWsTabs();
    toast('✦ Created: ' + name, 'success');
    // Open main entry file
    var entry = name + '/src/App.tsx';
    var entry2 = name + '/src/App.jsx';
    var entry3 = name + '/app/page.tsx';
    var entry4 = name + '/index.html';
    var toOpen = [entry,entry2,entry3,entry4].find(function(p){ return newWs.allFilePaths.includes(p); });
    if (toOpen) setTimeout(function(){ openFile(toOpen); }, 200);
  }

  // VEX message
  if (!vexChatOpen) vexToggleChat();
  setTimeout(function(){
    var isWrap = tpl.wrap;
    vexAddMsg(isWrap
      ? 'Vite wrapper added to <b>' + name + '</b>!<br><br>Your existing files are untouched. The new files added are:<br><code>package.json</code> · <code>vite.config.js</code> · <code>vercel.json</code> · <code>.gitignore</code><br><br>Next steps:'
      : 'Scaffolded <b>' + name + '</b> with <b>' + tpl.title + '</b>!<br><br>Next steps:'
    );
    vexAddBtns([
      {label: '📦 How to install & run', action: function(){ document.getElementById('vexInput').value = 'How do I install dependencies and run this ' + tpl.title + ' project locally?'; vexSend(); }},
      {label: '🚀 How to deploy to Vercel', action: function(){ document.getElementById('vexInput').value = 'How do I deploy this to Vercel and what does vercel.json do?'; vexSend(); }},
      {label: '⎇ Push to GitHub', action: function(){ _ghTab='push'; openGithubPanel(); }},
    ]);
  }, 400);
}


// ══════════════════════════════
//  GITHUB INTEGRATION
// ══════════════════════════════
var _ghToken = '';
var _ghUser = null;
var _ghCurrentRepo = null; // { owner, name, branch, sha }
var _ghTab = 'repos';

function ghGetToken() {
  return _ghToken || localStorage.getItem('vex_gh_token') || '';
}
function ghSaveToken(t) {
  _ghToken = t;
  localStorage.setItem('vex_gh_token', t);
}
function ghClearToken() {
  _ghToken = '';
  _ghUser = null;
  localStorage.removeItem('vex_gh_token');
  document.getElementById('githubBtn').classList.remove('connected');
}

function openGithubPanel() {
  document.getElementById('ghOverlay').classList.add('open');
  ghRender();
}
function closeGithubPanel() {
  document.getElementById('ghOverlay').classList.remove('open');
}

async function ghFetch(path, opts) {
  var token = ghGetToken();
  var res = await fetch('https://api.github.com' + path, Object.assign({
    headers: {
      'Authorization': 'token ' + token,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    }
  }, opts || {}));
  if (!res.ok) {
    var err = await res.json().catch(function(){ return {}; });
    throw new Error(err.message || ('GitHub API error ' + res.status));
  }
  return res.json();
}

function ghRender() {
  var body = document.getElementById('ghBody');
  var token = ghGetToken();
  if (!token) { ghRenderAuth(body); return; }
  if (!_ghUser) {
    body.innerHTML = '<div class="gh-loading">Connecting to GitHub…</div>';
    ghFetch('/user').then(function(u){
      _ghUser = u;
      document.getElementById('githubBtn').classList.add('connected');
      ghRenderMain(body);
    }).catch(function(e){
      ghClearToken();
      ghRenderAuth(body, 'Token invalid or expired: ' + e.message);
    });
  } else {
    ghRenderMain(body);
  }
}

function ghRenderAuth(body, err) {
  body.innerHTML = '';
  // Token section
  var html = document.createElement('div');
  html.innerHTML = '<div class="gh-section-title">Connect with GitHub</div>'
    + '<div style="font-size:11px;color:#556677;margin-bottom:12px;line-height:1.7">'
    + 'Create a <b style="color:#c8c8e0">Personal Access Token</b> at '
    + '<a href="https://github.com/settings/tokens/new" target="_blank" style="color:#d4a853">github.com/settings/tokens</a>'
    + ' with <code style="color:#4ade80">repo</code> scope. Paste it below.</div>';
  body.appendChild(html);
  if (err) {
    var e = document.createElement('div');
    e.className = 'gh-status err';
    e.textContent = err;
    body.appendChild(e);
  }
  var row = document.createElement('div');
  row.className = 'gh-row';
  var inp = document.createElement('input');
  inp.className = 'gh-input';
  inp.type = 'password';
  inp.placeholder = 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  inp.style.flex = '1';
  var btn = document.createElement('button');
  btn.className = 'gh-btn';
  btn.textContent = 'Connect';
  btn.onclick = function() {
    var t = inp.value.trim();
    if (!t) return;
    ghSaveToken(t);
    _ghUser = null;
    ghRender();
  };
  inp.onkeydown = function(e){ if(e.key==='Enter') btn.click(); };
  row.appendChild(inp);
  row.appendChild(btn);
  body.appendChild(row);
}

function ghRenderMain(body) {
  body.innerHTML = '';
  // User card
  var userCard = document.createElement('div');
  userCard.className = 'gh-user';
  userCard.innerHTML = '<img class="gh-avatar" src="' + _ghUser.avatar_url + '" />'
    + '<div><div class="gh-user-name">' + (_ghUser.name || _ghUser.login) + '</div>'
    + '<div class="gh-user-handle">@' + _ghUser.login + ' · ' + (_ghUser.public_repos||0) + ' repos</div></div>'
    + '<button class="gh-btn sec" style="margin-left:auto;font-size:10px;padding:4px 10px" onclick="ghClearToken();ghRender()">Sign out</button>';
  body.appendChild(userCard);

  // Tab bar
  var tabs = document.createElement('div');
  tabs.className = 'gh-tab-bar';
  [['repos','📁 My Repos'],['open','🔗 Open URL'],['push','⬆ Push Changes']].forEach(function(t){
    var tab = document.createElement('div');
    tab.className = 'gh-tab' + (_ghTab===t[0]?' active':'');
    tab.textContent = t[1];
    tab.onclick = function(){ _ghTab=t[0]; ghRenderMain(body); };
    tabs.appendChild(tab);
  });
  body.appendChild(tabs);

  if (_ghTab === 'repos') ghRenderRepos(body);
  else if (_ghTab === 'open') ghRenderOpenUrl(body);
  else if (_ghTab === 'push') ghRenderPush(body);
}

function ghRenderRepos(body) {
  var wrap = document.createElement('div');

  // Search
  var searchRow = document.createElement('div');
  searchRow.className = 'gh-row';
  var inp = document.createElement('input');
  inp.className = 'gh-input';
  inp.placeholder = 'Search repos…';
  inp.style.flex = '1';
  searchRow.appendChild(inp);
  wrap.appendChild(searchRow);

  var list = document.createElement('div');
  list.className = 'gh-repo-list';
  list.innerHTML = '<div class="gh-loading">Loading repos…</div>';
  wrap.appendChild(list);
  body.appendChild(wrap);

  var allRepos = [];
  ghFetch('/user/repos?per_page=100&sort=updated').then(function(repos){
    allRepos = repos;
    ghShowRepoList(list, repos);
  }).catch(function(e){
    list.innerHTML = '<div class="gh-status err">' + e.message + '</div>';
  });

  inp.oninput = function(){
    var q = inp.value.trim().toLowerCase();
    ghShowRepoList(list, q ? allRepos.filter(function(r){ return r.full_name.toLowerCase().includes(q); }) : allRepos);
  };
}

function ghShowRepoList(list, repos) {
  list.innerHTML = '';
  if (!repos.length) { list.innerHTML = '<div class="gh-loading">No repos found</div>'; return; }
  repos.slice(0, 50).forEach(function(repo){
    var item = document.createElement('div');
    item.className = 'gh-repo-item';
    var updated = new Date(repo.updated_at).toLocaleDateString();
    item.innerHTML = '<div style="min-width:0">'
      + '<div class="gh-repo-name">' + (repo.private ? '🔒 ' : '') + repo.full_name + '</div>'
      + '<div class="gh-repo-meta">Updated ' + updated + ' · ' + (repo.default_branch||'main') + '</div>'
      + '</div>'
      + (repo.language ? '<div class="gh-repo-lang">' + repo.language + '</div>' : '');
    item.onclick = function(){ ghLoadRepo(repo.full_name, repo.default_branch||'main'); };
    list.appendChild(item);
  });
}

function ghRenderOpenUrl(body) {
  var wrap = document.createElement('div');
  wrap.innerHTML = '<div class="gh-section-title">Open by URL or owner/repo</div>';
  var row = document.createElement('div');
  row.className = 'gh-row';
  var inp = document.createElement('input');
  inp.className = 'gh-input';
  inp.placeholder = 'e.g. vercel/next.js or https://github.com/owner/repo';
  inp.style.flex = '1';
  var btn = document.createElement('button');
  btn.className = 'gh-btn';
  btn.textContent = 'Open';
  btn.onclick = function(){
    var val = inp.value.trim();
    // Parse github.com/owner/repo or owner/repo
    var match = val.match(/(?:github\.com\/)?([\w.-]+\/[\w.-]+)/);
    if (!match) { toast('Invalid repo format', 'error'); return; }
    ghLoadRepo(match[1], 'main');
    closeGithubPanel();
  };
  inp.onkeydown = function(e){ if(e.key==='Enter') btn.click(); };
  row.appendChild(inp);
  row.appendChild(btn);
  wrap.appendChild(row);
  body.appendChild(wrap);
}

function ghRenderPush(body) {
  var cur = _ghCurrentRepo;
  var wrap = document.createElement('div');
  var modCount = ws() ? ws().modifiedFiles.size : 0;

  wrap.innerHTML = '<div class="gh-section-title">Push to GitHub</div>'
    + '<div style="font-size:11px;color:#556677;margin-bottom:4px">Target repository</div>';

  // Repo dropdown
  var repoSel = document.createElement('select');
  repoSel.className = 'gh-input';
  repoSel.style.cssText = 'width:100%;margin-bottom:8px;background:#12122a;color:#c8c8e0;border:1px solid #2a2a4a;padding:6px 8px;border-radius:6px;font-size:11px;cursor:pointer';
  repoSel.innerHTML = '<option value="">⏳ Loading your repos…</option>';
  wrap.appendChild(repoSel);

  // Branch input
  wrap.insertAdjacentHTML('beforeend', '<div style="font-size:11px;color:#556677;margin-bottom:4px">Branch</div>');
  var branchInp = document.createElement('input');
  branchInp.className = 'gh-input';
  branchInp.value = cur ? cur.branch : 'main';
  branchInp.placeholder = 'main';
  branchInp.style.marginBottom = '8px';
  wrap.appendChild(branchInp);

  // Commit message
  wrap.insertAdjacentHTML('beforeend', '<div style="font-size:11px;color:#556677;margin-bottom:4px">Commit message</div>');
  var msgInp = document.createElement('input');
  msgInp.className = 'gh-input';
  msgInp.value = 'Update via VEX Studio';
  wrap.appendChild(msgInp);

  // File count info
  var infoDiv = document.createElement('div');
  infoDiv.className = 'gh-commit-info';
  infoDiv.style.marginTop = '8px';
  infoDiv.innerHTML = 'Modified files: <b style="color:' + (modCount>0?'#d4a853':'#4ade80') + '">' + modCount + '</b>';
  wrap.appendChild(infoDiv);

  // Buttons
  var btnRow = document.createElement('div');
  btnRow.className = 'gh-row';
  btnRow.style.marginTop = '10px';

  var pushBtn = document.createElement('button');
  pushBtn.className = 'gh-btn';
  pushBtn.textContent = '⬆ Push ' + modCount + ' file' + (modCount===1?'':'s');
  pushBtn.onclick = function(){
    var sel = repoSel.value;
    if (!sel) { toast('Select a repo first', 'error'); return; }
    var parts = sel.split('/');
    var target = { owner: parts[0], name: parts[1], branch: branchInp.value || 'main' };
    ghPushChanges(msgInp.value, body, false, target);
  };

  var pushAllBtn = document.createElement('button');
  pushAllBtn.className = 'gh-btn sec';
  pushAllBtn.textContent = 'Push all files';
  pushAllBtn.onclick = function(){
    var sel = repoSel.value;
    if (!sel) { toast('Select a repo first', 'error'); return; }
    var parts = sel.split('/');
    var target = { owner: parts[0], name: parts[1], branch: branchInp.value || 'main' };
    ghPushChanges(msgInp.value, body, true, target);
  };

  btnRow.appendChild(pushBtn);
  btnRow.appendChild(pushAllBtn);
  wrap.appendChild(btnRow);
  body.appendChild(wrap);

  // Load repos async
  ghFetch('/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator').then(function(repos) {
    repoSel.innerHTML = '';
    if (!repos || !repos.length) {
      repoSel.innerHTML = '<option value="">No repos found</option>';
      return;
    }
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— select a repo —';
    repoSel.appendChild(placeholder);
    repos.forEach(function(r) {
      var opt = document.createElement('option');
      opt.value = r.full_name;
      opt.textContent = r.full_name + (r.private ? ' 🔒' : '');
      if (cur && r.full_name === cur.owner + '/' + cur.name) opt.selected = true;
      repoSel.appendChild(opt);
    });
    // Auto-update branch when repo changes
    repoSel.onchange = function() {
      var found = repos.find(function(r){ return r.full_name === repoSel.value; });
      if (found) branchInp.value = found.default_branch || 'main';
    };
  }).catch(function() {
    repoSel.innerHTML = '<option value="">❌ Error loading repos — check PAT scope</option>';
  });
}

async function ghLoadRepo(fullName, branch) {
  closeGithubPanel();
  var parts = fullName.split('/');
  var owner = parts[0], repo = parts[1];

  toast('⎇ Loading ' + fullName + '…', 'success');

  try {
    // Get tree
    var branchData = await ghFetch('/repos/' + owner + '/' + repo + '/branches/' + branch).catch(async function(){
      // try main then master
      var b = await ghFetch('/repos/' + owner + '/' + repo + '/branches/main').catch(function(){
        return ghFetch('/repos/' + owner + '/' + repo + '/branches/master');
      });
      branch = b.name;
      return b;
    });
    branch = branchData.name;
    var sha = branchData.commit.sha;
    var tree = await ghFetch('/repos/' + owner + '/' + repo + '/git/trees/' + sha + '?recursive=1');

    // Filter files (skip binaries, node_modules, .git)
    var files = tree.tree.filter(function(f){
      if (f.type !== 'blob') return false;
      if (f.path.startsWith('node_modules/')) return false;
      if (f.path.startsWith('.git/')) return false;
      if (f.size > 500000) return false; // skip files > 500kb
      var ext = f.path.split('.').pop().toLowerCase();
      var skip = ['png','jpg','jpeg','gif','webp','ico','woff','woff2','ttf','eot','mp4','mp3','zip','pdf','exe'];
      return !skip.includes(ext);
    });

    // Create workspace
    var wsName = repo;
    var newWs = createWorkspace(wsName);
    workspaces.push(newWs);
    activeWsId = newWs.id;
    _ghCurrentRepo = { owner: owner, name: repo, branch: branch, sha: sha };

    // Load files in batches
    var total = files.length;
    var loaded = 0;
    toast('Loading ' + total + ' files…', 'success');

    // Fetch file contents (batch of 10 concurrent)
    async function loadBatch(batch) {
      await Promise.all(batch.map(async function(f){
        try {
          var data = await ghFetch('/repos/' + owner + '/' + repo + '/contents/' + encodeURIComponent(f.path) + '?ref=' + sha);
          var content = '';
          if (data.encoding === 'base64') {
            content = atob(data.content.replace(/\n/g,''));
          } else {
            content = data.content || '';
          }
          newWs.fileContents[wsName + '/' + f.path] = content;
          newWs.allFilePaths.push(wsName + '/' + f.path);
          loaded++;
        } catch(e) { /* skip */ }
      }));
    }

    for (var i = 0; i < files.length; i += 10) {
      await loadBatch(files.slice(i, i+10));
      if (i % 30 === 0) toast('Loading… ' + loaded + '/' + total, 'success');
    }

    syncWorkspaceUI();
    renderTree();
    renderWsTabs();
    toast('✓ Loaded ' + loaded + ' files from ' + fullName, 'success');

    // Auto-open README or index.html
    var readme = newWs.allFilePaths.find(function(p){ return p.toLowerCase().endsWith('readme.md'); });
    var index = newWs.allFilePaths.find(function(p){ return p.endsWith('index.html'); });
    if (readme) openFile(readme);
    else if (index) openFile(index);

    // Tell VEX
    if (!vexChatOpen) vexToggleChat();
    setTimeout(function(){
      vexAddMsg('Loaded <b>' + fullName + '</b> from GitHub — <b>' + loaded + ' files</b>, branch <code>' + branch + '</code>.<br><br>What would you like to do?');
      vexAddBtns([
        {label: '📖 Explain this repo', action: function(){ document.getElementById('vexInput').value='Give me an overview of this repo: what it does, main files, and architecture'; vexSend(); }},
        {label: '⬆ Push changes', action: function(){ _ghTab='push'; openGithubPanel(); }},
      ]);
    }, 500);

  } catch(e) {
    toast('GitHub error: ' + e.message, 'error');
  }
}

async function ghPushChanges(message, body, pushAll, targetOverride) {
  var cur = targetOverride || _ghCurrentRepo;
  if (!cur) { toast('No repo connected', 'error'); return; }
  var curWs = ws();
  if (!curWs) return;

  var filesToPush = pushAll
    ? curWs.allFilePaths
    : Array.from(curWs.modifiedFiles);

  if (!filesToPush.length) { toast('No files to push', 'error'); return; }

  // Update status
  body.innerHTML = '<div class="gh-status info">Pushing ' + filesToPush.length + ' file(s)…</div>';

  try {
    // Try to get latest commit — if this fails, repo is empty or branch doesn't exist yet
    var isEmptyRepo = false;
    var commitSha = null;
    var treeSha = null;

    try {
      var ref = await ghFetch('/repos/' + cur.owner + '/' + cur.name + '/git/refs/heads/' + cur.branch);
      commitSha = ref.object.sha;
      var commit = await ghFetch('/repos/' + cur.owner + '/' + cur.name + '/git/commits/' + commitSha);
      treeSha = commit.tree.sha;
    } catch(refErr) {
      // 404 or 409 = empty repo / branch doesn't exist yet
      isEmptyRepo = true;
    }

    if (isEmptyRepo) {
      // Empty repo: git database API fails with 409. Use Contents API for first commit.
      body.innerHTML = '<div class="gh-status info">Initialising empty repo…</div>';
      var lastSha = null;
      for (var fi = 0; fi < filesToPush.length; fi++) {
        var fpath = filesToPush[fi];
        var parts = fpath.split('/');
        var ghPath = parts.length > 1 ? parts.slice(1).join('/') : fpath;
        var fileContent = curWs.fileContents[fpath] || '';
        var putBody = {
          message: fi === 0 ? message : 'Add ' + ghPath,
          content: btoa(unescape(encodeURIComponent(fileContent)))
        };
        // Check if file already exists (needs its blob sha to update)
        try {
          var existing = await ghFetch('/repos/' + cur.owner + '/' + cur.name + '/contents/' + ghPath);
          if (existing.sha) putBody.sha = existing.sha;
        } catch(e) { /* file doesn't exist yet, no sha needed */ }
        var result = await ghFetch('/repos/' + cur.owner + '/' + cur.name + '/contents/' + ghPath, {
          method: 'PUT',
          body: JSON.stringify(putBody)
        });
        lastSha = result.commit.sha;
        body.innerHTML = '<div class="gh-status info">Uploading ' + (fi+1) + '/' + filesToPush.length + '…</div>';
      }
      var newCommit = { sha: lastSha };

    } else {
      // Existing repo: use fast git database API (single commit for all files)
      var treeItems = await Promise.all(filesToPush.map(async function(path){
        var parts = path.split('/');
        var ghPath = parts.length > 1 ? parts.slice(1).join('/') : path;
        var fileContent = curWs.fileContents[path] || '';
        var blob = await ghFetch('/repos/' + cur.owner + '/' + cur.name + '/git/blobs', {
          method: 'POST',
          body: JSON.stringify({ content: btoa(unescape(encodeURIComponent(fileContent))), encoding: 'base64' })
        });
        return { path: ghPath, mode: '100644', type: 'blob', sha: blob.sha };
      }));

      var newTree = await ghFetch('/repos/' + cur.owner + '/' + cur.name + '/git/trees', {
        method: 'POST',
        body: JSON.stringify({ base_tree: treeSha, tree: treeItems })
      });

      var newCommit = await ghFetch('/repos/' + cur.owner + '/' + cur.name + '/git/commits', {
        method: 'POST',
        body: JSON.stringify({ message: message, tree: newTree.sha, parents: [commitSha] })
      });

      await ghFetch('/repos/' + cur.owner + '/' + cur.name + '/git/refs/heads/' + cur.branch, {
        method: 'PATCH',
        body: JSON.stringify({ sha: newCommit.sha })
      });
    }

    // Clear modified flags
    if (!pushAll) curWs.modifiedFiles.clear();
    updateModifiedCount();
    cur.sha = newCommit.sha;

    body.innerHTML = '<div class="gh-status">✓ Pushed ' + filesToPush.length + ' file(s) to <b>'
      + cur.owner + '/' + cur.name + '</b> · <a href="https://github.com/' + cur.owner + '/' + cur.name
      + '/commit/' + newCommit.sha + '" target="_blank" style="color:#d4a853">View commit ↗</a></div>';

    toast('✓ Pushed to GitHub!', 'success');

  } catch(e) {
    body.innerHTML = '<div class="gh-status err">Push failed: ' + e.message + '</div>';
  }
}


// ══════════════════════════════
//  TRANSLATION PANEL
// ══════════════════════════════
var _transPanelPath = null;
var _transExtractedJson = null;

function openTransPanel(htmlPath) {
  _transPanelPath = htmlPath || activeTab;
  var name = _transPanelPath ? _transPanelPath.split('/').pop() : 'no file';
  document.getElementById('transPanelFile').textContent = name;
  document.getElementById('transExtractOutput').value = '';
  document.getElementById('transExtractStatus').textContent = '';
  document.getElementById('transExtractStatus').className = 'trans-status';
  document.getElementById('transInjectStatus').textContent = '';
  document.getElementById('transInjectStatus').className = 'trans-status';
  document.getElementById('transDownloadBtn').style.display = 'none';
  _transExtractedJson = null;
  document.getElementById('transPanelOverlay').classList.add('open');
}

function closeTransPanel() {
  document.getElementById('transPanelOverlay').classList.remove('open');
}

function transPanelExtract() {
  var path = _transPanelPath;
  var content = fileContents[path];
  if (!content) {
    document.getElementById('transExtractStatus').textContent = 'Open the file in the editor first.';
    document.getElementById('transExtractStatus').className = 'trans-status err';
    return;
  }
  var parser = new DOMParser();
  var doc = parser.parseFromString(content, 'text/html');
  var strings = {};
  var counter = {};
  var skipTags = new Set(['script','style','meta','link','head','noscript','template']);

  function makeKey(text, tag) {
    var slug = text.toLowerCase().replace(/[^a-z0-9 ]/g,'').trim().replace(/\s+/g,'_').slice(0,32);
    if (!slug) return null;
    var base = (tag||'text') + '.' + slug;
    if (!counter[base]) { counter[base]=1; return base; }
    return base + '_' + (++counter[base]);
  }

  function walk(node) {
    if (node.nodeType === 3) {
      var text = node.textContent.trim();
      if (text.length < 2 || /^[\d\s\.,!?:;\-_/()]+$/.test(text)) return;
      var parent = node.parentElement;
      if (!parent || skipTags.has(parent.tagName.toLowerCase())) return;
      var key = makeKey(text, parent.tagName.toLowerCase());
      if (key) strings[key] = text;
    } else if (node.nodeType === 1) {
      if (skipTags.has(node.tagName.toLowerCase())) return;
      ['placeholder','title','alt','aria-label'].forEach(function(attr){
        var val = node.getAttribute(attr);
        if (val && val.trim().length > 1) {
          var key = makeKey(val.trim(), attr);
          if (key) strings[key] = val.trim();
        }
      });
      node.childNodes.forEach(walk);
    }
  }
  walk(doc.body);

  var count = Object.keys(strings).length;
  _transExtractedJson = JSON.stringify(strings, null, 2);
  document.getElementById('transExtractOutput').value = _transExtractedJson;
  document.getElementById('transDownloadBtn').style.display = 'inline-block';
  var st = document.getElementById('transExtractStatus');
  if (count === 0) {
    st.textContent = 'No translatable strings found.';
    st.className = 'trans-status err';
  } else {
    st.textContent = '✓ ' + count + ' strings extracted';
    st.className = 'trans-status';
  }
}

function transDownloadJson() {
  if (!_transExtractedJson) return;
  var blob = new Blob([_transExtractedJson], {type:'application/json'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'en.json'; a.click();
  URL.revokeObjectURL(url);
}

function transPanelInject() {
  var langCode = document.getElementById('transLangCode').value.trim().toLowerCase();
  var jsonText = document.getElementById('transInjectInput').value.trim();
  var st = document.getElementById('transInjectStatus');

  if (!langCode || !/^[a-z]{2,5}$/.test(langCode)) {
    st.textContent = 'Enter a valid language code (e.g. hi, es, fr)';
    st.className = 'trans-status err'; return;
  }
  if (!jsonText) {
    st.textContent = 'Paste your translated JSON first.';
    st.className = 'trans-status err'; return;
  }
  var parsed;
  try { parsed = JSON.parse(jsonText); }
  catch(e) { st.textContent = 'Invalid JSON: ' + e.message; st.className = 'trans-status err'; return; }

  st.textContent = 'Injecting — VEX is reading your HTML…';
  st.className = 'trans-status';
  closeTransPanel();
  injectTranslationFromJSON(_transPanelPath, langCode, parsed);
}


// ══════════════════════════════
//  KEYBOARD SHORTCUTS
// ══════════════════════════════
document.addEventListener('keydown', e => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key === 'p') { e.preventDefault(); openSearch(); }
  if (ctrl && e.key === 's') { e.preventDefault(); saveCurrentFile(); }
  if (ctrl && e.key === '`') { e.preventDefault(); toggleTerminal(); }
  if (e.key === 'Escape') {
    if (document.getElementById('searchOverlay').classList.contains('open')) closeSearch();
  }
});

// ══════════════════════════════
//  RESIZERS
// ══════════════════════════════
function makeResizer(resizerId, targetId, direction) {
  const resizer = document.getElementById(resizerId);
  const target = document.getElementById(targetId);
  let startX, startW;

  resizer.addEventListener('mousedown', e => {
    startX = e.clientX;
    startW = target.getBoundingClientRect().width;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = e => {
      const dx = direction === 'right'
        ? -(e.clientX - startX)
        : (e.clientX - startX);
      const newW = Math.max(160, Math.min(600, startW + dx));
      target.style.width = newW + 'px';
      if (editor) editor.layout();
    };

    const onUp = () => {
      resizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

makeResizer('sidebarResizer', 'sidebar', 'left');
window.addEventListener('resize', checkWsOverflow);

// ══════════════════════════════
//  UTILS
// ══════════════════════════════
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function toast(msg, type = '') {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── Load saved API key ──
window.addEventListener('load', () => {
  const saved = localStorage.getItem('vex_studio_key');
  if (saved) {
    const vk=document.getElementById('vexKey'); if(vk){vk.value=saved;vexSaveKey(saved);}
  }
  // Restore GitHub token
  const ghTok = localStorage.getItem('vex_gh_token');
  if (ghTok) { _ghToken = ghTok; document.getElementById('githubBtn').classList.add('connected'); }
});

function abRefreshPanels() {
  var w = ws();
  var wsName = w ? w.name : null;
  var fileCount = w ? w.allFilePaths.length : 0;
  var modCount = w ? (w.modifiedFiles.size || 0) : 0;

  // Explorer title
  var title = document.getElementById('sidebarTitle');
  if (title) title.textContent = wsName || 'Explorer';

  // Project panel info
  var projInfo = document.getElementById('abProjInfo');
  if (projInfo) {
    projInfo.innerHTML = wsName
      ? '<b style="color:#c8c8e0">' + wsName + '</b><br>' + fileCount + ' files · ' + modCount + ' modified'
      : '<span style="color:#334455">No workspace open</span>';
  }

  // GitHub panel
  if (_abActive === 'github') abInitGithub();

  // Search — clear results when workspace changes
  var searchInput = document.getElementById('abSearchInput');
  var searchResults = document.getElementById('abSearchResults');
  if (searchInput) searchInput.value = '';
  if (searchResults) searchResults.innerHTML = wsName
    ? '<span style="color:#334455">Type to search in ' + wsName + '</span>'
    : '<span style="color:#334455">No workspace open</span>';

  // Translation panel info
  var transPanel = document.getElementById('panel-translation');
  if (transPanel) {
    var transInfo = transPanel.querySelector('.ab-ws-info');
    if (!transInfo) {
      transInfo = document.createElement('div');
      transInfo.className = 'ab-ws-info';
      transInfo.style.cssText = 'font-size:11px;color:#556677;line-height:1.7;margin-bottom:4px;padding:0 10px';
      transPanel.querySelector('.sidebar-header').after(transInfo);
    }
    transInfo.textContent = wsName ? 'Workspace: ' + wsName : 'No workspace open';
  }
}

// ══════════════════════════════
//  VEX SCANNER SYSTEM
// ══════════════════════════════
let _lastScanIssues = { security: [], seo: [], quality: [], refactor: [], assets: [] };
let _activeScannerType = null;
let _projectType = 'unknown';
let _wsScanned = false;
let _asBounce = null;
const undoStack = [];
const UNDO_LIMIT = 50;

function pushUndo() {
  if (!activeTab || !editor) return;
  undoStack.push({ tab: activeTab, content: editor.getModel().getValue(), timestamp: Date.now() });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}

function getFileContent(path) {
  const w = ws(); if (!w) return null;
  if (w.editorModels && w.editorModels[path]) {
    const m = w.editorModels[path];
    return typeof m.getValue === 'function' ? m.getValue() : null;
  }
  return w.fileContents[path] || null;
}

function getActiveContent() {
  if (!activeTab) return null;
  const m = editorModels[activeTab];
  return m ? m.getValue() : (fileContents[activeTab] || null);
}

function detectProjectType() {
  const w = ws(); if (!w) return 'unknown';
  const pkg = w.fileContents['package.json'] || Object.values(w.fileContents||{}).find((_,k)=>k&&k.endsWith('package.json'));
  const pkgContent = w.allFilePaths.map(p=>p.endsWith('package.json')?w.fileContents[p]:null).find(Boolean);
  if (!pkgContent) {
    if (w.allFilePaths.some(p=>p.endsWith('.html'))) return 'html';
    if (w.allFilePaths.some(p=>p.endsWith('.ts')||p.endsWith('.js'))) return 'generic-js';
    return 'unknown';
  }
  try {
    const j = JSON.parse(pkgContent);
    const deps = Object.assign({}, j.dependencies||{}, j.devDependencies||{});
    if (deps['next']) return 'nextjs';
    if (deps['nuxt']||deps['nuxt3']) return 'nuxt';
    if (deps['vite']||(j.scripts&&Object.values(j.scripts).some(s=>s.includes('vite')))) return 'vite';
    if (deps['svelte']||deps['@sveltejs/kit']) return 'svelte';
    if (deps['react']||deps['react-dom']) return 'react-spa';
    if (deps['vue']) return 'vue';
    if (deps['express']||deps['fastify']||deps['koa']) return 'node-server';
    if (deps['typescript']||w.allFilePaths.some(p=>p.endsWith('.ts'))) return 'typescript';
    return 'generic-js';
  } catch(e) { return 'generic-js'; }
}

function filesMatching(paths, testFn) {
  const w = ws(); if (!w) return [];
  return paths.filter(p => { try { return testFn(getFileContent(p)||''); } catch(e){ return false; } });
}

function testFile(path, testFn) {
  try { return testFn(getFileContent(path)||''); } catch(e){ return false; }
}

function _runWorkspaceScan() {
  const w = ws(); if (!w||!w.allFilePaths.length) return;
  _wsScanned = true;
  _projectType = detectProjectType();
  const label = document.getElementById('projTypeLabel');
  if (label) {
    const names = {html:'HTML',nextjs:'Next.js',vite:'Vite',nuxt:'Nuxt',svelte:'Svelte','react-spa':'React','vue':'Vue','node-server':'Node','typescript':'TypeScript','generic-js':'JavaScript',unknown:''};
    label.textContent = names[_projectType]||_projectType;
  }
  _doScanAll();
}

function _doScanAll() {
  const w = ws(); if (!w) return;
  runScanner('security','badge');
  runScanner('seo','badge');
  runScanner('quality','badge');
  runScanner('refactor','badge');
  runScanner('assets','badge');
  const total = _lastScanIssues.security.length + _lastScanIssues.seo.length + _lastScanIssues.quality.length + _lastScanIssues.refactor.length + _lastScanIssues.assets.length;
  const pt = _projectType.toUpperCase().replace('-',' ');
  const fc = w.allFilePaths.length;
  if (total > 0) {
    vexAddMsg('📂 <b>'+pt+'</b> project · '+fc+' files · <span style="color:#f87171">'+total+' issue'+(total>1?'s':'')+' found</span><br><small style="color:#556677">Click the scanner buttons to see details and fix them.</small>');
    updateNotifDot(total);
  } else {
    updateNotifDot(0);
  }
  toast('VEX: Scanned workspace ('+pt+')', 'success');
}

function _autoScanBadges() {
  clearTimeout(_asBounce);
  _asBounce = setTimeout(() => {
    if (!ws()||!ws().allFilePaths.length) return;
    runScanner('security','badge');
    runScanner('seo','badge');
    runScanner('quality','badge');
    runScanner('refactor','badge');
    runScanner('assets','badge');
  }, 1500);
}

function _hookAutoScan() {
  if (!editor) return;
  editor.onDidChangeModelContent(() => { _autoScanBadges(); });
}
setTimeout(_hookAutoScan, 2000);

function updateNotifDot(count) {
  const dot = document.getElementById('vexNotifDot');
  if (!dot) return;
  if (count > 0) {
    dot.classList.add('show'); dot.classList.remove('pulse');
    void dot.offsetWidth; dot.classList.add('pulse');
  } else { dot.classList.remove('show','pulse'); }
}

function updateBadge(id, count) {
  const b = document.getElementById(id); if (!b) return;
  if (count === 0) { b.textContent='✓'; b.className='scan-badge green'; }
  else if (count <= 2) { b.textContent=count; b.className='scan-badge warn'; }
  else { b.textContent=count; b.className='scan-badge red'; }
}

function runScanner(type, mode) {
  const w = ws(); if (!w) return;
  _projectType = detectProjectType();
  const allPaths = w.allFilePaths;
  const htmlFiles = allPaths.filter(p=>/\.html?$/.test(p));
  const jsFiles   = allPaths.filter(p=>/\.[jt]sx?$/.test(p));
  const cssFiles  = allPaths.filter(p=>/\.css$/.test(p));
  const jsonFiles = allPaths.filter(p=>/\.json$/.test(p));
  const allCode   = allPaths.filter(p=>/\.(html?|[jt]sx?|css|json|md)$/.test(p));
  const pt = _projectType;
  const checks = [];

  // ── SECURITY ──
  if (type==='security') {
    checks.push({ test:()=>filesMatching([...jsFiles,...htmlFiles],c=>/\beval\s*\(/.test(c)).length>0, sev:'warn', title:'eval() Usage', desc:'eval() can execute arbitrary code — a common attack vector.', risk:'medium', find:'eval(' });
    checks.push({ test:()=>filesMatching([...jsFiles,...htmlFiles],c=>/\.innerHTML\s*=/.test(c)).length>0, sev:'warn', title:'innerHTML Assignment', desc:'Direct innerHTML writes can allow XSS attacks. Use textContent or sanitize input.', risk:'medium', find:'.innerHTML =' });
    checks.push({ test:()=>filesMatching(allCode,c=>/(['"`])(sk-|AIza|AKIA|ghp_|xoxb-|xoxp-)[A-Za-z0-9]{8,}/.test(c)||/(api[_-]?key|apikey|secret|password|token)\s*[:=]\s*['"`][^'"`]{8,}['"`]/i.test(c)).length>0, sev:'fail', title:'Hardcoded Secrets', desc:'API keys or passwords found in source. Move to environment variables.', risk:'high', find:'apikey' });
    checks.push({ test:()=>filesMatching(htmlFiles,c=>/<!--[\s\S]*?(password|secret|token|api.?key)[\s\S]*?-->/i.test(c)).length>0, sev:'fail', title:'Secrets in Comments', desc:'Sensitive keywords found inside HTML comments — visible in page source.', fix:'fixStripSensitiveComments', risk:'safe', find:'<!--' });
    checks.push({ test:()=>filesMatching(htmlFiles,c=>/\bon\w+\s*=\s*["']/.test(c)).length>0, sev:'fail', title:'Inline Event Handlers', desc:'onclick="" etc. are harder to audit and can bypass CSP.', fix:'fixInlineHandlers', risk:'medium', find:'onclick=' });
    checks.push({ test:()=>filesMatching(htmlFiles,c=>/href\s*=\s*["']javascript:/i.test(c)).length>0, sev:'fail', title:'javascript: URLs', desc:'javascript: URIs execute arbitrary code and bypass security policies.', risk:'high', find:'javascript:' });
    checks.push({ test:()=>filesMatching(htmlFiles,c=>/<script[^>]+src\s*=\s*["']http:\/\//i.test(c)).length>0, sev:'fail', title:'Non-HTTPS Script Sources', desc:'HTTP scripts can be intercepted and modified (MITM attacks).', risk:'high', find:'src="http://' });
    checks.push({ test:()=>filesMatching(htmlFiles,c=>/<iframe(?![^>]*sandbox)/i.test(c)).length>0, sev:'warn', title:'Unsandboxed iframes', desc:'iframes without sandbox attribute can access your page context.', fix:'fixIframeSandbox', risk:'high', find:'<iframe' });
    if (pt==='nextjs'||pt==='vite'||pt==='react-spa') {
      checks.push({ test:()=>filesMatching(jsFiles,c=>/dangerouslySetInnerHTML/.test(c)).length>0, sev:'warn', title:'dangerouslySetInnerHTML', desc:"React's escape hatch for raw HTML — ensure content is sanitized.", risk:'medium', find:'dangerouslySetInnerHTML' });
    }
    if (pt==='nextjs') {
      const hasEnv = allPaths.some(p=>p.endsWith('.env')||p.endsWith('.env.local'));
      const hasGitignore = allPaths.some(p=>p.endsWith('.gitignore'));
      checks.push({ test:()=>hasEnv&&!hasGitignore, sev:'fail', title:'.env Without .gitignore', desc:'.env files present but no .gitignore — your secrets could be committed to Git.', risk:'high', find:'.env' });
    }

    // ── NEW: JWT hardcoded tokens
    const jwtHits = (() => { const r=[]; allCode.forEach(p=>{ const c=getFileContent(p)||''; const rx=/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g; let m; while((m=rx.exec(c))!==null){ try{ const parts=m[0].split('.'); const payload=JSON.parse(atob(parts[1])); const exp=payload.exp; const expired=exp&&(exp*1000<Date.now()); r.push({file:p.split('/').pop(),path:p,line:c.substr(0,m.index).split('\n').length,match:(expired?'[EXPIRED] ':'')+m[0].slice(0,40)+'…',expired}); }catch(e){ r.push({file:p.split('/').pop(),path:p,line:0,match:m[0].slice(0,40)+'…'}); } } }); return r; })();
    checks.push({ test:()=>jwtHits.length>0, sev:'fail', title:`Hardcoded JWT Tokens (${jwtHits.length} found)`, desc:`${jwtHits.length} JWT token${jwtHits.length!==1?'s':''} hardcoded in source. Tokens should never be in code — use env vars or runtime auth.`, risk:'high', find:null, hits:jwtHits.slice(0,20) });

    // ── NEW: SQL injection patterns
    const sqlHits = (() => { const r=[]; jsFiles.forEach(p=>{ const c=getFileContent(p)||''; const lines=c.split('\n'); lines.forEach((line,i)=>{ if(/(query|sql|db\.(run|exec|query))\s*\(\s*[`'"].*\+|\$\{/.test(line)){ r.push({file:p.split('/').pop(),path:p,line:i+1,match:line.trim().slice(0,80)}); } }); }); return r; })();
    checks.push({ test:()=>sqlHits.length>0, sev:'fail', title:`SQL Injection Patterns (${sqlHits.length} found)`, desc:`${sqlHits.length} SQL query${sqlHits.length!==1?'s':''} using string concatenation or template literals. Use parameterised queries.`, risk:'high', find:null, hits:sqlHits.slice(0,20) });

    // ── NEW: Unsafe function calls
    const unsafeHits = (() => { const r=[]; jsFiles.forEach(p=>{ const c=getFileContent(p)||''; const lines=c.split('\n'); lines.forEach((line,i)=>{ if(/\bchild_process\b|\bexec\s*\(|\bspawn\s*\(|\bexecSync\s*\(|\bpickle\.loads\b/.test(line)){ r.push({file:p.split('/').pop(),path:p,line:i+1,match:line.trim().slice(0,80)}); } }); }); return r; })();
    checks.push({ test:()=>unsafeHits.length>0, sev:'warn', title:`Unsafe Function Calls (${unsafeHits.length} found)`, desc:`${unsafeHits.length} potentially dangerous function call${unsafeHits.length!==1?'s':''} — exec(), spawn(), child_process. Verify inputs are never user-controlled.`, risk:'high', find:null, hits:unsafeHits.slice(0,20) });

    // ── NEW: Session cookie flags
    const cookieHits = (() => { const r=[]; jsFiles.forEach(p=>{ const c=getFileContent(p)||''; const lines=c.split('\n'); lines.forEach((line,i)=>{ if(/cookie/i.test(line)&&!/httpOnly/i.test(line)&&!/secure/i.test(line)&&/set/i.test(line)){ r.push({file:p.split('/').pop(),path:p,line:i+1,match:line.trim().slice(0,80)}); } }); }); return r; })();
    checks.push({ test:()=>cookieHits.length>0, sev:'warn', title:`Insecure Cookie Flags (${cookieHits.length} found)`, desc:`${cookieHits.length} cookie set without httpOnly or secure flags. Missing flags expose cookies to XSS and network interception.`, risk:'medium', find:null, hits:cookieHits.slice(0,20) });
    if (pt==='vite') {
      checks.push({ test:()=>filesMatching(jsFiles,c=>/process\.env\./.test(c)).length>0, sev:'warn', title:'process.env in Client Code', desc:"Vite uses import.meta.env, not process.env. This won't work and may leak references.", risk:'medium', find:'process.env' });
    }
  }

  // ── SEO ──
  if (type==='seo') {
    if (pt==='html'||pt==='react-spa'||pt==='vite') {
      checks.push({ test:()=>filesMatching(htmlFiles,c=>!/<title[\s>]/i.test(c)).length>0, sev:'fail', title:'Missing Page Title', desc:'No <title> tag found. Required for SEO and browser tab display.', fix:'fixTitle', input:{id:'fixTitleInp',placeholder:'Enter page title…',label:'Title'}, risk:'safe', find:'<title' });
      checks.push({ test:()=>filesMatching(htmlFiles,c=>/<title[^>]*>(.{61,})<\/title>/i.test(c)).length>0, sev:'warn', title:'Title Too Long', desc:'Title is over 60 chars — Google truncates long titles in search results.', risk:'safe', find:'<title' });
      checks.push({ test:()=>filesMatching(htmlFiles,c=>!/<meta[^>]+name\s*=\s*["']description["']/i.test(c)).length>0, sev:'fail', title:'Missing Meta Description', desc:'No meta description found. Critical for Google search snippets.', fix:'fixMetaDesc', input:{id:'fixDescInp',placeholder:'Enter meta description…',label:'Description'}, risk:'safe' });
      checks.push({ test:()=>filesMatching(htmlFiles,c=>!/<meta[^>]+viewport/i.test(c)).length>0, sev:'fail', title:'Missing Viewport', desc:'No viewport meta tag. Your site will look broken on mobile.', fix:'fixViewport', risk:'safe', find:'viewport' });
      checks.push({ test:()=>filesMatching(htmlFiles,c=>!/<h1[\s>]/i.test(c)).length>0, sev:'warn', title:'No H1 Heading', desc:'Missing <h1> tag. Every page should have one primary heading for SEO.', risk:'safe', find:'<h1' });
      checks.push({ test:()=>filesMatching(htmlFiles,c=>/<img(?![^>]*alt\s*=)/i.test(c)).length>0, sev:'warn', title:'Images Missing Alt Text', desc:'Some <img> tags have no alt attribute. Bad for accessibility and SEO.', fix:'fixImgAlt', risk:'safe', find:'<img' });
      checks.push({ test:()=>filesMatching(htmlFiles,c=>/<img(?![^>]*loading\s*=)/i.test(c)).length>0, sev:'info', title:'No Lazy Loading on Images', desc:'Images without loading="lazy" load immediately even if off-screen.', fix:'fixLazyImages', risk:'safe', find:'<img' });
      checks.push({ test:()=>filesMatching(htmlFiles,c=>!/<html[^>]+lang\s*=/i.test(c)).length>0, sev:'warn', title:'Missing lang Attribute', desc:'<html> tag has no lang attribute. Required for accessibility and SEO.', fix:'fixLang', risk:'safe', find:'<html' });
    }

    // ── NEW: OG tags
    checks.push({ test:()=>filesMatching(htmlFiles,c=>!/<meta[^>]+property\s*=\s*["']og:title["']/i.test(c)).length>0, sev:'warn', title:'Missing og:title', desc:'No Open Graph title tag. Link previews on Slack, Twitter, LinkedIn will show no title.', risk:'safe', find:'og:title' });
    checks.push({ test:()=>filesMatching(htmlFiles,c=>!/<meta[^>]+property\s*=\s*["']og:description["']/i.test(c)).length>0, sev:'warn', title:'Missing og:description', desc:'No Open Graph description. Link preview cards will show no description.', risk:'safe', find:'og:description' });
    checks.push({ test:()=>filesMatching(htmlFiles,c=>!/<meta[^>]+property\s*=\s*["']og:image["']/i.test(c)).length>0, sev:'info', title:'Missing og:image', desc:'No Open Graph image. Link previews will show no thumbnail — lower click-through rates.', risk:'safe', find:'og:image' });
    // ── NEW: Twitter Card
    checks.push({ test:()=>filesMatching(htmlFiles,c=>!/<meta[^>]+name\s*=\s*["']twitter:card["']/i.test(c)).length>0, sev:'info', title:'Missing Twitter Card', desc:'No twitter:card meta tag. Twitter/X link previews will be minimal.', risk:'safe', find:'twitter:card' });
    // ── NEW: Canonical tag
    checks.push({ test:()=>filesMatching(htmlFiles,c=>!/<link[^>]+rel\s*=\s*["']canonical["']/i.test(c)).length>0, sev:'info', title:'Missing Canonical Tag', desc:'No canonical link tag. Without it Google may penalise duplicate content across URL variants.', risk:'safe', find:'canonical' });
    // ── NEW: Robots noindex
    const noindexFiles = htmlFiles.filter(p=>{ const c=getFileContent(p)||''; return /<meta[^>]+name\s*=\s*["']robots["'][^>]+content\s*=\s*["'][^"']*noindex/i.test(c); });
    checks.push({ test:()=>noindexFiles.length>0, sev:'warn', title:`Robots noindex Found (${noindexFiles.length} file${noindexFiles.length!==1?'s':''})`, desc:`${noindexFiles.length} page${noindexFiles.length!==1?'s are':' is'} set to noindex — Google will not index these pages. Verify this is intentional.`, risk:'safe', find:'noindex', hits:noindexFiles.map(p=>({file:p.split('/').pop(),path:p,line:1,match:'robots noindex'})) });
    if (pt==='nextjs') {
      const layouts = allPaths.filter(p=>/layout\.[jt]sx?$/.test(p));
      checks.push({ test:()=>layouts.length>0&&filesMatching(layouts,c=>!/export.*metadata/.test(c)).length>0, sev:'fail', title:'Missing metadata Export', desc:'Next.js layout files should export metadata for SEO.', risk:'safe', find:'metadata' });
      checks.push({ test:()=>filesMatching(allPaths.filter(p=>/layout\.[jt]sx?$/.test(p)),c=>!/<html[^>]+lang/i.test(c)).length>0, sev:'warn', title:'Missing lang in Root Layout', desc:'Root layout <html> tag missing lang attribute.', risk:'safe', find:'lang=' });
    }
  }

  // ── QUALITY ──
  if (type==='quality') {    checks.push({ test:()=>filesMatching(jsFiles,c=>/console\.log\s*\(/.test(c)).length>0, sev:'info', title:'console.log() Present', desc:'Debug logging left in code. Remove before shipping to production.', fix:'fixConsoleLogs', risk:'medium', find:'console.log(' });
    checks.push({ test:()=>filesMatching(allCode,c=>/\/\/\s*(TODO|FIXME|HACK|XXX)/i.test(c)).length>0, sev:'info', title:'TODO / FIXME Comments', desc:'Unresolved work items found in code.', risk:'safe', find:'TODO' });
    checks.push({ test:()=>filesMatching(jsFiles,c=>/\bdebugger\b/.test(c)).length>0, sev:'warn', title:'debugger Statements', desc:'Debugger breakpoints left in code — will pause execution in browser devtools.', risk:'safe', find:'debugger' });
    checks.push({ test:()=>filesMatching(jsFiles,c=>/document\.write\s*\(/.test(c)).length>0, sev:'warn', title:'document.write() Usage', desc:'document.write blocks rendering and is considered bad practice.', risk:'safe', find:'document.write(' });
    if (pt==='html') {
      checks.push({ test:()=>filesMatching(htmlFiles,c=>!/<!DOCTYPE html>/i.test(c)).length>0, sev:'fail', title:'Missing DOCTYPE', desc:'No <!DOCTYPE html> declaration. Browser may render in quirks mode.', fix:'fixDoctype', risk:'safe', find:'<!DOCTYPE' });
      checks.push({ test:()=>filesMatching(htmlFiles,c=>(c.match(/<script/gi)||[]).length>8).length>0, sev:'info', title:'High Script Count', desc:'More than 8 <script> tags found. Consider bundling scripts.', risk:'safe', find:'<script' });
      checks.push({ test:()=>filesMatching(htmlFiles,c=>(c.match(/<style/gi)||[]).length>3).length>0, sev:'info', title:'Multiple style Blocks', desc:'More than 3 <style> blocks found. Consider consolidating CSS.', risk:'safe', find:'<style' });
    }
    const pkgPaths = allPaths.filter(p=>p.endsWith('package.json'));
    if (pkgPaths.length > 0) {
      const pkgContent = getFileContent(pkgPaths[0])||'{}';
      let pkg = {}; try { pkg = JSON.parse(pkgContent); } catch(e){}
      checks.push({ test:()=>!pkg.name, sev:'warn', title:'No "name" in package.json', desc:'Missing project name field.', risk:'safe', find:'"name"' });
      checks.push({ test:()=>!pkg.version, sev:'info', title:'No "version" in package.json', desc:'Missing version field.', risk:'safe', find:'"version"' });
      checks.push({ test:()=>!pkg.scripts||!pkg.scripts.build, sev:'info', title:'No "build" Script', desc:'No build command defined. Required for deployment.', risk:'safe', find:'"build"' });
      const deps = Object.assign({},pkg.dependencies||{},pkg.devDependencies||{});
      checks.push({ test:()=>Object.values(deps).some(v=>v==='*'||v==='latest'), sev:'warn', title:'Unpinned Dependencies', desc:'Using "*" or "latest" versions can break builds unpredictably.', risk:'safe', find:'"*"' });
      checks.push({ test:()=>!allPaths.some(p=>p.endsWith('.gitignore')), sev:'warn', title:'Missing .gitignore', desc:'No .gitignore found — node_modules could accidentally be committed.', risk:'safe', find:'.gitignore' });
      checks.push({ test:()=>allPaths.some(p=>p.endsWith('.env'))&&!allPaths.some(p=>p.endsWith('.env.example')), sev:'info', title:'No .env.example', desc:'.env present but no .env.example template for other developers.', risk:'safe', find:'.env' });
    }
    if (pt==='nextjs') {
      const appFiles = allPaths.filter(p=>/\/app\/.*\.[jt]sx?$/.test(p));
      checks.push({ test:()=>filesMatching(appFiles,c=>/\b(useState|useEffect|useRef)\b/.test(c)&&!/'use client'/.test(c)).length>0, sev:'warn', title:'Client Hooks Without "use client"', desc:'useState/useEffect used in app/ files without "use client" directive.', risk:'safe', find:'useState' });
      checks.push({ test:()=>!allPaths.some(p=>/error\.[jt]sx?$/.test(p)), sev:'info', title:'No Error Boundary', desc:'Missing error.tsx — unhandled errors will show a blank page.', risk:'safe' });
      checks.push({ test:()=>!allPaths.some(p=>/loading\.[jt]sx?$/.test(p)), sev:'info', title:'No Loading States', desc:'Missing loading.tsx — no loading UI during navigation.', risk:'safe' });
    }
    if (pt==='vite') {
      checks.push({ test:()=>!allPaths.some(p=>p.includes('vite.config')), sev:'warn', title:'Missing vite.config', desc:'No vite configuration file found.', risk:'safe', find:'vite.config' });
    }

    // ── NEW: Dead imports (simplified — checks named imports not reused in file body)
    const deadImports = (() => {
      const r = [];
      jsFiles.forEach(p => {
        const c = getFileContent(p) || '';
        const importRx = /^\s*import\s+\{([^}]+)\}[^\n]*from/gm;
        let m;
        while ((m = importRx.exec(c)) !== null) {
          const names = m[1].split(',').map(s => s.replace(/\s+as\s+\w+/, '').trim()).filter(Boolean);
          const body = c.slice(m.index + m[0].length);
          names.forEach(name => {
            if (name && name.length > 1 && !new RegExp('\\b' + name + '\\b').test(body)) {
              r.push({ file: p.split('/').pop(), path: p, line: c.substr(0, m.index).split('\n').length, match: name + ' (imported, never used)' });
            }
          });
        }
      });
      return r;
    })();
    checks.push({ test:()=>deadImports.length>0, sev:'info', title:`Dead Imports (${deadImports.length} found)`, desc:`${deadImports.length} import${deadImports.length!==1?'s':''} appear unused. Remove to reduce bundle size.`, risk:'safe', find:null, hits:deadImports.slice(0,30) });

    // ── NEW: Env completeness
    const envPath = allPaths.find(p=>p.endsWith('.env')||p.endsWith('.env.local'));
    const envExPath = allPaths.find(p=>p.endsWith('.env.example')||p.endsWith('.env.sample'));
    if (envPath && envExPath) {
      const envKeys = (getFileContent(envPath)||'').split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>l.split('=')[0]);
      const exKeys  = (getFileContent(envExPath)||'').split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>l.split('=')[0]);
      const missing = envKeys.filter(k=>!exKeys.includes(k));
      checks.push({ test:()=>missing.length>0, sev:'warn', title:`Env Keys Missing from .env.example (${missing.length})`, desc:`${missing.length} key${missing.length!==1?'s':''} in .env not documented in .env.example — other devs won't know they're needed.`, risk:'safe', find:null, hits:missing.map(k=>({file:'.env',path:envPath,line:1,match:k})) });
    }

    // ── NEW: Dockerfile linter
    const dockerPath = allPaths.find(p=>p.endsWith('Dockerfile')||p.includes('Dockerfile.'));
    if (dockerPath) {
      const dc = getFileContent(dockerPath)||'';
      checks.push({ test:()=>!/^FROM\s/m.test(dc), sev:'fail', title:'Dockerfile: Missing FROM', desc:'No FROM instruction found in Dockerfile.', risk:'safe', find:'FROM' });
      checks.push({ test:()=>/^FROM\s+[^:]+$/m.test(dc), sev:'warn', title:'Dockerfile: Unpinned Base Image', desc:'Base image has no version tag (e.g. node:18-alpine). Unpinned images can change silently.', risk:'safe', find:'FROM' });
      checks.push({ test:()=>!/^USER\s/m.test(dc), sev:'warn', title:'Dockerfile: No USER Instruction', desc:'Running container as root. Add a USER instruction for security.', risk:'medium', find:'USER' });
      checks.push({ test:()=>!/HEALTHCHECK/i.test(dc), sev:'info', title:'Dockerfile: No HEALTHCHECK', desc:'No HEALTHCHECK instruction — orchestrators cannot determine container health.', risk:'safe', find:'HEALTHCHECK' });
    }

    // ── NEW: NPM audit — license check
    const pkgPathsQ = allPaths.filter(p=>p.endsWith('package.json'));
    if (pkgPathsQ.length > 0) {
      const pkgQ = (() => { try { return JSON.parse(getFileContent(pkgPathsQ[0])||'{}'); } catch(e){ return {}; } })();
      const depsQ = Object.assign({},pkgQ.dependencies||{},pkgQ.devDependencies||{});
      const gplDeps = Object.keys(depsQ).filter(d=>/(^gpl|^copyleft|agpl)/i.test(d));
      checks.push({ test:()=>gplDeps.length>0, sev:'warn', title:`Possible GPL Dependencies (${gplDeps.length})`, desc:`${gplDeps.length} package name${gplDeps.length!==1?'s':''} match GPL/AGPL patterns. Verify licences before commercial use.`, risk:'safe', find:null, hits:gplDeps.map(d=>({file:'package.json',path:pkgPathsQ[0],line:1,match:d})) });
    }
    if (pt==='typescript'||allPaths.some(p=>p.endsWith('.ts')||p.endsWith('.tsx'))) {
      checks.push({ test:()=>!allPaths.some(p=>p.endsWith('tsconfig.json')), sev:'warn', title:'Missing tsconfig.json', desc:'No TypeScript configuration found.', risk:'safe', find:'tsconfig' });
      checks.push({ test:()=>filesMatching(allPaths.filter(p=>/\.tsx?$/.test(p)),c=>(c.match(/:\s*any\b/g)||[]).length>5).length>0, sev:'info', title:'Excessive "any" Types', desc:'Heavy use of ": any" defeats the purpose of TypeScript.', risk:'safe', find:': any' });
    }
  }

  // ── REFACTOR ──
  if (type==='refactor') {
    // Helper: collect regex hits across files, return [{file, line, match}]
    function collectHits(paths, regex) {
      const results = [];
      paths.forEach(p => {
        const c = getFileContent(p)||'';
        const lines = c.split('\n');
        lines.forEach((line, i) => {
          let m;
          const rx = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags+'g');
          while ((m = rx.exec(line)) !== null) {
            results.push({ file: p.split('/').pop(), path: p, line: i+1, match: m[0].trim().slice(0,80) });
          }
        });
      });
      return results;
    }

    // 1. Code Moderniser — var → const/let
    const varHits = collectHits(jsFiles, /\bvar\s+[a-zA-Z_$]/);
    checks.push({
      test: () => varHits.length > 0,
      sev: 'warn',
      title: `var Declarations (${varHits.length} found)`,
      desc: `${varHits.length} var keyword${varHits.length!==1?'s':''} found across ${[...new Set(varHits.map(h=>h.path))].length} file${[...new Set(varHits.map(h=>h.path))].length!==1?'s':''}. Replace with const or let for modern JS.`,
      fix: 'fixVarToConst',
      risk: 'medium',
      find: 'var ',
      hits: varHits.slice(0, 30)
    });

    // 2. Code Moderniser — require() → import
    const reqHits = collectHits(jsFiles, /\brequire\s*\(\s*['"`]/);
    checks.push({
      test: () => reqHits.length > 0,
      sev: 'warn',
      title: `require() Calls (${reqHits.length} found)`,
      desc: `${reqHits.length} CommonJS require() call${reqHits.length!==1?'s':''} found. Migrate to ES module import statements.`,
      fix: 'fixRequireToImport',
      risk: 'medium',
      find: 'require(',
      hits: reqHits.slice(0, 30)
    });

    // 3. Hardcoded Strings (long literals in JS)
    const strHits = collectHits(jsFiles, /(?<!=\s*)['"`][A-Za-z][^'"`\n]{20,}['"`]/);
    checks.push({
      test: () => strHits.length > 0,
      sev: 'info',
      title: `Hardcoded Strings (${strHits.length} found)`,
      desc: `${strHits.length} long string literal${strHits.length!==1?'s':''} in JS files. Consider extracting to constants or i18n keys.`,
      risk: 'safe',
      find: null,
      hits: strHits.slice(0, 30)
    });

    // 4. Function Names
    const fnHits = collectHits([...jsFiles], /(?:function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)|(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s*)?\()/);
    checks.push({
      test: () => fnHits.length > 0,
      sev: 'info',
      title: `Function Definitions (${fnHits.length} found)`,
      desc: `${fnHits.length} function${fnHits.length!==1?'s':''} defined across ${[...new Set(fnHits.map(h=>h.path))].length} file${[...new Set(fnHits.map(h=>h.path))].length!==1?'s':''}. Use to audit naming or find dead code.`,
      risk: 'safe',
      find: null,
      hits: fnHits.slice(0, 50)
    });

    // 5. CSS Colours
    const cssAllFiles = [...cssFiles, ...htmlFiles, ...jsFiles];
    const colHits = collectHits(cssAllFiles, /#[0-9a-fA-F]{3,8}\b|rgba?\s*\([^)]+\)|hsla?\s*\([^)]+\)/);
    const uniqueCols = [...new Map(colHits.map(h=>[h.match, h])).values()];
    checks.push({
      test: () => uniqueCols.length > 0,
      sev: 'info',
      title: `CSS Colours (${uniqueCols.length} unique)`,
      desc: `${uniqueCols.length} unique colour value${uniqueCols.length!==1?'s':''} found across your codebase. Audit for inconsistencies or extract to design tokens.`,
      risk: 'safe',
      find: null,
      hits: uniqueCols.slice(0, 40)
    });

    // 6. API Endpoints
    const apiHits = collectHits([...jsFiles,...htmlFiles], /['"`](\/api\/[^'"`\s?#]{2,})|app\s*\.\s*(?:get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)/i);
    checks.push({
      test: () => apiHits.length > 0,
      sev: 'info',
      title: `API Endpoints (${apiHits.length} found)`,
      desc: `${apiHits.length} API route${apiHits.length!==1?'s':''} or fetch endpoint${apiHits.length!==1?'s':''} found. Review for unused or undocumented routes.`,
      risk: 'safe',
      find: null,
      hits: apiHits.slice(0, 30)
    });

    // 7. Error Messages
    const errHits = collectHits(jsFiles, /(?:throw\s+new\s+Error|new\s+Error|console\.error)\s*\(\s*['"`]([^'"`]{3,})/);
    checks.push({
      test: () => errHits.length > 0,
      sev: 'info',
      title: `Error Messages (${errHits.length} found)`,
      desc: `${errHits.length} error message${errHits.length!==1?'s':''} found. Review before ship — user-facing errors should be friendly.`,
      risk: 'safe',
      find: null,
      hits: errHits.slice(0, 30)
    });

    // ── NEW: Route collision
    const routeHits = collectHits([...jsFiles], /app\.(?:get|post|put|delete|patch)\s*\(\s*(['"`])([^'"`]+)\1/i);
    const routeStrings = routeHits.map(h=>h.match);
    const dupRoutes = routeStrings.filter((r,i)=>routeStrings.indexOf(r)!==i);
    checks.push({ test:()=>dupRoutes.length>0, sev:'warn', title:`Duplicate Routes (${dupRoutes.length} found)`, desc:`${dupRoutes.length} route string${dupRoutes.length!==1?'s are':' is'} defined more than once. Duplicate routes cause unpredictable request handling.`, risk:'medium', find:null, hits:routeHits.filter(h=>dupRoutes.includes(h.match)).slice(0,20) });

    // ── NEW: CSS over-specificity
    const cssSpecHits = collectHits(cssFiles, /[^\s{]+\s+[^\s{]+\s+[^\s{]+\s+[^\s{]+\s*\{/);
    checks.push({ test:()=>cssSpecHits.length>0, sev:'info', title:`High CSS Specificity (${cssSpecHits.length} found)`, desc:`${cssSpecHits.length} CSS rule${cssSpecHits.length!==1?'s':''} with 4+ selectors. Overly specific selectors are hard to override and indicate poor architecture.`, risk:'safe', find:null, hits:cssSpecHits.slice(0,30) });

    // ── NEW: Fetch URL vs defined routes consistency
    const fetchHits = collectHits([...jsFiles,...htmlFiles], /fetch\s*\(\s*['"`]\/[^'"`]+['"`]/);
    checks.push({ test:()=>fetchHits.length>0, sev:'info', title:`fetch() Calls (${fetchHits.length} found)`, desc:`${fetchHits.length} fetch call${fetchHits.length!==1?'s':''} in source. Review against your defined API routes — mismatches cause silent 404s.`, risk:'safe', find:null, hits:fetchHits.slice(0,30) });
  }


  // ── ASSETS ──
  if (type==='assets') {
    // JSON validation
    const jsonFilesAll = allPaths.filter(p=>p.endsWith('.json')&&!p.includes('node_modules'));
    const badJson = jsonFilesAll.filter(p=>{ try{ JSON.parse(getFileContent(p)||''); return false; }catch(e){ return true; } });
    checks.push({ test:()=>badJson.length>0, sev:'fail', title:`Invalid JSON (${badJson.length} file${badJson.length!==1?'s':''})`, desc:`${badJson.length} JSON file${badJson.length!==1?'s':''} failed to parse — malformed syntax. Will break builds, imports, and config loading.`, risk:'high', find:null, hits:badJson.map(p=>({file:p.split('/').pop(),path:p,line:1,match:'JSON parse error'})) });

    // Config file issues — .env syntax
    const envFiles = allPaths.filter(p=>p.includes('.env')&&!p.includes('node_modules'));
    const badEnvLines = (() => { const r=[]; envFiles.forEach(p=>{ const c=getFileContent(p)||''; c.split('\n').forEach((line,i)=>{ if(line.trim()&&!line.startsWith('#')&&!/^[A-Za-z_][A-Za-z0-9_]*=/.test(line)){ r.push({file:p.split('/').pop(),path:p,line:i+1,match:line.trim().slice(0,60)}); } }); }); return r; })();
    checks.push({ test:()=>badEnvLines.length>0, sev:'warn', title:`Malformed .env Lines (${badEnvLines.length})`, desc:`${badEnvLines.length} line${badEnvLines.length!==1?'s':''} in .env files don't follow KEY=value format. These will be silently ignored by most loaders.`, risk:'medium', find:null, hits:badEnvLines.slice(0,20) });

    // Web manifest
    const manifestPath = allPaths.find(p=>p.endsWith('manifest.json')||p.endsWith('manifest.webmanifest'));
    if (manifestPath) {
      let manifest = {}; try { manifest = JSON.parse(getFileContent(manifestPath)||'{}'); } catch(e){}
      const required = ['name','short_name','icons','start_url','display'];
      const missingFields = required.filter(f=>!manifest[f]);
      checks.push({ test:()=>missingFields.length>0, sev:'warn', title:`Web Manifest Missing Fields (${missingFields.length})`, desc:`Manifest is missing: ${missingFields.join(', ')}. Required for PWA installability.`, risk:'safe', find:null, hits:missingFields.map(f=>({file:'manifest.json',path:manifestPath,line:1,match:`missing: ${f}`})) });
      if (manifest.icons) {
        checks.push({ test:()=>!manifest.icons.some(ic=>ic.sizes&&ic.sizes.includes('512')), sev:'info', title:'Web Manifest: No 512px Icon', desc:'No 512x512 icon defined in manifest. Required for high-resolution PWA splash screens.', risk:'safe', find:null });
      }
    } else {
      checks.push({ test:()=>allPaths.some(p=>p.endsWith('.html')), sev:'info', title:'No Web Manifest Found', desc:'No manifest.json or manifest.webmanifest in workspace. Required to make your site installable as a PWA.', risk:'safe', find:null });
    }

    // Dead files — files not referenced anywhere
    const allContentBlob = allPaths.filter(p=>/\.[jt]sx?$|html?$/.test(p)).map(p=>getFileContent(p)||'').join(' ');
    const orphanedFiles = allPaths.filter(p=>{
      if(!/\.(css|png|jpg|jpeg|gif|svg|webp|woff2?|ttf|ico)$/.test(p)) return false;
      const fname = p.split('/').pop();
      return !allContentBlob.includes(fname);
    });
    checks.push({ test:()=>orphanedFiles.length>0, sev:'info', title:`Unreferenced Asset Files (${orphanedFiles.length})`, desc:`${orphanedFiles.length} asset file${orphanedFiles.length!==1?'s':''} (CSS, images, fonts) not referenced in any HTML or JS. Possible dead files bloating your bundle.`, risk:'safe', find:null, hits:orphanedFiles.map(p=>({file:p.split('/').pop(),path:p,line:1,match:p})) });

    // Large files
    const largeFiles = allPaths.filter(p=>{ const c=getFileContent(p)||''; return c.length>100000; }).map(p=>{ const c=getFileContent(p)||''; return {file:p.split('/').pop(),path:p,line:1,match:`${Math.round(c.length/1024)}KB`}; });
    checks.push({ test:()=>largeFiles.length>0, sev:'info', title:`Large Files (${largeFiles.length} over 100KB)`, desc:`${largeFiles.length} file${largeFiles.length!==1?'s are':' is'} over 100KB uncompressed. Consider splitting, minifying, or lazy-loading.`, risk:'safe', find:null, hits:largeFiles.slice(0,20) });

    // YAML syntax (basic)
    const yamlFiles = allPaths.filter(p=>p.endsWith('.yml')||p.endsWith('.yaml'));
    const badYaml = yamlFiles.filter(p=>{ const c=getFileContent(p)||''; return /\t/.test(c); });
    checks.push({ test:()=>badYaml.length>0, sev:'warn', title:`YAML Tab Characters (${badYaml.length} file${badYaml.length!==1?'s':''})`, desc:'YAML does not allow tab characters for indentation — will cause parse errors in CI/CD pipelines and Docker Compose.', risk:'medium', find:null, hits:badYaml.map(p=>({file:p.split('/').pop(),path:p,line:1,match:'Tab character detected'})) });
  }

  // Run all checks
  const issues = [];
  checks.forEach(ch => {
    try { if (ch.test()) issues.push(ch); } catch(e){}
  });
  const passed = checks.filter(ch => { try { return !ch.test(); } catch(e){ return true; } });

  _lastScanIssues[type] = issues;

  // Update badge
  const badgeId = {security:'secBadge',seo:'seoBadge',quality:'qualBadge',refactor:'refBadge',assets:'assetsBadge'}[type];
  updateBadge(badgeId, issues.length);

  // Update notif dot
  const total = _lastScanIssues.security.length + _lastScanIssues.seo.length + _lastScanIssues.quality.length + _lastScanIssues.refactor.length + _lastScanIssues.assets.length;
  updateNotifDot(total);

  if (mode==='badge'||mode==='silent') return;

  // Full render
  const panel = document.getElementById('scannerPanel');
  const body = document.getElementById('spBody');
  const titleEl = document.getElementById('spTitle');
  const names = {security:'🛡 Security',seo:'🔍 SEO',quality:'⚡ Quality',refactor:'🔧 Refactor',assets:'📦 Assets'};
  if (titleEl) titleEl.textContent = names[type]||type;

  const score = checks.length ? Math.round((passed.length/checks.length)*100) : 100;
  const scoreClass = score===100?'score-good':score>=70?'score-ok':'score-bad';
  const scoreLabel = score===100?'All checks passed ✓':score>=90?'Excellent':score>=70?'Good — needs attention':'Needs work';
  const rescanFn = `_rescan_${type}`;
  window[rescanFn] = () => runScanner(type,'silent');

  body.innerHTML = `
    <div class="sp-score">
      <div class="score-num ${scoreClass}">${score}%</div>
      <div style="font-size:10px;color:var(--tx3);margin-top:4px">${scoreLabel}</div>
      <div style="font-size:9px;color:var(--tx3);margin-top:2px">${issues.length} issue${issues.length!==1?'s':''} · ${passed.length} passed</div>
    </div>
    <div class="sp-actions">
      <button class="sp-action-btn" onclick="runScanner('${type}','silent');runScanner('${type}')">↺ Re-scan</button>
      ${issues.filter(i=>i.fix&&!i.input).length>0?`<button class="sp-action-btn primary" onclick="confirmFixAll('${type}')">⚡ Fix All (${issues.filter(i=>i.fix&&!i.input).length})</button>`:''}
    </div>`;

  groupBySeverity(issues, passed, type, body);

  if (!mode) toast('VEX: Scanned '+type+' — '+issues.length+' issue'+(issues.length!==1?'s':'')+(issues.length===0?' 🎉':''), issues.length===0?'success':'warn');
}

function scoreWidget(){}

function groupBySeverity(issues, passed, type, container) {
  const groups = { fail:[], warn:[], info:[] };
  issues.forEach(i => (groups[i.sev]||groups.info).push(i));
  const rescanFn = `_rescan_${type}`;
  const labels = { fail:['❌ FAILURES','#ef4444'], warn:['⚠️ WARNINGS','#f59e0b'], info:['💡 INFO','#60a5fa'] };
  ['fail','warn','info'].forEach(sev => {
    if (!groups[sev].length) return;
    const [label,color] = labels[sev];
    const hdr = document.createElement('div');
    hdr.className = 'sev-hdr';
    hdr.innerHTML = `<span class="sev-label" style="color:${color}">${label}</span><span style="font-size:9px;color:var(--tx3)">${groups[sev].length}</span>`;
    container.appendChild(hdr);
    groups[sev].forEach(issue => container.appendChild(renderScanItem(issue, rescanFn)));
  });
  if (passed.length > 0) {
    const hdr = document.createElement('div');
    hdr.className = 'sev-hdr';
    hdr.innerHTML = `<span class="sev-label" style="color:#22c55e">✅ PASSED</span><span style="font-size:9px;color:var(--tx3)">${passed.length}</span>`;
    const toggle = document.createElement('span');
    toggle.style.cssText='font-size:9px;color:var(--gold);cursor:pointer;margin-left:auto';
    toggle.textContent='Show'; let shown=false;
    const wrap = document.createElement('div'); wrap.style.display='none';
    passed.forEach(p=>{ const el=document.createElement('div'); el.className='scan-item scan-pass'; el.innerHTML=`<b>${p.title}</b><div class="desc">${p.desc}</div>`; wrap.appendChild(el); });
    toggle.onclick=()=>{ shown=!shown; wrap.style.display=shown?'block':'none'; toggle.textContent=shown?'Hide':'Show'; };
    hdr.appendChild(toggle); container.appendChild(hdr); container.appendChild(wrap);
  }
}

function renderScanItem(issue, rescanFn) {
  const el = document.createElement('div');
  el.className = 'scan-item';
  let html = `<b>${issue.title}</b><div class="desc">${issue.desc}</div>`;
  if (issue.input) {
    html += `<div style="font-size:9px;color:var(--tx3);margin-bottom:3px">${issue.input.label}:</div>`;
    html += `<input class="scan-input" id="${issue.input.id}" placeholder="${issue.input.placeholder}">`;
  }
  if (issue.hits && issue.hits.length > 0) {
    const hitsId = 'hits_' + Math.random().toString(36).slice(2);
    html += `<div style="margin:5px 0 3px 0"><button class="sp-action-btn" onclick="var h=document.getElementById('${hitsId}');h.style.display=h.style.display==='none'?'block':'none'">▾ Show matches</button></div>`;
    html += `<div id="${hitsId}" style="display:none;max-height:140px;overflow-y:auto;background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:4px 6px;margin-bottom:4px">`;
    issue.hits.forEach(h => {
      const cleanMatch = (h.match||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      html += `<div style="font-family:monospace;font-size:9px;padding:2px 0;border-bottom:1px solid var(--border);display:flex;gap:6px;align-items:baseline"><span style="color:var(--tx3);flex-shrink:0">${h.file}:${h.line}</span><span style="color:var(--gold)">${cleanMatch}</span></div>`;
    });
    html += `</div>`;
  }
  html += `<div class="scan-item-row">`;
  if (issue.fix) {
    const inputArg = issue.input ? `,'${issue.input.id}'` : '';
    html += `<button class="fix-btn" onclick="executeFix('${issue.fix}','${rescanFn}'${inputArg})">⚡ Fix All</button>`;
  }
  if (issue.risk) html += riskBadge(issue.risk);
  if (issue.risky) html += `<span style="font-size:9px;color:var(--tx3)">${issue.risky}</span>`;
  if (issue.find) html += `<button class="jump-btn" onclick="jumpToCode('${issue.find.replace(/'/g,"\\'")}')">Jump →</button>`;
  html += `</div>`;
  el.innerHTML = html;
  return el;
}

function riskBadge(risk) {
  return `<span class="risk-badge ${risk}">${risk.toUpperCase()}</span>`;
}

function jumpToCode(str) {
  closeScanner();
  if (!editor) { toast('No file open'); return; }
  const content = editor.getModel().getValue();
  const idx = content.toLowerCase().indexOf(str.toLowerCase());
  if (idx===-1) { toast('VEX: Not found in active file'); return; }
  const pos = editor.getModel().getPositionAt(idx);
  editor.setSelection({ startLineNumber:pos.lineNumber, startColumn:pos.column, endLineNumber:pos.lineNumber, endColumn:pos.column+str.length });
  editor.revealLineInCenter(pos.lineNumber);
  editor.focus();
}

function openScanner(type) {
  _activeScannerType = type;
  document.querySelectorAll('.scan-btn').forEach(b=>b.classList.remove('active'));
  const bm = {security:'secBtn',seo:'seoBtn',quality:'qualBtn',refactor:'refBtn',assets:'assetsBtn'};
  if (bm[type]) document.getElementById(bm[type]).classList.add('active');
  document.getElementById('scannerPanel').classList.add('open');
  setTimeout(()=>runScanner(type), 50);
}

function closeScanner() {
  document.getElementById('scannerPanel').classList.remove('open');
  document.querySelectorAll('.scan-btn').forEach(b=>b.classList.remove('active'));
  _activeScannerType = null;
}

function openChecklist() {
  const w = ws();
  if (!w||!w.allFilePaths.length) { toast('Open a workspace first'); return; }
  _projectType = detectProjectType();
  const pt = _projectType;
  if (!vexChatOpen) vexToggleChat();
  vexChime();

  const ptLabel = {html:'HTML',nextjs:'NEXT.JS',vite:'VITE',nuxt:'NUXT',svelte:'SVELTE','react-spa':'REACT','vue':'VUE','node-server':'NODE','typescript':'TYPESCRIPT','generic-js':'JAVASCRIPT'}[pt]||pt.toUpperCase();
  const allPaths = w.allFilePaths;
  const htmlFiles = allPaths.filter(p=>/\.html?$/.test(p));
  const jsFiles = allPaths.filter(p=>/\.[jt]sx?$/.test(p));

  let categories = [];

  if (pt==='html') {
    categories = [
      { icon:'🔨', title:'HTML Structure', scanner:null, checks:[
        { label:'Has DOCTYPE', pass:filesMatching(htmlFiles,c=>/<!DOCTYPE html>/i.test(c)).length>0||!htmlFiles.length },
        { label:'Has <html> tag', pass:filesMatching(htmlFiles,c=>/<html/i.test(c)).length>0||!htmlFiles.length },
        { label:'Has <head> tag', pass:filesMatching(htmlFiles,c=>/<head/i.test(c)).length>0||!htmlFiles.length },
        { label:'Has <body> tag', pass:filesMatching(htmlFiles,c=>/<body/i.test(c)).length>0||!htmlFiles.length },
      ]},
      { icon:'🔍', title:'SEO Essentials', scanner:'seo', checks:[
        { label:'Has <title>', pass:filesMatching(htmlFiles,c=>/<title[\s>]/i.test(c)).length>0||!htmlFiles.length },
        { label:'Has meta description', pass:filesMatching(htmlFiles,c=>/<meta[^>]+description/i.test(c)).length>0||!htmlFiles.length },
        { label:'Has viewport meta', pass:filesMatching(htmlFiles,c=>/<meta[^>]+viewport/i.test(c)).length>0||!htmlFiles.length },
        { label:'Has <h1>', pass:filesMatching(htmlFiles,c=>/<h1[\s>]/i.test(c)).length>0||!htmlFiles.length },
      ]},
      { icon:'♿', title:'Accessibility', scanner:'seo', checks:[
        { label:'<html> has lang attr', pass:filesMatching(htmlFiles,c=>/<html[^>]+lang/i.test(c)).length>0||!htmlFiles.length },
        { label:'Images have alt text', pass:!filesMatching(htmlFiles,c=>/<img(?![^>]*alt\s*=)/i.test(c)).length },
      ]},
      { icon:'🛡', title:'Security', scanner:'security', checks:[
        { label:'No javascript: URLs', pass:!filesMatching(htmlFiles,c=>/href\s*=\s*["']javascript:/i.test(c)).length },
        { label:'No inline event handlers', pass:!filesMatching(htmlFiles,c=>/\bon\w+\s*=\s*["']/.test(c)).length },
        { label:'Scripts use HTTPS', pass:!filesMatching(htmlFiles,c=>/<script[^>]+src\s*=\s*["']http:\/\//i.test(c)).length },
      ]},
      { icon:'⚡', title:'Code Quality', scanner:'quality', checks:[
        { label:'No console.log', pass:!filesMatching(jsFiles,c=>/console\.log/.test(c)).length },
        { label:'No debugger statements', pass:!filesMatching(jsFiles,c=>/\bdebugger\b/.test(c)).length },
        { label:'Has CSS styling', pass:allPaths.some(p=>/\.css$/.test(p))||filesMatching(htmlFiles,c=>/<style/.test(c)).length>0 },
      ]},
    ];
  } else {
    const pkgPaths = allPaths.filter(p=>p.endsWith('package.json'));
    const pkg = pkgPaths.length ? (()=>{ try{return JSON.parse(getFileContent(pkgPaths[0])||'{}')}catch(e){return{}} })() : {};
    categories = [
      { icon:'📦', title:'Project Setup', scanner:null, checks:[
        { label:'package.json exists', pass:pkgPaths.length>0 },
        { label:'Has "name" field', pass:!!pkg.name },
        { label:'Has "version" field', pass:!!pkg.version },
        { label:'.gitignore exists', pass:allPaths.some(p=>p.endsWith('.gitignore')) },
        { label:'README exists', pass:allPaths.some(p=>/readme\.md$/i.test(p)) },
        ...(pt==='nextjs'||pt==='typescript'||pt==='vite'?[{ label:'tsconfig.json exists', pass:allPaths.some(p=>p.endsWith('tsconfig.json')) }]:[]),
      ]},
      { icon:'⚡', title:'Code Quality', scanner:'quality', checks:[
        { label:'No console.log', pass:!filesMatching(jsFiles,c=>/console\.log/.test(c)).length },
        { label:'No debugger statements', pass:!filesMatching(jsFiles,c=>/\bdebugger\b/.test(c)).length },
        { label:'No TODO/FIXME', pass:!filesMatching(jsFiles,c=>/\/\/\s*(TODO|FIXME)/i.test(c)).length },
        ...(pt==='nextjs'?[{ label:'Error boundary exists', pass:allPaths.some(p=>/error\.[jt]sx?$/.test(p)) }]:[]),
        ...(pt==='vite'?[{ label:'vite.config exists', pass:allPaths.some(p=>p.includes('vite.config')) }]:[]),
      ]},
      { icon:'🛡', title:'Security', scanner:'security', checks:[
        { label:'No eval() usage', pass:!filesMatching(jsFiles,c=>/\beval\s*\(/.test(c)).length },
        { label:'No hardcoded secrets', pass:!filesMatching(allPaths,c=>/(api[_-]?key|secret|password)\s*[:=]\s*['"`][^'"`]{8,}/i.test(c)).length },
        { label:'.gitignore protects .env', pass:!allPaths.some(p=>p.endsWith('.env'))||allPaths.some(p=>p.endsWith('.gitignore')) },
      ]},
      { icon:'🚀', title:'Deploy Ready', scanner:null, checks:[
        { label:'Has "build" script', pass:!!(pkg.scripts&&pkg.scripts.build) },
        { label:'Has "start" script', pass:!!(pkg.scripts&&(pkg.scripts.start||pkg.scripts.dev)) },
        { label:'No debug code', pass:!filesMatching(jsFiles,c=>/\bdebugger\b/.test(c)).length },
        { label:'No leaked secrets', pass:!filesMatching(allPaths,c=>/(api[_-]?key|secret)\s*[:=]\s*['"`][^'"`]{16,}/i.test(c)).length },
        ...(pt==='nextjs'?[{ label:'vercel.json exists', pass:allPaths.some(p=>p.endsWith('vercel.json')) }]:[]),
      ]},
    ];
  }

  // Calculate readiness
  const allChecks = categories.flatMap(c=>c.checks);
  const passed = allChecks.filter(c=>c.pass).length;
  const total = allChecks.length;
  const pct = Math.round((passed/total)*100);
  const ready = pct===100;

  let html = `<div style="font-size:9px;font-weight:800;letter-spacing:1px;color:var(--gold);margin-bottom:12px;text-transform:uppercase">${ptLabel} · ${allPaths.length} FILES</div>`;

  categories.forEach((cat,i) => {
    const catPass = cat.checks.filter(c=>c.pass).length;
    const catFail = cat.checks.length - catPass;
    const catColor = catFail===0?'rgba(34,197,94,.2)':'rgba(239,68,68,.2)';
    html += `<div class="cl-section" style="border-left:3px solid ${catFail===0?'#22c55e':'#ef4444'}">`;
    html += `<div class="cl-header"><span class="cl-num">${i+1}</span><span class="cl-title">${cat.icon} ${cat.title}</span>`;
    if (catFail>0&&cat.scanner) html += `<button class="cl-go" onclick="closeChecklist();openScanner('${cat.scanner}')">Go →</button>`;
    html += `</div>`;
    cat.checks.forEach(ch => {
      html += `<div class="cl-check"><span>${ch.pass?'✅':'❌'}</span><span>${ch.label}</span></div>`;
    });
    html += `</div>`;
  });

  html += `<div class="readiness-bar">
    <div class="readiness-score ${pct===100?'score-good':pct>=70?'score-ok':'score-bad'}">${pct}%</div>
    <div class="readiness-label">Launch Readiness</div>
  </div>`;

  html += `<div class="conclusion ${ready?'conclusion-ready':'conclusion-notready'}">`;
  if (ready) {
    html += `<div style="font-size:20px">🎉</div><div style="font-weight:700;color:#22c55e;font-size:12px;margin-top:4px">Ready to Launch!</div><div style="font-size:10px;color:var(--tx3);margin-top:4px">All ${total} checks passed.</div>`;
  } else {
    const firstFail = categories.find(c=>c.checks.some(ch=>!ch.pass));
    html += `<div style="font-size:16px">🚫</div><div style="font-weight:700;color:#ef4444;font-size:12px;margin-top:4px">Not Ready — ${total-passed} item${total-passed!==1?'s':''} need fixing</div>`;
    if (firstFail&&firstFail.scanner) html += `<br><button class="cl-go" style="margin-top:6px" onclick="closeChecklist();openScanner('${firstFail.scanner}')">Start here → ${firstFail.icon} ${firstFail.title}</button>`;
  }
  html += `</div>`;

  vexAddMsg(html);
  if (ready) { vexCelebrate(); vexChime(); }
}

function closeChecklist() { /* chat stays open */ }

function vexChime() {
  try {
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    [880,1100].forEach((f,i) => {
      const o=ctx.createOscillator(), g=ctx.createGain();
      o.type='sine'; o.frequency.value=f;
      g.gain.setValueAtTime(0.08, ctx.currentTime+i*0.12);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+i*0.12+0.3);
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime+i*0.12); o.stop(ctx.currentTime+i*0.12+0.3);
    });
  } catch(e){}
}

function confirmFixAll(type) {
  runScanner(type,'silent');
  const issues = _lastScanIssues[type];
  const fixable = issues.filter(i=>i.fix&&!i.input);
  if (!fixable.length) { toast('Nothing auto-fixable'); return; }
  agentConfirm({
    title: `⚡ Fix All — ${fixable.length} ${type} issue${fixable.length!==1?'s':''}`,
    message: 'The following fixes will be applied automatically:',
    warnings: [{ type:'warn', icon:'⚠️', text:'Back up your code first. Some fixes modify your HTML structure.' }],
    risks: fixable.map(i=>({ label:i.title, risk:i.risk||'safe' })),
    tier: 2,
    noLabel: 'Cancel',
    yesLabel: `Fix ${fixable.length} Issues`,
    onYes: () => {
      fixable.forEach(i => { pushUndo(); if(window[i.fix]) window[i.fix](); });
      setTimeout(()=>{ runScanner(type); vexCelebrate(); }, 200);
    }
  });
}

function executeFix(fixName, rescanFn, inputId) {
  if (inputId) {
    const inp = document.getElementById(inputId);
    if (!inp||!inp.value.trim()) {
      toast('VEX: Type your text first');
      if(inp){inp.style.border='1px solid #ef4444'; setTimeout(()=>inp.style.border='',2000); inp.focus();}
      return;
    }
    pushUndo(); window[fixName](inp.value.trim());
  } else { pushUndo(); if(window[fixName]) window[fixName](); }
  vexCelebrate();
  if (rescanFn&&window[rescanFn]) setTimeout(()=>window[rescanFn](), 100);
  setTimeout(()=>{ runScanner('security','badge'); runScanner('seo','badge'); runScanner('quality','badge'); }, 200);
}

function agentConfirm(opts) {
  if (!vexChatOpen) vexToggleChat();
  const typeColors = { info:'rgba(139,53,200,.12)', warn:'rgba(245,158,11,.12)', danger:'rgba(239,68,68,.12)', success:'rgba(34,197,94,.12)' };
  const typeTextColors = { info:'#a78bfa', warn:'#f59e0b', danger:'#ef4444', success:'#22c55e' };
  let html = `<div style="font-size:14px;font-weight:700;margin-bottom:10px">${opts.title}</div>`;
  html += `<div style="font-size:11px;color:var(--tx3);margin-bottom:8px">${opts.message}</div>`;
  if (opts.warnings) opts.warnings.forEach(w => {
    html += `<div style="background:${typeColors[w.type]||typeColors.warn};border-radius:6px;padding:8px 10px;margin-bottom:6px;font-size:10px;color:${typeTextColors[w.type]||typeTextColors.warn}">${w.icon} ${w.text}</div>`;
  });
  if (opts.risks) opts.risks.forEach(r => {
    html += `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:10px;color:var(--tx2)">${riskBadge(r.risk||'safe')} ${r.label}</div>`;
  });
  const confirmId = 'agentConfirmYes_'+Date.now();
  html += `<div style="display:flex;gap:8px;margin-top:12px">
    <button onclick="this.closest('.vex-msg-inner').remove()" style="flex:1;padding:7px;background:var(--bg3);border:1px solid var(--border);border-radius:6px;color:var(--tx2);cursor:pointer;font-family:inherit;font-size:11px">${opts.noLabel||'Cancel'}</button>
    <button id="${confirmId}" style="flex:1;padding:7px;background:rgba(212,168,83,.15);border:1px solid var(--goldb);border-radius:6px;color:var(--gold);cursor:pointer;font-family:inherit;font-size:11px;font-weight:700">${opts.yesLabel||'Confirm'}</button>
  </div>`;
  const msgEl = vexAddMsg(html);
  requestAnimationFrame(()=>{
    const btn = document.getElementById(confirmId);
    if (btn) btn.onclick = () => { if(opts.onYes) opts.onYes(); if(msgEl&&msgEl.remove) msgEl.remove(); };
  });
  return msgEl;
}

// ── FIX FUNCTIONS ──
function _getEditorContent() { if(!editor||!activeTab) return null; return editor.getModel().getValue(); }
function _setEditorContent(val) {
  if(!editor||!activeTab) return;
  editor.getModel().setValue(val);
  const w=ws(); if(w){ w.fileContents[activeTab]=val; w.modifiedFiles.add(activeTab); updateModifiedCount(); }
}

function fixStripSensitiveComments() { const c=_getEditorContent(); if(!c) return; _setEditorContent(c.replace(/<!--[\s\S]*?(password|secret|token|api.?key)[\s\S]*?-->/gi,'')); toast('✓ Removed sensitive comments'); }
function fixInlineHandlers() { const c=_getEditorContent(); if(!c) return; _setEditorContent(c.replace(/\s+on(\w+)\s*=\s*["']([^"']*)["']/gi,(m,ev,fn)=>` data-event-${ev}="${fn}"`)); toast('✓ Converted inline handlers'); }
function fixIframeSandbox() { const c=_getEditorContent(); if(!c) return; _setEditorContent(c.replace(/<iframe(?![^>]*sandbox)([^>]*)>/gi,'<iframe sandbox="allow-scripts allow-same-origin"$1>')); toast('✓ Added iframe sandbox'); }
function fixTitle(val) { const c=_getEditorContent(); if(!c||!val) return; const r=c.replace(/<title[^>]*>.*?<\/title>/is,''); _setEditorContent(r.includes('</head>')?r.replace('</head>',`<title>${val}</title>\n</head>`):r+`<title>${val}</title>`); toast('✓ Title set'); }
function fixMetaDesc(val) { const c=_getEditorContent(); if(!c||!val) return; _setEditorContent(c.includes('</head>')?c.replace('</head>',`<meta name="description" content="${val}">\n</head>`):c+`<meta name="description" content="${val}">`); toast('✓ Meta description set'); }
function fixViewport() { const c=_getEditorContent(); if(!c) return; if(c.includes('viewport'))return; _setEditorContent(c.includes('</head>')?c.replace('</head>','<meta name="viewport" content="width=device-width, initial-scale=1">\n</head>'):c+'<meta name="viewport" content="width=device-width, initial-scale=1">'); toast('✓ Viewport added'); }
function fixImgAlt() { const c=_getEditorContent(); if(!c) return; _setEditorContent(c.replace(/<img(?![^>]*alt\s*=)([^>]*)>/gi,'<img alt=""$1>')); toast('✓ Added alt="" to images'); }
function fixLazyImages() { const c=_getEditorContent(); if(!c) return; _setEditorContent(c.replace(/<img(?![^>]*loading\s*=)([^>]*)>/gi,'<img loading="lazy"$1>')); toast('✓ Added lazy loading'); }
function fixLang() { const c=_getEditorContent(); if(!c) return; _setEditorContent(c.replace(/<html(?![^>]*lang\s*=)([^>]*)>/i,'<html lang="en"$1>')); toast('✓ Added lang="en"'); }
function fixDoctype() { const c=_getEditorContent(); if(!c) return; if(/<!DOCTYPE/i.test(c)) return; _setEditorContent('<!DOCTYPE html>\n'+c); toast('✓ Added DOCTYPE'); }
function fixConsoleLogs() { const c=_getEditorContent(); if(!c) return; _setEditorContent(c.replace(/console\.log\s*\([^)]*\)\s*;?/g,'')); toast('✓ Removed console.log calls'); }

// ══════════════════════════════
//  DOCS PANEL
// ══════════════════════════════
const _DOCS_CONTENT = {
  security: `
    <div style="margin-bottom:14px">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--tx3);margin-bottom:6px">WHAT IT SCANS</div>
      <div style="color:var(--tx2);font-size:12px">Scans all .js .ts .jsx .tsx .html files for attack vectors, exposed secrets, unsafe function calls, and auth issues. High-severity failures block your Launch Readiness score.</div>
    </div>
    ${_docsTable([
      ['Hardcoded Secrets','API keys & tokens in source — sk-, AKIA, ghp_, api_key="…" patterns across ALL files','fail','Jump →'],
      ['Hardcoded JWT Tokens','Full JWT tokens in source — also flags expired tokens by decoding the payload','fail','Show matches'],
      ['SQL Injection Patterns','Raw string concat or template literals in SQL queries — use parameterised queries','fail','Show matches'],
      ['Unsafe Function Calls','exec(), spawn(), child_process, execSync — verify inputs are never user-controlled','warn','Show matches'],
      ['Insecure Cookie Flags','Cookies set without httpOnly or secure flags — vulnerable to XSS and interception','warn','Show matches'],
      ['eval() Usage','Any eval() call in JS or HTML. Primary XSS and code injection vector','warn','Jump →'],
      ['innerHTML Assignment','Direct .innerHTML = writes. If user input passes through, stored XSS hole','warn','Jump →'],
      ['Secrets in Comments','HTML comments with password/token/api_key keywords — visible in page source','fail','⚡ Auto-fix'],
      ['Inline Event Handlers','onclick="" onload="" etc. Bypass CSP and hard to audit','fail','Jump →'],
      ['javascript: URLs','href="javascript:…" executes code directly, bypasses security policies','fail','Jump →'],
      ['Non-HTTPS Script Sources','script src="http://…" — HTTP scripts can be MITM-replaced','fail','Jump →'],
      ['Unsandboxed iframes','iframe without sandbox attribute inherits full page context access','warn','⚡ Auto-fix'],
      ['dangerouslySetInnerHTML','React raw HTML escape hatch — React only','warn','Jump →'],
      ['.env Without .gitignore','Secrets could be committed to git — Next.js only','fail','—'],
      ['process.env in Client','Vite uses import.meta.env not process.env — Vite only','warn','Jump →'],
    ])}`,
  seo: `
    <div style="margin-bottom:14px">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--tx3);margin-bottom:6px">WHAT IT SCANS</div>
      <div style="color:var(--tx2);font-size:12px">HTML files + Next.js layouts for missing SEO tags, social sharing tags, canonical issues, and accessibility. Most checks have auto-fixes.</div>
    </div>
    ${_docsTable([
      ['Missing Page Title','No title tag — required for search engine indexing and browser tabs','fail','⚡ Auto-fix'],
      ['Title Too Long','Title over 60 chars — Google truncates it in search results','warn','Jump →'],
      ['Missing Meta Description','No meta name="description" — the snippet shown under your link in Google','fail','⚡ Auto-fix'],
      ['Missing Viewport','No meta viewport — site renders at desktop width on mobile, looks broken','fail','⚡ Auto-fix'],
      ['No H1 Heading','No h1 on the page — primary topic signal for Google','warn','Jump →'],
      ['Images Missing Alt Text','img with no alt= — screen readers cannot describe it, Google cannot index it','warn','⚡ Auto-fix'],
      ['No Lazy Loading on Images','img without loading="lazy" — all images load on entry, slows Core Web Vitals','info','⚡ Auto-fix'],
      ['Missing lang Attribute','html tag has no lang= — required for accessibility compliance','warn','⚡ Auto-fix'],
      ['Missing og:title','No Open Graph title — link previews on Slack/LinkedIn show no title','warn','Jump →'],
      ['Missing og:description','No Open Graph description — link preview cards show no description','warn','Jump →'],
      ['Missing og:image','No Open Graph image — link previews show no thumbnail, lower CTR','info','Jump →'],
      ['Missing Twitter Card','No twitter:card meta tag — Twitter/X link previews will be minimal','info','Jump →'],
      ['Missing Canonical Tag','No canonical link — Google may penalise duplicate content across URL variants','info','Jump →'],
      ['Robots noindex Found','Pages with noindex set — Google will not index these, verify intentional','warn','Show matches'],
      ['Missing metadata Export','Next.js layout files should export metadata object — Next.js only','fail','Jump →'],
    ])}`,
  quality: `
    <div style="margin-bottom:14px">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--tx3);margin-bottom:6px">WHAT IT SCANS</div>
      <div style="color:var(--tx2);font-size:12px">Debug code left in production, dead imports, Dockerfile issues, env completeness, and framework-specific mistakes that cause runtime failures or failed deploys.</div>
    </div>
    ${_docsTable([
      ['console.log() Present','Debug logs pollute the browser console and leak internal data','info','⚡ Auto-fix'],
      ['TODO / FIXME Comments','// TODO // FIXME // HACK // XXX — unresolved work items before ship','info','Jump →'],
      ['debugger Statements','Pauses execution in any browser with devtools open','warn','Jump →'],
      ['document.write() Usage','Blocks HTML parser — performance anti-pattern in all modern codebases','warn','Jump →'],
      ['Dead Imports','Imports that appear unused — bloats bundle size, creates confusion','info','Show matches'],
      ['Env Keys Missing from .env.example','Keys in .env not documented in .env.example — other devs will not know they exist','warn','Show matches'],
      ['Dockerfile: Missing FROM','No FROM instruction — Dockerfile cannot build','fail','Jump →'],
      ['Dockerfile: Unpinned Base Image','Base image with no version tag — can change silently and break builds','warn','Jump →'],
      ['Dockerfile: No USER Instruction','Container runs as root — security risk in production','warn','Jump →'],
      ['Dockerfile: No HEALTHCHECK','Orchestrators cannot determine container health without this','info','—'],
      ['Possible GPL Dependencies','Package names matching GPL/AGPL patterns — verify licences before commercial use','warn','Show matches'],
      ['Missing DOCTYPE','No DOCTYPE html — browser renders in quirks mode — HTML only','fail','⚡ Auto-fix'],
      ['Unpinned Dependencies','* or latest versions in package.json — can silently break builds','warn','Jump →'],
      ['Missing .gitignore','node_modules and .env can be accidentally committed to git','warn','—'],
      ['Client Hooks Without "use client"','useState/useEffect in app/ without directive — runtime error — Next.js only','warn','Jump →'],
      ['No Error Boundary','No error.tsx — unhandled errors show a blank page — Next.js only','info','—'],
      ['Excessive "any" Types','More than 5 : any in TS files defeats the purpose of TypeScript','info','Jump →'],
    ])}`,
  refactor: `
    <div style="margin-bottom:14px">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--tx3);margin-bottom:6px">WHAT IT SCANS</div>
      <div style="color:var(--tx2);font-size:12px">Regex-powered workspace-wide finders and modernisers. Two checks auto-fix legacy patterns across all files. The rest list every match with file and line number.</div>
    </div>
    <div style="background:var(--bg3);border:1px solid var(--border);border-left:3px solid var(--gold);border-radius:5px;padding:10px 12px;margin-bottom:14px;font-size:11px;color:var(--tx2)">
      <b style="color:var(--gold)">VS Code gap:</b> VS Code refactors one file at a time. VEX finds every instance across your entire workspace and fixes them all in one click.
    </div>
    ${_docsTable([
      ['var Declarations','Every var keyword in JS/TS — function-scoped and a source of hard-to-trace bugs','warn','⚡ Fix all files'],
      ['require() Calls','CommonJS require() — mixed require/import breaks bundlers and prevents tree-shaking','warn','⚡ Fix all files'],
      ['Duplicate Routes','Express route strings defined more than once — causes unpredictable request handling','warn','Show matches'],
      ['fetch() Calls','All fetch() calls in source — cross-reference against your API routes for mismatches','info','Show matches'],
      ['High CSS Specificity','CSS rules with 4+ chained selectors — hard to override, indicates poor architecture','info','Show matches'],
      ['Hardcoded Strings','String literals over 20 chars — candidates for constants, config, or i18n keys','info','Show matches'],
      ['Function Definitions','Every named function across all files — full inventory for dead code or duplicate names','info','Show matches'],
      ['CSS Colours','Every unique #hex rgb() hsl() value — audit consistency, find magic colour numbers','info','Show matches'],
      ['API Endpoints','/api/ routes and Express app.get/post/put/delete() — review for unused or unauth routes','info','Show matches'],
      ['Error Messages','throw new Error() / console.error() strings — review user-facing messages before ship','info','Show matches'],
    ])}`,
  assets: `
    <div style="margin-bottom:14px">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--tx3);margin-bottom:6px">WHAT IT SCANS</div>
      <div style="color:var(--tx2);font-size:12px">Project files, configs, and assets — JSON validity, env syntax, web manifest completeness, dead files, large files, and YAML issues. Catches problems that break builds silently.</div>
    </div>
    ${_docsTable([
      ['Invalid JSON','Any .json file that fails to parse — will break builds, imports, and config loading','fail','—'],
      ['Malformed .env Lines','Lines in .env files not following KEY=value format — silently ignored by most loaders','warn','—'],
      ['Web Manifest Missing Fields','manifest.json missing required PWA fields: name, short_name, icons, start_url, display','warn','—'],
      ['Web Manifest: No 512px Icon','No 512x512 icon in manifest — required for high-resolution PWA splash screens','info','—'],
      ['No Web Manifest Found','No manifest.json in workspace — site cannot be installed as a PWA','info','—'],
      ['Unreferenced Asset Files','CSS, images, fonts not referenced in any HTML or JS — possible dead files in bundle','info','Show matches'],
      ['Large Files (over 100KB)','Files over 100KB uncompressed — consider splitting, minifying, or lazy-loading','info','Show matches'],
      ['YAML Tab Characters','YAML files with tab indentation — YAML forbids tabs, breaks CI/CD and Docker Compose','warn','—'],
    ])}`,
  fixes: `
    <div style="margin-bottom:14px">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--tx3);margin-bottom:6px">ALL AUTO-FIX ACTIONS</div>
      <div style="color:var(--tx2);font-size:12px">Every check with a one-click fix button. Refactor fixes run across all workspace files. All others apply to the currently open file.</div>
    </div>
    ${_docsFixTable([
      ['var → const','Replaces all var with const across every JS/TS file. Review reassigned vars and convert to let manually','All JS/TS files','Refactor'],
      ['require() → import','Converts const x = require("y") to import x from "y" across all files. Named and default imports handled','All JS/TS files','Refactor'],
      ['Remove console.log','Strips all console.log() calls from the active file','Active file','Quality'],
      ['Add DOCTYPE','Prepends DOCTYPE html to the active HTML file','Active file','Quality'],
      ['Set Page Title','Inserts a title tag with the text you type in the input field','Active file','SEO'],
      ['Add Meta Description','Inserts meta name="description" with your typed text','Active file','SEO'],
      ['Add Viewport Meta','Inserts the standard viewport meta tag before closing head','Active file','SEO'],
      ['Add alt="" to images','Adds alt="" to every img missing it. Fill in meaningful text afterward','Active file','SEO'],
      ['Add lazy loading','Adds loading="lazy" to every img missing it','Active file','SEO'],
      ['Add lang attribute','Adds lang="en" to the html tag','Active file','SEO'],
      ['Sandbox iframes','Adds sandbox="allow-scripts allow-same-origin" to unsandboxed iframe tags','Active file','Security'],
      ['Strip Sensitive Comments','Removes HTML comments containing password/token/secret/api_key keywords','Active file','Security'],
    ])}`,
};

function _docsTable(rows) {
  const sevHtml = (s) => {
    const map = {fail:'#ef4444',warn:'#f97316',info:'#60a5fa'};
    const label = {fail:'❌ FAIL',warn:'⚠️ WARN',info:'💡 INFO'};
    const col = map[s]||'#999';
    return `<span style="font-size:9px;font-weight:700;font-family:var(--mono);color:${col};background:${col}22;border:1px solid ${col}33;padding:1px 5px;border-radius:3px;white-space:nowrap">${label[s]||s}</span>`;
  };
  const actionHtml = (a) => {
    if (a.includes('fix')||a.includes('Fix')) return `<span style="font-size:9px;font-family:var(--mono);color:var(--green);background:rgba(74,222,128,.08);border:1px solid rgba(74,222,128,.2);padding:1px 5px;border-radius:3px;white-space:nowrap">${a}</span>`;
    if (a === 'Jump →') return `<span style="font-size:9px;font-family:var(--mono);color:var(--gold);white-space:nowrap">${a}</span>`;
    return `<span style="font-size:9px;color:var(--tx3)">${a}</span>`;
  };
  let html = `<table style="width:100%;border-collapse:collapse;font-size:11px">
    <thead><tr>
      <th style="text-align:left;font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--tx3);padding:4px 8px;background:var(--bg3);border:1px solid var(--border)">Check</th>
      <th style="text-align:left;font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--tx3);padding:4px 8px;background:var(--bg3);border:1px solid var(--border)">What VEX finds</th>
      <th style="text-align:left;font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--tx3);padding:4px 8px;background:var(--bg3);border:1px solid var(--border);width:70px">Sev</th>
      <th style="text-align:left;font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--tx3);padding:4px 8px;background:var(--bg3);border:1px solid var(--border);width:90px">Action</th>
    </tr></thead><tbody>`;
  rows.forEach(([name, desc, sev, action]) => {
    html += `<tr>
      <td style="padding:8px;border:1px solid var(--border);background:var(--bg2);vertical-align:top;white-space:nowrap">
        <span style="font-family:var(--mono);font-size:10px;font-weight:700;color:var(--tx)">${name}</span>
      </td>
      <td style="padding:8px;border:1px solid var(--border);background:var(--bg2);vertical-align:top;color:var(--tx2);line-height:1.5">${desc}</td>
      <td style="padding:8px;border:1px solid var(--border);background:var(--bg2);vertical-align:top">${sevHtml(sev)}</td>
      <td style="padding:8px;border:1px solid var(--border);background:var(--bg2);vertical-align:top">${actionHtml(action)}</td>
    </tr>`;
  });
  return html + '</tbody></table>';
}

function _docsFixTable(rows) {
  let html = `<table style="width:100%;border-collapse:collapse;font-size:11px">
    <thead><tr>
      <th style="text-align:left;font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--tx3);padding:4px 8px;background:var(--bg3);border:1px solid var(--border)">Fix</th>
      <th style="text-align:left;font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--tx3);padding:4px 8px;background:var(--bg3);border:1px solid var(--border)">What it does</th>
      <th style="text-align:left;font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--tx3);padding:4px 8px;background:var(--bg3);border:1px solid var(--border);width:90px">Scope</th>
      <th style="text-align:left;font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--tx3);padding:4px 8px;background:var(--bg3);border:1px solid var(--border);width:65px">Scanner</th>
    </tr></thead><tbody>`;
  rows.forEach(([name, desc, scope, scanner]) => {
    const scopeCol = scope.includes('All') ? 'var(--purple)' : 'var(--blue)';
    html += `<tr>
      <td style="padding:8px;border:1px solid var(--border);background:var(--bg2);vertical-align:top;white-space:nowrap">
        <span style="font-family:var(--mono);font-size:10px;font-weight:700;color:var(--green)">${name}</span>
      </td>
      <td style="padding:8px;border:1px solid var(--border);background:var(--bg2);vertical-align:top;color:var(--tx2);line-height:1.5">${desc}</td>
      <td style="padding:8px;border:1px solid var(--border);background:var(--bg2);vertical-align:top;font-family:var(--mono);font-size:9px;color:${scopeCol}">${scope}</td>
      <td style="padding:8px;border:1px solid var(--border);background:var(--bg2);vertical-align:top;font-size:10px;color:var(--tx3)">${scanner}</td>
    </tr>`;
  });
  return html + '</tbody></table>';
}

function openDocs() {
  document.getElementById('docsPanel').style.display = 'flex';
  document.getElementById('docsAbBtn').classList.add('active');
  showDocsTab('security', document.querySelector('.docs-tab'));
}

function closeDocs() {
  document.getElementById('docsPanel').style.display = 'none';
  document.getElementById('docsAbBtn').classList.remove('active');
}

function showDocsTab(tab, btn) {
  document.querySelectorAll('.docs-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const body = document.getElementById('docsBody');
  body.innerHTML = _DOCS_CONTENT[tab] || '';
}

function fixVarToConst() {
  const w = ws(); if (!w) return;
  const jsFiles = w.allFilePaths.filter(p=>/\.[jt]sx?$/.test(p));
  let fixed = 0;
  jsFiles.forEach(p => {
    const c = getFileContent(p); if (!c) return;
    const updated = c.replace(/\bvar\s+([a-zA-Z_$][a-zA-Z0-9_$]*\s*=)/g, (match, rest) => {
      // Use let if reassigned later, const otherwise — heuristic: just use const, devs can fix
      return 'const ' + rest;
    });
    if (updated !== c) { fixed++; if (w.fileContents) w.fileContents[p] = updated; if (w.editorModels&&w.editorModels[p]) { const m=w.editorModels[p]; if(typeof m.setValue==='function') m.setValue(updated); } }
  });
  if (activeTab && jsFiles.includes(activeTab) && editor) { const m=editorModels[activeTab]; if(m) editor.setModel(m); }
  toast(`✓ Replaced var with const in ${fixed} file${fixed!==1?'s':''}`);
}

function fixRequireToImport() {
  const w = ws(); if (!w) return;
  const jsFiles = w.allFilePaths.filter(p=>/\.[jt]sx?$/.test(p));
  let fixed = 0;
  jsFiles.forEach(p => {
    const c = getFileContent(p); if (!c) return;
    // const x = require('y')  →  import x from 'y'
    const updated = c.replace(/(?:const|let|var)\s+(\{[^}]+\}|[a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*require\s*\(\s*(['"`][^'"`]+['"`])\s*\)\s*;?/g, (match, name, mod) => {
      const isDestructured = name.trim().startsWith('{');
      return isDestructured ? `import ${name} from ${mod};` : `import ${name} from ${mod};`;
    });
    if (updated !== c) { fixed++; if (w.fileContents) w.fileContents[p] = updated; if (w.editorModels&&w.editorModels[p]) { const m=w.editorModels[p]; if(typeof m.setValue==='function') m.setValue(updated); } }
  });
  if (activeTab && jsFiles.includes(activeTab) && editor) { const m=editorModels[activeTab]; if(m) editor.setModel(m); }
  toast(`✓ Converted require() to import in ${fixed} file${fixed!==1?'s':''}`);
}

// ══════════════════════════════════════════════
//  HTML → NEXT.JS API ROUTE BUILDER
// ══════════════════════════════════════════════

function openApiRouteBuilder() {
  document.getElementById('apiRouteOverlay').classList.add('open');
  _renderApiRoutePanel();
}

function closeApiRouteBuilder() {
  document.getElementById('apiRouteOverlay').classList.remove('open');
}

function _renderApiRoutePanel() {
  const body = document.getElementById('apiRouteBody');
  const w = ws();
  const htmlFiles = w ? w.allFilePaths.filter(p => /\.html?$/.test(p)) : [];
  const activeHtml = (activeTab && activeTab.match(/\.html?$/)) ? activeTab : null;

  body.innerHTML = `
    <div style="padding:6px 0 18px;color:var(--tx2);font-size:12px;line-height:1.7">
      Wraps your HTML converter logic into a proper <b style="color:var(--tx)">Next.js API Route</b> structure.<br>
      Generates <b style="color:var(--gold)">two zips</b> — one for your machine, one safe to push to GitHub.
    </div>

    <div style="margin-bottom:14px">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--tx3);margin-bottom:6px">Project Name</div>
      <input id="arProjectName" class="scan-input" placeholder="my-converter-api" value="my-converter-api" style="width:100%">
    </div>

    <div style="margin-bottom:14px">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--tx3);margin-bottom:6px">HTML Source</div>
      <select id="arHtmlSource" style="width:100%;background:var(--bg3);border:1px solid var(--border2);color:var(--tx);font-size:11px;font-family:var(--mono);padding:6px 8px;border-radius:5px;outline:none">
        <option value="__active__">${activeHtml ? '📄 Active file: ' + activeHtml.split('/').pop() : '(no HTML file open)'}</option>
        ${htmlFiles.filter(p=>p!==activeHtml).map(p=>`<option value="${p}">📄 ${p.split('/').pop()}</option>`).join('')}
        <option value="__paste__">✏️ Paste HTML manually</option>
      </select>
    </div>

    <div id="arPasteArea" style="display:none;margin-bottom:14px">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--tx3);margin-bottom:6px">Paste HTML</div>
      <textarea id="arPasteHtml" style="width:100%;height:120px;background:var(--bg3);border:1px solid var(--border2);color:var(--tx);font-size:11px;font-family:var(--mono);padding:8px;border-radius:5px;outline:none;resize:vertical" placeholder="Paste your HTML here…"></textarea>
    </div>

    <div style="margin-bottom:20px">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--tx3);margin-bottom:8px">What each zip contains</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:10px;font-family:var(--mono)">
        <div style="background:var(--bg3);border:1px solid var(--border);border-top:2px solid var(--gold);border-radius:5px;padding:10px">
          <div style="color:var(--gold);font-weight:700;margin-bottom:6px">📦 LOCAL zip</div>
          <div style="color:var(--tx3);line-height:1.8">app/api/convert/route.ts<br>app/api/keys/route.ts<br>app/api/webhook/route.ts<br>app/page.tsx<br><span style="color:var(--green)">lib/converter.ts ✓</span><br>lib/validate-key.ts<br>lib/validate-token.ts<br>lib/usage.ts<br>.env.template<br>.gitignore<br>package.json · vercel.json</div>
        </div>
        <div style="background:var(--bg3);border:1px solid var(--border);border-top:2px solid var(--blue);border-radius:5px;padding:10px">
          <div style="color:#60a5fa;font-weight:700;margin-bottom:6px">📦 GITHUB zip</div>
          <div style="color:var(--tx3);line-height:1.8">app/api/convert/route.ts ← shell<br>app/api/keys/route.ts ← shell<br>app/api/webhook/route.ts ← shell<br>app/page.tsx<br><span style="color:var(--red)">lib/converter.ts ✗ removed</span><br>lib/validate-key.ts<br>lib/validate-token.ts<br>lib/usage.ts<br><span style="color:var(--red)">.env ✗ removed</span><br>.gitignore<br>package.json · vercel.json</div>
        </div>
      </div>
    </div>

    <div id="arStatus" style="display:none;margin-bottom:12px;padding:10px 12px;border-radius:5px;font-size:11px;background:var(--bg3);border:1px solid var(--border);color:var(--tx2)"></div>
    <div id="arDownloads" style="display:none;gap:8px;margin-bottom:12px"></div>

    <button class="nxc-btn" id="arGenerateBtn" onclick="_runApiRouteBuilder()" style="width:100%;padding:10px;font-size:12px">⚡ Generate Both Zips</button>
  `;

  document.getElementById('arHtmlSource').addEventListener('change', function() {
    document.getElementById('arPasteArea').style.display = this.value === '__paste__' ? 'block' : 'none';
  });
}

async function _runApiRouteBuilder() {
  const btn = document.getElementById('arGenerateBtn');
  const status = document.getElementById('arStatus');
  const downloads = document.getElementById('arDownloads');

  btn.disabled = true;
  btn.textContent = '⏳ Building zips…';
  status.style.display = 'block';
  status.style.borderColor = 'var(--border)';
  status.style.color = 'var(--tx2)';
  status.textContent = 'Reading HTML source…';

  const projectName = (document.getElementById('arProjectName').value.trim() || 'my-converter-api').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const sourceVal = document.getElementById('arHtmlSource').value;
  const w = ws();

  let htmlContent = '';
  if (sourceVal === '__paste__') {
    htmlContent = document.getElementById('arPasteHtml').value.trim();
  } else if (sourceVal === '__active__') {
    htmlContent = getActiveContent() || '';
  } else {
    htmlContent = (w && getFileContent(sourceVal)) || '';
  }

  if (!htmlContent) {
    status.style.color = 'var(--red)';
    status.textContent = '✗ No HTML found. Open an HTML file or paste one.';
    btn.disabled = false;
    btn.textContent = '⚡ Generate Both Zips';
    return;
  }

  status.textContent = 'Building file structure…';

  try {
    const files = _buildApiRouteFiles(projectName, htmlContent);
    status.textContent = 'Creating LOCAL zip…';
    const localZip = await _buildLocalZip(projectName, files);
    status.textContent = 'Creating GITHUB zip…';
    const githubZip = await _buildGithubZip(projectName, files);

    status.style.borderColor = 'rgba(74,222,128,.3)';
    status.style.color = 'var(--green)';
    status.textContent = '✓ Both zips ready — download below';

    downloads.style.display = 'flex';
    downloads.innerHTML = `
      <button class="nxc-btn" onclick="_downloadBlob(window._arLocalBlob, '${projectName}-LOCAL.zip')" style="flex:1;background:rgba(212,168,83,.1);border-color:var(--goldb);color:var(--gold);padding:10px 0;font-size:12px">
        📦 Download LOCAL zip<br><span style="font-size:9px;opacity:.7;font-weight:400">install on your machine</span>
      </button>
      <button class="nxc-btn" onclick="_downloadBlob(window._arGithubBlob, '${projectName}-GITHUB.zip')" style="flex:1;background:rgba(96,165,250,.1);border-color:rgba(96,165,250,.3);color:#60a5fa;padding:10px 0;font-size:12px">
        📦 Download GITHUB zip<br><span style="font-size:9px;opacity:.7;font-weight:400">safe to push to GitHub</span>
      </button>
    `;

    window._arLocalBlob = localZip;
    window._arGithubBlob = githubZip;

  } catch(e) {
    status.style.color = 'var(--red)';
    status.textContent = '✗ Error: ' + e.message;
  }

  btn.disabled = false;
  btn.textContent = '↺ Regenerate';
}

function _downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function _buildApiRouteFiles(projectName, htmlContent) {
  // Escape for embedding in template literals
  const escaped = htmlContent.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');

  const converterTs = `// lib/converter.ts
// Core HTML → Next.js conversion logic
// ⚠️  DO NOT commit this file — it is in .gitignore

export interface ConvertResult {
  tsx: string;
  css: string;
  route: string;
  title: string;
}

export function convertHtml(html: string, route: string = '/', siteName: string = '${projectName}'): ConvertResult {
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : siteName;

  // Extract CSS
  const cssBlocks: string[] = [];
  html.replace(/<style[^>]*>([\\s\\S]*?)<\\/style>/gi, (_: string, css: string) => {
    cssBlocks.push(css.trim());
    return '';
  });
  const css = cssBlocks.join('\\n\\n');

  // Strip script/style tags for TSX body
  let body = html
    .replace(/<script[\\s\\S]*?<\\/script>/gi, '')
    .replace(/<style[\\s\\S]*?<\\/style>/gi, '')
    .replace(/<!(DOCTYPE|doctype)[^>]*>/g, '')
    .replace(/<html[^>]*>|<\\/html>/gi, '')
    .replace(/<head[\\s\\S]*?<\\/head>/gi, '')
    .replace(/<body[^>]*>|<\\/body>/gi, '')
    .replace(/class=/g, 'className=')
    .trim();

  const tsx = \`import type { Metadata } from 'next'
import styles from './page.module.css'

export const metadata: Metadata = {
  title: '${title}',
}

export default function Page() {
  return (
    <main className={styles.main}>
      \${body}
    </main>
  )
}
\`;

  return { tsx, css, route, title };
}
`;

  const routeFullTs = `// app/api/convert/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { convertHtml } from '../../../lib/converter'
import { validateKey } from '../../../lib/validate-key'
import { trackUsage } from '../../../lib/usage'

export async function POST(req: NextRequest) {
  const { html, route = '/', siteName = '${projectName}', apiKey } = await req.json()

  if (!html) {
    return NextResponse.json({ error: 'html is required' }, { status: 400 })
  }

  const keyValid = await validateKey(apiKey || req.headers.get('x-api-key') || '')
  if (!keyValid) {
    return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 })
  }

  try {
    const result = convertHtml(html, route, siteName)
    await trackUsage(apiKey || '')
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Conversion failed' }, { status: 500 })
  }
}
`;

  const routeShellTs = `// app/api/convert/route.ts
// Shell only — connect lib/converter.ts before deploying
// See LOCAL zip for the full converter logic
import { NextRequest, NextResponse } from 'next/server'
import { validateKey } from '../../../lib/validate-key'
import { trackUsage } from '../../../lib/usage'

export async function POST(req: NextRequest) {
  const { html, route = '/', siteName = '${projectName}', apiKey } = await req.json()

  if (!html) {
    return NextResponse.json({ error: 'html is required' }, { status: 400 })
  }

  const keyValid = await validateKey(apiKey || req.headers.get('x-api-key') || '')
  if (!keyValid) {
    return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 })
  }

  // TODO: import { convertHtml } from '../../../lib/converter'
  // Add converter.ts from your LOCAL zip, then uncomment above and below
  // const result = convertHtml(html, route, siteName)
  // await trackUsage(apiKey || '')
  // return NextResponse.json(result)

  return NextResponse.json({ error: 'converter.ts not connected' }, { status: 501 })
}
`;

  const validateKeyTs = `// lib/validate-key.ts
import { readFile } from 'fs/promises'
import path from 'path'

// Simple file-based key store — replace with DB in production
export async function validateKey(key: string): Promise<boolean> {
  if (!key || key.length < 8) return false
  try {
    const keyFile = path.join(process.cwd(), '.keys')
    const content = await readFile(keyFile, 'utf-8')
    const validKeys = content.split('\\n').map(k => k.trim()).filter(Boolean)
    return validKeys.includes(key)
  } catch {
    // Fall back to env var key if .keys file not found
    const envKey = process.env.API_MASTER_KEY
    return !!envKey && key === envKey
  }
}
`;

  const usageTs = `// lib/usage.ts
// Minimal usage tracker — extend with your DB of choice
const _usage: Record<string, number> = {}

export async function trackUsage(key: string): Promise<void> {
  if (!key) return
  _usage[key] = (_usage[key] || 0) + 1
  // TODO: persist to database
  console.log('[usage]', key.slice(0, 8) + '…', _usage[key], 'calls')
}

export async function getUsage(key: string): Promise<number> {
  return _usage[key] || 0
}
`;

  const validateTokenTs = `// lib/validate-token.ts
// Credits / token balance check for usage-gated endpoints

export interface TokenBalance {
  key: string
  credits: number
  used: number
  remaining: number
}

// In-memory store — replace with DB in production
const _balances: Record<string, TokenBalance> = {}

export async function validateToken(apiKey: string, cost: number = 1): Promise<boolean> {
  if (!apiKey) return false
  const bal = await getBalance(apiKey)
  return bal.remaining >= cost
}

export async function deductToken(apiKey: string, cost: number = 1): Promise<void> {
  if (!_balances[apiKey]) {
    _balances[apiKey] = { key: apiKey, credits: 100, used: 0, remaining: 100 }
  }
  _balances[apiKey].used += cost
  _balances[apiKey].remaining = Math.max(0, _balances[apiKey].credits - _balances[apiKey].used)
}

export async function getBalance(apiKey: string): Promise<TokenBalance> {
  if (!_balances[apiKey]) {
    _balances[apiKey] = { key: apiKey, credits: 100, used: 0, remaining: 100 }
  }
  return _balances[apiKey]
}

export async function topUpCredits(apiKey: string, amount: number): Promise<void> {
  if (!_balances[apiKey]) {
    _balances[apiKey] = { key: apiKey, credits: 0, used: 0, remaining: 0 }
  }
  _balances[apiKey].credits += amount
  _balances[apiKey].remaining += amount
}
`;

  const keysRouteTs = `// app/api/keys/route.ts
// Generate API keys — protect with master key in production
import { NextRequest, NextResponse } from 'next/server'
import { appendFile } from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { topUpCredits } from '../../../lib/validate-token'

export async function POST(req: NextRequest) {
  const masterKey = req.headers.get('x-master-key')
  if (masterKey !== process.env.API_MASTER_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { credits = 100 } = await req.json().catch(() => ({}))
  const newKey = 'key_' + crypto.randomBytes(16).toString('hex')
  const keyFile = path.join(process.cwd(), '.keys')
  await appendFile(keyFile, newKey + '\\n')
  await topUpCredits(newKey, credits)
  return NextResponse.json({ key: newKey, credits })
}
`;

  const keysRouteShellTs = `// app/api/keys/route.ts — shell only
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  // TODO: connect lib/validate-token.ts before deploying
  return NextResponse.json({ error: 'not implemented' }, { status: 501 })
}
`;

  const webhookRouteTs = `// app/api/webhook/route.ts
// Stripe webhook — tops up credits on successful payment
import { NextRequest, NextResponse } from 'next/server'
import { topUpCredits } from '../../../lib/validate-token'

export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature') || ''
  const rawBody = await req.text()

  // Verify Stripe signature
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  let event: any
  try {
    // In production: const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
    // event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
    event = JSON.parse(rawBody) // dev only — remove in production
  } catch (err: any) {
    return NextResponse.json({ error: 'Invalid signature: ' + err.message }, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    const apiKey = session.metadata?.api_key
    const credits = parseInt(session.metadata?.credits || '100', 10)
    if (apiKey) {
      await topUpCredits(apiKey, credits)
      console.log('[webhook] topped up', apiKey.slice(0, 10), '+', credits, 'credits')
    }
  }

  return NextResponse.json({ received: true })
}
`;

  const webhookRouteShellTs = `// app/api/webhook/route.ts — shell only
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  // TODO: connect lib/validate-token.ts + Stripe SDK before deploying
  return NextResponse.json({ received: true })
}
`;

  const pageTsx = `// app/page.tsx
export default function Home() {
  return (
    <main style={{ fontFamily: 'monospace', padding: '2rem', maxWidth: '640px', margin: '0 auto' }}>
      <h1>${projectName}</h1>
      <p>API is running. POST to <code>/api/convert</code> with your HTML.</p>
      <pre style={{ background: '#111', padding: '1rem', borderRadius: '8px', color: '#4ade80', fontSize: '12px' }}>
{JSON.stringify({
  endpoint: '/api/convert',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': 'key_...' },
  body: { html: '<html>...</html>', route: '/', siteName: 'my-site' }
}, null, 2)}
      </pre>
    </main>
  )
}
`;

  const packageJson = JSON.stringify({
    name: projectName,
    version: '0.1.0',
    private: true,
    scripts: {
      dev: 'next dev',
      build: 'next build',
      start: 'next start'
    },
    dependencies: {
      next: '^14.0.0',
      react: '^18.0.0',
      'react-dom': '^18.0.0'
    },
    devDependencies: {
      typescript: '^5.0.0',
      '@types/node': '^20.0.0',
      '@types/react': '^18.0.0'
    }
  }, null, 2);

  const vercelJson = JSON.stringify({
    framework: 'nextjs',
    buildCommand: 'next build',
    devCommand: 'next dev',
    installCommand: 'npm install'
  }, null, 2);

  const gitignore = `node_modules/
.next/
.env
.env.local
.keys
lib/converter.ts
`;

  const envTemplate = `# Rename this file to .env and fill in your values

# Master key for generating new API keys (keep secret)
API_MASTER_KEY=replace_with_a_strong_random_string

# Optional: set a base URL for your deployment
NEXT_PUBLIC_BASE_URL=http://localhost:3000
`;

  const tsconfigJson = JSON.stringify({
    compilerOptions: {
      target: 'es2017',
      lib: ['dom', 'dom.iterable', 'esnext'],
      allowJs: true,
      skipLibCheck: true,
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      module: 'esnext',
      moduleResolution: 'bundler',
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: 'preserve',
      incremental: true,
      plugins: [{ name: 'next' }],
      paths: { '@/*': ['./*'] }
    },
    include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
    exclude: ['node_modules']
  }, null, 2);

  const readme = `# ${projectName}

Next.js API for HTML conversion.

## Setup (LOCAL zip)

\`\`\`bash
npm install
cp .env.template .env
# Edit .env with your values
npm run dev
\`\`\`

## API

POST \`/api/convert\`

\`\`\`json
{
  "html": "<html>...</html>",
  "route": "/",
  "siteName": "my-site",
  "apiKey": "key_..."
}
\`\`\`

## Generate an API key

\`\`\`bash
curl -X POST http://localhost:3000/api/keys \\
  -H "x-master-key: YOUR_API_MASTER_KEY"
\`\`\`

## Deploy

\`\`\`bash
vercel deploy
\`\`\`
`;

  return {
    converterTs,
    routeFullTs,
    routeShellTs,
    validateKeyTs,
    validateTokenTs,
    usageTs,
    keysRouteTs,
    keysRouteShellTs,
    webhookRouteTs,
    webhookRouteShellTs,
    pageTsx,
    packageJson,
    vercelJson,
    gitignore,
    envTemplate,
    tsconfigJson,
    readme,
    projectName
  };
}

async function _buildLocalZip(projectName, files) {
  const zip = new JSZip();
  const root = zip.folder(projectName);
  const app = root.folder('app');
  const api = app.folder('api');
  const lib = root.folder('lib');

  api.folder('convert').file('route.ts', files.routeFullTs);
  api.folder('keys').file('route.ts', files.keysRouteTs);
  api.folder('webhook').file('route.ts', files.webhookRouteTs);
  app.file('page.tsx', files.pageTsx);
  lib.file('converter.ts', files.converterTs);
  lib.file('validate-key.ts', files.validateKeyTs);
  lib.file('validate-token.ts', files.validateTokenTs);
  lib.file('usage.ts', files.usageTs);
  root.file('package.json', files.packageJson);
  root.file('vercel.json', files.vercelJson);
  root.file('.gitignore', files.gitignore);
  root.file('.env.template', files.envTemplate);
  root.file('tsconfig.json', files.tsconfigJson);
  root.file('README.md', files.readme);

  return await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

async function _buildGithubZip(projectName, files) {
  const zip = new JSZip();
  const root = zip.folder(projectName);
  const app = root.folder('app');
  const api = app.folder('api');
  const lib = root.folder('lib');

  api.folder('convert').file('route.ts', files.routeShellTs);
  api.folder('keys').file('route.ts', files.keysRouteShellTs);
  api.folder('webhook').file('route.ts', files.webhookRouteShellTs);
  app.file('page.tsx', files.pageTsx);
  // NO converter.ts — stays on your machine only
  lib.file('validate-key.ts', files.validateKeyTs);
  lib.file('validate-token.ts', files.validateTokenTs);
  lib.file('usage.ts', files.usageTs);
  root.file('package.json', files.packageJson);
  root.file('vercel.json', files.vercelJson);
  root.file('.gitignore', files.gitignore);
  root.file('tsconfig.json', files.tsconfigJson);
  root.file('README.md', files.readme);
  // NO .env — never goes to GitHub

  return await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
let _wsMode = 'general';          // 'general' | 'workspace'
let _wsHistory = [];               // conversation history
let _wsTyping = false;
let _wsContextFiles = [];          // files currently in context

// ── PER-WORKSPACE CHAT STORAGE ──
const _wsChatStore = {}; // wsId → { history, contextFiles, undoStack, mode }

function _wsSaveChat(wsId) {
  if (!wsId) return;
  _wsChatStore[wsId] = {
    history:      [..._wsHistory],
    contextFiles: [..._wsContextFiles],
    undoStack:    [..._wsUndoStack],
    mode:         _wsMode,
  };
}

function _wsLoadChat(wsId) {
  const saved = _wsChatStore[wsId];
  if (saved) {
    _wsHistory      = [...saved.history];
    _wsContextFiles = [...saved.contextFiles];
    _wsUndoStack.length = 0;
    saved.undoStack.forEach(s => _wsUndoStack.push(s));
    _wsMode = saved.mode || 'general';
  } else {
    // Fresh workspace — reset everything
    _wsHistory      = [];
    _wsContextFiles = [];
    _wsUndoStack.length = 0;
    _wsMode = 'general';
  }
}

function _wsOnWorkspaceSwitch(oldId, newId) {
  // Save old workspace chat
  _wsSaveChat(oldId);

  // Load new workspace chat
  _wsLoadChat(newId);

  // Update UI
  _wsRefreshChatUI();
  _wsRenderCtxFiles();
  _wsUpdateFooter();

  // Update mode buttons
  document.getElementById('wsModeGeneral')?.classList.toggle('active', _wsMode === 'general');
  document.getElementById('wsModeWs')?.classList.toggle('active', _wsMode === 'workspace');
  document.getElementById('vexWsCtx')?.classList.toggle('show', _wsMode === 'workspace');

  // Hide undo bar on switch
  document.getElementById('vexWsUndoBar')?.classList.remove('show');
}

function _wsRefreshChatUI() {
  const body = document.getElementById('vexWsBody');
  if (!body) return;
  body.innerHTML = '';

  if (_wsHistory.length === 0) {
    // Show fresh welcome for this workspace
    _wsWelcome();
    return;
  }

  // Replay saved history into UI
  _wsHistory.forEach(msg => {
    if (msg.role === 'user') {
      _wsAddMsg(msg.content, 'user');
    } else {
      // Render assistant messages — check for file edits
      const hasEdits = /<file\s+path=/.test(msg.content);
      if (hasEdits) {
        _wsRenderReply(msg.content);
      } else {
        _wsAddMsg(msg.content, 'bot');
      }
    }
  });

  body.scrollTop = body.scrollHeight;
}

function openWsChat() {
  // Close small VEX chat if open
  if (vexChatOpen) vexToggleChat();

  // Reset scratch mode if coming from scratch
  if (window._scratchModeActive) {
    window._scratchModeActive = false;
    const hdr = document.querySelector('.vex-ws-hdr h2');
    if (hdr) hdr.textContent = '⚡ Workspace Assistant';
    const modeBtns = document.querySelector('.vex-ws-mode-btns');
    if (modeBtns) modeBtns.style.display = '';
  }

  document.getElementById('vexWsOverlay').classList.add('open');
  _wsRestoreKey();

  // Always rebuild context so active file is picked up
  if (_wsMode === 'workspace') {
    _wsBuildContext();
    document.getElementById('vexWsCtx')?.classList.add('show');
  }

  _wsUpdateFooter();
  if (_wsHistory.length === 0) _wsWelcome();
  setTimeout(() => document.getElementById('vexWsInput').focus(), 100);
}

function closeWsChat() {
  document.getElementById('vexWsOverlay').classList.remove('open');
  if (window._scratchModeActive) {
    window._scratchModeActive = false;
    const hdr = document.querySelector('.vex-ws-hdr h2');
    if (hdr) hdr.textContent = '⚡ Workspace Assistant';
    const modeBtns = document.querySelector('.vex-ws-mode-btns');
    if (modeBtns) modeBtns.style.display = '';
  }
}

// ── SCRATCH BUTTON — show only for new empty .html files ──
function _updateScratchBtn() {
  const btn = document.getElementById('vexScratchBtn');
  if (!btn) return;

  const path = activeTab || '';
  const isHtml = path.endsWith('.html') || path.endsWith('.htm');
  if (!isHtml) { btn.style.display = 'none'; return; }

  // Check if file is empty or near-empty (new/untouched)
  const content = (getActiveContent() || '').trim();
  const isEmpty = content.length < 50; // less than 50 chars = basically empty

  // Check not a repo
  const w = ws();
  const isRepo = w && w.allFilePaths && w.allFilePaths.length > 3;

  if (isEmpty && !isRepo) {
    btn.style.display = 'inline-block';
  } else {
    btn.style.display = 'none';
  }
}

// ── OPEN SCRATCH CHAT ──
let _scratchHistory = [];
let _scratchTyping = false;
let _scratchFile = null;

function openScratchChat() {
  // Close small VEX chat if open
  if (vexChatOpen) vexToggleChat();

  _scratchFile = activeTab;
  // Open workspace overlay in scratch mode
  document.getElementById('vexWsOverlay').classList.add('open');
  _wsRestoreKey();

  // Switch to scratch mode UI
  _wsSwitchToScratch();
  setTimeout(() => document.getElementById('vexWsInput').focus(), 100);
}

function _wsSwitchToScratch() {
  // Update header
  const hdr = document.querySelector('.vex-ws-hdr h2');
  if (hdr) hdr.textContent = '✦ Build from Scratch';

  // Hide mode buttons — not relevant for scratch
  document.querySelector('.vex-ws-mode-btns')?.style && (document.querySelector('.vex-ws-mode-btns').style.display = 'none');
  document.getElementById('vexWsCtx')?.classList.remove('show');

  // Update placeholder
  const inp = document.getElementById('vexWsInput');
  if (inp) inp.placeholder = 'Describe your app... e.g. "build me a tip calculator with dark theme"';

  // Show welcome
  const body = document.getElementById('vexWsBody');
  if (body && body.children.length === 0) {
    const el = document.createElement('div');
    el.className = 'vex-ws-msg bot';
    const fname = _scratchFile?.split('/').pop() || 'your file';
    el.innerHTML = `
      <div style="font-weight:700;color:var(--gold);margin-bottom:6px">✦ Build from Scratch</div>
      <div style="font-size:11px;color:#aab;line-height:1.6">
        I'll write <b>${fname}</b> fresh from your description.<br><br>
        Try something like:<br>
        <span style="color:var(--gold)">• "build me a tip calculator"</span><br>
        <span style="color:var(--gold)">• "create a countdown timer with dark theme"</span><br>
        <span style="color:var(--gold)">• "make a todo list app"</span><br><br>
        Keep it simple — you can refine with Workspace mode after.
      </div>`;
    body.appendChild(el);
  }

  // Override send to use scratch mode
  window._scratchModeActive = true;
}

// Hook into wsSend to detect scratch mode — handled at top of wsSend directly

async function _wsScratchSend() {
  if (_scratchTyping) return;
  const inp = document.getElementById('vexWsInput');
  const msg = inp.value.trim();
  if (!msg) return;

  const key = vexGetKey();
  if (!key) { _wsAddMsg('⚙ Add your API key below.', 'bot'); return; }

  inp.value = '';
  inp.style.height = 'auto';
  _wsAddMsg(msg, 'user');

  _scratchTyping = true;
  const typingEl = _wsAddTyping();

  const fname = _scratchFile?.split('/').pop() || 'app.html';
  const ext = fname.split('.').pop() || 'html';

  const systemPrompt = `You are VEX — an expert frontend developer. 
The user wants to build a brand new ${ext} file called "${fname}" from scratch.

Write a complete, self-contained, working ${ext} file. 
- For HTML: include all CSS and JS inline in one file
- Use a dark, modern design by default unless asked otherwise
- Make it actually functional — not a mockup
- No placeholder content — real working code only
- Keep it under 300 lines for best results

Wrap your output ONLY in:
<file path="${_scratchFile || fname}">
...complete file content...
</file>

After the file block, write ONE short sentence describing what you built.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 6000,
        system: systemPrompt,
        messages: [{ role: 'user', content: msg }],
      }),
    });

    const data = await response.json();
    typingEl.remove();

    if (data.error) {
      _wsAddMsg(`❌ ${data.error.message}`, 'bot');
    } else {
      const reply = data.content?.[0]?.text || '';

      // Force the file path to match the actual open file
      // Claude might use a different path name — override it
      const fixedReply = reply.replace(
        /<file\s+path=["'][^"']*["']/,
        `<file path="${_scratchFile}"`
      );

      // Pre-register file in workspace so wsApplyEdit can find it
      const w = ws();
      if (w && _scratchFile) {
        if (!w.fileContents[_scratchFile]) w.fileContents[_scratchFile] = '';
        if (!w.allFilePaths.includes(_scratchFile)) w.allFilePaths.push(_scratchFile);
      }

      // Extract file content and auto-apply — no need to confirm on a fresh empty file
      const fileMatch = fixedReply.match(/<file\s+path=["'][^"']*["']>([\s\S]*?)<\/file>/);
      if (fileMatch) {
        const newContent = fileMatch[1].trim();
        const tempCardId = `scratch_${Date.now()}`;
        wsApplyEdit(tempCardId, _scratchFile, newContent, '');

        // Show success message with description
        const desc = fixedReply.replace(/<file[\s\S]*?<\/file>/g, '').trim();
        if (desc) _wsAddMsg(`✅ Built and applied!\n\n${desc}`, 'bot');
        else _wsAddMsg(`✅ Built and applied to **${_scratchFile.split('/').pop()}**`, 'bot');
      } else {
        // Claude didn't wrap in file tags — show raw reply
        _wsAddMsg(fixedReply, 'bot');
        _wsAddMsg(`⚠ Couldn't auto-apply. Ask again or copy the code manually.`, 'bot');
      }

      vexCelebrate();

      // Auto switch to workspace mode now file has content
      window._scratchModeActive = false;
      const hdr = document.querySelector('.vex-ws-hdr h2');
      if (hdr) hdr.textContent = '⚡ Workspace Assistant';
      const modeBtns = document.querySelector('.vex-ws-mode-btns');
      if (modeBtns) modeBtns.style.display = '';

      // Set workspace mode + rebuild context with new file
      _wsMode = 'workspace';
      document.getElementById('wsModeGeneral')?.classList.remove('active');
      document.getElementById('wsModeWs')?.classList.add('active');
      document.getElementById('vexWsCtx')?.classList.add('show');
      _wsBuildContext();
      _wsUpdateFooter();

      const body = document.getElementById('vexWsBody');
      const tip = document.createElement('div');
      tip.style.cssText = 'font-size:10px;color:#60a5fa;padding:8px 0;text-align:center;border-top:1px solid #1e3044;margin-top:6px';
      tip.textContent = '✓ Switched to Workspace mode — ask VEX to refine your app';
      body.appendChild(tip);
      body.scrollTop = body.scrollHeight;
    }
  } catch(err) {
    typingEl.remove();
    _wsAddMsg(`❌ ${err.message}`, 'bot');
  } finally {
    _scratchTyping = false;
  }
}

function setWsMode(mode) {
  _wsMode = mode;
  document.getElementById('wsModeGeneral').classList.toggle('active', mode === 'general');
  document.getElementById('wsModeWs').classList.toggle('active', mode === 'workspace');
  const ctx = document.getElementById('vexWsCtx');

  if (mode === 'workspace') {
    ctx.classList.add('show');
    _wsBuildContext();
    document.getElementById('vexWsInput').placeholder = 'Tell VEX what to build or fix... Claude reads your files.';
  } else {
    ctx.classList.remove('show');
    document.getElementById('vexWsInput').placeholder = 'Ask VEX anything about code...';
  }
  _wsUpdateFooter();
}

function _wsWelcome() {
  const w = ws();
  const hasWs = w && w.allFilePaths.length > 0;
  _wsAddMsg(`👋 Hey! I'm VEX — your workspace-aware AI assistant.

**Two modes:**
• 💬 **General** — ask me anything about code, frameworks, concepts
• ⚡ **Workspace** — I read your actual files and make direct edits

${hasWs
  ? `📂 I can see **${w.allFilePaths.length} files** in *${w.name}*. Switch to Workspace mode and tell me what to build.`
  : `No workspace open yet. Open a folder first, then switch to Workspace mode.`
}`, 'bot');
}

// ── CONTEXT BUILDER ──
function _wsBuildContext() {
  const w = ws();
  if (!w || !w.allFilePaths.length) {
    _wsContextFiles = [];
    _wsRenderCtxFiles();
    return;
  }

  const selected = new Set();

  // Active tab — only skip truly unreadable files (binary, compiled, lockfiles)
  if (activeTab) {
    const content = getFileContent(activeTab) || w.fileContents[activeTab] || '';
    const check = _fgCheck(activeTab, content);
    const blocked = !check.ok && check.type !== 'large' && check.type !== 'toolarge';
    if (!blocked) selected.add(activeTab);
  }

  // package.json always safe
  const pkgPath = w.allFilePaths.find(p => p.endsWith('package.json'));
  if (pkgPath) selected.add(pkgPath);

  _wsContextFiles = [...selected];
  _wsRenderCtxFiles();
  _wsUpdateFooter();
}

function _wsSmartSelect(userMsg) {
  // Add files relevant to user's message keywords
  const w = ws(); if (!w) return;
  const keywords = userMsg.toLowerCase().split(/\s+/).filter(k => k.length > 3);

  const SKIP = /\.(lock|png|jpg|jpeg|gif|svg|ico|woff|ttf|eot|map)$|node_modules|dist\/|\.git/;
  const candidates = w.allFilePaths.filter(p => !SKIP.test(p));

  candidates.forEach(path => {
    if (_wsContextFiles.includes(path)) return;
    if (_wsContextFiles.length >= 8) return;
    const name = path.toLowerCase();
    if (keywords.some(k => name.includes(k))) {
      _wsContextFiles.push(path);
    }
  });

  _wsRenderCtxFiles();
  _wsUpdateFooter();
}

function _wsRenderCtxFiles() {
  const container = document.getElementById('vexWsCtxFiles');
  const count = document.getElementById('vexWsCtxCount');
  if (!container) return;

  count.textContent = `(${_wsContextFiles.length} file${_wsContextFiles.length !== 1 ? 's' : ''})`;
  container.innerHTML = '';

  _wsContextFiles.forEach((path, i) => {
    const tag = document.createElement('div');
    tag.className = 'vex-ws-ctx-file remove';
    tag.textContent = path.split('/').pop();
    tag.title = path;
    tag.onclick = () => {
      _wsContextFiles.splice(i, 1);
      _wsRenderCtxFiles();
      _wsUpdateFooter();
    };
    container.appendChild(tag);
  });

  // Add file button
  const w = ws();
  if (w && _wsContextFiles.length < 8) {
    const add = document.createElement('div');
    add.className = 'vex-ws-ctx-file';
    add.textContent = '+ Add file';
    add.style.borderStyle = 'dashed';
    add.onclick = _wsAddFileToCtx;
    container.appendChild(add);
  }
}

// ══════════════════════════════
//  FILE GUARD — size + type checks
//  Used by both VEX chat and Workspace Assistant
// ══════════════════════════════
const FG_MAX_LINES      = 500;   // warn above this
const FG_HARD_LINES     = 2000;  // block above this in workspace
const FG_HARD_CHARS     = 80000; // ~20k tokens — hard block

const FG_COMPILED = /\.(min\.js|min\.css|bundle\.js|chunk\.js|map)$|vendor\.|\.bundle\./i;
const FG_GENERATED = /package-lock\.json$|yarn\.lock$|pnpm-lock\.yaml$|composer\.lock$/i;
const FG_BINARY = /\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|mp4|mp3|zip|gz|tar|pdf|exe|dll)$/i;
const FG_SKIP = /node_modules|dist\/|build\/|\.git\/|\.next\/|out\//;

function _fgCheck(path, content) {
  // Returns { ok: bool, type: string, message: string, suggestion: string }
  const name = path?.split('/').pop() || path || '';
  const lines = content ? content.split('\n').length : 0;
  const chars = content?.length || 0;

  // Binary files
  if (FG_BINARY.test(name)) return {
    ok: false, type: 'binary',
    message: `⛔ "${name}" is a binary file — VEX can't read images, fonts or media.`,
    suggestion: 'Open a code file instead (HTML, JS, CSS, JSON...).'
  };

  // Generated lock files
  if (FG_GENERATED.test(name)) return {
    ok: false, type: 'lockfile',
    message: `⛔ "${name}" is auto-generated by npm/yarn. VEX won't edit this.`,
    suggestion: 'If you have a dependency issue, tell VEX what package you need and it\'ll update package.json instead.'
  };

  // Compiled/minified files
  if (FG_COMPILED.test(name)) return {
    ok: false, type: 'compiled',
    message: `⛔ "${name}" looks like a compiled or minified file. Editing this won't stick — it gets overwritten on next build.`,
    suggestion: 'Find the original source file and open that instead.'
  };

  // node_modules / dist / build
  if (FG_SKIP.test(path)) return {
    ok: false, type: 'generated',
    message: `⛔ "${name}" is inside a generated folder (${path.split('/')[0]}). VEX skips these automatically.`,
    suggestion: 'Open the source file from your src/ folder instead.'
  };

  // Hard size block
  if (chars > FG_HARD_CHARS || lines > FG_HARD_LINES) return {
    ok: false, type: 'toolarge',
    message: `⚠ "${name}" is very large (${lines.toLocaleString()} lines). VEX can\'t analyze the whole file at once.`,
    suggestion: `Try asking something specific like:\n• "fix the login button"\n• "change the header color"\n• "find the form submit handler"\nVEX will find the exact section automatically.`
  };

  // Warn — large but workable
  if (lines > FG_MAX_LINES) return {
    ok: true, type: 'large',
    message: `⚠ "${name}" is large (${lines.toLocaleString()} lines). VEX will use targeted search — be specific about what you want to change.`,
    suggestion: null
  };

  return { ok: true, type: 'ok', message: null, suggestion: null };
}

// ── Show guard warning in VEX chat (passive) ──
function _fgWarnVex(path, content) {
  const check = _fgCheck(path, content);
  // Only warn for binary, compiled, lockfiles — NOT for large files
  if (check.ok || check.type === 'large' || check.type === 'toolarge') return;
  if (!vexChatOpen) vexToggleChat();
  vexAddMsg(`${check.message}<br><br>💡 ${check.suggestion}`);
}

// ── Show guard warning in Workspace Assistant (active) ──
// Returns true if file is OK to add, false if blocked
function _fgCheckWorkspace(path, content) {
  const check = _fgCheck(path, content);

  if (!check.ok) {
    _wsAddMsg(`${check.message}\n\n💡 ${check.suggestion}`, 'bot');
    return false;
  }

  if (check.type === 'large') {
    _wsAddMsg(`${check.message}`, 'bot');
    // Still allow — just warn
  }

  return true;
}

function _wsAddFileToCtx() {
  const w = ws(); if (!w) return;
  const SKIP = /\.(lock|png|jpg|jpeg|gif|svg|ico|woff|ttf|eot|map)$|node_modules|dist\//;
  const options = w.allFilePaths.filter(p => !SKIP.test(p) && !_wsContextFiles.includes(p));
  if (!options.length) { toast('All files already in context'); return; }

  const pick = options.find(p => p === activeTab) || options[0];
  const content = getFileContent(pick) || w.fileContents[pick] || '';
  const check = _fgCheck(pick, content);

  // Only block binary/compiled/lockfiles — large files handled via smart chunking
  const blocked = !check.ok && check.type !== 'large' && check.type !== 'toolarge';
  if (blocked) {
    toast(`⛔ ${pick.split('/').pop()} can't be added — ${check.type}`, 'error');
    return;
  }

  _wsContextFiles.push(pick);
  _wsRenderCtxFiles();
  _wsUpdateFooter();
  toast(`Added ${pick.split('/').pop()} to context`);
}

function _wsUpdateFooter() {
  const el = document.getElementById('vexWsFooterFiles');
  if (!el) return;
  if (_wsMode === 'workspace' && _wsContextFiles.length > 0) {
    const tokens = _wsEstimateTokens();
    const warn = tokens > WS_WARN_TOKENS;
    el.textContent = `📎 ${_wsContextFiles.length} file${_wsContextFiles.length !== 1 ? 's' : ''} · ~${tokens.toLocaleString()} tokens${warn ? ' ⚠ large' : ''}`;
    el.style.color = tokens > 12000 ? '#f87171' : warn ? '#f59e0b' : '#334455';
    el.title = warn ? 'Large file — will be truncated to fit limits' : '';
  } else {
    el.textContent = _wsMode === 'workspace' ? 'No files selected' : '💬 General mode — no files sent';
    el.style.color = '#334455';
  }
}

function _wsEstimateTokens() {
  const w = ws(); if (!w) return 0;
  let chars = 500; // file tree overhead
  _wsContextFiles.forEach(path => {
    const content = getFileContent(path) || w.fileContents[path] || '';
    chars += Math.min(content.length, WS_MAX_FILE_CHARS);
  });
  return Math.round(Math.min(chars, WS_MAX_TOTAL_CHARS) / 4);
}

// ── BUILD MESSAGES TO SEND ──
// Token limits
const WS_MAX_FILE_CHARS  = 12000;  // max chars per file sent (~3k tokens)
const WS_MAX_TOTAL_CHARS = 40000;  // max total context (~10k tokens)
const WS_WARN_TOKENS     = 8000;   // warn user if over this

function _wsTruncateFile(content, path) {
  if (content.length <= WS_MAX_FILE_CHARS) return content;
  // For large files: send start + end (most useful parts)
  const half = Math.floor(WS_MAX_FILE_CHARS / 2);
  const start = content.slice(0, half);
  const end   = content.slice(-half);
  const skipped = content.length - WS_MAX_FILE_CHARS;
  return `${start}\n\n... [${skipped} chars truncated — file too large. Ask VEX to focus on a specific section] ...\n\n${end}`;
}

function _wsBuildMessages(userMsg) {
  const w = ws();
  const messages = [..._wsHistory];

  if (_wsMode !== 'workspace' || !w || !_wsContextFiles.length) {
    messages.push({ role: 'user', content: userMsg });
    return messages;
  }

  const SKIP = /\.(lock|png|jpg|jpeg|gif|svg|ico|woff|ttf|eot|map)$|node_modules|dist\//;

  let fileBlock = `WORKSPACE: ${w.name} (${w.allFilePaths.length} files total)\n`;
  fileBlock += `TECH STACK: ${_projectType || detectProjectType()}\n\n`;
  fileBlock += `FILE TREE:\n${w.allFilePaths.filter(p => !SKIP.test(p)).slice(0, 60).join('\n')}\n\n`;
  fileBlock += `--- OPEN FILES ---\n`;

  let totalChars = fileBlock.length;

  _wsContextFiles.forEach(path => {
    if (totalChars >= WS_MAX_TOTAL_CHARS) {
      fileBlock += `\n=== ${path} === [SKIPPED — token budget reached]\n`;
      return;
    }
    const raw = getFileContent(path) || w.fileContents[path] || '';
    const content = _wsTruncateFile(raw, path);
    fileBlock += `\n=== ${path} ===\n${content}\n`;
    totalChars += content.length;
  });

  const fullMsg = fileBlock + `\n---\nUSER: ${userMsg}`;
  messages.push({ role: 'user', content: fullMsg });
  return messages;
}

function _wsSystemPrompt() {
  if (_wsMode === 'workspace') {
    return `You are VEX — an AI coding assistant inside VEX Studio IDE. You have been given the user's workspace files.

When making file edits, ALWAYS wrap them in XML tags like this:
<file path="exact/relative/path.js">
complete new file content here — never partial, always the full file
</file>

Rules:
- Write COMPLETE file contents every time, never snippets
- One <file> block per file changed
- After file blocks, briefly explain what you changed
- Be direct and concise
- If you need a file not provided, ask by name
- Never add placeholder comments like "// rest of file here"
- If a file was truncated, ask the user to specify which section to focus on`
  }
  return `You are VEX — an AI coding assistant. Answer concisely and technically. Use code blocks for code examples.`;
}

// ── SEND ──
// ══════════════════════════════
//  SMART CONTEXT SYSTEM
// ══════════════════════════════

// ── 1. KEYWORD EXTRACTOR ──
const WS_STOP_WORDS = new Set([
  'a','an','the','is','it','in','on','to','of','and','or','but','for',
  'with','this','that','my','me','i','you','can','make','please','want',
  'need','just','also','add','change','fix','update','edit','help','show',
  'give','get','put','set','use','do','did','does','has','have','was',
  'will','would','could','should','there','their','they','when','where',
  'what','how','why','all','some','any','more','like','so','then','than'
]);

function _wsExtractKeywords(msg) {
  return msg.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !WS_STOP_WORDS.has(w))
    .slice(0, 8);
}

// ── INTENT DETECTOR — what kind of thing is user looking for? ──
function _wsDetectIntent(msg) {
  const m = msg.toLowerCase();
  if (/title|app.?name|name.?of.?the.?app|site.?name|brand|logo.?text|heading|app.?title/i.test(m))
    return 'appname';
  if (/button|btn|submit|click|cta/i.test(m)) return 'button';
  if (/input|field|textbox|form|placeholder/i.test(m)) return 'input';
  if (/link|href|nav|menu|navigation/i.test(m)) return 'link';
  if (/image|img|photo|icon|logo/i.test(m)) return 'image';
  if (/color|colour|background|bg|theme/i.test(m)) return 'style';
  if (/heading|title|h1|h2|h3/i.test(m)) return 'heading';
  if (/text|label|paragraph|copy|content/i.test(m)) return 'text';
  return 'any';
}

// ── INTENT-BASED ELEMENT PRIORITY ──
// Returns score — higher = more relevant to show
function _wsElementScore(line, intent) {
  const l = line.toLowerCase();
  switch(intent) {
    case 'appname':
      if (/<title/i.test(line)) return 10;
      if (/<h1/i.test(line)) return 9;
      if (/brand|logo|app-name|site-name|navbar.*brand/i.test(l)) return 8;
      if (/<header/i.test(line)) return 7;
      if (/<h2/i.test(line)) return 6;
      if (/<nav/i.test(line)) return 5;
      if (/meta.*name="title"/i.test(l)) return 8;
      return 1;
    case 'button':
      if (/<button/i.test(line)) return 10;
      if (/type="submit"/i.test(l)) return 9;
      if (/btn/i.test(l)) return 7;
      return 1;
    case 'input':
      if (/<input/i.test(line)) return 10;
      if (/<textarea/i.test(line)) return 9;
      if (/<select/i.test(line)) return 8;
      return 1;
    case 'link':
      if (/<a\s/i.test(line)) return 10;
      if (/<nav/i.test(line)) return 7;
      return 1;
    case 'image':
      if (/<img/i.test(line)) return 10;
      return 1;
    case 'heading':
      if (/<h1/i.test(line)) return 10;
      if (/<h2/i.test(line)) return 9;
      if (/<h3/i.test(line)) return 8;
      return 1;
    default:
      return 5;
  }
}

// ── 2. COMPLEXITY DETECTOR ──
function _wsDetectComplexity(msg) {
  const complex = [
    /refactor/i, /architect/i, /rewrite/i, /rebuild/i,
    /build.*from/i, /create.*system/i, /design.*the/i,
    /all.*bug/i, /everything/i, /entire/i, /whole/i,
    /multi.*file/i, /across.*file/i
  ];
  const simple = [
    /change.*color/i, /color.*to/i, /make.*red/i, /make.*blue/i,
    /add.*button/i, /fix.*button/i, /update.*text/i, /rename/i,
    /remove.*the/i, /hide.*the/i, /show.*the/i, /move.*the/i,
    /font.*size/i, /padding/i, /margin/i, /border/i, /background/i,
    /add.*class/i, /add.*id/i, /typo/i, /spelling/i, /console\.log/i,
    /name.*app/i, /app.*name/i, /change.*name/i, /change.*title/i
  ];
  if (complex.some(r => r.test(msg))) return 'complex';
  if (simple.some(r => r.test(msg))) return 'simple';
  return msg.split(' ').length > 15 ? 'complex' : 'simple';
}

function _wsPickModel(complexity) {
  return complexity === 'simple'
    ? 'claude-haiku-4-5-20251001'
    : 'claude-sonnet-4-20250514';
}

// ── 3. FILE SEARCH ──
function _wsSearchFile(content, keywords) {
  const lines = content.split('\n');
  const hits = new Set();

  lines.forEach((line, i) => {
    const lower = line.toLowerCase();
    if (keywords.some(k => lower.includes(k))) {
      for (let j = Math.max(0, i - 40); j <= Math.min(lines.length - 1, i + 40); j++) {
        hits.add(j);
      }
    }
  });

  if (!hits.size) return null;

  const sorted = [...hits].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0], end = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] <= end + 5) { end = sorted[i]; }
    else { ranges.push([start, end]); start = sorted[i]; end = sorted[i]; }
  }
  ranges.push([start, end]);

  return { lines, ranges, hits };
}

// ── EXTRACT TEXT CONTENT from surrounding lines ──
function _wsGetText(line, lineNum, allLines) {
  // Try inline text first
  const inline = line.replace(/<[^>]+>/g, '').trim();
  if (inline.length > 1) return inline.slice(0, 50);

  // Look ahead up to 3 lines for text content
  for (let i = lineNum + 1; i <= Math.min(lineNum + 3, allLines.length - 1); i++) {
    const next = allLines[i].replace(/<[^>]+>/g, '').trim();
    if (next.length > 1 && !next.startsWith('//')) return next.slice(0, 50);
  }
  return '';
}

// ── GET SECTION CONTEXT (what part of page is this in) ──
function _wsGetSection(lineNum, allLines) {
  const sectionTags = /<(header|nav|main|footer|section|form|article)[^>]*(?:id="([^"]*)")?(?:class="([^"]*)")?/i;
  const headingTags = /<h([1-3])[^>]*>([^<]+)/i;

  for (let i = lineNum - 1; i >= Math.max(0, lineNum - 30); i--) {
    const l = allLines[i];
    const hMatch = l?.match(headingTags);
    if (hMatch) return `in "${hMatch[2].trim()}" section`;
    const sMatch = l?.match(sectionTags);
    if (sMatch) {
      const name = sMatch[2] || sMatch[3]?.split(' ')[0] || sMatch[1];
      return `in ${sMatch[1]}${name ? ` (${name})` : ''}`;
    }
  }
  return '';
}

// ── 4. HUMAN-FRIENDLY ELEMENT DESCRIBER ──
function _wsDescribeElement(lineStr, lineNum, allLines) {
  const line = lineStr.trim();
  if (!line || line.length < 4) return null;

  // ── Title tag ──
  if (/<title/i.test(line)) {
    const text = _wsGetText(line, lineNum, allLines);
    return { label: `Page title — currently "${text || 'empty'}"`, icon: '📄' };
  }

  // ── Button ──
  if (/<button/i.test(line)) {
    const text = _wsGetText(line, lineNum, allLines);
    const cls = line.match(/class="([^"]*)"/i)?.[1] || '';
    const colorHint = cls.match(/red|blue|green|primary|danger|success|warning|gold/i)?.[0] || '';
    const section = _wsGetSection(lineNum, allLines);
    const label = text
      ? `"${text}" button${colorHint ? ` (${colorHint})` : ''}${section ? ` ${section}` : ''}`
      : `Button${colorHint ? ` (${colorHint})` : ''}${section ? ` ${section}` : ''}`;
    return { label, icon: '🔘' };
  }

  // ── Input ──
  if (/<input/i.test(line)) {
    const type = line.match(/type="([^"]*)"/i)?.[1] || 'text';
    const placeholder = line.match(/placeholder="([^"]*)"/i)?.[1] || '';
    const name = line.match(/name="([^"]*)"/i)?.[1] || line.match(/id="([^"]*)"/i)?.[1] || '';
    const section = _wsGetSection(lineNum, allLines);
    return {
      label: `${type} input${placeholder ? ` ("${placeholder}")` : name ? ` [${name}]` : ''}${section ? ` ${section}` : ''}`,
      icon: '✏️'
    };
  }

  // ── Heading ──
  const hMatch = line.match(/<h([1-6])[^>]*>([^<]*)/i);
  if (hMatch) {
    const text = hMatch[2].trim() || _wsGetText(line, lineNum, allLines);
    const icons = ['', '📌', '📋', '▸', '▸', '▸', '▸'];
    return { label: `H${hMatch[1]} heading — "${text}"`, icon: icons[+hMatch[1]] || '📋' };
  }

  // ── Link ──
  if (/<a[\s>]/i.test(line)) {
    const text = _wsGetText(line, lineNum, allLines);
    const href = line.match(/href="([^"]*)"/i)?.[1] || '';
    const section = _wsGetSection(lineNum, allLines);
    return {
      label: text
        ? `"${text}" link${section ? ` ${section}` : ''}`
        : `Link to ${href || 'unknown'}${section ? ` ${section}` : ''}`,
      icon: '🔗'
    };
  }

  // ── Image ──
  if (/<img/i.test(line)) {
    const alt = line.match(/alt="([^"]*)"/i)?.[1] || '';
    const src = line.match(/src="([^"]*)"/i)?.[1]?.split('/').pop() || '';
    return { label: alt ? `Image "${alt}"` : src ? `Image (${src})` : 'Image', icon: '🖼️' };
  }

  // ── Nav/Header/Footer ──
  const structMatch = line.match(/<(nav|header|footer|main|section|form)[^>]*/i);
  if (structMatch) {
    const id = line.match(/id="([^"]*)"/i)?.[1];
    const cls = line.match(/class="([^"]*)"/i)?.[1]?.split(' ')[0];
    const name = id || cls || '';
    return { label: `${structMatch[1]}${name ? ` (${name})` : ''} section`, icon: '📦' };
  }

  // ── Skip CSS, closing tags, whitespace, comments ──
  if (line.startsWith('</') || line.startsWith('<!--') ||
      /^\s*[.#][\w-]/.test(line) || /{/.test(line)) return null;

  // ── Generic div with id/class ──
  if (/<div/i.test(line)) {
    const id = line.match(/id="([^"]*)"/i)?.[1];
    const cls = line.match(/class="([^"]*)"/i)?.[1]?.split(' ')[0];
    if (!id && !cls) return null; // skip anonymous divs
    const text = _wsGetText(line, lineNum, allLines);
    return {
      label: `Block${id ? ` #${id}` : cls ? ` .${cls}` : ''}${text ? ` — "${text}"` : ''}`,
      icon: '📦'
    };
  }

  return null;
}

// ── 5. FIND ELEMENTS — with intent scoring ──
// Returns true if line is clearly JS code, not real HTML
function _wsIsJsCode(line) {
  const trimmed = line.trim();
  // Starts with JS patterns
  if (/^(var|let|const|function|if|for|return|\/\/|\/\*|\*|import|export)\s/.test(trimmed)) return true;
  // Contains JS operators around HTML-like content
  if (/[+\]=].*<[a-z]/.test(trimmed)) return true;
  // Is a string concatenation or template literal with HTML
  if (/['"`].*<title|<h[1-6].*['"`]/.test(trimmed)) return true;
  // Contains .match( or .replace( — regex operations on strings
  if (/\.match\(|\.replace\(|\.indexOf\(/.test(trimmed)) return true;
  // Is inside a JS string (starts with quote)
  if (/^['"`]/.test(trimmed)) return true;
  return false;
}

function _wsFindElements(content, keywords, intent) {
  // For appname intent — find title + h1 directly, no keyword search needed
  if (intent === 'appname') {
    return _wsFindAppNameElements(content);
  }

  const result = _wsSearchFile(content, keywords);
  if (!result) return null;

  const { lines, ranges } = result;
  const seen = new Set(); // deduplicate by element TYPE not label
  const seenTypes = new Set();
  let candidates = [];

  ranges.forEach(([start, end]) => {
    for (let i = start; i <= end; i++) {
      const line = lines[i].trim();
      if (!line || line.length < 4) continue;

      // Skip JS code lines
      if (_wsIsJsCode(line)) continue;
      // Must start with < to be real HTML
      if (!line.startsWith('<')) continue;
      // Skip closing tags, comments, DOCTYPE
      if (/^<\/|^<!/.test(line)) continue;

      const desc = _wsDescribeElement(line, i, lines);
      if (!desc || !desc.label || desc.label.trim() === '') continue;
      if (seen.has(desc.label)) continue;

      // Deduplicate by type — e.g. only show ONE title match
      const typeKey = line.match(/^<(\w+)/)?.[1]?.toLowerCase() || 'unknown';
      if (seenTypes.has(typeKey) && ['title','h1','h2'].includes(typeKey)) continue;
      seenTypes.add(typeKey);
      seen.add(desc.label);

      const score = _wsElementScore(line, intent);
      candidates.push({ desc: desc.label, icon: desc.icon, lineNum: i, range: [start, end], score });
    }
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 4).length ? candidates.slice(0, 4) : null;
}

// Special handler for "change app name / title" intent
// Finds ALL the places where the app name appears and bundles them into one targeted edit
function _wsFindAppNameElements(content) {
  const lines = content.split('\n');
  const hits = [];

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (_wsIsJsCode(trimmed)) return;
    if (!trimmed.startsWith('<')) return;

    // Real <title> tag in HTML head
    if (/<title[^>]*>[^<]+<\/title>/i.test(trimmed)) {
      const text = trimmed.replace(/<[^>]+>/g, '').trim();
      hits.push({ i, priority: 10, type: 'title', text });
    }
    // Real <h1> tag
    else if (/<h1[^>]*>[^<]*$/i.test(trimmed) || /<h1[^>]*>[^<]+<\/h1>/i.test(trimmed)) {
      const text = trimmed.replace(/<[^>]+>/g, '').trim();
      if (text) hits.push({ i, priority: 9, type: 'h1', text });
    }
    // Navbar brand / logo text
    else if (/<(span|div|a)[^>]*(brand|logo|app-name|site-name|navbar-brand)[^>]*>/i.test(trimmed)) {
      const text = trimmed.replace(/<[^>]+>/g, '').trim();
      hits.push({ i, priority: 8, type: 'brand', text });
    }
  });

  if (!hits.length) return null;

  // Sort by priority, take best 3
  hits.sort((a, b) => b.priority - a.priority);
  const top = hits.slice(0, 3);

  // Build range covering all top hits
  const minLine = Math.min(...top.map(h => h.i)) - 5;
  const maxLine = Math.max(...top.map(h => h.i)) + 5;
  const range = [Math.max(0, minLine), Math.min(lines.length - 1, maxLine)];

  // If all hits are close together, just return one combined option
  if (maxLine - minLine < 30) {
    const names = top.map(h => h.text).filter(Boolean);
    const currentName = names[0] || 'unknown';
    return [{
      desc: `App name — currently "${currentName}" (updates title + heading together)`,
      icon: '📄',
      lineNum: top[0].i,
      range,
      score: 10
    }];
  }

  // Hits are spread out — return each separately
  return top.map(h => ({
    desc: h.type === 'title'
      ? `Page title tag — currently "${h.text}"`
      : h.type === 'h1'
        ? `Main heading (H1) — currently "${h.text}"`
        : `Brand/logo text — currently "${h.text || 'empty'}"`,
    icon: '📄',
    lineNum: h.i,
    range: [Math.max(0, h.i - 5), Math.min(lines.length - 1, h.i + 5)],
    score: h.priority
  }));
}

// ── 6. BUILD TARGETED CHUNK ──
function _wsGetChunk(content, range) {
  const lines = content.split('\n');
  const [start, end] = range;
  const chunk = lines.slice(start, end + 1).join('\n');
  return {
    chunk,
    startLine: start,
    endLine: end,
    totalLines: lines.length,
    header: `[Lines ${start + 1}–${end + 1} of ${lines.length} total]`
  };
}

// ── 7. MERGE CHUNK BACK INTO FULL FILE ──
function _wsMergeChunk(fullContent, editedChunk, startLine, endLine) {
  const lines = fullContent.split('\n');
  const editedLines = editedChunk.split('\n');
  const merged = [
    ...lines.slice(0, startLine),
    ...editedLines,
    ...lines.slice(endLine + 1)
  ];
  return merged.join('\n');
}

// ── CLARIFICATION STATE ──
let _wsPendingClarification = null; // { elements, msg, path, content }

function wsPickElement(idx) {
  if (!_wsPendingClarification) return;
  const { elements, msg, path, content } = _wsPendingClarification;
  _wsPendingClarification = null;

  // Hide clarification card
  document.getElementById('wsClarifyCard')?.remove();

  const el = elements[idx];
  _wsAddMsg(`Working on: ${el.desc}`, 'bot');
  _wsSendTargeted(msg, path, content, el.range);
}

// ── MAIN SEND ──
async function wsSend() {
  // Scratch mode — separate handler
  if (window._scratchModeActive) { await _wsScratchSend(); return; }

  if (_wsTyping) return;
  const inp = document.getElementById('vexWsInput');
  const msg = inp.value.trim();
  if (!msg) return;

  const key = vexGetKey();
  if (!key) {
    _wsAddMsg('⚙ Add your Anthropic API key in the field below.', 'bot');
    return;
  }

  inp.value = '';
  inp.style.height = 'auto';
  _wsAddMsg(msg, 'user');
  _wsHistory.push({ role: 'user', content: msg });

  // General mode — send directly
  if (_wsMode !== 'workspace') {
    await _wsSendDirect(msg, key);
    return;
  }

  // Workspace mode — smart routing
  _wsTyping = true;
  const typingEl = _wsAddTyping();

  try {
    const w = ws();
    if (!w) {
      typingEl.remove();
      _wsAddMsg('⚠ No workspace open. Open a folder first then try again.', 'bot');
      return;
    }

    // No files in context — try to auto-add active file
    if (!_wsContextFiles.length) {
      if (activeTab) {
        const content = getFileContent(activeTab) || w.fileContents[activeTab] || '';
        const guard = _fgCheck(activeTab, content);
        if (guard.ok || guard.type === 'large' || guard.type === 'toolarge') {
          _wsContextFiles.push(activeTab);
          _wsRenderCtxFiles();
          _wsUpdateFooter();
        } else {
          typingEl.remove();
          _wsAddMsg(`${guard.message}\n\n💡 ${guard.suggestion}`, 'bot');
          return;
        }
      } else {
        typingEl.remove();
        _wsAddMsg('⚠ No file open. Open a file from the file tree first so VEX knows what to edit.', 'bot');
        return;
      }
    }

    const keywords = _wsExtractKeywords(msg);
    const complexity = _wsDetectComplexity(msg);
    const model = _wsPickModel(complexity);
    const path = _wsContextFiles[0];

    // Try all content sources — Monaco model first, then fileContents, then activeTab model
    let content = '';
    const wContent = w.fileContents[path];
    const modelContent = w.editorModels?.[path]?.getValue?.();
    const activeModelContent = editor?.getModel?.()?.getValue?.();

    if (modelContent && modelContent.trim()) {
      content = modelContent;
    } else if (wContent && wContent.trim()) {
      content = wContent;
    } else if (activeTab === path && activeModelContent && activeModelContent.trim()) {
      content = activeModelContent;
    }

    if (!content.trim()) {
      typingEl.remove();
      _wsAddMsg(`⚠ "${path?.split('/').pop()}" appears empty. Make sure you clicked ⚡ Apply after building.`, 'bot');
      return;
    }

    const guard = _fgCheck(path, content);
    if (!guard.ok && guard.type !== 'large' && guard.type !== 'toolarge') {
      typingEl.remove();
      _wsAddMsg(`${guard.message}\n\n💡 ${guard.suggestion}`, 'bot');
      return;
    }

    const isLargeFile = content.length > WS_MAX_FILE_CHARS;
    _wsShowModelBadge(model, complexity);

    if (!isLargeFile || complexity === 'complex') {
      typingEl.remove();
      await _wsSendFull(msg, key, model, path, content);
      return;
    }

    const intent = _wsDetectIntent(msg);
    const elements = _wsFindElements(content, keywords, intent);

    if (!elements || elements.length === 0) {
      typingEl.remove();
      _wsAddMsg(`🔍 Couldn't find a specific match — VEX AI Agent will analyze the full file.`, 'bot');
      await _wsSendFull(msg, key, 'claude-sonnet-4-20250514', path, content);
      return;
    }

    if (elements.length === 1) {
      typingEl.remove();
      _wsAddMsg(`🎯 Found: ${elements[0].icon || ''} **${elements[0].desc}** — editing now`, 'bot');
      await _wsSendTargeted(msg, path, content, elements[0].range, model, key);
      return;
    }

    // Multiple matches — clarification needed
    // _wsTyping stays false after clarification so user can interact
    typingEl.remove();
    _wsPendingClarification = { elements, msg, path, content, model, key };
    _wsShowClarification(elements, msg);

  } catch (err) {
    document.querySelectorAll('.vex-ws-msg .vex-typing').forEach(el => el.closest('.vex-ws-msg')?.remove());
    _wsAddMsg(`❌ ${err.message}`, 'bot');
  } finally {
    _wsTyping = false;
    // Safety: clear any orphaned typing indicators
    setTimeout(() => {
      if (!_wsTyping) {
        document.querySelectorAll('#vexWsBody .vex-typing').forEach(el => el.closest('.vex-ws-msg')?.remove());
      }
    }, 100);
  }
}

function _wsShowModelBadge(model, complexity) {
  const badge = document.createElement('div');
  badge.style.cssText = `font-size:9px;color:#d4a853;padding:2px 0;opacity:.7`;
  badge.textContent = '✦ VEX AI Agent';
  document.getElementById('vexWsBody').appendChild(badge);
}

// ── SHOW CLARIFICATION CARD ──
function _wsShowClarification(elements, msg) {
  const body = document.getElementById('vexWsBody');
  const card = document.createElement('div');
  card.id = 'wsClarifyCard';
  card.style.cssText = `
    border:1px solid rgba(212,168,83,.3);border-radius:10px;
    background:rgba(212,168,83,.04);padding:14px;margin:4px 0;
  `;

  let html = `
    <div style="font-size:12px;font-weight:700;color:var(--gold);margin-bottom:4px">
      🎯 I found a few things that might match
    </div>
    <div style="font-size:11px;color:#556677;margin-bottom:12px">
      Which one did you mean?
    </div>`;

  elements.forEach((el, i) => {
    html += `
      <button onclick="wsPickElement(${i})" style="
        display:flex;align-items:center;gap:10px;width:100%;text-align:left;
        padding:10px 12px;margin-bottom:6px;
        background:var(--bg3);border:1px solid var(--border);
        border-radius:8px;color:var(--tx);font-size:11px;cursor:pointer;
        font-family:inherit;transition:all .15s;line-height:1.4;
      " onmouseover="this.style.borderColor='var(--goldb)';this.style.background='rgba(212,168,83,.08)'"
         onmouseout="this.style.borderColor='var(--border)';this.style.background='var(--bg3)'">
        <span style="font-size:16px;flex-shrink:0">${el.icon || '📄'}</span>
        <span>${el.desc}</span>
      </button>`;
  });

  html += `
    <div style="margin-top:8px;display:flex;gap:8px;align-items:center">
      <button onclick="_wsPendingClarification=null;document.getElementById('wsClarifyCard').remove()" style="
        background:none;border:none;color:var(--tx3);font-size:10px;
        cursor:pointer;font-family:inherit;padding:2px 0
      ">✕ Cancel</button>
      <span style="font-size:10px;color:#334455">or be more specific in your message</span>
    </div>`;

  card.innerHTML = html;
  body.appendChild(card);
  body.scrollTop = body.scrollHeight;
}

// ── SEND TARGETED (small chunk) ──
async function _wsSendTargeted(msg, path, fullContent, range, model, key) {
  const typingEl = _wsAddTyping();
  const { chunk, startLine, endLine, header } = _wsGetChunk(fullContent, range);

  const contextMsg = `${header}
File: ${path}

\`\`\`
${chunk}
\`\`\`

USER: ${msg}

When editing, wrap your changes in:
<file path="${path}" startLine="${startLine}" endLine="${endLine}">
...edited chunk only, not the whole file...
</file>`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key || vexGetKey(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: model || 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system: _wsSystemPromptTargeted(),
        messages: [{ role: 'user', content: contextMsg }],
      }),
    });

    const data = await response.json();
    typingEl.remove();

    if (data.error) {
      _wsAddMsg(`❌ ${data.error.message}`, 'bot');
    } else {
      const reply = data.content?.[0]?.text || '';
      const historyReply = reply.replace(/<file[\s\S]*?<\/file>/g, '[file edit applied]').trim();
      _wsHistory.push({ role: 'assistant', content: historyReply });
      _wsAutoApplyTargeted(reply, path, fullContent, startLine, endLine);
      vexCelebrate();
    }
  } catch(err) {
    typingEl.remove();
    _wsAddMsg(`❌ ${err.message}`, 'bot');
  }
}

// ── SEND FULL FILE ──
async function _wsSendFull(msg, key, model, path, content) {
  const typingEl = _wsAddTyping();
  const truncated = _wsTruncateFile(content, path);
  const w = ws();
  const SKIP = /\.(lock|png|jpg|jpeg|gif|svg|ico|woff|ttf|eot|map)$|node_modules|dist\//;

  let fileBlock = `WORKSPACE: ${w?.name} (${w?.allFilePaths?.length} files)\n`;
  fileBlock += `FILE TREE:\n${w?.allFilePaths?.filter(p => !SKIP.test(p)).slice(0, 40).join('\n')}\n\n`;
  fileBlock += `=== ${path} ===\n${truncated}\n\n---\nUSER: ${msg}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: _wsSystemPrompt(),
        messages: [..._wsHistory.slice(-6, -1), { role: 'user', content: fileBlock }],
      }),
    });

    const data = await response.json();
    typingEl.remove();

    if (data.error) {
      _wsAddMsg(`❌ ${data.error.message}`, 'bot');
    } else {
      const reply = data.content?.[0]?.text || '';
      const historyReply = reply.replace(/<file[\s\S]*?<\/file>/g, '[file edit applied]').trim();
      _wsHistory.push({ role: 'assistant', content: historyReply });
      _wsAutoApplyReply(reply, path, content);
      vexCelebrate();
    }
  } catch(err) {
    typingEl.remove();
    _wsAddMsg(`❌ ${err.message}`, 'bot');
  }
}

// ── SEND DIRECT (general mode) ──
async function _wsSendDirect(msg, key) {
  _wsTyping = true;
  const typingEl = _wsAddTyping();
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: _wsSystemPrompt(),
        messages: _wsHistory.slice(-12),
      }),
    });
    const data = await response.json();
    typingEl.remove();
    if (data.error) {
      _wsAddMsg(`❌ ${data.error.message}`, 'bot');
    } else {
      const reply = data.content?.[0]?.text || '';
      const historyReply = reply.replace(/<file[\s\S]*?<\/file>/g, '[file edit applied]').trim();
      _wsHistory.push({ role: 'assistant', content: historyReply });
      _wsRenderReply(reply);
    }
  } catch(err) {
    typingEl.remove();
    _wsAddMsg(`❌ ${err.message}`, 'bot');
  } finally {
    _wsTyping = false;
  }
}

function _wsSystemPromptTargeted() {
  return `You are VEX — an AI coding assistant. You have been given a CHUNK of a larger file to edit.

When editing, wrap your changes in XML tags using the EXACT same startLine/endLine from the header:
<file path="path/to/file" startLine="N" endLine="N">
...your edited chunk content here...
</file>

Rules:
- Only edit what the user asked — don't rewrite the whole chunk
- Keep the same indentation and code style
- After the file block, briefly explain what you changed
- Never output the whole file — just the edited chunk`
}

// ── RENDER REPLY FOR TARGETED EDITS (with merge) ──
function _wsRenderReplyTargeted(text, path, fullContent, startLine, endLine) {
  const body = document.getElementById('vexWsBody');

  // Extract <file> blocks — now with startLine/endLine attributes
  const fileRegex = /<file\s+path=["']([^"']+)["'](?:\s+startLine=["'](\d+)["'])?(?:\s+endLine=["'](\d+)["'])?>([\s\S]*?)<\/file>/g;
  const edits = [];
  let match;
  while ((match = fileRegex.exec(text)) !== null) {
    const editedChunk = match[4].trim();
    const sl = match[2] ? parseInt(match[2]) : startLine;
    const el = match[3] ? parseInt(match[3]) : endLine;
    // Merge chunk back into full file
    const mergedContent = _wsMergeChunk(fullContent, editedChunk, sl, el);
    edits.push({ path: match[1], content: mergedContent, chunk: editedChunk, startLine: sl, endLine: el });
  }

  const cleanText = text.replace(/<file[\s\S]*?<\/file>/g, '').trim();

  edits.forEach((edit, editIdx) => {
    const { html: diffHtml, added, removed } = _wsRenderDiff(fullContent, edit.content);
    const lines = edit.content.split('\n').length;
    const cardId = `wsEditCard_${Date.now()}_${editIdx}`;

    // Store in edit map — never embed large content in onclick
    _wsEditStore[cardId] = { path: edit.path, content: edit.content, oldContent: fullContent };

    const card = document.createElement('div');
    card.className = 'vex-ws-file-edit';
    card.id = cardId;
    card.innerHTML = `
      <div class="vex-ws-file-edit-hdr">
        <span class="vex-ws-file-path">📄 ${escapeHtml(edit.path)}</span>
        <span style="font-size:9px;color:#334455">${lines} lines · lines ${edit.startLine+1}–${edit.endLine+1}</span>
      </div>
      <div class="diff-stats">
        <span class="diff-stat-add">+${added} added</span>
        <span class="diff-stat-del">-${removed} removed</span>
        <span class="diff-stat-info">targeted edit</span>
      </div>
      <div class="vex-ws-diff">${diffHtml}</div>
      <div class="vex-ws-edit-actions">
        <button class="ws-confirm-btn skip" onclick="wsSkipEdit('${cardId}')">✕ Skip</button>
        <button class="ws-confirm-btn apply" onclick="wsApplyFromStore('${cardId}')">⚡ Apply</button>
      </div>`;
    body.appendChild(card);
  });

  if (cleanText) {
    const el = document.createElement('div');
    el.className = 'vex-ws-msg bot';
    el.innerHTML = _wsFormatText(cleanText);
    body.appendChild(el);
  }

  body.scrollTop = body.scrollHeight;
}

// ── WS UNDO STACK ──
const _wsUndoStack = []; // { path, before, after, timestamp }

function _wsPushUndo(path, before, after) {
  _wsUndoStack.push({ path, before, after, timestamp: Date.now() });
  if (_wsUndoStack.length > 30) _wsUndoStack.shift();
  _wsShowUndoBar(path);
}

function _wsShowUndoBar(path) {
  const bar = document.getElementById('vexWsUndoBar');
  const label = document.getElementById('vexWsUndoLabel');
  if (!bar || !label) return;
  label.textContent = `↩ Applied edit to ${path.split('/').pop()}`;
  bar.classList.add('show');
  clearTimeout(_wsUndoTimer);
  _wsUndoTimer = setTimeout(() => bar.classList.remove('show'), 8000);
}
let _wsUndoTimer = null;

function wsUndo() {
  if (!_wsUndoStack.length) { toast('Nothing to undo'); return; }
  const snap = _wsUndoStack.pop();
  const w = ws(); if (!w) return;

  // Restore file
  w.fileContents[snap.path] = snap.before;
  if (editorModels[snap.path]) {
    editorModels[snap.path].setValue(snap.before);
  }
  if (activeTab === snap.path && editor) {
    editor.getModel().setValue(snap.before);
  }
  w.modifiedFiles.add(snap.path);
  updateModifiedCount();

  // Refresh preview
  _wsRefreshPreview();

  // Hide bar if nothing left
  if (!_wsUndoStack.length) {
    document.getElementById('vexWsUndoBar').classList.remove('show');
  } else {
    _wsShowUndoBar(_wsUndoStack[_wsUndoStack.length - 1].path);
  }

  toast(`↩ Undid edit to ${snap.path.split('/').pop()}`, 'success');
  vexCelebrate();
}

// ── DIFF ENGINE ──
function _wsDiff(oldText, newText) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result = [];
  let added = 0, removed = 0;

  // Simple LCS-based diff
  const m = oldLines.length, n = newLines.length;
  // For performance cap at 300 lines each
  const ol = oldLines.slice(0, 300);
  const nl = newLines.slice(0, 300);

  // Build LCS table
  const dp = Array.from({length: ol.length + 1}, () => new Array(nl.length + 1).fill(0));
  for (let i = 1; i <= ol.length; i++)
    for (let j = 1; j <= nl.length; j++)
      dp[i][j] = ol[i-1] === nl[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);

  // Backtrack
  const diff = [];
  let i = ol.length, j = nl.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && ol[i-1] === nl[j-1]) {
      diff.unshift({ type: 'ctx', text: ol[i-1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      diff.unshift({ type: 'add', text: nl[j-1] });
      added++; j--;
    } else {
      diff.unshift({ type: 'del', text: ol[i-1] });
      removed++; i--;
    }
  }

  // Only show context around changes (3 lines each side)
  const CONTEXT = 3;
  const changeIdxs = new Set(diff.map((d,i) => d.type !== 'ctx' ? i : -1).filter(i => i >= 0));
  const showIdxs = new Set();
  changeIdxs.forEach(idx => {
    for (let k = Math.max(0, idx - CONTEXT); k <= Math.min(diff.length - 1, idx + CONTEXT); k++)
      showIdxs.add(k);
  });

  // Build output
  let prevShown = true;
  diff.forEach((line, idx) => {
    if (!showIdxs.has(idx)) {
      if (prevShown && line.type === 'ctx') result.push({ type: 'gap' });
      prevShown = false;
      return;
    }
    result.push(line);
    prevShown = true;
  });

  return { lines: result, added, removed, unchanged: m - removed };
}

function _wsRenderDiff(oldContent, newContent) {
  const { lines, added, removed } = _wsDiff(oldContent, newContent);
  let html = '';
  lines.forEach(line => {
    if (line.type === 'gap') {
      html += `<span class="diff-line ctx" style="color:#223344;font-style:italic">  ···</span>`;
    } else {
      const prefix = line.type === 'add' ? '+ ' : line.type === 'del' ? '- ' : '  ';
      html += `<span class="diff-line ${line.type}">${prefix}${escapeHtml(line.text)}</span>`;
    }
  });
  return { html, added, removed };
}

// ── RENDER REPLY WITH DIFF + CONFIRM ──
// ── AUTO APPLY — shows result with Apply/Undo button ──
function _wsAutoApplyReply(text, path, oldContent) {
  const body = document.getElementById('vexWsBody');
  const fileRegex = /<file\s+path=["']([^"']+)["']>([\s\S]*?)<\/file>/g;
  const cleanText = text.replace(/<file[\s\S]*?<\/file>/g, '').trim();
  let match;

  while ((match = fileRegex.exec(text)) !== null) {
    const filePath = match[1];
    const newContent = match[2].trim();
    const cardId = `wsAuto_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // Store in edit store
    _wsEditStore[cardId] = { path: filePath, content: newContent, oldContent };

    const { added, removed } = _wsRenderDiff(oldContent, newContent);
    const lines = newContent.split('\n').length;

    const card = document.createElement('div');
    card.className = 'vex-ws-msg bot';
    card.id = cardId;
    card.innerHTML = `
      ${cleanText ? `<div style="margin-bottom:8px;line-height:1.5">${_wsFormatText(cleanText)}</div>` : ''}
      <div style="background:#0d1b2a;border:1px solid #1e3044;border-radius:8px;overflow:hidden;margin-top:4px">
        <div style="padding:6px 10px;border-bottom:1px solid #1e3044;display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:10px;color:#60a5fa;font-weight:700">📄 ${filePath.split('/').pop()}</span>
          <span style="font-size:9px;color:#334455">${lines} lines · <span style="color:#22c55e">+${added}</span> <span style="color:#f87171">-${removed}</span></span>
        </div>
        <div style="padding:8px 12px;display:flex;gap:8px;align-items:center">
          <button onclick="wsSkipEdit('${cardId}')" style="padding:4px 12px;border-radius:5px;border:1px solid #334455;background:none;color:#8899aa;cursor:pointer;font-size:11px">✕ Skip</button>
          <button onclick="wsApplyFromStore('${cardId}')" style="padding:4px 14px;border-radius:5px;border:none;background:#22c55e;color:#000;cursor:pointer;font-size:11px;font-weight:700">⚡ Apply</button>
        </div>
      </div>`;
    body.appendChild(card);
  }

  if (!text.match(/<file[\s\S]*?<\/file>/)) {
    // No file block — just show text response
    _wsAddMsg(cleanText || text, 'bot');
  }

  body.scrollTop = body.scrollHeight;
}

function _wsAutoApplyTargeted(text, path, fullContent, startLine, endLine) {
  const body = document.getElementById('vexWsBody');
  const fileRegex = /<file\s+path=["']([^"']+)["'](?:\s+startLine=["'](\d+)["'])?(?:\s+endLine=["'](\d+)["'])?>([\s\S]*?)<\/file>/g;
  const cleanText = text.replace(/<file[\s\S]*?<\/file>/g, '').trim();
  let match;

  while ((match = fileRegex.exec(text)) !== null) {
    const editedChunk = match[4].trim();
    const sl = match[2] ? parseInt(match[2]) : startLine;
    const el = match[3] ? parseInt(match[3]) : endLine;
    const mergedContent = _wsMergeChunk(fullContent, editedChunk, sl, el);
    const cardId = `wsAuto_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    _wsEditStore[cardId] = { path, content: mergedContent, oldContent: fullContent };

    const { added, removed } = _wsRenderDiff(fullContent, mergedContent);

    const card = document.createElement('div');
    card.className = 'vex-ws-msg bot';
    card.id = cardId;
    card.innerHTML = `
      ${cleanText ? `<div style="margin-bottom:8px;line-height:1.5">${_wsFormatText(cleanText)}</div>` : ''}
      <div style="background:#0d1b2a;border:1px solid #1e3044;border-radius:8px;overflow:hidden;margin-top:4px">
        <div style="padding:6px 10px;border-bottom:1px solid #1e3044;display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:10px;color:#60a5fa;font-weight:700">📄 ${path.split('/').pop()}</span>
          <span style="font-size:9px;color:#334455">lines ${sl+1}–${el+1} · <span style="color:#22c55e">+${added}</span> <span style="color:#f87171">-${removed}</span></span>
        </div>
        <div style="padding:8px 12px;display:flex;gap:8px;align-items:center">
          <button onclick="wsSkipEdit('${cardId}')" style="padding:4px 12px;border-radius:5px;border:1px solid #334455;background:none;color:#8899aa;cursor:pointer;font-size:11px">✕ Skip</button>
          <button onclick="wsApplyFromStore('${cardId}')" style="padding:4px 14px;border-radius:5px;border:none;background:#22c55e;color:#000;cursor:pointer;font-size:11px;font-weight:700">⚡ Apply</button>
        </div>
      </div>`;
    body.appendChild(card);
  }

  if (!text.match(/<file[\s\S]*?<\/file>/)) {
    _wsAddMsg(cleanText || text, 'bot');
  }

  body.scrollTop = body.scrollHeight;
}

function wsUndoLast(btn) {
  wsUndo();
  if (btn) btn.textContent = '✓ Undone';
}

// ── EDIT STORE — avoids embedding large content in onclick attrs ──
const _wsEditStore = {};

function _wsRenderReply(text) {
  const body = document.getElementById('vexWsBody');

  const fileRegex = /<file\s+path=["']([^"']+)["']>([\s\S]*?)<\/file>/g;
  const edits = [];
  let match;
  while ((match = fileRegex.exec(text)) !== null) {
    edits.push({ path: match[1], content: match[2].trim() });
  }

  const cleanText = text.replace(/<file[\s\S]*?<\/file>/g, '').trim();

  edits.forEach((edit, editIdx) => {
    const w = ws();
    const oldContent = (w && (getFileContent(edit.path) || w.fileContents[edit.path])) || '';
    const { html: diffHtml, added, removed } = _wsRenderDiff(oldContent, edit.content);
    const lines = edit.content.split('\n').length;
    const cardId = `wsEditCard_${Date.now()}_${editIdx}`;

    // Store edit data by cardId — never embed in onclick
    _wsEditStore[cardId] = { path: edit.path, content: edit.content, oldContent };

    const card = document.createElement('div');
    card.className = 'vex-ws-file-edit';
    card.id = cardId;
    card.innerHTML = `
      <div class="vex-ws-file-edit-hdr">
        <span class="vex-ws-file-path">📄 ${escapeHtml(edit.path)}</span>
        <span style="font-size:9px;color:#334455">${lines} lines</span>
      </div>
      <div class="diff-stats">
        <span class="diff-stat-add">+${added} added</span>
        <span class="diff-stat-del">-${removed} removed</span>
        <span class="diff-stat-info">${oldContent ? 'modified' : 'new file'}</span>
      </div>
      <div class="vex-ws-diff">${diffHtml || '<span class="diff-line ctx">  (no changes detected)</span>'}</div>
      <div class="vex-ws-edit-actions">
        <button class="ws-confirm-btn skip" onclick="wsSkipEdit('${cardId}')">✕ Skip</button>
        <button class="ws-confirm-btn apply" onclick="wsApplyFromStore('${cardId}')">⚡ Apply</button>
      </div>`;

    body.appendChild(card);
  });

  if (cleanText) {
    const el = document.createElement('div');
    el.className = 'vex-ws-msg bot';
    el.innerHTML = _wsFormatText(cleanText);
    body.appendChild(el);
  }

  body.scrollTop = body.scrollHeight;
}

function wsApplyFromStore(cardId) {
  const edit = _wsEditStore[cardId];
  if (!edit) { toast('Edit not found', 'error'); return; }
  wsApplyEdit(cardId, edit.path, edit.content, edit.oldContent);
  delete _wsEditStore[cardId];
}

function wsSkipEdit(cardId) {
  const card = document.getElementById(cardId);
  if (!card) return;
  card.style.opacity = '0.4';
  card.querySelector('.vex-ws-edit-actions').innerHTML =
    '<span style="font-size:10px;color:#334455;padding:4px 0">✕ Skipped</span>';
}

function wsApplyEdit(cardId, path, content, oldContent) {
  const w = ws();
  if (!w) { toast('No workspace open', 'error'); return; }
  if (!content) { toast('Nothing to apply', 'error'); return; }

  // ── PATH RESOLUTION ──
  // Claude might return a different path than what's in workspace
  // Try exact match first, then filename-only match
  let resolvedPath = path;

  if (!w.allFilePaths.includes(path)) {
    const fname = path.split('/').pop();
    const match = w.allFilePaths.find(p => p.split('/').pop() === fname);
    if (match) {
      resolvedPath = match;
    } else if (activeTab) {
      // Last resort — apply to currently active file
      resolvedPath = w.activeTab || activeTab;
    }
  }

  // Save snapshot for undo
  _wsPushUndo(resolvedPath, oldContent || '', content);

  // Register file in workspace if still new
  if (!w.allFilePaths.includes(resolvedPath)) w.allFilePaths.push(resolvedPath);
  w.fileContents[resolvedPath] = content;
  w.modifiedFiles.add(resolvedPath);

  // Update or create Monaco model
  if (w.editorModels[resolvedPath]) {
    w.editorModels[resolvedPath].setValue(content);
  } else {
    const lang = typeof getLang === 'function' ? getLang(resolvedPath) : 'html';
    w.editorModels[resolvedPath] = monaco.editor.createModel(content, lang);
  }

  // Open tab if not already open
  if (!w.openTabs.find(t => t.path === resolvedPath)) {
    w.openTabs.push({ path: resolvedPath, name: resolvedPath.split('/').pop() });
  }

  // Switch editor to this file
  w.activeTab = resolvedPath;
  editor.setModel(w.editorModels[resolvedPath]);
  renderTabs();
  renderTree();
  if (typeof updateTreeActive === 'function') updateTreeActive(resolvedPath);
  if (typeof updateModifiedCount === 'function') updateModifiedCount();

  // Update status bar
  const sbFile = document.getElementById('sbFile');
  if (sbFile) sbFile.textContent = `📄 ${resolvedPath.split('/').pop()}`;

  // Refresh preview
  _wsRefreshPreview();
  setTimeout(_updateScratchBtn, 100);

  // Update card UI
  const card = document.getElementById(cardId);
  if (card) {
    card.style.borderColor = 'rgba(34,197,94,.4)';
    const actions = card.querySelector('.vex-ws-edit-actions');
    if (actions) actions.innerHTML = `<span style="font-size:11px;color:#22c55e;font-weight:700;padding:4px 0">✅ Applied to ${resolvedPath.split('/').pop()}</span>`;
  }

  // Update context
  if (!_wsContextFiles.includes(resolvedPath)) {
    _wsContextFiles.push(resolvedPath);
    _wsRenderCtxFiles();
  }
  // Also update oldContent in store for future undos
  _wsUpdateFooter();

  toast(`✓ Applied to ${resolvedPath.split('/').pop()}`, 'success');
  vexCelebrate();
}

function _wsRefreshPreview() {
  // Use existing refreshPreview if available
  if (typeof refreshPreview === 'function') {
    refreshPreview();
    return;
  }
  // Fallback — reload iframe directly
  const frame = document.getElementById('previewFrame');
  if (frame && frame.style.display !== 'none') {
    try { frame.src = frame.src; } catch(e) {}
  }
}

// ══════════════════════════════
//  VEX DRAG — robot + chat move together
// ══════════════════════════════
(function initVexDrag() {
  let dragging = false;
  let startX, startY, startLeft, startBottom;

  function getContainer() { return document.getElementById('vexC'); }
  function getChat() { return document.getElementById('vexChat'); }

  function getPos() {
    const c = getContainer();
    const rect = c.getBoundingClientRect();
    return {
      left: rect.left,
      bottom: window.innerHeight - rect.bottom
    };
  }

  function setPos(left, bottom) {
    const c = getContainer();
    const chat = getChat();
    const cw = c.offsetWidth;
    const ch = c.offsetHeight;

    // Clamp to viewport
    left   = Math.max(0, Math.min(window.innerWidth  - cw, left));
    bottom = Math.max(0, Math.min(window.innerHeight - ch, bottom));

    c.style.left   = left + 'px';
    c.style.bottom = bottom + 'px';
    c.style.right  = 'auto';

    // Move chat relative to robot
    _vexPositionChat(left, bottom, cw, ch, chat);
  }

  function _vexPositionChat(left, bottom, cw, ch, chat) {
    if (!chat || !chat.classList.contains('open')) return;
    const chatW = chat.offsetWidth  || 340;
    const chatH = chat.offsetHeight || 420;
    const margin = 10;

    // Try above robot first
    let chatLeft   = left + cw / 2 - chatW / 2;
    let chatBottom = bottom + ch + margin;

    // If goes off top, put to the side
    if (window.innerHeight - chatBottom - chatH < 0) {
      chatBottom = bottom;
      // Try right side
      if (left + cw + margin + chatW < window.innerWidth) {
        chatLeft = left + cw + margin;
      } else {
        chatLeft = left - chatW - margin;
      }
    }

    // Clamp
    chatLeft   = Math.max(8, Math.min(window.innerWidth  - chatW - 8, chatLeft));
    chatBottom = Math.max(8, Math.min(window.innerHeight - chatH - 8, chatBottom));

    chat.style.right  = 'auto';
    chat.style.left   = chatLeft + 'px';
    chat.style.bottom = chatBottom + 'px';
  }

  // Expose so vexToggleChat can also reposition
  window._vexPositionChat = _vexPositionChat;
  window._vexSyncChatPos  = function() {
    const c = getContainer();
    if (!c) return;
    const rect = c.getBoundingClientRect();
    _vexPositionChat(rect.left, window.innerHeight - rect.bottom, c.offsetWidth, c.offsetHeight, getChat());
  };

  document.addEventListener('mousedown', function(e) {
    const c = getContainer();
    if (!c) return;
    // Only drag on the container itself, not buttons inside
    if (!c.contains(e.target)) return;
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;

    dragging = true;
    const pos = getPos();
    startX      = e.clientX;
    startY      = e.clientY;
    startLeft   = pos.left;
    startBottom = pos.bottom;

    c.classList.add('dragging');
    document.body.style.userSelect = 'none';

    // Cover iframes so they don't swallow mouse events
    document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = 'none');
  });

  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;  // positive = down = less bottom
    setPos(startLeft + dx, startBottom - dy);
  });

  document.addEventListener('mouseup', function() {
    if (!dragging) return;
    dragging = false;
    const c = getContainer();
    if (c) c.classList.remove('dragging');
    document.body.style.userSelect = '';
    document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = '');
  });

  // Safety: reset drag if window loses focus or mouse leaves window
  window.addEventListener('blur', () => {
    if (!dragging) return;
    dragging = false;
    const c = getContainer();
    if (c) c.classList.remove('dragging');
    document.body.style.userSelect = '';
    document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = '');
  });

  // Touch support
  document.addEventListener('touchstart', function(e) {
    const c = getContainer();
    if (!c || !c.contains(e.target)) return;
    if (e.target.tagName === 'BUTTON') return;
    const t = e.touches[0];
    dragging = true;
    const pos = getPos();
    startX = t.clientX; startY = t.clientY;
    startLeft = pos.left; startBottom = pos.bottom;
    c.classList.add('dragging');
  }, { passive: true });

  document.addEventListener('touchmove', function(e) {
    if (!dragging) return;
    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    setPos(startLeft + dx, startBottom - dy);
  }, { passive: true });

  document.addEventListener('touchend', function() {
    dragging = false;
    const c = getContainer();
    if (c) c.classList.remove('dragging');
  });
})();

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _wsFormatText(text) {
  return text
    .replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function _wsAddMsg(content, role = 'bot') {
  const body = document.getElementById('vexWsBody');
  if (!body) return;
  const el = document.createElement('div');
  el.className = `vex-ws-msg ${role}`;
  el.innerHTML = role === 'bot' ? _wsFormatText(content) : escapeHtml(content);
  body.appendChild(el);
  body.scrollTop = body.scrollHeight;
  return el;
}

function _wsAddTyping() {
  const body = document.getElementById('vexWsBody');
  const el = document.createElement('div');
  el.className = 'vex-ws-msg bot';
  el.innerHTML = '<div class="vex-typing"><span></span><span></span><span></span></div>';
  body.appendChild(el);
  body.scrollTop = body.scrollHeight;
  return el;
}

function _wsRestoreKey() {
  const key = vexGetKey();
  const inp = document.getElementById('vexWsKey');
  if (key && inp) inp.value = key;
}

// Auto-resize textarea
document.addEventListener('DOMContentLoaded', () => {
  const ta = document.getElementById('vexWsInput');
  if (ta) ta.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });
});

// ══════════════════════════════
//  ACTIVITY BAR
// ══════════════════════════════
var _abActive = 'explorer';

function abSwitch(panel) {
  // Toggle — click active icon to collapse sidebar
  if (_abActive === panel) {
    var sb = document.getElementById('sidebar');
    var resizer = document.getElementById('sidebarResizer');
    if (sb.style.width === '0px') {
      sb.style.width = '240px';
      if (resizer) resizer.style.display = '';
    } else {
      sb.style.width = '0px';
      if (resizer) resizer.style.display = 'none';
    }
    return;
  }
  _abActive = panel;
  // Update button states
  document.querySelectorAll('.ab-btn[data-panel]').forEach(function(b) {
    b.classList.toggle('active', b.dataset.panel === panel);
  });
  // Show correct panel
  document.querySelectorAll('.ab-panel').forEach(function(p) {
    p.style.display = 'none';
  });
  var target = document.getElementById('panel-' + panel);
  if (target) target.style.display = 'flex';
  // Make sure sidebar is open
  var sb = document.getElementById('sidebar');
  if (sb.style.width === '0px') sb.style.width = '240px';
  // Panel-specific init
  if (panel === 'github') abInitGithub();
  if (panel === 'project') abUpdateProjectInfo();
}

function abInitGithub() {
  var body = document.getElementById('abGhBody');
  if (!body) return;
  // Reuse existing ghRender logic but in the sidebar body
  var token = ghGetToken();
  if (!token) {
    body.innerHTML = '<div style="font-size:11px;color:#556677;line-height:1.7;padding:4px 0">Connect GitHub to push your workspace.<br><br></div>';
    var btn = document.createElement('button');
    btn.className = 'sfa-btn';
    btn.style.cssText = 'grid-column:span 2;color:#60a5fa;border-color:rgba(96,165,250,0.3)';
    btn.textContent = '⎇ Connect GitHub';
    btn.onclick = function() { openGithubPanel(); };
    body.appendChild(btn);
  } else {
    body.innerHTML = '<div style="font-size:11px;color:#556677;line-height:1.7;padding:4px 0 8px">GitHub connected.<br><br></div>';
    var btns = [
      { label: '📁 Browse Repos', tab: 'repos' },
      { label: '⬆ Push Changes', tab: 'push' },
      { label: '🔗 Open by URL', tab: 'open' }
    ];
    btns.forEach(function(b) {
      var el = document.createElement('button');
      el.className = 'sfa-btn';
      el.style.cssText = 'grid-column:span 2;margin-bottom:4px';
      el.textContent = b.label;
      el.onclick = function() { _ghTab = b.tab; openGithubPanel(); };
      body.appendChild(el);
    });
    if (_ghUser) {
      var info = document.createElement('div');
      info.style.cssText = 'font-size:10px;color:#334455;margin-top:8px;line-height:1.6';
      info.textContent = '@' + _ghUser.login;
      body.appendChild(info);
    }
  }
}

function abUpdateProjectInfo() {
  var el = document.getElementById('abProjInfo');
  if (!el) return;
  var w = ws();
  if (!w) { el.textContent = 'No workspace open'; return; }
  el.innerHTML = '<b style="color:#c8c8e0">' + w.name + '</b><br>'
    + w.allFilePaths.length + ' files · '
    + (w.modifiedFiles.size || 0) + ' modified';
}

function abSearchFiles(query) {
  var results = document.getElementById('abSearchResults');
  if (!results) return;
  if (!query.trim()) { results.innerHTML = ''; return; }
  var w = ws();
  if (!w) { results.innerHTML = '<span style="color:#334455">No workspace open</span>'; return; }
  var q = query.toLowerCase();
  var matches = [];
  w.allFilePaths.forEach(function(path) {
    var content = w.fileContents[path] || '';
    var lines = content.split('\n');
    lines.forEach(function(line, i) {
      if (line.toLowerCase().includes(q)) {
        matches.push({ path: path, line: i+1, text: line.trim() });
      }
    });
  });
  if (!matches.length) { results.innerHTML = '<span style="color:#334455">No results</span>'; return; }
  results.innerHTML = matches.slice(0,40).map(function(m) {
    var name = m.path.split('/').pop();
    return '<div style="margin-bottom:6px;cursor:pointer" onclick="openFile(\'' + m.path.replace(/'/g,"\\'") + '\')">'
      + '<div style="color:#60a5fa;font-size:10px">' + name + ':' + m.line + '</div>'
      + '<div style="color:#8899aa;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + m.text.slice(0,80) + '</div>'
      + '</div>';
  }).join('');
}

// ══════════════════════════════
//  SKILL BROWSER
// ══════════════════════════════
var _skillFiles = {}; // filename → content
var _skillActiveFile = null;

function openSkillBrowser() {
  document.getElementById('skillOverlay').classList.add('open');
  renderSkillBrowser();
  if (!vexChatOpen) vexToggleChat();
  vexAddMsg('📦 <b>Skill Browser</b><br><br>Drop a <code>.skill</code> file to browse its contents — read the SKILL.md, reference files, scripts, and assets all in one place.<br><br>Skills are zip files containing a folder structure. Once loaded you can also <b>open the files as a workspace</b> to edit them.');
}

function closeSkillBrowser() {
  document.getElementById('skillOverlay').classList.remove('open');
  _skillFiles = {};
  _skillActiveFile = null;
}

function renderSkillBrowser() {
  var body = document.getElementById('skillBody');
  body.innerHTML = '';
  if (!Object.keys(_skillFiles).length) {
    renderSkillDropZone(body);
  } else {
    renderSkillLoaded(body);
  }
}

function renderSkillDropZone(body) {
  var drop = document.createElement('div');
  drop.className = 'skill-drop-zone';
  drop.innerHTML = '<div class="skill-drop-icon">📦</div>'
    + '<div>Drop a <b>.skill</b> file here</div>'
    + '<div style="font-size:11px;color:#223344">or click to browse</div>';

  var inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.skill,.zip'; inp.style.display = 'none';
  inp.onchange = function() { if (inp.files[0]) loadSkillFile(inp.files[0]); };

  var btn = document.createElement('button');
  btn.className = 'skill-drop-btn';
  btn.textContent = '📂 Open .skill file';
  btn.onclick = function() { inp.click(); };

  drop.appendChild(inp);
  drop.appendChild(btn);
  body.appendChild(drop);

  // Drag and drop
  body.ondragover = function(e) { e.preventDefault(); body.style.background = 'rgba(52,211,153,0.05)'; };
  body.ondragleave = function() { body.style.background = ''; };
  body.ondrop = function(e) {
    e.preventDefault(); body.style.background = '';
    var file = e.dataTransfer.files[0];
    if (file) loadSkillFile(file);
  };
}

function loadSkillFile(file) {
  var body = document.getElementById('skillBody');
  body.innerHTML = '<div class="skill-drop-zone"><div style="color:#34d399;font-size:13px">Loading ' + file.name + '…</div></div>';

  if (typeof JSZip === 'undefined') {
    body.innerHTML = '<div class="skill-drop-zone"><div style="color:#f87171">JSZip not loaded — check your internet connection</div></div>';
    return;
  }

  var reader = new FileReader();
  reader.onload = function(e) {
    JSZip.loadAsync(e.target.result).then(function(zip) {
      _skillFiles = {};
      var promises = [];
      zip.forEach(function(path, entry) {
        if (!entry.dir) {
          promises.push(
            entry.async('string').then(function(content) {
              _skillFiles[path] = content;
            }).catch(function() {
              _skillFiles[path] = '[binary file — cannot display]';
            })
          );
        }
      });
      return Promise.all(promises);
    }).then(function() {
      // Auto-select SKILL.md
      var skillMd = Object.keys(_skillFiles).find(function(k) { return k.endsWith('SKILL.md'); });
      _skillActiveFile = skillMd || Object.keys(_skillFiles)[0] || null;
      renderSkillBrowser();
      // Update header with skill name
      var nameEl = document.getElementById('skillFileName');
      if (nameEl) nameEl.textContent = file.name.replace('.skill','').replace('.zip','');
    }).catch(function(err) {
      body.innerHTML = '<div class="skill-drop-zone"><div style="color:#f87171">Failed to read skill: ' + err.message + '</div></div>';
    });
  };
  reader.readAsArrayBuffer(file);
}

function renderSkillLoaded(body) {
  var files = Object.keys(_skillFiles).sort(function(a,b) {
    // SKILL.md first
    if (a.endsWith('SKILL.md')) return -1;
    if (b.endsWith('SKILL.md')) return 1;
    return a.localeCompare(b);
  });

  // Tree
  var tree = document.createElement('div');
  tree.className = 'skill-file-tree';

  // Group by folder
  var folders = {};
  files.forEach(function(f) {
    var parts = f.split('/');
    var folder = parts.length > 2 ? parts[parts.length-2] : '';
    if (!folders[folder]) folders[folder] = [];
    folders[folder].push(f);
  });

  Object.keys(folders).sort().forEach(function(folder) {
    if (folder) {
      var lbl = document.createElement('div');
      lbl.className = 'skill-file-label';
      lbl.textContent = folder;
      tree.appendChild(lbl);
    }
    folders[folder].forEach(function(f) {
      var name = f.split('/').pop();
      var item = document.createElement('div');
      item.className = 'skill-file-item' + (f === _skillActiveFile ? ' active' : '');
      item.textContent = name;
      item.title = f;
      item.onclick = function() {
        _skillActiveFile = f;
        renderSkillBrowser();
      };
      tree.appendChild(item);
    });
  });
  body.appendChild(tree);

  // Content
  var content = document.createElement('div');
  content.className = 'skill-content';
  if (_skillActiveFile && _skillFiles[_skillActiveFile] !== undefined) {
    var isMarkdown = _skillActiveFile.endsWith('.md');
    if (isMarkdown) {
      content.innerHTML = renderSkillMarkdown(_skillFiles[_skillActiveFile]);
    } else {
      var pre = document.createElement('pre');
      pre.textContent = _skillFiles[_skillActiveFile];
      content.appendChild(pre);
    }
  }
  body.appendChild(content);
}

function renderSkillMarkdown(md) {
  // Simple markdown renderer — enough for SKILL.md files
  var html = md
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    // Code blocks
    .replace(/```[\w]*\n([\s\S]*?)```/g, '<pre class="md-code">$1</pre>')
    // Headings
    .replace(/^### (.+)$/gm, '<div class="md-h3">$1</div>')
    .replace(/^## (.+)$/gm, '<div class="md-h2">$1</div>')
    .replace(/^# (.+)$/gm, '<div class="md-h1">$1</div>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    // HR
    .replace(/^---$/gm, '<hr style="border-color:#1e3044;margin:16px 0">')
    // List items
    .replace(/^[-•] (.+)$/gm, '<div class="md-p" style="padding-left:12px">• $1</div>')
    // Paragraphs (non-empty lines not already wrapped)
    .replace(/^(?!<)(.+)$/gm, '<div class="md-p">$1</div>');
  return html;
}

function openSkillAsWorkspace() {
  if (!Object.keys(_skillFiles).length) return;
  var skillName = document.getElementById('skillFileName').textContent || 'skill';
  var newWs = createWorkspace(skillName);
  Object.keys(_skillFiles).forEach(function(path) {
    // Normalise path — strip leading folder prefix
    var parts = path.split('/');
    var normalised = skillName + '/' + parts.slice(1).join('/');
    newWs.fileContents[normalised] = _skillFiles[path];
    newWs.allFilePaths.push(normalised);
  });
  workspaces.push(newWs);
  activeWsId = newWs.id;
  syncWorkspaceUI();
  renderTree();
  renderWsTabs();
  closeSkillBrowser();
  // Open SKILL.md
  var skillMd = newWs.allFilePaths.find(function(p){ return p.endsWith('SKILL.md'); });
  if (skillMd) setTimeout(function(){ openFile(skillMd); }, 200);
  toast('✓ Opened skill as workspace', 'success');
}

function loadDefaultProject() {
  const DEFAULT_FILES = {
    'My-First-App/src/App.tsx': `import React, { useState, useEffect } from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Platform,
  ActivityIndicator,
  View,
} from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { Asset } from 'expo-asset';

/** Main App — loads the HTML from assets into a full-screen WebView. */
const App: React.FC = () => {
  const [htmlUri, setHtmlUri] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    (async () => {
      try {
        const asset = Asset.fromModule(require('../assets/index.html'));
        await asset.downloadAsync();
        setHtmlUri(asset.localUri ?? asset.uri);
      } catch (err) {
        console.error('Failed to load HTML asset:', err);
      }
    })();
  }, []);

  /** Handle messages sent from the WebView via window.ReactNativeWebView.postMessage() */
  const onMessage = (event: WebViewMessageEvent): void => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      console.log('[WebView]', data);
    } catch {
      console.log('[WebView]', event.nativeEvent.data);
    }
  };

  if (!htmlUri) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#d4a853" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#0a1628" />
      <WebView
        source={{ uri: htmlUri }}
        style={styles.webview}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        allowUniversalAccessFromFileURLs
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        startInLoadingState={false}
        scalesPageToFit={Platform.OS === 'android'}
        bounces={false}
        overScrollMode="never"
        onMessage={onMessage}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a1628',
  },
  webview: {
    flex: 1,
  },
  loading: {
    flex: 1,
    backgroundColor: '#0a1628',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default App;
`,
    'My-First-App/src/types.d.ts': `/// <reference types="expo/types" />

declare module '*.html' {
  const value: number;
  export default value;
}
`,
    'My-First-App/assets/index.html': `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>My App</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, sans-serif; background: #0a1628; color: #eee; height: 100vh; display: flex; align-items: center; justify-content: center; text-align: center; }
  h1 { font-size: 28px; margin-bottom: 8px; }
  p { color: #888; font-size: 14px; }
<\/style>
</head>
<body>
  <div><h1>Hello World! 👋</h1><p>Start building your app</p></div>
<\/body>
<\/html>`,
    'My-First-App/package.json': `{
  "name": "com.studio.myfirstapp",
  "version": "1.0.0",
  "main": "expo-router/entry",
  "scripts": {
    "start": "expo start",
    "android": "expo start --android",
    "ios": "expo start --ios",
    "build": "eas build",
    "lint": "expo lint"
  },
  "dependencies": {
    "expo": "~52.0.0",
    "expo-status-bar": "~2.0.0",
    "expo-asset": "~10.0.0",
    "react": "18.3.1",
    "react-native": "0.76.3",
    "react-native-webview": "13.12.5",
    "expo-router": "~4.0.0",
    "react-native-safe-area-context": "4.12.0",
    "react-native-screens": "~4.1.0"
  },
  "devDependencies": {
    "@babel/core": "^7.25.0",
    "typescript": "~5.6.0",
    "@types/react": "~18.3.0",
    "@types/react-native": "~0.73.0"
  },
  "private": true
}`,
    'My-First-App/app.json': `{
  "expo": {
    "name": "My First App",
    "slug": "my-first-app",
    "version": "1.0.0",
    "orientation": "default",
    "userInterfaceStyle": "dark",
    "backgroundColor": "#0a1628",
    "icon": "./assets/icon.png",
    "splash": {
      "image": "./assets/splash.png",
      "backgroundColor": "#0a1628",
      "resizeMode": "contain"
    },
    "ios": {
      "bundleIdentifier": "com.studio.myfirstapp",
      "supportsTablet": true
    },
    "android": {
      "package": "com.studio.myfirstapp",
      "adaptiveIcon": {
        "foregroundImage": "./assets/icon.png",
        "backgroundColor": "#0a1628"
      }
    },
    "scheme": "my-first-app",
    "plugins": [
      "expo-router"
    ]
  }
}`,
    'My-First-App/tsconfig.json': `{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "baseUrl": ".",
    "paths": {
      "@/*": [
        "src/*"
      ]
    },
    "jsx": "react-jsx"
  },
  "include": [
    "**/*.ts",
    "**/*.tsx",
    ".expo/types/**/*.ts",
    "expo-env.d.ts"
  ]
}`,
    'My-First-App/babel.config.js': `module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
`,
    'My-First-App/metro.config.js': `const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('html');

module.exports = config;
`,
    'My-First-App/eas.json': `{
  "cli": {
    "version": ">= 13.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "production": {
      "autoIncrement": true
    }
  },
  "submit": {
    "production": {}
  }
}`,
    'My-First-App/.gitignore': `node_modules/
.expo/
dist/
npm-debug.*
*.jks
*.p8
*.p12
*.key
*.mobileprovision
*.orig.*
web-build/
.env
.env.local
`,
    'My-First-App/README.md': `# My First App

Built with **App Studio** — TypeScript + Expo + React Native.

## Quick Start

\`\`\`bash
npm install
npx expo start
\`\`\`

## Build for Stores

\`\`\`bash
# Preview APK (Android)
npx eas build --platform android --profile preview

# Production
npx eas build --platform android --profile production
npx eas build --platform ios --profile production

# Submit
npx eas submit --platform android
npx eas submit --platform ios
\`\`\`

## Project Structure

\`\`\`
src/
  App.tsx          - Main app (WebView wrapper)
  components/      - Reusable components
  screens/         - Screen components
  types.d.ts       - TypeScript declarations
assets/
  index.html       - Your web app (loaded in WebView)
  icon.png         - App icon
  splash.png       - Splash screen
\`\`\`
`
  };

  // Create workspace
  const ws = createWorkspace('My-First-App');
  ws.fileContents = { ...DEFAULT_FILES };
  ws.allFilePaths = Object.keys(DEFAULT_FILES);
  workspaces = [ws];
  activeWsId = ws.id;
  renderWsTabs();
  syncWorkspaceUI();
  renderTree();

  // Auto-open README once Monaco is ready
  const tryOpen = () => {
    if (editor) {
      const p = 'My-First-App/README.md';
      openTabs.push({ path: p, name: 'README.md' });
      renderTabs();
      setActiveTab(p);
    } else {
      setTimeout(tryOpen, 200);
    }
  };
  setTimeout(tryOpen, 400);
}

