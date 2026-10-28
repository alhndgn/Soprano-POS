"""Demo durumunu tazeler: açık adisyonları iptal eder, vardiyayı yeniden açar,
birkaç dolu masa oluşturur. Sunucu açıkken: python scripts/reset_demo.py <token>
"""
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
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def main():
    token = sys.argv[1]
    s, boot = call("GET", "/api/bootstrap", token=token)
    tables = [t for f in boot["floors"] for t in f["tables"]]

    # 1) açık adisyonları iptal et
    voided = 0
    for t in tables:
        if t.get("order"):
            s, _ = call("POST", f"/api/orders/{t['order']['id']}/void", {}, token)
            if s == 200:
                voided += 1
    print("iptal edilen adisyon:", voided)

    # 2) eski vardiyayı kapat, yenisini aç
    s, sh = call("POST", "/api/shift/close", {"closingCount": 50000}, token)
    print("eski vardiya:", s)
    s, sh = call("POST", "/api/shift/open", {"openingFloat": 50000}, token)
    print("yeni vardiya:", s, sh.get("opened_at"))

    # 3) demo adisyonlar
    s, boot = call("GET", "/api/bootstrap", token=token)
    floors = {f["name"]: f for f in boot["floors"]}
    pizzas = boot["menu"][0]["products"]
    drinks = boot["menu"][2]["products"]
    starters = boot["menu"][1]["products"]

    def table(floor, name):
        return [t for t in floors[floor]["tables"] if t["name"] == name][0]

    def add(order_id, product, variant_name, qty=1, mods=(), note=None):
        v = [x for x in product["variants"] if x["name"] == variant_name][0]
        ids = {m["name"]: m["id"] for g in product["groups"] for m in g["modifiers"]}
        body = {"productId": product["id"], "variantId": v["id"], "qty": qty, "modifierIds": [ids[m] for m in mods]}
        if note:
            body["note"] = note
        return call("POST", f"/api/orders/{order_id}/lines", body, token)

    # Masa 2 — mutfakta
    s, o1 = call("POST", "/api/orders", {"tableId": table("İç Salon", "Masa 2")["id"], "guestCount": 2}, token)
    add(o1["id"], pizzas[1], "Büyük", 1, ["İnce Hamur", "Ekstra Peynir"], "iyi pişsin")
    add(o1["id"], pizzas[3], "Orta", 1, ["İnce Hamur"])
    add(o1["id"], drinks[0], "33cl", 2)
    call("POST", f"/api/orders/{o1['id']}/send", {}, token)

    # Masa 4 — hazırlanıyor
    s, o2 = call("POST", "/api/orders", {"tableId": table("İç Salon", "Masa 4")["id"], "guestCount": 3}, token)
    add(o2["id"], pizzas[5], "Büyük", 2, ["İnce Hamur", "Jalapeno", "Mısır"], "acı olsun")
    add(o2["id"], drinks[3], "40cl", 3)
    call("POST", f"/api/orders/{o2['id']}/send", {}, token)

    # Bahçe 1 — henüz gönderilmedi
    s, o3 = call("POST", "/api/orders", {"tableId": table("Bahçe", "Bahçe 1")["id"], "guestCount": 4}, token)
    add(o3["id"], pizzas[0], "Orta", 2, ["Kalın Hamur", "Sucuk"])
    add(o3["id"], starters[0], "Standart", 1)
    add(o3["id"], drinks[1], "30cl", 4)

    # KDS'te bir satırı "hazırlanıyor"a çek
    s, kds = call("GET", "/api/kds", token=token)
    if kds.get("lines"):
        call("POST", f"/api/kds/lines/{kds['lines'][0]['id']}/status", {"status": "preparing"}, token)

    print("demo hazır:", o1["id"], o2["id"], o3["id"])


if __name__ == "__main__":
    main()
