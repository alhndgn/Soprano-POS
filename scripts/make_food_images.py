"""Demo yemek görselleri üretir ve ürünlere yükler.

Kullanım: python scripts/make_food_images.py <token>
Görseller var/demo-images/ altına yazılır, ardından API'ye multipart yüklenir.
Gerçek fotoğraflar geldiğinde bu betik gerekmez.
"""
import json
import math
import os
import random
import sys
import urllib.request

from PIL import Image, ImageDraw, ImageFilter

BASE = "http://127.0.0.1:8095"
W, H = 560, 420
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "var", "demo-images")


def background():
    # açık, sıcak zemin: beyaz kartların üstünde doğal dursun
    img = Image.new("RGB", (W, H), "#fffdfb")
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=(int(255 - 6 * t), int(250 - 10 * t), int(245 - 12 * t)))
    d.ellipse((-120, -160, 320, 220), fill=(255, 240, 236))
    d.ellipse((W - 240, H - 200, W + 120, H + 80), fill=(255, 246, 232))
    return img.filter(ImageFilter.GaussianBlur(18))


def jitter(color, amount=10, rnd=random):
    c = color.lstrip("#")
    r, g, b = (int(c[i : i + 2], 16) for i in (0, 2, 4))
    f = lambda v: max(0, min(255, v + rnd.randint(-amount, amount)))
    return (f(r), f(g), f(b))


def drop_shadow(img, box, blur=18):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse(box, fill=(90, 62, 45, 55))
    return Image.alpha_composite(img.convert("RGBA"), layer.filter(ImageFilter.GaussianBlur(blur))).convert("RGB")


def pizza(kind, rnd):
    img = background()
    cx, cy, r = W // 2, H // 2 - 4, 158
    img = drop_shadow(img, (cx - r + 6, cy + r - 54, cx + r + 6, cy + r + 26))
    d = ImageDraw.Draw(img)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill="#e3a95c")
    d.ellipse((cx - r + 13, cy - r + 13, cx + r - 13, cy + r - 13), fill="#cf8434")
    d.ellipse((cx - r + 26, cy - r + 26, cx + r - 26, cy + r - 26), fill="#b8412f")

    for _ in range(70):
        a = rnd.random() * math.tau
        dist = rnd.random() * (r - 44)
        px, py = cx + math.cos(a) * dist, cy + math.sin(a) * dist
        rr = rnd.randint(12, 26)
        d.ellipse((px - rr, py - rr, px + rr, py + rr), fill=jitter("#f3c56b", 12, rnd))
    d.ellipse((cx - r + 40, cy - r + 40, cx + r - 40, cy + r - 40), fill="#f6cf7c")

    def scatter(n, color, rr, ring_min=0.35):
        for _ in range(n):
            a = rnd.random() * math.tau
            dist = (ring_min + rnd.random() * (1 - ring_min)) * (r - 52)
            px, py = cx + math.cos(a) * dist, cy + math.sin(a) * dist
            d.ellipse((px - rr, py - rr, px + rr, py + rr), fill=jitter(color, 8, rnd))
            d.ellipse((px - rr + 2, py - rr + 2, px + rr - 4, py + rr - 4), fill=jitter(color, 14, rnd))

    if kind == "margarita":
        scatter(9, "#e8503f", 17)
        for _ in range(10):
            a = rnd.random() * math.tau
            dist = rnd.random() * (r - 60)
            px, py = cx + math.cos(a) * dist, cy + math.sin(a) * dist
            d.ellipse((px - 7, py - 5, px + 7, py + 7), fill="#3f7d3a")
    elif kind == "pepperoni":
        scatter(12, "#c0392b", 19)
        scatter(6, "#2f2a24", 8)
    elif kind == "cheese":
        scatter(28, "#f7dca0", 13)
        scatter(8, "#e2c078", 7)
    elif kind == "veggie":
        for _ in range(12):
            a = rnd.random() * math.tau
            dist = rnd.random() * (r - 66)
            px, py = cx + math.cos(a) * dist, cy + math.sin(a) * dist
            w2 = rnd.randint(18, 28)
            d.ellipse((px - w2, py - 8, px + w2, py + 8), outline="#3f7d3a", width=5)
        scatter(7, "#c0392b", 12)
        scatter(6, "#f2d06b", 6)
    elif kind == "chicken":
        for _ in range(14):
            a = rnd.random() * math.tau
            dist = rnd.random() * (r - 62)
            px, py = cx + math.cos(a) * dist, cy + math.sin(a) * dist
            d.rounded_rectangle((px - 15, py - 9, px + 15, py + 9), radius=7, fill=jitter("#c98b52", 12, rnd))
        scatter(6, "#7a3f2b", 12)
    else:
        scatter(8, "#c0392b", 17)
        scatter(5, "#3f7d3a", 11)
        scatter(4, "#2f2a24", 8)

    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((cx - 90, cy - 120, cx + 40, cy - 30), fill=(255, 255, 255, 26))
    return Image.alpha_composite(img.convert("RGBA"), glow.filter(ImageFilter.GaussianBlur(28))).convert("RGB")


def drink(color, garnish=None, glass_h=250):
    img = background()
    cx, top = W // 2, H // 2 - glass_h // 2
    img = drop_shadow(img, (cx - 90, top + glass_h - 24, cx + 90, top + glass_h + 30), blur=16)
    d = ImageDraw.Draw(img)
    wtop, wbot = 96, 78
    d.polygon([(cx - wtop, top), (cx + wtop, top), (cx + wbot, top + glass_h - 6), (cx - wbot, top + glass_h - 6)], fill=(226, 232, 239))
    d.polygon([(cx - wtop + 10, top + 26), (cx + wtop - 10, top + 26), (cx + wbot - 12, top + glass_h - 8), (cx - wbot + 12, top + glass_h - 8)], fill=color)
    d.polygon([(cx - wtop + 10, top + 26), (cx - wtop + 40, top + 26), (cx - wbot + 40, top + glass_h - 8), (cx - wbot + 12, top + glass_h - 8)], fill=(255, 255, 255, 40))
    d.ellipse((cx - wtop, top - 12, cx + wtop, top + 16), fill=(240, 244, 248), outline=(205, 212, 222), width=3)
    if garnish:
        d.rounded_rectangle((cx + 26, top - 46, cx + 36, top + 10), radius=5, fill="#d94f4f")
        d.ellipse((cx - 26, top - 26, cx + 12, top + 8), fill=garnish)
    return img


def starter(kind, rnd):
    img = background()
    d = ImageDraw.Draw(img)
    cx, cy = W // 2, H // 2
    img = drop_shadow(img, (cx - 158, cy + 40, cx + 158, cy + 120))
    d = ImageDraw.Draw(img)
    d.ellipse((cx - 168, cy - 120, cx + 168, cy + 116), fill="#f0e7dd", outline="#e2d6c8", width=3)
    d.ellipse((cx - 148, cy - 104, cx + 148, cy + 100), fill="#fffdf9")

    if kind == "garlic":
        for i, x in enumerate((-78, 0, 78)):
            d.rounded_rectangle((cx + x - 52, cy - 46 + (i % 2) * 10, cx + x + 52, cy + 34), radius=16, fill="#e0a75d")
            d.rounded_rectangle((cx + x - 42, cy - 34 + (i % 2) * 10, cx + x + 42, cy + 24), radius=12, fill="#f3d79c")
            for _ in range(6):
                px, py = cx + x + rnd.randint(-34, 34), cy + rnd.randint(-26, 16)
                d.ellipse((px - 4, py - 3, px + 4, py + 3), fill="#5f8a3f")
    elif kind == "mozzarella":
        for i in range(7):
            x = cx - 110 + (i % 4) * 70
            y = cy - 30 + (i // 4) * 62
            d.rounded_rectangle((x - 42, y - 22, x + 42, y + 22), radius=20, fill="#e8c079")
            d.rounded_rectangle((x - 34, y - 14, x + 34, y + 10), radius=14, fill="#f6e0ab")
    elif kind == "fries":
        d.polygon([(cx - 70, cy - 10), (cx + 70, cy - 10), (cx + 48, cy + 84), (cx - 48, cy + 84)], fill="#c0392b")
        for i in range(16):
            x = cx - 58 + i * 7
            h = rnd.randint(60, 100)
            d.rounded_rectangle((x, cy - h, x + 9, cy + 4), radius=4, fill=jitter("#f0b93f", 12, rnd))
    else:  # salad
        for _ in range(40):
            px, py = cx + rnd.randint(-110, 110), cy + rnd.randint(-70, 60)
            rr = rnd.randint(14, 26)
            d.ellipse((px - rr, py - rr // 2, px + rr, py + rr // 2), fill=jitter("#4f8f45", 18, rnd))
        for _ in range(9):
            px, py = cx + rnd.randint(-100, 100), cy + rnd.randint(-60, 40)
            d.ellipse((px - 15, py - 12, px + 15, py + 12), fill="#d94f4f")
    return img


def dessert(kind, rnd):
    img = background()
    d = ImageDraw.Draw(img)
    cx, cy = W // 2, H // 2
    img = drop_shadow(img, (cx - 130, cy + 40, cx + 130, cy + 110), blur=16)
    d = ImageDraw.Draw(img)
    d.ellipse((cx - 150, cy - 96, cx + 150, cy + 104), fill="#fffdf9", outline="#eadfd2", width=3)

    if kind == "tiramisu":
        d.rounded_rectangle((cx - 92, cy - 58, cx + 92, cy + 58), radius=12, fill="#e8dcc4")
        for i in range(5):
            d.rectangle((cx - 92, cy - 58 + i * 24, cx + 92, cy - 46 + i * 24), fill="#6b4a2f")
            d.rectangle((cx - 92, cy - 50 + i * 24, cx + 92, cy - 42 + i * 24), fill="#f4e9d2")
        d.rounded_rectangle((cx - 92, cy - 66, cx + 92, cy - 52), radius=6, fill="#3f2a1c")
    elif kind == "brownie":
        d.rounded_rectangle((cx - 96, cy - 52, cx + 96, cy + 60), radius=10, fill="#3f2a20")
        d.rounded_rectangle((cx - 96, cy - 62, cx + 96, cy - 40), radius=10, fill="#5a3b2b")
        for _ in range(24):
            px, py = cx + rnd.randint(-84, 84), cy + rnd.randint(-34, 48)
            d.ellipse((px - 4, py - 3, px + 4, py + 3), fill="#7a5236")
    else:  # cheesecake
        d.polygon([(cx - 110, cy - 46), (cx + 110, cy - 46), (cx + 74, cy + 58), (cx - 74, cy + 58)], fill="#f6e7bf")
        d.polygon([(cx - 110, cy - 46), (cx + 110, cy - 46), (cx + 104, cy - 30), (cx - 104, cy - 30)], fill="#d9b96a")
        for _ in range(14):
            px, py = cx + rnd.randint(-70, 70), cy + rnd.randint(-60, -36)
            d.ellipse((px - 9, py - 6, px + 9, py + 6), fill="#b32d2d")
    return img


PLAN = {
    "Margarita": ("pizza", "margarita"),
    "Soprano Special": ("pizza", "special"),
    "Pepperoni": ("pizza", "pepperoni"),
    "Dört Peynirli": ("pizza", "cheese"),
    "Vejetaryen": ("pizza", "veggie"),
    "BBQ Tavuk": ("pizza", "chicken"),
    "Sarımsaklı Ekmek": ("starter", "garlic"),
    "Mozzarella Sticks": ("starter", "mozzarella"),
    "Patates Kızartması": ("starter", "fries"),
    "Sezar Salata": ("starter", "salad"),
    "Kola": ("drink", (58, 26, 22)),
    "Ayran": ("drink", (238, 240, 235)),
    "Su": ("drink", (208, 226, 240)),
    "Limonata": ("drink", (242, 205, 92)),
    "Türk Kahvesi": ("drink", (104, 66, 44)),
    "Tiramisu": ("dessert", "tiramisu"),
    "Brownie": ("dessert", "brownie"),
    "Cheesecake": ("dessert", "cheesecake"),
}

SLUG = str.maketrans("ıöüşçğİÖÜŞÇĞ", "iouscgIOUSCG")


def build(name):
    kind, param = PLAN[name]
    rnd = random.Random(name)
    if kind == "pizza":
        return pizza(param, rnd)
    if kind == "drink":
        return drink(param, garnish=(180, 210, 90) if name == "Limonata" else None)
    if kind == "starter":
        return starter(param, rnd)
    return dessert(param, rnd)


def upload(token, product_id, path):
    boundary = "----soprano" + str(random.randint(10000, 99999))
    with open(path, "rb") as f:
        data = f.read()
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{os.path.basename(path)}"\r\n'
        f"Content-Type: image/jpeg\r\n\r\n"
    ).encode() + data + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(f"{BASE}/api/admin/products/{product_id}/image", data=body, method="POST")
    req.add_header("content-type", f"multipart/form-data; boundary={boundary}")
    req.add_header("authorization", "Bearer " + token)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def main():
    token = sys.argv[1]
    os.makedirs(OUT, exist_ok=True)
    req = urllib.request.Request(f"{BASE}/api/admin/menu")
    req.add_header("authorization", "Bearer " + token)
    menu = json.loads(urllib.request.urlopen(req, timeout=20).read().decode())
    by_name = {p["name"]: p["id"] for p in menu}

    done = 0
    for name in PLAN:
        if name not in by_name:
            print("atlandı:", name)
            continue
        path = os.path.join(OUT, name.lower().translate(SLUG).replace(" ", "-") + ".jpg")
        build(name).save(path, "JPEG", quality=88)
        res = upload(token, by_name[name], path)
        print(f"{name:20s} → {res.get('imageUrl')}")
        done += 1
    print(f"\n{done} görsel yüklendi.")


if __name__ == "__main__":
    main()
