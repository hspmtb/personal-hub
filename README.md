# Personal Hub

Aplikasi web pribadi (bahasa antarmuka: **Inggris**, sesuai requirement) untuk:

- **Tasks** — input task harian dengan jam mulai/selesai, lihat per hari / minggu / bulan
- **Expenses (Cashflow)** — kategori pengeluaran custom (Settings), input/edit/hapus transaksi, laporan bulanan + pie chart persentase per kategori
- **Documents** — vault dokumen pribadi (alamat website, user/password, dll), **username & password dienkripsi AES-256-CBC di sisi browser** sebelum dikirim ke Firestore
- **Users** — admin dapat mengundang, mengubah role, dan menonaktifkan user
- **Settings** — kelola kategori pengeluaran, kelola master passphrase vault dokumen

Stack: React + Vite + Tailwind, Firebase Auth + Firestore, hosting statis di GitHub Pages via GitHub Actions.

---

## 1. Setup Firebase

1. Buka https://console.firebase.google.com → **Add project** → beri nama, lanjutkan (Google Analytics opsional, boleh dimatikan).
2. Di sidebar **Build → Authentication → Get started** → tab **Sign-in method** → aktifkan **Email/Password**.
3. Di sidebar **Build → Firestore Database → Create database** → pilih lokasi terdekat → mulai dalam **production mode** (rules sudah disediakan di repo ini, akan di-deploy di langkah 4).
4. Di **Project settings (ikon gerigi) → General → Your apps** → klik ikon web `</>` → daftarkan app (nama bebas, **tidak perlu** centang Firebase Hosting karena kita pakai GitHub Pages) → salin objek `firebaseConfig` yang muncul.

## 2. Jalankan secara lokal

```bash
npm install
cp .env.example .env
# isi .env dengan nilai dari firebaseConfig di langkah 1.4
npm run dev
```

Buka `http://localhost:5173`.

### Deploy Firestore Rules & Indexes

Rules (`firestore.rules`) membatasi setiap user hanya bisa membaca/menulis datanya sendiri, dan hanya admin yang bisa mengelola user lain — lihat komentar di file tersebut untuk detail.

```bash
npm install -g firebase-tools
firebase login
firebase use --add        # pilih project yang dibuat di langkah 1
firebase deploy --only firestore:rules,firestore:indexes
```

> Firestore juga akan meminta composite index saat query pertama kali dijalankan jika `firestore.indexes.json` belum ter-deploy — cukup klik link yang muncul di console error, atau jalankan perintah di atas terlebih dahulu.

### Bootstrap admin pertama (WAJIB, sekali saja)

Karena rules mengharuskan seorang **admin** untuk mengundang user baru, tapi belum ada admin sama sekali di awal, buat entri undangan pertama secara manual:

1. Firebase Console → **Firestore Database** → **Start collection** → Collection ID: `allowlist`
2. Document ID: email kamu sendiri, huruf kecil semua (contoh: `nama@gmail.com`)
3. Field: `role` (string) = `admin`
4. Buka aplikasi → tab **Create account** → daftar pakai email persis yang sama → otomatis jadi admin pertama, dan dari situ bisa mengundang user lain lewat menu **Users**.

## 3. Deploy ke GitHub Pages

1. Buat repo baru di GitHub, push project ini ke branch `main`.
2. **Ubah `base` di `vite.config.js`** menjadi `/nama-repo-kamu/` (harus persis sama dengan nama repo, case-sensitive).
3. Repo → **Settings → Pages → Source** → pilih **GitHub Actions**.
4. Repo → **Settings → Secrets and variables → Actions → New repository secret**, tambahkan 6 secret berikut (nilainya sama seperti isi `.env`):
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
5. Push ke `main` → tab **Actions** akan otomatis build & deploy. Setelah selesai, situs akan tersedia di `https://<username>.github.io/<nama-repo>/`.
6. Firebase Console → **Authentication → Settings → Authorized domains** → tambahkan `<username>.github.io` (Firebase Auth menolak domain yang tidak ada di daftar ini).

Setelah ini, site kamu bisa dibuka dari **laptop maupun HP** — sudah responsive (sidebar berubah jadi menu hamburger di layar kecil), dan sudah berupa **PWA (Progressive Web App)** — bisa di-install seperti aplikasi native.

### Install sebagai app (PWA)

**Di HP (Android/Chrome):** buka situsnya → menu titik tiga (⋮) di browser → **"Add to Home screen" / "Install app"** → ikon Personal Hub muncul di home screen, terbuka tanpa address bar seperti app biasa.

**Di HP (iPhone/Safari):** buka situsnya → tombol **Share** (kotak dengan panah ke atas) → **"Add to Home Screen"**.

**Di laptop/desktop (Chrome/Edge):** buka situsnya → akan muncul ikon **install** (biasanya di ujung kanan address bar) → klik **Install** → app terbuka di window sendiri terpisah dari browser.

Setelah di-install, tampilan otomatis menyesuaikan: layout sidebar penuh di layar lebar (desktop), dan menu hamburger di layar sempit (HP) — satu codebase, tampilan menyesuaikan ukuran layar.

---

## Keamanan (khusus untuk menu Documents)

- Username & password di setiap dokumen dienkripsi **di browser** dengan **AES-256-CBC** sebelum dikirim ke Firestore. Firestore hanya pernah menyimpan ciphertext + salt + IV acak per-item — tidak pernah plaintext.
- Kunci enkripsi diturunkan dari **master passphrase** yang kamu buat sendiri saat pertama membuka menu Documents, menggunakan **PBKDF2-HMAC-SHA256 (210.000 iterasi)**. Passphrase ini **tidak pernah dikirim atau disimpan** di Firebase dalam bentuk apa pun — hanya ada di memori browser selama sesi berjalan.
- Konsekuensinya: **jika lupa master passphrase, data di Documents tidak bisa dipulihkan** (ini "zero-knowledge encryption" yang disengaja). Simpan passphrase itu di tempat aman terpisah (mis. password manager lain).
- Ganti master passphrase kapan saja lewat **Settings → Document Vault** — semua item otomatis di-re-encrypt dengan passphrase baru.
- Firestore Security Rules memastikan setiap user **hanya bisa membaca datanya sendiri** (tasks, expenses, documents) — bahkan sesama user aplikasi ini tidak bisa saling melihat data.
- Selalu akses site lewat HTTPS (GitHub Pages otomatis menyediakan ini).
- Field lain pada dokumen (nama, link, catatan) sengaja **tidak** dienkripsi supaya tetap bisa dicari/terbaca sekilas — jangan simpan info sensitif tambahan di field tersebut.

## Catatan lain

- Mata uang di seluruh aplikasi memakai format **Rupiah (Rp)** secara default (`src/lib/currency.js`).
- Routing memakai `HashRouter` (URL berbentuk `/#/tasks`) supaya refresh/deep-link tidak 404 di GitHub Pages (situs statis tanpa server-side rewrite).
- Menu **Users** hanya menambah/menghapus *hak akses* (invite, role, aktif/nonaktif) dan profil; pembuatan akun login tetap dilakukan sendiri oleh user lewat halaman **Create account** setelah diundang (batasan Firebase: pembuatan akun Auth pihak lain dari sisi browser tidak aman tanpa server/Cloud Functions).

## Menu Kontrakan

- Data master (No Kontrakan, Nama Penyewa, Uang Sewa, Iuran RT/RW, Uang Internet, Kubik Awal) dikelola di **Settings → Master Kontrakan**.
- Info rekening untuk teks reminder ada di **Settings → Info Rekening**.
- Di halaman **Kontrakan**, pilih bulan & tahun (default bulan berjalan) → isi data topup listrik → isi Kubik air tiap kontrakan → sistem otomatis menghitung Kubik Terpakai dan membagi Biaya Topup secara proporsional ke tiap kontrakan berdasarkan pemakaian air. "Sisa Kwh Last Month" otomatis terisi dari data bulan sebelumnya jika sudah pernah diisi.
- Tombol **Print** di tiap baris membuka teks reminder siap-copy/kirim ke WhatsApp.

### Update Firestore Rules & Index setelah upgrade ini

Karena ada collection baru (`rentalUnits`, `rentalPeriods`, `rentalReadings`, `rentalSettings`), **wajib publish ulang rules & index** setelah update file-file ini, atau fitur Kontrakan akan gagal dengan error "Missing or insufficient permissions":

- Lewat CLI: `firebase deploy --only firestore:rules,firestore:indexes`
- Atau manual lewat Firebase Console: **Firestore Database → tab Rules** → paste isi `firestore.rules` yang baru → **Publish**. Untuk index, biasanya cukup buka menu **Kontrakan** sekali — Firestore/console akan menampilkan link "Create Index" otomatis di error console (F12) kalau index belum ada, tinggal diklik.

