import React, { useEffect, useState } from 'react';
import { GitCompare, Sparkles } from 'lucide-react';
import { api } from '../services/api.js';
import Loading from '../components/Loading.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { asArray, asText } from '../utils/safe.js';

export default function Compare({ navigate }) {
  const [savedPapers, setSavedPapers] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [comparison, setComparison] = useState(null);
  const [gapAnalysis, setGapAnalysis] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyError, setBusyError] = useState('');

  useEffect(() => {
    api
      .listSavedPapers()
      .then((data) => setSavedPapers(asArray(data.papers)))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runCompare() {
    setBusyError('');
    setBusy(true);
    setComparison(null);
    try {
      const data = await api.comparePapers(Array.from(selected));
      setComparison(data.comparison);
    } catch (err) {
      setBusyError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function runGapAnalysis() {
    setBusyError('');
    setBusy(true);
    setGapAnalysis(null);
    try {
      const data = await api.researchGap(Array.from(selected));
      setGapAnalysis(data.gapAnalysis);
    } catch (err) {
      setBusyError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading label="Loading your saved papers..." />;
  if (error) return <ErrorBanner message={error} />;

  if (savedPapers.length === 0) {
    return (
      <div className="page">
        <h1 className="page-title">Compare Papers</h1>
        <EmptyState
          title="No saved papers yet"
          description="Save at least 2 papers to compare them."
          actionLabel="Search Papers"
          onAction={() => navigate('search')}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <h1 className="page-title">Compare Papers &amp; Research Gap Analysis</h1>
      <p className="page-subtitle">Select 2 or more saved papers to compare.</p>

      <div className="paper-checklist">
        {savedPapers.map((p) => (
          <label className="checklist-row" key={p.id}>
            <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
            <span>{p.title}</span>
          </label>
        ))}
      </div>

      <div className="card-actions">
        <button className="btn btn-primary" disabled={selected.size < 2 || busy} onClick={runCompare}>
          <GitCompare /> {busy ? 'Working...' : 'Compare Selected Papers'}
        </button>
        <button className="btn btn-secondary" disabled={selected.size < 2 || busy} onClick={runGapAnalysis}>
          <Sparkles /> {busy ? 'Working...' : 'Research Gap Analysis'}
        </button>
      </div>

      {busyError && <ErrorBanner message={busyError} />}

      {comparison && <ComparisonView comparison={comparison} />}
      {gapAnalysis && <GapView gapAnalysis={gapAnalysis} />}
    </div>
  );
}

function ListSection({ title, items }) {
  const list = asArray(items);
  if (list.length === 0) return null;
  return (
    <div className="panel">
      <h3>{title}</h3>
      <ul>
        {list.map((item, i) => (
          <li key={i}>{asText(item)}</li>
        ))}
      </ul>
    </div>
  );
}

function ComparisonView({ comparison }) {
  return (
    <div>
      <h2 className="section-heading">Comparison Results</h2>
      <div className="panel">
        <h3>Per-Paper Summary</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Research Question</th>
              <th>Methodology</th>
              <th>Findings</th>
              <th>Limitations</th>
            </tr>
          </thead>
          <tbody>
            {asArray(comparison.perPaperSummary).map((row, i) => (
              <tr key={`${row.paperIndex}-${i}`}>
                <td>{asText(row.paperIndex)}</td>
                <td>{asText(row.researchQuestion)}</td>
                <td>{asText(row.methodology)}</td>
                <td>{asText(row.findings)}</td>
                <td>{asText(row.limitations)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ListSection title="Similarities" items={comparison.similarities} />
      <ListSection title="Differences" items={comparison.differences} />
      <ListSection title="Contradictions" items={comparison.contradictions} />
      <ListSection title="Research Gaps" items={comparison.researchGaps} />
      <ListSection title="Future Opportunities" items={comparison.futureOpportunities} />
    </div>
  );
}

function GapView({ gapAnalysis }) {
  return (
    <div>
      <h2 className="section-heading">Research Gap Analysis</h2>
      <p className="ai-disclaimer">{asText(gapAnalysis.disclaimer)}</p>
      <ListSection title="Common Themes" items={gapAnalysis.commonThemes} />
      <ListSection title="Under-researched Areas" items={gapAnalysis.underResearchedAreas} />
      <ListSection title="Methodological Limitations" items={gapAnalysis.methodologicalLimitations} />
      <ListSection title="Conflicting Findings" items={gapAnalysis.conflictingFindings} />
      <ListSection title="Missing Datasets" items={gapAnalysis.missingDatasets} />
      <ListSection title="Future Directions" items={gapAnalysis.futureDirections} />
    </div>
  );
}
