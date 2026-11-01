"""Celery worker cho tác vụ nền: xuất báo cáo, gửi thông báo, thu hồi quyền hết hạn."""

from celery import Celery

from app.core.config import settings

celery_app = Celery("aiia", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(task_serializer="json", accept_content=["json"], result_serializer="json")


@celery_app.task(name="aiia.ping")
def ping() -> str:
    return "pong"
