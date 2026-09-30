# สะท้อนหน้าจอ & สตูดิโอไลฟ์

เว็บสำหรับแชร์หน้าจอโทรศัพท์ (iPhone / Android) และไลฟ์สตรีมพร้อมกันหลายแพลตฟอร์ม
(YouTube, Facebook, TikTok, Instagram, Twitch, Kick, X, Shopee/Lazada, RTMP อื่น ๆ)

## ความสามารถ

- **ห้องแชร์หน้าจอ** (`/`) — สร้างห้อง 6 หลัก + QR, ส่งภาพแคปหน้าจอจากมือถือ หรือแชร์หน้าจอสดผ่าน WebRTC
- **สะท้อนจอ iPhone ผ่าน AirPlay** — ปุ่มเปิด/ปิดตัวรับ "PC-Mirror" (UxPlay) ในหน้าเว็บ
- **สตูดิโอไลฟ์** (`/studio.html`)
  - เลเยอร์ภาพ: จอ/หน้าต่าง + กล้อง ลาก ย่อ/ขยาย จัดวางได้, ตัดหัวหน้าต่างและขอบดำอัตโนมัติ
  - กล้อง: ฟิลเตอร์สำเร็จรูป, หน้าเนียน (bilateral filter เฉพาะผิว), ผิวสว่าง, ปรับสี — ประมวลผลด้วย WebGL
  - ใบหน้า (MediaPipe Face Landmarker, โหลดเมื่อเปิดใช้): หน้าเรียว (warp แก้ม/กรามบน GPU) และสติกเกอร์ติดหน้า
    (หูกระต่าย, เขาปีศาจ, หูแมว, มงกุฎ, แว่นหัวใจ, แก้มชมพู — วาดเองเป็น SVG ใน `public/face.js`)
  - เลเยอร์รูป (จำไว้ใน IndexedDB), แปะ URL แบบ Browser Source พร้อม chroma key, แชทสด YouTube/Twitch
  - เสียง: ไมค์ + เสียงจากหน้าจอ พร้อมมาตรวัด
  - คำนวณบิตเรตจากความเร็วอัปโหลดจริง × จำนวนปลายทาง × เพดานของแต่ละแพลตฟอร์ม
  - เข้ารหัสครั้งเดียวด้วย FFmpeg (รองรับ NVENC / QSV / AMF / x264) แล้วส่ง RTMP/RTMPS ไปทุกปลายทางพร้อมกัน
    แต่ละปลายทางมีคิวแยกและต่อใหม่อัตโนมัติ

## ใช้ผ่านเว็บออนไลน์ + Yoddoy Helper

หน้าเว็บเปิดได้ทุกที่ที่ https://yoddoych.vercel.app/studio.html — ภาพ ฟิลเตอร์ และการจัดวางทำงานในเบราว์เซอร์
ส่วน **การส่งไลฟ์ (FFmpeg)** และ **การสะท้อนจอ iPhone (UxPlay)** ต้องรันบนเครื่องของผู้ใช้ผ่าน **Yoddoy Helper**

- ดาวน์โหลด `YoddoyHelper-win64.zip` จาก [Releases](https://github.com/ThanakritN1997/Yoddoych/releases/latest) → แตกไฟล์ → ดับเบิลคลิก `YoddoyHelper.bat`
- Helper ฟังที่ `127.0.0.1:47800` เท่านั้น และรับคำสั่งจาก `https://yoddoych.vercel.app` หรือ localhost (ตั้งเพิ่มได้ด้วย env `ALLOWED_ORIGINS`)
- หน้าเว็บตรวจหา Helper อัตโนมัติ ถ้าไม่พบจะแสดงปุ่มดาวน์โหลด

สร้างแพ็กเกจ Helper ใหม่ (ต้อง build UxPlay ตาม [docs/uxplay-windows.md](docs/uxplay-windows.md) ก่อน):

```powershell
powershell -ExecutionPolicy Bypass -File tools\build-helper.ps1   # → dist\YoddoyHelper-win64.zip
```

เมื่อรันบน Vercel (มี env `VERCEL`) หรือหลัง proxy (`BEHIND_PROXY=1`) API ของสตูดิโอ/AirPlay จะถูกปิดทั้งหมด

## ความต้องการ

- Windows 10/11, [Node.js](https://nodejs.org) 18+
- FFmpeg (ค่าเริ่มต้นใช้ `C:\msys64\ucrt64\bin\ffmpeg.exe` หรือกำหนด env `FFMPEG`)
- สำหรับ AirPlay: UxPlay ที่ `C:\msys64\ucrt64\bin\uxplay.exe` (ดู [docs/uxplay-windows.md](docs/uxplay-windows.md))
- เปิดหน้าเว็บใน Chrome หรือ Edge (เบราว์เซอร์ในแอปบางตัวบล็อกกล้อง/การจับภาพจอ)

## เริ่มใช้งาน

```bat
npm install
npm start
```

หรือดับเบิลคลิก `start.bat` แล้วเปิด

- เครื่องนี้: http://localhost:3000/studio.html
- มือถือใน Wi-Fi เดียวกัน: http://<IP ของคอม>:3000 (แสดงตอนเริ่มเซิร์ฟเวอร์)

## ความปลอดภัย

- สตูดิโอไลฟ์และ API (`/api/*`, `/studio`) ใช้ได้เฉพาะจาก `localhost`
- ปลายทางต้องเป็น `rtmp://` หรือ `rtmps://` เท่านั้น
- Stream Key ถูกซ่อน (••••) ในบันทึกของ FFmpeg และจะเก็บในเบราว์เซอร์ก็ต่อเมื่อติ๊ก "จำ Stream Key"

## โครงสร้าง

| ไฟล์ | หน้าที่ |
|---|---|
| `server.js` | HTTP + WebSocket: ห้องแชร์หน้าจอ, ส่งต่อไปสตูดิโอ/AirPlay |
| `studio-server.js` | รับวิดีโอจากเบราว์เซอร์ → FFmpeg → RTMP หลายปลายทาง, ทดสอบความเร็ว, ตรวจตัวเข้ารหัส |
| `mirror-server.js` | เปิด/ปิด UxPlay และรายงานสถานะการเชื่อมต่อ iPhone |
| `public/studio.*`, `public/beauty.js` | สตูดิโอไลฟ์, ผสมภาพ, ฟิลเตอร์กล้อง |
| `public/index.html`, `public/app.js` | ห้องแชร์หน้าจอ |
| `public/mirror-control.js` | ปุ่มควบคุม AirPlay ที่ใช้ร่วมกันทั้งสองหน้า |
