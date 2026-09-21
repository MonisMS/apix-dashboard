"""Key pool for SerpApi.

Each team member has their own free SerpApi account (250 searches/month).
This module treats them as one pool, picking the key with the most credit
left for each request.

Design rules, so a rotating pool doesn't corrupt the series:
  1. Balances come from SerpApi's /account endpoint, which costs NO search
     credit. We never guess how much is left.
  2. Every stored observation records WHICH key fetched it, so coverage can
     be audited afterwards and a bad key traced.
  3. If every key is exhausted the collector stops and says so. It never
     silently skips a route -- a gap must look like a gap.

Keys live in apix/.env, one per line:
    APIX_SERPAPI_KEY=<yours>
    APIX_SERPAPI_KEY_2=<teammate>
    APIX_SERPAPI_KEY_3=<teammate>
    ...
Owner labels are optional and never required:
    APIX_SERPAPI_LABEL_2=adit
"""
import os, requests

ACCOUNT_ENDPOINT = "https://serpapi.com/account"
RESERVE = 5          # never spend a key's last few credits; leaves room to retry


def _discover():
    """Find every APIX_SERPAPI_KEY* in the environment."""
    keys = []
    for name, val in os.environ.items():
        if not name.startswith("APIX_SERPAPI_KEY") or not val.strip():
            continue
        suffix = name[len("APIX_SERPAPI_KEY"):].lstrip("_") or "1"
        label = os.getenv(f"APIX_SERPAPI_LABEL_{suffix}") or f"key{suffix}"
        keys.append({"env": name, "label": label, "key": val.strip()})
    return sorted(keys, key=lambda k: k["env"])


def balance(key, timeout=20):
    """Remaining searches for one key. Costs no search credit."""
    try:
        r = requests.get(ACCOUNT_ENDPOINT, params={"api_key": key}, timeout=timeout)
        if r.status_code != 200:
            return None, f"HTTP {r.status_code}"
        d = r.json()
        return int(d.get("total_searches_left", 0)), None
    except Exception as e:
        return None, str(e)[:120]


def status():
    """Balances for every configured key."""
    out = []
    for k in _discover():
        left, err = balance(k["key"])
        out.append({**k, "left": left, "error": err})
    return out


class Pool:
    """Hands out the key with the most credit remaining."""

    def __init__(self, verbose=True):
        self.keys = []
        for k in _discover():
            left, err = balance(k["key"])
            if err:
                if verbose:
                    print(f"  ! {k['label']}: unreachable ({err}) - excluded")
                continue
            self.keys.append({**k, "left": left, "spent": 0})
            if verbose:
                print(f"  + {k['label']}: {left} searches left")
        self.keys.sort(key=lambda k: -k["left"])

    def total_available(self):
        return sum(max(0, k["left"] - RESERVE) for k in self.keys)

    def take(self):
        """Return (key, label) with the most credit, or (None, None)."""
        usable = [k for k in self.keys if k["left"] - k["spent"] > RESERVE]
        if not usable:
            return None, None
        k = max(usable, key=lambda x: x["left"] - x["spent"])
        k["spent"] += 1
        return k["key"], k["label"]

    def report(self):
        lines = []
        for k in self.keys:
            if k["spent"]:
                lines.append(f"    {k['label']}: {k['spent']} used, "
                             f"~{k['left']-k['spent']} left")
        return lines


if __name__ == "__main__":
    import env; env.load()
    rows = status()
    if not rows:
        print("No keys configured. Add APIX_SERPAPI_KEY... lines to apix/.env")
    else:
        print(f"{'key':<10} {'env var':<26} {'left':>6}")
        print("-" * 46)
        tot = 0
        for r in rows:
            left = "ERR" if r["left"] is None else r["left"]
            if r["left"]: tot += r["left"]
            print(f"{r['label']:<10} {r['env']:<26} {str(left):>6}"
                  + (f"   {r['error']}" if r["error"] else ""))
        print("-" * 46)
        print(f"{'TOTAL':<10} {'':<26} {tot:>6}")

        # Plan: hold a 12-route basket to submission, bank the rest for
        # continuous collection through to the December finale.
        SPRINT_ROUTES, W, SPRINT_DAYS = 12, 5, 10   # 11-20 Sep
        sprint = SPRINT_ROUTES * W * SPRINT_DAYS
        banked = tot - sprint
        nkeys = len([r for r in rows if r["left"]])
        print(f"\n  PLAN")
        print(f"    sprint to 20 Sep: {SPRINT_ROUTES} routes x {W} windows x {SPRINT_DAYS} days = {sprint}")
        print(f"    banked after submission                        = {banked}")
        if banked < 0:
            print(f"    ** SHORT by {-banked} - reduce routes or add a key **")
        else:
            # 21 Sep -> 8 Oct is 18 days before every key resets on 9 Oct
            gap_days = 18
            print(f"    21 Sep - 8 Oct ({gap_days}d): {banked//gap_days} req/day"
                  f" = {banked//gap_days//W} routes daily")
            monthly = nkeys * 250
            print(f"    from 9 Oct (all keys reset): {monthly}/month"
                  f" = {monthly//30//W} routes daily")
        print(f"\n    each extra key = +250 = 50 route-days, or ~2 more routes"
              f" sustained to December")
