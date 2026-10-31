---
id: spacegame-simulation
type: module-design
status: active
title: "SpaceGame — mô phỏng lái tên lửa 2D"
tags: [simulation, physics, web-game]
---

# SpaceGame — mô phỏng lái tên lửa 2D

## Responsibility

Một trò chơi mô phỏng trên trình duyệt: người chơi điều khiển tên lửa hai tầng cất
cánh từ bệ phóng, chèn vào quỹ đạo quanh Trái Đất, bay trọn một vòng, rồi hạ cánh
xuống khu hạ cánh của bệ phóng gần nhất. Mọi chuyển động là kết quả của mô phỏng
vật lý chứ không phải hoạt ảnh dựng sẵn: con số trên bảng điều khiển và hình ảnh
trên màn hình đều đọc từ cùng một trạng thái mô phỏng.

Trái Đất dùng số liệu thật (bán kính 6 371 km, μ = 3,986004418e14 m³/s²,
ω = 7,2921159e-5 rad/s), nên quỹ đạo là quỹ đạo Kepler thật và một vòng mất khoảng
90 phút — vì vậy tua thời gian là phần bắt buộc của thiết kế, không phải tiện ích.

## Boundary

- Trang tĩnh: HTML + CSS + ES module, không bước build, không phụ thuộc gói ngoài.
  Phải chạy qua một máy chủ tĩnh vì ES module không hoạt động với `file://`;
  `serve.mjs` là máy chủ tĩnh tối giản đi kèm (chỉ dùng `node:http`/`node:fs`, đọc
  cổng từ biến môi trường `PORT`), nên project chỉ cần Node 20 trở lên.
- Lõi mô phỏng không có mạng. Giao diện chỉ gọi mạng đúng một chỗ: trợ lý phi vụ,
  qua `POST /api/assistant` của `serve.mjs`. Server dev giữ `DEEPSEEK_API_KEY` trong
  `.env` và là nơi duy nhất gắn header `Authorization`; **key không bao giờ được gửi
  xuống trình duyệt** và `.env` nằm trong `.gitignore`. Key được nhập bằng
  `npm run key` (`set-key.mjs`), lệnh này hỏi key trong terminal rồi ghi vào `.env` —
  không phụ thuộc việc editor có hiện dotfile hay không. Không có key hoặc mất mạng thì
  mọi thứ khác vẫn chạy, chỉ panel trợ lý báo lỗi.
- Trình duyệt chỉ lưu điểm cao nhất và số giây giữa hai lần hỏi trợ lý trong
  `localStorage`.
- Không gian mô phỏng là **mặt phẳng xích đạo 2D** quanh một Trái Đất cầu. Không có
  độ nghiêng quỹ đạo, không có J2, không có gió, không có địa hình gồ ghề, không có
  chuyển động của Mặt Trăng hay Mặt Trời. Ba bệ phóng nằm trên xích đạo, cách nhau
  120°.
- Toàn bộ giao diện tiếng Việt; đơn vị hiển thị theo hệ SI kèm quy đổi thân thiện
  (km, kN, t, km/h). Mỗi nút điều khiển in kèm phím tắt của nó trong ngoặc, cỡ nhỏ và
  mờ hơn nhãn (`Ga lên (W)`); dải gợi ý dưới các nút chỉ liệt kê phím **không** có nút
  riêng (mũi tên, `Esc`, `M`). Phần phím đó **không** viết tay trong HTML:
  `input.js` suy ra nó từ chính `KEY_TO_HOLD` / `KEY_TO_ACTION` (`SHORTCUTS`,
  `applyKeyLabels` gọi trong `createInput`), nên đổi phím là đổi luôn nhãn trên nút —
  nút thiếu phím (Đóng, toàn màn hình) không bị thêm gì, và nút nào có
  `data-hold`/`data-action` đều được xử lý, kể cả nút trong màn hình kết quả. Ở cột
  hẹp (≤1220 px) icon mũi tên trang trí của bốn nút lái được ẩn để nhãn + phím vẫn
  vừa một dòng.
- **Tua thời gian là thanh trượt**, không phải nút và không có phím tắt: thang log
  1× → 1000×. Thanh giữ **mức người chơi đặt**, còn chip “Tua” trên header hiện
  **mức đang chạy thật** sau khi game tự hạ tốc độ — hai con số tách bạch để thanh
  không tự nhảy khi vào khí quyển.
- **Hai góc nhìn** (`camera.mode`): `far` tự thu nhỏ theo độ cao (mặc định, thấy cả Trái
  Đất), `near` khoá tỉ lệ ~2,4 px/m (quy theo bề ngang canvas) nên thân tên lửa luôn
  ~100–140 px, thấy được thân, lửa đẩy, khí RCS và mảnh tách tầng. Đổi bằng nút ở
  header hoặc phím `C`; nút giữ `aria-pressed` theo đúng chế độ đang dùng. Ở chế độ
  `near`, vì mặt đất đã ra ngoài khung, `render.js` vẽ thêm **bản đồ nhỏ** góc phải
  trên là một **radar** (không vẽ hình Trái Đất, không bọc nền — xếp ngay dưới danh sách
  lực, cùng cột trong suốt với số đọc): tên lửa ở tâm kèm vạch hướng thân, ba
  vòng khoảng cách 100 km / 1 000 km / 10 000 km theo thang log (10 km ở tâm, mỗi thập
  kỷ một phần ba bán kính), bệ phóng gần nhất là blip cam đặt đúng **phương vị tương
  đối** và khoảng cách thật trên thang đó, kèm tên rút gọn + khoảng cách (định dạng
  vi-VN) và một mũi tên nhỏ chỉ hướng; vệt quỹ đạo đã bay (`sim.trail`, giảm mẫu còn
  ≤ 480 điểm) vẽ thành đường radar nhìn từ vị trí hiện tại; góc dưới là độ cao và ghi
  chú khu hạ cánh 5 km. Chơi lại giữ nguyên góc nhìn người chơi đã chọn.
- **Lớp hiển thị lực** (nút “Lớp lực” + phím `F`, mặc định tắt) — danh sách lực nằm ở
  cột trái trên, chữ trần không bọc nền, xếp ngay dưới số đọc: khung tên lửa nét
  đứt trùng tỉ lệ với hình đang vẽ; **cụm vector được dời sang bên** khung (khoảng
  120–180 px tuỳ bề ngang, tự đổi bên nếu sát mép) và nối với khung bằng một đường
  mảnh, để các mũi tên không chồng lên thân và lên nhau; lực do tên lửa sinh ra (lực
  đẩy) vẽ từ điểm neo hướng ra theo chiều lực, lực bên ngoài (trọng lực, cản, nâng)
  vẽ thành mũi tên nằm ngoài điểm neo chĩa vào; vector tổng hợp (gia tốc) vẫn vẽ phía
  trước mũi tên lửa. Mũi tên dài tối đa 132 px, nét 2,6–3 px, đầu mũi 10 px và **ghi
  số ngay cạnh mũi tên** (N / kN / MN) để đọc được hướng và độ lớn tại chỗ. Độ dài mũi
  tên tự co theo lực lớn nhất trong khung hình (nên lực nhỏ vẫn thấy), màu riêng cho
  từng loại lực, và bảng chú giải ở góc dưới phải liệt kê màu + tên + **số N** hiện
  tại theo thứ tự độ lớn, dòng cuối là hợp lực tính bằng m/s².
- **Mốc độ cao quanh Trái Đất**: `render.js` vẽ vòng nét đứt ở 100 km (Kármán),
  400 km (ISS), 2 000 km, 10 000 km và 35 786 km (GEO), nhãn chỉ ghi độ cao và xếp
  thành một cột dọc phía trên tên lửa (theo phương thẳng đứng cục bộ). Vòng có bán
  kính hiện hình quá nhỏ (<14 px) hoặc quá lớn (hơn 40× cạnh màn hình) thì bỏ qua —
  khi camera đã vào sát mặt đất, vẽ cung bán kính hàng triệu pixel không cho thêm
  thông tin.
- **Gia tốc trọng trường trên HUD**: dòng riêng “Trọng trường” trong panel Thông số
  chuyến bay, đơn vị m/s², lấy từ `physics.gravityAt(r) = μ/r²` tại **bán kính đang
  bay** (`sim.last.gravity`). Tách khỏi dòng “Gia tốc” vì dòng đó là tải trọng g-load
  chứ không phải trọng trường.
- **Giới hạn chịu đựng trên bảng thông số**: dòng “Gia tốc” và “Nhiệt vỏ” hiển thị thêm
  ngưỡng phá huỷ sau dấu `|` (`12 g`, `2 000 °C`), chữ đỏ nhạt; vượt ngưỡng cảnh báo
  (`LIMITS.warnGLoad` / 600 °C) thì chữ giới hạn đỏ đậm và nhấp nháy, vượt ngưỡng phá huỷ
  thì cả ô đỏ. Nội dung giới hạn do `hud.js` ghi từ `LIMITS`, không viết tay trong HTML.
- **Thanh mức ga** nằm ngay dưới hai nút ga: vạch 25/50/75 %, vạch vàng ở 40 %
  (ngưỡng cháy tối thiểu của động cơ) và phần trăm hiện tại; dưới 40 % thanh đổi màu
  cảnh báo vì động cơ không cháy. Ngọn lửa đẩy dài/rộng/sáng theo đúng mức ga, có
  quầng sáng ở vòi và lõi trắng ở ga cao.

## Kiến trúc

Lõi mô phỏng tách hẳn khỏi lớp trình duyệt. Ranh giới này là hợp đồng quan trọng
nhất của module: `constants`, `atmosphere`, `rocket`, `world`, `physics`, `mission`
là JavaScript thuần, không chạm DOM, nên `verify.mjs` và `smoke-test.mjs` import
được chúng trong Node và kiểm chứng đúng đoạn mã mà trình duyệt chạy. `debris` (mảnh
tách tầng) cũng thuộc lõi đó: nó dùng chung `atmosphere`, `world` và được
`physics.stepSimulation` bước cùng tên lửa, nên tua thời gian cũng đúng. `main`,
`main`, `camera`, `render`, `hud`, `input`, `fullscreen`, `endHold`, `assistant`,
`audio` là lớp trình duyệt; chỉ phần *thuần* của chúng (ví dụ `buildSnapshot` trong
`assistant.js`) được kiểm thử tự động, phần chạm DOM thì không.

`main.js` sở hữu vòng lặp và trạng thái phi vụ; nó không tự tính vật lý mà chỉ
chuyển điều khiển vào `physics.stepSimulation` và đọc kết quả từ `sim.last`.

## Toàn màn hình

Một nút bật/tắt duy nhất ở góc phải header cho cả trang chiếm trọn màn hình; bấm lại
hoặc `Esc` để thoát. `fullscreen.js` đưa `<html>` lên toàn màn hình chứ không phải
`.app`: khi một phần tử vào toàn màn hình, các phần tử khác của `body` không còn được
vẽ, nên chọn `.app` sẽ làm màn hình kết quả (`#result`, một sibling của `.app`) biến
mất đúng lúc phi vụ kết thúc. CSS chỉ cần bỏ trần bề ngang 1560 px của `.app`.

Nút không tự giữ trạng thái: mọi thay đổi — kể cả `Esc`, `F11` hay nút của trình
duyệt — được đọc lại từ `fullscreenchange`, nên nhãn và `aria-pressed` luôn khớp sự
thật. Vào hay ra toàn màn hình **không** tạm dừng phi vụ; đó là thao tác hiển thị,
không phải thao tác điều khiển. Vì `Esc` đã thuộc về trình duyệt, nó chỉ có nghĩa
thoát toàn màn hình (ngoài chế độ này thì không làm gì) và **tạm dừng chuyển sang
phím `K`**. Trình duyệt không hỗ trợ Fullscreen API thì nút bị ẩn, không có nút chết.

## Hệ quy chiếu

Vật lý chạy trong **hệ quán tính địa tâm**, nên phương trình chuyển động thuần
Newton và không có lực quán tính giả. Khí quyển được mô hình là quay cùng Trái Đất:
lực cản dùng vận tốc tương đối `v − ω × r`. Nhờ vậy hiệu ứng Coriolis xuất hiện tự
nhiên, không cần thêm số hạng giả — và đó cũng là lý do mọi phép tính tốc độ tiếp
đất, ma sát mặt đất và khoảng cách tới bệ phóng đều dùng vận tốc/vị trí trong hệ
quay.

Hiển thị dùng **hệ quay cùng Trái Đất**: mặt đất và bệ phóng đứng yên trên màn
hình, đường bay cong đi theo Coriolis. Camera còn xoay cả cảnh để phương thẳng đứng
tại vị trí tên lửa luôn hướng lên trên màn hình. Đổi hệ chỉ là một phép quay khi vẽ.

## Vật lý

- **Trọng lực**: `a = −μ r̂ / r²`; độ lớn `μ/r²` được đưa vào `sim.last.gravity` để HUD
  và các vòng độ cao cùng đọc một nguồn.
- **Khí quyển**: bảng Khí quyển Chuẩn Quốc tế tới 100 km, nối tiếp bằng các lớp hàm
  mũ tới 1 000 km; trên mốc đó là chân không tuyệt đối. Suy ra khối lượng riêng, áp
  suất, nhiệt độ, vận tốc âm và hệ số cản `Cd(Mach)` có đỉnh transonic.
- **Lực đẩy**: `F = ga·(F_chân_không − p·A_vòi)`, lưu lượng `ṁ = ga·F_chân_không/(Isp·g₀)`.
  Động cơ không chạy dưới 40 % công suất. Khối lượng giảm thời gian thực nên gia tốc
  tăng dần đúng theo phương trình Tsiolkovsky.
- **Mô men**: gimbal khi đang cháy, RCS khi không, cộng thêm quyền điều khiển của
  cánh lái khí động tỉ lệ áp suất động; mô men khí động tự căn thân theo dòng chảy;
  tốc độ quay bị giới hạn và có giảm chấn.
- **Lực khí động ngang (lực nâng)**: `F⊥ = q·A·CN·sin(α)·cos(α)` — tuyến tính ở góc
  tấn nhỏ, tắt hẳn khi góc tấn ≥ 90° (thân nằm ngang dòng trở lên thì tấm chắn nhiệt
  hứng dòng, không còn “cánh”), hướng vuông góc dòng khí và kéo thân về phía dòng.
  `CN = 0,05` **cố ý nhỏ**: mô hình không mô phỏng điểm đặt lực (CP sau CG) nên lực
  này chỉ đẩy ngang mà không kèm mô men; hệ số lớn làm quỹ đạo vào lại khí quyển đổi
  hẳn và chuyến bay tham chiếu của `smoke-test` mất lái (đã đo: CN 0,05 hạ cánh được,
  CN ≥ 0,1 rơi 99 m/s với nghiêng ~92°).
- **Cảm biến lực**: mỗi bước, `sim.last.forces` phơi từng thành phần lực (N) — trọng
  lực, lực cản, lực đẩy, lực nâng — và `sim.last.accel` là gia tốc mà bộ tích phân
  dùng, nên tổng lực chia khối lượng luôn bằng đúng `accel` (được `verify.mjs` kiểm).
- **RCS tiêu hao**: bình khí 40 kg ở lưu lượng 0,667 kg/s ⇒ ~60 giây đốt liên tục,
  khí đã dùng trừ thẳng vào khối lượng. Động cơ cháy thì gimbal lo việc nghiêng và
  **không** tốn khí; động cơ tắt thì RCS làm, và chỉ khi lệnh nghiêng vượt 25 %
  (dưới mức đó coi là xung trim, có mô men nhưng không đáng kể khí — nếu không, một
  vòng quỹ đạo giữ lái liên tục sẽ đốt sạch bình). Hết khí thì quyền điều khiển chỉ
  còn cánh lái khí động. Khí RCS **không** tính vào điểm cuối phiên. Khi nghiêng
  bằng RCS, hai cụm thruster hai bên thân phụt khí trắng — thuần hiệu ứng, mô men
  vẫn là mô men thuần (không mô phỏng lực ngang do RCS lệch tâm).
- **Mảnh tách tầng**: tầng vừa tách thành vật thể riêng trong `sim.debris` — trọng
  lực, lực cản khí quyển, quay chậm có giảm chấn, gia nhiệt Sutton–Graves (quá
  2 000 °C thì bốc cháy); chạm đất thì kẹp đúng mặt đất, tóe bụi và mờ dần trong
  1,6 s rồi bị dọn khỏi mô phỏng. Mảnh vỡ không va chạm với tên lửa và không ảnh
  hưởng điểm số.
- **Kết thúc khi nổ**: bị phá huỷ thì hiệu ứng nổ chạy trước (chớp sáng, cầu lửa,
  vòng xung kích, tia lửa, khói), màn hình kết quả hiện sau **3 giây** thời gian
  thực. Phần hẹn giờ nằm ở `endHold.js` để hành vi kiểm chứng được độc lập với vòng
  lặp khung hình (tab nền không làm trễ kết quả).
- **Tư thế vào lại**: khi thân tên lửa quay ngược dòng khí (đuôi dẫn đầu), tấm chắn
  nhiệt ở đáy vỏ hứng dòng khí: lực cản nhân lên và gia nhiệt giảm. Hệ số chuyển
  tiếp liên tục theo góc tấn, không phải một ngưỡng bật/tắt.
- **Gia nhiệt**: thông lượng Sutton–Graves `q = 1,83e-4·√(ρ/R_mũi)·v³`; nhiệt độ vỏ
  tiến tới cân bằng bức xạ `T⁴ = q/(εσ)` với hằng số thời gian nhiệt hữu hạn — nên
  bay nhanh trong khí quyển dày trong thời gian ngắn vẫn an toàn, còn lao xuống lâu
  thì cháy. Vùng quá nhiệt được vẽ thành hào quang đỏ quanh phần hứng nhiệt và lớp
  nóng trên thân, đổi dần đỏ → cam → trắng khi tiến gần 2 000 °C; viền đỏ toàn cảnh
  vẫn giữ làm cảnh báo toàn màn hình.
- **Dù hai tầng**: **dù hãm** mở được dưới 12 km và dưới 450 m/s (Cd·A = 90 m²), **dù
  chính** mở được dưới 8 km và dưới 120 m/s (Cd·A = 1 600 m²). Cả hai tầng tăng diện
  tích trong 3 s và cộng dồn lực cản; dù chính **tự bung** khi đã có dù hãm và xuống
  dưới 4 km — đây là phần hỗ trợ hạ cánh, người chơi vẫn bung sớm hơn được bằng `P`.
  Khối lượng lúc dùng dù là tầng 2 khô + tải trọng (~12,5 t), nên tốc độ rơi cân bằng
  dưới cả hai dù ≈ **11 m/s** — chỉ cần một nhịp hãm ngắn là chạm đất dưới 6 m/s.
  Mở dù khi còn quá nhanh thì dù rách (không mở được), đúng như dù thật.
- **Tiếp đất**: phản lực pháp tuyến triệt tiêu vận tốc hướng tâm, ma sát Coulomb cản
  chuyển động ngang; hạ cánh thất bại nếu tốc độ chạm trên 6 m/s hoặc nghiêng trên
  12°; phá huỷ nếu quá tải trên 12 g hoặc vỏ trên 2 000 °C.

## Tích phân

RK4 với bước thích nghi: bước tối đa 0,1 s trong khí quyển và 5 s trong chân không,
tối đa 600 bước mỗi khung hình. Tua 1×–1000× (do thanh trượt đặt) tự hạ về 10× dưới
120 km và về 1× dưới 3 km hoặc khi dù đã mở, nên pha hạ cánh không bao giờ bị tua qua. Một bộ tích phân
duy nhất được chọn thay vì thêm bộ lan truyền Kepler giải tích khi tua nhanh: RK4
với bước thích nghi đủ chính xác cho LEO và tránh chỗ chuyển đổi trạng thái dễ sinh
lỗi.

## Nhiệm vụ và chấm điểm

Hai nhiệm vụ, định nghĩa trong `MISSIONS` (`mission.js`), chọn bằng hai nút ở thẻ
“Nhiệm vụ”; đổi nhiệm vụ đặt lại phi vụ về bệ phóng.

- **Nhiệm vụ 1 · Lên 20 km rồi hạ cánh** (mặc định): cất cánh trên 1 km → độ cao trên
  20 km → chạm đất an toàn (trạng thái `landed`, tức đã qua ngưỡng 6 m/s và 12°). Đây
  là chuyến bay dưới quỹ đạo, không cần chèn quỹ đạo.
- **Nhiệm vụ 2 · Một vòng quỹ đạo**: cất cánh trên 1 km → cận điểm trên 150 km với độ
  lệch tâm dưới 0,08 → bay đủ 360° → chạm đất trong khu hạ cánh bán kính 5 km.

Điểm cuối phiên luôn gồm **bốn tiêu chí × 25 điểm** nên hai nhiệm vụ so sánh được:
nhiên liệu còn lại, *tiêu chí mục tiêu*, độ chính xác hạ cánh và chất lượng tiếp đất.
Tiêu chí mục tiêu là **độ tròn quỹ đạo** với nhiệm vụ 2 và **độ cao đỉnh so với mục
tiêu** với nhiệm vụ 1. Tổng xếp hạng A–F; tên lửa bị phá huỷ nhận 0 điểm. Ngưỡng cụ
thể nằm trong `mission.js` và là hợp đồng chung cho HUD, trợ lý, màn hình kết quả và
`verify.mjs`.

**Ghi chú cân bằng:** mục tiêu 20 km được chọn sau khi đo bằng chính mô hình — thả rơi
từ 20 km hạ cánh 5,8 m/s (G đỉnh 5,3), 30 km vẫn hạ được nhưng G đỉnh 11,0 (sát ngưỡng
12), còn từ 35 km trở lên thì phá huỷ vì tên lửa tới mặt đất vẫn nhanh hơn tốc độ cho
phép mở dù. Vì vậy dù hãm được nới thành *dưới 12 km và dưới 450 m/s* (trước là 20 km /
250 m/s).

## Trợ lý phi vụ

`assistant.js` gom số liệu thành một gói phẳng (khoá tiếng Việt, số đã làm tròn, dưới
2 KB): trạng thái, thời gian, độ cao, tốc độ tổng/dọc/ngang, Mach, góc nghiêng, mức ga,
lực đẩy, khối lượng, tải trọng, nhiệt vỏ hiện tại và cao nhất, áp suất, tầng đang dùng,
phần trăm nhiên liệu hai tầng, khí RCS, các phần tử quỹ đạo, bốn thành phần lực, bệ
phóng gần nhất và khoảng cách, mức tua thời gian. `buildSnapshot` là hàm thuần nên
`verify.mjs` kiểm được nó.

Mỗi gói tin mang thêm `nhiemVu` (id, tên, mục tiêu, bối cảnh riêng, bước đang làm,
hướng dẫn) để server ghép vào system prompt: nhiệm vụ 1 thì trợ lý chỉ bàn về độ cao và
hạ cánh, nhiệm vụ 2 mới bàn về chèn quỹ đạo và điểm rơi.

Panel ở góc phải trên sân khấu bật/tắt trợ lý và đặt nhịp gửi (2–60 giây, mặc định 5,
lưu trong `localStorage`). Mỗi nhịp gửi `POST /api/assistant`; server gọi DeepSeek với
model `deepseek-chat`, system prompt yêu cầu trả lời tiếng Việt tối đa 2 câu (trạng thái
+ một hành động cụ thể), không markdown, không bịa số liệu. Lỗi thiếu key / lỗi mạng
hiện nguyên văn trong panel kèm nút **Thử lại**; `GET /api/assistant/status` cho biết
server đã có key chưa để panel báo trước khi hỏi.

## Kiểm chứng

`verify.mjs` kiểm tra từng công thức bằng cách tính lại giá trị từ định nghĩa gốc
(không có hằng số PASS), gồm cả bảo toàn năng lượng và mô men động lượng trong chân
không, cộng thêm mô men RCS (khí tiêu theo lưu lượng, khối lượng giảm đúng bằng khí,
gimbal khi cháy không tốn khí, hết khí thì mất điều khiển) và mảnh tách tầng (khối
lượng khô, rơi về mặt đất, bị dọn khỏi mô phỏng). `smoke-test.mjs` chạy một phi công tự động qua trọn phi vụ trên chính lõi vật
lý của game. Cả hai chạy bằng Node, không cần trình duyệt.

## Điểm đã biết

- Hạ cánh đúng khu hạ cánh sau một vòng đòi hỏi dẫn đường thật: một vòng quỹ đạo mất
  ~90 phút trong khi Trái Đất quay ~22°, nên điểm hạ cánh lệch khoảng 2 400 km so với
  bệ phóng. Đây là hệ quả của mô hình, không phải lỗi cân bằng.
- Thân tên lửa được vẽ với kích thước tối thiểu trên màn hình khi camera đã lùi xa;
  kích thước hiển thị vì vậy không còn tỉ lệ với mặt đất ở độ cao lớn.
- `smoke-test.mjs` hạ cánh an toàn nhưng không nhắm đúng bệ phóng: dẫn đường tới bệ
  là kỹ năng của người chơi, không phải điều kiện của bài kiểm thử. Phi công tự động
  giữ lái liên tục nên đốt hết bình khí RCS trong một phi vụ trọn vẹn — người chơi
  tiết kiệm hơn thì còn khí.
- Ở camera xa, mảnh tách tầng được vẽ với kích thước tối thiểu 28 px nên trong vài
  giây đầu nó nằm sát luồng xả của tên lửa; nó rõ dần khi rơi xa ra. Góc nhìn gần là
  chỗ nhìn rõ mảnh vỡ ngay từ đầu.
- Ở góc nhìn gần, khung hình chỉ rộng vài trăm mét nên mặt đất và bệ phóng thường ra
  ngoài màn hình — đó là lý do có bản đồ nhỏ thay cho bối cảnh.
