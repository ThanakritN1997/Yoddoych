# ติดตั้ง UxPlay (ตัวรับ AirPlay) บน Windows

UxPlay ไม่มีไฟล์ติดตั้งสำเร็จรูปสำหรับ Windows ต้องคอมไพล์ด้วย MSYS2 และมีการแก้ 3 จุดเพื่อให้ทำงานร่วมกับเครื่องที่มี Bonjour / VPN

## 1. ติดตั้งเครื่องมือ

```powershell
winget install --id MSYS2.MSYS2 -e
```

ใน MSYS2 UCRT64:

```bash
pacman -Syu --noconfirm
pacman -S --needed --noconfirm git mingw-w64-ucrt-x86_64-{cmake,ninja,gcc,pkgconf,libplist,openssl,gstreamer,gst-plugins-base,gst-plugins-good,gst-plugins-bad,gst-libav}
git clone --depth 1 https://github.com/FDH2/UxPlay ~/UxPlay
```

ต้องมี **Bonjour** ของ Apple ทำงานอยู่ (มากับ iTunes หรือ Bonjour Print Services)

## 2. ให้ UxPlay ประกาศชื่อผ่าน Bonjour

ถ้าเครื่องมี Bonjour อยู่แล้ว ตัว mDNS ในตัวของ UxPlay จะแย่งพอร์ต 5353 ไม่ได้ ทำให้ iPhone มองไม่เห็นชื่อเครื่อง
จึง build แบบ `USE_DNS_SD=1` โดยใช้ header ย่อ (UxPlay โหลด `dnssd.dll` ตอนรันเอง)

`~/bonjour-sdk/Include/dns_sd.h`

```c
#ifndef _DNS_SD_H
#define _DNS_SD_H
#include <stdint.h>
typedef union _TXTRecordRef_t { char PrivateData[16]; char *ForceNaturalAlignment; } TXTRecordRef;
enum { kDNSServiceFlagsIncludeP2P = 0x20000, kDNSServiceFlagsIncludeAWDL = 0x100000 };
#define kDNSServiceInterfaceIndexAny 0
enum { kDNSServiceErr_NoError = 0, kDNSServiceErr_Unknown = -65537, kDNSServiceErr_NameConflict = -65548 };
#endif
```

`~/bonjour-sdk/Lib/x64/dnssd.lib` = static library ว่าง:

```bash
cd ~/bonjour-sdk/Lib/x64 && echo 'int uxplay_dnssd_stub;' > s.c && gcc -c s.c -o s.o && ar rcs dnssd.lib s.o
```

## 3. แก้ output ให้ไม่ถูกบัฟเฟอร์

ใน `uxplay.cpp` ต้นฟังก์ชัน `main` (ไม่ใช่ตัวของ macOS) เพิ่ม:

```cpp
setvbuf(stdout, NULL, _IONBF, 0);
setvbuf(stderr, NULL, _IONBF, 0);
```

เพื่อให้หน้าเว็บเห็นสถานะ "iPhone เชื่อมต่อแล้ว" ทันที

## 4. (ทางเลือก) ข้ามการ์ด VPN ใน mDNS ในตัว

ถ้า build แบบไม่ใช้ Bonjour ใน `lib/mdnsd/mdnsd.c` ฟังก์ชัน `mdns_get_default_ipv4` ให้ข้าม adapter ที่ชื่อมี
`VPN`, `TAP-`, `Tailscale`, `ZeroTier` และรองรับ env `UXPLAY_IP` สำหรับบังคับ IP

## 5. Build + ติดตั้ง

```bash
cd ~/UxPlay && mkdir build-bonjour && cd build-bonjour
BONJOUR_SDK_HOME=C:/msys64/home/$USER/bonjour-sdk cmake -G Ninja -DUSE_DNS_SD=1 ..
ninja && cp uxplay.exe /ucrt64/bin/
```

## 6. Firewall

อนุญาต `C:\msys64\ucrt64\bin\uxplay.exe` ใน Windows Firewall ให้ iPhone ต่อเข้ามาได้

หน้าเว็บจะเปิด UxPlay ด้วย `-n PC-Mirror -nh -p -nohold -vs d3d12videosink -m <MAC ของการ์ดแลน>` ให้เอง
