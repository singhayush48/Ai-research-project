import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { api } from '../services/api.js';
import Loading from '../components/Loading.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import EmptyState from '../components/EmptyState.jsx';

// `projectId`: when provided, scopes this view to a single project's notes
// (used as the Notes tab inside the project workspace). When omitted, this
// behaves as the original standalone "all notes" page reachable from the
// sidebar. `embedded` drops the page title/subtitle so it fits inside a
// workspace tab instead of a full page.
export default function Notes({ projectId, embedded = false }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editContent, setEditContent] = useState('');

  function load() {
    setLoading(true);
    api
      .listNotes(projectId)
      .then((data) => setNotes(data.notes))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [projectId]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!content.trim()) return;
    try {
      await api.createNote({ title: title || null, content, projectId: projectId || null });
      setContent('');
      setTitle('');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleUpdate(id) {
    try {
      await api.updateNote(id, { content: editContent });
      setEditingId(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this note?')) return;
    try {
      await api.deleteNote(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className={embedded ? '' : 'page'}>
      {!embedded && (
        <>
          <h1 className="page-title">Research Notes</h1>
          <p className="page-subtitle">General notes across all your research projects.</p>
        </>
      )}

      <form className="panel form-panel" onSubmit={handleCreate}>
        <label className="field-label">Title (optional)</label>
        <input className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} />
        <label className="field-label">Note</label>
        <textarea
          className="field-input"
          rows={3}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write a research note..."
        />
        <button className="btn btn-primary" type="submit">
          <Plus /> Add Note
        </button>
      </form>

      {loading && <Loading label="Loading notes..." />}
      {error && <ErrorBanner message={error} onRetry={load} />}

      {!loading && notes.length === 0 && <EmptyState title="No notes yet" />}

      {!loading && notes.length > 0 && (
        <div className="card-grid">
          {notes.map((n) => (
            <div className="card" key={n.id}>
              {n.title && <h3>{n.title}</h3>}
              {editingId === n.id ? (
                <>
                  <textarea
                    className="field-input"
                    rows={3}
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                  />
                  <div className="card-actions">
                    <button className="btn btn-primary btn-small" onClick={() => handleUpdate(n.id)}>
                      <Check /> Save
                    </button>
                    <button className="btn btn-ghost btn-small" onClick={() => setEditingId(null)}>
                      <X /> Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p>{n.content}</p>
                  <div className="card-meta">
                    <span className="muted-text">{new Date(n.updated_at).toLocaleString()}</span>
                  </div>
                  <div className="card-actions">
                    <button
                      className="btn btn-secondary btn-small"
                      onClick={() => {
                        setEditingId(n.id);
                        setEditContent(n.content);
                      }}
                    >
                      <Pencil /> Edit
                    </button>
                    <button className="btn btn-ghost btn-small" onClick={() => handleDelete(n.id)}>
                      <Trash2 /> Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
