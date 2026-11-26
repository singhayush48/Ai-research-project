import React from 'react';
import { SourceChips, Section, SourceReferenceList } from './EvidenceUI.jsx';
import { asArray, asText } from '../utils/safe.js';

// Renders the Research Plan. A plan is inherently AI-generated guidance
// (not literature fact), so it carries one prominent banner instead of a
// per-item badge — but methodology suggestions still show [n] references
// where a specific source inspired them.
export default function ResearchPlanPanel({ plan, sources, onOpenSource }) {
  const raw = plan || {};
  const refinedResearchQuestion = asText(raw.refinedResearchQuestion);
  const objectives = asArray(raw.objectives);
  const suggestedMethodology =
    raw.suggestedMethodology && typeof raw.suggestedMethodology === 'object' ? raw.suggestedMethodology : { text: asText(raw.suggestedMethodology) };
  const milestones = asArray(raw.milestones);
  const risks = asArray(raw.risks);
  const disclaimer = asText(raw.disclaimer);

  return (
    <div className="intelligence-dashboard">
      <div className="ai-suggestion-banner">
        This entire research plan is AI-generated guidance based on your project and its identified
        research gaps — review and adapt it yourself before acting on it.
      </div>

      <Section title="Refined Research Question" empty={!refinedResearchQuestion}>
        <p>{refinedResearchQuestion}</p>
      </Section>

      <Section title="Objectives" empty={objectives.length === 0}>
        <ul className="intelligence-list">
          {objectives.map((o, i) => (
            <li key={i}>{asText(o)}</li>
          ))}
        </ul>
      </Section>

      <Section title="Suggested Methodology" empty={!suggestedMethodology || !suggestedMethodology.text}>
        {suggestedMethodology && suggestedMethodology.text && (
          <p>
            {asText(suggestedMethodology.text)}{' '}
            <SourceChips indices={suggestedMethodology.sources} onOpenSource={onOpenSource} />
          </p>
        )}
      </Section>

      <Section title="Milestones" empty={milestones.length === 0}>
        <ol className="milestone-list">
          {milestones.map((m, i) => (
            <li key={i}>
              <strong>{asText(m.title) || asText(m)}</strong>
              {asText(m.description) && <p>{asText(m.description)}</p>}
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Risks / Things to Watch" empty={risks.length === 0}>
        <ul className="intelligence-list">
          {risks.map((r, i) => (
            <li key={i}>{asText(r)}</li>
          ))}
        </ul>
      </Section>

      {disclaimer && <p className="muted-text intelligence-disclaimer">{disclaimer}</p>}

      <SourceReferenceList sources={sources} onOpenSource={onOpenSource} />
    </div>
  );
}
