#!/usr/bin/env python3
"""Gerçek akış: sipariş ver → mutfağa gönder → öde.

Mutfak KOT'u mutfak yazıcısına, ödeme fişi kasa yazıcısına gitmeli.
Köprü çalışırken koşulmalı (npm run bridge).
"""
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
check("giriş", status == 200, status)
token = login.get("token", "")

# Yazıcılar: rol başına birer 'file' yazıcı
_, data = call("GET", "/api/admin/printers", token=token)
for p in data.get("printers", []):
    call("DELETE", f"/api/admin/printers/{p['id']}", token=token)
call("POST", "/api/admin/printers", {"name": "Akis Mutfak", "device": "kitchen", "transport": "file", "address": "flow-kitchen", "paperWidth": 80, "enabled": True}, token=token)
call("POST", "/api/admin/printers", {"name": "Akis Kasa", "device": "receipt", "transport": "file", "address": "flow-receipt", "paperWidth": 58, "enabled": True}, token=token)

status, boot = call("GET", "/api/bootstrap", token=token)
check("bootstrap", status == 200, status)

open_tables = {t["id"] for f in boot["floors"] for t in f["tables"] if t.get("order_id")}
free = [t for f in boot["floors"] for t in f["tables"] if t["id"] not in open_tables]
check("boş masa var", len(free) > 0, len(free))
table = free[0]

product = None
for cat in boot["menu"]:
    for p in cat["products"]:
        if p["variants"]:
            product = p
            break
    if product:
        break
check("ürün bulundu", product is not None, product["name"] if product else "")

status, order = call("POST", "/api/orders", {"tableId": table["id"], "guestCount": 2}, token=token)
check("adisyon açıldı", status == 200 and "id" in order, status)
order_id = order["id"]

status, res = call(
    "POST",
    f"/api/orders/{order_id}/lines",
    {"productId": product["id"], "variantId": product["variants"][0]["id"], "qty": 1, "modifierIds": []},
    token=token,
)
check("satır eklendi", status == 200, res.get("error", ""))

status, sent = call("POST", f"/api/orders/{order_id}/send", token=token)
check("mutfağa gönderildi", status == 200, res.get("error", ""))

# KOT işini bekle
status, data = call("GET", "/api/admin/printers", token=token)
kot_jobs = [j for j in data["jobs"] if j["kind"] == "kot" and j["status"] in ("queued", "printing", "printed")]
check("KOT kuyruğa girdi", bool(kot_jobs), len(kot_jobs))
kot_id = kot_jobs[0]["id"] if kot_jobs else None

deadline = time.time() + 30
kot_job = None
while time.time() < deadline:
    _, data = call("GET", "/api/admin/printers", token=token)
    kot_job = next((j for j in data["jobs"] if j["id"] == kot_id), None)
    if kot_job and kot_job["status"] in ("printed", "failed"):
        break
    time.sleep(1)
check("KOT basıldı", bool(kot_job) and kot_job["status"] == "printed", (kot_job or {}).get("error") or (kot_job or {}).get("status"))
check("KOT mutfak yazıcısına gitti", bool(kot_job) and kot_job.get("printer_name") == "Akis Mutfak", (kot_job or {}).get("printer_name"))

# Ödeme
status, full = call("GET", f"/api/orders/{order_id}", token=token)
total = full["totals"]["total"]
status, paid = call(
    "POST",
    f"/api/orders/{order_id}/pay",
    {"payments": [{"method": "cash", "amount": total, "allocations": []}], "customerName": "Akış Testi"},
    token=token,
)
check("ödeme alındı", status == 200 and paid.get("status") == "paid", paid.get("error", paid.get("status")))

status, data = call("GET", "/api/admin/printers", token=token)
rc_jobs = [j for j in data["jobs"] if j["kind"] == "receipt" and j["status"] in ("queued", "printing", "printed")]
rc_id = rc_jobs[0]["id"] if rc_jobs else None
deadline = time.time() + 30
rc_job = None
while time.time() < deadline:
    _, data = call("GET", "/api/admin/printers", token=token)
    rc_job = next((j for j in data["jobs"] if j["id"] == rc_id), None)
    if rc_job and rc_job["status"] in ("printed", "failed"):
        break
    time.sleep(1)
check("fiş basıldı", bool(rc_job) and rc_job["status"] == "printed", (rc_job or {}).get("error") or (rc_job or {}).get("status"))
check("fiş kasa yazıcısına gitti", bool(rc_job) and rc_job.get("printer_name") == "Akis Kasa", (rc_job or {}).get("printer_name"))

print(f"\n=== SONUÇ: {ok} geçti, {fail} hata ===")
raise SystemExit(1 if fail else 0)
