let currentTree = null;
let currentColors = {};
let selectedNode = null;

const graphEl = document.getElementById('graph');
const searchInput = document.getElementById('searchInput');
const suggestions = document.getElementById('suggestions');
const infoPanel = document.getElementById('info');
const loader = document.getElementById('loader');

const RADIAL_MARGIN = 140;
const LABEL_LIMIT = 34;
const ZOOM_MIN = 0.06;
const ZOOM_MAX = 8;
const ZOOM_STEP = 1.35;
let graphZoom = null;
let graphSvg = null;

// ---------- Поиск с автодополнением ----------
let searchTimer;
searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (q.length < 2) { suggestions.style.display = 'none'; return; }
    searchTimer = setTimeout(async () => {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        renderSuggestions(data);
    }, 250);
});

function renderSuggestions(items) {
    if (!items.length) { suggestions.style.display = 'none'; return; }
    suggestions.innerHTML = items.map(it => `
        <div class="sugg-item" data-id="${it.bom_item}">
            <span class="code">${it.bom_item}</span>
            <span class="name">${escapeHtml(it.bom_name)}</span>
        </div>
    `).join('');
    suggestions.style.display = 'block';
    suggestions.querySelectorAll('.sugg-item').forEach(el => {
        el.onclick = () => {
            loadGraph(el.dataset.id);
            suggestions.style.display = 'none';
            searchInput.value = el.dataset.id;
        };
    });
}

document.addEventListener('click', e => {
    if (!e.target.closest('.search-box')) suggestions.style.display = 'none';
});

// ---------- Загрузка дерева спецификации ----------
async function loadGraph(bomItem) {
    loader.style.display = 'flex';
    infoPanel.style.display = 'none';
    try {
        const res = await fetch(`/api/bom-tree/${encodeURIComponent(bomItem)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        currentTree = data.root;
        currentColors = data.colors || {};
        renderIrisDiagram(currentTree);
    } catch (e) {
        alert('Ошибка загрузки: ' + e.message);
    } finally {
        loader.style.display = 'none';
    }
}

function renderIrisDiagram(tree) {
    graphEl.innerHTML = '';

    const root = d3.hierarchy(tree);
    const nodeWidth = 168;
    const nodeHeight = 58;
    const skew = 18;
    const horizontalGap = 62;
    const verticalGap = 112;

    d3.tree()
        .nodeSize([nodeWidth + horizontalGap, nodeHeight + verticalGap])
        .separation((a, b) => (a.parent === b.parent ? 1 : 1.25))(root);

    const nodes = root.descendants();
    const minX = d3.min(nodes, d => d.x) || 0;
    const maxX = d3.max(nodes, d => d.x) || 0;
    const maxY = d3.max(nodes, d => d.y) || 0;
    const padding = { top: 70, right: 120, bottom: 90, left: 120 };
    const width = Math.max(graphEl.clientWidth, maxX - minX + padding.left + padding.right + nodeWidth);
    const height = Math.max(graphEl.clientHeight, maxY + padding.top + padding.bottom + nodeHeight);
    const offsetX = width / 2 - (minX + maxX) / 2;
    const offsetY = padding.top;

    const svg = d3.select(graphEl)
        .append('svg')
        .attr('class', 'iris-svg flow-svg')
        .attr('viewBox', [0, 0, width, height])
        .attr('width', '100%')
        .attr('height', '100%');

    const grid = svg.append('defs').append('pattern')
        .attr('id', 'flow-grid')
        .attr('width', 18)
        .attr('height', 18)
        .attr('patternUnits', 'userSpaceOnUse');
    grid.append('circle')
        .attr('cx', 1)
        .attr('cy', 1)
        .attr('r', 1.2)
        .attr('fill', '#b7c3d7')
        .attr('opacity', 0.55);

    svg.append('rect')
        .attr('width', width)
        .attr('height', height)
        .attr('fill', 'url(#flow-grid)');

    const viewport = svg.append('g').attr('class', 'iris-viewport');
    graphSvg = svg;
    graphZoom = d3.zoom()
        .scaleExtent([ZOOM_MIN, ZOOM_MAX])
        .on('zoom', event => viewport.attr('transform', event.transform));
    svg.call(graphZoom);
    applyInitialZoom(svg, graphZoom, width, height);

    const nodeX = d => d.x + offsetX;
    const nodeY = d => d.y + offsetY;

    viewport.append('g')
        .attr('class', 'flow-links')
        .selectAll('path')
        .data(root.links())
        .join('path')
        .attr('d', d => flowLinkPath(d, nodeX, nodeY, nodeWidth, nodeHeight))
        .attr('stroke', '#424242')
        .attr('stroke-width', 2.2)
        .attr('stroke-linejoin', 'round')
        .attr('stroke-linecap', 'round')
        .attr('fill', 'none');

    const node = viewport.append('g')
        .attr('class', 'iris-nodes flow-nodes')
        .selectAll('g')
        .data(nodes)
        .join('g')
        .attr('class', d => `iris-node flow-node depth-${d.depth}`)
        .attr('transform', d => `translate(${nodeX(d) - nodeWidth / 2},${nodeY(d) - nodeHeight / 2})`)
        .on('click', (event, d) => {
            selectedNode = d;
            showInfo(d.data, d);
            graphEl.querySelectorAll('.iris-node').forEach(el => el.classList.remove('selected'));
            event.currentTarget.classList.add('selected');
        })
        .on('dblclick', (event, d) => {
            event.stopPropagation();
            if (d.data.expandable || (d.children && d.children.length)) loadGraph(d.data.id);
        });

    node.append('polygon')
        .attr('points', `0,0 ${nodeWidth},0 ${nodeWidth - skew},${nodeHeight} ${-skew},${nodeHeight}`)
        .attr('fill', d => flowFill(d.data.type, d.depth))
        .attr('stroke', d => d.depth === 0 ? '#2f7d22' : '#48a935')
        .attr('stroke-width', d => d.depth === 0 ? 3 : 2)
        .attr('filter', 'drop-shadow(4px 5px 3px rgba(15, 23, 42, .22))');

    node.append('polygon')
        .attr('points', `${nodeWidth - 28},5 ${nodeWidth - 4},5 ${nodeWidth - skew - 4},${nodeHeight - 5} ${nodeWidth - skew - 28},${nodeHeight - 5}`)
        .attr('fill', '#7ed957')
        .attr('opacity', 0.42);

    node.append('text')
        .attr('x', nodeWidth / 2 - skew / 2)
        .attr('y', nodeHeight / 2 - 7)
        .attr('text-anchor', 'middle')
        .selectAll('tspan')
        .data(d => wrapLabel(labelFor(d.data, d.depth, root.leaves().length), d.depth === 0 ? 22 : 18))
        .join('tspan')
        .attr('x', nodeWidth / 2 - skew / 2)
        .attr('dy', (_, i) => i === 0 ? 0 : 13)
        .text(d => d);

    node.append('title')
        .text(d => `${d.data.id} — ${d.data.name || ''}`);

    svg.append('g')
        .attr('class', 'iris-center-label flow-title')
        .append('text')
        .attr('x', 24)
        .attr('y', 30)
        .text(`${tree.id} · ${tree.name || 'Спецификация'}`);

    showStats(root);
}

function flowLinkPath(d, nodeX, nodeY, nodeWidth, nodeHeight) {
    const sx = nodeX(d.source);
    const sy = nodeY(d.source) + nodeHeight / 2;
    const tx = nodeX(d.target);
    const ty = nodeY(d.target) - nodeHeight / 2;
    const midY = sy + Math.max(26, (ty - sy) / 2);
    return `M${sx},${sy} V${midY} H${tx} V${ty}`;
}

function flowFill(type, depth) {
    if (depth === 0) return '#8bdc53';
    const color = d3.color(colorFor(type, '#74c947')) || d3.color('#74c947');
    return color.brighter(0.35).formatHex();
}

function wrapLabel(text, maxChars) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    words.forEach(word => {
        const next = line ? `${line} ${word}` : word;
        if (next.length > maxChars && line) {
            lines.push(line);
            line = word;
        } else {
            line = next;
        }
    });
    if (line) lines.push(line);
    return lines.slice(0, 3).map((part, index, arr) => index === 2 && arr.length === 3 && words.join(' ').length > arr.join(' ').length ? `${part.slice(0, maxChars - 1)}…` : part);
}

function labelFor(data, depth, leaves) {
    const name = data.name ? ` · ${data.name}` : '';
    const base = depth === 0 ? `${data.id}${name}` : `${data.id}${name}`;
    const limit = leaves > 90 ? 22 : LABEL_LIMIT;
    return base.length > limit ? `${base.slice(0, limit - 1)}…` : base;
}

function colorFor(type, fallback = '#64748b') {
    return currentColors[type] || fallback;
}

function showStats(root) {
    const byType = new Map();
    root.descendants().forEach(d => byType.set(d.data.type || 'Без типа', (byType.get(d.data.type || 'Без типа') || 0) + 1));
    const stats = [...byType.entries()].map(([type, count]) => `
        <span><i style="background:${colorFor(type)}"></i>${escapeHtml(type)}: ${count}</span>
    `).join('');
    document.getElementById('graphStats').innerHTML = `
        <b>${root.descendants().length}</b> узлов · <b>${root.links().length}</b> связей · глубина <b>${root.height}</b>
        <span class="type-stats">${stats}</span>
    `;
}

function showInfo(node, hierarchyNode) {
    const children = hierarchyNode.children || [];
    let html = `<h3>${escapeHtml(node.name || node.id)}</h3>`;
    html += `<div class="row"><b>Код</b><span>${escapeHtml(node.id)}</span></div>`;
    html += `<div class="row"><b>Тип</b><span>${escapeHtml(node.type || '—')}</span></div>`;
    if (node.qty) html += `<div class="row"><b>Количество</b><span>${node.qty} ${escapeHtml(node.unit || '')}</span></div>`;
    if (node.ek_kgme) html += `<div class="row"><b>Кг/ед.</b><span>${node.ek_kgme}</span></div>`;
    html += `<div class="row"><b>Уровень</b><span>${hierarchyNode.depth}</span></div>`;
    html += `<div class="row"><b>Компонентов</b><span>${children.length}</span></div>`;
    if (children.length) {
        html += `<div class="children-list"><b>Ближайшие компоненты</b>${children.slice(0, 12).map(c =>
            `<button type="button" onclick="focusNode('${cssEscape(c.data.id)}')">${escapeHtml(c.data.id)} · ${escapeHtml(c.data.name || '')}</button>`
        ).join('')}</div>`;
    }
    if (node.expandable || children.length) {
        html += `<button onclick="loadGraph('${escapeJs(node.id)}')" style="margin-top:10px;width:100%">🔍 Открыть как корневую спецификацию</button>`;
    }
    infoPanel.innerHTML = html;
    infoPanel.style.display = 'block';
}

function focusNode(id) {
    const all = graphEl.querySelectorAll('.iris-node');
    all.forEach(el => el.classList.remove('selected'));
    const found = [...all].find(el => el.__data__ && el.__data__.data.id === id);
    if (found) {
        found.classList.add('selected');
        showInfo(found.__data__.data, found.__data__);
    }
}

function applyInitialZoom(svg, zoom, width, height) {
    const graphWidth = graphEl.clientWidth || width;
    const graphHeight = graphEl.clientHeight || height;
    const scale = Math.max(ZOOM_MIN, Math.min(1, (Math.min(graphWidth / width, graphHeight / height) * 0.96)));
    const translateX = (graphWidth - width * scale) / 2;
    const translateY = Math.max(8, (graphHeight - height * scale) / 2);
    svg.call(zoom.transform, d3.zoomIdentity.translate(translateX, translateY).scale(scale));
}

function zoomBy(factor) {
    if (!graphSvg || !graphZoom) return;
    graphSvg.transition().duration(180).call(graphZoom.scaleBy, factor);
}

function resetZoom() {
    if (!currentTree) return;
    renderIrisDiagram(currentTree);
}

// ---------- Кнопки ----------
document.getElementById('btnFit').onclick = resetZoom;
document.getElementById('btnZoomOut').onclick = () => zoomBy(1 / ZOOM_STEP);
document.getElementById('btnZoomIn').onclick = () => zoomBy(ZOOM_STEP);
document.getElementById('btnExport').onclick = () => {
    const svg = graphEl.querySelector('svg');
    if (!svg) return;
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' });
    const link = document.createElement('a');
    link.download = `bom_iris_${searchInput.value.trim()}.svg`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
};

function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function escapeJs(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function cssEscape(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ---------- Автозагрузка при наличии параметра в URL ----------
const urlBom = new URLSearchParams(location.search).get('bom');
if (urlBom) { searchInput.value = urlBom; loadGraph(urlBom); }
