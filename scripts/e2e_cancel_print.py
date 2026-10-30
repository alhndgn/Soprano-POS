#!/usr/bin/env python3
"""İptal fişi testi: adisyon iptal edilince mutfak yazıcısına 'cancel' işi düşmeli."""
import json
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8095"
ok = 0
fail = 0


def call(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("content-type", "application/json")
    if token:
        req.add_header("authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def check(label: str, cond: bool, extra: object = ""):
    global ok, fail
    if cond:
        ok += 1
        print(f"PASS {label}" + (f" :: {extra}" if extra else ""))
    else:
        fail += 1
        print(f"FAIL {label}" + (f" :: {extra}" if extra else ""))


status, login = call("POST", "/api/auth/pin", {"pin": "1234"})
token = login.get("token", "")
check("giriş", status == 200, status)

# Yazıcılar: mutfak + kasa dosyaya yazsın
_, data = call("GET", "/api/admin/printers", token=token)
for p in data.get("printers", []):
    call("DELETE", f"/api/admin/printers/{p['id']}", token=token)
call("POST", "/api/admin/printers", {"name": "Iptal Mutfak", "device": "kitchen", "transport": "file", "address": "cancel-kitchen", "paperWidth": 80, "enabled": True}, token=token)
call("POST", "/api/admin/printers", {"name": "Iptal Kasa", "device": "receipt", "transport": "file", "address": "cancel-receipt", "paperWidth": 80, "enabled": True}, token=token)

status, boot = call("GET", "/api/bootstrap", token=token)
open_tables = {t["id"] for f in boot["floors"] for t in f["tables"] if t.get("order_id")}
free = [t for f in boot["floors"] for t in f["tables"] if t["id"] not in open_tables]
table = free[0]
product = next(p for c in boot["menu"] for p in c["products"] if p["variants"])

status, order = call("POST", "/api/orders", {"tableId": table["id"], "guestCount": 1}, token=token)
order_id = order["id"]
check("adisyon açıldı", status == 200, order_id)
call("POST", f"/api/orders/{order_id}/lines", {"productId": product["id"], "variantId": product["variants"][0]["id"], "qty": 2, "modifierIds": []}, token=token)
call("POST", f"/api/orders/{order_id}/send", token=token)

# İptal
status, res = call("POST", f"/api/orders/{order_id}/void", {"reason": "Musteri vazgecti"}, token=token)
check("adisyon iptal edildi", status == 200 and res.get("ok"), res.get("error", ""))

# Kuyruktaki işler arasında cancel var mı
status, jobs = call("GET", "/api/print/jobs")
cancel_jobs = [j for j in jobs if j["kind"] == "cancel"] if isinstance(jobs, list) else []
if not cancel_jobs:
    # köprü işi almış olabilir; admin listesinden bak
    _, data = call("GET", "/api/admin/printers", token=token)
    cancel_jobs = [j for j in data["jobs"] if j["kind"] == "cancel"]
check("iptal işi kuyruğa girdi", bool(cancel_jobs), len(cancel_jobs))

job = cancel_jobs[0] if cancel_jobs else {}
check("iş türü cancel", job.get("kind") == "cancel", job.get("kind"))
check("mutfak yazıcısına gidiyor", job.get("device") == "kitchen" or job.get("printer_name") == "Iptal Mutfak", job.get("device"))

# Basılmasını bekle
deadline = time.time() + 25
final = None
while time.time() < deadline and job:
    _, data = call("GET", "/api/admin/printers", token=token)
    final = next((j for j in data["jobs"] if j["id"] == job["id"]), None)
    if final and final["status"] in ("printed", "failed"):
        break
    time.sleep(1)
check("iptal fişi basıldı", bool(final) and final["status"] == "printed", (final or {}).get("error") or (final or {}).get("status"))
check("yazıcı adı kayıtlı", bool(final) and final.get("printer_name") == "Iptal Mutfak", (final or {}).get("printer_name"))

print(f"\n=== SONUÇ: {ok} geçti, {fail} hata ===")
raise SystemExit(1 if fail else 0)
