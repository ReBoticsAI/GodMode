/**
 * Short Active-work / run-card / chat titles from a free-form user ask.
 * Prefer the bug/action, not the whole prompt.
 */

const TITLE_MAX = 72;

export function summarizeRunCardTitle(userMessage: string): string {
  const raw = userMessage.trim().replace(/\s+/g, " ");
  if (!raw) return "Run";

  // Prefer explicit double-quoted / backtick errors. Do not use '…' — English
  // apostrophes (I've / can't) look like quoted spans.
  const quoted =
    raw.match(/"([^"]{8,80})"/)?.[1] ??
    raw.match(/`([^`]{8,80})`/)?.[1];
  if (quoted) {
    const q = clipTitle(quoted);
    if (/unknown json field|conclusion|error|failed|bug/i.test(raw)) {
      return clipTitle(`Fix: ${q}`);
    }
    return q;
  }

  // Stop at sentence end only when `.` is followed by whitespace (not `.worktrees`).
  const stop = String.raw`(?:[.!?]\s+|,\s+can you|,\s+please|$)`;

  const diesWith = raw.match(
    new RegExp(
      String.raw`\b(?:dies|fails|errors?|blows up)\s+with\s+(.+?)${stop}`,
      "i"
    )
  );
  if (diesWith?.[1]) {
    return clipTitle(`Fix: ${stripLeadIn(diesWith[1])}`);
  }

  const cant = raw.match(
    new RegExp(String.raw`\bcan(?:'|\u2019)t\s+(.+?)${stop}`, "i")
  );
  if (cant?.[1] && /read|list|open|write|push|watch|find/i.test(cant[1])) {
    return clipTitle(`Fix: can't ${stripLeadIn(cant[1])}`);
  }

  const bugWhere = raw.match(
    new RegExp(String.raw`\bbug where\s+(.+?)${stop}`, "i")
  );
  if (bugWhere?.[1]) {
    return clipTitle(`Fix: ${stripLeadIn(bugWhere[1])}`);
  }

  // Complaints that Active work / run-card titles dump the full ask.
  if (
    /\btitles?\b/i.test(raw) &&
    /(?:dump|past(?:e|ing)?|whole|full\s+(?:chat\s+)?(?:prompt|message)|mess(?:y)?|summar|short)/i.test(
      raw
    )
  ) {
    if (/active work/i.test(raw)) {
      return "Shorten Active work titles";
    }
    return "Shorten run card titles";
  }

  const makeThose = raw.match(
    /\b(?:can you |could you )?make (?:those|them|the titles?)\s+(.+?)(?:\.|!|\?|$)/i
  );
  if (makeThose?.[1] && /summar|short|title/i.test(raw)) {
    return clipTitle(`Make titles ${stripLeadIn(makeThose[1])}`);
  }

  // Prefer the imperative ask ("Can you fix X") over narrative lead-in.
  const ask = raw.match(
    /\b(?:can you|could you|please)\s+(.+?)(?:[.!?]|$)/i
  );
  if (ask?.[1]) {
    let action = stripShipTail(stripLeadIn(ask[1]));
    if (/^(?:fix|repair|address)\s+(?:that|it|this)\b/i.test(action)) {
      const subject = narrativeNounPhrase(raw);
      if (subject) return clipTitle(`Fix ${subject}`);
    }
    if (action.length >= 8) {
      return clipTitle(capitalizeTitle(action));
    }
  }

  const firstSentence = raw.split(/(?<=[.!?])\s+/)[0]?.trim() || raw;
  let core = stripShipTail(stripLeadIn(firstSentence));
  core = core
    .replace(/\b(?:can you|could you|please)\b[\s\S]*$/i, "")
    .replace(/[.,;:\s]+$/g, "")
    .trim();
  if (!core) core = stripLeadIn(raw);
  // Narrative first sentences are usually too long for a board title.
  if (core.length > 48) {
    const subject = narrativeNounPhrase(raw);
    if (subject) return clipTitle(`Fix ${subject}`);
  }
  return clipTitle(core);
}

function stripShipTail(text: string): string {
  return text
    .replace(
      /\b(?:dig into that|fix it(?: properly)?|add a regression[\s\S]*|open a PR[\s\S]*|don(?:'|\u2019)?t merge[\s\S]*)$/i,
      ""
    )
    .replace(
      /\b(?:and|,)?\s*(?:open a PR|add a(?:n)? regression[\s\S]*|don(?:'|\u2019)?t merge[\s\S]*).*$/i,
      ""
    )
    .replace(/[.,;:\s]+$/g, "")
    .trim();
}

/** Pull a short noun phrase from "The X keep/are …" style complaints. */
function narrativeNounPhrase(raw: string): string | null {
  const m = raw.match(
    /\b(?:the\s+)?((?:active work|run card|agent board)?[^.]{0,40}?\btitles?\b[^.]{0,20}?)\s+(?:up top\s+)?(?:keep|are|is|keeps|dump|past)/i
  );
  if (m?.[1]) {
    const phrase = m[1].replace(/\s+/g, " ").trim();
    if (phrase.length >= 6) return phrase;
  }
  const about = raw.match(
    /\b(?:bug|issue|problem)\s+(?:with|in|where)\s+(.+?)(?:[.!?]|$)/i
  );
  if (about?.[1]) {
    const phrase = stripLeadIn(about[1]).replace(/[.,;:\s]+$/g, "").trim();
    if (phrase.length >= 6) return phrase;
  }
  const wrap = raw.match(
    /\b(?:the\s+)?([a-z][^.]{5,40}?)\s+(?:wrap|break|overflow|clip)/i
  );
  if (wrap?.[1]) {
    const phrase = wrap[1].replace(/\s+/g, " ").trim();
    if (phrase.length >= 6) return phrase;
  }
  return null;
}

function capitalizeTitle(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function stripLeadIn(text: string): string {
  return text
    .replace(/^(?:hey|hi|hello|yo)[,!]?\s+/i, "")
    .replace(
      /^(?:when i (?:ask|try)|i(?:'|\u2019)ve been (?:hitting|seeing)|i(?:'|\u2019)m (?:seeing|hitting)|i(?:'|\u2019)ve hit|i (?:keep|need|want)|there(?:'|\u2019)s)\s+/i,
      ""
    )
    .replace(/^(?:a\s+)?bug where\s+/i, "")
    .replace(/^intelligence\s+/i, "")
    .trim();
}

function clipTitle(text: string, max = TITLE_MAX): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  const base = (at > 24 ? cut.slice(0, at) : cut).trim();
  return `${base}…`;
}
