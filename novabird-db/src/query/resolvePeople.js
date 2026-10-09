// Namensauflösung: "Jonas" -> konkrete Absenderadresse(n).
//
// Quellen: bereits indizierte Absender (nach Häufigkeit) und optional ein
// Adressbuch-Lookup (lookupContacts), den der Add-on-Teil bereitstellt.
//
// Ergebnis pro Person:
//   p.candidates = [{ name, email, count }]
//   p.resolved   = { name, email, emails: [email] }   nur wenn eindeutig
// Ist eine Person mehrdeutig, bleibt die LIKE-Suche über den Namen aktiv
// (findet alle "Jonas"), und die UI kann per Chip nachfragen.
//
// Zusatz: "von Jonas Müller" wird vom Parser als Person "Jonas" + Begriff
// "müller" gelesen. Passt genau ein Kandidat auch auf diesen Begriff, wird er
// übernommen und der Begriff entfernt.

import { escapeLike, norm } from "../util/normalize.js";

async function indexCandidates(db, name, field) {
  const like = `%${escapeLike(norm(name))}%`;
  if (field === "from" || field === "involves") {
    return db.select(
      `SELECT author_name, author_email, COUNT(*) AS c FROM messages
       WHERE author_norm LIKE ? ESCAPE '\\' AND author_email != ''
       GROUP BY author_email ORDER BY c DESC LIMIT 10`,
      [like],
      ["name", "email", "count"],
    );
  }
  return []; // Empfänger: nur über Adressbuch (Empfängerlisten sind unstrukturiert)
}

function mergeCandidates(a, b) {
  const map = new Map();
  for (const c of [...a, ...b]) {
    const key = c.email.toLowerCase();
    const prev = map.get(key);
    if (prev) prev.count = Math.max(prev.count ?? 0, c.count ?? 0);
    else map.set(key, { name: c.name ?? "", email: key, count: c.count ?? 0 });
  }
  return [...map.values()].sort((x, y) => y.count - x.count);
}

/**
 * @param db
 * @param q    Ergebnis von parseQuery (wird nicht verändert)
 * @param options { lookupContacts?: (name) => Promise<[{name,email}]> }
 * @returns neue Anfrage mit candidates/resolved an den Personen
 */
export async function resolvePeople(db, q, options = {}) {
  const next = structuredClone(q);
  const lists = [
    ["from", next.from],
    ["to", next.to],
    ["involves", next.involves],
  ];
  for (const [field, list] of lists) {
    for (const p of list) {
      if (p.me || p.email || !p.name) continue;
      const fromIndex = await indexCandidates(db, p.name, field);
      const fromBook = options.lookupContacts ? await options.lookupContacts(p.name) : [];
      let candidates = mergeCandidates(fromIndex, fromBook ?? []);
      p.candidates = candidates;

      // Nachname im Rest-Text? ("von Jonas Müller")
      if (candidates.length > 1) {
        for (let i = 0; i < next.terms.length; i++) {
          const group = next.terms[i];
          if (group.length !== 1) continue;
          const t = norm(group[0]);
          const narrowed = candidates.filter((c) => norm(c.name).split(/\s+/).some((w) => w.startsWith(t)));
          if (narrowed.length === 1) {
            candidates = narrowed;
            next.terms.splice(i, 1);
            break;
          }
        }
      } else if (candidates.length === 1) {
        // Auch bei eindeutigem Kandidaten den Nachnamen aus dem Text entfernen
        const words = norm(candidates[0].name).split(/\s+/);
        const idx = next.terms.findIndex((g) => g.length === 1 && words.some((w) => w.startsWith(norm(g[0]))) && norm(g[0]) !== norm(p.name));
        if (idx >= 0) next.terms.splice(idx, 1);
      }

      if (candidates.length === 1) {
        const c = candidates[0];
        p.resolved = { name: c.name, email: c.email, emails: [c.email] };
      }
    }
  }
  return next;
}
