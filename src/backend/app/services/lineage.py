"""Lineage (US31) và phân tích tác động (US32) trên đồ thị lineage_nodes/lineage_edges."""

from collections import deque

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import not_found
from app.domain.enums import LineageNodeType
from app.domain.models import Dataset, LineageEdge, LineageNode
from app.schemas.bi import LineageEdgeOut, LineageGraph
from app.schemas.bi import LineageNode as LineageNodeOut

MAX_NODES = 1000


def _node_out(db: Session, node: LineageNode, layers: dict[str, str] | None = None) -> LineageNodeOut:
    layer = None
    if node.node_type == LineageNodeType.DATASET:
        if layers is not None:
            layer = layers.get(node.ref_id)
        elif node.ref_id.isdigit():
            dataset = db.get(Dataset, int(node.ref_id))
            layer = dataset.layer if dataset else None
    return LineageNodeOut(id=node.id, type=node.node_type, ref_id=node.ref_id, name=node.name, layer=layer)


def _layers(db: Session) -> dict[str, str]:
    return {str(i): layer for i, layer in db.execute(select(Dataset.id, Dataset.layer)).all()}


def _find(db: Session, node_type: LineageNodeType, ref_id: str) -> LineageNode | None:
    return db.scalar(select(LineageNode).where(LineageNode.node_type == node_type, LineageNode.ref_id == ref_id))


def _walk(db: Session, start: int, direction: str, depth: int | None, include_columns: bool) -> tuple[set[int], list[LineageEdge]]:
    seen, edges = {start}, []
    queue = deque([(start, 0)])
    while queue and len(seen) < MAX_NODES:
        current, level = queue.popleft()
        if depth is not None and level >= depth:
            continue
        stmt = select(LineageEdge, LineageNode)
        if direction == "DOWNSTREAM":
            stmt = stmt.join(LineageNode, LineageNode.id == LineageEdge.to_node_id).where(LineageEdge.from_node_id == current)
        else:
            stmt = stmt.join(LineageNode, LineageNode.id == LineageEdge.from_node_id).where(LineageEdge.to_node_id == current)
        for edge, neighbour in db.execute(stmt).all():
            if not include_columns and neighbour.node_type == LineageNodeType.COLUMN:
                continue
            edges.append(edge)
            if neighbour.id not in seen:
                seen.add(neighbour.id)
                queue.append((neighbour.id, level + 1))
    return seen, edges


def get_lineage(db: Session, node_type: LineageNodeType, ref_id: str, direction: str, depth: int, column_level: bool) -> LineageGraph:
    center = _find(db, node_type, ref_id)
    if center is None:
        raise not_found("Không có nút lineage này")
    node_ids, edges = {center.id}, []
    for d in ("UPSTREAM", "DOWNSTREAM") if direction == "BOTH" else (direction,):
        ids, found = _walk(db, center.id, d, depth, column_level)
        node_ids |= ids
        edges += found
    nodes = db.scalars(select(LineageNode).where(LineageNode.id.in_(node_ids))).all()
    layers = _layers(db)
    unique_edges = {e.id: e for e in edges}.values()
    return LineageGraph(
        center=_node_out(db, center, layers),
        nodes=[_node_out(db, n, layers) for n in sorted(nodes, key=lambda n: n.id)],
        edges=[LineageEdgeOut(from_=e.from_node_id, to=e.to_node_id, transform_ref=e.transform_ref) for e in unique_edges],
    )


def impacted_nodes(db: Session, node_type: LineageNodeType, ref_id: str) -> list[LineageNodeOut]:
    center = _find(db, node_type, ref_id)
    if center is None:
        return []
    ids, _ = _walk(db, center.id, "DOWNSTREAM", None, include_columns=True)
    ids.discard(center.id)
    if not ids:
        return []
    layers = _layers(db)
    nodes = db.scalars(select(LineageNode).where(LineageNode.id.in_(ids)).order_by(LineageNode.node_type, LineageNode.name)).all()
    return [_node_out(db, n, layers) for n in nodes]


def get_impact(db: Session, node_type: LineageNodeType, ref_id: str) -> list[LineageNodeOut]:
    if _find(db, node_type, ref_id) is None:
        raise not_found("Không có nút lineage này")
    return impacted_nodes(db, node_type, ref_id)
