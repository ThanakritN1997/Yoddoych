Yoddoy Helper — ตัวช่วยไลฟ์สตรีม + สะท้อนจอ iPhone (Windows 10/11 64-bit)
=====================================================================

วิธีใช้
1. แตกไฟล์ zip ไว้ที่ไหนก็ได้ (เช่น Documents\YoddoyHelper)
2. ดับเบิลคลิก YoddoyHelper.bat  — เปิดหน้าต่างนี้ทิ้งไว้ระหว่างใช้งาน
3. ครั้งแรก Windows จะถามเรื่อง Firewall ให้กด "อนุญาต" (Private network)
   - node.exe  = ใช้ส่งไลฟ์
   - uxplay    = ให้ iPhone มองเห็นเครื่องนี้ (PC-Mirror)
4. เปิด https://yoddoych.vercel.app/studio.html ใน Chrome หรือ Edge

สะท้อนจอ iPhone
- iPhone ต้องต่อ Wi-Fi วงเดียวกับคอมเครื่องนี้
- ในหน้าเว็บกด "เริ่มสะท้อนหน้าจอ" → iPhone: ศูนย์ควบคุม → การสะท้อนหน้าจอ → PC-Mirror

เปิดเองทุกครั้งที่เปิดคอม
- ดับเบิลคลิก install-autostart.bat  (ยกเลิก: uninstall-autostart.bat)

ความปลอดภัย
- Helper รับคำสั่งเฉพาะจากเครื่องนี้ (127.0.0.1) และจากเว็บ yoddoych.vercel.app เท่านั้น
- Stream Key ส่งตรงจากเบราว์เซอร์ไปยัง Helper บนเครื่องนี้ ไม่ผ่านเซิร์ฟเวอร์อื่น

ส่วนประกอบ: Node.js, FFmpeg, UxPlay, GStreamer (โอเพนซอร์ส — ดูไลเซนส์ของแต่ละโครงการ)
