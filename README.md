# REBOUND — 2D İzometrik Fizik Tabanlı Arcade Futbol

**Rebound**, *Haxball* mekanik netliğinde ve *Sensible Soccer* izometrik ($30^\circ$) perspektifinde tasarlanmış, **Sıfır Duraksama (Zero-Stoppage)** felsefesine sahip web tabanlı 3v3 rekabetçi salon futbolu oyunudur.

---

## Öne Çıkan Özellikler

* **Sıfır Duraksama (Zero-Stoppage):** Hakem, faul, taç, korner veya aut yoktur. Top elastik saha duvarlarından ($e = 0.88$) hız kaybetmeden seker; maç yalnızca gol olduğunda durur.
* **$30^\circ$ İzometrik Neo-Arcade Vektör Grafik:** Sıfır harici görsel/ses varlığı indirme süresi, 60+ FPS kararlılığı ve yüksek kontrastlı takım renkleri (Turuncu vs. Elektrik Mavisi).
* **Z Ekseni & Dinamik Gölge Okunabilirliği:** Top havalandığında ($Z$ ekseni), yerdeki izdüşüm gölgesi küçülür ve solar; iniş noktası doğrudan yerdeki gölge merkezinden okunur.
* **Soft-Magnet Dribble (Top Sürme):** Karakterin baktığı yönde $60^\circ$ ($\pm 30^\circ$) manyetik ön kontrol konisi, %15 toplu koşu hızı cezası ($0.85\times$) ve $180^\circ$ ani dönüşlerde topun momentumunu koruyarak koniden çıkması.
* **Şut Şarjı & Yön Kısıtı (Commitment):** `J` tuşuna basılı tutulduğunda 0.6 saniyede dolan şut barı, %40'a kadar düşen koşu hızı, $\pm 45^\circ$ dönüş açısı kısıtı ve `L` ile şut iptali.
* **Bölge Korumalı Kaleci:** Kendi ceza sahasındaki oyuncu otomatik olarak **Kale Bekçisi** statüsü kazanır (Pasif: Sersemleme/Stun bağışıklığı ve hava toplarını bloklama; Aktif `K`: Plonjon / Dive kurtarışı).
* **Dedicated Authoritative Server & CSP:** 60 Hz deterministik özel fizik motoru, 30 Hz Binary `ArrayBuffer` (68 byte) snapshot protokolü, $0\text{ ms}$ Client-Side Prediction (CSP), Server Reconciliation ve 45 ms Interpolation Buffer.

---

## Bağlamsal Kontrol Matrisi (`WASD` + `J, K, L`)

| Tuş | Hücum (Top Kontroldeyken) | Savunma (Topsuz / Rakipteyken) | Kendi Ceza Sahasında (Kaleci) |
| :--- | :--- | :--- | :--- |
| **W, A, S, D** | 8 Yönlü Hareket & Yönlenme | 8 Yönlü Hareket & Yönlenme | 8 Yönlü Pozisyon Alma |
| **J** | **Yerden Pas** (Bas-çek) / **Şarjlı Şut** (Basılı tut) | **Ayak Koyma / Pres** (Poke) | Ayak Koyma / Pres |
| **K** | **Aşırtma Pas / Lob** ($Z$ Ekseni Vuruşu) | **Ayağa Kayma** (Slide Tackle - 16f Stun) | **Plonjon / Uzanma** (Dive) |
| **L** | **Dürtme / Depar** veya **Şut İptali** (Şarjdayken) | **Omuz Omuza / Denge** (Jockey) | Pozisyon Düzeltme |

---

## Kurulum ve Çalıştırma

```bash
# Bağımlılıkları yükleyin
npm install

# Authoritative sunucuyu başlatın (Varsayılan port: 3000)
npm start
```

Tarayıcınızda `http://localhost:3000` adresini açarak hemen 3v3 maça girebilir, yeni bir **Link & Play** odası (`http://localhost:3000/room/ANK-4091`) kurabilir veya **Fizik Sandbox** modunda antrenman yapabilirsiniz.
