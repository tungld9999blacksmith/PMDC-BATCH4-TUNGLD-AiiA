"""Dependency dùng chung cho router."""

from fastapi import Depends

from app.core.db import get_db
from app.core.security import get_principal, require_roles
from app.domain.enums import RoleCode as R
from app.query.gateway import get_gateway

Db = Depends(get_db)
AnyUser = Depends(get_principal)
Gateway = Depends(get_gateway)

ADMIN = Depends(require_roles(R.PLATFORM_ADMIN))
ENGINEER = Depends(require_roles(R.DATA_ENGINEER))
STEWARD = Depends(require_roles(R.DATA_STEWARD))
ANALYST = Depends(require_roles(R.BI_ANALYST))
PROFILE_READERS = Depends(require_roles(R.REPORT_VIEWER, R.BI_ANALYST, R.DATA_STEWARD))
SOURCE_READERS = Depends(require_roles(R.DATA_ENGINEER, R.DATA_STEWARD, R.PLATFORM_ADMIN))
DATA_OPS = Depends(require_roles(R.DATA_STEWARD, R.DATA_ENGINEER))
