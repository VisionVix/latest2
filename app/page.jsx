/* eslint-disable */
"use client"

import Image from "next/image"
import Link from "next/link"
import Script from "next/script"

export default function HomePage() {
  return (
    <>
      <Script src="/page-scripts.js" strategy="afterInteractive" />
      {/* TITLEBAR */}
      <div className="titlebar">
        <div className="tb-logo">
          <div className="tb-logo-mark">V</div>
          <div>
            <span className="tb-logo-text">VEX Studio</span>
            <span className="tb-logo-sub">/ real IDE</span>
          </div>
        </div>
      
        <div className="tb-actions">
          <button className="tb-btn primary" onClick={() => { openFolder() }}>📂 Open Folder</button>
          <button className="tb-btn" onClick={() => { saveCurrentFile() }} id="saveBtn" title="Ctrl+S">💾 Save</button>
          <button className="tb-btn" onClick={() => { saveAllFiles() }} id="saveAllBtn">💾 Save All</button>
          <button className="tb-btn" onClick={() => { openSearch() }} title="Ctrl+P">🔍 Find File</button>
          <button className="tb-btn" onClick={() => { refreshTree() }} title="Refresh file tree">↺ Refresh</button>
          <button className="tb-btn" id="previewBtn" onClick={() => { togglePreview() }} title="Toggle live preview" style={{display:"none"}}>▶ Preview</button>
          <button className="tb-btn" id="githubBtn" onClick={() => { openGithubPanel() }} title="GitHub" style={{marginLeft:"8px",borderColor:"rgba(255,255,255,0.12)"}}>⎇ GitHub</button>
          <button className="tb-btn" onClick={() => { openSkillBrowser() }} title="Skill Browser" style={{borderColor:"rgba(52,211,153,0.3)",color:"#34d399"}}>📦 Skills</button>
        </div>
      
        <div className="tb-spacer"></div>
      
        <div className="tb-repo-info">
          <div className="tb-indicator" id="repoIndicator"></div>
          <span id="repoName">No folder open</span>
        </div>
      </div>
      
      {/* APP */}
      <div className="app">
      
      {/* ACTIVITY BAR */}
      <div className="activity-bar">
        <div className="activity-bar-top">
          <button className="ab-btn active" data-panel="explorer" onClick={() => { abSwitch('explorer') }} title="">
            📁<span className="ab-tooltip">Explorer</span>
          </button>
          <button className="ab-btn" data-panel="search" onClick={() => { abSwitch('search') }} title="">
            🔍<span className="ab-tooltip">Search</span>
          </button>
          <button className="ab-btn" data-panel="github" onClick={() => { abSwitch('github') }} title="">
            ⎇<span className="ab-tooltip">GitHub</span>
          </button>
          <button className="ab-btn" data-panel="project" onClick={() => { abSwitch('project') }} title="">
            ⚡<span className="ab-tooltip">Project</span>
          </button>
          <button className="ab-btn" data-panel="translation" onClick={() => { abSwitch('translation') }} title="">
            🌐<span className="ab-tooltip">Translation</span>
          </button>
        </div>
        <div className="activity-bar-bot">
          <button className="ab-btn" onClick={() => { openDocs() }} id="docsAbBtn" title="">
            📖<span className="ab-tooltip">Docs</span>
          </button>
          <button className="ab-btn" onClick={() => { vexToggleChat() }} title="">
            ✦<span className="ab-tooltip">VEX AI</span>
          </button>
        </div>
      </div>
      
        {/* SIDEBAR */}
        <div className="sidebar" id="sidebar">
          {/* WORKSPACE TABS */}
          <div className="ws-bar" id="wsBar">
            <div className="ws-add" onClick={() => { showNewWsMenu(event) }} title="New workspace">＋ New</div>
          </div>
      
          {/* PANEL: EXPLORER */}
          <div className="ab-panel" id="panel-explorer">
            <div className="sidebar-header">
              <div className="sidebar-title" id="sidebarTitle">Explorer</div>
              <div className="sidebar-actions">
                <button className="sidebar-icon-btn" onClick={() => { collapseAll() }} title="Collapse all">⊟</button>
              </div>
            </div>
            <div className="sidebar-file-actions">
              <button className="sfa-btn" onClick={() => { newFilePrompt() }} title="Create a new blank file">+ New File</button>
              <button className="sfa-btn" onClick={() => { addFiles() }} title="Add existing files from your computer">+ Add Files</button>
              <button className="sfa-btn" onClick={() => { newFolderPrompt() }} title="Create a new folder">+ New Folder</button>
              <button className="sfa-btn" onClick={() => { openFolder() }} title="Open a local folder" style={{flex:"1 1 100%"}}>📂 Open Folder</button>
            </div>
      
            {/* SCANNERS */}
            <div className="sidebar-scanners-hdr">🔬 Scanners <span id="projTypeLabel" style={{color:"var(--tx3)",fontWeight:400,textTransform:"none",letterSpacing:"0",fontSize:"9px"}}></span></div>
            <div className="sidebar-scanners">
              <button className="scan-btn" id="secBtn" onClick={() => { openScanner('security') }} title="Security scanner">🛡 Security<span className="scan-badge green" id="secBadge">✓</span></button>
              <button className="scan-btn" id="seoBtn" onClick={() => { openScanner('seo') }} title="SEO & Accessibility">🔍 SEO<span className="scan-badge green" id="seoBadge">✓</span></button>
              <button className="scan-btn" id="qualBtn" onClick={() => { openScanner('quality') }} title="Code quality">⚡ Quality<span className="scan-badge green" id="qualBadge">✓</span></button>
              <button className="scan-btn" id="refBtn" onClick={() => { openScanner('refactor') }} title="Refactor tools">🔧 Refactor<span className="scan-badge green" id="refBadge">✓</span></button>
              <button className="scan-btn" id="assetsBtn" onClick={() => { openScanner('assets') }} title="Assets & files">📦 Assets<span className="scan-badge green" id="assetsBadge">✓</span></button>
              <button className="scan-btn" id="checkBtn" onClick={() => { openChecklist() }} title="Pre-launch checklist" style={{borderLeftColor:"#a78bfa"}}>🚀 Checklist</button>
            </div>
            <div className="file-tree" id="fileTree">
              <div className="tree-empty">
                <div className="tree-empty-icon">📁</div>
                Click <strong>Open Folder</strong><br />to load your repo<br /><br />
                <span style={{fontSize:"9px",color:"var(--tx2)"}}>Select a local folder to browse.<br />Edited files download on save.</span>
              </div>
            </div>
          </div>
      
          {/* PANEL: SEARCH */}
          <div className="ab-panel" id="panel-search" style={{display:"none"}}>
            <div className="sidebar-header">
              <div className="sidebar-title">Search</div>
            </div>
            <div style={{padding:"10px"}}>
              <input className="nxc-input" id="abSearchInput" placeholder="Search across files…" oninput="abSearchFiles(this.value)" style={{marginBottom:"8px"}}/>
              <div id="abSearchResults" style={{fontSize:"11px",color:"#556677",lineHeight:1.8}}></div>
            </div>
          </div>
      
          {/* PANEL: GITHUB */}
          <div className="ab-panel" id="panel-github" style={{display:"none"}}>
            <div className="sidebar-header">
              <div className="sidebar-title">GitHub</div>
            </div>
            <div id="abGhBody" style={{flex:"1",overflowY:"auto",padding:"10px"}}></div>
          </div>
      
          {/* PANEL: PROJECT */}
          <div className="ab-panel" id="panel-project" style={{display:"none"}}>
            <div className="sidebar-header">
              <div className="sidebar-title">Project</div>
            </div>
            <div style={{padding:"10px",display:"flex",flexDirection:"column",gap:"6px"}}>
              <button className="sfa-btn" onClick={() => { openScaffoldPanel() }} style={{flex:"1 1 100%",color:"var(--gold)",borderColor:"var(--goldb)"}}>⚡ New Project / Wrap in Vite</button>
              <button className="sfa-btn" onClick={() => { openNextjsConverter() }} style={{flex:"1 1 100%",color:"#60a5fa",borderColor:"rgba(96,165,250,0.3)"}}>▲ Convert to Next.js</button>
              <button className="sfa-btn" onClick={() => { openViteConverter() }} style={{flex:"1 1 100%",color:"#a78bfa",borderColor:"rgba(167,139,250,0.3)"}}>🔋 Convert to Vite + Supabase</button>
              <button className="sfa-btn" onClick={() => { openApiRouteBuilder() }} style={{flex:"1 1 100%",color:"#fbbf24",borderColor:"rgba(251,191,36,0.3)"}}>⚡ HTML → Next.js API Route</button>
              <button className="sfa-btn" onClick={() => { openViteToHtmlConverter() }} style={{flex:"1 1 100%",color:"#34d399",borderColor:"rgba(52,211,153,0.3)"}}>🗜 Vite → Standalone HTML</button>
              <div style={{marginTop:"8px",fontSize:"9px",fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",color:"#334455"}}>Current Workspace</div>
              <div id="abProjInfo" style={{fontSize:"11px",color:"#556677",lineHeight:1.7}}>No workspace open</div>
            </div>
          </div>
      
          {/* PANEL: TRANSLATION */}
          <div className="ab-panel" id="panel-translation" style={{display:"none"}}>
            <div className="sidebar-header">
              <div className="sidebar-title">Translation</div>
            </div>
            <div style={{padding:"10px",display:"flex",flexDirection:"column",gap:"6px"}}>
              <div style={{fontSize:"11px",color:"#556677",lineHeight:1.7,marginBottom:"4px"}}>Translate the active HTML file into multiple languages using AI.</div>
              <button className="sfa-btn" onClick={() => { openTransPanel(activeTab) }} style={{gridColumn:"span 2",color:"#4ade80",borderColor:"rgba(74,222,128,0.3)"}}>🌐 Open Translation Studio</button>
            </div>
          </div>
      
          {/* PANEL: SKILLS */}
          <div className="ab-panel" id="panel-skills" style={{display:"none"}}>
            <div className="sidebar-header">
              <div className="sidebar-title">Skills</div>
            </div>
            <div style={{padding:"10px",display:"flex",flexDirection:"column",gap:"6px"}}>
              <div style={{fontSize:"11px",color:"#556677",lineHeight:1.7,marginBottom:"4px"}}>Browse, read and edit <code style={{color:"#34d399",fontSize:"10px"}}>.skill</code> files.</div>
              <button className="sfa-btn" onClick={() => { openSkillBrowser() }} style={{gridColumn:"span 2",color:"#34d399",borderColor:"rgba(52,211,153,0.3)"}}>📦 Open Skill Browser</button>
            </div>
          </div>
      
        </div>
      
        <div className="resizer" id="sidebarResizer"></div>
      
        {/* EDITOR AREA */}
        <div className="editor-area" id="editorArea">
          <div className="tab-bar" id="tabBar"></div>
      
          <div className="editor-split" id="editorSplit">
            <div className="editor-pane" id="editorPane">
              <div id="editorPlaceholder" className="editor-placeholder">
                <div className="editor-placeholder-logo">VEX</div>
                <div className="editor-placeholder-sub">
                  Open a folder to get started<br />
                  <span className="editor-placeholder-kbd">Ctrl+P</span> Quick file search &nbsp;
                  <span className="editor-placeholder-kbd">Ctrl+S</span> Save file
                </div>
              </div>
              <div id="editor" style={{display:"none",flex:"1"}}></div>
            </div>
            <div className="split-resizer" id="splitResizer" style={{display:"none"}}></div>
            <div className="preview-pane" id="previewPane" style={{display:"none"}}>
              <div className="preview-header">
                <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                  <button id="prevModeStatic" onClick={() => { setPreviewMode('static') }} className="prev-mode-btn active" title="Static preview (HTML/CSS/JS)">⚡ Preview</button>
                  <button id="prevModeNode" onClick={() => { setPreviewMode('node') }} className="prev-mode-btn" title="Run with WebContainers (requires Vercel deploy)">▶ Run</button>
                </div>
                <span id="previewFileName" style={{fontWeight:400,color:"var(--tx2)",fontSize:"11px",marginLeft:"4px"}}></span>
                <button onClick={() => { refreshActivePreview() }} style={{marginLeft:"auto",background:"none",border:"none",color:"var(--tx2)",cursor:"pointer",fontSize:"11px",padding:"2px 6px"}} title="Force refresh">↺</button>
                <div className="preview-refresh-dot" id="previewDot"></div>
              </div>
              <iframe id="previewFrame" className="preview-iframe" sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"></iframe>
              <div id="sbFrame" className="preview-iframe" style={{display:"none",flex:"1",border:"none"}}></div>
            </div>
          </div>
      
          {/* TERMINAL */}
          <div className="terminal-panel" id="terminalPanel">
            <div className="tp-header">
              <div className="tp-tab active">⌨ Terminal</div>
              <div className="tp-tab" onClick={() => { toast('Output panel coming soon') }}>⊞ Output</div>
              <div className="tp-spacer"></div>
              <button className="tp-action" onClick={() => { copyTermOutput() }}>📋 Copy</button>
              <button className="tp-action" onClick={() => { clearTerm() }}>✕ Clear</button>
              <button className="tp-close" onClick={() => { toggleTerminal() }}>▼</button>
            </div>
            <div className="terminal-body" id="termBody">
              <div className="t-line"><span className="t-prompt">studio:~$</span><span className="t-cmd">VEX Studio ready</span></div>
              <div className="t-info">ℹ Built-in: open · close · rm -rf . · ls · clear · help</div>
              <div className="t-info">ℹ Run commands in your system terminal (PowerShell / Terminal).</div>
            </div>
            <div className="terminal-input-row">
              <span className="t-prompt">studio:~$</span>
              <input className="terminal-input" id="termInput" placeholder="Type a note or command hint..." onKeyDown={(e) => { handleTermKey(event) }} />
            </div>
          </div>
        </div>
      
      
      
      </div>
      
      {/* VEX ROBOT ASSISTANT */}
      <div className="vex-container" id="vexC">
        <div className="vex-chat" id="vexChat">
          <div className="vex-chat-hdr">
            <span style={{width:"6px",height:"6px",background:"#22c55e",borderRadius:"50%",boxShadow:"0 0 5px rgba(34,197,94,.6)",flexShrink:0}}></span>
            <h3>VEX Assistant</h3>
            <div className="vex-ctx-tag" id="vexCtxTag" onClick={() => { vexPasteFile() }} title="Click to paste open file">📄 <span id="vexCtxFile">no file</span></div>
            <button style={{background:"none",border:"none",color:"#60a5fa",fontSize:"11px",fontWeight:700,cursor:"pointer",padding:"2px 6px",borderRadius:"4px",border:"1px solid rgba(96,165,250,.3)"}} onClick={() => { openWsChat() }} title="Workspace chat — Claude reads your files">⚡ Workspace</button>
            <button id="vexScratchBtn" style={{background:"none",border:"none",color:"#a78bfa",fontSize:"11px",fontWeight:700,cursor:"pointer",padding:"2px 6px",borderRadius:"4px",border:"1px solid rgba(167,139,250,.3)",display:"none"}} onClick={() => { openScratchChat() }} title="Build a new HTML app from scratch">✦ Build</button>
            <button id="vexRegexBtn" style={{background:"none",border:"none",color:"#34d399",fontSize:"11px",fontWeight:700,cursor:"pointer",padding:"2px 6px",borderRadius:"4px",border:"1px solid rgba(52,211,153,.3)",display:"none"}} onClick={() => { vexScanRegex() }} title="Find & highlight all regex in active file">🔍 Regex</button>
            <button style={{background:"none",border:"none",color:"#8899aa",fontSize:"16px",cursor:"pointer",padding:"0 2px",marginLeft:"4px"}} onClick={() => { vexToggleChat() }}>✕</button>
          </div>
          <div className="vex-chat-body" id="vexBody"></div>
          <div className="vex-chat-input">
            <div className="vex-input-row">
              <input type="text" className="vex-main-input" id="vexInput" placeholder="Ask VEX about your code..." onKeyDown={(e) => { if(event.key==='Enter')vexSend() }} />
              <button className="vex-send-btn" onClick={() => { vexSend() }}>Send</button>
            </div>
            <input type="password" className="vex-key-input" id="vexKey" placeholder="Anthropic API key  sk-ant-..." oninput="vexSaveKey(this.value)" />
          </div>
        </div>
        <div className="vex-bubble" id="vexBubble"></div>
        <div className="vex-glow" id="vexGlow"></div>
        <div className="vex-spark"></div><div className="vex-spark"></div><div className="vex-spark"></div><div className="vex-spark"></div>
        <div className="vex-robot" id="vexBot">
          <div className="vex-notif-dot" id="vexNotifDot"></div>
          <div className="vex-v">
            <div className="vex-sl"></div><div className="vex-sr"></div>
            <div className="vex-vl"></div><div className="vex-vr"></div>
          </div>
          <div className="vex-face">
            <div className="vex-harc"></div>
            <div className="vex-eyes"><div className="vex-eye l"></div><div className="vex-eye r"></div></div>
            <div className="vex-mouth"></div>
          </div>
          <div className="vex-arm l"><div className="vex-pin"></div></div>
          <div className="vex-arm r"><div className="vex-pin"></div></div>
        </div>
        <div className="vex-shadow"></div>
        <div className="vex-hint">✦ Ask VEX</div>
      </div>
      {/* STATUSBAR */}
      <div className="statusbar">
        <div className="sb-item gold" id="sbBranch">⎇ —</div>
        <div className="sb-item" id="sbModified">0 modified</div>
        <div className="sb-item" id="sbFile">📄 —</div>
        <div className="sb-spacer"></div>
        <div className="sb-item gold" onClick={() => { openChecklist() }} title="Pre-launch checklist" style={{background:"rgba(139,53,200,.12)",borderRadius:"4px",padding:"0 8px",fontWeight:700}}>🚀 Checklist</div>
        <div className="sb-item blue" onClick={() => { toggleAI() }}>✦ Assistant</div>
        <div className="sb-item" onClick={() => { toggleTerminal() }}>⌨ Terminal</div>
        <div className="sb-item" id="sbLang">—</div>
        <div className="sb-item" id="sbPos">Ln 1, Col 1</div>
      </div>
      
      {/* SEARCH OVERLAY */}
      <div className="search-overlay" id="searchOverlay" onClick={() => { e => { if(e.target===this) closeSearch(); } }}>
        <div className="search-box" onClick={() => { e => e.stopPropagation() }}>
          <div className="search-input-row">
            <span style={{color:"var(--tx3)",fontSize:"12px"}}>🔍</span>
            <input className="search-input" id="searchInput" placeholder="Search files..."
              oninput="filterSearch(this.value)"
              onKeyDown={(e) => { handleSearchKey(event) }} />
          </div>
          <div className="search-results" id="searchResults"></div>
        </div>
      </div>
      
      {/* TOAST */}
      <div className="toast-container" id="toastContainer"></div>
      
      {/* Hidden folder picker (works in iframes, unlike showDirectoryPicker) */}
      <input type="file" id="folderInput" webkitdirectory multiple style={{display:"none"}} onChange={(e) => { handleFolderInput(this) }} />
      <input type="file" id="fileInput" multiple style={{display:"none"}} onChange={(e) => { handleFileInput(this) }} />
      
      {/* MONACO */}
    </>
  )
}