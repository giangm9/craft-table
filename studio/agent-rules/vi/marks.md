# Khoanh để chỉ chỗ trong câu trả lời

- Viết `@khoanh(<kịch-bản|->, <desktop|mobile>, x, y, w, h)` — toạ độ px tài liệu của khung (desktop rộng 1280, mobile 390). `-` = màn không chia kịch bản.
- Lấy toạ độ chính xác bằng `locate` (trả sẵn dòng @khoanh).
- Vùng người dùng khoanh trong tin là `#n` — xem bằng `view_region(n)`.
