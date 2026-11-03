/**
 * Heuristic intent matching for "most asked" and gap finding. Cheap regexes,
 * no AI, works in guided mode too. Each intent has a canonical question shown
 * to visitors and, when one exists, the FAQ that answers it.
 * Add intents as the gap log reveals new questions.
 */
export interface Intent {
  id: string;
  question: string;
  re: RegExp;
  faq?: string;
  /** Pages where this question is most relevant (for ordering). */
  pages?: string[];
}

export const INTENTS: Intent[] = [
  { id: 'price', question: 'How is pricing set?', re: /\b(price|pricing|cost|rate|quote|how much|budget|fee|charge|afford)\b/i, faq: 'pricing' },
  { id: 'availability', question: 'Is my date available?', re: /\b(available|availability|free on|open on|booked|date)\b/i },
  { id: 'lead_time', question: 'How far ahead should we book?', re: /\b(how (far|early|soon)|advance|lead time|last minute|short notice)\b/i, faq: 'lead-time' },
  { id: 'formats', question: 'Solo, trio or full band?', re: /\b(solo|duo|trio|full band|band size|how many (musicians|people)|hustlers|format)\b/i, faq: 'formats' },
  { id: 'next_steps', question: 'What happens after I inquire?', re: /\b(after (i|we) (inquire|submit|send)|next steps?|what happens|deposit|contract|hold (the|my|our) date)\b/i, faq: 'after-inquiry' },
  { id: 'first_dance', question: 'Can you learn our first dance song?', re: /\b(first dance|our song|learn (a|our|the) song|special song)\b/i, faq: 'w-first-dance', pages: ['/weddings'] },
  { id: 'ceremony', question: 'Can you play the ceremony and reception?', re: /\b(ceremony|processional|aisle|recessional|vows|reception)\b/i, faq: 'w-ceremony-reception', pages: ['/weddings'] },
  { id: 'requests', question: 'Do you take requests?', re: /\b(request|setlist|set list|song list|do not play|must play|repertoire)\b/i, faq: 'w-requests' },
  { id: 'travel', question: 'Do you travel for events?', re: /\b(travel|destination|fly|abroad|international|out of state|mexico|europe)\b/i, faq: 'd-travel', pages: ['/destination'] },
  { id: 'volume', question: 'Can the music stay conversational?', re: /\b(volume|loud|quiet|soft|background|neighbou?rs|noise)\b/i, faq: 'e-volume', pages: ['/estate'] },
  { id: 'insurance', question: 'Can you provide a COI and tech rider?', re: /\b(insurance|coi|certificate|liability|rider|w-?9|stage plot|tech spec)\b/i, faq: 'c-paperwork', pages: ['/corporate'] },
  { id: 'sound', question: 'Do you bring your own sound?', re: /\b(sound system|pa system|speakers|mic|microphone|av|audio|equipment|setup)\b/i, faq: 'c-av', pages: ['/corporate'] },
  { id: 'privacy', question: 'Will our event be posted online?', re: /\b(nda|private|privacy|post(ed)? online|social media|discreet|photos)\b/i, faq: 'e-privacy', pages: ['/estate'] },
  { id: 'music_style', question: 'Can we see Sean live?', re: /\b(sound like|style|genre|listen|hear|play|watch|show|video|clips?|footage|sample|songs?|playlist|drive|mood|vibe)\b/i },
  { id: 'wedding_set', question: 'What does a wedding set include?', re: /\b(wedding set|set include|what('s| is) included|packages?|coverage|hours of music)\b/i, faq: 'w-ceremony-reception', pages: ['/weddings'] },
  { id: 'custom_song', question: 'Can Sean write a song for our brand?', re: /\b(custom song|write (a|us)|original song|jingle|brand song)\b/i, faq: 'c-custom', pages: ['/corporate'] },
];

export function matchIntents(text: string): string[] {
  const hits = INTENTS.filter((i) => i.re.test(text)).map((i) => i.id);
  return [...new Set(hits)].slice(0, 3);
}

export const intentById = new Map(INTENTS.map((i) => [i.id, i]));
export const intentByFaq = new Map(INTENTS.filter((i) => i.faq).map((i) => [i.faq!, i]));

/** Strip anything personal before a question is kept as a gap sample. */
export function scrub(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[phone]')
    .replace(/\b\d{1,5}\s+\w+\s+(st|street|ave|avenue|rd|road|blvd|dr|drive|ln|lane)\b/gi, '[address]')
    .slice(0, 200);
}
