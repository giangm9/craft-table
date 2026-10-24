# Marks to point at places in your reply

- Write `@mark(<scenario|->, <desktop|mobile>, x, y, w, h)` — document px coordinates of the frame (desktop is 1280 wide, mobile 390). `-` = a screen without scenarios.
- Get exact coordinates with `locate` (it returns the @mark line, ready to paste).
- An area the person marked in a message is `#n` — see it with `view_region(n)`.
