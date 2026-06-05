document.addEventListener('DOMContentLoaded', () => {

    // ─── SEGMENTED VIEW MODES CONTROLLER ─────────────────
    const splitContainer = document.getElementById('split-container');
    const viewButtons = document.querySelectorAll('.view-btn');

    viewButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            // Update active button state
            viewButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Apply mode class to split container
            const mode = btn.getAttribute('data-mode');
            splitContainer.className = 'mode-' + mode;

            // Invalidate map size so Leaflet updates its container bounds smoothly
            if (map) {
                setTimeout(() => {
                    map.invalidateSize({ animate: true });
                    // Auto-fit to site boundary if toggling back to map/split and a plot isn't selected
                    if (!selectedPlotId) {
                        fitMapToSiteBoundary();
                    } else {
                        focusPlotOnMap(selectedPlotId, false);
                    }
                }, 250);
            }
        });
    });

    // ─── GEOGRAPHIC ANCHOR & CALIBRATION ────────────────
    // Anchor center of site boundary at target coordinates: 26°38'09.5"N 75°37'58.5"E
    const TARGET_LAT = 26.635972;
    const TARGET_LNG = 75.632917;

    // Centroid of site plan data boundary
    const centerX = 332.5;
    const centerY = 467.5;

    // 1 data unit = 0.6 meters.
    // Geodetic degree length calculations at latitude 26.636° N:
    // 1° Latitude = 110,850 meters
    // 1° Longitude = 111,320 * cos(26.635972°) = 99,505 meters
    const METERS_PER_UNIT = 0.6;
    const SCALE_LAT = METERS_PER_UNIT / 110850;
    const SCALE_LNG = METERS_PER_UNIT / 99505;

    // ─── ZONE DEFINITIONS (2×2 quadrant grid) ─────────────
    // Left/Right split: second vertical road X≈415-427
    // Top/Bottom split: 9 MT horizontal road Y≈610-622
    const ZONES = [
        { id: 'A', name: 'Zone A', color: '#f2cc8f', rgb: '242,204,143', x1: 50,  y1: 292, x2: 415, y2: 610 },
        { id: 'B', name: 'Zone B', color: '#81b29a', rgb: '129,178,154', x1: 427, y1: 292, x2: 630, y2: 610 },
        { id: 'C', name: 'Zone C', color: '#3d85c6', rgb: '61,133,200',  x1: 50,  y1: 622, x2: 415, y2: 910 },
        { id: 'D', name: 'Zone D', color: '#e07a5f', rgb: '224,122,95',  x1: 427, y1: 622, x2: 630, y2: 910 },
    ];
    let activeZone = null;

    // Convert data coordinate [x, y] to geolocated [lat, lng]
    function toLatLng(point) {
        // Y increases downward in SVG, but Latitude increases upward (North)
        const lat = TARGET_LAT + (centerY - point[1]) * SCALE_LAT;
        const lng = TARGET_LNG + (point[0] - centerX) * SCALE_LNG;
        return [lat, lng];
    }

    // Convert array of data points to array of L.LatLng
    function toLatLngs(points) {
        return points.map(p => toLatLng(p));
    }

    // Calculate centroid of an individual plot's coordinate array
    function getPolygonCentroid(points) {
        let latSum = 0;
        let lngSum = 0;
        const latlngs = toLatLngs(points);
        latlngs.forEach(ll => {
            latSum += ll[0];
            lngSum += ll[1];
        });
        return [latSum / points.length, lngSum / points.length];
    }

    // ─── INITIALIZE MAP (LEAFLET) ───────────────────────
    const map = L.map('real-map', {
        zoomControl: false,
        attributionControl: false
    }).setView([TARGET_LAT, TARGET_LNG], 18);

    // Zoom control in bottom right
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Esri High-Resolution World Imagery
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 20
    }).addTo(map);

    // CartoDB labels overlaid on top for context
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
        maxZoom: 20,
        pane: 'overlayPane'
    }).addTo(map);

    // ─── INITIALIZE D3 CANVAS ────────────────────────────
    const d3Container = document.getElementById('visualization');
    const width = d3Container.clientWidth;
    const height = d3Container.clientHeight;

    const svg = d3.select('#visualization')
        .append('svg')
        .attr('width', '100%')
        .attr('height', '100%')
        .attr('viewBox', `0 0 700 950`)
        .attr('preserveAspectRatio', 'xMidYMid meet');

    const g = svg.append('g');

    // Tooltip layer for D3
    const d3Tooltip = d3.select('#visualization')
        .append('div')
        .attr('class', 'd3-tooltip');

    // Configure D3 zoom behavior
    const zoom = d3.zoom()
        .scaleExtent([0.3, 8])
        .on('zoom', (event) => {
            g.attr('transform', event.transform);
        });

    svg.call(zoom);

    // D3 Floating Zoom buttons
    document.getElementById('zoom-in').addEventListener('click', () => {
        svg.transition().duration(300).call(zoom.scaleBy, 1.4);
    });
    document.getElementById('zoom-out').addEventListener('click', () => {
        svg.transition().duration(300).call(zoom.scaleBy, 0.7);
    });
    document.getElementById('zoom-reset').addEventListener('click', () => {
        resetD3View();
    });

    let initialD3Transform = null;
    function resetD3View() {
        if (initialD3Transform) {
            svg.transition().duration(500).call(zoom.transform, initialD3Transform);
        }
    }

    // ─── COLOR CONVERTERS (Lumina Terra Palette) ────────
    const getPlotColor = (d) => {
        if (d.id === 'SITE BOUNDARY') return 'none';
        if (d.isRoad) return '#2c3a4a'; // visible warm charcoal
        if (d.isPark) return 'rgba(129, 178, 154, 0.35)'; // translucent green
        if (d.status === 'Sold') return 'rgba(224, 122, 95, 0.65)'; // terracotta
        if (d.status === 'Available') return 'rgba(242, 204, 143, 0.25)'; // translucent gold
        return 'rgba(148, 163, 184, 0.2)';
    };

    const getPlotOpacity = (d) => {
        if (d.id === 'SITE BOUNDARY') return 0;
        if (d.isRoad) return 1.0; // fully opaque so roads are clearly visible
        if (d.isPark) return 0.45;
        return 0.65;
    };

    const getMapColor = (d) => {
        if (d.id === 'SITE BOUNDARY') return 'transparent';
        if (d.isRoad) return '#3a4a5a'; // slightly lighter on satellite
        if (d.isPark) return '#81b29a';
        if (d.status === 'Sold') return '#e07a5f';
        if (d.status === 'Available') return '#f2cc8f';
        return '#64748b';
    };

    // ─── FACING DIRECTION + PLOT ZONE HELPERS ─────────────
    const getDirArrow = (dir) => ({ North: '↑', South: '↓', East: '→', West: '←' }[dir] || '•');

    function getPlotFacing(d) {
        const roads = plotsData.filter(r => r.isRoad);
        const xs = d.points.map(p => p[0]);
        const ys = d.points.map(p => p[1]);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        const TOL = 5;
        const seen = new Set();
        const facings = [];
        roads.forEach(road => {
            const rxs = road.points.map(p => p[0]);
            const rys = road.points.map(p => p[1]);
            const rMinX = Math.min(...rxs), rMaxX = Math.max(...rxs);
            const rMinY = Math.min(...rys), rMaxY = Math.max(...rys);
            const isH = (rMaxX - rMinX) > (rMaxY - rMinY);
            const add = (dir) => { if (!seen.has(dir)) { seen.add(dir); facings.push({ dir, road: road.id }); } };
            if (isH) {
                if (Math.abs(rMaxY - minY) <= TOL && rMinX < maxX && rMaxX > minX) add('North');
                if (Math.abs(rMinY - maxY) <= TOL && rMinX < maxX && rMaxX > minX) add('South');
            } else {
                if (Math.abs(rMaxX - minX) <= TOL && rMinY < maxY && rMaxY > minY) add('West');
                if (Math.abs(rMinX - maxX) <= TOL && rMinY < maxY && rMaxY > minY) add('East');
            }
        });
        return facings;
    }

    function getPlotZone(d) {
        const xs = d.points.map(p => p[0]);
        const ys = d.points.map(p => p[1]);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        return ZONES.find(z => cx >= z.x1 && cx <= z.x2 && cy >= z.y1 && cy <= z.y2) || null;
    }

    function renderPlotDiagram(d) {
        // 1 data unit = 1 ft (verified: width_units × height_units == JSON area in sq.ft)
        const FT = 1.0;
        const xs = d.points.map(p => p[0]);
        const ys = d.points.map(p => p[1]);
        const wU = Math.max(...xs) - Math.min(...xs);
        const hU = Math.max(...ys) - Math.min(...ys);
        const wFt = Math.round(wU * FT * 10) / 10;
        const hFt = Math.round(hU * FT * 10) / 10;
        const facing = getPlotFacing(d);
        const dirs = new Set(facing.map(f => f.dir));
        const sc = Math.min(190 / wU, 100 / hU);
        const rW = Math.max(70, Math.min(190, wU * sc));
        const rH = Math.max(38, Math.min(100, hU * sc));
        const pL = 38, pT = 26, pR = 18, pB = 18;
        const W = rW + pL + pR, H = rH + pT + pB;
        const col = d.status === 'Sold' ? '#e07a5f' : '#f2cc8f';

        const hEdge = (dir) => {
            if (!dirs.has(dir)) return '';
            const y = dir === 'North' ? pT : pT + rH;
            const ly = dir === 'North' ? pT - 5 : pT + rH + 12;
            return `<line x1="${pL+2}" y1="${y}" x2="${pL+rW-2}" y2="${y}" stroke="${col}" stroke-width="3" stroke-linecap="round"/>
                    <text x="${pL+rW/2}" y="${ly}" fill="${col}" font-size="8" text-anchor="middle" font-family="Outfit" font-weight="700">${dir.toUpperCase()}</text>`;
        };
        const vEdge = (dir) => {
            if (!dirs.has(dir)) return '';
            const x = dir === 'West' ? pL : pL + rW;
            const lx = dir === 'West' ? pL - 5 : pL + rW + 5;
            const anchor = dir === 'West' ? 'end' : 'start';
            return `<line x1="${x}" y1="${pT+2}" x2="${x}" y2="${pT+rH-2}" stroke="${col}" stroke-width="3" stroke-linecap="round"/>
                    <text x="${lx}" y="${pT+rH/2}" fill="${col}" font-size="8" text-anchor="${anchor}" dominant-baseline="middle" font-family="Outfit" font-weight="700">${dir.toUpperCase()}</text>`;
        };

        return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
            <defs><marker id="arr" markerWidth="5" markerHeight="5" refX="2.5" refY="2.5" orient="auto">
                <path d="M0,0 L0,5 L5,2.5 z" fill="#475569"/></marker></defs>
            <rect x="${pL}" y="${pT}" width="${rW}" height="${rH}"
                  fill="rgba(242,204,143,0.06)" stroke="rgba(255,255,255,0.15)" stroke-width="1" rx="2"/>
            <line x1="${pL}" y1="${pT-9}" x2="${pL+rW}" y2="${pT-9}"
                  stroke="#475569" stroke-width="1" marker-start="url(#arr)" marker-end="url(#arr)"/>
            <text x="${pL+rW/2}" y="${pT-13}" fill="#94a3b8" font-size="9" text-anchor="middle" font-family="Outfit">${wFt} ft</text>
            <line x1="${pL-9}" y1="${pT}" x2="${pL-9}" y2="${pT+rH}"
                  stroke="#475569" stroke-width="1" marker-start="url(#arr)" marker-end="url(#arr)"/>
            <text x="${pL-13}" y="${pT+rH/2}" fill="#94a3b8" font-size="9" text-anchor="middle" dominant-baseline="middle"
                  font-family="Outfit" transform="rotate(-90,${pL-13},${pT+rH/2})">${hFt} ft</text>
            ${hEdge('North')}${hEdge('South')}${vEdge('West')}${vEdge('East')}
            <text x="${pL+rW-2}" y="${pT+11}" fill="rgba(255,255,255,0.2)" font-size="9"
                  text-anchor="end" font-family="Outfit" font-weight="700">N↑</text>
        </svg>`;
    }

    // ─── BI-DIRECTIONAL SELECTION REGISTRY ────────────────
    let plotsData = [];
    const leafletPolygons = {}; // Map keyed by plotId
    let selectedPlotId = null;

    const detailCard = document.getElementById('detail-card');
    const closeCardBtn = document.getElementById('close-card');

    closeCardBtn.addEventListener('click', () => {
        clearSelection();
    });

    // ─── CORE COORDINATION METHODS ───────────────────────

    // Unify unified selection handling
    function selectPlot(plotId, source) {
        selectedPlotId = plotId;
        const d = plotsData.find(item => item.id === plotId);
        if (!d || d.isRoad) return;

        // 1. Update D3 selection state
        // First clear ALL inline styles (stroke/filter) set by hover, then toggle class
        d3.selectAll('.plot')
            .classed('selected', false)
            .style('stroke', null)        // remove inline stroke override
            .style('stroke-width', null)  // remove inline stroke-width override
            .style('filter', null);       // remove inline filter override
        const d3Target = d3.selectAll('.plot').filter(p => p.id === plotId);
        d3Target.classed('selected', true);

        if (source !== 'd3') {
            // Zoom D3 panel to this polygon's bounding box
            const d3Node = d3Target.node();
            if (d3Node) {
                const bbox = d3Node.getBBox();
                const containerWidth = 700;
                const containerHeight = 950;
                const scale = Math.max(1.5, Math.min(5, 0.6 / Math.max(bbox.width / containerWidth, bbox.height / containerHeight)));
                const tx = containerWidth / 2 - scale * (bbox.x + bbox.width / 2);
                const ty = containerHeight / 2 - scale * (bbox.y + bbox.height / 2);
                svg.transition().duration(600).call(
                    zoom.transform,
                    d3.zoomIdentity.translate(tx, ty).scale(scale)
                );
            }
        }

        // 2. Update Leaflet selection state
        resetLeafletStyles();
        const mapTarget = leafletPolygons[plotId];
        if (mapTarget) {
            mapTarget.setStyle({
                weight: 3.5,
                color: '#f2cc8f',
                fillOpacity: getPlotOpacity(d) * 1.2
            });

            if (source !== 'leaflet' && document.getElementById('map-panel').offsetWidth > 0) {
                map.fitBounds(mapTarget.getBounds(), {
                    padding: [80, 80],
                    maxZoom: 19,
                    animate: true,
                    duration: 0.8
                });
            }
        }

        // 3. Update floating Detail Card UI
        let badgeClass = 'badge-available';
        if (d.status === 'Sold') badgeClass = 'badge-sold';
        if (d.isPark || d.status === 'Reserved') badgeClass = 'badge-reserved';

        document.getElementById('card-status-badge').textContent = d.status;
        document.getElementById('card-status-badge').className = 'card-badge ' + badgeClass;
        document.getElementById('card-plot-id').textContent = d.isPark ? d.id : 'Plot ' + d.id;
        document.getElementById('card-status').textContent = d.status;

        // Render area value
        document.getElementById('card-area').textContent = d.area;
        document.getElementById('card-price').textContent = d.price;

        // Dimensions — 1 data unit = 1 ft (matches JSON area: w_units × h_units = area_sqft)
        const FT_PER_UNIT = 1.0;
        const dimRow = document.getElementById('row-dimensions');
        if (!d.isPark && !d.isRoad) {
            const xs = d.points.map(p => p[0]);
            const ys = d.points.map(p => p[1]);
            const wFt = Math.round((Math.max(...xs) - Math.min(...xs)) * FT_PER_UNIT * 10) / 10;
            const hFt = Math.round((Math.max(...ys) - Math.min(...ys)) * FT_PER_UNIT * 10) / 10;
            document.getElementById('card-dimensions').textContent = `${wFt} ft × ${hFt} ft`;
            dimRow.style.display = 'flex';
        } else { dimRow.style.display = 'none'; }

        // Area in Gaj (sq. yards): 1 sq.yd = 9 sq.ft
        const sqydRow = document.getElementById('row-sqyd');
        if (!d.isPark && d.area.includes('sq.ft')) {
            const gajVal = Math.round((parseFloat(d.area.replace(/[^\d.]/g, '')) / 9) * 10) / 10;
            document.getElementById('card-area-sqyd').textContent = gajVal + ' Gaj';
            sqydRow.style.display = 'flex';
        } else { sqydRow.style.display = 'none'; }

        // Plot diagram with facing direction
        const diagramEl = document.getElementById('plot-diagram');
        const facingEl  = document.getElementById('facing-badges');
        if (!d.isPark && !d.isRoad) {
            diagramEl.innerHTML = renderPlotDiagram(d);
            diagramEl.style.display = 'block';
            const facing = getPlotFacing(d);
            if (facing.length > 0) {
                facingEl.innerHTML = facing.map(f =>
                    `<span class="facing-badge">${getDirArrow(f.dir)} ${f.dir} Facing</span>`
                ).join('');
                facingEl.style.display = 'flex';
            } else { facingEl.style.display = 'none'; }
        } else {
            diagramEl.style.display = 'none';
            facingEl.style.display = 'none';
        }

        // Directions direct link to the plot's GPS coordinates
        const centroid = getPolygonCentroid(d.points);
        const directionsBtn = document.getElementById('directions-btn');
        directionsBtn.href = `https://www.google.com/maps/dir/?api=1&destination=${centroid[0]},${centroid[1]}`;
        
        detailCard.classList.remove('card-hidden');
    }

    // Clear active selection states
    function clearSelection() {
        selectedPlotId = null;
        // Clear both class and any inline style overrides from hover
        d3.selectAll('.plot')
            .classed('selected', false)
            .style('stroke', null)
            .style('stroke-width', null)
            .style('filter', null);
        resetLeafletStyles();
        detailCard.classList.add('card-hidden');
        resetD3View();
        fitMapToSiteBoundary();
    }

    // Synchronize hover state highlights
    function highlightPlotHover(plotId, isHovered) {
        if (plotId === selectedPlotId || plotId === 'SITE BOUNDARY') return;

        // D3 Vector highlight
        d3.selectAll('.plot')
            .filter(p => p.id === plotId)
            .style('stroke', isHovered ? '#f2cc8f' : 'rgba(255, 255, 255, 0.08)')
            .style('stroke-width', isHovered ? '2px' : '1px');

        // Leaflet Vector highlight
        const poly = leafletPolygons[plotId];
        if (poly) {
            const d = plotsData.find(item => item.id === plotId);
            const sliderVal = document.getElementById('opacity-slider').value / 100;
            poly.setStyle({
                color: isHovered ? '#f2cc8f' : 'rgba(255,255,255,0.25)',
                weight: isHovered ? 2.5 : 1,
                fillOpacity: isHovered ? getPlotOpacity(d) * 0.9 : getPlotOpacity(d) * sliderVal * 0.7
            });
        }
    }

    // Focuses map on a specific plot coordinates
    function focusPlotOnMap(plotId, animate = true) {
        const poly = leafletPolygons[plotId];
        if (poly && document.getElementById('map-panel').offsetWidth > 0) {
            map.fitBounds(poly.getBounds(), {
                padding: [60, 60],
                maxZoom: 19,
                animate: animate
            });
        }
    }

    // Reset styles for all Leaflet map elements
    function resetLeafletStyles() {
        const sliderVal = document.getElementById('opacity-slider').value / 100;
        plotsData.forEach(d => {
            if (d.id === 'SITE BOUNDARY') return;
            const poly = leafletPolygons[d.id];
            if (poly) {
                poly.setStyle({
                    color: d.id === selectedPlotId ? '#f2cc8f' : 'rgba(255,255,255,0.25)',
                    weight: d.id === selectedPlotId ? 3.5 : 1,
                    fillOpacity: getPlotOpacity(d) * sliderVal * (d.id === selectedPlotId ? 1.2 : 0.7)
                });
            }
        });
    }

    // Auto-fit the Leaflet map bounds to focus on the entire site boundary
    function fitMapToSiteBoundary() {
        const boundary = plotsData.find(d => d.id === 'SITE BOUNDARY');
        if (boundary && document.getElementById('map-panel').offsetWidth > 0) {
            const bounds = toLatLngs(boundary.points);
            map.fitBounds(bounds, { padding: [40, 40], animate: true });
        }
    }

    // ─── LOAD DATA AND INITIALIZE RENDERERS ──────────────
    d3.json('plots_data.json').then(data => {
        plotsData = data;

        // 1. Sort elements: SITE BOUNDARY first, then green parks, then roads, then plots
        const zOrder = d => {
            if (d.id === 'SITE BOUNDARY') return 0;
            if (d.isPark) return 1;
            if (d.isRoad) return 2;
            return 3;
        };
        data.sort((a, b) => zOrder(a) - zOrder(b));

        // 2a. Render Zone overlays (behind everything)
        ZONES.forEach(zone => {
            g.append('rect')
                .attr('class', 'zone-overlay')
                .attr('data-zone', zone.id)
                .attr('x', zone.x1).attr('y', zone.y1)
                .attr('width', zone.x2 - zone.x1).attr('height', zone.y2 - zone.y1)
                .attr('fill', zone.color)
                .style('opacity', 0.03)   /* very subtle tint — keeps boundaries sharp */
                .style('pointer-events', 'none');
            g.append('text')
                .attr('class', 'zone-watermark')
                .attr('data-zone', zone.id)
                .attr('x', (zone.x1 + zone.x2) / 2).attr('y', (zone.y1 + zone.y2) / 2)
                .attr('fill', zone.color)
                .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
                .attr('font-size', 70).attr('font-family', 'Outfit').attr('font-weight', 800)
                .attr('letter-spacing', 4)
                .style('opacity', 0.06)   /* subtle watermark */
                .style('pointer-events', 'none')
                .text(zone.name.toUpperCase());
        });

        // 2b. Render D3 Elements
        // Background polygons
        g.selectAll('polygon')
            .data(data)
            .enter()
            .append('polygon')
            .attr('class', d => d.isRoad ? 'plot-road' : (d.id === 'SITE BOUNDARY' ? 'plot-boundary' : 'plot'))
            .attr('points', d => d.points.map(p => p.join(',')).join(' '))
            .attr('fill', d => getPlotColor(d))
            .attr('fill-opacity', d => getPlotOpacity(d))
            .on('mouseover', function(event, d) {
                if (d.isRoad || d.id === 'SITE BOUNDARY') return;
                
                // Show floating vector tooltip
                d3Tooltip.transition().duration(100).style('opacity', 1);
                d3Tooltip.html(`<strong>${d.isPark ? d.id : 'Plot ' + d.id}</strong> &nbsp;·&nbsp; ${d.area}`)
                    .style('left', event.pageX + 'px')
                    .style('top', event.pageY + 'px');

                highlightPlotHover(d.id, true);
            })
            .on('mousemove', function(event) {
                d3Tooltip.style('left', event.pageX + 'px')
                    .style('top', event.pageY + 'px');
            })
            .on('mouseout', function(event, d) {
                d3Tooltip.transition().duration(200).style('opacity', 0);
                highlightPlotHover(d.id, false);
            })
            .on('click', function(event, d) {
                if (d.isRoad || d.id === 'SITE BOUNDARY') return;
                selectPlot(d.id, 'd3');
            });

        // Text plot labels centered at centroids
        g.selectAll('.plot-label')
            .data(data.filter(d => d.id !== 'SITE BOUNDARY'))
            .enter()
            .append('text')
            .attr('class', d => {
                if (d.isRoad) return 'plot-label-road';
                if (d.isPark) return 'plot-label-park';
                return 'plot-label';
            })
            .attr('x', d => {
                const sx = d.points.reduce((s, p) => s + p[0], 0);
                return sx / d.points.length;
            })
            .attr('y', d => {
                const sy = d.points.reduce((s, p) => s + p[1], 0);
                return sy / d.points.length;
            })
            .attr('transform', d => {
                if (!d.isRoad) return null;
                // Determine road orientation from bounding box
                const xs = d.points.map(p => p[0]);
                const ys = d.points.map(p => p[1]);
                const w = Math.max(...xs) - Math.min(...xs);
                const h = Math.max(...ys) - Math.min(...ys);
                const cx = d.points.reduce((s, p) => s + p[0], 0) / d.points.length;
                const cy = d.points.reduce((s, p) => s + p[1], 0) / d.points.length;
                // If taller than wide, it's a vertical road — rotate label 90°
                if (h > w) return `rotate(-90, ${cx}, ${cy})`;
                return null;
            })
            .text(d => d.isPark ? d.id.replace(' ZONE', '').replace(' BLOCK', '') : d.id);

        // Initial D3 scaling to fit D3 window bounds
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        data.forEach(d => {
            d.points.forEach(p => {
                if (p[0] < minX) minX = p[0];
                if (p[1] < minY) minY = p[1];
                if (p[0] > maxX) maxX = p[0];
                if (p[1] > maxY) maxY = p[1];
            });
        });

        if (data.length > 0) {
            const dw = maxX - minX;
            const dh = maxY - minY;
            const s = Math.min(700 / dw, 950 / dh) * 0.9;
            const tx = (700 - dw * s) / 2 - minX * s;
            const ty = (950 - dh * s) / 2 - minY * s;
            initialD3Transform = d3.zoomIdentity.translate(tx, ty).scale(s);
            resetD3View();
        }

        // 3. Render Leaflet Map Overlays
        data.forEach(d => {
            const latlngs = toLatLngs(d.points);
            const sliderVal = document.getElementById('opacity-slider').value / 100;

            const isBoundary = d.id === 'SITE BOUNDARY';
            const poly = L.polygon(latlngs, {
                color: isBoundary ? '#81b29a' : 'rgba(255, 255, 255, 0.25)',
                weight: isBoundary ? 2.5 : 1,
                dashArray: isBoundary ? '8 4' : null,
                fillColor: getMapColor(d),
                fillOpacity: getPlotOpacity(d) * (isBoundary ? 0 : sliderVal * 0.7),
                className: d.isRoad ? 'road-poly' : ''
            }).addTo(map);

            // Save reference to bi-directional mapper
            leafletPolygons[d.id] = poly;

            if (d.isRoad) {
                poly.bindTooltip(d.id, {
                    permanent: true,
                    direction: 'center',
                    className: 'leaflet-road-label'
                });
                return;
            }

            // Skip interaction listeners for boundary
            if (isBoundary) return;

            // Premium sticky Leaflet map tooltip
            poly.bindTooltip(`<strong>${d.isPark ? d.id : 'Plot ' + d.id}</strong><br>${d.area}`, {
                sticky: true,
                className: 'custom-tooltip',
                direction: 'top'
            });

            // Hover sync
            poly.on('mouseover', () => {
                highlightPlotHover(d.id, true);
            });

            poly.on('mouseout', () => {
                highlightPlotHover(d.id, false);
            });

            // Click selection sync
            poly.on('click', () => {
                selectPlot(d.id, 'leaflet');
            });
        });

        // 4. Update Header Stats
        const plotsOnly = data.filter(d => !d.isRoad && !d.isPark);
        document.getElementById('stat-total').textContent = plotsOnly.length;
        document.getElementById('stat-available').textContent = plotsOnly.filter(d => d.status === 'Available').length;
        document.getElementById('stat-sold').textContent = plotsOnly.filter(d => d.status === 'Sold').length;

        // 5. Fit the map bounds to the site boundary
        fitMapToSiteBoundary();

        // 6. Leaflet zone rectangle overlays
        ZONES.forEach(zone => {
            const sw = toLatLng([zone.x1, zone.y2]);
            const ne = toLatLng([zone.x2, zone.y1]);
            L.rectangle([sw, ne], {
                color: zone.color, weight: 1.5, dashArray: '7 4',
                fillColor: zone.color, fillOpacity: 0.05, interactive: false
            }).addTo(map);
            const cx = toLatLng([(zone.x1 + zone.x2) / 2, (zone.y1 + zone.y2) / 2]);
            L.marker(cx, {
                icon: L.divIcon({
                    className: '',
                    html: `<div style="color:${zone.color};font-family:Outfit,sans-serif;font-size:14px;font-weight:800;opacity:0.75;text-shadow:0 0 8px #000,0 1px 3px #000;white-space:nowrap;pointer-events:none">${zone.name.toUpperCase()}</div>`,
                    iconAnchor: [32, 10]
                }), interactive: false
            }).addTo(map);
        });

        // 7. Zone panel button handlers
        document.querySelectorAll('.zone-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.zone-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const zoneId = btn.getAttribute('data-zone');
                activeZone = zoneId === 'all' ? null : zoneId;
                const statsEl = document.getElementById('zone-stats');

                if (!activeZone) {
                    d3.selectAll('.plot').style('opacity', 1);
                    data.forEach(d => {
                        const poly = leafletPolygons[d.id];
                        if (!poly) return;
                        const sliderVal = document.getElementById('opacity-slider').value / 100;
                        poly.setStyle({ fillOpacity: getPlotOpacity(d) * sliderVal * 0.7, opacity: 1 });
                    });
                    d3.selectAll('.zone-overlay').style('opacity', 0.03);
                    d3.selectAll('.zone-watermark').style('opacity', 0.06);
                    statsEl.classList.add('hidden');
                } else {
                    const zone = ZONES.find(z => z.id === activeZone);
                    d3.selectAll('.plot').style('opacity', function(pd) {
                        const pz = getPlotZone(pd);
                        return pz && pz.id === activeZone ? 1 : 0.1;
                    });
                    data.forEach(d => {
                        if (d.isRoad || d.isPark || d.id === 'SITE BOUNDARY') return;
                        const poly = leafletPolygons[d.id];
                        if (!poly) return;
                        const pz = getPlotZone(d);
                        const inZone = pz && pz.id === activeZone;
                        const sliderVal = document.getElementById('opacity-slider').value / 100;
                        poly.setStyle({
                            fillOpacity: inZone ? getPlotOpacity(d) * sliderVal * 0.9 : 0.03,
                            opacity: inZone ? 1 : 0.25
                        });
                    });
                    d3.selectAll('.zone-overlay').style('opacity', function() {
                        return d3.select(this).attr('data-zone') === activeZone ? 0.1 : 0.01;
                    });
                    d3.selectAll('.zone-watermark').style('opacity', function() {
                        return d3.select(this).attr('data-zone') === activeZone ? 0.14 : 0.01;
                    });
                    const zonePlots = data.filter(d => {
                        if (d.isRoad || d.isPark || d.id === 'SITE BOUNDARY') return false;
                        const pz = getPlotZone(d);
                        return pz && pz.id === activeZone;
                    });
                    document.getElementById('zs-total').textContent = zonePlots.length;
                    document.getElementById('zs-available').textContent = zonePlots.filter(d => d.status === 'Available').length;
                    document.getElementById('zs-sold').textContent = zonePlots.filter(d => d.status === 'Sold').length;
                    statsEl.classList.remove('hidden');
                }
            });
        });

    }).catch(err => {
        console.error('Failed to load plots_data.json:', err);
    });

    // ─── OPACITY CONTROL SLIDER HANDLER ──────────────────
    const opacitySlider = document.getElementById('opacity-slider');
    opacitySlider.addEventListener('input', (e) => {
        const val = e.target.value / 100;
        plotsData.forEach(d => {
            if (d.id === 'SITE BOUNDARY') return;
            const poly = leafletPolygons[d.id];
            if (poly) {
                const multiplier = d.id === selectedPlotId ? 1.2 : 0.7;
                poly.setStyle({
                    fillOpacity: getPlotOpacity(d) * val * multiplier
                });
            }
        });
    });
});
