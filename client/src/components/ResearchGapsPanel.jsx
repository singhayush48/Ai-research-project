import React from 'react';
import { TypeBadge, SourceChips, Section, SourceReferenceList } from './EvidenceUI.jsx';
import { asArray, asText } from '../utils/safe.js';

// Renders the Research Gap analysis: under-explored areas, methodological
// gaps, conflicting findings, missing contexts, and AI-suggested follow-up
// research questions — each labeled and referenced the same way as the
// Research Intelligence dashboard.
export default function ResearchGapsPanel({ gaps, sources, onOpenSource }) {
  const raw = gaps || {};
  const underExploredAreas = asArray(raw.underExploredAreas);
  const methodologicalGaps = asArray(raw.methodologicalGaps);
  const conflictingFindings = asArray(raw.conflictingFindings);
  const missingContexts = asArray(raw.missingContexts);
  const suggestedResearchQuestions = asArray(raw.suggestedResearchQuestions);
  const disclaimer = asText(raw.disclaimer);

  return (
    <div className="intelligence-dashboard">
      <Section title="Under-Explored Areas" empty={underExploredAreas.length === 0}>
        <ul className="intelligence-list">
          {underExploredAreas.map((g, i) => (
            <li key={i}>
              {asText(g.point)} <TypeBadge type={g.type} />{' '}
              <SourceChips indices={g.sources} onOpenSource={onOpenSource} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Methodological Gaps" empty={methodologicalGaps.length === 0}>
        <ul className="intelligence-list">
          {methodologicalGaps.map((g, i) => (
            <li key={i}>
              {asText(g.point)} <TypeBadge type={g.type} />{' '}
              <SourceChips indices={g.sources} onOpenSource={onOpenSource} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Conflicting Findings" empty={conflictingFindings.length === 0}>
        <ul className="intelligence-list">
          {conflictingFindings.map((g, i) => (
            <li key={i}>
              {asText(g.point)} <TypeBadge type={g.type} />{' '}
              <SourceChips indices={g.sources} onOpenSource={onOpenSource} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Missing Contexts / Populations" empty={missingContexts.length === 0}>
        <ul className="intelligence-list">
          {missingContexts.map((g, i) => (
            <li key={i}>
              {asText(g.point)} <TypeBadge type={g.type} />{' '}
              <SourceChips indices={g.sources} onOpenSource={onOpenSource} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Suggested Follow-Up Research Questions" empty={suggestedResearchQuestions.length === 0}>
        <p className="muted-text">AI-generated suggestions — starting points for your own research plan.</p>
        <ul className="intelligence-list">
          {suggestedResearchQuestions.map((g, i) => (
            <li key={i}>
              {asText(g.question)} <TypeBadge type={g.type || 'ai_suggestion'} />{' '}
              <SourceChips indices={g.sources} onOpenSource={onOpenSource} />
            </li>
          ))}
        </ul>
      </Section>

      {disclaimer && <p className="muted-text intelligence-disclaimer">{disclaimer}</p>}

      <SourceReferenceList sources={sources} onOpenSource={onOpenSource} />
    </div>
  );
}
