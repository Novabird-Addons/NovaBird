/* Semantische Suche: Mails, deren Text gerade nicht lesbar ist. Sie bekommen keinen Vektor und werden später erneut versucht,
   je Sitzung nur wenige Male (eine dauerhaft kaputte Mail soll nicht bei jedem Durchgang neu gelesen werden). */

export const MAX_READ_TRIES = 3;
export const READ_RETRY_MS = 15 * 60_000;

export class ReadFailures {
  #map = new Map(); // Message-ID -> { tries, next }

  get size() {
    return this.#map.size;
  }

  note(id, now = Date.now()) {
    const tries = (this.#map.get(id)?.tries ?? 0) + 1;
    this.#map.set(id, { tries, next: now + READ_RETRY_MS });
  }

  blocked(id, now = Date.now()) {
    const f = this.#map.get(id);
    return Boolean(f) && (f.tries >= MAX_READ_TRIES || now < f.next);
  }

  clear(id) {
    this.#map.delete(id);
  }
}

// Gelesene Mails eines Pakets trennen: texts[i] === null heißt nicht lesbar
export function splitReadable(batch, texts) {
  const out = { batch: [], texts: [], unreadable: [] };
  batch.forEach((row, i) => {
    if (texts[i] == null) {
      out.unreadable.push(row);
    } else {
      out.batch.push(row);
      out.texts.push(texts[i]);
    }
  });
  return out;
}
