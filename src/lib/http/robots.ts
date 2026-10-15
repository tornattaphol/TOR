/** Small robots.txt parser (RFC 9309 semantics: longest match wins, Allow wins ties, `*` and `$` wildcards). */

interface Group {
  agents: string[];
  rules: { allow: boolean; pattern: string }[];
}

export class RobotsPolicy {
  private groups: Group[] = [];
  /** true → robots.txt was unreachable with a 5xx: treat everything as disallowed (RFC 9309 §2.3.1.4). */
  constructor(text: string, private readonly disallowAll = false) {
    let current: Group | null = null;
    let lastWasAgent = false;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.replace(/#.*$/, "").trim();
      if (!line) continue;
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const field = line.slice(0, idx).trim().toLowerCase();
      const value = line.slice(idx + 1).trim();
      if (field === "user-agent") {
        if (!current || !lastWasAgent) {
          current = { agents: [], rules: [] };
          this.groups.push(current);
        }
        current.agents.push(value.toLowerCase());
        lastWasAgent = true;
      } else if (field === "allow" || field === "disallow") {
        lastWasAgent = false;
        if (current && value !== "") current.rules.push({ allow: field === "allow", pattern: value });
      } else {
        lastWasAgent = false;
      }
    }
  }

  get isDenyAll(): boolean {
    return this.disallowAll;
  }

  static allowAll(): RobotsPolicy {
    return new RobotsPolicy("");
  }

  static denyAll(): RobotsPolicy {
    return new RobotsPolicy("", true);
  }

  isAllowed(userAgent: string, pathWithQuery: string): boolean {
    if (this.disallowAll) return false;
    const ua = userAgent.toLowerCase();
    // Most specific agent group (longest token contained in our UA); fall back to "*".
    let best: Group | null = null;
    let bestLen = -1;
    for (const g of this.groups) {
      for (const a of g.agents) {
        if (a !== "*" && ua.includes(a) && a.length > bestLen) {
          best = g;
          bestLen = a.length;
        }
      }
    }
    if (!best) best = this.groups.find((g) => g.agents.includes("*")) ?? null;
    if (!best) return true;

    let verdict = true;
    let matchLen = -1;
    for (const r of best.rules) {
      if (!patternMatches(r.pattern, pathWithQuery)) continue;
      const len = r.pattern.length;
      if (len > matchLen || (len === matchLen && r.allow)) {
        matchLen = len;
        verdict = r.allow;
      }
    }
    return verdict;
  }
}

function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp("^" + body.split("*").map(escapeRe).join(".*") + (anchored ? "$" : ""));
  return re.test(path);
}

function escapeRe(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}
