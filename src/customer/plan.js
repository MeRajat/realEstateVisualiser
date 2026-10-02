// 2D vector site plan (SVG + d3-zoom). Loaded eagerly — it's the default view.
import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom';
import 'd3-transition';
import { features, plots, boundary, ZONES } from '../shared/site.js';
import { state, on, selectPlot, matchesFilter } from './store.js';
import { getInsets } from './layout.js';

const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

export function createPlanView(el) {
    const svg = select(el).append('svg').attr('class', 'plan-svg').attr('role', 'img')
        .attr('aria-label', 'Interactive site plan. Tap a plot to see details.');
    const root = svg.append('g');
    const tooltip = select(el).append('div').attr('class', 'plan-tooltip').attr('hidden', true);

    // ─── LAYERS ──────────────────────────────────────
    const zoneLayer = root.append('g').attr('class', 'zones');
    ZONES.forEach(z => {
        zoneLayer.append('rect')
            .attr('x', z.x1).attr('y', z.y1).attr('width', z.x2 - z.x1).attr('height', z.y2 - z.y1)
            .attr('fill', z.color).attr('class', 'zone-tint').attr('data-zone', z.id);
        zoneLayer.append('text')
            .attr('x', (z.x1 + z.x2) / 2).attr('y', (z.y1 + z.y2) / 2)
            .attr('class', 'zone-mark').attr('data-zone', z.id).attr('fill', z.color)
            .text(z.name.toUpperCase());
    });

    const shapes = root.append('g')
        .selectAll('polygon')
        .data(features)
        .join('polygon')
        .attr('class', d => `f f-${d.kind}`)
        .attr('data-status', d => d.status)
        .attr('points', d => d.points.join(' '));

    const plotShapes = shapes.filter(d => d.kind === 'plot');

    const labels = root.append('g').attr('class', 'labels')
        .selectAll('text')
        .data(features.filter(d => d.kind !== 'boundary'))
        .join('text')
        .attr('class', d => `lbl lbl-${d.kind}`)
        .attr('data-status', d => d.status)
        .attr('x', d => d.center[0])
        .attr('y', d => d.center[1])
        .attr('font-size', d => d.kind === 'plot' ? Math.max(7, Math.min(12, Math.min(d.box.w, d.box.h) * 0.42)) : null)
        .attr('transform', d => (d.kind === 'road' && d.box.h > d.box.w) ? `rotate(-90 ${d.center[0]} ${d.center[1]})` : null)
        .text(d => d.kind === 'common' ? d.id.replace(/ (ZONE|BLOCK)$/, '') : d.id);

    // ─── ZOOM ────────────────────────────────────────
    // Frame the plotted area (plots, roads, small commons) rather than the whole boundary —
    // the empty future-phase block would otherwise shrink every plot on a phone.
    const framed = features.filter(f => f.kind === 'plot' || f.kind === 'road' || (f.kind === 'common' && f.box.w * f.box.h < 0.2 * boundary.box.w * boundary.box.h));
    const fitBox = framed.reduce((b, f) => ({
        minX: Math.min(b.minX, f.box.minX), minY: Math.min(b.minY, f.box.minY),
        maxX: Math.max(b.maxX, f.box.maxX), maxY: Math.max(b.maxY, f.box.maxY),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    fitBox.w = fitBox.maxX - fitBox.minX + 24;
    fitBox.h = fitBox.maxY - fitBox.minY + 24;
    fitBox.minX -= 12;
    fitBox.minY -= 12;
    const zoom = d3zoom().on('zoom', (e) => root.attr('transform', e.transform));
    svg.call(zoom).on('dblclick.zoom', null);

    function fitTransform() {
        const { top, bottom, left, right } = getInsets();
        const w = el.clientWidth - left - right;
        const h = el.clientHeight - top - bottom;
        const b = fitBox;
        const k = Math.min(w / b.w, h / b.h);
        return zoomIdentity
            .translate(left + (w - b.w * k) / 2 - b.minX * k, top + (h - b.h * k) / 2 - b.minY * k)
            .scale(k);
    }

    function updateExtent() {
        const k = fitTransform().k;
        zoom.scaleExtent([k * 0.7, k * 14])
            .translateExtent([[-200, -200], [900, 1150]]);
    }

    function focus(plot) {
        const { top, bottom, left, right } = getInsets({ withSheet: true });
        const w = el.clientWidth - left - right;
        const h = el.clientHeight - top - bottom;
        const fitK = fitTransform().k;
        // Show the plot with its neighbours / road for context
        const k = Math.max(fitK * 1.6, Math.min(fitK * 2.6, Math.min(w / (plot.box.w * 6), h / (plot.box.h * 8))));
        const t = zoomIdentity
            .translate(left + w / 2 - plot.center[0] * k, top + h / 2 - plot.center[1] * k)
            .scale(k);
        svg.transition().duration(650).call(zoom.transform, t);
    }

    // ─── INTERACTION ─────────────────────────────────
    plotShapes.on('click', function (event, d) {
        event.stopPropagation();
        // Too small to read comfortably on this screen? Bring it closer as it opens.
        const r = this.getBoundingClientRect();
        selectPlot(d.id, 'plan');
        if (Math.min(r.width, r.height) < 34) requestAnimationFrame(() => focus(d));
    });
    svg.on('click', () => { if (state.selectedId) selectPlot(null, 'plan'); });

    if (finePointer) {
        plotShapes
            .on('pointerenter', (_, d) => {
                tooltip.attr('hidden', null)
                    .html(`<b>Plot ${d.id}</b> · ${d.area} · <span class="st-${d.status}">${d.status}</span>`);
            })
            .on('pointermove', (event) => {
                const r = el.getBoundingClientRect();
                tooltip.style('transform', `translate(${event.clientX - r.left + 14}px, ${event.clientY - r.top + 14}px)`);
            })
            .on('pointerleave', () => tooltip.attr('hidden', true));
    }

    // ─── STATE SYNC ──────────────────────────────────
    on('select', ({ plot, source }) => {
        plotShapes.classed('is-selected', d => plot && d.id === plot.id);
        labels.classed('is-selected', d => plot && d.kind === 'plot' && d.id === plot.id);
        if (plot) {
            plotShapes.filter(d => d.id === plot.id).raise();
            // next frame: the detail sheet is shown by another 'select' listener
            if (source !== 'plan' && state.view === 'plan') requestAnimationFrame(() => focus(plot));
        }
    });

    function applyFilter() {
        plotShapes.classed('is-dim', d => !matchesFilter(d));
        labels.classed('is-dim', d => d.kind === 'plot' && !matchesFilter(d));
        const zone = state.filter.zone;
        zoneLayer.selectAll('[data-zone]').classed('is-active', function () {
            return zone !== 'all' && this.getAttribute('data-zone') === zone;
        });
    }
    on('filter', applyFilter);

    const reset = () => svg.transition().duration(500).call(zoom.transform, fitTransform());

    let lastSize = '';
    function resize() {
        const size = `${el.clientWidth}x${el.clientHeight}`;
        if (!el.clientWidth || size === lastSize) return;
        lastSize = size;
        updateExtent();
        svg.call(zoom.transform, fitTransform());
    }
    new ResizeObserver(resize).observe(el);
    resize();
    applyFilter();

    return {
        zoomIn: () => svg.transition().duration(250).call(zoom.scaleBy, 1.5),
        zoomOut: () => svg.transition().duration(250).call(zoom.scaleBy, 1 / 1.5),
        reset,
        show() {
            resize();
            const plot = plots.find(p => p.id === state.selectedId);
            if (plot) focus(plot);
        },
    };
}
