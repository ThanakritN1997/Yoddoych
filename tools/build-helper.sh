#!/bin/bash
# สร้างแพ็กเกจ Yoddoy Helper สำหรับ Windows → dist/YoddoyHelper (แล้ว zip ด้วย tools/build-helper.ps1)
# รันใน MSYS2 UCRT64 หลังจาก build UxPlay ตาม docs/uxplay-windows.md แล้ว
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
# สร้างในโฟลเดอร์ staging เพื่อไม่ชนกับ Helper ที่อาจเปิดทดสอบอยู่ใน dist/YoddoyHelper
OUT="$ROOT/dist/staging/YoddoyHelper"
UX_BONJOUR=${UX_BONJOUR:-$HOME/UxPlay/build-bonjour/uxplay.exe}  # ใช้ Bonjour ของเครื่อง (ถ้ามี)
UX_MDNS=${UX_MDNS:-$HOME/UxPlay/build/uxplay.exe}                 # mDNS ในตัว (เครื่องที่ไม่มี Bonjour)
NODE_EXE=${NODE_EXE:-"/c/Program Files/nodejs/node.exe"}

rm -rf "$OUT"
mkdir -p "$OUT"/{bin,lib/gstreamer-1.0,libexec/gstreamer-1.0,app,runtime}

# โปรแกรมหลัก
cp "$UX_BONJOUR" "$OUT/bin/uxplay.exe"
cp "$UX_MDNS" "$OUT/bin/uxplay-mdns.exe"
cp /ucrt64/bin/ffmpeg.exe "$OUT/bin/"
cp /ucrt64/lib/gstreamer-1.0/*.dll "$OUT/lib/gstreamer-1.0/"
cp /ucrt64/libexec/gstreamer-1.0/gst-plugin-scanner.exe "$OUT/libexec/gstreamer-1.0/"
cp "$NODE_EXE" "$OUT/runtime/node.exe"

# DLL ที่ต้องใช้ทั้งหมด (เฉพาะจาก ucrt64 — DLL ของ Windows มีอยู่แล้วทุกเครื่อง)
for f in "$OUT"/bin/*.exe "$OUT"/lib/gstreamer-1.0/*.dll "$OUT"/libexec/gstreamer-1.0/*.exe; do
  ldd "$f" 2>/dev/null | awk '/\/ucrt64\// {print $3}'
done | sort -u | while read -r dll; do cp -n "$dll" "$OUT/bin/"; done

# โค้ดเซิร์ฟเวอร์ + หน้าเว็บ (ใช้ในเครื่องได้ด้วย)
cp "$ROOT"/{server.js,studio-server.js,mirror-server.js,restream-oauth.js,updater.js,package.json} "$OUT/app/"
cp -r "$ROOT/public" "$OUT/app/"
mkdir -p "$OUT/app/node_modules"
cp -r "$ROOT/node_modules/ws" "$OUT/app/node_modules/"

cp "$ROOT"/tools/helper/*.bat "$OUT/"
# README ใส่ BOM ให้ Notepad อ่านภาษาไทยถูก
printf '\xEF\xBB\xBF' > "$OUT/README.txt"
cat "$ROOT/tools/helper/README.txt" >> "$OUT/README.txt"

du -sh "$OUT"
