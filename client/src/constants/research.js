// Shared constants for the research journey: Define -> Discover -> Analyze
// -> Gaps -> Plan -> Create. Kept in one place so the dashboard, onboarding
// wizard and project workspace all agree on stage keys/labels.

export const STAGES = [
  { key: 'define', label: 'Define' },
  { key: 'discover', label: 'Discover' },
  { key: 'analyze', label: 'Analyze' },
  { key: 'gaps', label: 'Gaps' },
  { key: 'plan', label: 'Plan' },
  { key: 'create', label: 'Create' },
];

export const STAGE_LABELS = STAGES.reduce((acc, s) => ({ ...acc, [s.key]: s.label }), {});

export const RESEARCH_TYPE_OPTIONS = [
  { value: 'literature_review', label: 'Literature Review', hint: 'Survey and synthesize existing work on a topic.' },
  { value: 'research_paper', label: 'Research Paper', hint: 'A focused paper answering a specific question.' },
  { value: 'final_year_project', label: 'Final Year Project', hint: 'A capstone/BTech-style applied project.' },
  { value: 'thesis_dissertation', label: 'Thesis / Dissertation', hint: 'A longer, in-depth research work.' },
  { value: 'research_proposal', label: 'Research Proposal', hint: 'A plan proposing research to be carried out.' },
  { value: 'general_research', label: 'General Research', hint: 'Open-ended exploration of a topic.' },
];

export const RESEARCH_TYPE_LABELS = RESEARCH_TYPE_OPTIONS.reduce(
  (acc, t) => ({ ...acc, [t.value]: t.label }),
  {}
);

// Builds a sensible default OpenAlex search query from a project's own
// fields, so the user never has to invent a search query from scratch to
// start discovering literature. Prefers the research question (most
// specific); falls back to the topic/title plus objective keywords.
export function buildDiscoverQuery(project) {
  if (!project) return '';
  if (project.research_question && project.research_question.trim()) {
    return project.research_question.trim();
  }
  return [project.title, project.research_objective].filter(Boolean).join(' ').trim();
}
