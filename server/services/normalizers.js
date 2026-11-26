// Coerces whatever JSON a (free / small) language model returns into the
// EXACT shapes the React UI renders. Models routinely return a string where
// an array was asked for, a bare string where an object was asked for,
// "sources" as "1, 2" or [99], etc. Without this layer a single sloppy
// response crashes the results panel ("x.map is not a function", "Objects
// are not valid as a React child"). Every normalizer is idempotent, so it is
// used both when a result is generated AND when old rows are read back from
// the database.

const DEFAULT_DISCLAIMERS = {
  intelligence:
    'This analysis is AI-generated from the abstracts and metadata of the selected sources only. It may be incomplete and does not replace reading the original papers.',
  gaps: 'These are AI-generated analytical suggestions based on a limited set of selected sources, not established academic facts.',
  plan: 'This research plan is AI-generated guidance based on your project and identified research gaps. Review and adapt it — it is a suggestion, not an established methodology.',
  legacyGaps: 'These are AI-generated analytical suggestions based on a limited set of papers, not established academic facts.',
};

const TEXT_KEYS = ['text', 'point', 'description', 'finding', 'method', 'theme', 'suggestion', 'question', 'title', 'name', 'summary', 'value', 'content'];

// Anything -> trimmed string ('' when nothing sensible can be made of it).
function str(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(str).filter(Boolean).join('; ');
  if (typeof value === 'object') {
    for (const key of TEXT_KEYS) {
      if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
    }
    const firstString = Object.values(value).find((v) => typeof v === 'string' && v.trim());
    return firstString ? firstString.trim() : '';
  }
  return '';
}

// Anything -> string[] (non-empty strings only). A single string is split on
// newlines / bullet markers so "1. a\n2. b" becomes two entries.
function strArray(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.map(str).filter(Boolean);
  if (typeof value === 'string') {
    const parts = value
      .split(/\r?\n+|\s*[•·]\s+/)
      .map((s) => s.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').trim())
      .filter(Boolean);
    return parts;
  }
  const s = str(value);
  return s ? [s] : [];
}

// Anything -> sorted unique integers in [1, max]. Out-of-range indices (the
// model citing "[99]" when only 3 sources exist) are dropped, because the UI
// turns each one into a clickable [n] chip that would open nothing.
function sourceIndices(value, max) {
  let raw = [];
  if (Array.isArray(value)) raw = value;
  else if (typeof value === 'number') raw = [value];
  else if (typeof value === 'string') raw = value.match(/\d+/g) || [];
  const out = new Set();
  for (const item of raw) {
    const n = typeof item === 'number' ? item : parseInt(String(item).replace(/[^\d]/g, ''), 10);
    if (Number.isInteger(n) && n >= 1 && (!max || n <= max)) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

const EVIDENCE_TYPES = ['source_supported', 'ai_interpretation', 'ai_suggestion'];
function evidenceType(value, fallback) {
  const v = typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
  return EVIDENCE_TYPES.includes(v) ? v : fallback;
}

// [ {<textKey>, type, sources} ] — accepts plain strings, objects using a
// different text key, a single object, or a string with several lines.
function pointList(value, textKey, { defaultType, max, forceType = false } = {}) {
  let items = value;
  if (items === null || items === undefined) return [];
  if (typeof items === 'string') items = strArray(items);
  if (!Array.isArray(items)) items = [items];
  const out = [];
  for (const item of items) {
    const text = str(typeof item === 'object' && item && item[textKey] !== undefined ? item[textKey] : item);
    if (!text) continue;
    const obj = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
    out.push({
      [textKey]: text,
      type: forceType ? defaultType : evidenceType(obj.type, defaultType),
      sources: sourceIndices(obj.sources, max),
    });
  }
  return out;
}

function normalizeIntelligence(raw, nSources) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const summarySrc = r.executiveSummary;
  const summaryObj = summarySrc && typeof summarySrc === 'object' && !Array.isArray(summarySrc) ? summarySrc : {};
  const themesRaw = Array.isArray(r.keyThemes) ? r.keyThemes : r.keyThemes ? [r.keyThemes] : [];

  return {
    executiveSummary: {
      text: str(typeof summarySrc === 'string' ? summarySrc : summaryObj.text ?? summarySrc),
      type: 'ai_interpretation',
      sources: sourceIndices(summaryObj.sources, nSources),
    },
    keyThemes: themesRaw
      .map((t) => {
        const obj = t && typeof t === 'object' && !Array.isArray(t) ? t : {};
        const theme = str(typeof t === 'string' ? t : obj.theme ?? obj.title ?? obj.name);
        if (!theme) return null;
        return {
          theme,
          description: str(obj.description),
          type: evidenceType(obj.type, 'ai_interpretation'),
          sources: sourceIndices(obj.sources, nSources),
        };
      })
      .filter(Boolean),
    mainFindings: pointList(r.mainFindings, 'finding', { defaultType: 'source_supported', max: nSources }),
    methodologies: pointList(r.methodologies, 'method', { defaultType: 'source_supported', max: nSources }),
    similarities: pointList(r.similarities, 'point', { defaultType: 'ai_interpretation', max: nSources }),
    differences: pointList(r.differences, 'point', { defaultType: 'ai_interpretation', max: nSources }),
    contradictions: pointList(r.contradictions, 'point', { defaultType: 'ai_interpretation', max: nSources }),
    limitations: pointList(r.limitations, 'point', { defaultType: 'source_supported', max: nSources }),
    futureDirections: pointList(r.futureDirections, 'suggestion', { defaultType: 'ai_suggestion', max: nSources, forceType: true }),
    disclaimer: DEFAULT_DISCLAIMERS.intelligence,
  };
}

function intelligenceHasContent(n) {
  return Boolean(
    n.executiveSummary.text ||
      n.keyThemes.length || n.mainFindings.length || n.methodologies.length ||
      n.similarities.length || n.differences.length || n.contradictions.length ||
      n.limitations.length || n.futureDirections.length
  );
}

function normalizeGaps(raw, nSources) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    underExploredAreas: pointList(r.underExploredAreas, 'point', { defaultType: 'ai_interpretation', max: nSources }),
    methodologicalGaps: pointList(r.methodologicalGaps, 'point', { defaultType: 'ai_interpretation', max: nSources }),
    conflictingFindings: pointList(r.conflictingFindings, 'point', { defaultType: 'ai_interpretation', max: nSources }),
    missingContexts: pointList(r.missingContexts, 'point', { defaultType: 'ai_interpretation', max: nSources, forceType: true }),
    suggestedResearchQuestions: pointList(r.suggestedResearchQuestions, 'question', { defaultType: 'ai_suggestion', max: nSources, forceType: true }),
    disclaimer: DEFAULT_DISCLAIMERS.gaps,
  };
}

function gapsHaveContent(n) {
  return Boolean(
    n.underExploredAreas.length || n.methodologicalGaps.length || n.conflictingFindings.length ||
      n.missingContexts.length || n.suggestedResearchQuestions.length
  );
}

function normalizePlan(raw, nSources) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const methodSrc = r.suggestedMethodology;
  const methodObj = methodSrc && typeof methodSrc === 'object' && !Array.isArray(methodSrc) ? methodSrc : {};
  const milestonesRaw = Array.isArray(r.milestones) ? r.milestones : r.milestones ? strArray(r.milestones) : [];

  return {
    refinedResearchQuestion: str(r.refinedResearchQuestion),
    objectives: strArray(r.objectives),
    suggestedMethodology: {
      text: str(typeof methodSrc === 'string' ? methodSrc : methodObj.text ?? methodSrc),
      sources: sourceIndices(methodObj.sources, nSources),
    },
    milestones: milestonesRaw
      .map((m) => {
        const obj = m && typeof m === 'object' && !Array.isArray(m) ? m : {};
        const title = str(typeof m === 'string' ? m : obj.title ?? obj.name ?? obj.milestone);
        if (!title) return null;
        return { title, description: str(obj.description) };
      })
      .filter(Boolean),
    risks: strArray(r.risks),
    disclaimer: DEFAULT_DISCLAIMERS.plan,
  };
}

function planHasContent(n) {
  return Boolean(n.refinedResearchQuestion || n.objectives.length || n.suggestedMethodology.text || n.milestones.length);
}

const DRAFT_SECTION_KEYS = [
  'introduction',
  'background',
  'literatureReview',
  'comparativeAnalysis',
  'researchGap',
  'proposedResearchDirection',
  'conclusion',
];

// Body text of a draft section: strings stay as-is, arrays become paragraphs.
function sectionText(value) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(sectionText).filter(Boolean).join('\n\n');
  return str(value);
}

// References are rebuilt from the real papers rather than trusted from the
// model: the prompt rules forbid invented references, and this makes that
// guarantee structural instead of hoping the model obeyed.
function buildReferences(papers) {
  return papers.map((p, i) => ({
    sourceIndex: i + 1,
    title: p.title || 'Untitled',
    authors: Array.isArray(p.authors) ? p.authors.join(', ') : str(p.authors),
    year: p.publicationYear ? String(p.publicationYear) : '',
    doiOrUrl: p.doi || p.paperUrl || '',
  }));
}

function normalizeDraft(raw, papers) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const key of DRAFT_SECTION_KEYS) out[key] = sectionText(r[key]);
  out.references = buildReferences(papers || []);
  return out;
}

function draftHasContent(n) {
  return DRAFT_SECTION_KEYS.filter((k) => n[k]).length >= 3;
}

// Single-paper analysis (PaperDetail page).
const ANALYSIS_KEYS = [
  'executiveSummary',
  'researchProblem',
  'researchObjectives',
  'methodology',
  'datasetOrSetup',
  'mainFindings',
  'contributions',
  'limitations',
  'futureWork',
];
const NOT_AVAILABLE = 'Not available in the provided source material.';
function normalizePaperAnalysis(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const key of ANALYSIS_KEYS) out[key] = sectionText(r[key]) || NOT_AVAILABLE;
  out.importantConcepts = strArray(r.importantConcepts).slice(0, 15);
  return out;
}

// Ad-hoc compare (Compare page + chat "compare papers 1 and 2").
function normalizeComparison(raw, nPapers) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const rows = (Array.isArray(r.perPaperSummary) ? r.perPaperSummary : [])
    .map((row, i) => {
      const obj = row && typeof row === 'object' ? row : {};
      const idx = Number.isInteger(Number(obj.paperIndex)) && Number(obj.paperIndex) >= 1 ? Number(obj.paperIndex) : i + 1;
      return {
        paperIndex: idx,
        researchQuestion: str(obj.researchQuestion),
        methodology: str(obj.methodology),
        dataset: str(obj.dataset),
        findings: str(obj.findings),
        contributions: str(obj.contributions),
        limitations: str(obj.limitations),
      };
    })
    .filter((row) => row.paperIndex <= (nPapers || Infinity));
  return {
    perPaperSummary: rows,
    similarities: strArray(r.similarities),
    differences: strArray(r.differences),
    contradictions: strArray(r.contradictions),
    researchGaps: strArray(r.researchGaps),
    futureOpportunities: strArray(r.futureOpportunities),
  };
}

function comparisonHasContent(n) {
  return Boolean(n.perPaperSummary.length || n.similarities.length || n.differences.length || n.contradictions.length);
}

// Older standalone "Research Gap Analysis" (Compare page).
function normalizeLegacyGaps(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    commonThemes: strArray(r.commonThemes),
    underResearchedAreas: strArray(r.underResearchedAreas),
    methodologicalLimitations: strArray(r.methodologicalLimitations),
    conflictingFindings: strArray(r.conflictingFindings),
    missingDatasets: strArray(r.missingDatasets),
    futureDirections: strArray(r.futureDirections),
    disclaimer: DEFAULT_DISCLAIMERS.legacyGaps,
  };
}

function legacyGapsHaveContent(n) {
  return Object.entries(n).some(([k, v]) => Array.isArray(v) && v.length > 0);
}

// "What's on your research agenda?" kickoff suggestion.
function normalizeSuggestion(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const questions = strArray(r.questions)
    .map((q) => q.replace(/^["“]|["”]$/g, '').trim())
    .filter((q) => q.length > 8)
    .slice(0, 3);
  return { questions, tip: str(r.tip) || 'A strong research question is specific, answerable with available evidence, and narrow enough to investigate.' };
}

// Used when READING stored rows back (timeline / GET endpoints): rows saved
// by earlier versions may have malformed shapes, and must never crash the UI.
function normalizeStoredResult(kind, content, nSources) {
  if (kind === 'research_intelligence') return normalizeIntelligence(content, nSources);
  if (kind === 'research_gap') return normalizeGaps(content, nSources);
  if (kind === 'research_plan') return normalizePlan(content, nSources);
  return content;
}

module.exports = {
  normalizeStoredResult,
  str,
  strArray,
  sourceIndices,
  normalizeIntelligence,
  intelligenceHasContent,
  normalizeGaps,
  gapsHaveContent,
  normalizePlan,
  planHasContent,
  normalizeDraft,
  draftHasContent,
  normalizePaperAnalysis,
  normalizeComparison,
  comparisonHasContent,
  normalizeLegacyGaps,
  legacyGapsHaveContent,
  normalizeSuggestion,
  buildReferences,
};
