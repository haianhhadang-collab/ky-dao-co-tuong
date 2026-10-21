# Kỳ Đạo – Cờ Tướng Online

Web app chơi **Cờ tướng** và **Cờ úp** hoàn toàn tự chạy: **không gọi API bên ngoài, không cần cài thư viện** (chỉ dùng Node.js có sẵn). Server tự cài WebSocket, dữ liệu lưu trong một file JSON.

## Chạy

```bash
node server.js
```

Mở <http://localhost:3000>. Máy khác cùng mạng LAN mở địa chỉ `http://<IP-máy-chủ>:3000` (server in ra địa chỉ khi khởi động).

- Cần Node.js ≥ 18 (khuyên dùng ≥ 22). Đổi cổng: `PORT=8080 node server.js`.
- Dữ liệu tài khoản, điểm, lịch sử ván nằm ở `data/db.json` (tự tạo). Xóa file này để làm lại từ đầu.
- Kiểm thử: `npm test` (bộ luật + mô phỏng nhiều người chơi trực tuyến, cần Node ≥ 22).

## Chơi qua Internet

Có 3 cách, chọn theo nhu cầu:

| Cách | Chi phí | Đường link | Dữ liệu (tài khoản, điểm) | Phù hợp |
|------|---------|-----------|---------------------------|---------|
| **A. Cloudflare Tunnel từ máy bạn** | Miễn phí, không cần tài khoản | Đổi mỗi lần chạy, chỉ sống khi máy bật | Giữ nguyên trên máy bạn | Chơi nhanh với bạn bè, thử nghiệm |
| **B. Render – gói Free** | Miễn phí | Cố định `…onrender.com` | **Mất mỗi khi server ngủ (15 phút không ai chơi) hoặc cập nhật** | Demo |
| **C. Render – gói Starter + ổ đĩa / VPS** | Trả phí hằng tháng | Cố định | Giữ lâu dài | Chạy thật, có xếp hạng |

**A. Cloudflare Tunnel** (cần cài [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)) – mở 2 cửa sổ dòng lệnh:

```bash
node server.js
```

```bash
cloudflared tunnel --url http://localhost:3000
```

Gửi đường link `https://….trycloudflare.com` mà cloudflared in ra cho bạn bè. Tắt một trong hai cửa sổ là dừng.

**B/C. Render** – đăng nhập [render.com](https://render.com) bằng GitHub rồi mở
<https://render.com/deploy?repo=https://github.com/haianhhadang-collab/ky-dao-co-tuong> → **Apply**. Cấu hình nằm trong `render.yaml` (mặc định gói Free, máy chủ Singapore). Để giữ dữ liệu, đổi `plan: starter` và bỏ dấu `#` ở khối `disk` + biến `DATA_FILE` trong file đó.

**VPS / Docker:**

```bash
docker build -t kydao .
```

```bash
docker run -d -p 3000:3000 -v kydao-data:/data --restart unless-stopped kydao
```

Server đứng sau proxy (Render, Cloudflare, Nginx) vẫn nhận đúng IP người chơi để giới hạn spam đăng ký / đăng nhập sai; đường `/healthz` dùng để kiểm tra server còn sống.

## Tính năng

| # | Chế độ | Mô tả |
|---|--------|-------|
| 1 | **Cờ tướng** | Luật chuẩn: chiếu bí, hết nước đi là thua, cấm lộ mặt tướng, chiếu dai bị xử thua, lặp thế cờ 3 lần hòa, 60 nước không ăn quân hòa. Đấu với máy (Dễ / Vừa / Khó / Đại sư) hoặc 2 người cùng máy, có đi lại và gợi ý nước. |
| 2 | **Cờ úp** | 15 quân mỗi bên úp ngẫu nhiên vào vị trí xuất phát; quân úp đi theo luật của vị trí đang đứng, đi xong thì lật mặt. Sĩ, tượng đã lật được đi khắp bàn. Server giữ bí mật danh tính quân úp – người chơi, người xem và cả máy đều không nhìn trộm được. |
| 3 | **Kết bạn** | Tìm người chơi theo tên (có dấu), gửi / nhận / thu hồi lời mời, xem bạn đang trực tuyến, đang chơi hay đang trong phòng. |
| 4 | **Đấu bạn bè** | Thách đấu trực tiếp: chọn loại cờ, thời gian, cộng giờ, có tính điểm hay không. Mời bạn vào phòng đang ngồi. |
| 5 | **Đấu ngẫu nhiên** | Hàng chờ ghép đối thủ gần điểm nhất (nới dần phạm vi theo thời gian chờ). Ván tính điểm 10 phút + 5 giây/nước. |
| 6 | **Xếp hạng & danh hiệu** | 5 hạng × 5 sao (Tập sự → Phong trào → Kỳ thủ → Kiện tướng → Kỳ vương, mỗi hạng Nhất tinh → Ngũ tinh). Bảng danh hiệu theo chuỗi thắng và tổng số ván thắng, cao nhất là **Kỳ tiên**. Bảng xếp hạng top 100, hồ sơ người chơi, xem lại ván đã đấu. |
| 7 | **Phòng chơi** | Nhiều phòng chạy song song. Mỗi phòng: 2 ghế kỳ thủ, 1 ghế trọng tài, không giới hạn người quan sát, trò chuyện, mật khẩu, phòng riêng, chủ phòng mời người ra. Trọng tài: bắt đầu ván, tạm dừng / tiếp tục, phân xử thắng–thua–hòa, nhắc nhở, cộng giờ. |

Ngoài ra: đồng hồ do server quản lý, xin hòa / xin đi lại (ván giao hữu), mất kết nối được 60 giây để quay lại, ván sau tự đổi bên, kéo-thả hoặc bấm để đi quân, hiển thị chữ Hán hoặc chữ Việt, âm thanh tổng hợp (không cần file), giao diện điện thoại.

### Điểm và danh hiệu

- Thắng: +20…+40 điểm (theo chênh lệch trình độ) + thưởng chuỗi thắng (tối đa +10). Thua: −10…−30 (hạng Tập sự chỉ bị trừ một nửa). Điểm không âm.
- Chỉ ván **tính điểm** mới đổi điểm, chuỗi thắng và danh hiệu. Hòa hoặc thua làm đứt chuỗi.

| Danh hiệu | Điều kiện |
|---|---|
| Liên sát · Tứ sát · Ngũ tinh lão tướng | Thắng 3 · 4 · 5 ván liên tiếp |
| Lục lộ anh hùng · Thất bộ truy hồn · Bát phương uy chấn · Cửu thiên chiến tướng | Thắng 6 · 7 · 8 · 9 ván liên tiếp |
| Thập nhân trảm | Thắng 10 ván liên tiếp |
| Bách nhân trảm · Ngũ bách hổ tướng · Thiên nhân trảm · Tam thiên bá chủ | Tổng 100 · 500 · 1.000 · 3.000 ván thắng |
| Đại kiện tướng | 5.000 ván thắng và đạt Kiện tướng |
| **Kỳ tiên** | 10.000 ván thắng và đạt Kỳ vương Ngũ tinh |

Ngưỡng điểm từng sao, công thức điểm và điều kiện danh hiệu đều nằm trong `public/shared/ranks.js` – sửa ở một chỗ, server và giao diện cùng cập nhật.

## Cấu trúc

```
server.js              Máy chủ HTTP (phục vụ file tĩnh) + WebSocket
server/ws.js           WebSocket tối giản (RFC 6455) bằng thư viện chuẩn của Node
server/store.js        Lưu dữ liệu vào data/db.json (ghi nguyên tử)
server/hub.js          Tài khoản, bạn bè, thách đấu, ghép trận, phòng, trọng tài, đồng hồ, tính điểm
public/shared/xiangqi.js  Bộ luật Cờ tướng + Cờ úp (dùng chung server & trình duyệt)
public/shared/ranks.js    Hạng, sao, công thức điểm, danh hiệu
public/js/ai.js        Máy chơi: alpha-beta, tìm kiếm tĩnh, bảng chuyển vị (chạy trong Web Worker)
public/js/board.js     Bàn cờ (SVG + quân cờ, kéo-thả, hiệu ứng)
public/js/app.js       Giao diện: sảnh, phòng, bạn bè, xếp hạng, hồ sơ, ván đấu, xem lại
test/run-tests.js      Kiểm thử tự động
```

## Ghi chú

- Mật khẩu được băm bằng `scrypt` có muối (bất đồng bộ); phiên đăng nhập lưu bằng token ngẫu nhiên. Mỗi IP tạo tối đa 20 tài khoản/giờ, sai mật khẩu quá 10 lần/10 phút sẽ bị chặn tạm, tối đa 30 kết nối cùng lúc (`MAX_CONN_PER_IP`).
- Đây là máy chủ đơn tiến trình, phù hợp chơi trong nhà, lớp học, câu lạc bộ hoặc một VPS nhỏ. Khi đưa ra Internet nên chạy sau HTTPS (Render và Cloudflare Tunnel đã có sẵn); giao diện tự dùng `wss://` khi trang chạy trên HTTPS.
- Mở thẳng `public/index.html` (không chạy server) vẫn chơi được với máy và 2 người cùng máy; các tính năng trực tuyến cần server.
