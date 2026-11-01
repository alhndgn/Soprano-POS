# GitHub ile yayınlama ve güncelleme

## 1) Depoyu oluştur (bir kez)

GitHub'da **private** bir depo aç: `soprano-pos`

Bu bilgisayarda:

```
cd C:\dev\projeler\soprano
git remote add origin https://github.com/KULLANICI/soprano-pos.git
git branch -M main
git push -u origin main
```

İlk push'ta GitHub kullanıcı adı + **Personal Access Token** ister (şifre değil).
Token: GitHub → Settings → Developer settings → Personal access tokens → Fine-grained →
sadece bu depo, **Contents: Read and write**.

## 2) Müşteri bilgisayarına kurulum (bir kez)

```
git clone https://github.com/KULLANICI/soprano-pos.git C:\Soprano
cd C:\Soprano
Kur.bat
Soprano POS.bat
```

Özel depo ise Git kullanıcı/token sorar; bir kez girilir, Windows Kimlik Yöneticisi hatırlar.

**Daha güvenli yol (müşteri kodu göremez, sadece çeker):**
- Müşteri PC'de: `ssh-keygen -t ed25519 -C "soprano-kasa"`
- GitHub → depo → Settings → Deploy keys → Add deploy key → public anahtarı yapıştır,
  **"Allow write access" işaretleme** (salt okunur).
- Clone: `git clone git@github.com:KULLANICI/soprano-pos.git C:\Soprano`

## 3) Güncelleme akışı

Burada geliştirip push et:

```
git add -A
git commit -m "Aciklama"
git push
```

Müşteri PC'de **Guncelle.bat** çift tıkla:

1. Uygulamayı kapatır (`scripts/stop.ps1`)
2. `git fetch` + `git reset --hard origin/main` (yerel kod = depo)
3. `npm install` (paket değiştiyse kurar)
4. `npm run build`
5. `Soprano-POS.bat` ile yeniden açar

`var/` klasörü .gitignore'da olduğu için **veriye dokunmaz**: adisyonlar, menü,
görseller, ayarlar korunur.

Sürüm doğrulama: giriş ekranının altında `v0.1.0 · a1b2c3d`, Yönetim başlığında
aynı etiket. Commit değiştiyse güncelleme gerçekten gelmiş demektir.

## 4) Dikkat

- `Guncelle.bat` yerel kod değişikliklerini **siler**. Müşteri tarafında kod
  düzenlenmemeli; düzeltme burada yapılıp push edilmeli.
- Veritabanı şeması değiştiyse sunucu açılışta `schema.sql`'i çalıştırır
  (`CREATE TABLE IF NOT EXISTS` / `ALTER ... IF NOT EXISTS`) — ek migration gerekmez.
- Geri almak için: `git reset --hard <eski-commit>` + `Guncelle.bat` yerine
  `Kur.bat`.
- Yedek: `var/pgdata` + `var/uploads` (sunucu kapalıyken kopyala).

## 5) Önerilen depo ayarları

- Private depo + deploy key (salt okunur) → müşteri kodu göremez
- `main` dalı korumalı; doğrudan push yerine PR (isteğe bağlı)
- Sürüm numarası: `package.json` içindeki `version` alanını güncelle
  (giriş ekranında görünür)
