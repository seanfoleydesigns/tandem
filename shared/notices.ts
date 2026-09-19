// Code reads the page's own notices. An empty result list is worth saying out loud at hand-back.
const EMPTY = /(^|[^\d.,])0\s+(results?|matches|items|products)\b|\bno\s+(results?|matches|items|products)\b|\bnothing (matches|found)\b/i;

export const noMatches = (notices: string[]) => notices.some((n) => EMPTY.test(n));
