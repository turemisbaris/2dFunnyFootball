# PROJE: REBOUND (ÇALIŞMA BAŞLIĞI)
## NİHAİ OYUN TASARIM DOKÜMANI (GDD)

---

## 1. YÖNETİCİ ÖZETİ (EXECUTIVE SUMMARY)

* **Oyun Adı:** Rebound (Geçici Başlık)
* **Tür:** 2D İzometrik Fizik Tabanlı Arcade Futbol
* **Hedef Platform:** Modern Masaüstü Web Tarayıcıları (HTML5 Canvas / WebGL)
* **Kontrol Şeması:** Sadece Klavye (`WASD` + `J`, `K`, `L`)
* **Hedef Oyuncu Hissiyatı:** *Haxball* hızında ve mekanik netliğinde; *Sensible Soccer* perspektifinde; sıfır duraksama, yüksek beceri tavanı (skill ceiling) ve anlık refleks odaklı rekabetçi salon futbolu.
* **Ana Felsefe (Zero-Stoppage):** Hakem yok, faul düdüğü yok, taç/korner/aut yok. Maç sadece gol olduğunda durur; bunun dışında top elastik duvarlardan seker ve oyun kesintisiz akar.

---

## 2. GÖRSEL DİL & KAMERA MİMARİSİ

* **Perspektif:** 2D İzometrik ($30^\circ$ eğim açısı).
* **Sanat Tarzı:** **Minimalist Stilize Vektör (Neo-Arcade Flat Art)**.
  * *Avantajları:* Piksel bozulması olmadan saf geometrik çarpışma okunabilirliği, sıfır varlık indirme süresi, 60+ FPS kararlılığı.
* **Varlık Anatomisi:**
  * **Oyuncular:** Oval/kapsül tabanlı gövdeler. Baktığı yönü gösteren minimalist kontrast üçgen/krampon ucu.
  * **Top & Gölge (Z Ekseni Okunabilirliği):** Top havalandığında zemindeki izdüşümünde dinamik bir gölge kalır. Top Z ekseninde yükseldikçe yerdeki gölge küçülür ve solar; oyuncu topun iniş noktasını havaya değil, yerdeki gölgenin merkezine bakarak hesaplar.
* **Saha & Renk Paleti:** 
  * Mat koyu salon zemini üzerinde yüksek kontrastlı neon/canlı takım renkleri (Turuncu vs. Elektrik Mavisi).
  * Kapalı saha sınırları belirgin, elastik duvar hatları.

---

## 3. KONTROLLER & GİRDİ MATRİSİ

Tüm girdiler bağlamsaldır (Contextual Input). Oyuncuya fazladan tuş kalabalığı yaratılmaz.

| Tuş | Hücum (Top Kontroldeyken) | Savunma (Topsuz / Rakipteyken) | Kendi Ceza Sahasında (Kaleci) |
| :--- | :--- | :--- | :--- |
| **W, A, S, D** | 8 Yönlü Hareket & Yönlenme | 8 Yönlü Hareket & Yönlenme | 8 Yönlü Pozisyon Alma |
| **J** | **Yerden Pas** (Bas-çek) / **Şarjlı Şut** (Basılı tut) | **Ayak Koyma / Pres** (Poke) | Ayak Koyma / Pres |
| **K** | **Aşırtma Pas / Lob** (Z Ekseni Vuruşu) | **Ayağa Kayma** (Slide Tackle) | **Plonjon / Uzanma** (Dive) |
| **L** | **Dürtme / Çalım / Depar** (Knock-ahead) | **Omuz Omuza / Denge** (Jockey) | Pozisyon Düzeltme |

---

## 4. OYNANIŞ MEKANİKLERİ & MATEMATİK

### 4.1. Soft-Magnet Dribble (Top Sürme)
* **Manyetik Koni:** Karakterin baktığı yöne doğru $60^\circ$ açılı bir ön kontrol alanı tanımlanır.
* **Top Bağlantısı:** Top bu koniye girdiğinde hızı oyuncunun hızına kilitlenir ($v_{top} = v_{oyuncu}$).
* **Hız Dengesi:**
  * Topsuz Oyuncu Hızı: $1.0\times$ (Temel Hız)
  * Toplu Oyuncu Hızı: $0.85\times$ (Savunmanın yetişebilmesi için %15 hız cezası).
* **Momentum & Top Kaybı:** Oyuncu $180^\circ$ anlık ters yöne dönerse, top momentumunu koruyarak koniden çıkar ve 1-2 metre ayağından açılır (savunma için top çalma penceresi).

### 4.2. Şut Şarjı & Yön Kısıtı (Commitment)
* `J` tuşuna basılı tutulduğunda şarj barı 0'dan 100'e 0.6 saniyede dolar.
* **Hız Düşüşü:** Şarj süresi boyunca oyuncunun koşu hızı kademeli olarak %40'a kadar düşer.
* **Dönüş Açısı Kısıtı:** Şarj başladığı andan itibaren oyuncu sadece $\pm 45^\circ$ komşu açılara meyledebilir. Ani $90^\circ$ veya $180^\circ$ dönüşler engellenerek kaleciye okunabilir bir şut tehdidi penceresi sunulur.
* **Şut İptali:** Şarj dolarken `L` tuşuna basılırsa şut iptal edilir, top yumuşakça yana açılır.

### 4.3. Z Ekseni (Hava Topları)
* `K` tuşuna basıldığında topa dikey sahte $Z$ ivmesi ($V_z$) aktarılır.
* Top havadayken yerdeki standart oyuncuların temas çemberlerini (hitbox) es geçer. Kayarak gelen savunmanın üzerinden aşırtmak veya ceza sahasına orta kesmek için kullanılır.

### 4.4. Çarpışma, Kayma ve Sersemleme (Stun)
* **Ayağa Kayma (K):** Oyuncu baktığı yöne doğru $1.8\times$ ivmeyle 0.4 saniye kayar.
  * *Başarılı Temas (Rakibe):* Hücum oyuncusu **16 frame (~0.26 saniye) Sersemleme (Stun)** durumuna girer, hareket edemez; top sahipsiz kalır.
  * *Hatalı Müdahale (Boşa Kayma):* Savunma oyuncusu **26 frame (~0.43 saniye) Toparlanma (Recovery)** cezası alır, yerde kalır.
  * *Cooldown:* Kayma bittikten sonra 2.5 saniye bekleme süresi başlar.
* **Ayak Koyma (J):** Kısa menzilli müdahale. Sersemletme yapmaz, sadece topun manyetik bağını koparır. Cooldown 0.5 saniyedir.

---

## 5. SAHA DİNAMİKLERİ & MAÇ KURALLARI

* **Takım Formatı:** 3v3 (1 Geride/Kaleci, 1 Orta Saha/Oyun Kurucu, 1 İleride/Bitirici).
* **Bumper / Duvar Fiziği:** Saha sınırları elastik kapalı duvarlardır ($e = 0.88$). Top hız kaybetmeden seker. Duvar pası (kendi kendine pas) resmi bir hücum taktiğidir.
* **Bölge Korumalı Kaleci (Ceza Sahası Alanı):**
  * Kendi ceza sahasında bulunan oyuncu geçici olarak "Kale Bekçisi" statüsü kazanır.
  * *Pasif:* Sersemleme (Stun) yemez. $Z$ eksenindeki hava topları boyunu aşamaz, kafasına çarpıp yere düşer.
  * *Aktif (`K` Tuşu):* Kayma yerine **Plonjon / Uzanma (Dive)** hareketine dönüşür. Seçilen yöne doğru ani hitbox uzatması yaparak köşeye giden topları çeler. Boşa uzanma cezası 0.8 saniyedir.
* **Normal Süre & Kazanma:** 3 dakika veya ilk 3 gole ulaşan takım kazanır.
* **Altın Gol (Overtime):** 
  * Süre bittiğinde skor eşitse oyun duraksamadan akar, skor panosunda anlık "ALTIN GOL" uyarısı belirir. İlk golü atan maçı anında kazanır.
  * *Emniyet Kuralı:* Uzatmanın 2. dakikasından sonra kilitlenmeyi çözmek için her 30 saniyede bir maksimum şut hızı %10 artar.

---

## 6. LOBİ & ODA MİMARİSİ (LINK & PLAY)

* **Sıfır Sürtünmeli Giriş:** Hesap açma veya indirme zorunluluğu yoktur. Kullanıcı sadece takma adını girer.
* **Lobi Akışı:**
  * Açık lobi listesinden odaya girilir veya "Oda Kur" ile anında benzersiz link üretilir (`game.io/room/ANK-4091`).
  * Link doğrudan arkadaşlara iletilir.
* **Kapsam:** İzleyici modu, maç ortası oyuncu değişimi veya karmaşık bekleme sıraları bulunmaz. Oda kurulur, 3v3 dolunca maç başlar, maç bittiğinde lobi ekranına dönülür. Bağlantısı kopan olursa maç kalan oyuncularla tamamlanır.

---

## 7. TEKNİK AĞ & FİZİK MİMARİSİ

* **Fizik Çekirdeği (Sıfırdan Deterministik Custom Motor):**
  * Ağır harici fizik motorları (Matter.js vb.) kullanılmaz; determinizm ve rollback gereksinimleri nedeniyle 200-300 satırlık hafif custom matematik motoru koşar.
  * *Çarpışmalar:* Daire-Daire (Oyuncu-Top / Oyuncu-Oyuncu) ve Daire-AABB/Çizgi (Duvar sekmeleri).
  * *Z Ekseni:* 1D yerçekimi integrasyonu ($Z_{hiz} -= g$).
* **Ağ Modeli:** **Dedicated Authoritative Server + Client-Side Prediction (CSP)**.
  * İstemci kendi girdilerini anında ($0\text{ ms}$) yerelinde simüle eder.
  * Sunucu snapshot'ları ile uyuşmazlık durumunda "Server Reconciliation" ile son tick'ler hızlıca yeniden oynatılır (replay).
  * Diğer oyuncular ve sahipsiz top ekranda 40-50 ms gecikmeli interpolasyon tamponu (interpolation buffer) ile pürüzsüz çizilir.
* **Protokol:**
  * Prototip: WebSocket (Binary ArrayBuffer).
  * Prodüksiyon: WebRTC DataChannel (Unordered/Unreliable UDP).
  * Sunucu Tick Hızı: 60 Hz.
  * İstemci Paket Gönderim (Snapshot) Hızı: 30 Hz.
  * Snapshot boyutu: Varlık başına ~8 byte (Toplam paket: ~56 byte).

---

## 8. ÜRETİM & GELİŞTİRME YOL HARİTASI (ROADMAP)

1. **Sprint 1 (Tek Oyunculu Fizik Sandbox):**
   * HTML5 Canvas / Pixi.js üzerinde izometrik saha çizimi.
   * `WASD` 8 yönlü hareket, bumper duvar sekmeleri ve soft-magnet top sürme konisi.
2. **Sprint 2 (Aksiyonlar & Girdiler):**
   * `J` şarjlı şut ve pas matematiği, `K` Z-ekseni sahte yükseklik ve yerdeki gölge ölçeklemesi.
   * `K` kayma ivmesi, sersemleme (stun) frame'leri ve cooldown sayacı.
3. **Sprint 3 (Ceza Sahası & Kaleci Mantığı):**
   * Ceza sahası trigger alanı, kaleci stun bağışıklığı ve plonjon (dive) kurtarış hitbox'ı.
4. **Sprint 4 (Custom Authoritative Server & CSP):**
   * Node.js üzerinde çalışan deterministik fizik döngüsü.
   * Binary WebSocket haberleşmesi, client-side prediction ve server reconciliation entegrasyonu.
5. **Sprint 5 (Lobi & Maç Döngüsü):**
   * Oda kurma / linkle katılma arayüzü, 3v3 maç başlangıcı, skor takibi ve Altın Gol döngüsü.