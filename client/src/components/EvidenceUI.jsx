import React from 'react';

const TYPE_LABELS = {
  source_supported: 'Source-supported',
  ai_interpretation: 'AI interpretation',
  ai_suggestion: 'AI suggestion',
};

// Labels every analytical point as one of three kinds of evidence, per the
// app's core grounding rule: source-supported fact vs. AI interpretation
// vs. AI suggestion are never presented interchangeably.
export function TypeBadge({ type }) {
  const label = TYPE_LABELS[type] || 'AI interpretation';
  const cls =
    type === 'source_supported'
      ? 'evidence-source'
      : type === 'ai_suggestion'
      ? 'evidence-suggestion'
      : 'evidence-interpretation';
  return <span className={`badge evidence-badge ${cls}`}>{label}</span>;
}

// Renders [1] [2]-style clickable reference chips back to the selected
// sources that support a given point.
export function SourceChips({ indices, onOpenSource }) {
  const list = Array.isArray(indices) ? indices.filter((n) => Number.isInteger(n)) : [];
  if (list.length === 0) return null;
  return (
    <span className="source-chips">
      {list.map((idx) => (
        <button key={idx} type="button" className="source-chip" onClick={() => onOpenSource(idx)}>
          [{idx}]
        </button>
      ))}
    </span>
  );
}

// A titled block that shows the standard "Not available in the provided
// source material." empty state when there's nothing genuine to show.
export function Section({ title, empty, children }) {
  return (
    <div className="intelligence-section">
      <h3>{title}</h3>
      {empty ? <p className="muted-text">Not available in the provided source material.</p> : children}
    </div>
  );
}

// Compact list of the sources an analysis was run against, each opening
// the shared PaperPreviewModal when clicked.
export function SourceReferenceList({ sources, onOpenSource }) {
  if (!sources || sources.length === 0) return null;
  return (
    <div className="intelligence-section">
      <h3>Selected Sources ({sources.length})</h3>
      <ol className="source-reference-list">
        {sources.map((s) => (
          <li key={s.index}>
            <button type="button" className="link-button" onClick={() => onOpenSource(s.index)}>
              [{s.index}] {s.title}
            </button>
            <span className="muted-text">
              {' '}
              {(Array.isArray(s.authors) ? s.authors : []).slice(0, 3).join(', ') || 'Authors not available'}
              {s.publicationYear ? ` \u2022 ${s.publicationYear}` : ''}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
