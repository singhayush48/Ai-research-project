import React from 'react';
import { Eye, Bookmark, Check, Plus, X as XIcon, ExternalLink } from 'lucide-react';
import { normalizePaper } from '../utils/paper.js';

// Displays only information actually present on the paper — never invents
// missing authors, years, DOIs, etc. Action buttons shown depend on which
// handlers the caller passes in (onSave/onSelect/onDeselect/onRemove are
// all optional), so this same card serves Discover results, Sources
// entries, and saved-papers lists.
function PaperCard({
  paper: rawPaper,
  isSelected = false,
  isSaved = false,
  isLinked = false,
  isAnalyzed = false,
  isNew = false,
  busy = false,
  onPreview,
  onSave,
  onSelect,
  onDeselect,
  onRemove,
}) {
  const paper = normalizePaper(rawPaper);
  const authors = paper.authors || [];
  const authorText = authors.slice(0, 5).join(', ') + (authors.length > 5 ? ', et al.' : '');
  const [expanded, setExpanded] = React.useState(false);
  const ABSTRACT_PREVIEW_LENGTH = 260;
  const abstractIsLong = (paper.abstract || '').length > ABSTRACT_PREVIEW_LENGTH;

  function handleTitleKeyDown(e) {
    if (!onPreview) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPreview();
    }
  }

  return (
    <div className={`card paper-card ${isSelected ? 'paper-card-selected' : ''} ${isNew ? 'paper-card-new' : ''}`}>
      <div className="paper-card-badges">
        {isSelected && <span className="badge badge-selected">Selected</span>}
        {isLinked && !isSelected && <span className="badge badge-linked">In project</span>}
        {isSaved && <span className="badge badge-saved">Saved</span>}
        {isAnalyzed && <span className="badge badge-analyzed">Analyzed</span>}
        {isNew && <span className="badge badge-new">New</span>}
        {paper.relevanceScore !== null && paper.relevanceScore !== undefined && (
          <span className="badge badge-muted" title="Relevance score reported by OpenAlex for this search">
            OpenAlex relevance
          </span>
        )}
      </div>

      <h3
        className="link-title"
        onClick={onPreview}
        onKeyDown={handleTitleKeyDown}
        role={onPreview ? 'button' : undefined}
        tabIndex={onPreview ? 0 : undefined}
        aria-label={onPreview ? `Preview paper: ${paper.title || 'Untitled'}` : undefined}
      >
        {paper.title || 'Untitled'}
      </h3>

      <p className="muted-text">
        {authorText || 'Authors not available'}
        {paper.publicationYear ? ` \u2022 ${paper.publicationYear}` : ''}
        {paper.sourceName ? ` \u2022 ${paper.sourceName}` : ''}
        {typeof paper.citedByCount === 'number' ? ` \u2022 ${paper.citedByCount} citations` : ''}
      </p>

      {paper.abstract ? (
        <p className="abstract-preview">
          {expanded || !abstractIsLong ? paper.abstract : `${paper.abstract.slice(0, ABSTRACT_PREVIEW_LENGTH)}...`}
          {abstractIsLong && (
            <button
              type="button"
              className="link-inline abstract-toggle"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              {expanded ? ' Show less' : ' Show more'}
            </button>
          )}
        </p>
      ) : (
        <p className="abstract-preview muted-text">No abstract available.</p>
      )}

      <div className="card-actions">
        {onPreview && (
          <button className="btn btn-secondary btn-small" onClick={onPreview}>
            <Eye /> Preview
          </button>
        )}

        {onSave && (
          <button className="btn btn-ghost btn-small" disabled={isSaved || busy} onClick={onSave}>
            <Bookmark /> {isSaved ? 'Saved' : 'Save'}
          </button>
        )}

        {onSelect && !isSelected && (
          <button className="btn btn-primary btn-small" disabled={busy} onClick={onSelect} aria-pressed="false">
            <Plus /> {busy ? 'Selecting...' : 'Select'}
          </button>
        )}
        {onDeselect && isSelected && (
          <button className="btn btn-secondary btn-small" disabled={busy} onClick={onDeselect} aria-pressed="true">
            <Check /> {busy ? 'Working...' : 'Selected'}
          </button>
        )}
        {onRemove && (
          <button className="btn btn-ghost btn-small" disabled={busy} onClick={onRemove}>
            <XIcon /> Remove
          </button>
        )}

        {paper.doi && (
          <a
            className="btn btn-ghost btn-small"
            href={paper.paperUrl || `https://doi.org/${paper.doi}`}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open paper "${paper.title || 'Untitled'}" in a new tab`}
          >
            <ExternalLink /> Open Paper
          </a>
        )}
        {!paper.doi && paper.paperUrl && (
          <a
            className="btn btn-ghost btn-small"
            href={paper.paperUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open paper "${paper.title || 'Untitled'}" in a new tab`}
          >
            <ExternalLink /> Open Paper
          </a>
        )}
      </div>
    </div>
  );
}

// Re-render only when something visible changed. The handler props are fresh
// closures on every parent render but always act on the same paper, so they
// are deliberately ignored — otherwise toggling ONE paper re-rendered every
// card in the conversation.
export default React.memo(
  PaperCard,
  (a, b) =>
    a.paper === b.paper &&
    a.isSelected === b.isSelected &&
    a.isSaved === b.isSaved &&
    a.isLinked === b.isLinked &&
    a.isAnalyzed === b.isAnalyzed &&
    a.isNew === b.isNew &&
    a.busy === b.busy &&
    Boolean(a.onSelect) === Boolean(b.onSelect) &&
    Boolean(a.onDeselect) === Boolean(b.onDeselect) &&
    Boolean(a.onRemove) === Boolean(b.onRemove)
);
