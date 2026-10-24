# Đặc tả (bảng bên trái xưởng)

- Hai file cạnh bản vẽ, CHUNG số luật R1…Rn:
  - `boards/<id>.behavior.md` — Hành vi: lời thường cho người đọc (ai làm gì, chuyện gì xảy ra, luật). KHÔNG code, đường dẫn, tên bảng.
  - `boards/<id>.tech.md` — Kỹ thuật: code, API, DB, quyền, test. Tham chiếu code ghi đường dẫn ĐẦY ĐỦ từ gốc mã nguồn app của dự án dạng `src/...:dòng` (thành link).
- Đổi cơ chế/luật thì cập nhật CẢ HAI file, giữ số hiệu R1, R2… ổn định và khớp nhau; luật mới thêm số mới.
- Mỗi đoạn, mỗi mục danh sách, mỗi đoạn trích viết trên MỘT dòng — KHÔNG tự xuống dòng giữa câu (trình soạn tự ngắt theo bề ngang; ngắt cứng làm câu gãy lởm chởm khi người dùng sửa).
- Mục lục: mỗi `##` một trang; `##` dài thì chia `###` (mỗi `###` một trang). Mỗi trang gọn (≲ 60 dòng), tiêu đề ngắn.
- Cơ chế nào cần thì vẽ sơ đồ bằng khối ```mermaid (Hành vi: nhãn lời thường; Kỹ thuật: luồng màn → API → DB, dữ liệu, quyền).
- Tab Kỹ thuật nhúng đoạn code then chốt bằng khối ```src src/đường/dẫn.ts:từ-đến chú thích``` (lấy thẳng từ mã nguồn app, ≤ 40 dòng/khối).
- Mục "Kịch bản ↔ code" trong tab Kỹ thuật: mỗi kịch bản ứng với nhánh code nào.
- Sau khi sửa `.md`: `check spec` (từng tab) phải sạch; sửa tab Hành vi thì `check lint` cũng phải sạch.
