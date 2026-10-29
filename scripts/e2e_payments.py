"""Soprano ödeme/iskonto/allocation/iptal raporu e2e testi.
Sunucu temiz PGlite ile açıkken: python scripts/e2e_payments.py
"""
import datetime as dt
import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8095"


def call(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("content-type", "application/json")
    if token:
        req.add_header("authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return response.status, json.loads(response.read().decode() or "{}")
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read().decode() or "{}")


FAILED = False


def ok(label, condition, extra=""):
    global FAILED
    print(("PASS " if condition else "FAIL ") + label + (" :: " + str(extra) if extra else ""))
    if not condition:
        FAILED = True

# Personel ve vardiya
status, waiter_login = call("POST", "/api/auth/pin", {"pin": "1111"})
ok("garson login", status == 200 and waiter_login.get("user", {}).get("role") == "waiter")
waiter = waiter_login.get("token")
status, cashier_login = call("POST", "/api/auth/pin", {"pin": "2222"})
ok("kasiyer login", status == 200 and cashier_login.get("user", {}).get("role") == "cashier")
cashier = cashier_login.get("token")
status, manager_login = call("POST", "/api/auth/pin", {"pin": "1234"})
ok("yönetici login", status == 200 and manager_login.get("user", {}).get("role") == "manager")
manager = manager_login.get("token")

status, shift = call("POST", "/api/shift/open", {"openingFloat": 50000}, token=cashier)
ok("temiz vardiya açıldı", status == 200 and shift.get("id"), shift)

status, boot = call("GET", "/api/bootstrap", token=waiter)
ok("bootstrap", status == 200 and boot.get("floors"), status)
table = boot["floors"][0]["tables"][0]

pizzas = boot["menu"][0]["products"]
drinks = boot["menu"][2]["products"]
margarita = next(p for p in pizzas if p["name"] == "Margarita")
kola = next(p for p in drinks if p["name"] == "Kola")
big = next(v for v in margarita["variants"] if v["name"] == "Büyük")
kola_variant = kola["variants"][0]

# Ana adisyon: 300,00 + 2x40,00 = 380,00 TL
status, order = call("POST", "/api/orders", {"tableId": table["id"], "guestCount": 2}, token=waiter)
ok("adisyon açıldı", status == 200 and order.get("id"), order)
order_id = order["id"]
status, order = call(
    "POST",
    f"/api/orders/{order_id}/lines",
    {"productId": margarita["id"], "variantId": big["id"], "qty": 1, "modifierIds": []},
    token=waiter,
)
ok("Margarita eklendi", status == 200 and len(order.get("lines", [])) == 1, order)
margarita_line = order["lines"][0]["id"]
status, order = call(
    "POST",
    f"/api/orders/{order_id}/lines",
    {"productId": kola["id"], "variantId": kola_variant["id"], "qty": 2, "modifierIds": []},
    token=waiter,
)
ok("2x Kola eklendi", status == 200 and len(order.get("lines", [])) == 2, order)
kola_line = order["lines"][1]["id"]
ok("brüt 380,00 TL", order.get("totals", {}).get("total") == 38000, order.get("totals"))

# Garson ödeme alamaz; kasiyer %10 iskonto ile yalnız Margarita'yı alır.
status, denied = call(
    "POST",
    f"/api/orders/{order_id}/pay",
    {"payments": [{"method": "cash", "amount": 27000, "tendered": 27000, "allocations": [{"lineId": margarita_line, "qty": 1}]}], "discount": {"type": "percent", "value": 10}},
    token=waiter,
)
ok("garson ödeme alamaz", status == 403, denied)

status, partial = call(
    "POST",
    f"/api/orders/{order_id}/pay",
    {
        "payments": [
            {
                "method": "cash",
                "amount": 27000,
                "tendered": 30000,
                "allocations": [{"lineId": margarita_line, "qty": 1}],
            }
        ],
        "discount": {"type": "percent", "value": 10},
        "customerName": "Ayşe Yılmaz",
    },
    token=cashier,
)
ok("Margarita kısmi ödeme + iskonto", status == 200 and partial.get("change") == 3000, partial)
status, after_partial = call("GET", f"/api/orders/{order_id}", token=waiter)
ok("adisyon kısmi açık", status == 200 and after_partial.get("status") == "open", after_partial)
ok("müşteri adı kaydedildi", after_partial.get("customer_name") == "Ayşe Yılmaz", after_partial)
ok("iskonto 38,00 TL", after_partial.get("discount", {}).get("amount") == 3800, after_partial.get("discount"))
ok("Margarita allocation 270,00 TL", after_partial.get("paid") == 27000, after_partial.get("paid"))
ok("kalan Kola 72,00 TL", after_partial.get("remaining") == 7200, after_partial.get("remaining"))

# Kalan satırı kapat.
status, final_pay = call(
    "POST",
    f"/api/orders/{order_id}/pay",
    {
        "payments": [
            {
                "method": "card",
                "amount": 7200,
                "tendered": 7200,
                "allocations": [{"lineId": kola_line, "qty": 2}],
            }
        ],
        "discount": {"type": "percent", "value": 10},
        "customerName": "Ayşe Yılmaz",
    },
    token=cashier,
)
ok("Kola kart ödemesi", status == 200 and final_pay.get("status") == "paid", final_pay)
status, paid_order = call("GET", f"/api/orders/{order_id}", token=waiter)
ok("adisyon kapandı", status == 200 and paid_order.get("status") == "paid", paid_order.get("status"))
ok("net toplam 342,00 TL", paid_order.get("totals", {}).get("total") == 34200, paid_order.get("totals"))

# Günlük rapor: net ciro 342,00; para üstü 30,00 ciroya girmez; müşteri görünür.
today = dt.datetime.now(dt.UTC).date().isoformat()
status, report = call("GET", f"/api/reports/daily?date={today}", token=manager)
ok("rapor net ciro 342,00 TL", status == 200 and report.get("revenue") == 34200, report.get("revenue"))
ok("rapor iskonto 38,00 TL", report.get("discountTotal") == 3800, report.get("discountTotal"))
ok("raporda müşteri adı", any(row.get("customer_name") == "Ayşe Yılmaz" for row in report.get("paidOrders", [])), report.get("paidOrders"))
ok("raporda ödeme dağılımı", {m["method"]: m["amount"] for m in report.get("byMethod", [])} == {"cash": 27000, "card": 7200}, report.get("byMethod"))

# Void adisyonu raporda görünür, ciroya girmez.
status, void_order = call("POST", "/api/orders", {"tableId": boot["floors"][0]["tables"][1]["id"], "guestCount": 1}, token=waiter)
void_id = void_order.get("id")
status, void_order = call(
    "POST",
    f"/api/orders/{void_id}/lines",
    {"productId": margarita["id"], "variantId": big["id"], "qty": 1, "modifierIds": []},
    token=waiter,
)
void_line = void_order.get("lines", [{}])[0].get("id")
status, voided = call("POST", f"/api/orders/{void_id}/void", {"reason": "Müşteri vazgeçti"}, token=manager)
ok("adisyon nedeni ile iptal", status == 200 and voided.get("orderId") == void_id, voided)
status, report_after_void = call("GET", f"/api/reports/daily?date={today}", token=manager)
ok("iptal raporu nedeni", any(row.get("order_id") == void_id and row.get("reason") == "Müşteri vazgeçti" for row in report_after_void.get("voidedOrders", [])), report_after_void.get("voidedOrders"))
ok("iptal ciroya girmez", report_after_void.get("revenue") == 34200, report_after_void.get("revenue"))

# Geçersiz boş neden reddedilir.
status, another = call("POST", "/api/orders", {"tableId": boot["floors"][0]["tables"][2]["id"], "guestCount": 1}, token=waiter)
status, rejected = call("POST", f"/api/orders/{another.get('id')}/void", {"reason": "x"}, token=manager)
ok("kısa iptal nedeni reddedilir", status == 400, rejected)

print("\n=== SONUÇ:", "TÜMÜ GEÇTİ" if not FAILED else "HATA VAR", "===")
sys.exit(1 if FAILED else 0)
