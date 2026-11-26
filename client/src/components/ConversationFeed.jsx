import React, { memo, useEffect, useRef, useState } from 'react';
import { Copy, Check, Microscope, Sparkles, ClipboardList } from 'lucide-react';
import PaperCard from './PaperCard.jsx';
import ResearchIntelligencePanel from './ResearchIntelligencePanel.jsx';
import ResearchGapsPanel from './ResearchGapsPanel.jsx';
import ResearchPlanPanel from './ResearchPlanPanel.jsx';
import DraftCard from './DraftCard.jsx';

function SearchEvent({ event, onPreview, onSelect, onDeselect, busyPaperId, selectionOverrides, newIds }) {
  return (
    <div className="conversation-event conversation-event-assistant">
      <div className="search-event-block">
        <div className="search-event-header">
          Searched the literature for <strong>&ldquo;{event.query}&rdquo;</strong> &mdash;{' '}
          {(event.papers || []).length} {(event.papers || []).length === 1 ? 'result' : 'results'}
        </div>
        {event.papers.length === 0 ? (
          <p className="muted-text">No papers found for this query. Try broadening your research question or using different keywords.</p>
        ) : (
          <div className="paper-card-grid">
            {event.papers.map((paper) => {
              const isSelected = selectionOverrides.has(paper.id)
                ? selectionOverrides.get(paper.id)
                : Boolean(paper.selectedForAnalysis);
              return (
                <PaperCard
                  key={`${event.id}-${paper.id}`}
                  paper={paper}
                  isSelected={isSelected}
                  isLinked
                  isNew={newIds ? newIds.has(paper.id) : false}
                  busy={busyPaperId === paper.id}
                  onPreview={() => onPreview(paper)}
                  onSelect={() => onSelect(paper.id)}
                  onDeselect={() => onDeselect(paper.id)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function AssistantTextMessage({ content }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard
      .writeText(content)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }

  return (
    <div className="assistant-message-group">
      <div className="copilot-message-bubble">{content}</div>
      <div className="assistant-message-actions">
        <button className="assistant-copy-btn" onClick={handleCopy} aria-label="Copy message">
          {copied ? <Check /> : <Copy />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

// Result cards are expensive to render (dozens of list items) and never
// change after creation, so they are memoized on their event object — typing,
// selecting a paper or a busy-indicator flip no longer re-renders them all.
const ResultEvent = memo(function ResultEvent({ event, onPreviewPaper, onRegenerateDraft, regeneratingDraft }) {
  const sources = Array.isArray(event.sources) ? event.sources : [];
  const open = (idx) => onPreviewPaper(sources[idx - 1]);

  if (event.type === 'intelligence') {
    return (
      <div className="conversation-event conversation-event-assistant">
        <div className="card research-result-card">
          <h3><Microscope size={16} style={{ verticalAlign: '-3px', marginRight: '0.4rem' }} />Research Intelligence</h3>
          <p className="muted-text">
            I analyzed your {sources.length} selected {sources.length === 1 ? 'source' : 'sources'}.
            Every point below is labeled as source-supported, an AI interpretation, or an AI suggestion.
          </p>
          <ResearchIntelligencePanel intelligence={event.content} sources={sources} onOpenSource={open} />
        </div>
      </div>
    );
  }
  if (event.type === 'gaps') {
    return (
      <div className="conversation-event conversation-event-assistant">
        <div className="card research-result-card">
          <h3><Sparkles size={16} style={{ verticalAlign: '-3px', marginRight: '0.4rem' }} />Research Gaps</h3>
          <p className="muted-text">Here are potential gaps I found across the selected literature.</p>
          <ResearchGapsPanel gaps={event.content} sources={sources} onOpenSource={open} />
        </div>
      </div>
    );
  }
  if (event.type === 'plan') {
    return (
      <div className="conversation-event conversation-event-assistant">
        <div className="card research-result-card">
          <h3><ClipboardList size={16} style={{ verticalAlign: '-3px', marginRight: '0.4rem' }} />Research Plan</h3>
          <ResearchPlanPanel plan={event.content} sources={sources} onOpenSource={open} />
        </div>
      </div>
    );
  }
  return (
    <div className="conversation-event conversation-event-assistant">
      <DraftCard
        draft={event.content}
        sources={sources}
        onOpenSource={open}
        onRegenerate={onRegenerateDraft}
        regenerating={regeneratingDraft}
      />
    </div>
  );
});

export default function ConversationFeed({
  events,
  selectionOverrides,
  busyPaperId,
  onPreviewPaper,
  onSelectPaper,
  onDeselectPaper,
  pendingLabel,
  suggestion,
  onUseSuggestedQuestion,
  regeneratingDraft,
  onRegenerateDraft,
}) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [events.length, pendingLabel, suggestion]);

  // Tracks which paper ids have already appeared in an earlier search-type
  // event, walking the conversation in order, so a later search (a
  // refinement, "show me the top 5", etc.) can visually distinguish
  // genuinely new papers from ones already surfaced earlier in this chat.
  const seenPaperIds = new Set();

  return (
    <div className="conversation-feed">
      {events.length === 0 && !pendingLabel && (
        <div className="conversation-empty muted-text">
          This is the start of your research conversation. Ask a question, or use a quick action below.
        </div>
      )}

      {events.map((event) => {
        if (event.type === 'user_message') {
          return (
            <div key={event.id} className="conversation-event conversation-event-user">
              <div className="copilot-message-bubble">{event.content}</div>
            </div>
          );
        }

        if (event.type === 'assistant_message') {
          return (
            <div key={event.id} className="conversation-event conversation-event-assistant">
              <AssistantTextMessage content={event.content} />
            </div>
          );
        }

        if (event.type === 'search') {
          // Only meaningful from the second search onward — every paper in
          // the very first search is trivially "new", so skip the badge
          // there to avoid noise.
          const isFirstSearch = seenPaperIds.size === 0;
          const newIds = isFirstSearch
            ? new Set()
            : new Set(event.papers.filter((p) => !seenPaperIds.has(p.id)).map((p) => p.id));
          event.papers.forEach((p) => seenPaperIds.add(p.id));
          return (
            <SearchEvent
              key={event.id}
              event={event}
              onPreview={onPreviewPaper}
              onSelect={onSelectPaper}
              onDeselect={onDeselectPaper}
              busyPaperId={busyPaperId}
              selectionOverrides={selectionOverrides}
              newIds={newIds}
            />
          );
        }

        if (['intelligence', 'gaps', 'plan', 'draft'].includes(event.type)) {
          return (
            <ResultEvent
              key={event.id}
              event={event}
              onPreviewPaper={onPreviewPaper}
              onRegenerateDraft={onRegenerateDraft}
              regeneratingDraft={regeneratingDraft}
            />
          );
        }

        return null;
      })}

      {suggestion && (
        <div className="conversation-event conversation-event-assistant">
          <div className="card suggested-questions-card">
            <h3>Pick a research question</h3>
            <ul className="suggested-questions-list">
              {(Array.isArray(suggestion.questions) ? suggestion.questions : []).map((q, i) => (
                <li key={i}>
                  <span>{q}</span>
                  <button className="btn btn-primary btn-small" onClick={() => onUseSuggestedQuestion(q)}>
                    Use this question
                  </button>
                </li>
              ))}
            </ul>
            {suggestion.tip && <p className="muted-text">{suggestion.tip}</p>}
          </div>
        </div>
      )}

      {pendingLabel && (
        <div className="conversation-event conversation-event-assistant">
          <div className="copilot-message-bubble copilot-typing-bubble">
            <span className="copilot-typing">
              <span /> <span /> <span />
            </span>
            <span className="pending-label-text">{pendingLabel}</span>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
