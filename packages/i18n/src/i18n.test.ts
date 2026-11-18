import { describe, expect, it } from "vitest";
import { createT, interpolate, isSupportedLocale, type MessageCatalog } from "../src/index";
import { en } from "../src/catalogs/en";
import { ro } from "../src/catalogs/ro";

describe("locale guards", () => {
  it("accepts only supported locales", () => {
    expect(isSupportedLocale("en")).toBe(true);
    expect(isSupportedLocale("ro")).toBe(true);
    expect(isSupportedLocale("de")).toBe(false);
  });
});

describe("interpolate", () => {
  it("substitutes known vars and blanks unknown ones", () => {
    expect(interpolate("Hello {name}, invoice {no}", { name: "Ana", no: 7 })).toBe(
      "Hello Ana, invoice 7",
    );
    expect(interpolate("{a}-{b}", { a: "x" })).toBe("x-");
  });
});

describe("createT", () => {
  const catalogs: Record<"en" | "ro", MessageCatalog> = { en, ro };
  it("translates in both shipped languages", () => {
    expect(createT("en", catalogs)("app.tagline")).toBe("Stop chasing payments. Start getting paid.");
    expect(createT("ro", catalogs)("app.tagline")).toContain("încasări");
  });
  it("falls back to English for keys missing in target locale", () => {
    const partial: Record<"en" | "ro", MessageCatalog> = {
      en: { "only.en": "English" },
      ro: {},
    };
    expect(createT("ro", partial)("only.en")).toBe("English");
  });
  it("returns the key and warns in dev mode when nothing matches", () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);
    try {
      expect(createT("en", catalogs, { dev: true })("does.not.exist")).toBe("does.not.exist");
      expect(warnings.length).toBe(1);
    } finally {
      console.warn = origWarn;
    }
  });
});

describe("catalog parity", () => {
  it("RO defines every EN key (no silent gaps in UI language)", () => {
    const missing = Object.keys(en).filter((k) => !(k in ro));
    expect(missing).toEqual([]);
  });
});
