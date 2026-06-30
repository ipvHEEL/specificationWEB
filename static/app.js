let currentTree = null;
let selectedNodeId = null;
let currentBom = '';

const graphEl = document.getElementById('graph');
const searchInput = document.getElementById('searchInput');
const suggestions = document.getElementById('suggestions');
const infoPanel = document.getElementById('info');
const loader = document.getElementById('loader');
const btnFit = document.getElementById('btnFit');
const btnExport = document.getElementById('btnExport');

const SVG_NS = 'http://www.w3.org/2000/svg';
const TWO_PI = Math.PI * 2;
const MIN_LABEL_ANGLE = 0.045;
const MIN_LABEL_WIDTH = 46;

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
        <div class="sugg-item" data-id="${escapeHtml(it.bom_item)}">
            <span class="code">${escapeHtml(it.bom_item)}</span>
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

// ---------- Загрузка и отрисовка ирис-диаграммы ----------
async function loadGraph(bomItem) {
    loader.style.display = 'flex';
    currentBom = bomItem;
    try {
        const res = await fetch(`/api/bom-tree/${encodeURIComponent(bomItem)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        currentTree = await res.json();
        selectedNodeId = null;
        renderIris(currentTree);
    } catch (e) {
        alert('Ошибка загрузки: ' + e.message);
    } finally {
        loader.style.display = 'none';
    }
}

function renderIris(data) {
    if (!data || !data.root) return;

    const root = prepareHierarchy(data.root, null, 0, '0');
    const maxDepth = Math.max(1, getMaxDepth(root));
    const bounds = graphEl.getBoundingClientRect();
    const width = Math.max(bounds.width, 900);
    const height = Math.max(bounds.height, 620);
    const cx = width / 2;
    const cy = height / 2;
    const outerRadius = Math.min(width, height) * 0.46;
    const centerRadius = Math.max(82, outerRadius * 0.16);
    const ringWidth = (outerRadius - centerRadius) / maxDepth;

    assignAngles(root, -Math.PI / 2, TWO_PI - Math.PI / 2);

    graphEl.innerHTML = '';
    infoPanel.style.display = 'none';

    const svg = createSvg('svg', {
        viewBox: `0 0 ${width} ${height}`,
        role: 'img',
        'aria-label': `Ирис-диаграмма спецификации ${root.id}`,
    });
    svg.classList.add('iris-svg');

    const defs = createSvg('defs');
    defs.appendChild(createFilter());
    svg.appendChild(defs);

    const bg = createSvg('circle', { cx, cy, r: outerRadius + 14, class: 'iris-background' });
    svg.appendChild(bg);

    const segments = flattenHierarchy(root).sort((a, b) => a.depth - b.depth);
    segments.forEach(node => {
        if (node.depth === 0) return;
        const inner = centerRadius + (node.depth - 1) * ringWidth + 3;
        const outer = centerRadius + node.depth * ringWidth - 3;
        const path = createSvg('path', {
            d: describeArc(cx, cy, inner, outer, node.startAngle, node.endAngle),
            fill: colorFor(node.type, data.colors),
            class: 'iris-segment',
            'data-node-key': node.key,
        });
        path.style.opacity = `${Math.max(0.58, 1 - node.depth * 0.06)}`;
        path.appendChild(createSvg('title', {}, buildTooltip(node)));
        path.addEventListener('click', event => {
            event.stopPropagation();
            selectedNodeId = node.key;
            updateSelection(svg, node.key);
            showInfo(node, data);
        });
        path.addEventListener('dblclick', event => {
            event.stopPropagation();
            if (node.expandable || node.children.length) loadGraph(node.id);
        });
        svg.appendChild(path);

        maybeRenderLabel(svg, node, cx, cy, inner, outer);
    });

    const center = createSvg('g', { class: 'iris-center', tabindex: 0 });
    center.appendChild(createSvg('circle', { cx, cy, r: centerRadius - 8, fill: colorFor(root.type, data.colors) }));
    center.appendChild(createSvg('text', { x: cx, y: cy - 8, 'text-anchor': 'middle', class: 'center-code' }, root.id));
    center.appendChild(createSvg('text', { x: cx, y: cy + 14, 'text-anchor': 'middle', class: 'center-name' }, truncate(root.name, 24)));
    center.addEventListener('click', event => {
        event.stopPropagation();
        selectedNodeId = root.key;
        updateSelection(svg, root.key);
        showInfo(root, data);
    });
    svg.appendChild(center);

    svg.addEventListener('click', () => {
        selectedNodeId = null;
        updateSelection(svg, null);
        infoPanel.style.display = 'none';
    });

    graphEl.appendChild(svg);
    renderStats(root);
}

function prepareHierarchy(node, parent, depth, key) {
    const children = (node.children || []).map((child, index) => prepareHierarchy(child, node, depth + 1, `${key}.${index}`));
    const qty = Number(node.qty || 0);
    const weight = children.length ? children.reduce((sum, child) => sum + child.weight, 0) : Math.max(qty, 1);
    return { ...node, parent, depth, key, children, qty, weight };
}

function assignAngles(node, startAngle, endAngle) {
    node.startAngle = startAngle;
    node.endAngle = endAngle;
    if (!node.children.length) return;
    const total = node.children.reduce((sum, child) => sum + child.weight, 0) || node.children.length;
    let cursor = startAngle;
    node.children.forEach(child => {
        const span = (endAngle - startAngle) * (child.weight / total);
        assignAngles(child, cursor, cursor + span);
        cursor += span;
    });
}

function maybeRenderLabel(svg, node, cx, cy, inner, outer) {
    const angle = node.endAngle - node.startAngle;
    const arcWidth = ((inner + outer) / 2) * angle;
    if (angle < MIN_LABEL_ANGLE || arcWidth < MIN_LABEL_WIDTH) return;

    const midAngle = (node.startAngle + node.endAngle) / 2;
    const radius = (inner + outer) / 2;
    const [x, y] = polarToCartesian(cx, cy, radius, midAngle);
    const rotation = normalizeTextRotation(midAngle);
    const label = createSvg('text', {
        x,
        y,
        class: 'iris-label',
        'text-anchor': 'middle',
        transform: `rotate(${rotation} ${x} ${y})`,
        'data-node-key': node.key,
    }, truncate(node.id, Math.max(8, Math.floor(arcWidth / 9))));
    svg.appendChild(label);
}

function showInfo(node, data) {
    const parents = [];
    let parent = node.parent;
    while (parent) {
        parents.unshift(parent.id);
        parent = parent.parent;
    }
    const components = countDescendants(node);
    const html = `
        <h3>${escapeHtml(node.name || node.id)}</h3>
        <div class="row"><b>Код</b><span>${escapeHtml(node.id)}</span></div>
        <div class="row"><b>Тип</b><span>${escapeHtml(node.type || '—')}</span></div>
        ${node.qty ? `<div class="row"><b>Количество</b><span>${formatNumber(node.qty)} ${escapeHtml(node.unit || '')}</span></div>` : ''}
        ${node.ek_kgme ? `<div class="row"><b>Кг/ед.</b><span>${formatNumber(node.ek_kgme)}</span></div>` : ''}
        <div class="row"><b>Уровень</b><span>${node.depth}</span></div>
        <div class="row"><b>Веток ниже</b><span>${components}</span></div>
        ${parents.length ? `<div class="row"><b>Путь</b><span>${parents.map(escapeHtml).join(' → ')}</span></div>` : ''}
        ${(node.expandable || node.children.length) ? `<button onclick="loadGraph('${escapeAttr(node.id)}')">🔍 Открыть как корень</button>` : ''}
    `;
    infoPanel.innerHTML = html;
    infoPanel.style.display = 'block';
}

function renderStats(root) {
    const statsEl = document.getElementById('graphStats');
    const all = flattenHierarchy(root);
    const leaves = all.filter(node => !node.children.length).length;
    statsEl.textContent = `Узлов: ${all.length} · конечных компонентов: ${leaves} · глубина: ${getMaxDepth(root)}`;
}

function updateSelection(svg, key) {
    svg.querySelectorAll('.iris-segment').forEach(el => el.classList.toggle('is-selected', el.dataset.nodeKey === key));
    svg.querySelectorAll('.iris-label').forEach(el => el.classList.toggle('is-selected-label', el.dataset.nodeKey === key));
}

function flattenHierarchy(node) {
    return [node, ...node.children.flatMap(flattenHierarchy)];
}

function countDescendants(node) {
    return node.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0);
}

function getMaxDepth(node) {
    return Math.max(node.depth || 0, ...node.children.map(getMaxDepth));
}

function describeArc(cx, cy, innerRadius, outerRadius, startAngle, endAngle) {
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    const [x1, y1] = polarToCartesian(cx, cy, outerRadius, startAngle);
    const [x2, y2] = polarToCartesian(cx, cy, outerRadius, endAngle);
    const [x3, y3] = polarToCartesian(cx, cy, innerRadius, endAngle);
    const [x4, y4] = polarToCartesian(cx, cy, innerRadius, startAngle);
    return [`M ${x1} ${y1}`, `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${x2} ${y2}`, `L ${x3} ${y3}`, `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x4} ${y4}`, 'Z'].join(' ');
}

function polarToCartesian(cx, cy, radius, angle) {
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
}

function normalizeTextRotation(angle) {
    let degrees = angle * 180 / Math.PI;
    if (degrees > 90 && degrees < 270) degrees += 180;
    return degrees;
}

function colorFor(type, colors) {
    return (colors && colors[type]) || '#607D8B';
}

function createSvg(tag, attrs = {}, text = '') {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
    if (text) el.textContent = text;
    return el;
}

function createFilter() {
    const filter = createSvg('filter', { id: 'segmentShadow', x: '-20%', y: '-20%', width: '140%', height: '140%' });
    filter.innerHTML = '<feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#0f172a" flood-opacity="0.18"/>';
    return filter;
}

function buildTooltip(node) {
    return [
        `${node.id} — ${node.name || ''}`,
        `Тип: ${node.type || '—'}`,
        node.qty ? `Количество: ${formatNumber(node.qty)} ${node.unit || ''}` : '',
        `Уровень: ${node.depth}`,
    ].filter(Boolean).join('\n');
}

function truncate(value, max) {
    const text = String(value || '');
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatNumber(value) {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 4 }).format(value);
}

function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function escapeAttr(s) {
    return escapeHtml(s).replace(/`/g, '&#96;');
}

// ---------- Кнопки ----------
btnFit.onclick = () => currentTree && renderIris(currentTree);
btnExport.onclick = () => {
    const svg = graphEl.querySelector('svg');
    if (!svg) return;
    const serializer = new XMLSerializer();
    const blob = new Blob([serializer.serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' });
    const link = document.createElement('a');
    link.download = `bom_${currentBom || searchInput.value.trim()}.svg`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
};

window.addEventListener('resize', () => {
    if (currentTree) renderIris(currentTree);
});

// ---------- Автозагрузка при наличии параметра в URL ----------
const urlBom = new URLSearchParams(location.search).get('bom');
if (urlBom) { searchInput.value = urlBom; loadGraph(urlBom); }
