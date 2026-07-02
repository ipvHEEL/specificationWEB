from fastapi import FastAPI, Depends, Query, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from sqlalchemy import String
from typing import List, Optional
from collections import defaultdict
import time

from database import get_db
from models import SpecificationMaterialExplosion, SpecificationMaterialExplosionPf, specification_variant_and_versions

app = FastAPI(title="BOM Iris Viewer")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

MAX_DEPTH = 10  # Увеличили глубину рекурсии


# ---------- Цветовая схема по типу ----------
TYPE_COLORS = {
    "СЫРЬЕ":   "#8BC34A",
    "ТМЦ":     "#2196F3",
    "ТАРА":    "#FF9800",
    "CSB П/Ф": "#AB47BC",
    "ПФ":      "#9C27B0",
    "ГП":      "#F44336",
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
                (model.BOM_ITEM.cast(String).ilike(like)) | (model.BOM_NAME.ilike(like))
            )
            .all()
        )
        for r in rows:
            key = (str(r.BOM_ITEM), source)
            if key in seen:
                continue
            seen.add(key)
            results.append({
                "bom_item": str(r.BOM_ITEM).strip(),
                "bom_name": str(r.BOM_NAME).strip() if r.BOM_NAME else "",
                "source": source,
                "bom_var": r.BOM_VAR,
            })
    return results[:50]


# ---------- Получение компонентов для конкретного BOM_ITEM ----------
def _get_components(db: Session, bom_item: str):
    """Возвращает компоненты для заданного BOM_ITEM из обеих таблиц"""
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


# ---------- Построение дерева с правильной иерархией ----------
def _build_tree(db: Session, bom_item: str, bom_name: str, depth: int = 0, visited: set = None):
    if visited is None:
        visited = set()
    
    bom_item_str = str(bom_item).strip()
    
    # Защита от циклов
    if depth > MAX_DEPTH or bom_item_str in visited:
        return {
            "id": bom_item_str,
            "name": bom_name,
            "type": "ГП" if depth == 0 else "ПФ",
            "children": [],
            "truncated": True
        }

    visited.add(bom_item_str)
    
    # Получаем компоненты для текущего BOM_ITEM из ОБЕИХ таблиц
    components = _get_components(db, bom_item_str)

    children = []
    for c in components:
        # Определяем, является ли компонент полуфабрикатом, который нужно раскрыть
        is_pf = c["type_art"] in ("ПФ", "CSB П/Ф", "Csb П/Ф", "п/ф")
        should_explode = c["explosion"] == 1 or is_pf
        
        child_node = {
            "id": c["comp_item"],
            "name": c["comp_name"],
            "type": c["type_art"],
            "unit": c["unit"],
            "qty": c["qty"],
            "ek_kgme": c["ek_kgme"],
            "byprod": c["byprod"],
            "children": [],
            "expandable": False
        }
        
        # Рекурсивно строим дерево для ПФ
        if should_explode and depth < MAX_DEPTH:
            # Проверяем, есть ли у этого компонента свои дети в БД
            child_components = _get_components(db, c["comp_item"])
            if child_components:  # Если есть компоненты - рекурсивно строим
                subtree = _build_tree(
                    db, 
                    c["comp_item"], 
                    c["comp_name"], 
                    depth + 1, 
                    visited.copy()
                )
                child_node["children"] = subtree.get("children", [])
                child_node["expandable"] = True
        
        children.append(child_node)

    return {
        "id": bom_item_str,
        "name": bom_name,
        "type": "ГП" if depth == 0 else "ПФ",
        "children": children,
    }

@app.get("/api/debug-tree/{bom_item}")
def debug_tree(bom_item: str, db: Session = Depends(get_db)):
    """Показывает полное дерево в JSON для диагностики"""
    bom_item_str = str(bom_item)
    
    root_name = bom_item_str
    for model in (SpecificationMaterialExplosion, SpecificationMaterialExplosionPf):
        row = db.query(model).filter(model.BOM_ITEM == bom_item_str).first()
        if row:
            root_name = str(row.BOM_NAME).strip() if row.BOM_NAME else bom_item_str
            break

    tree = _build_tree(db, bom_item_str, root_name)
    
    # Подсчёт дубликатов
    all_ids = []
    def collect_ids(node):
        all_ids.append(node["id"])
        for c in node.get("children", []):
            collect_ids(c)
    collect_ids(tree)
    
    from collections import Counter
    duplicates = {k: v for k, v in Counter(all_ids).items() if v > 1}
    
    return {
        "tree": tree,
        "total_nodes": len(all_ids),
        "unique_nodes": len(set(all_ids)),
        "duplicates": duplicates,  # ← ключевая информация!
    }

@app.get("/api/specifications/vaiant/{bom_item}")
def get_variant_bom(bom_item: str, db: Session = Depends(get_db)):
    bom_item_str = str(bom_item)

    rows = db.query(specification_variant_and_versions)
    result = []
    # for row in rows:
    #     result.append(row)
    # print(result)
    return {"oker" : rows}

@app.get("/api/bom-tree/{bom_item}")
def get_bom_tree(bom_item: str, db: Session = Depends(get_db)):
    bom_item_str = str(bom_item)
    
    # Определяем название корня
    root_name = bom_item_str
    for model in (SpecificationMaterialExplosion, SpecificationMaterialExplosionPf):
        row = db.query(model).filter(model.BOM_ITEM == bom_item_str).first()
        if row:
            root_name = str(row.BOM_NAME).strip() if row.BOM_NAME else bom_item_str
            break

    tree = _build_tree(db, bom_item_str, root_name)
    return {"root": tree, "colors": TYPE_COLORS}


# ---------- Плоский список узлов и рёбер для vis-network ----------
def _flatten_tree(node, nodes_map, edges, parent_id=None, seen_nodes=None):
    """Преобразует дерево в плоские списки nodes/edges с дедупликацией"""
    if seen_nodes is None:
        seen_nodes = set()
    
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
        
        # Добавляем ребро только если узел ещё не имеет родителя
        if parent_id is not None:
            edge_key = f"{parent_id}->{node_id}"
            if edge_key not in seen_nodes:
                edges.append({
                    "from": parent_id,
                    "to": node_id,
                    "label": f"{node.get('qty', '')} {node.get('unit', '')}".strip(),
                    "arrows": "to",
                })
                seen_nodes.add(edge_key)
    
    # Рекурсивно обрабатываем детей
    for child in node.get("children", []):
        _flatten_tree(child, nodes_map, edges, node_id, seen_nodes)


@app.get("/api/bom-graph/{bom_item}")
def get_bom_graph(bom_item: str, db: Session = Depends(get_db)):
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


# ---------- Список всех уникальных BOM ----------
@app.get("/api/bom-list")
def list_bom(db: Session = Depends(get_db)):
    items = []

    #start sql
    for model in (SpecificationMaterialExplosion, SpecificationMaterialExplosionPf):
        # start sqlORM
        rows = (
            db.query(model.BOM_ITEM, model.BOM_NAME)
            .distinct()
            .all()
        )
        #end sqlORM 2.969244956970215
        for r in rows:
            items.append({
                "bom_item": r.BOM_ITEM.strip() if hasattr(r.BOM_ITEM, 'strip') else str(r.BOM_ITEM),
                "bom_name": (r.BOM_NAME or "").strip() if r.BOM_NAME else "",
            })
        
    #end  sql 3.2588860988616943 sec
    #start python 
    seen = set()
    unique = []
    for it in items:
        if it["bom_item"] not in seen:
            seen.add(it["bom_item"])
            unique.append(it)
    #end python 0.0007236003875732422
    return unique