import React from 'react';
import { X, Minus, Trash2 } from 'lucide-react';
import ProgressStages from './ProgressStages.jsx';
import { RESEARCH_TYPE_LABELS } from '../constants/research.js';
import { normalizePaper } from '../utils/paper.js';

export default function ResearchContextPanel({
  project,
  papers,
  selectionOverrides,
  hasIntelligence,
  hasGaps,
  hasPlan,
  hasDraft,
  onPreviewPaper,
  onDeselectPaper,
  onRemovePaper,
  onQuickAction,
  actionsBusy,
  mobileOpen,
  onCloseMobile,
}) {
  if (!project) return null;

  const discovered = papers.length;
  const selected = papers.filter((p) => {
    const override = selectionOverrides.get(p.id);
    return override === undefined ? p.selected_for_analysis : override;
  });

  const hasSelected = selected.length > 0;

  return (
    <>
      {mobileOpen && <div className="context-panel-backdrop" onClick={onCloseMobile} />}
      <aside className={`research-context-panel ${mobileOpen ? 'context-panel-open' : ''}`}>
        <div className="context-panel-header">
          <h3>Research context</h3>
          <button className="sidebar-close context-panel-close" onClick={onCloseMobile} aria-label="Close panel">
            <X size={18} />
          </button>
        </div>

        <div className="context-panel-section">
          <div className="context-field-label">Topic</div>
          <p className="context-field-value">{project.title}</p>
          <div className="context-field-label">Research question</div>
          <p className="context-field-value">
            {project.research_question || <span className="muted-text">Not yet defined</span>}
          </p>
          {project.research_type && (
            <span className="badge">{RESEARCH_TYPE_LABELS[project.research_type] || project.research_type}</span>
          )}
        </div>

        <div className="context-panel-section">
          <div className="context-field-label">Sources</div>
          <p className="context-field-value">
            {discovered} discovered &bull; {selected.length} selected
          </p>
        </div>

        <div className="context-panel-section">
          <div className="context-field-label">Progress</div>
          <ProgressStages currentStage={project.stage || 'define'} />
        </div>

        <div className="context-panel-section">
          <div className="context-field-label">Quick actions</div>
          <div className="context-quick-actions">
            <button
              className="btn btn-secondary btn-small btn-full"
              disabled={!hasSelected || actionsBusy}
              title={!hasSelected ? 'Select sources to analyze them.' : undefined}
              onClick={() => onQuickAction('analyze')}
            >
              Analyze sources
            </button>
            <button
              className="btn btn-secondary btn-small btn-full"
              disabled={!hasSelected || actionsBusy}
              title={!hasSelected ? 'Select sources first, then find research gaps.' : undefined}
              onClick={() => onQuickAction('gaps')}
            >
              Find gaps
            </button>
            <button
              className="btn btn-secondary btn-small btn-full"
              disabled={!hasGaps || actionsBusy}
              title={!hasGaps ? 'Create a research plan from your identified gaps — find gaps first.' : undefined}
              onClick={() => onQuickAction('plan')}
            >
              Create plan
            </button>
            <button
              className="btn btn-secondary btn-small btn-full"
              disabled={!hasSelected || actionsBusy}
              title={!hasSelected ? 'Select sources to generate a literature review from them.' : undefined}
              onClick={() => onQuickAction('draft')}
            >
              Generate literature review
            </button>
          </div>
        </div>

        <div className="context-panel-section context-selected-sources">
          <div className="context-field-label">Selected sources ({selected.length})</div>
          {selected.length === 0 ? (
            <p className="muted-text">Select sources to analyze them.</p>
          ) : (
            <ul className="context-source-list">
              {selected.map((p) => {
                const normalized = normalizePaper(p);
                return (
                  <li key={p.id}>
                    <button className="link-button context-source-title" onClick={() => onPreviewPaper(normalized)}>
                      {normalized.title}
                    </button>
                    <div className="context-source-actions">
                      <button className="chat-item-icon-btn" title="Deselect" aria-label={`Deselect ${normalized.title}`} onClick={() => onDeselectPaper(p.id)}>
                        <Minus />
                      </button>
                      <button className="chat-item-icon-btn" title="Remove from project" aria-label={`Remove ${normalized.title} from project`} onClick={() => onRemovePaper(p.id)}>
                        <Trash2 />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}
