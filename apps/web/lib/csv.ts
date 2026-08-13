import type { Money } from "@galaxy-farm/core";

/**
 * CSV export (spec §6: "All exportable to CSV").
 *
 * Written rather than pulled in, because the format is four rules and the
 * fifth — what a *farm* report should put in a cell — is the part a library
 * cannot decide. Two decisions worth stating:
 *
 * **Money leaves as a plain number, not `$1,234.56`.** The whole reason to
 * export is to add things up somewhere else, and a currency symbol turns a
 * column into text that a spreadsheet will not sum.
 *
 * **A blank is blank.** Not `0`, not `—`, not `null`. §5.2's P&L is careful
 * to distinguish "nothing was recorded" from "the answer is zero" all the way
 * through, and flattening the two on the way out would throw that away in the
 * one place it is least likely to be noticed.
 */

export type CsvValue = string | number | Money | Date | undefined | null;

/**
 * One cell, escaped.
 *
 * RFC 4180: double the quotes, then wrap anything holding a comma, a quote or
 * a newline. A cattle note reading `Sold to Bill, "the neighbour"` is exactly
 * the value that breaks a naive join, and notes are the field most likely to
 * carry one.
 */
export function csvCell(value: CsvValue): string {
  if (value === undefined || value === null) return "";

  const text =
    typeof value === "number"
      ? String(value)
      : typeof value === "string"
        ? value
        : value instanceof Date
          ? value.toISOString().slice(0, 10)
          : // Money: whole cents as dollars, unformatted, so it sums.
            (value.cents / 100).toFixed(2);

  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export interface CsvColumn<T> {
  readonly header: string;
  readonly value: (row: T) => CsvValue;
}

/**
 * Rows and a header, CRLF-separated.
 *
 * CRLF because RFC 4180 says so and because Excel on Windows is where these
 * files are most likely to be opened.
 */
export function toCsv<T>(columns: readonly CsvColumn<T>[], rows: readonly T[]): string {
  const lines = [columns.map((column) => csvCell(column.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(column.value(row))).join(","));
  }
  return lines.join("\r\n");
}

/**
 * A filename somebody will still recognise in their downloads folder.
 *
 * Dated, because a report is a snapshot and two of them a month apart are the
 * whole point of exporting.
 */
export function csvFilename(report: string, on: Date): string {
  const slug = report
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `galaxy-farm-${slug}-${on.toISOString().slice(0, 10)}.csv`;
}

/**
 * Hand the file to the browser.
 *
 * A blob and an object URL rather than a `data:` URI: a herd's worth of rows
 * exceeds what some browsers accept in a URL, and the failure is silent — the
 * click does nothing at all. Revoked on the next tick, or the blob is held for
 * the life of the document.
 */
export function downloadCsv(filename: string, contents: string): void {
  const doc = globalThis.document;
  if (doc === undefined) return;

  // The BOM is what makes Excel read UTF-8 rather than guessing at the code
  // page — without it an animal called Zoë opens as Zoë. Written as an escape
  // rather than as the character, which is invisible in a diff.
  const blob = new Blob([`\uFEFF${contents}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const anchor = doc.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  doc.body.appendChild(anchor);
  anchor.click();
  // crud-guard: allow-unconfirmed — an anchor this function made three lines ago
  anchor.remove();

  globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
}
