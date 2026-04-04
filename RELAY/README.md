# D'MarcFF Robotic - IoT Relay System V1.0

Sistem manajemen relay IoT profesional yang menggabungkan **GitHub API** sebagai *Single Source of Truth* (SSoT) dan **MQTT HiveMQ** untuk kontrol *real-time*. Sistem ini dirancang untuk menangani banyak perangkat secara otomatis melalui identitas unik MAC Address.

## 🚀 Fitur Utama

- **Auto-Provisioning**: Folder dan file konfigurasi perangkat dibuat secara otomatis oleh Dashboard saat pendaftaran pertama kali.
- **Hybrid Synchronization**: 
  - **GitHub SSoT**: Perangkat mengambil status terakhir dari GitHub saat pertama kali menyala (menghindari kehilangan status saat *reboot*).
  - **MQTT Real-time**: Kontrol instan tanpa delay melalui protokol MQTT (HiveMQ Cloud).
- **Unique Device Identity**: Identitas perangkat menggunakan format `RELAY_[6_DIGIT_MAC]` (Contoh: `RELAY_EBCF08`).
- **Secure Token Management**: GitHub Token disimpan secara aman di `localStorage` browser pengguna, bukan di dalam kode repositori.

## 📁 Struktur Direktori

```text
.
├── RELAY/                  # Folder utama database perangkat
│   └── RELAY_XXXXXX/       # Sub-folder berdasarkan MAC Address unik
│       └── data.json       # File konfigurasi (status relay, pesan, angka)
├── index.html              # Dashboard Web (HTML/JS)
└── template1.ino           # Firmware Arduino/ESP32
