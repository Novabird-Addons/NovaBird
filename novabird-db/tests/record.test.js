import { describe, expect, it } from "vitest";
import { attachmentTypeOf, folderIdOf, folderTypeOf, parseAddress, textFromParts, toRecord } from "../src/indexer/record.js";

describe("Datensatz-Abbildung", () => {
  it("Adressen", () => {
    expect(parseAddress("Jonas Müller <Jonas.Mueller@Firma.example>")).toEqual({ name: "Jonas Müller", email: "jonas.mueller@firma.example" });
    expect(parseAddress('"Müller, Jonas" <n@x.de>')).toEqual({ name: "Müller, Jonas", email: "n@x.de" });
    expect(parseAddress("n@x.de")).toEqual({ name: "", email: "n@x.de" });
  });

  it("Ordner MV3 und MV2", () => {
    expect(folderIdOf({ id: "account1://INBOX" })).toBe("account1://INBOX");
    expect(folderIdOf({ accountId: "account1", path: "/INBOX" })).toBe("account1://INBOX");
    expect(folderTypeOf({ specialUse: ["sent"] })).toBe("sent");
    expect(folderTypeOf({ type: "archives" })).toBe("archives");
    expect(folderTypeOf({ name: "Steuer" })).toBe("");
  });

  it("Anhangtypen", () => {
    expect(attachmentTypeOf({ name: "Speiseplan.xlsx" })).toBe("excel");
    expect(attachmentTypeOf({ name: "scan", contentType: "application/pdf" })).toBe("pdf");
    expect(attachmentTypeOf({ name: "IMG_1.HEIC" })).toBe("image");
    expect(attachmentTypeOf({ name: "x.bin" })).toBe("other");
  });

  it("Textteile aus getFull, Anhänge übersprungen", () => {
    const part = {
      contentType: "multipart/mixed",
      parts: [
        { contentType: "multipart/alternative", parts: [
          { contentType: "text/plain", body: "Hallo" },
          { contentType: "text/html", body: "<p>Hallo</p>" },
        ] },
        { contentType: "text/plain", name: "notiz.txt", body: "Anhang" },
      ],
    };
    expect(textFromParts(part)).toEqual({ plain: "Hallo", html: "<p>Hallo</p>" });
  });

  it("toRecord", () => {
    const header = {
      id: 17,
      headerMessageId: "abc@x",
      date: new Date(2026, 8, 20),
      author: "Jonas Müller <jonas@x.de>",
      recipients: ["Firma <p@x.de>"],
      ccList: ["Petra <petra@x.de>"],
      subject: "Speiseplan",
      read: false,
      flagged: true,
      tags: ["$label1"],
      folder: { id: "account1://INBOX", accountId: "account1", name: "Posteingang", specialUse: ["inbox"] },
    };
    const r = toRecord(header, {
      content: { plain: "Anbei.\n> Zitat" },
      attachments: [{ name: "plan.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }],
      tagNames: new Map([["$label1", "Wichtig"]]),
    });
    expect(r).toMatchObject({
      headerMessageId: "abc@x",
      folderId: "account1://INBOX",
      folderType: "inbox",
      authorName: "Jonas Müller",
      authorEmail: "jonas@x.de",
      recipients: "Firma <p@x.de>, Petra <petra@x.de>",
      hasAttachment: true,
      attachmentTypes: ["excel"],
      tags: ["Wichtig"],
      isRead: false,
      isFlagged: true,
      body: "Anbei.",
    });
    expect(r.bodyHash).toMatch(/^[0-9a-f]{8}$/);
  });
});
