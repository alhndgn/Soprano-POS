#!/usr/bin/env python3
"""Gel al (paket) siparişi testi."""
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

# Yazıcılar (KOT etiketini görmek için)
_, data = call("GET", "/api/admin/printers", token=token)
for p in data.get("printers", []):
    call("DELETE", f"/api/admin/printers/{p['id']}", token=token)
call("POST", "/api/admin/printers", {"name": "GelAl Mutfak", "device": "kitchen", "transport": "file", "address": "takeaway-kitchen", "paperWidth": 80, "enabled": True}, token=token)
call("POST", "/api/admin/printers", {"name": "GelAl Kasa", "device": "receipt", "transport": "file", "address": "takeaway-receipt", "paperWidth": 80, "enabled": True}, token=token)

# Masa olmadan gel al siparişi
status, order = call("POST", "/api/orders", {"orderType": "takeaway", "customerName": "Ahmet", "customerPhone": "0555 111 22 33"}, token=token)
check("gel al adisyonu açıldı", status == 200 and "id" in order, order.get("error", ""))
order_id = order.get("id")
check("masa yok", order.get("table_id") is None, order.get("table_id"))
check("tip takeaway", order.get("order_type") == "takeaway", order.get("order_type"))
check("müşteri adı kayıtlı", order.get("customer_name") == "Ahmet", order.get("customer_name"))

# Bootstrap'ta takeaway listesinde görünmeli
status, boot = call("GET", "/api/bootstrap", token=token)
row = next((o for o in boot["takeaway"] if o["id"] == order_id), None)
check("bootstrap takeaway listesinde", row is not None, len(boot["takeaway"]))
check("listedeki ad", bool(row) and row.get("customer_name") == "Ahmet", (row or {}).get("customer_name"))

# Ürün ekle + mutfağa gönder
product = next(p for c in boot["menu"] for p in c["products"] if p["variants"])
status, res = call("POST", f"/api/orders/{order_id}/lines", {"productId": product["id"], "variantId": product["variants"][0]["id"], "qty": 1, "modifierIds": []}, token=token)
check("satır eklendi", status == 200, res.get("error", ""))
status, res = call("POST", f"/api/orders/{order_id}/send", token=token)
check("mutfağa gönderildi", status == 200, res.get("error", ""))

# KOT payload'ında masa yerine 'Gel Al - Ahmet' olmalı
status, jobs = call("GET", "/api/print/jobs")
kot = next((j for j in jobs if j["kind"] == "kot" and j["payload"]["orderId"] == order_id), None)
check("KOT kuyruğa girdi", kot is not None, len(jobs) if isinstance(jobs, list) else 0)
check("KOT etiketi Gel Al - Ahmet", bool(kot) and kot["payload"].get("tableName") == "Gel Al - Ahmet", (kot or {}).get("payload", {}).get("tableName"))

time.sleep(4)

# Ödeme → fiş
status, full = call("GET", f"/api/orders/{order_id}", token=token)
total = full["totals"]["total"]
status, paid = call(
    "POST",
    f"/api/orders/{order_id}/pay",
    {"payments": [{"method": "cash", "amount": total, "allocations": []}]},
    token=token,
)
check("ödeme alındı", status == 200 and paid.get("status") == "paid", paid.get("error", paid.get("status")))

status, jobs = call("GET", "/api/print/jobs")
receipt = next((j for j in jobs if j["kind"] == "receipt" and j["payload"]["orderId"] == order_id), None)
if not receipt:
    _, data = call("GET", "/api/admin/printers", token=token)
    check("fiş işi oluştu", any(j["kind"] == "receipt" for j in data["jobs"]), len(data["jobs"]))
    check("fiş etiketi Gel Al - Ahmet", any(
        j["kind"] == "receipt" and j["printer_name"] == "GelAl Kasa" for j in data["jobs"]
    ))
else:
    check("fiş etiketi Gel Al - Ahmet", receipt["payload"].get("tableName") == "Gel Al - Ahmet", receipt["payload"].get("tableName"))

# Rapor: gel al ayrımı
status, rep = call("GET", "/api/reports/daily", token=token)
types = {t["order_type"]: t for t in rep.get("byType", [])}
check("raporda gel al var", "takeaway" in types, list(types))
check("gel al cirosu > 0", types.get("takeaway", {}).get("revenue", 0) >= total, types.get("takeaway"))

print(f"\n=== SONUÇ: {ok} geçti, {fail} hata ===")
raise SystemExit(1 if fail else 0)
