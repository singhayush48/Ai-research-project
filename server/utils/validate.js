// Hand-written validation helpers. No validation library is used, per the
// project's dependency policy. Each function returns an error string, or
// null if the value is valid.

function isEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validateRegister({ name, email, password }) {
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return 'Name must be at least 2 characters.';
  }
  if (!isEmail(email)) {
    return 'A valid email address is required.';
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  return null;
}

function validateLogin({ email, password }) {
  if (!isEmail(email)) return 'A valid email address is required.';
  if (!password || typeof password !== 'string') return 'Password is required.';
  return null;
}

function validateProject({ title }) {
  if (!title || typeof title !== 'string' || title.trim().length < 3) {
    return 'Project title must be at least 3 characters.';
  }
  return null;
}

// Research journey stage, tracked per project. Order matters for the
// progress indicator: Define -> Discover -> Analyze -> Gaps -> Plan -> Create.
const RESEARCH_STAGES = ['define', 'discover', 'analyze', 'gaps', 'plan', 'create'];

function isValidStage(value) {
  return !value || RESEARCH_STAGES.includes(value);
}

// Research type chosen during New Research onboarding.
const RESEARCH_TYPES = [
  'literature_review',
  'research_paper',
  'final_year_project',
  'thesis_dissertation',
  'research_proposal',
  'general_research',
];

function isValidResearchType(value) {
  return !value || RESEARCH_TYPES.includes(value);
}

function validateNote({ content }) {
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return 'Note content cannot be empty.';
  }
  return null;
}

function isPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
}

module.exports = {
  isEmail,
  validateRegister,
  validateLogin,
  validateProject,
  validateNote,
  isPositiveInt,
  RESEARCH_STAGES,
  isValidStage,
  RESEARCH_TYPES,
  isValidResearchType,
};
