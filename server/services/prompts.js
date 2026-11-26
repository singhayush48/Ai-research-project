// Prompt builders. Every prompt here is deliberately restrictive: the model
// is only ever given the exact paper metadata retrieved from OpenAlex (or
// entered by the user), told explicitly not to invent facts, and told to
// reply with a fixed JSON shape so the frontend can render it reliably.

const BASE_RULES = `You are an academic research assistant. You must strictly follow these rules:
1. Use ONLY the information provided to you in the "SOURCE MATERIAL" section below. Do not use outside knowledge about the paper, the authors, or the topic.
2. Never invent paper titles, author names, journal names, DOIs, years, URLs, statistics, or quotes.
3. If a requested piece of information is not present in the SOURCE MATERIAL, respond with exactly this string for that field: "Not available in the provided source material."
4. Clearly separate facts that are directly stated in the source from your own interpretation. Anything you infer or synthesize must be labeled as AI interpretation, not presented as a direct statement from the paper.
5. Respond with ONLY valid JSON matching the requested shape. No markdown, no commentary, no code fences.`;

// Abstracts are capped so 20-30 selected sources can't blow past a small
// model's context window (the usual cause of empty / truncated / failed
// responses on larger selections).
const MAX_ABSTRACT_CHARS = 1800;

function formatPaperForPrompt(paper) {
  const abstract = paper.abstract
    ? paper.abstract.length > MAX_ABSTRACT_CHARS
      ? `${paper.abstract.slice(0, MAX_ABSTRACT_CHARS)}...`
      : paper.abstract
    : null;
  return [
    `Title: ${paper.title || 'Not available in the provided source material.'}`,
    `Authors: ${(paper.authors && paper.authors.join(', ')) || 'Not available in the provided source material.'}`,
    `Publication Year: ${paper.publicationYear || paper.publication_year || 'Not available in the provided source material.'}`,
    `Source/Journal: ${paper.sourceName || paper.source_name || 'Not available in the provided source material.'}`,
    `DOI: ${paper.doi || 'Not available in the provided source material.'}`,
    `Abstract: ${abstract || 'Not available in the provided source material.'}`,
  ].join('\n');
}

function buildAnalyzePrompt(paper) {
  const system = BASE_RULES;
  const prompt = `SOURCE MATERIAL (single paper):
${formatPaperForPrompt(paper)}

TASK: Produce a structured analysis of this paper as JSON with exactly this shape:
{
  "executiveSummary": string,
  "researchProblem": string,
  "researchObjectives": string,
  "methodology": string,
  "datasetOrSetup": string,
  "mainFindings": string,
  "contributions": string,
  "limitations": string,
  "futureWork": string,
  "importantConcepts": string[]
}
Remember: only the abstract and metadata above are available to you — most papers' full methodology/dataset/results detail will NOT be in an abstract, so use "Not available in the provided source material." generously and honestly rather than guessing.`;
  return { system, prompt };
}

function buildComparePrompt(papers) {
  const system = BASE_RULES;
  const papersBlock = papers
    .map((p, i) => `--- PAPER ${i + 1} ---\n${formatPaperForPrompt(p)}`)
    .join('\n\n');

  const prompt = `SOURCE MATERIAL (${papers.length} papers, compare ONLY these):
${papersBlock}

TASK: Compare these papers as JSON with exactly this shape:
{
  "perPaperSummary": [ { "paperIndex": number, "researchQuestion": string, "methodology": string, "dataset": string, "findings": string, "contributions": string, "limitations": string } ],
  "similarities": string[],
  "differences": string[],
  "contradictions": string[],
  "researchGaps": string[],
  "futureOpportunities": string[]
}
paperIndex must match the 1-based PAPER numbers above. Do not reference or compare against any paper not listed here.`;
  return { system, prompt };
}

function buildResearchGapPrompt(papers) {
  const system = BASE_RULES;
  const papersBlock = papers
    .map((p, i) => `--- PAPER ${i + 1} ---\n${formatPaperForPrompt(p)}`)
    .join('\n\n');

  const prompt = `SOURCE MATERIAL (${papers.length} papers):
${papersBlock}

TASK: Based ONLY on these papers, produce a research-gap analysis as JSON:
{
  "commonThemes": string[],
  "underResearchedAreas": string[],
  "methodologicalLimitations": string[],
  "conflictingFindings": string[],
  "missingDatasets": string[],
  "futureDirections": string[],
  "disclaimer": "These are AI-generated analytical suggestions based on a limited set of papers, not established academic facts."
}`;
  return { system, prompt };
}

function buildDraftPrompt({ projectTitle, researchQuestion, papers }) {
  const system = BASE_RULES;
  const papersBlock = papers
    .map(
      (p, i) =>
        `--- SOURCE [${i + 1}] ---\n${formatPaperForPrompt(p)}\nOpenAlex/DOI reference: ${
          p.doi || p.paperUrl || p.paper_url || 'Not available in the provided source material.'
        }`
    )
    .join('\n\n');

  const prompt = `PROJECT TITLE: ${projectTitle || 'Not available in the provided source material.'}
RESEARCH QUESTION: ${researchQuestion || 'Not available in the provided source material.'}

SOURCE MATERIAL (${papers.length} papers — these are the ONLY sources you may cite):
${papersBlock}

TASK: Generate a structured research draft as JSON with exactly this shape:
{
  "introduction": string,
  "background": string,
  "literatureReview": string,
  "comparativeAnalysis": string,
  "researchGap": string,
  "proposedResearchDirection": string,
  "conclusion": string,
  "references": [ { "sourceIndex": number, "title": string, "authors": string, "year": string, "doiOrUrl": string } ]
}
CRITICAL: The "references" array must ONLY contain the sources listed above (using their exact title/authors/year/DOI as given), in the same order as sourceIndex [1..${papers.length}]. Never invent a reference that is not in SOURCE MATERIAL. When citing a claim in the body text, refer to sources using their bracketed index, e.g. "[1]".`;
  return { system, prompt };
}

// Used by the "Help me formulate my research question" onboarding action.
// Unlike the other prompts, there is no paper source material here — this
// is brainstorming help on the user's own idea, not a claim about academic
// literature — so we still forbid inventing citations/statistics, but the
// strict "Not available in the provided source material." rule doesn't apply.
function buildResearchQuestionPrompt({ topic, objective, researchType }) {
  const system = `You are an academic research assistant helping a student turn a rough research idea into a focused, answerable research question. Do not invent facts, citations, statistics, or sources. Respond with ONLY valid JSON matching the requested shape — no markdown, no commentary, no code fences.`;

  const prompt = `RESEARCH TOPIC: ${topic}
RESEARCH OBJECTIVE: ${objective || 'Not provided.'}
RESEARCH TYPE: ${researchType || 'Not provided.'}

TASK: Suggest 3 well-formed, specific, and answerable research questions for this topic (varying in scope/angle so the student has real choices), plus one short tip on what makes a strong research question. Respond as JSON with exactly this shape:
{
  "questions": string[],
  "tip": string
}`;
  return { system, prompt };
}

// Powers "Analyze Selected Sources" in the project workspace: the
// project's own topic/question/objective plus its selected papers' metadata
// and abstracts. Every analytical point must carry a "sources" array of
// 1-based indices into the SOURCE list (so the frontend can render "[1]"-
// style reference chips) and a "type" flag distinguishing what's directly
// stated in a source from what the AI is synthesizing or suggesting.
function buildResearchIntelligencePrompt({ projectTitle, researchQuestion, researchObjective, papers }) {
  const system = BASE_RULES;
  const sourcesBlock = papers
    .map((p, i) => `--- SOURCE [${i + 1}] ---\n${formatPaperForPrompt(p)}`)
    .join('\n\n');

  const prompt = `PROJECT TOPIC: ${projectTitle || 'Not available in the provided source material.'}
RESEARCH QUESTION: ${researchQuestion || 'Not available in the provided source material.'}
RESEARCH OBJECTIVE: ${researchObjective || 'Not available in the provided source material.'}

SELECTED SOURCES (${papers.length} — the ONLY sources you may reference, using the bracketed numbers [1]-[${papers.length}] that match the SOURCE labels above):
${sourcesBlock}

TASK: Produce a "Research Intelligence" analysis of these selected sources, in the context of the project topic/question/objective above, as JSON with exactly this shape:
{
  "executiveSummary": { "text": string, "type": "ai_interpretation", "sources": number[] },
  "keyThemes": [ { "theme": string, "description": string, "type": "source_supported" | "ai_interpretation", "sources": number[] } ],
  "mainFindings": [ { "finding": string, "type": "source_supported", "sources": number[] } ],
  "methodologies": [ { "method": string, "type": "source_supported", "sources": number[] } ],
  "similarities": [ { "point": string, "type": "source_supported" | "ai_interpretation", "sources": number[] } ],
  "differences": [ { "point": string, "type": "source_supported" | "ai_interpretation", "sources": number[] } ],
  "contradictions": [ { "point": string, "type": "source_supported" | "ai_interpretation", "sources": number[] } ],
  "limitations": [ { "point": string, "type": "source_supported", "sources": number[] } ],
  "futureDirections": [ { "suggestion": string, "type": "ai_suggestion", "sources": number[] } ],
  "disclaimer": "This analysis is AI-generated from the abstracts and metadata of the selected sources only. It may be incomplete and does not replace reading the original papers."
}

RULES FOR THIS TASK:
- Every "sources" array must only contain integers between 1 and ${papers.length}, referencing the SOURCE numbers above. Use an empty array [] when a point is a synthesis across everything (not tied to specific sources) or is a suggestion.
- Use "type": "source_supported" ONLY when the point is directly stated in a source's abstract/metadata above. Use "ai_interpretation" when you are synthesizing or inferring across sources. Use "ai_suggestion" ONLY inside futureDirections.
- If nothing genuine can be said for an entire category (e.g. no methodology detail appears in any abstract), return an empty array [] for that category. Do not pad a category with "Not available in the provided source material." entries — just leave the array empty.
- Never invent findings, statistics, methodology details, dataset names, citations, author claims, DOIs, or quotes that are not present in the SELECTED SOURCES above.`;
  return { system, prompt };
}

// Powers the Gaps tab's "Identify Research Gaps" action. Builds on the same
// SOURCE [n] referencing convention as buildResearchIntelligencePrompt so
// the frontend can reuse the same reference-chip UI. Kept separate from
// the older buildResearchGapPrompt (still used by the standalone Compare
// page) rather than changing that working prompt's output shape.
function buildResearchGapAnalysisPrompt({ projectTitle, researchQuestion, researchObjective, papers, priorIntelligence }) {
  const system = BASE_RULES;
  const sourcesBlock = papers
    .map((p, i) => `--- SOURCE [${i + 1}] ---\n${formatPaperForPrompt(p)}`)
    .join('\n\n');

  const priorBlock = priorIntelligence
    ? `\nPRIOR AI ANALYSIS OF THESE SAME SOURCES (for context — build on this, don't just repeat it):\n${JSON.stringify(
        priorIntelligence
      )}\n`
    : '';

  const prompt = `PROJECT TOPIC: ${projectTitle || 'Not available in the provided source material.'}
RESEARCH QUESTION: ${researchQuestion || 'Not available in the provided source material.'}
RESEARCH OBJECTIVE: ${researchObjective || 'Not available in the provided source material.'}

SELECTED SOURCES (${papers.length} — the ONLY sources you may reference, using the bracketed numbers [1]-[${papers.length}]):
${sourcesBlock}
${priorBlock}
TASK: Identify research gaps in this literature, in the context of the project's topic/question/objective, as JSON with exactly this shape:
{
  "underExploredAreas": [ { "point": string, "type": "source_supported" | "ai_interpretation", "sources": number[] } ],
  "methodologicalGaps": [ { "point": string, "type": "source_supported" | "ai_interpretation", "sources": number[] } ],
  "conflictingFindings": [ { "point": string, "type": "source_supported" | "ai_interpretation", "sources": number[] } ],
  "missingContexts": [ { "point": string, "type": "ai_interpretation", "sources": number[] } ],
  "suggestedResearchQuestions": [ { "question": string, "type": "ai_suggestion", "sources": number[] } ],
  "disclaimer": "These are AI-generated analytical suggestions based on a limited set of selected sources, not established academic facts."
}

RULES FOR THIS TASK:
- Every "sources" array must only contain integers between 1 and ${papers.length}. Use [] for points that are a broad synthesis or a suggestion not tied to a specific source.
- Use "type": "source_supported" ONLY when a source directly states a limitation/gap itself (e.g. its own "future work" or "limitations" section). Use "ai_interpretation" when you are inferring the gap by comparing sources. Use "ai_suggestion" ONLY inside suggestedResearchQuestions.
- If a category genuinely doesn't apply, return an empty array [] for it rather than inventing content.
- Never invent findings, statistics, methodology details, or citations not present in the SELECTED SOURCES above.`;
  return { system, prompt };
}

// Powers the Research Plan tab. Deliberately built on TOP OF the gap
// analysis (reused, not recomputed) — a plan is inherently AI guidance, not
// literature fact, so most fields don't carry per-item source chips, but
// "suggestedMethodology" may reference sources that inspired it.
function buildResearchPlanPrompt({ projectTitle, researchQuestion, researchObjective, researchType, papers, gaps }) {
  const system = BASE_RULES;
  const sourcesBlock = papers
    .map((p, i) => `--- SOURCE [${i + 1}] ---\n${formatPaperForPrompt(p)}`)
    .join('\n\n');

  const prompt = `PROJECT TOPIC: ${projectTitle || 'Not available in the provided source material.'}
RESEARCH QUESTION: ${researchQuestion || 'Not available in the provided source material.'}
RESEARCH OBJECTIVE: ${researchObjective || 'Not available in the provided source material.'}
RESEARCH TYPE: ${researchType || 'Not available in the provided source material.'}

SELECTED SOURCES (${papers.length}, referenced as [1]-[${papers.length}]):
${sourcesBlock}

PREVIOUSLY IDENTIFIED RESEARCH GAPS (JSON, produced from these same sources — build the plan around these):
${JSON.stringify(gaps)}

TASK: Produce a concrete research plan as JSON with exactly this shape:
{
  "refinedResearchQuestion": string,
  "objectives": string[],
  "suggestedMethodology": { "text": string, "sources": number[] },
  "milestones": [ { "title": string, "description": string } ],
  "risks": string[],
  "disclaimer": "This research plan is AI-generated guidance based on your project and identified research gaps. Review and adapt it — it is a suggestion, not an established methodology."
}

RULES FOR THIS TASK:
- Every field here is AI-generated planning guidance, not a claim about the literature — do not present it as established fact.
- "suggestedMethodology.sources" may reference [1]-[${papers.length}] if a specific source's methodology inspired the suggestion; otherwise use [].
- Keep "milestones" realistic for a student research project (typically 4-6 steps).
- Never invent citations, datasets, or statistics attributed to a specific source that isn't in SELECTED SOURCES above.`;
  return { system, prompt };
}

// Powers the Research Copilot chat. Unlike the other prompts, the reply is
// conversational plain text (not JSON) — but the same grounding rules
// apply: only the PROJECT CONTEXT below, [n] references to selected
// sources, explicit "Not available..." when asked about something the
// context doesn't cover, and the model must stay on-topic for this project
// rather than behaving like a generic chatbot.
function buildCopilotPrompt({ project, papers, intelligence, gaps, plan, notes, history }) {
  const system = `You are the "Research Copilot" inside an AI Research Assistant app, scoped to ONE specific research project. You must:
1. Answer using ONLY the PROJECT CONTEXT below (topic, question, objective, selected sources, prior AI analysis, research gaps, research plan, and notes) plus ordinary reasoning about that context. Do not use outside knowledge about the specific papers beyond what's given here.
2. Never invent paper titles, authors, DOIs, statistics, findings, or quotes that are not present in the PROJECT CONTEXT.
3. When referencing a specific selected source, use its bracketed number, e.g. [1], matching the SELECTED SOURCES list below.
4. If the user asks something the PROJECT CONTEXT doesn't cover, say plainly: "Not available in the provided source material." Do not guess.
5. Clearly signal when you're giving your own interpretation or a suggestion, versus stating something directly supported by a source.
6. Stay focused on this project. If asked something unrelated to it, briefly say so and redirect to the research at hand rather than answering as a general-purpose assistant.
7. If the user's message is a broad or vague topic rather than a specific question or request (e.g. "Tell me about AI"), do NOT attempt to comprehensively cover it. Ask one short clarifying question about what aspect they want to focus on, optionally naming 2-3 possible angles grounded in the PROJECT CONTEXT. Do not launch into a large amount of content until the request is focused enough to answer well.
8. This message already went through an action router before reaching you, so if you're seeing it, the user was NOT clearly asking to search, analyze, find gaps, build a plan, or generate a draft — it's a genuine question or vague/exploratory message. If it does look like one of those requests but was ambiguous, you may gently ask whether they'd like you to run that action (e.g. "Want me to search the literature for that?").
Respond in plain, well-formatted text (short paragraphs and/or bullet points). Do NOT respond in JSON.`;

  const sourcesBlock = papers.length
    ? papers.map((p, i) => `[${i + 1}] ${formatPaperForPrompt(p)}`).join('\n\n')
    : 'No sources are selected for this project yet.';

  const contextParts = [
    `PROJECT TOPIC: ${project.title || 'Not available in the provided source material.'}`,
    `RESEARCH QUESTION: ${project.research_question || 'Not available in the provided source material.'}`,
    `RESEARCH OBJECTIVE: ${project.research_objective || 'Not available in the provided source material.'}`,
    `\nSELECTED SOURCES (${papers.length}):\n${sourcesBlock}`,
  ];
  if (intelligence) contextParts.push(`\nPRIOR AI ANALYSIS (Research Intelligence, JSON):\n${JSON.stringify(intelligence)}`);
  if (gaps) contextParts.push(`\nPRIOR RESEARCH GAP ANALYSIS (JSON):\n${JSON.stringify(gaps)}`);
  if (plan) contextParts.push(`\nPRIOR RESEARCH PLAN (JSON):\n${JSON.stringify(plan)}`);
  if (notes && notes.length) {
    contextParts.push(
      `\nUSER NOTES:\n${notes.map((n) => `- ${n.title ? n.title + ': ' : ''}${n.content}`).join('\n')}`
    );
  }

  const historyBlock = (history || [])
    .map((h) => `${h.role === 'user' ? 'User' : 'Copilot'}: ${h.content}`)
    .join('\n');

  const prompt = `PROJECT CONTEXT:
${contextParts.join('\n')}

CONVERSATION SO FAR:
${historyBlock}

Respond to the user's latest message above as the Research Copilot for this project.`;
  return { system, prompt };
}

module.exports = {
  formatPaperForPrompt,
  buildAnalyzePrompt,
  buildComparePrompt,
  buildResearchGapPrompt,
  buildDraftPrompt,
  buildResearchQuestionPrompt,
  buildResearchIntelligencePrompt,
  buildResearchGapAnalysisPrompt,
  buildResearchPlanPrompt,
  buildCopilotPrompt,
};
