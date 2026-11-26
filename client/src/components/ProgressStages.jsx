import React from 'react';
import { Check } from 'lucide-react';
import { STAGES } from '../constants/research.js';

// Reusable journey indicator: Define -> Discover -> Analyze -> Gaps -> Plan -> Create.
// Purely presentational; `currentStage` decides which steps read as
// done/active/upcoming. `onSelect`, if provided, makes completed/active
// steps clickable (used by the project workspace to jump between tabs).
export default function ProgressStages({ currentStage = 'define', onSelect }) {
  const currentIndex = Math.max(
    0,
    STAGES.findIndex((s) => s.key === currentStage)
  );

  return (
    <div className="progress-stages" role="list" aria-label="Research journey progress">
      {STAGES.map((s, i) => {
        const state = i < currentIndex ? 'done' : i === currentIndex ? 'active' : 'upcoming';
        const clickable = Boolean(onSelect) && i <= currentIndex;
        return (
          <div
            key={s.key}
            role="listitem"
            className={`progress-stage progress-stage-${state} ${clickable ? 'is-clickable' : ''}`}
            onClick={clickable ? () => onSelect(s.key) : undefined}
            title={s.label}
          >
            <span className="progress-stage-dot">{state === 'done' ? <Check strokeWidth={3} /> : i + 1}</span>
            <span className="progress-stage-label">{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}
