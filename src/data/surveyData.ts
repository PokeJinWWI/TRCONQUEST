// Exploration and survey tuning (rules in scene/surveyLogic.ts, state in
// state/surveyStore.ts). A pick, not a balance decision.

// Days a science ship at a system's star spends surveying one body (planet,
// dwarf planet or moon) before moving on to the next. Sol's 30 bodies take
// ~half a year; a small system a few weeks.
export const SURVEY_DAYS_PER_BODY = 6
