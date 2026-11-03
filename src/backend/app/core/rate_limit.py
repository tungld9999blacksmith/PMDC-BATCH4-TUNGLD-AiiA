"""Giới hạn tần suất theo người dùng (cửa sổ trượt 60 giây, trong bộ nhớ tiến trình)."""

import math
import threading
import time
from collections import defaultdict, deque

from app.core.errors import ProblemError


class SlidingWindowLimiter:
    def __init__(self, per_minute: int) -> None:
        self.per_minute = per_minute
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and hits[0] <= now - 60:
                hits.popleft()
            if len(hits) >= self.per_minute:
                retry = max(1, math.ceil(60 - (now - hits[0])))
                raise ProblemError(
                    429,
                    "Quá nhiều yêu cầu",
                    f"Bạn đã hỏi quá {self.per_minute} câu trong một phút, thử lại sau {retry} giây",
                    type_="rate-limited",
                    headers={"Retry-After": str(retry)},
                )
            hits.append(now)
