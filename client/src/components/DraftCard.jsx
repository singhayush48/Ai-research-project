import React, { useState } from 'react';
import { Pencil, Copy, Check, Download, RotateCcw } from 'lucide-react';
import { SourceReferenceList } from './EvidenceUI.jsx';
import { asArray, asText } from '../utils/safe.js';

const SECTIONS = [
  ['introduction', '1. Introduction'],
  ['background', '2. Background'],
  ['literatureReview', '3. Literature Review'],
  ['comparativeAnalysis', '4. Comparative Analysis'],
  ['researchGap', '5. Research Gap'],
  ['proposedResearchDirection', '6. Proposed Research Direction'],
  ['conclusion', '7. Conclusion'],
];

function draftToPlainText(draft, sources) {
  const parts = [];
  for (const [key, label] of SECTIONS) {
    if (asText(draft[key])) parts.push(`${label}\n\n${asText(draft[key])}`);
  }
  if (asArray(draft.references).length > 0) {
    parts.push(
      'References\n\n' +
        draft.references
          .map((r) => `[${r.sourceIndex}] ${asText(r.title)} — ${asText(r.authors)} (${asText(r.year)}). ${asText(r.doiOrUrl)}`.trim())
          .join('\n')
    );
  } else if (sources && sources.length > 0) {
    parts.push(
      'References\n\n' +
        sources.map((s) => `[${s.index}] ${s.title} — ${asArray(s.authors).join(', ')}`).join('\n')
    );
  }
  return parts.join('\n\n');
}

export default function DraftCard({ draft: rawDraft, sources, onOpenSource, onRegenerate, regenerating }) {
  const draft = rawDraft && typeof rawDraft === 'object' ? rawDraft : {};
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editedText, setEditedText] = useState('');

  function handleCopy() {
    const text = editing ? editedText : draftToPlainText(draft, sources);
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => {});
  }

  function handleExport() {
    const text = editing ? editedText : draftToPlainText(draft, sources);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'literature-review.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function startEditing() {
    setEditedText(draftToPlainText(draft, sources));
    setEditing(true);
  }

  return (
    <div className="card draft-card">
      <div className="draft-card-header">
        <h3>Literature Review Draft</h3>
      </div>

      {editing ? (
        <textarea
          className="field-input draft-edit-textarea"
          rows={18}
          value={editedText}
          onChange={(e) => setEditedText(e.target.value)}
        />
      ) : (
        <div className="draft-view">
          {SECTIONS.map(
            ([key, label]) =>
              asText(draft[key]) && (
                <div className="draft-section" key={key}>
                  <h3>{label}</h3>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{asText(draft[key])}</p>
                </div>
              )
          )}

          {asArray(draft.references).length > 0 && (
            <div className="draft-section">
              <h3>References</h3>
              <ol className="source-reference-list">
                {asArray(draft.references).map((r, i) => (
                  <li key={`${r.sourceIndex}-${i}`}>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => onOpenSource(r.sourceIndex)}
                    >
                      [{r.sourceIndex}] {asText(r.title)}
                    </button>
                    <span className="muted-text">
                      {' '}
                      {asText(r.authors)} {asText(r.year) ? `\u2022 ${asText(r.year)}` : ''}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      {asArray(draft.references).length === 0 && <SourceReferenceList sources={sources} onOpenSource={onOpenSource} />}

      <div className="card-actions">
        {editing ? (
          <button className="btn btn-secondary btn-small" onClick={() => setEditing(false)}>
            <Check /> Done editing
          </button>
        ) : (
          <button className="btn btn-secondary btn-small" onClick={startEditing}>
            <Pencil /> Edit
          </button>
        )}
        <button className="btn btn-ghost btn-small" onClick={handleCopy}>
          {copied ? <Check /> : <Copy />} {copied ? 'Copied!' : 'Copy'}
        </button>
        <button className="btn btn-ghost btn-small" onClick={handleExport}>
          <Download /> Export (.txt)
        </button>
        {onRegenerate && (
          <button className="btn btn-ghost btn-small" onClick={onRegenerate} disabled={regenerating}>
            <RotateCcw /> {regenerating ? 'Regenerating...' : 'Regenerate'}
          </button>
        )}
      </div>
    </div>
  );
}
