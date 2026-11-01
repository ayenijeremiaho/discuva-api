export interface WordingRule {
  from: string;
  to: string;
}

const escapeRegex = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function matchCase(found: string, word: string): string {
  if (found === found.toUpperCase() && found.length > 1) {
    return word.toUpperCase();
  }
  if (found === found.toLowerCase()) return word.toLowerCase();
  return word;
}

// Only ever given fixed wording: a church's own name or text must not pass through here.
export function applyWording(text: string, rules: WordingRule[]): string {
  if (!rules.length || !text) return text;
  const to = new Map(rules.map((r) => [r.from.toLowerCase(), r.to]));
  const words = [...to.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join('|');
  return text.replace(
    new RegExp(`\\b(?:(an?)\\s+)?(${words})\\b`, 'gi'),
    (whole, article: string | undefined, found: string) => {
      const target = to.get(found.toLowerCase());
      if (!target || target.toLowerCase() === found.toLowerCase()) return whole;
      const word = matchCase(found, target);
      if (!article) return word;
      const an = /^[aeiou]/i.test(word);
      const fixed = article[0] === 'A' ? (an ? 'An' : 'A') : an ? 'an' : 'a';
      return `${fixed} ${word}`;
    },
  );
}
