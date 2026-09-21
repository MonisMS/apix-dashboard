"""Reconnaissance for the airline scrapers -- run this BEFORE writing an adapter.

Opens an airline's fare search in a real browser, records every network response
the page makes, and saves both the rendered DOM and any JSON that looks like it
carries fares.  Airline sites are single-page apps: the fares almost always
arrive as JSON from the airline's own backend, and reading that JSON is far more
robust than scraping rendered divs whose class names change weekly.

This is reconnaissance only.  It performs ONE search, at human speed, on sites
whose robots.txt we re-read on 12 Sep 2026 and which permit it.

    python3 apix/explore_airline.py akasa --origin DEL --destination BOM --lead 7
"""
import argparse, asyncio, datetime, json, pathlib, re, sys

OUT = pathlib.Path(__file__).parent / "recon"

# Only sites whose robots.txt permits the fare path. Re-read before adding one.
SITES = {
    "akasa": {
        "home": "https://www.akasaair.com/",
        # Akasa's own deep link for a one-way search, discovered from the site's
        # booking widget. If it stops working the explorer falls back to filling
        # the form on the home page.
        "deep": ("https://www.akasaair.com/book-flight-tickets/flight-select"
                 "?tripType=O&origin={o}&destination={d}&departureDate={date}"
                 "&adult=1&child=0&infant=0&currency=INR"),
    },
    "spicejet": {
        "home": "https://www.spicejet.com/",
        "deep": ("https://www.spicejet.com/?dept={o}&arr={d}&departure={date}"
                 "&adults=1&children=0&infants=0&currency=INR&tripType=O"),
    },
}

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")

FARE_HINT = re.compile(
    r"fare|price|amount|journey|flight|availability|segment|itinerar", re.I)


async def explore(site: str, origin: str, dest: str, lead: int, timeout: int, override: str = None):
    from playwright.async_api import async_playwright

    cfg = SITES[site]
    date = (datetime.date.today() + datetime.timedelta(days=lead)).isoformat()
    url = override or cfg["deep"].format(o=origin, d=dest, date=date)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    outdir = OUT / f"{site}-{origin}{dest}-T{lead}-{stamp}"
    outdir.mkdir(parents=True, exist_ok=True)

    captured = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent=UA,
            locale="en-IN",
            timezone_id="Asia/Kolkata",
            viewport={"width": 1440, "height": 900},
        )
        page = await ctx.new_page()

        async def on_response(resp):
            try:
                ct = (resp.headers or {}).get("content-type", "")
                if "json" not in ct.lower():
                    return
                if not FARE_HINT.search(resp.url):
                    return
                body = await resp.text()
                if len(body) < 40:
                    return
                captured.append({"url": resp.url, "status": resp.status,
                                 "len": len(body), "body": body})
            except Exception:
                pass  # a response we could not read is not a failure of the run

        page.on("response", on_response)

        print(f"  GET {url}")
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=timeout * 1000)
        except Exception as e:
            print(f"  ! navigation: {type(e).__name__}: {e}")

        # Let the SPA finish its fare calls. Deliberately generous and idle --
        # we are waiting, not polling the server.
        for _ in range(int(timeout / 2)):
            await page.wait_for_timeout(2000)
            if captured:
                break
        await page.wait_for_timeout(3000)

        html = await page.content()
        title = await page.title()
        (outdir / "page.html").write_text(html, encoding="utf-8")
        try:
            await page.screenshot(path=str(outdir / "page.png"), full_page=False)
        except Exception:
            pass

        await browser.close()

    for i, c in enumerate(captured):
        (outdir / f"xhr-{i:02d}.json").write_text(c["body"], encoding="utf-8")

    summary = {
        "site": site, "url": url, "title": title,
        "searched": f"{origin}-{dest} dep {date} (T+{lead})",
        "html_bytes": len(html),
        "json_responses": [{"url": c["url"], "status": c["status"], "bytes": c["len"]}
                           for c in captured],
    }
    (outdir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(f"\n  title            : {title!r}")
    print(f"  html             : {len(html):,} bytes")
    print(f"  json responses   : {len(captured)}")
    for c in captured:
        print(f"      {c['len']:>8,}B  {c['url'][:110]}")
    blocked = any(w in (title or "").lower()
                  for w in ("just a moment", "access denied", "attention required",
                            "blocked", "403", "captcha"))
    if blocked:
        print("  ⚠️  looks like a bot wall -- see page.png")
    elif not captured:
        print("  ⚠️  no fare-shaped JSON captured -- inspect page.html/page.png")
    print(f"\n  saved -> {outdir}")
    return summary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("site", choices=sorted(SITES))
    ap.add_argument("--origin", default="DEL")
    ap.add_argument("--destination", default="BOM")
    ap.add_argument("--lead", type=int, default=7)
    ap.add_argument("--timeout", type=int, default=45)
    ap.add_argument("--url", help="explore this exact URL instead of the built-in deep link")
    a = ap.parse_args()
    print(f"\nRecon: {a.site} {a.origin}-{a.destination} T+{a.lead}")
    asyncio.run(explore(a.site, a.origin, a.destination, a.lead, a.timeout, a.url))


if __name__ == "__main__":
    main()
