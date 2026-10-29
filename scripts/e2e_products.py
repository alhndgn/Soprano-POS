"""Ürün yönetimi + içindekiler uçtan uca testi.

Sunucu açıkken: python scripts/e2e_products.py
Kendi oluşturduğu ürünü ve adisyonu temizler.
"""
import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8095"
failed = False


def call(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("content-type", "application/json")
    if token:
        req.add_header("authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def ok(label, cond, extra=None):
    global failed
    print(("PASS " if cond else "FAIL ") + label + (f" :: {extra}" if extra is not None else ""))
    if not cond:
        failed = True


s, boss = call("POST", "/api/auth/pin", {"pin": "1234"})
T = boss["token"]

# 1) seçenek grupları
s, groups = call("GET", "/api/admin/modifier-groups", token=T)
ok("modifier grupları", s == 200 and any(g["name"] == "Hamur" for g in groups), [g["name"] for g in groups])

# 2) mevcut üründe açıklama + içerik var mı
s, boot = call("GET", "/api/bootstrap", token=T)
margarita = [p for p in boot["menu"][0]["products"] if p["name"] == "Margarita"][0]
ok("hazırlanış metni tohumlandı", bool(margarita["description"]) and len(margarita["description"]) > 60, len(margarita["description"] or ""))
ok("içindekiler tohumlandı", len(margarita["ingredients"]) >= 4, [i["name"] for i in margarita["ingredients"]])
ok("ekstra içerik fiyatlı", any(not i["included"] and i["price"] > 0 for i in margarita["ingredients"]))

# 3) yeni ürün oluştur
cat = boot["menu"][0]["id"]
payload = {
    "name": "Test Pizza",
    "categoryId": cat,
    "vatRate": 10,
    "description": "Test açıklaması: taş fırında pişirilir, üzerine taze fesleğen eklenir.",
    "imageUrl": None,
    "sizes": [{"name": "Küçük", "price": 15000}, {"name": "Büyük", "price": 22000}],
    "ingredients": [
        {"name": "Mozzarella", "price": 0, "included": True},
        {"name": "Fesleğen", "price": 0, "included": True},
        {"name": "Ekstra sucuk", "price": 3000, "included": False},
    ],
    "groupIds": [g["id"] for g in groups if g["name"] == "Hamur"],
}
s, created = call("POST", "/api/admin/products", payload, T)
ok("ürün oluşturuldu", s == 200 and created.get("id"), created)
pid = created["id"]

s, detail = call("GET", f"/api/admin/products/{pid}", token=T)
ok("ürün detayı: 2 boyut", len(detail["sizes"]) == 2, detail["sizes"])
ok("ürün detayı: 3 içerik", len(detail["ingredients"]) == 3, [i["name"] for i in detail["ingredients"]])
ok("seçenek grubu bağlı", groups[0]["id"] in detail["groupIds"] or len(detail["groupIds"]) == 1, detail["groupIds"])

# 4) güncelle: boyut fiyatı, içerik ekle/çıkar
payload["sizes"] = [
    {"id": detail["sizes"][0]["id"], "name": "Küçük", "price": 16000},
    {"id": detail["sizes"][1]["id"], "name": "Büyük", "price": 23000},
]
payload["ingredients"] = [
    {"id": detail["ingredients"][0]["id"], "name": "Mozzarella", "price": 0, "included": True},
    {"id": detail["ingredients"][2]["id"], "name": "Ekstra sucuk", "price": 3500, "included": False},
    {"name": "Mantar", "price": 0, "included": True},
]
s, _ = call("PUT", f"/api/admin/products/{pid}", payload, T)
s, detail2 = call("GET", f"/api/admin/products/{pid}", token=T)
ok("boyut fiyatı güncellendi", detail2["sizes"][1]["price"] == 23000, detail2["sizes"])
ok("içerik eklendi (Mantar)", any(i["name"] == "Mantar" for i in detail2["ingredients"]), [i["name"] for i in detail2["ingredients"]])
ok("çıkarılan içerik pasife alındı", not any(i["name"] == "Fesleğen" for i in detail2["ingredients"]), [i["name"] for i in detail2["ingredients"]])
ok("ekstra fiyatı güncellendi", [i for i in detail2["ingredients"] if i["name"] == "Ekstra sucuk"][0]["price"] == 3500)

# 5) siparişte içerik değiştir
s, boot2 = call("GET", "/api/bootstrap", token=T)
free = [t for f in boot2["floors"] for t in f["tables"] if not t["order"]]
ok("boş masa var", len(free) > 0, len(free))
table = free[0]
s, order = call("POST", "/api/orders", {"tableId": table["id"], "guestCount": 2}, T)
prod = [p for p in boot2["menu"][0]["products"] if p["id"] == pid][0]
big = [v for v in prod["variants"] if v["name"] == "Büyük"][0]
moz = [i for i in prod["ingredients"] if i["name"] == "Mozzarella"][0]
sucuk = [i for i in prod["ingredients"] if i["name"] == "Ekstra sucuk"][0]

s, o = call(
    "POST",
    f"/api/orders/{order['id']}/lines",
    {
        "productId": pid,
        "variantId": big["id"],
        "qty": 1,
        "modifierIds": [],
        "ingredients": [{"id": moz["id"], "mode": "removed"}, {"id": sucuk["id"], "mode": "added"}],
        "note": "soğansız",
    },
    T,
)
line = o["lines"][0]
ok("çıkarılan içerik kaydedildi", any(i["mode"] == "removed" and i["name"] == "Mozzarella" for i in line["ingredients"]), line["ingredients"])
ok("eklenen içerik kaydedildi", any(i["mode"] == "added" and i["name"] == "Ekstra sucuk" for i in line["ingredients"]))
ok("ekstra fiyat toplama girdi", o["totals"]["total"] == 23000 + 3500, o["totals"]["total"])

# 6) mutfağa gönder: KOT içerik değişimini taşıyor mu
call("POST", f"/api/orders/{order['id']}/send", {}, T)
s, jobs = call("GET", "/api/print/jobs")
kot = [j for j in jobs if j["kind"] == "kot" and j["payload"]["orderId"] == order["id"]]
ok("KOT kuyruğa girdi", len(kot) == 1, len(kot))
if kot:
    l0 = kot[0]["payload"]["lines"][0]
    ok("KOT'ta çıkarılan var", "Mozzarella" in (l0.get("removed") or []), l0.get("removed"))
    ok("KOT'ta eklenen var", "Ekstra sucuk" in (l0.get("added") or []), l0.get("added"))

# 7) ürünü menüden kaldır
s, _ = call("DELETE", f"/api/admin/products/{pid}", token=T)
s, boot3 = call("GET", "/api/bootstrap", token=T)
ids = [p["id"] for c in boot3["menu"] for p in c["products"]]
ok("ürün menüden kalktı", pid not in ids)

# 8) temizlik: test adisyonunu iptal et
call("POST", f"/api/orders/{order['id']}/void", {"reason": "Ürün yönetimi e2e temizliği"}, T)

print("\n=== SONUÇ:", "TÜMÜ GEÇTİ" if not failed else "HATA VAR", "===")
sys.exit(1 if failed else 0)
