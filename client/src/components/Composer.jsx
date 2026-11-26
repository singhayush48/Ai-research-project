import React, { useState } from 'react';
import { ArrowUp, Search, Microscope, Sparkles, ClipboardList, FileText } from 'lucide-react';

export default function Composer({ onSendMessage, onQuickAction, busy, hasSelectedSources, hasGaps }) {
  const [text, setText] = useState('');

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setText('');
    onSendMessage(trimmed);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function runSearch() {
    onQuickAction('search', text.trim());
    setText('');
  }

  return (
    <div className="composer">
      <div className="composer-quick-actions">
        <button className="btn btn-ghost btn-small" disabled={busy} onClick={runSearch}>
          <Search /> Search Papers
        </button>
        <button className="btn btn-ghost btn-small" disabled={busy || !hasSelectedSources} onClick={() => onQuickAction('analyze')}>
          <Microscope /> Analyze Sources
        </button>
        <button className="btn btn-ghost btn-small" disabled={busy || !hasSelectedSources} onClick={() => onQuickAction('gaps')}>
          <Sparkles /> Find Gaps
        </button>
        <button className="btn btn-ghost btn-small" disabled={busy || !hasGaps} onClick={() => onQuickAction('plan')}>
          <ClipboardList /> Create Plan
        </button>
        <button className="btn btn-ghost btn-small" disabled={busy || !hasSelectedSources} onClick={() => onQuickAction('draft')}>
          <FileText /> Generate Draft
        </button>
      </div>
      <div className="composer-input-row">
        <textarea
          className="composer-input"
          rows={1}
          placeholder='Ask anything, or try "find papers about..." / "analyze the selected papers" / "what are the research gaps?"'
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={busy}
        />
        <button className="btn btn-primary composer-send-btn" onClick={submit} disabled={busy || !text.trim()} aria-label="Send message">
          <ArrowUp size={16} strokeWidth={2.5} />
        </button>
      </div>
      <p className="composer-hint">Enter to send &middot; Shift + Enter for a new line</p>
    </div>
  );
}
