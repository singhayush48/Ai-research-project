import React, { useMemo, useState } from 'react';
import {
  Sparkles,
  Plus,
  Search,
  X,
  Pencil,
  Trash2,
  Compass,
  GitCompare,
  NotebookPen,
  LayoutGrid,
  LogOut,
} from 'lucide-react';
import ThemeToggle from './ThemeToggle.jsx';

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Groups projects into Today / Yesterday / Older, newest first within each
// group — the same grouping convention every mainstream AI chat sidebar
// uses. Falls back gracefully if updated_at is missing.
function groupProjects(projects) {
  const today = startOfDay(new Date());
  const yesterday = today - 24 * 60 * 60 * 1000;
  const groups = { Today: [], Yesterday: [], Older: [] };

  for (const p of projects) {
    const ts = p.updated_at ? startOfDay(p.updated_at) : 0;
    if (ts === today) groups.Today.push(p);
    else if (ts === yesterday) groups.Yesterday.push(p);
    else groups.Older.push(p);
  }
  return Object.entries(groups).filter(([, list]) => list.length > 0);
}

export default function ChatSidebar({
  projects,
  loading,
  currentProjectId,
  onSelectProject,
  onNewResearch,
  onRenameProject,
  onDeleteProject,
  onOpenTool,
  theme,
  setTheme,
  mobileOpen,
  onCloseMobile,
  user,
  onLogout,
}) {
  const [search, setSearch] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => (p.title || '').toLowerCase().includes(q));
  }, [projects, search]);

  const grouped = useMemo(() => groupProjects(filtered), [filtered]);

  function startRename(project) {
    setRenamingId(project.id);
    setRenameValue(project.title || '');
    setConfirmDeleteId(null);
  }

  function commitRename(project) {
    const trimmed = renameValue.trim();
    setRenamingId(null);
    if (trimmed && trimmed !== project.title) {
      onRenameProject(project.id, trimmed);
    }
  }

  return (
    <aside className={`sidebar chat-sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
      <div className="sidebar-top">
        <div className="sidebar-brand">
          <span className="brand-mark">
            <Sparkles strokeWidth={2.25} />
          </span>
          <div>
            <div className="brand-title">Research Assistant</div>
            <div className="brand-subtitle">AI Research Workspace</div>
          </div>
        </div>
        <button className="sidebar-close" onClick={onCloseMobile} aria-label="Close menu">
          <X size={18} />
        </button>
      </div>

      <button className="sidebar-cta" onClick={onNewResearch}>
        <Plus size={16} strokeWidth={2.5} />
        New Research
      </button>

      <div className="chat-search-row">
        <Search className="chat-search-icon" />
        <input
          className="field-input chat-search-input"
          placeholder="Search research..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <nav className="chat-list" aria-label="Research conversations">
        {loading && <div className="chat-list-loading muted-text">Loading chats...</div>}

        {!loading && filtered.length === 0 && (
          <div className="chat-list-empty muted-text">
            {search ? 'No conversations match your search.' : 'No research chats yet — start one above.'}
          </div>
        )}

        {!loading &&
          grouped.map(([label, list]) => (
            <div key={label} className="chat-list-group">
              <div className="chat-list-group-label">{label}</div>
              {list.map((p) => (
                <div
                  key={p.id}
                  className={`chat-list-item ${String(p.id) === String(currentProjectId) ? 'active' : ''}`}
                >
                  {renamingId === p.id ? (
                    <input
                      autoFocus
                      className="field-input chat-rename-input"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => commitRename(p)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(p);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                    />
                  ) : (
                    <button className="chat-list-item-title" onClick={() => onSelectProject(p.id)} title={p.title}>
                      {p.title || 'Untitled research'}
                    </button>
                  )}

                  <div className="chat-list-item-actions">
                    <button
                      className="chat-item-icon-btn"
                      title="Rename"
                      aria-label="Rename conversation"
                      onClick={() => startRename(p)}
                    >
                      <Pencil />
                    </button>
                    {confirmDeleteId === p.id ? (
                      <>
                        <button
                          className="chat-item-icon-btn chat-item-icon-danger"
                          title="Confirm delete"
                          aria-label={`Confirm delete of ${p.title || 'this conversation'}`}
                          onClick={() => {
                            setConfirmDeleteId(null);
                            onDeleteProject(p.id);
                          }}
                        >
                          Confirm?
                        </button>
                        <button
                          className="chat-item-icon-btn"
                          title="Cancel"
                          aria-label="Cancel delete"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          <X />
                        </button>
                      </>
                    ) : (
                      <button
                        className="chat-item-icon-btn"
                        title="Delete"
                        aria-label="Delete conversation"
                        onClick={() => setConfirmDeleteId(p.id)}
                      >
                        <Trash2 />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
      </nav>

      <div className="sidebar-tools">
        <div className="sidebar-tools-label">More tools</div>
        <nav className="sidebar-nav">
          <button className="sidebar-link sidebar-link-compact" onClick={() => onOpenTool('search')}>
            <span className="sidebar-icon"><Compass /></span> Ad-hoc Paper Search
          </button>
          <button className="sidebar-link sidebar-link-compact" onClick={() => onOpenTool('compare')}>
            <span className="sidebar-icon"><GitCompare /></span> Compare Papers
          </button>
          <button className="sidebar-link sidebar-link-compact" onClick={() => onOpenTool('notes')}>
            <span className="sidebar-icon"><NotebookPen /></span> Notes
          </button>
          <button className="sidebar-link sidebar-link-compact" onClick={() => onOpenTool('projects')}>
            <span className="sidebar-icon"><LayoutGrid /></span> All Research
          </button>
        </nav>
      </div>

      <div className="sidebar-footer">
        <ThemeToggle theme={theme} setTheme={setTheme} />
        {user && (
          <div className="sidebar-account">
            <div className="sidebar-account-avatar">{user.name ? user.name.charAt(0).toUpperCase() : '?'}</div>
            <div className="sidebar-account-meta">
              <div className="sidebar-account-name">{user.name}</div>
              <div className="sidebar-account-email">{user.email}</div>
            </div>
            {onLogout && (
              <button className="sidebar-account-logout" onClick={onLogout} title="Log out" aria-label="Log out">
                <LogOut />
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
