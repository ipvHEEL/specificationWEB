from fastapi import FastAPI, Depends, Query, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from typing import List, Optional
from collections import defaultdict

from database import get_db
from models import SpecificationMaterialExplosion, SpecificationMaterialExplosionPf

app = FastAPI(title="BOM Iris Viewer")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

MAX_DEPTH = 5  # защита от циклов


# ---------- Цветовая схема по типу ----------
TYPE_COLORS = {
    "СЫРЬЕ":   "#8BC34A",   # зелёный
    "ТМЦ":     "#2196F3",   # синий
    "ТАРА":    "#FF9800",   # оранжевый
    "CSB П/Ф": "#AB47BC",   # фиолетовый (полуфабрикат)
    "ГП":      "#F44336",   # красный (готовая продукция)
    "ПФ":      "#9C27B0",
}


def color_for(type_art: str) -> str:
    return TYPE_COLORS.get(type_art, "#607D8B")


# ---------- Главная страница ----------
@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


# ---------- Поиск спецификаций ----------
@app.get("/api/search")
def search_bom(
    q: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
):
    """Поиск по коду (BOM_ITEM) или названию (BOM_NAME) в обеих таблицах"""
    like = f"%{q}%"
    results = []
    seen = set()

    for model, source in (
        (SpecificationMaterialExplosion, "explosion"),
        (SpecificationMaterialExplosionPf, "explosion_pf"),
    ):
        rows = (
            db.query(model)
            .filter(
                (model.BOM_ITEM.ilike(like)) | (model.BOM_NAME.ilike(like))
            )
            .all()
        )
        for r in rows:
            key = (r.BOM_ITEM, source)
            if key in seen:
                continue
            seen.add(key)
            results.append({
                "bom_item": r.BOM_ITEM,
                "bom_name": (r.BOM_NAME or "").strip(),
                "source": source,
                "bom_var": r.BOM_VAR,
            })
    return results[:50]


# ---------- Получение компонентов спецификации ----------
def _get_components(db: Session, bom_item: str):
    """Возвращает компоненты из обеих таблиц для заданного BOM_ITEM"""
    comps = []
    for model in (SpecificationMaterialExplosion, SpecificationMaterialExplosionPf):
        rows = db.query(model).filter(model.BOM_ITEM == bom_item).all()
        for r in rows:
            comps.append({
                "comp_item": str(r.COMP_ITEM).strip() if r.COMP_ITEM is not None else "",
                "comp_name": str(r.COMP_NAME).strip() if r.COMP_NAME is not None else "",
                "type_art": str(r.Type_Art).strip() if r.Type_Art is not None else "",
                "unit": str(r.SY0012_EK_ME).strip() if r.SY0012_EK_ME is not None else "",
                "qty": float(r.COMP_QNT or 0),
                "ek_kgme": float(r.COMP_EK_KGME or 0),
                "explosion": int(r.COMP_EXPLOSION or 0),
                "byprod": int(r.COMP_BYPROD or 0),
            })
    return comps


# ---------- Построение дерева (рекурсивно по ПФ с COMP_EXPLOSION=1) ----------
def _build_tree(db: Session, bom_item: str, bom_name: str, depth: int = 0, visited: set = None):
    if visited is None:
        visited = set()
    
    bom_item_str = str(bom_item)
    
    if depth > MAX_DEPTH or bom_item_str in visited:
        return {"id": bom_item_str, "name": bom_name, "type": "ГП", "children": [], "truncated": True}

    visited.add(bom_item_str)
    components = _get_components(db, bom_item_str)

    children = []
    for c in components:
        child_node = {
            "id": c["comp_item"],
            "name": c["comp_name"],
            "type": c["type_art"],
            "unit": c["unit"],
            "qty": c["qty"],
            "ek_kgme": c["ek_kgme"],
            "byprod": c["byprod"],
        }
        # Если это ПФ с флагом "раскрытие" — рекурсивно идём дальше
        if c["explosion"] == 1 and c["type_art"] in ("CSB П/Ф", "ПФ"):
            subtree = _build_tree(db, c["comp_item"], c["comp_name"], depth + 1, visited.copy())
            child_node["children"] = subtree.get("children", [])
            child_node["expandable"] = True
        children.append(child_node)

    return {
        "id": bom_item_str,
        "name": bom_name,
        "type": "ГП",
        "children": children,
    }


@app.get("/api/bom-tree/{bom_item}")
def get_bom_tree(bom_item: str, db: Session = Depends(get_db)):
    """Полное дерево спецификации"""
    # Определяем название корня
    root_name = bom_item
    for model in (SpecificationMaterialExplosion, SpecificationMaterialExplosionPf):
        row = db.query(model).filter(model.BOM_ITEM == bom_item).first()
        if row:
            root_name = (row.BOM_NAME or "").strip()
            break

    tree = _build_tree(db, bom_item, root_name)
    return {"root": tree, "colors": TYPE_COLORS}


# ---------- Плоский список узлов и рёбер для vis-network ----------
def _flatten_tree(node, nodes_map, edges, parent_id=None):
    """Преобразует дерево в плоские списки nodes/edges"""
    node_id = node["id"]
    if node_id not in nodes_map:
        nodes_map[node_id] = {
            "id": node_id,
            "label": f"{node_id}\n{node['name'][:40]}",
            "title": (
                f"<b>{node['name']}</b><br>"
                f"Код: {node_id}<br>"
                f"Тип: {node['type']}<br>"
                + (f"Количество: {node.get('qty', 0)} {node.get('unit', '')}<br>" if node.get('qty') else "")
            ),
            "color": color_for(node["type"]),
            "shape": "box",
            "font": {"multi": True, "size": 14},
            "type": node["type"],
            "expandable": bool(node.get("children")),
        }
    if parent_id is not None:
        edges.append({
            "from": parent_id,
            "to": node_id,
            "label": f"{node.get('qty', '')} {node.get('unit', '')}".strip(),
            "arrows": "to",
        })
    for child in node.get("children", []):
        _flatten_tree(child, nodes_map, edges, node_id)


@app.get("/api/bom-graph/{bom_item}")
def get_bom_graph(bom_item: str, db: Session = Depends(get_db)):
    """Возвращает nodes/edges для vis-network"""
    tree_resp = get_bom_tree(bom_item, db)
    root = tree_resp["root"]

    nodes_map = {}
    edges = []
    _flatten_tree(root, nodes_map, edges)

    return {
        "nodes": list(nodes_map.values()),
        "edges": edges,
        "colors": TYPE_COLORS,
        "root_id": root["id"],
        "root_name": root["name"],
    }


# ---------- Список всех уникальных BOM (для выпадашки) ----------
@app.get("/api/bom-list")
def list_bom(db: Session = Depends(get_db)):
    items = []
    for model in (SpecificationMaterialExplosion, SpecificationMaterialExplosionPf):
        rows = (
            db.query(model.BOM_ITEM, model.BOM_NAME)
            .distinct()
            .all()
        )
        for r in rows:
            items.append({
                "bom_item": r.BOM_ITEM.strip(),
                "bom_name": (r.BOM_NAME or "").strip(),
            })
    # уникализируем
    seen = set()
    unique = []
    for it in items:
        if it["bom_item"] not in seen:
            seen.add(it["bom_item"])
            unique.append(it)
    return unique