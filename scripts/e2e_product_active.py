#!/usr/bin/env python3
"""Ürün aktif/pasif testi.

Pasife alınan ürün POS menüsünden (bootstrap) düşmeli, siparişe eklenememeli,
tekrar aktif edilince geri gelmeli.
"""
import json
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

status, menu = call("GET", "/api/admin/menu", token=token)
check("menü listesi", status == 200 and len(menu) > 0, len(menu))
check("menüde active alanı", all("active" in p for p in menu), "")

target = menu[0]
check(f"{target['name']} başlangıçta aktif", target["active"] is True, target["active"])

# Pasife al
status, res = call("PATCH", f"/api/admin/products/{target['id']}/active", {"active": False}, token=token)
check("pasife alındı", status == 200 and res.get("active") is False, res.get("error", ""))

# POS menüsünde görünmemeli
status, boot = call("GET", "/api/bootstrap", token=token)
ids = [p["id"] for c in boot["menu"] for p in c["products"]]
check("POS menüsünde yok", target["id"] not in ids, len(ids))
check("boş kategori kalmadı", all(len(c["products"]) > 0 for c in boot["menu"]), [c["name"] for c in boot["menu"]])

# Siparişe eklenememeli
free_table = None
open_tables = {t["id"] for f in boot["floors"] for t in f["tables"] if t.get("order_id")}
for f in boot["floors"]:
    for t in f["tables"]:
        if t["id"] not in open_tables:
            free_table = t
            break
    if free_table:
        break
status, order = call("POST", "/api/orders", {"tableId": free_table["id"], "guestCount": 1}, token=token)
check("adisyon açıldı", status == 200 and "id" in order, status)
variant_id = target["variants"][0]["id"] if target["variants"] else None
status, res = call(
    "POST",
    f"/api/orders/{order['id']}/lines",
    {"productId": target["id"], "variantId": variant_id, "qty": 1, "modifierIds": []},
    token=token,
)
check("pasif ürün siparişe eklenemiyor", status == 400 and "pasif" in res.get("error", ""), res.get("error", ""))
call("POST", f"/api/orders/{order['id']}/void", {"reason": "Test iptali"}, token=token)

# Tekrar aktif
status, res = call("PATCH", f"/api/admin/products/{target['id']}/active", {"active": True}, token=token)
check("tekrar aktif", status == 200 and res.get("active") is True, res.get("error", ""))

status, boot = call("GET", "/api/bootstrap", token=token)
ids = [p["id"] for c in boot["menu"] for p in c["products"]]
check("POS menüsüne döndü", target["id"] in ids, len(ids))

print(f"\n=== SONUÇ: {ok} geçti, {fail} hata ===")
raise SystemExit(1 if fail else 0)
