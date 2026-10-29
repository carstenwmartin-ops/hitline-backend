// Basis-Wortfilter für frei eingebbare Namen (Anzeigenamen in Ranglisten, Liga-Namen der Daily). Gleiche Begriffsliste wie in der App
// (src/utils/contentFilter.js): bekannte anstößige Begriffe werden durch Sternchen ersetzt. Kein Anspruch auf Vollständigkeit, Apple
// Guideline 1.2 wird zusammen mit der Meldefunktion und der Moderation abgedeckt.
const BLOCKED_TERMS = [
  // Deutsch
  'hurensohn', 'wichser', 'fotze', 'nutte', 'schlampe', 'arschloch', 'scheisse', 'scheiße',
  'nazi', 'hitler', 'neger', 'kanake',
  // Englisch
  'fuck', 'shit', 'bitch', 'asshole', 'nigger', 'faggot', 'cunt', 'whore', 'rape',
];

export const sanitizeName = (name) => {
  if (!name || typeof name !== 'string') return name;
  const lower = name.toLowerCase();
  let result = name;
  for (const term of BLOCKED_TERMS) {
    if (lower.includes(term)) result = result.replace(new RegExp(term, 'gi'), '*'.repeat(term.length));
  }
  return result;
};
