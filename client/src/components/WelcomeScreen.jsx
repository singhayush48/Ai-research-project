import React, { useState } from 'react';
import { Sparkles, ArrowUp } from 'lucide-react';
import ErrorBanner from './ErrorBanner.jsx';

const SUGGESTED_PROMPTS = [
  'Find research on generative AI in programming education',
  'I want to investigate LLM hallucinations',
  'Help me find a research gap in computer vision',
  'Compare recent research on RAG systems',
];

// The "What's on your research agenda?" screen — shown when no research
// chat is selected yet. Starting here creates the chat (a research_projects
// row) and kicks off the first AI turn in one step (see api.kickoffResearch).
export default function WelcomeScreen({ onStart, starting, error }) {
  const [text, setText] = useState('');

  function submit(value) {
    const trimmed = (value ?? text).trim();
    if (!trimmed || starting) return;
    onStart(trimmed);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="welcome-screen">
      <div className="welcome-inner">
        <span className="welcome-kicker">
          <Sparkles /> AI-native research workspace
        </span>
        <h1 className="welcome-title">What's on your research agenda?</h1>
        <p className="welcome-subtitle">
          Tell me what you want to investigate. I'll help you find the literature, understand it,
          identify gaps, plan your research, and create drafts.
        </p>

        {error && <ErrorBanner message={error} />}

        <div className="welcome-composer">
          <textarea
            className="field-input welcome-textarea"
            rows={3}
            placeholder="Describe your research topic or question..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={starting}
            autoFocus
          />
          <button
            className="btn btn-primary btn-large welcome-send-btn"
            onClick={() => submit()}
            disabled={starting || !text.trim()}
          >
            {starting ? 'Starting...' : 'Start researching'}
            {!starting && <ArrowUp size={16} strokeWidth={2.5} />}
          </button>
        </div>

        <div className="welcome-suggestions">
          {SUGGESTED_PROMPTS.map((p) => (
            <button
              key={p}
              type="button"
              className="btn btn-secondary btn-small welcome-suggestion-chip"
              disabled={starting}
              onClick={() => submit(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
