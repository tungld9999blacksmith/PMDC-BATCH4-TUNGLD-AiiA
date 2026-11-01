from fastapi import FastAPI

from app.api.v1.health import router as health_router

app = FastAPI(
    title="AiiA Platform API",
    version="0.1.0",
    description="Platform API của AiiA. Hợp đồng đầy đủ: docs/api/openapi.yaml.",
)
app.include_router(health_router)
