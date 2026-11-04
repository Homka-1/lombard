import { describe, expect, it } from "vitest";
import {
  days,
  formatDate,
  formatPhoneInput,
  formatRate,
  formatTenge,
  formatTengeRange,
  initials,
  parseWeight,
  phoneDigits,
  plural,
} from "./format";

const NB = String.fromCharCode(0xa0);

describe("formatTenge", () => {
  it("formats tiyn as tenge with non-breaking spaces", () => {
    expect(formatTenge(9_520_000)).toBe(`95${NB}200${NB}₸`);
    expect(formatTenge(1_610_000)).toBe(`16${NB}100${NB}₸`);
    expect(formatTenge(0)).toBe(`0${NB}₸`);
    expect(formatTenge(123_456_789_00)).toBe(`123${NB}456${NB}789${NB}₸`);
  });

  it("shows tiyn only when present and handles negatives", () => {
    expect(formatTenge(10_050)).toBe(`100,50${NB}₸`);
    expect(formatTenge(-500_000)).toBe(`−5${NB}000${NB}₸`);
    expect(formatTenge(500_000, { sign: false })).toBe(`5${NB}000`);
  });

  it("formats ranges with one currency sign", () => {
    expect(formatTengeRange(11_200_000, 12_700_000)).toBe(
      `112${NB}000${NB}–${NB}127${NB}000${NB}₸`,
    );
    expect(formatTengeRange(100, 100)).toBe(`1${NB}₸`);
  });
});

describe("plural and dates", () => {
  it("picks Russian plural forms", () => {
    expect(plural(1, ["день", "дня", "дней"])).toBe("день");
    expect(plural(3, ["день", "дня", "дней"])).toBe("дня");
    expect(plural(11, ["день", "дня", "дней"])).toBe("дней");
    expect(plural(21, ["день", "дня", "дней"])).toBe("день");
    expect(days(30)).toBe(`30${NB}дней`);
  });

  it("formats daily rate in basis points", () => {
    expect(formatRate(25)).toBe(`0,25${NB}%`);
    expect(formatRate(40)).toBe(`0,4${NB}%`);
  });

  it("formats ISO dates without timezone shift", () => {
    const now = new Date("2026-11-04T10:00:00Z");
    expect(formatDate("2026-12-04", now)).toBe("4 декабря");
    expect(formatDate("2027-01-03", now)).toBe("3 января 2027");
  });
});

describe("phones", () => {
  it("extracts 10 digits of a KZ number", () => {
    expect(phoneDigits("+7 701 123-45-67")).toBe("7011234567");
    expect(phoneDigits("87011234567")).toBe("7011234567");
    expect(phoneDigits("77011234567")).toBe("7011234567");
    expect(phoneDigits("701 123 45 67")).toBe("7011234567");
  });

  it("masks input as +7 7XX XXX-XX-XX while typing", () => {
    expect(formatPhoneInput("")).toBe("");
    expect(formatPhoneInput("7")).toBe("+7 7");
    expect(formatPhoneInput("+7 7011")).toBe("+7 701 1");
    expect(formatPhoneInput("+7 701 1234")).toBe("+7 701 123-4");
    expect(formatPhoneInput("87011234567")).toBe("+7 701 123-45-67");
    expect(formatPhoneInput("+7 701 123-45-678")).toBe("+7 701 123-45-67");
    expect(formatPhoneInput("+7 ")).toBe("");
  });
});

describe("misc", () => {
  it("parses weight with comma or dot", () => {
    expect(parseWeight("4,2")).toBe(4.2);
    expect(parseWeight("12.3456")).toBe(12.346);
    expect(parseWeight("")).toBeNull();
    expect(parseWeight("0")).toBeNull();
    expect(parseWeight("abc")).toBeNull();
    expect(parseWeight("20000")).toBeNull();
  });

  it("builds initials", () => {
    expect(initials("Айгерим Садыкова")).toBe("АС");
    expect(initials("  ерлан  ")).toBe("Е");
  });
});
