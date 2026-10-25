# Bản vẽ và thông tin màn

- Mỗi phiên bản là bản sao đầy đủ `versions/<phiên-bản>/{boards,system}`. CHỈ sửa trong đúng phiên bản của luồng.
- Bản vẽ là React thật: `boards/<id>.tsx`, chỉ `export default` một component nhận prop `scenario` (id kịch bản) và dựng đúng trạng thái của kịch bản đó.
- Bản vẽ chỉ import: `react`, `lucide-react`, `@ds` (design system của phiên bản), `boards/_kit/**`. Dữ liệu là dữ liệu GIẢ (`boards/_kit/fixtures.ts`).
- Thông tin màn ở `boards/<id>.meta.json` cạnh bản vẽ: `title`, `section`, `group`, `order`, `status`, `desc`, `viewports`, `scenarios: [{ id, title, desc }]`. `status` là một trong `current` (giống app hiện nay), `proposed` (đề xuất), `approved` (đã chốt). Tên/mô tả/kịch bản là LỜI THƯỜNG (xem luật lời thường của dự án trong `rules`, nếu có).
- Sửa THẲNG các màn người dùng nhờ, tại chỗ, trong phiên bản của luồng — kể cả màn `current`. Không bao giờ tự chép màn sang phương án hay phiên bản mới để khỏi đụng vào nó. Không đổi `status` khi người dùng không nhờ.
- `current` = màn được vẽ theo app thật. Khi khẳng định app hiện nay làm gì thì tra mã nguồn nếu dự án có khai (`src:<thư-mục>/...`), trích đường dẫn:dòng.
- Phương án của một màn có id `<màn>~<tên-không-dấu>` (file cạnh màn chính: `.tsx`, `.meta.json`, đặc tả nếu có). Sửa phương án như sửa màn thường.
- CHỈ tạo phương án mới khi người dùng nhờ (phương án, biến thể, bản để so sánh) — không bao giờ tự tạo, kể cả với thay đổi lớn. Khi đó chép bản vẽ + thông tin của màn chính sang `<màn>~<tên>`, và meta PHẢI có
  `"option": { "of": "<màn chính>", "name": "<tên ngắn, vd A. Bản gọn>", "status": "trying" }` — `of` đúng id màn chính,
  `name` là tên hiện trong danh sách màn. Công cụ write/edit từ chối dạng khác. Không tự đổi `status`; chốt do người dùng bấm.
- Sau khi sửa `.tsx`: `check typecheck` phải sạch, rồi `view_frame` đúng kịch bản để tự xem kết quả.
