#!/usr/bin/env python3
"""Pull animal details for every lot on a saved SCO Online Sales watch list.

Usage:
    python3 tools/sco-watchlist.py WATCHLIST.html [--json OUT.json] [--base URL]

The saved watch list page lists each lot with its sale ID and lot ID. The lot
pages themselves render as skeletons and fill in from the same JSON listing the
page loads (/Lots/Index/<saleId>), so this script reads that listing once per
sale and matches each watch item to its lot. Sale-level details (date, end time,
location, seller, welcome statement) come from each sale's listing page. The listing is public; the watch
list page itself needs the logged-in session, which is why the input is saved HTML.

Standard library only.
"""

import argparse
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request

DEFAULT_BASE = "https://www.sconlinesales.com"
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) sco-watchlist/1.0"
REQUEST_DELAY_SECONDS = 0.5
ATTEMPTS = 3


def to_text(fragment):
    """Strip tags, unescape entities and collapse whitespace."""
    text = re.sub(r"<[^>]+>", " ", fragment)
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def parse_watch_items(page):
    """Return one dict per watch item found in the saved watch list HTML."""
    headers = [
        (m.start(), m.group(1))
        for m in re.finditer(r'<h2 class="sco-card-header" id="([^"]+)"', page)
    ]
    starts = [m.start() for m in re.finditer(r'<div class="watch-item ', page)]
    items = {}

    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else len(page)
        block = page[start:end]
        lot_id = re.search(r'data-id="(\d+)"', block)
        sale_id = re.search(r'data-sale="(\d+)"', block)
        if not lot_id or not sale_id or lot_id.group(1) in items:
            continue

        section = [name for pos, name in headers if pos < start]
        lot_link = re.search(r'href="(/Bids/AuctionsListing/\d+#l[^"]*)"', block)
        sale_title = re.search(r'<span title="([^"]*)" class="fs-18', block)
        lot_num = re.search(r'data-num="([^"]*)"', block)
        lot_name = re.search(r'data-lotname="([^"]*)"', block)

        items[lot_id.group(1)] = {
            "lot_id": int(lot_id.group(1)),
            "sale_id": int(sale_id.group(1)),
            "sale_title": html.unescape(sale_title.group(1)) if sale_title else None,
            "watch_section": section[-1] if section else None,
            "lot_number": html.unescape(lot_num.group(1)) if lot_num else None,
            "lot_name": html.unescape(lot_name.group(1)).strip() if lot_name else None,
            "lot_path": lot_link.group(1) if lot_link else None,
        }

    return list(items.values())


def parse_item_details(entries):
    """Split ItemDetails HTML fragments into labelled fields and free-text extras."""
    details = {}
    extras = []
    for entry in entries:
        pairs = re.findall(
            r"<strong>\s*([^<]*?)\s*</strong>(.*?)(?=<strong>|$)", entry, re.S
        )
        if pairs:
            for label, raw in pairs:
                key = label.strip().rstrip(":").strip()
                details.setdefault(key, to_text(raw))
        else:
            text = to_text(entry)
            if text:
                extras.append(text)
    return details, extras


def fetch_json(base, path):
    request = urllib.request.Request(
        base + path,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    for attempt in range(1, ATTEMPTS + 1):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError):
            if attempt == ATTEMPTS:
                raise
            time.sleep(2 ** attempt)


def fetch_text(base, path):
    request = urllib.request.Request(base + path, headers={"User-Agent": USER_AGENT})
    for attempt in range(1, ATTEMPTS + 1):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.read().decode("utf-8", errors="replace")
        except (urllib.error.URLError, TimeoutError):
            if attempt == ATTEMPTS:
                raise
            time.sleep(2 ** attempt)


def parse_sale_info(page):
    """Read the sale header block (title, date, end time, location, contacts, welcome text)."""
    info = {}
    title = re.search(r'<div id="sale-details">\s*<h1[^>]*>(.*?)</h1>', page, re.S)
    date = re.search(r'<div id="sale-details">\s*<h1[^>]*>.*?</h1>\s*<h3[^>]*>(.*?)</h3>', page, re.S)
    info["title"] = to_text(title.group(1)) if title else None
    info["date"] = to_text(date.group(1)) if date else None
    for label, value in re.findall(r"<h4[^>]*>\s*<span>([^<]*)</span>(.*?)</h4>", page, re.S):
        info[label.strip().rstrip(":").strip().lower().replace(" ", "_")] = to_text(value)
    welcome = re.search(r'id="welcome-statement".*?ckeditor-content[^"]*">(.*?)</section>', page, re.S)
    info["welcome_statement"] = to_text(welcome.group(1)) if welcome else None
    return info


def build_record(item, lot, base):
    details, extras = parse_item_details(lot.get("ItemDetails") or [])
    return {
        **item,
        "lot_url": base + item["lot_path"] if item["lot_path"] else None,
        "current_bid": lot.get("CurrentBid"),
        "next_bid": lot.get("NextBidAmount"),
        "total_bids": lot.get("TotalBids"),
        "bid_holder": lot.get("CurrentBidHolder"),
        "sale_ends_at": lot.get("SaleEndsAt"),
        "video_url": lot.get("LotVideoLink") or None,
        "details": details,
        "other_details": extras,
        "comments": to_text(lot.get("Comments") or ""),
        "special_terms": to_text(lot.get("SpecialTerms") or ""),
        "delivery_methods": to_text(lot.get("DeliveryMethods") or ""),
        "error": None,
    }


def format_money(value):
    return f"${value:,.2f}" if isinstance(value, (int, float)) else "-"


def print_sale(sale_id, sale):
    if "error" in sale:
        print(f"=== Sale {sale_id}: sale page unavailable ({sale['error']})")
        return
    print(f"=== {sale['title']} (sale {sale_id})")
    print(f"    {sale.get('date', '-')} | Ends: {sale.get('sale_end_time', '-')}")
    print(f"    Location: {sale.get('location', '-')}")
    print(f"    Seller: {sale.get('seller', '-')} | Sale rep: {sale.get('sale_rep', '-')}")


def print_summary(records):
    last_sale = None
    for record in records:
        if record["sale_id"] != last_sale:
            print_sale(record["sale_id"], record["sale"])
            print()
            last_sale = record["sale_id"]
        head = f"Lot {record['lot_number']}: {record['lot_name']}"
        if record["error"]:
            print(f"{head}\n    ERROR: {record['error']}")
            continue
        fields = record["details"]
        print(head)
        print(f"    Sire: {fields.get('Sire', '-')} | Dam: {fields.get('Dam', '-')}")
        print(
            f"    DOB: {fields.get('DOB', '-')} | Sex: {fields.get('Sex', '-')} | "
            f"Breed: {fields.get('Breed', '-')}"
        )
        print(
            f"    Current bid: {format_money(record['current_bid'])} "
            f"({record['total_bids']} bids) | Sale ends: {record['sale_ends_at']}"
        )
        print(f"    {record['lot_url']}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    parser.add_argument("watchlist", help="Saved HTML of the SCO watch list page")
    parser.add_argument("--json", metavar="OUT", help="Write full records to this JSON file")
    parser.add_argument("--base", default=DEFAULT_BASE, help="Site base URL")
    args = parser.parse_args()

    with open(args.watchlist, encoding="utf-8", errors="replace") as handle:
        items = parse_watch_items(handle.read())
    if not items:
        sys.exit("No watch items found in the file. Is it the saved watch list page?")
    print(f"Found {len(items)} watch items across {len({i['sale_id'] for i in items})} sales.\n")

    listings = {}
    records = []
    for sale_id in sorted({item["sale_id"] for item in items}):
        try:
            listings[sale_id] = {
                lot["LotId"]: lot for lot in fetch_json(args.base, f"/Lots/Index/{sale_id}")
            }
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            listings[sale_id] = {}
            print(f"Sale {sale_id}: could not load listing ({exc})", file=sys.stderr)
        time.sleep(REQUEST_DELAY_SECONDS)

    sales = {}
    for sale_id in sorted({item["sale_id"] for item in items}):
        try:
            sales[sale_id] = parse_sale_info(fetch_text(args.base, f"/Bids/AuctionsListing/{sale_id}"))
        except (urllib.error.URLError, TimeoutError) as exc:
            sales[sale_id] = {"error": str(exc)}
            print(f"Sale {sale_id}: could not load sale page ({exc})", file=sys.stderr)
        time.sleep(REQUEST_DELAY_SECONDS)

    for item in sorted(items, key=lambda i: (i["sale_id"], i["lot_number"] or "")):
        lot = listings[item["sale_id"]].get(item["lot_id"])
        if lot is None:
            record = {**item, "lot_url": None, "error": "lot not in public listing for this sale"}
        else:
            record = build_record(item, lot, args.base)
        record["sale"] = sales[item["sale_id"]]
        records.append(record)

    print_summary(records)
    failed = sum(1 for record in records if record["error"])
    print(f"\n{len(records) - failed} parsed, {failed} failed.")

    if args.json:
        with open(args.json, "w", encoding="utf-8") as handle:
            json.dump(records, handle, indent=2, ensure_ascii=False)
        print(f"Wrote {args.json}")


if __name__ == "__main__":
    main()
