// Natural-language intent router (Pass 6).
//
// Turns a free-text chat message into a structured intent so the same
// conversational composer that already supports explicit quick-action
// buttons (Search / Analyze / Gaps / Plan / Draft) can also be driven
// entirely by typing, per the Pass 6 spec: "the user should NOT have to
// learn which button performs which operation."
//
// This is deliberately rule-based (fast, free, deterministic, easy to
// extend) rather than a second AI call per message: research-assistant
// commands have a fairly small vocabulary ("find papers about...",
// "analyze the selected papers", "research gaps", "write a literature
// review", "select paper 3"...) and a regex/keyword classifier is more
// reliable than an LLM classifier for this, while being instant and free.
// Anything that doesn't clearly match a known action intent safely falls
// back to intent "chat" — the existing Research Copilot conversational
// reply — so ambiguous or exploratory messages ("Tell me about AI") never
// silently trigger an expensive action; see prompts.buildCopilotPrompt's
// clarifying-question instruction for how that case is handled.

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function extractNumbers(text) {
  // Only plausible source numbers: a 4-digit year ("published after 2021")
  // must never be read as "source 2021".
  const digits = (text.match(/\b\d{1,3}\b/g) || []).map((n) => parseInt(n, 10)).filter((n) => n >= 1);
  const words = [];
  const lower = text.toLowerCase();
  for (const [word, val] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) words.push(val);
  }
  return [...digits, ...words];
}

// Strips a leading command phrase ("find papers about", "search for
// studies on", ...) so what's left is just the topic to send to OpenAlex.
function extractSearchQuery(message) {
  let text = message.trim();
  const leadPatterns = [
    /^(please\s+)?(find|search( for)?|look for|look up|get me|show me|discover)\s+(more\s+)?(papers?|studies|literature|articles|research|sources)\s*(that are\s+)?(on|about|regarding|related to|for|into)?\s*/i,
    /^(please\s+)?(find|search( for)?|look for|look up|get me)\s+/i,
    /^(papers?|studies|literature|articles|research)\s+(on|about|regarding|related to)\s+/i,
  ];
  for (const re of leadPatterns) {
    if (re.test(text)) {
      text = text.replace(re, '').trim();
      break;
    }
  }
  return text.replace(/[.?!]+$/, '').trim();
}

const SEARCH_VERB = /\b(find|search|look for|look up|get me|discover)\b/i;
const PAPER_NOUN = /\b(papers?|studies|study|literature|articles|research|sources?)\b/i;
const TOPIC_PREPOSITION = /\b(papers?|studies|study|literature|articles|research)\b.*\b(about|on|regarding|related to|into)\b/i;
const REFINEMENT_PHRASES = /\b(published (after|before|between|in)|from \d{4}|since \d{4}|peer[- ]reviewed|open access)\b/i;
// A message that OPENS with an explicit search command ("search for X",
// "find X", "look up X") is an unambiguous search request even when it
// doesn't happen to say the word "papers" — e.g. "search for LLM
// programming learning outcomes". Checked as its own signal (rather than
// folded into SEARCH_VERB) so mid-sentence mentions of "find"/"search"
// elsewhere in a message don't trigger this on their own.
const STARTS_WITH_SEARCH_VERB = /^(please\s+)?(find|search( for)?|look for|look up|get me)\b/i;

const DRAFT_ACTION = /\b(write|draft|create|generate|compose|produce)\b/i;
const DRAFT_ARTIFACT = /\b(literature review|research proposal|proposal|introduction section|introduction|methodology section|methodology|report|paper draft|abstract)\b/i;
const TURN_INTO_REPORT = /\bturn\b.*\b(this|it|analysis|these)\b.*\breport\b/i;

const PLAN_RE = /\b(research plan|plan (my|the|this) research|methodology from|how should i conduct|conduct (this|the) research|build a (plan|methodology)|study design)\b/i;

const GAPS_RE = /\b(research gaps?|gaps? in the literature|literature (is |seems )?weak|not been studied|understudied|under-studied|research opportunit|what('s| is|s) missing|underexplored)\b/i;

// Verb forms only (US + UK spelling). The noun "analysis" is deliberately not
// matched on its own: "what does the analysis say about X?" is a question,
// not a request to re-run an expensive analysis.
const ANALYZE_RE = /\b(analy[sz]e|analy[sz]ing|(run|do|perform|start|give me) (an? |the )?analysis)\b/i;

const COMPARE_RE = /\bcompare\b/i;

const SHOW_SELECTED_RE = /\b(show|list|what are|which)\b.*\b(selected|my sources|the sources|current sources)\b/i;

const REMOVE_RE = /\b(remove|deselect|drop|unselect|delete)\b/i;
const SELECT_RE = /\b(select|use only|use just|keep only|use)\b/i;
const EXCLUSIVE_RE = /\b(use only|only use|keep only|just use)\b/i;

const SIMILAR_RE = /\b(similar to|like paper|like source|more like)\b/i;

const TOP_N_RE = /\b(top|most relevant|best|highest[- ]cited)\b/i;

function classifyIntent(rawMessage) {
  const message = (rawMessage || '').trim();
  const lower = message.toLowerCase();
  const numbers = extractNumbers(message);

  if (!message) return { intent: 'chat' };

  // --- Research plan (before draft: "create a research plan and
  //     methodology" must not be mistaken for a literature-review draft) --
  if (PLAN_RE.test(lower)) {
    return { intent: 'plan' };
  }

  // --- Draft generation ---------------------------------------------
  if ((DRAFT_ACTION.test(lower) && DRAFT_ARTIFACT.test(lower)) || TURN_INTO_REPORT.test(lower)) {
    return { intent: 'draft', sourceNumbers: numbers.length ? numbers : null };
  }

  // --- Research gaps -----------------------------------------------
  if (GAPS_RE.test(lower)) {
    return { intent: 'gaps' };
  }

  // --- Compare (checked before analyze so "compare" never falls into
  //     the generic "analyze" bucket) ---------------------------------
  if (COMPARE_RE.test(lower) && numbers.length >= 2) {
    return { intent: 'compare', sourceNumbers: numbers.slice(0, 2) };
  }

  // --- Analyze selected sources ---------------------------------------
  if (ANALYZE_RE.test(lower)) {
    return { intent: 'analyze' };
  }

  // --- Show currently selected sources ---------------------------------
  if (SHOW_SELECTED_RE.test(lower)) {
    return { intent: 'show_selected' };
  }

  // --- Remove / deselect specific sources -----------------------------
  if (REMOVE_RE.test(lower) && PAPER_NOUN.test(lower) && numbers.length) {
    return { intent: 'deselect', sourceNumbers: numbers };
  }

  // --- Find more papers similar to a given one -------------------------
  if (SIMILAR_RE.test(lower) && numbers.length >= 1) {
    return { intent: 'find_similar', sourceNumbers: [numbers[0]] };
  }

  // --- Select / use-only specific sources -------------------------------
  if (SELECT_RE.test(lower) && PAPER_NOUN.test(lower) && numbers.length) {
    return {
      intent: 'select',
      sourceNumbers: numbers,
      exclusive: EXCLUSIVE_RE.test(lower),
    };
  }

  // --- Rank/filter current results: "show me the 5 most relevant papers" -
  if (TOP_N_RE.test(lower) && /\b(papers?|studies|articles|sources?)\b/i.test(lower) && !/\b(how|why|what|which)\b.*\b(best|top)\b.*\b(method|approach|way|practice)/i.test(lower)) {
    const n = numbers.find((x) => x >= 1 && x <= 50) || 5;
    return { intent: 'top_n', count: n };
  }

  // --- New / refinement literature search -------------------------------
  const looksLikeSearch =
    (SEARCH_VERB.test(lower) && PAPER_NOUN.test(lower)) ||
    TOPIC_PREPOSITION.test(lower) ||
    REFINEMENT_PHRASES.test(lower) ||
    STARTS_WITH_SEARCH_VERB.test(message);

  if (looksLikeSearch) {
    const extracted = extractSearchQuery(message);
    const wordCount = extracted.split(/\s+/).filter(Boolean).length;
    return {
      intent: 'search',
      query: extracted || message,
      // A short refinement ("published after 2023", "peer-reviewed only")
      // rarely stands alone as a useful OpenAlex query — the caller
      // combines it with the chat's most recent search query when present.
      // Only trigger this for messages that actually look like a
      // refinement (a qualifier phrase, or a very short fragment), not
      // just any short-but-complete topic like "LLM code review".
      isLikelyRefinement: REFINEMENT_PHRASES.test(lower) || wordCount <= 3,
    };
  }

  return { intent: 'chat' };
}

module.exports = { classifyIntent, extractNumbers, extractSearchQuery };
