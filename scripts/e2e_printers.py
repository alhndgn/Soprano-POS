#!/usr/bin/env python3
"""Yazıcı ayarları uçtan uca testi.

Köprü çalışırken koşulmalı (npm run bridge). Test, iki rol için 'file'
taşımalı yazıcı tanımlar, test fişi gönderir ve işin basıldığını doğrular.
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
check("yonetici girişi", status == 200 and "token" in login, status)
token = login.get("token", "")

# Önceki test yazıcılarını temizle
status, data = call("GET", "/api/admin/printers", token=token)
check("yazıcı listesi", status == 200 and "printers" in data, status)
for p in data.get("printers", []):
    call("DELETE", f"/api/admin/printers/{p['id']}", token=token)

status, res = call(
    "POST",
    "/api/admin/printers",
    {"name": "Test Mutfak", "device": "kitchen", "transport": "file", "address": "test-kitchen", "paperWidth": 80, "enabled": True},
    token=token,
)
check("mutfak yazıcısı eklendi", status == 200, res.get("error", ""))
kitchen_id = res.get("printer", {}).get("id")

status, res = call(
    "POST",
    "/api/admin/printers",
    {"name": "Test Kasa", "device": "receipt", "transport": "file", "address": "test-receipt", "paperWidth": 58, "enabled": True},
    token=token,
)
check("kasa yazıcısı eklendi", status == 200, res.get("error", ""))
receipt_id = res.get("printer", {}).get("id")
check("58 mm yazıcı 32 karakter", res.get("printer", {}).get("chars") == 32, res.get("printer", {}).get("chars"))

# Geçersiz adres reddedilmeli
status, res = call(
    "POST",
    "/api/admin/printers",
    {"name": "Bozuk", "device": "kitchen", "transport": "network", "address": "abc:def", "paperWidth": 80, "enabled": False},
    token=token,
)
check("geçersiz ağ adresi reddedildi", status == 400, res.get("error", ""))

# Aynı rol için ikinci aktif yazıcı: önceki pasife düşmeli
status, res = call(
    "POST",
    "/api/admin/printers",
    {"name": "Test Mutfak 2", "device": "kitchen", "transport": "file", "address": "test-kitchen-2", "paperWidth": 80, "enabled": True},
    token=token,
)
check("ikinci mutfak yazıcısı eklendi", status == 200, res.get("error", ""))
second_kitchen = res.get("printer", {}).get("id")
status, data = call("GET", "/api/admin/printers", token=token)
actives = [p for p in data["printers"] if p["device"] == "kitchen" and p["enabled"]]
check("tek aktif mutfak yazıcısı", len(actives) == 1, len(actives))

# Test yazıcısını geri al (aktif olan ikinci)
if second_kitchen:
    call("DELETE", f"/api/admin/printers/{second_kitchen}", token=token)
# 58 mm kasa yazıcısı kalsın, mutfak ilk tanım geri gelsin
status, res = call(
    "POST",
    "/api/admin/printers",
    {"name": "Test Mutfak", "device": "kitchen", "transport": "file", "address": "test-kitchen", "paperWidth": 80, "enabled": True},
    token=token,
)
kitchen_id = res.get("printer", {}).get("id")
check("mutfak yeniden tanımlandı", status == 200, res.get("error", ""))

# Test fişleri
status, res = call("POST", f"/api/admin/printers/{kitchen_id}/test", token=token)
check("mutfak test fişi kuyruğa girdi", status == 200 and "job" in res, status)
kot_job = res.get("job", {}).get("id")

status, res = call("POST", f"/api/admin/printers/{receipt_id}/test", token=token)
check("kasa test fişi kuyruğa girdi", status == 200 and "job" in res, status)
receipt_job = res.get("job", {}).get("id")

# Köprünün işi almasını bekle
deadline = time.time() + 40
statuses = {}
while time.time() < deadline:
    _, data = call("GET", "/api/admin/printers", token=token)
    for job in data.get("jobs", []):
        if job["id"] in (kot_job, receipt_job):
            statuses[job["id"]] = job
    if all(statuses.get(j, {}).get("status") in ("printed", "failed") for j in (kot_job, receipt_job)):
        break
    time.sleep(1)

for job_id, label in ((kot_job, "mutfak"), (receipt_job, "kasa")):
    job = statuses.get(job_id, {})
    check(f"{label} test işi basıldı", job.get("status") == "printed", job.get("error") or job.get("status"))
    check(f"{label} yazıcı adı kayıtlı", bool(job.get("printer_name")), job.get("printer_name"))

# Kuyruktaki işler yazıcı bilgisiyle dönmeli (köprü sözleşmesi)
status, jobs = call("GET", "/api/print/jobs")
check("köprü kuyruğu erişilebilir", status == 200, status)

# Bekleyen işler için köprü sözleşmesini doğrula: printer alanı var
if isinstance(jobs, list):
    check("kuyrukta printer alanı var", all("printer" in j for j in jobs), len(jobs))

print(f"\n=== SONUÇ: {ok} geçti, {fail} hata ===")
raise SystemExit(1 if fail else 0)
