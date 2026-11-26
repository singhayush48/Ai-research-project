import React from 'react';
import { TypeBadge, SourceChips, Section, SourceReferenceList } from './EvidenceUI.jsx';
import { asArray, asText } from '../utils/safe.js';

// Renders the full Research Intelligence dashboard produced by "Analyze
// Selected Sources". Every category clearly labels each point as
// source-supported evidence, AI interpretation, or AI suggestion, and shows
// [n] reference chips back to the selected sources that support it.
export default function ResearchIntelligencePanel({ intelligence, sources, onOpenSource }) {
  const raw = intelligence || {};
  const executiveSummary = raw.executiveSummary && typeof raw.executiveSummary === 'object' ? raw.executiveSummary : { text: asText(raw.executiveSummary) };
  const keyThemes = asArray(raw.keyThemes);
  const mainFindings = asArray(raw.mainFindings);
  const methodologies = asArray(raw.methodologies);
  const similarities = asArray(raw.similarities);
  const differences = asArray(raw.differences);
  const contradictions = asArray(raw.contradictions);
  const limitations = asArray(raw.limitations);
  const futureDirections = asArray(raw.futureDirections);
  const disclaimer = asText(raw.disclaimer);

  return (
    <div className="intelligence-dashboard">
      <Section title="Executive Summary" empty={!executiveSummary || !executiveSummary.text}>
        {executiveSummary && executiveSummary.text && (
          <p>
            {asText(executiveSummary.text)} <TypeBadge type={executiveSummary.type} />{' '}
            <SourceChips indices={executiveSummary.sources} onOpenSource={onOpenSource} />
          </p>
        )}
      </Section>

      <Section title="Key Themes" empty={keyThemes.length === 0}>
        <ul className="intelligence-list">
          {keyThemes.map((t, i) => (
            <li key={i}>
              <strong>{asText(t.theme)}</strong> <TypeBadge type={t.type} />{' '}
              <SourceChips indices={t.sources} onOpenSource={onOpenSource} />
              {asText(t.description) && <p>{asText(t.description)}</p>}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Main Findings" empty={mainFindings.length === 0}>
        <ul className="intelligence-list">
          {mainFindings.map((f, i) => (
            <li key={i}>
              {asText(f.finding)} <TypeBadge type={f.type} />{' '}
              <SourceChips indices={f.sources} onOpenSource={onOpenSource} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Methodologies" empty={methodologies.length === 0}>
        <ul className="intelligence-list">
          {methodologies.map((m, i) => (
            <li key={i}>
              {asText(m.method)} <TypeBadge type={m.type} />{' '}
              <SourceChips indices={m.sources} onOpenSource={onOpenSource} />
            </li>
          ))}
        </ul>
      </Section>

      <div className="intelligence-grid-2">
        <Section title="Similarities" empty={similarities.length === 0}>
          <ul className="intelligence-list">
            {similarities.map((s, i) => (
              <li key={i}>
                {asText(s.point)} <TypeBadge type={s.type} />{' '}
                <SourceChips indices={s.sources} onOpenSource={onOpenSource} />
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Differences" empty={differences.length === 0}>
          <ul className="intelligence-list">
            {differences.map((d, i) => (
              <li key={i}>
                {asText(d.point)} <TypeBadge type={d.type} />{' '}
                <SourceChips indices={d.sources} onOpenSource={onOpenSource} />
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Section title="Contradictions" empty={contradictions.length === 0}>
        <ul className="intelligence-list">
          {contradictions.map((c, i) => (
            <li key={i}>
              {asText(c.point)} <TypeBadge type={c.type} />{' '}
              <SourceChips indices={c.sources} onOpenSource={onOpenSource} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Limitations" empty={limitations.length === 0}>
        <ul className="intelligence-list">
          {limitations.map((l, i) => (
            <li key={i}>
              {asText(l.point)} <TypeBadge type={l.type} />{' '}
              <SourceChips indices={l.sources} onOpenSource={onOpenSource} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Future Directions" empty={futureDirections.length === 0}>
        <p className="muted-text">AI-generated suggestions — not established findings from the sources.</p>
        <ul className="intelligence-list">
          {futureDirections.map((f, i) => (
            <li key={i}>
              {asText(f.suggestion)} <TypeBadge type={f.type || 'ai_suggestion'} />{' '}
              <SourceChips indices={f.sources} onOpenSource={onOpenSource} />
            </li>
          ))}
        </ul>
      </Section>

      {disclaimer && <p className="muted-text intelligence-disclaimer">{disclaimer}</p>}

      <SourceReferenceList sources={sources} onOpenSource={onOpenSource} />
    </div>
  );
}
