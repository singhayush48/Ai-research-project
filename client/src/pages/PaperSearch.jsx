import React, { useState } from 'react';
import { Search as SearchIcon, Bookmark, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../services/api.js';
import Loading from '../components/Loading.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import EmptyState from '../components/EmptyState.jsx';

export default function PaperSearch({ navigate }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [savedIds, setSavedIds] = useState(new Set());

  async function runSearch(e, targetPage = 1) {
    if (e) e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.searchPapers(query.trim(), targetPage);
      setResults(data);
      setPage(targetPage);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(paper) {
    try {
      await api.savePaper({ openalexPaper: paper });
      setSavedIds((prev) => new Set(prev).add(paper.openalexId));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <h1 className="page-title">Search Academic Papers</h1>
      <p className="page-subtitle">Powered by the OpenAlex open academic index.</p>

      <form className="search-bar" onSubmit={(e) => runSearch(e, 1)}>
        <input
          className="field-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. generative AI in software engineering education"
        />
        <button className="btn btn-primary" type="submit" disabled={loading}>
          <SearchIcon /> {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {error && <ErrorBanner message={error} />}
      {loading && <Loading label="Searching OpenAlex..." />}

      {!loading && results && results.results.length === 0 && (
        <EmptyState title="No results found" description="Try a different or broader search term." />
      )}

      {!loading && results && results.results.length > 0 && (
        <>
          <p className="muted-text">
            About {results.totalCount.toLocaleString()} results &middot; Page {results.page} of {results.totalPages}
          </p>
          <div className="paper-list">
            {results.results.map((paper) => (
              <div className="paper-result-card" key={paper.openalexId}>
                <h3
                  className="link-title"
                  onClick={() => navigate('paperDetail', { id: paper.openalexId, openalexPaper: paper })}
                >
                  {paper.title}
                </h3>
                <p className="muted-text">
                  {(paper.authors || []).slice(0, 5).join(', ') || 'Authors not available'}
                  {paper.publicationYear ? ` \u2022 ${paper.publicationYear}` : ''}
                  {paper.sourceName ? ` \u2022 ${paper.sourceName}` : ''}
                </p>
                {paper.abstract && <p className="abstract-preview">{paper.abstract.slice(0, 260)}...</p>}
                <div className="card-actions">
                  <button
                    className="btn btn-secondary btn-small"
                    onClick={() => navigate('paperDetail', { id: paper.openalexId, openalexPaper: paper })}
                  >
                    View Details
                  </button>
                  <button
                    className="btn btn-primary btn-small"
                    disabled={savedIds.has(paper.openalexId)}
                    onClick={() => handleSave(paper)}
                  >
                    <Bookmark /> {savedIds.has(paper.openalexId) ? 'Saved' : 'Save Paper'}
                  </button>
                  {paper.doi && (
                    <a className="btn btn-ghost btn-small" href={paper.paperUrl} target="_blank" rel="noreferrer">
                      DOI
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="pagination">
            <button
              className="btn btn-ghost btn-small"
              disabled={page <= 1}
              onClick={() => runSearch(null, page - 1)}
            >
              <ChevronLeft /> Previous
            </button>
            <span>
              Page {page} of {results.totalPages}
            </span>
            <button
              className="btn btn-ghost btn-small"
              disabled={page >= results.totalPages}
              onClick={() => runSearch(null, page + 1)}
            >
              Next <ChevronRight />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
