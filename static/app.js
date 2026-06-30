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

    const width = Math.max(graphEl.clientWidth, 900);
    const height = Math.max(graphEl.clientHeight, 650);
    const radius = Math.max(180, Math.min(width, height) / 2 - RADIAL_MARGIN);

    const root = d3.hierarchy(tree);
    const leaves = Math.max(1, root.leaves().length);
    const separation = (a, b) => (a.parent === b.parent ? 1 : 1.8) / Math.max(1, a.depth);
    d3.cluster().size([2 * Math.PI, radius]).separation(separation)(root);

    const svg = d3.select(graphEl)
        .append('svg')
        .attr('class', 'iris-svg')
        .attr('viewBox', [-width / 2, -height / 2, width, height])
        .attr('width', '100%')
        .attr('height', '100%');

    const viewport = svg.append('g').attr('class', 'iris-viewport');

    const zoom = d3.zoom()
        .scaleExtent([0.25, 4])
        .on('zoom', event => viewport.attr('transform', event.transform));
    svg.call(zoom);

    viewport.append('g')
        .attr('class', 'iris-rings')
        .selectAll('circle')
        .data(d3.range(1, root.height + 1))
        .join('circle')
        .attr('r', d => (radius / Math.max(1, root.height + 1)) * d)
        .attr('fill', 'none')
        .attr('stroke', '#e5e7eb')
        .attr('stroke-dasharray', '4 8');

    const link = d3.linkRadial()
        .angle(d => d.x)
        .radius(d => d.y);

    viewport.append('g')
        .attr('class', 'iris-links')
        .selectAll('path')
        .data(root.links())
        .join('path')
        .attr('d', link)
        .attr('stroke', d => colorFor(d.target.data.type, '#94a3b8'))
        .attr('stroke-width', d => Math.max(1.4, 3.2 - d.target.depth * 0.25))
        .attr('stroke-opacity', 0.55)
        .attr('fill', 'none');

    const node = viewport.append('g')
        .attr('class', 'iris-nodes')
        .selectAll('g')
        .data(root.descendants())
        .join('g')
        .attr('class', d => `iris-node depth-${d.depth}`)
        .attr('transform', d => `rotate(${d.x * 180 / Math.PI - 90}) translate(${d.y},0)`)
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

    node.append('circle')
        .attr('r', d => d.depth === 0 ? 18 : Math.max(6, 13 - d.depth))
        .attr('fill', d => colorFor(d.data.type))
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 2.5);

    node.append('text')
        .attr('dy', '0.32em')
        .attr('x', d => d.x < Math.PI === !d.children ? 14 : -14)
        .attr('text-anchor', d => d.x < Math.PI === !d.children ? 'start' : 'end')
        .attr('transform', d => d.x >= Math.PI ? 'rotate(180)' : null)
        .text(d => labelFor(d.data, d.depth, leaves))
        .append('title')
        .text(d => `${d.data.id} — ${d.data.name || ''}`);

    svg.append('g')
        .attr('class', 'iris-center-label')
        .append('text')
        .attr('text-anchor', 'middle')
        .attr('y', height / 2 - 34)
        .text(`${tree.id} · ${tree.name || 'Спецификация'}`);

    showStats(root);
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

// ---------- Кнопки ----------
document.getElementById('btnFit').onclick = () => currentTree && renderIrisDiagram(currentTree);
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
