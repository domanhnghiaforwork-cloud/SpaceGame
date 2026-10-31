# SpaceGame — mô phỏng lái tên lửa 2D

Một phi vụ gồm ba pha trên cùng một màn hình: cất cánh khỏi bệ phóng, bay trọn một
vòng quỹ đạo quanh Trái Đất, rồi hạ cánh xuống khu hạ cánh của bệ phóng gần nhất.

Toàn bộ chuyển động được tính bằng công thức thật của Trái Đất: trọng lực Newton,
lực đẩy có hiệu chỉnh áp suất khí quyển, lực cản của khí quyển quay cùng Trái Đất
(nên hiệu ứng Coriolis xuất hiện tự nhiên), quán tính quay của thân tên lửa, gia
nhiệt khí động và các ngưỡng hư hỏng.

![Màn hình bệ phóng](preview.png)

## Chạy game

Không cần cài gói nào, chỉ cần Node 20 trở lên (ES module không chạy được qua
`file://`, nên phải có một máy chủ tĩnh):

```powershell
npm start
```

Mở <http://localhost:8000>. Muốn đổi cổng: `PORT=3000 npm start`
(PowerShell: `$env:PORT=3000; npm start`).

Nếu không dùng npm: `node serve.mjs`, hoặc `python -m http.server 8000`.

## Điều khiển

| Phím | Tác dụng |
| --- | --- |
| `W` / `↑` | Tăng lực đẩy (giữ để tăng dần) |
| `S` / `↓` | Giảm lực đẩy |
| `A` / `←`, `D` / `→` | Nghiêng trái / phải |
| `Space` | Tách tầng |
| `P` | Mở dù hãm |
| `T` | Đổi mức tua thời gian 1× → 10× → 100× → 1000× |
| `Esc` | Tạm dừng |
| `R` | Chơi lại từ bệ phóng |
| `E` | Kết thúc phi vụ và chấm điểm |
| `M` | Bật/tắt âm thanh |

Mọi thao tác đều có nút bấm tương ứng ở cột bên trái.

## Cách bay một phi vụ trọn vẹn

1. **Cất cánh.** Giữ `W` tới 100 % ga. Tên lửa rời bệ khi lực đẩy vượt trọng lượng.
2. **Nghiêng dần.** Qua 1,5 km, bắt đầu nghiêng sang phải (`D`) để chuyển từ bay
   thẳng đứng sang bay ngang. Nghiêng quá sớm sẽ mất độ cao; nghiêng quá muộn sẽ
   tốn nhiên liệu.
3. **Tách tầng.** Khi tầng 1 cạn nhiên liệu (đèn báo nhấp nháy), nhấn `Space`.
4. **Chèn quỹ đạo.** Tầng 2 cháy tiếp cho tới khi cận điểm trên 150 km và độ lệch
   tâm dưới 0,08. Bảng "Quỹ đạo" hiện cận điểm, viễn điểm, chu kỳ và độ lệch tâm.
5. **Bay một vòng.** Nhấn `T` để tua thời gian; game tự hạ về 1× khi vào khí quyển.
6. **Hạ quỹ đạo.** Quay đuôi về phía trước (nghiêng ngược chiều bay) rồi cháy
   động cơ để hạ cận điểm xuống khoảng 30–40 km. Tư thế "đuôi dẫn đầu" giúp tấm
   chắn nhiệt ở đáy vỏ hứng dòng khí: lực cản tăng, gia nhiệt giảm.
7. **Vào lại khí quyển.** Giữ tư thế đó. Nếu nhiệt vỏ vượt 2 000 °C, tên lửa cháy.
8. **Giảm tốc và mở dù.** Dưới 12 km, cháy động cơ để giảm xuống dưới 110 m/s rồi
   nhấn `P`. Dù chỉ chịu được tốc độ thấp — mở sớm sẽ rách dù hoặc quá tải.
9. **Chạm đất.** Dù đưa tốc độ rơi về khoảng 25 m/s; cháy động cơ lần cuối để chạm
   đất dưới 6 m/s và nghiêng dưới 12°. Hạ cánh trong khu hạ cánh 5 km quanh bệ là
   hoàn tất mục tiêu cuối.

## Kiểm chứng

```powershell
npm test          # chạy cả hai bộ kiểm chứng
npm run verify    # 55 phép kiểm tra số học từng công thức vật lý
npm run smoke     # một phi công tự động bay trọn phi vụ trong Node
```

`verify.mjs` kiểm tra khí quyển chuẩn, trọng lực, lực đẩy, Tsiolkovsky, lực cản,
bảo toàn năng lượng và mô men động lượng, quỹ đạo Kepler, gia nhiệt, tiếp đất,
nhiệm vụ và thang điểm — mọi giá trị đều được tính lại từ công thức gốc.

`smoke-test.mjs` chạy đúng lõi vật lý mà trình duyệt dùng, thực hiện cất cánh, tách
tầng, chèn quỹ đạo, bay một vòng, hạ quỹ đạo, vào lại khí quyển, mở dù và tiếp đất,
rồi khẳng định trạng thái cuối cùng.

## Cấu trúc project

```
SpaceGame/
├─ index.html          bố cục màn hình game
├─ styles.css          giao diện buồng lái
├─ serve.mjs           máy chủ tĩnh tối giản, không phụ thuộc gói
├─ src/
│  ├─ constants.js     hằng số Trái Đất, thông số tên lửa, ngưỡng hư hỏng
│  ├─ atmosphere.js    ρ, p, nhiệt độ, vận tốc âm, Cd(Mach)
│  ├─ physics.js       RK4, trọng lực, lực đẩy, lực cản, mô men, gia nhiệt, tiếp đất
│  ├─ rocket.js        hai tầng, nhiên liệu, dù, hư hỏng
│  ├─ world.js         Trái Đất và ba bệ phóng
│  ├─ mission.js       bốn mục tiêu và thang điểm
│  ├─ camera.js        zoom theo độ cao, tên lửa ở tâm
│  ├─ render.js        vẽ cảnh, tên lửa, hiệu ứng
│  ├─ hud.js           bảng thông số, cảnh báo, màn hình kết quả
│  ├─ input.js         bàn phím và nút bấm
│  ├─ audio.js         âm thanh WebAudio tổng hợp
│  └─ main.js          vòng lặp game
├─ verify.mjs          kiểm chứng từng công thức
├─ smoke-test.mjs      bay tự động đầu–cuối
├─ SPEC.md             đặc tả module (spec-graph)
└─ README.md
```

Lõi mô phỏng (`constants`, `atmosphere`, `rocket`, `world`, `physics`, `mission`)
là JavaScript thuần, không chạm DOM — nhờ vậy hai script kiểm chứng import được
chính đoạn mã mà trình duyệt chạy.

## Ghi chú về độ khó

Hạ cánh đúng khu hạ cánh sau một vòng quỹ đạo là bài toán dẫn đường thật: quỹ đạo
một vòng mất ~90 phút trong khi Trái Đất đã quay ~22°, nên điểm hạ cánh lệch khoảng
2 400 km so với bệ phóng. Người chơi cần chọn thời điểm hạ quỹ đạo và giữ tư thế
hợp lý trong suốt quá trình vào lại khí quyển.
