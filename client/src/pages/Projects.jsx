import React, { useEffect, useState } from 'react';
import { Plus, MessageSquare, Trash2 } from 'lucide-react';
import { api } from '../services/api.js';
import Loading from '../components/Loading.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import EmptyState from '../components/EmptyState.jsx';

export default function Projects({ navigate, onProjectMutated }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', researchQuestion: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  function load() {
    setLoading(true);
    api
      .listProjects()
      .then((data) => setProjects(data.projects))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleCreate(e) {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      await api.createProject(form);
      setForm({ title: '', researchQuestion: '', description: '' });
      setShowForm(false);
      load();
      onProjectMutated && onProjectMutated();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this research project? This cannot be undone.')) return;
    try {
      await api.deleteProject(id);
      load();
      onProjectMutated && onProjectMutated();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <div className="page-header-row">
        <div>
          <h1 className="page-title">Research Projects</h1>
          <p className="page-subtitle">Organize your research questions, papers and notes.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
          {!showForm && <Plus size={15} strokeWidth={2.5} />}
          {showForm ? 'Cancel' : 'New Project'}
        </button>
      </div>

      {showForm && (
        <form className="panel form-panel" onSubmit={handleCreate}>
          {formError && <ErrorBanner message={formError} />}
          <label className="field-label">Project Title *</label>
          <input
            className="field-input"
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Impact of Generative AI on Software Engineering Education"
          />
          <label className="field-label">Research Question</label>
          <input
            className="field-input"
            value={form.researchQuestion}
            onChange={(e) => setForm({ ...form, researchQuestion: e.target.value })}
            placeholder="How is generative AI changing software engineering education?"
          />
          <label className="field-label">Description</label>
          <textarea
            className="field-input"
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Optional description of scope and goals"
          />
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'Creating...' : 'Create Project'}
          </button>
        </form>
      )}

      {loading && <Loading label="Loading projects..." />}
      {error && <ErrorBanner message={error} onRetry={load} />}

      {!loading && !error && projects.length === 0 && (
        <EmptyState
          title="No research projects yet"
          description="Create a project to start organizing papers, notes and AI analysis."
          actionLabel="New Project"
          onAction={() => setShowForm(true)}
        />
      )}

      {!loading && projects.length > 0 && (
        <div className="card-grid">
          {projects.map((p) => (
            <div className="card project-card" key={p.id}>
              <h3>{p.title}</h3>
              {p.research_question && <p className="muted-text">{p.research_question}</p>}
              <div className="card-meta">
                <span className="badge">{p.paper_count} papers</span>
                <span className="muted-text">Updated {new Date(p.updated_at).toLocaleDateString()}</span>
              </div>
              <div className="card-actions">
                <button className="btn btn-secondary btn-small" onClick={() => navigate('chat', { id: p.id })}>
                  <MessageSquare /> Open chat
                </button>
                <button className="btn btn-ghost btn-small" onClick={() => handleDelete(p.id)}>
                  <Trash2 /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
