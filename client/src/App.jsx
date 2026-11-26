import React, { useCallback, useEffect, useState } from 'react';
import { api } from './services/api.js';
import { useTheme } from './hooks/useTheme.js';
import ChatSidebar from './components/ChatSidebar.jsx';
import Topbar from './components/Topbar.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import ChatWorkspace from './pages/ChatWorkspace.jsx';
import Projects from './pages/Projects.jsx';
import PaperSearch from './pages/PaperSearch.jsx';
import PaperDetail from './pages/PaperDetail.jsx';
import Compare from './pages/Compare.jsx';
import Notes from './pages/Notes.jsx';

const VIEW_STORAGE_KEY = 'ai-research-assistant:view';

const TOOL_TITLES = {
  search: 'Ad-hoc Paper Search',
  compare: 'Compare Papers',
  notes: 'Notes',
  projects: 'All Research',
  paperDetail: 'Paper Detail',
};

function loadStoredView() {
  try {
    const raw = sessionStorage.getItem(VIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.name === 'string') return parsed;
  } catch {
    /* corrupt/unavailable storage — fall through to the default view */
  }
  return null;
}

// Simple, dependency-free client-side routing: a view object drives which
// page renders. No react-router — just React state + a navigate() callback
// passed down through props. The current view is mirrored to
// sessionStorage so a refresh returns the user to the same research chat
// instead of always bouncing back to the welcome screen.
export default function App() {
  const [theme, setTheme] = useTheme();
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [view, setView] = useState(() => loadStoredView() || { name: 'chat', params: {} });
  const [authMode, setAuthMode] = useState('login');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [contextMobileOpen, setContextMobileOpen] = useState(false);
  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(false);

  const navigate = useCallback((name, params = {}) => {
    const next = { name, params };
    setView(next);
    setMobileNavOpen(false);
    setContextMobileOpen(false);
    window.scrollTo(0, 0);
    try {
      // initialSuggestion is a one-shot handoff from the kickoff response —
      // never worth persisting across a refresh (the persisted assistant
      // message already covers it in plain-text form).
      const { initialSuggestion, ...persistable } = params;
      sessionStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify({ name, params: persistable }));
    } catch {
      /* non-critical: just means refresh won't restore this view */
    }
  }, []);

  const reloadProjects = useCallback(() => {
    setProjectsLoading(true);
    api
      .listProjects()
      .then((data) => setProjects(data.projects || []))
      .catch(() => {
        /* sidebar list is best-effort; the active chat still loads independently */
      })
      .finally(() => setProjectsLoading(false));
  }, []);

  useEffect(() => {
    api
      .me()
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true));
  }, []);

  // A 401 from any authenticated call (expired/revoked session) lands here:
  // return to the login screen instead of leaving every action failing.
  useEffect(() => {
    function onExpired() {
      setUser(null);
      setProjects([]);
    }
    window.addEventListener('auth-expired', onExpired);
    return () => window.removeEventListener('auth-expired', onExpired);
  }, []);

  // Load the sidebar list ONCE per login (it used to refetch on every single
  // navigation). Also validates a stale project id left in sessionStorage —
  // e.g. one belonging to another user — and falls back to the welcome screen.
  useEffect(() => {
    if (!user) return;
    let active = true;
    setProjectsLoading(true);
    api
      .listProjects()
      .then((data) => {
        if (!active) return;
        const nextProjects = data.projects || [];
        setProjects(nextProjects);
        if (view.name === 'chat' && view.params.id) {
          const ownsProject = nextProjects.some((project) => String(project.id) === String(view.params.id));
          if (!ownsProject) navigate('chat');
        }
      })
      .catch(() => {
        /* sidebar list is best-effort; the active chat still loads independently */
      })
      .finally(() => {
        if (active) setProjectsLoading(false);
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function handleLogout() {
    try {
      await api.logout();
    } finally {
      setUser(null);
      setProjects([]);
      try {
        sessionStorage.removeItem(VIEW_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      navigate('chat');
    }
  }

  async function handleRenameProject(id, title) {
    const existing = projects.find((p) => p.id === id);
    if (!existing) return;
    try {
      await api.updateProject(id, {
        title,
        researchQuestion: existing.research_question,
        description: existing.description,
        notes: existing.notes,
        researchObjective: existing.research_objective,
        researchType: existing.research_type,
        stage: existing.stage,
      });
      reloadProjects();
    } catch {
      /* best-effort rename; the sidebar simply keeps the old title on failure */
    }
  }

  async function handleDeleteProject(id) {
    if (!window.confirm('Delete this research chat? This cannot be undone.')) return;
    try {
      await api.deleteProject(id);
      if (view.name === 'chat' && String(view.params.id) === String(id)) {
        navigate('chat');
      }
      reloadProjects();
    } catch {
      /* best-effort; the item simply stays in the list if deletion failed */
    }
  }

  if (!authChecked) {
    return (
      <div className="app-loading-screen">
        <div className="spinner" />
        <p>Loading AI Research Assistant...</p>
      </div>
    );
  }

  if (!user) {
    return authMode === 'login' ? (
      <Login onLoggedIn={setUser} onSwitchToRegister={() => setAuthMode('register')} />
    ) : (
      <Register onRegistered={setUser} onSwitchToLogin={() => setAuthMode('login')} />
    );
  }

  const isChatView = view.name === 'chat';

  return (
    <div className={`app-shell ${isChatView ? 'app-shell-fixed' : ''}`}>
      <ChatSidebar
        projects={projects}
        loading={projectsLoading}
        currentProjectId={isChatView ? view.params.id : null}
        onSelectProject={(id) => navigate('chat', { id })}
        onNewResearch={() => navigate('chat', {})}
        onRenameProject={handleRenameProject}
        onDeleteProject={handleDeleteProject}
        onOpenTool={(name) => navigate(name)}
        theme={theme}
        setTheme={setTheme}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        user={user}
        onLogout={handleLogout}
      />
      {mobileNavOpen && <div className="sidebar-backdrop" onClick={() => setMobileNavOpen(false)} />}
      <div className="app-main">
        <Topbar
          onMenuClick={() => setMobileNavOpen((v) => !v)}
          title={isChatView ? '' : TOOL_TITLES[view.name] || ''}
        />
        <main className={`app-content ${isChatView ? 'app-content-chat' : ''}`}>
          {isChatView && (
            <ChatWorkspace
              projectId={view.params.id}
              initialSuggestion={view.params.initialSuggestion}
              onProjectMutated={reloadProjects}
              onOpenContextChange={setContextMobileOpen}
              contextMobileOpen={contextMobileOpen}
              navigate={navigate}
            />
          )}
          {view.name === 'projects' && <Projects navigate={navigate} onProjectMutated={reloadProjects} />}
          {view.name === 'search' && <PaperSearch navigate={navigate} />}
          {view.name === 'paperDetail' && (
            <PaperDetail paperId={view.params.id} openalexPaper={view.params.openalexPaper} navigate={navigate} />
          )}
          {view.name === 'compare' && <Compare navigate={navigate} />}
          {view.name === 'notes' && <Notes navigate={navigate} />}
        </main>
      </div>
    </div>
  );
}
