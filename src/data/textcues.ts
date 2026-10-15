// Text cues (SPEC §9): words in a case text that hint at a BPMN element, highlighted on request. Patterns
// and word lists only, no NLP library; scored against the cases' tagged phrases in tests/textcues.test.ts.
import type { Tag } from './cases'

export interface Cue {
  tag: Tag
  /** What the words suggest, shown on hover. */
  why: string
  re: RegExp
}

const words = (list: string[]) => new RegExp(`\\b(?:${list.join('|')})\\b`, 'gi')

export const CUES: Cue[] = [
  { tag: 'decision', why: 'if / otherwise: one of several ways, an exclusive gateway (XOR)', re: words(['if', 'otherwise', 'in case', 'depending on', 'either', 'whether or not', 'unless']) },
  { tag: 'parallel', why: 'at the same time: both ways run, a parallel gateway (AND)', re: words(['at the same time', 'meanwhile', 'in parallel', 'while', 'when both are done', 'both']) },
  { tag: 'event', why: 'a time or a deadline: a timer event', re: /\b(?:every (?:day|week|month|monday|tuesday|wednesday|thursday|friday)|after \d+ (?:hours?|days?|weeks?)|\d+ (?:hours?|days?|weeks?) after|by (?:monday|tuesday|wednesday|thursday|friday)|deadline)\b/gi },
  { tag: 'message', why: 'sending or being told: a message to another pool', re: words(['sends?', 'notifies', 'notify', 'e-?mails?', 'lets [a-z ]+ know', 'is told', 'informs?']) },
  { tag: 'message', why: 'waiting for something from outside: a catching message event or a receive task', re: words(['receives?', 'waits for', 'arrives?', 'has arrived', 'comes in']) },
  { tag: 'event', why: 'an outcome: an end event (noun + past participle)', re: /\b(?:is now|has been|is) (?:lent|refused|rejected|shipped|checked in|closed|approved|done|completed|cancell?ed|declined)\b/gi },
  { tag: 'role', why: 'a role that does work: a lane', re: words(['the (?:\\w+ )?clerk', 'the (?:\\w+ )?manager', 'the librarian', 'an? (?:\\w+ )?assistant', 'the receptionist', 'the (?:\\w+ )?team', 'the warehouse', 'a sales clerk', 'the (?:\\w+ )?department', 'the (?:\\w+ )?officer', 'the nurse', 'the doctor']) },
  { tag: 'data', why: 'a document or record: a data object', re: words(['an? (?:\\w+ )?(?:slip|form|report|letter|receipt|list|note|record)']) },
  { tag: 'activity', why: 'verb + object: a task', re: words(['checks', 'fetches', 'records', 'stamps', 'hands over', 'hands', 'reserves', 'packs', 'prints', 'ships', 'approves', 'reviews', 'registers', 'prepares', 'calculates', 'fills in', 'signs', 'verifies']) },
]

export interface CueHit {
  start: number
  end: number
  tag: Tag
  why: string
}

/** The cue words found in a paragraph, left to right, without overlaps (the earlier pattern in CUES wins). */
export function findCues(text: string): CueHit[] {
  const hits: CueHit[] = []
  for (const c of CUES) {
    c.re.lastIndex = 0
    for (const m of text.matchAll(c.re)) {
      const start = m.index ?? 0
      const end = start + m[0].length
      if (hits.some((h) => start < h.end && end > h.start)) continue
      hits.push({ start, end, tag: c.tag, why: c.why })
    }
  }
  return hits.sort((a, b) => a.start - b.start)
}
