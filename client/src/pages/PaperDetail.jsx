import React, { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, Bookmark, X, FolderPlus, Sparkles } from 'lucide-react';
import { api } from '../services/api.js';
import Loading from '../components/Loading.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import SuccessMessage from '../components/SuccessMessage.jsx';
import { asArray, asText } from '../utils/safe.js';

export default function PaperDetail({ paperId, navigate }) {
  const [paper, setPaper] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState('');

  function load() {
    setLoading(true);
    setError('');
    api
      .getPaper(paperId)
      .then((data) => setPaper(data.paper))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));

    api.listProjects().then((data) => setProjects(asArray(data.projects))).catch(() => {});
  }

  useEffect(load, [paperId]);

  async function handleSave() {
    try {
      await api.savePaper({ paperId: paper.id });
      setMessage('Paper saved to your library.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRemoveSaved() {
    try {
      await api.removeSavedPaper(paper.id);
      setMessage('Paper removed from your saved list.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAddToProject() {
    if (!selectedProjectId) return;
    try {
      await api.addPaperToProject(selectedProjectId, { paperId: paper.id });
      setMessage('Paper added to project.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAnalyze() {
    setAnalyzeError('');
    setAnalyzing(true);
    setAnalysis(null);
    try {
      const data = await api.analyzePaper(paper.id);
      setAnalysis(data.analysis);
    } catch (err) {
      setAnalyzeError(err.message);
    } finally {
      setAnalyzing(false);
    }
  }

  if (loading) return <Loading label="Loading paper..." />;
  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!paper) return null;

  let authors = paper.authors;
  if (typeof authors === 'string') {
    try {
      authors = JSON.parse(authors);
    } catch {
      authors = [];
    }
  }

  return (
    <div className="page">
      <button className="link-button" onClick={() => navigate('search')}>
        <ArrowLeft size={14} style={{ verticalAlign: '-2px', marginRight: '0.3rem' }} /> Back to Search
      </button>
      <h1 className="page-title">{paper.title}</h1>
      <p className="muted-text">
        {(authors || []).join(', ') || 'Authors not available'}
        {paper.publication_year ? ` \u2022 ${paper.publication_year}` : ''}
        {paper.source_name ? ` \u2022 ${paper.source_name}` : ''}
      </p>
      {paper.doi && <p className="muted-text">DOI: {paper.doi}</p>}
      {paper.paper_url && (
        <a href={paper.paper_url} target="_blank" rel="noreferrer" className="link-button">
          View original source <ExternalLink size={13} style={{ verticalAlign: '-2px', marginLeft: '0.15rem' }} />
        </a>
      )}

      <SuccessMessage message={message} />

      <section className="panel">
        <h2>Abstract</h2>
        <p>{paper.abstract || 'Not available in the provided source.'}</p>
      </section>

      <section className="panel">
        <div className="card-actions">
          <button className="btn btn-primary btn-small" onClick={handleSave}>
            <Bookmark /> Save Paper
          </button>
          <button className="btn btn-ghost btn-small" onClick={handleRemoveSaved}>
            <X /> Remove Saved
          </button>
          <select
            className="field-input inline-select"
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
          >
            <option value="">Select a project...</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          <button className="btn btn-secondary btn-small" onClick={handleAddToProject} disabled={!selectedProjectId}>
            <FolderPlus /> Add to Project
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>AI Paper Analysis</h2>
          <button className="btn btn-primary btn-small" onClick={handleAnalyze} disabled={analyzing}>
            <Sparkles /> {analyzing ? 'Analyzing...' : 'Analyze with AI'}
          </button>
        </div>
        {analyzeError && <ErrorBanner message={analyzeError} />}
        {analysis && <AnalysisView analysis={analysis} />}
      </section>
    </div>
  );
}

function AnalysisView({ analysis }) {
  const rows = [
    ['Executive Summary', analysis.executiveSummary],
    ['Research Problem', analysis.researchProblem],
    ['Research Objectives', analysis.researchObjectives],
    ['Methodology', analysis.methodology],
    ['Dataset / Experimental Setup', analysis.datasetOrSetup],
    ['Main Findings', analysis.mainFindings],
    ['Contributions', analysis.contributions],
    ['Limitations', analysis.limitations],
    ['Future Work', analysis.futureWork],
  ];
  return (
    <div className="analysis-view">
      {rows.map(([label, value]) => (
        <div className="analysis-row" key={label}>
          <div className="analysis-label">{label}</div>
          <div className="analysis-value">{asText(value)}</div>
        </div>
      ))}
      {Array.isArray(analysis.importantConcepts) && analysis.importantConcepts.length > 0 && (
        <div className="analysis-row">
          <div className="analysis-label">Important Concepts</div>
          <div className="analysis-value">
            {analysis.importantConcepts.map((c, i) => (
              <span className="badge" key={`${i}-${asText(c)}`}>
                {asText(c)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
