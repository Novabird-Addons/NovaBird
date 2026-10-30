import { describe, expect, it } from "vitest";
import { cleanBody, htmlToText, stripQuotes, stripSignature } from "../src/text/clean.js";

describe("Textbereinigung", () => {
  it("HTML zu Text mit Entities", () => {
    const t = htmlToText("<style>p{}</style><p>Speisepl&auml;ne&nbsp;KW&#160;41</p><p>Gru&szlig;</p>");
    expect(t).toBe("Speisepläne KW 41\nGruß");
  });

  it("zitierte Zeilen und Zitatkopf werden entfernt", () => {
    const t = stripQuotes("Danke!\n\nAm 01.10.2026 um 09:00 schrieb Jonas Müller:\n> alter Text\n> noch mehr");
    expect(t).toBe("Danke!");
  });

  it("Outlook-Kopfblock wird erkannt", () => {
    const t = stripQuotes("Passt so.\n\nVon: Jonas Müller\nGesendet: Montag\nAn: Firma\nBetreff: Speiseplan\n\nAlter Inhalt");
    expect(t).toBe("Passt so.");
  });

  it("'Von:' im normalen Text bleibt erhalten", () => {
    const t = stripQuotes("Von: Montag bis Freitag geöffnet.\nBis bald");
    expect(t).toContain("Von: Montag");
  });

  it("HTML-Zitatblock (blockquote type=cite) wird entfernt", () => {
    const t = cleanBody({ html: "<p>Neu</p><blockquote type=\"cite\"><p>Alt</p></blockquote>" });
    expect(t).toBe("Neu");
  });

  it("Signatur ab '-- '", () => {
    expect(stripSignature("Text\n-- \nDr. Muster\nFirma")).toBe("Text");
  });

  it("weitergeleitete Mail: Inhalt bleibt mit keepForwarded", () => {
    const body = "FYI\n---------- Weitergeleitete Nachricht ----------\nWartung am 12.10.";
    expect(cleanBody({ plain: body })).toBe("FYI");
    expect(cleanBody({ plain: body }, { keepForwarded: true })).toContain("Wartung am 12.10.");
  });
});
