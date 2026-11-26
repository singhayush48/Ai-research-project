import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { normalizePaper } from '../utils/paper.js';

// Full-detail preview without leaving the Discover/Sources workflow. Closes
// on Escape or backdrop click. Only ever shows fields that are actually
// present on the paper.
export default function PaperPreviewModal({
  paper: rawPaper,
  isSelected = false,
  isSaved = false,
  isAnalyzed = false,
  busy = false,
  onClose,
  onSave,
  onSelect,
  onDeselect,
}) {
  const paper = normalizePaper(rawPaper);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const authors = paper.authors || [];

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal-panel paper-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-label={paper.title || 'Paper preview'}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close preview">
          <X />
        </button>

        <div className="paper-card-badges">
          {isSelected && <span className="badge badge-selected">Selected</span>}
          {isSaved && <span className="badge badge-saved">Saved</span>}
          {isAnalyzed && <span className="badge badge-analyzed">Analyzed</span>}
        </div>

        <h2 className="modal-title">{paper.title || 'Untitled'}</h2>

        <p className="muted-text">
          {authors.length > 0 ? authors.join(', ') : 'Authors not available'}
        </p>
        <p className="muted-text">
          {paper.sourceName || 'Source not available'}
          {paper.publicationYear ? ` \u2022 ${paper.publicationYear}` : ''}
          {typeof paper.citedByCount === 'number' ? ` \u2022 ${paper.citedByCount} citations` : ''}
        </p>

        <h3>Abstract</h3>
        <p>{paper.abstract || 'No abstract available for this paper.'}</p>

        <div className="modal-meta">
          {paper.doi && (
            <p>
              <strong>DOI:</strong> {paper.doi}
            </p>
          )}
          {paper.paperUrl && (
            <p>
              <a href={paper.paperUrl} target="_blank" rel="noreferrer">
                {paper.paperUrl}
              </a>
            </p>
          )}
          {!paper.doi && !paper.paperUrl && (
            <p className="muted-text">No external link available for this paper.</p>
          )}
        </div>

        <div className="card-actions" style={{ marginTop: '1rem' }}>
          {onSave && (
            <button className="btn btn-ghost btn-small" disabled={isSaved || busy} onClick={onSave}>
              {isSaved ? 'Saved' : 'Save paper'}
            </button>
          )}
          {onSelect && !isSelected && (
            <button className="btn btn-primary btn-small" disabled={busy} onClick={onSelect}>
              {busy ? 'Selecting...' : 'Select paper'}
            </button>
          )}
          {onDeselect && isSelected && (
            <button className="btn btn-secondary btn-small" disabled={busy} onClick={onDeselect}>
              {busy ? 'Working...' : 'Deselect'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
