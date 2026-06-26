let network = null;
let hierarchical = true;

const graphEl = document.getElementById('graph');
const searchInput = document.getElementById('searchInput');
const suggestions = document.getElementById('suggestions');
const infoPanel = document.getElementById('info');
const loader = document.getElementById('loader');

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

// ---------- Загрузка графа ----------
async function loadGraph(bomItem) {
    loader.style.display = 'flex';
    try {
        const res = await fetch(`/api/bom-graph/${encodeURIComponent(bomItem)}`);
        const data = await res.json();
        renderGraph(data);
    } catch (e) {
        alert('Ошибка загрузки: ' + e.message);
    } finally {
        loader.style.display = 'none';
    }
}

function renderGraph(data) {
    const nodes = new vis.DataSet(data.nodes);
    const edges = new vis.DataSet(data.edges);

    const options = {
        nodes: {
            borderWidth: 2,
            borderWidthSelected: 3,
            shadow: true,
            font: { size: 13, face: 'Segoe UI', color: '#111' },
            margin: 10,
        },
        edges: {
            color: { color: '#9ca3af', highlight: '#2563eb' },
            width: 1.5,
            smooth: { type: 'cubicBezier', forceDirection: 'vertical', roundness: 0.4 },
            font: { size: 11, align: 'middle', strokeWidth: 3, strokeColor: '#fff' },
        },
        physics: hierarchical ? {
            enabled: false,
        } : {
            barnesHut: { gravitationalConstant: -4000, springLength: 160 },
        },
        physics: hierarchical ? {
    enabled: false,
} : {
    enabled: true,
    barnesHut: {
        gravitationalConstant: -8000,    // ⬅️ сильнее отталкивание (было -4000)
        centralGravity: 0.1,
        springLength: 300,               // ⬅️ длиннее связи (было 160)
        springConstant: 0.02,
        damping: 0.3,
        avoidOverlap: 0.5,               // ⬅️ узлы не налезают друг на друга
    },
    stabilization: {
        enabled: true,
        iterations: 500,
        updateInterval: 25,
    },
},
layout: hierarchical ? {
    hierarchical: {
        direction: 'UD',
        sortMethod: 'directed',
        levelSeparation: 280,
        nodeSpacing: 500,
        treeSpacing: 500,
        edgeMinimization: true,
        blockShifting: true,
        parentCentralization: true,
        improvedLayout: true,
    },
} : {
    randomSeed: 42,
},
        interaction: {
            hover: true,
            tooltipDelay: 150,
            navigationButtons: false,
            keyboard: true,
        },
    };

    network = new vis.Network(graphEl, { nodes, edges }, options);

    // Клик по узлу — показать детали
    network.on('click', params => {
        if (params.nodes.length) {
            const nodeId = params.nodes[0];
            const node = nodes.get(nodeId);
            showInfo(node, data);
        } else {
            infoPanel.style.display = 'none';
        }
    });

    // Двойной клик — раскрыть/перейти к дочерней спецификации
    network.on('doubleClick', params => {
        if (params.nodes.length) {
            const node = nodes.get(params.nodes[0]);
            if (node.expandable) {
                loadGraph(node.id);
            }
        }
    });

    network.once('afterDrawing', () => network.fit({ animation: { duration: 400 } }));
}

function showInfo(node, data) {
    const title = node.title.replace(/<br>/g, '\n').replace(/<[^>]+>/g, '');
    const lines = title.split('\n').filter(Boolean);
    let html = `<h3>${escapeHtml(lines[0] || node.label)}</h3>`;
    lines.slice(1).forEach(l => {
        const [k, ...v] = l.split(':');
        if (v.length) html += `<div class="row"><b>${k.trim()}</b><span>${v.join(':').trim()}</span></div>`;
    });
    // Связи
    const parents = data.edges.filter(e => e.to === node.id).map(e => e.from);
    const children = data.edges.filter(e => e.from === node.id).map(e => e.to);
    if (parents.length) html += `<div class="row"><b>Родитель</b><span>${parents.join(', ')}</span></div>`;
    html += `<div class="row"><b>Компонентов</b><span>${children.length}</span></div>`;
    if (node.expandable) {
        html += `<button onclick="loadGraph('${node.id}')" style="margin-top:10px;width:100%">🔍 Раскрыть спецификацию</button>`;
    }
    infoPanel.innerHTML = html;
    infoPanel.style.display = 'block';
}

// ---------- Кнопки ----------
document.getElementById('btnFit').onclick = () => network && network.fit({ animation: true });
document.getElementById('btnHierarchical').onclick = () => {
    hierarchical = !hierarchical;
    if (searchInput.value.trim()) loadGraph(searchInput.value.trim());
};
document.getElementById('btnExport').onclick = () => {
    if (!network) return;
    const canvas = graphEl.getElementsByTagName('canvas')[0];
    const link = document.createElement('a');
    link.download = `bom_${searchInput.value.trim()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
};

function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ---------- Автозагрузка при наличии параметра в URL ----------
const urlBom = new URLSearchParams(location.search).get('bom');
if (urlBom) { searchInput.value = urlBom; loadGraph(urlBom); }