import { describe, expect, it } from "vitest";

import { csvCell, csvFilename, toCsv } from "../lib/csv.js";

/**
 * CSV export (spec §6).
 *
 * The point of exporting is to add things up somewhere else, so the failures
 * that matter are the ones a spreadsheet swallows quietly: a note with a comma
 * in it shifting every column after it, and a currency symbol turning a number
 * into text that will not sum.
 */

describe("csvCell", () => {
  it("leaves an ordinary value alone", () => {
    expect(csvCell("Dolly")).toBe("Dolly");
    expect(csvCell(42)).toBe("42");
  });

  it("quotes a value holding a comma, and doubles its quotes", () => {
    // `Sold to Bill, "the neighbour"` is exactly the value that breaks a naive
    // join, and notes are the field most likely to carry one.
    expect(csvCell('Sold to Bill, "the neighbour"')).toBe('"Sold to Bill, ""the neighbour"""');
  });

  it("quotes a value with a newline in it", () => {
    expect(csvCell("first\nsecond")).toBe('"first\nsecond"');
  });

  it("writes money as a plain number, so the column sums", () => {
    expect(csvCell({ cents: 123_456 })).toBe("1234.56");
    expect(csvCell({ cents: -70_000 })).toBe("-700.00");
  });

  it("writes a date as the day, not as a timestamp with an offset", () => {
    expect(csvCell(new Date(Date.UTC(2026, 2, 9, 12)))).toBe("2026-03-09");
  });

  it("leaves a blank blank rather than writing zero", () => {
    // "Nothing was recorded" and "the answer is zero" are different facts all
    // the way through the P&L. Flattening them here would throw that away in
    // the one place nobody would notice.
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(null)).toBe("");
    expect(csvCell(0)).toBe("0");
  });
});

describe("toCsv", () => {
  it("writes a header and one line per row, CRLF-separated", () => {
    const csv = toCsv(
      [
        { header: "Name", value: (row: { name: string; cost: { cents: number } }) => row.name },
        { header: "Cost", value: (row: { name: string; cost: { cents: number } }) => row.cost },
      ],
      [
        { name: "Dolly", cost: { cents: 125_000 } },
        { name: 'The "good" heifer', cost: { cents: 0 } },
      ],
    );

    expect(csv).toBe(["Name,Cost", "Dolly,1250.00", '"The ""good"" heifer",0.00'].join("\r\n"));
  });

  it("writes just the header for an empty report", () => {
    // A file with one line is a person's answer to "did it export?" — an empty
    // file is not.
    expect(toCsv([{ header: "Name", value: () => "" }], [])).toBe("Name");
  });
});

describe("csvFilename", () => {
  it("is dated, because a report is a snapshot", () => {
    expect(csvFilename("Herd P&L", new Date(Date.UTC(2026, 7, 13)))).toBe(
      "galaxy-farm-herd-p-l-2026-08-13.csv",
    );
  });

  it("leaves no trailing punctuation in the slug", () => {
    expect(csvFilename("Feed spend!", new Date(Date.UTC(2026, 0, 1)))).toBe(
      "galaxy-farm-feed-spend-2026-01-01.csv",
    );
  });
});
