"""Masa düzeni + ürün görseli uçtan uca testi.

Çalıştırma: sunucu açıkken `python scripts/e2e_layout.py`
Temiz veritabanı gerektirmez; kendi oluşturduğu bölme/masayı siler.
"""
import json, urllib.request, urllib.error, sys

BASE = "http://127.0.0.1:8095"
failed = False


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


def ok(label, cond, extra=None):
    global failed
    print(("PASS " if cond else "FAIL ") + label + (" :: " + str(extra) if extra else ""))
    if not cond:
        failed = True


s, boss = call("POST", "/api/auth/pin", {"pin": "1234"})
T = boss["token"]

# 1) mevcut plan: konumlar atanmış mı?
s, floors = call("GET", "/api/admin/layout", token=T)
ok("layout uçları", s == 200 and len(floors) >= 2, [f["name"] for f in floors])
first_floor = floors[0]
tables = first_floor["tables"]
ok("masalar konumlandırılmış", all(t["x"] > 0 or t["y"] > 0 for t in tables), [(t["name"], t["x"], t["y"]) for t in tables][:3])
ok("şekil alanı var", all(t["shape"] in ("square", "round", "rect") for t in tables), [t["shape"] for t in tables])
ok("bahçe masaları yuvarlak", any(t["shape"] == "round" for f in floors for t in f["tables"]), None)

# 2) bootstrap da konum/şekil/görsel döndürüyor mu?
s, boot = call("GET", "/api/bootstrap", token=T)
bt = boot["floors"][0]["tables"][0]
ok("bootstrap masa konumu", "x" in bt and "shape" in bt, bt.get("shape"))
prod = boot["menu"][0]["products"][0]
ok("bootstrap ürün görsel alanı", "imageUrl" in prod, prod.get("imageUrl"))

# 3) bölme oluştur
s, fl = call("POST", "/api/admin/floors", {"name": "Test Teras"}, token=T)
ok("bölme oluştur", s == 200 and fl.get("id"), fl)

# 4) iki masa ekle (biri yuvarlak)
s, t1 = call("POST", "/api/admin/tables", {"floorId": fl["id"], "shape": "round", "seats": 4, "x": 80, "y": 80}, token=T)
s2, t2 = call("POST", "/api/admin/tables", {"floorId": fl["id"], "name": "Bar 1", "shape": "rect", "seats": 6}, token=T)
ok("yuvarlak masa eklendi", s == 200 and t1["shape"] == "round" and t1["w"] == 120, t1)
ok("dikdörtgen masa eklendi", s2 == 200 and t2["shape"] == "rect" and t2["w"] == 170 and t2["name"] == "Bar 1", t2)

# 5) sürükle-bırak kaydı (toplu konum)
s, saved = call(
    "PUT",
    "/api/admin/layout",
    {
        "floorId": fl["id"],
        "tables": [
            {"id": t1["id"], "x": 300, "y": 200, "w": 120, "h": 110},
            {"id": t2["id"], "x": 520, "y": 200, "w": 170, "h": 110, "shape": "rect"},
        ],
    },
    token=T,
)
ok("düzen kaydedildi", s == 200 and saved["saved"] == 2, saved)

s, floors2 = call("GET", "/api/admin/layout", token=T)
tf = [f for f in floors2 if f["id"] == fl["id"]][0]
pos = {t["id"]: (t["x"], t["y"]) for t in tf["tables"]}
ok("konumlar kalıcı", pos[t1["id"]] == (300, 200) and pos[t2["id"]] == (520, 200), pos)

# 6) sınır taşması kırpılıyor mu? (x=5000 → 1000-w)
s, _ = call(
    "PUT",
    "/api/admin/layout",
    {"floorId": fl["id"], "tables": [{"id": t1["id"], "x": 5000, "y": -50, "w": 120, "h": 110}]},
    token=T,
)
s, floors3 = call("GET", "/api/admin/layout", token=T)
tf3 = [f for f in floors3 if f["id"] == fl["id"]][0]
clamped = [t for t in tf3["tables"] if t["id"] == t1["id"]][0]
ok("sınır dışı konum kırpıldı", clamped["x"] == 880 and clamped["y"] == 0, (clamped["x"], clamped["y"]))

# 7) masa güncelle
s, up = call("PATCH", f"/api/admin/tables/{t1['id']}", {"name": "Teras 1", "seats": 8, "shape": "square"}, token=T)
ok("masa güncelle", s == 200 and up["name"] == "Teras 1" and up["seats"] == 8 and up["shape"] == "square", up)

# 8) dolu bölme silinemez
s, err = call("DELETE", f"/api/admin/floors/{fl['id']}", token=T)
ok("masası olan bölme silinmez (400)", s == 400, err)

# 9) açık adisyonu olan masa silinemez
s, boot_now = call("GET", "/api/bootstrap", token=T)
occupied = [t for f in boot_now["floors"] for t in f["tables"] if t["order"]]
if occupied:
    s, err = call("DELETE", f"/api/admin/tables/{occupied[0]['id']}", token=T)
    ok("açık adisyonlu masa silinmez (400)", s == 400, err)
else:
    print("SKIP açık adisyonlu masa testi (açık adisyon yok)")

# 10) temizlik: masaları ve bölmeyi sil
call("DELETE", f"/api/admin/tables/{t1['id']}", token=T)
call("DELETE", f"/api/admin/tables/{t2['id']}", token=T)
s, d = call("DELETE", f"/api/admin/floors/{fl['id']}", token=T)
ok("bölme silindi", s == 200 and d.get("ok"), d)

print("\n=== SONUÇ:", "TÜMÜ GEÇTİ" if not failed else "HATA VAR", "===")
sys.exit(1 if failed else 0)
