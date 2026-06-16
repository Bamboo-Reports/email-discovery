export type PatternCandidate = { email: string; score: number };

const SPECS: Array<{ build: (f: string, l: string, d: string) => string; score: number }> = [
  { build: (f, l, d) => `${f}.${l}@${d}`,    score: 0.90 },
  { build: (f, l, d) => `${f[0]}${l}@${d}`,  score: 0.75 },
  { build: (f, l, d) => `${f}@${d}`,         score: 0.65 },
  { build: (f, l, d) => `${f}${l}@${d}`,     score: 0.60 },
  { build: (f, l, d) => `${f[0]}.${l}@${d}`, score: 0.50 },
  { build: (f, l, d) => `${f}${l[0]}@${d}`,  score: 0.42 },
  { build: (f, l, d) => `${l}@${d}`,         score: 0.35 },
  { build: (f, l, d) => `${l}.${f}@${d}`,    score: 0.25 },
  { build: (f, l, d) => `${l}${f[0]}@${d}`,  score: 0.20 },
  { build: (f, l, d) => `${f}_${l}@${d}`,    score: 0.15 },
  { build: (f, l, d) => `${f}-${l}@${d}`,    score: 0.12 },
];

export function generatePatterns(first: string, last: string, domain: string): PatternCandidate[] {
  const f = first.trim().toLowerCase();
  const l = last.trim().toLowerCase();
  return SPECS.map(s => ({ email: s.build(f, l, domain), score: s.score }));
}

export function bestGuess(first: string, last: string, domain: string): PatternCandidate {
  return generatePatterns(first, last, domain)[0];
}
