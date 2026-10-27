# Soprano POS uctan uca API testi. Sunucu acikken: python scripts/e2e.py
# Not: temiz veritabani bekler (acik vardiya yoksa).
"""Soprano POS uçtan uca API testi — gerçek HTTP çağrıları."""
import json, urllib.request, urllib.error, sys

BASE = "http://127.0.0.1:8095"

def call(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("content-type", "application/json")
    if token:
        req.add_header("authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

def ok(label, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + label + (" :: " + str(extra) if extra else ""))
    if not cond:
        ok.failed = True
ok.failed = False

# 1) girişler
s, login = call("POST", "/api/auth/pin", {"pin": "1111"})
ok("garson PIN girişi", s == 200 and login["user"]["role"] == "waiter", login)
waiter = login["token"]
s, boss = call("POST", "/api/auth/pin", {"pin": "1234"})
boss_t = boss["token"]

s, bad = call("POST", "/api/auth/pin", {"pin": "9999"})
ok("hatalı PIN 401", s == 401, s)

s, boot = call("GET", "/api/bootstrap", token=waiter)
ok("bootstrap", s == 200 and len(boot["floors"]) == 2, len(boot["menu"]))

# 2) vardiya — garson açamaz, kasiyer/patron açar
s, d = call("POST", "/api/shift/open", {"openingFloat": 50000}, token=waiter)
ok("garson vardiya açamaz (403)", s == 403, s)

s, cashier = call("POST", "/api/auth/pin", {"pin": "2222"})
s, sh = call("POST", "/api/shift/open", {"openingFloat": 50000}, token=cashier["token"])
ok("kasiyer vardiya açar", s == 200 and sh.get("id"), sh)

# 3) masa + sipariş
table = boot["floors"][0]["tables"][0]
s, order = call("POST", "/api/orders", {"tableId": table["id"], "guestCount": 2}, token=waiter)
ok("masada adisyon aç", s == 200 and order["id"], order)

pizzas = boot["menu"][0]
margarita = pizzas["products"][0]
buyuk = [v for v in margarita["variants"] if v["name"] == "Büyük"][0]
ekstra = [g for g in margarita["groups"] if g["name"] == "Ek Malzeme"][0]
mantar = [m for m in ekstra["modifiers"] if m["name"] == "Mantar"][0]

s, o = call("POST", f"/api/orders/{order['id']}/lines",
            {"productId": margarita["id"], "variantId": buyuk["id"], "qty": 2, "modifierIds": [mantar["id"]], "note": "iyi pişsin"},
            token=waiter)
ok("pizza satırı (2x Büyük + Mantar)", s == 200 and len(o["lines"]) == 1, o.get("error"))

# KDV hesabı: (34000 + 2000) * 2 = 72000 kuruş, %10 dahil
s, o = call("GET", f"/api/orders/{order['id']}", token=waiter)
ok("ara toplam 640,00 TL (300+Mantar=320 ×2)", o["totals"]["total"] == 64000, o["totals"])
ok("KDV %10 = 58,18 TL", o["totals"]["vat"] == 5818, o["totals"]["vatLines"])

drinks = boot["menu"][2]
kola = drinks["products"][0]
kola_v = kola["variants"][0]
s, o2 = call("POST", f"/api/orders/{order['id']}/lines", {"productId": kola["id"], "variantId": kola_v["id"], "qty": 2}, token=waiter)
ok("2x kola eklendi", s == 200 and len(o2["lines"]) == 2, o2.get("error"))
ok("toplam 720,00 TL (KDV karışık)", o2["totals"]["total"] == 72000, o2["totals"]["total"])
ok("iki KDV dilimi (10 + 20)", sorted(v["rate"] for v in o2["totals"]["vatLines"]) == [10, 20], o2["totals"]["vatLines"])

# 4) mutfağa gönder
s, sent = call("POST", f"/api/orders/{order['id']}/send", None, token=waiter)
ok("mutfağa gönderildi", s == 200 and all(l["status"] == "sent" for l in sent["lines"]), [l["status"] for l in sent["lines"]])

s, kds = call("GET", "/api/kds", token=waiter)
ok("KDS 2 satır gösteriyor", s == 200 and len(kds["lines"]) == 2, len(kds["lines"]))
line_id = kds["lines"][0]["id"]
s, _ = call("POST", f"/api/kds/lines/{line_id}/status", {"status": "preparing"}, token=waiter)
s, kds2 = call("GET", "/api/kds", token=waiter)
ok("KDS durum: hazırlanıyor", any(l["status"] == "preparing" for l in kds2["lines"]), [l["status"] for l in kds2["lines"]])

# 5) ödeme — garson ödeyemez, kasiyer öder
s, d = call("POST", f"/api/orders/{order['id']}/pay", {"payments": [{"method": "cash", "amount": 80000}]}, token=waiter)
ok("garson ödeme alamaz (403)", s == 403, s)

s, d = call("POST", f"/api/orders/{order['id']}/pay", {"payments": [{"method": "cash", "amount": 50000}]}, token=cashier["token"])
ok("eksik ödeme reddedilir", s == 400, s)

s, pay = call("POST", f"/api/orders/{order['id']}/pay",
              {"payments": [{"method": "card", "amount": 50000}, {"method": "cash", "amount": 40000}]},
              token=cashier["token"])
ok("karma ödeme (kart 500 + nakit 400 = 900, para üstü 180)", s == 200 and pay["change"] == 18000, pay)

s, o3 = call("GET", f"/api/orders/{order['id']}", token=waiter)
ok("adisyon kapandı (paid)", o3["status"] == "paid", o3["status"])

# 6) fiş işleri
s, jobs = call("GET", "/api/print/jobs", token=boss_t)
kinds = sorted(j["kind"] for j in jobs)
ok("KOT + adisyon fişi kuyruğa girdi", kinds == ["kot", "receipt"], kinds)
receipt = [j for j in jobs if j["kind"] == "receipt"][0]
ok("fiş payload doğru toplam", receipt["payload"]["total"] == 72000, receipt["payload"]["total"])
ok("para üstü 180,00 TL", receipt["payload"]["change"] == 18000, receipt["payload"]["change"])

# 7) rapor
s, rep = call("GET", "/api/reports/daily", token=boss_t)
ok("rapor cirosu 720,00 TL", s == 200 and rep["revenue"] == 72000, rep.get("revenue"))
ok("ödeme dağılımı: 500 kart + 220 nakit (para üstü ciroya yazılmaz)",
   {m["method"]: m["amount"] for m in rep["byMethod"]} == {"card": 50000, "cash": 22000},
   rep["byMethod"])
ok("saatlik toplam = ciro", sum(h["amount"] for h in rep["hourly"]) == rep["revenue"], (rep["hourly"], rep["revenue"]))
ok("en çok satan pizza", rep["topProducts"][0]["qty"] == 2, rep["topProducts"][0])

# 8) vardiya kapanışı
s, sc = call("POST", "/api/shift/close", {"closingCount": 90000}, token=cashier["token"])
ok("vardiya kapanışı", s == 200 and sc.get("closed_at"), sc)

print("\n=== SONUÇ:", "TÜMÜ GEÇTİ" if not ok.failed else "HATA VAR", "===")
sys.exit(1 if ok.failed else 0)
