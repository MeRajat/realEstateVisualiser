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
        if (d.isRoad) return '#1e293b'; // deep slate
        if (d.isPark) return 'rgba(129, 178, 154, 0.35)'; // translucent green
        if (d.status === 'Sold') return 'rgba(224, 122, 95, 0.65)'; // terracotta
        if (d.status === 'Available') return 'rgba(242, 204, 143, 0.25)'; // translucent gold
        return 'rgba(148, 163, 184, 0.2)';
    };

    const getPlotOpacity = (d) => {
        if (d.id === 'SITE BOUNDARY') return 0;
        if (d.isRoad) return 0.85;
        if (d.isPark) return 0.45;
        return 0.65;
    };

    const getMapColor = (d) => {
        if (d.id === 'SITE BOUNDARY') return 'transparent';
        if (d.isRoad) return '#1e293b';
        if (d.isPark) return '#81b29a';
        if (d.status === 'Sold') return '#e07a5f';
        if (d.status === 'Available') return '#f2cc8f';
        return '#64748b';
    };

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
        d3.selectAll('.plot').classed('selected', false);
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
        
        // Render values
        document.getElementById('card-area').textContent = d.area;
        document.getElementById('card-price').textContent = d.price;

        // Math: area in sq yards = sq ft / 9
        if (!d.isPark && d.area.includes('sq.ft')) {
            const sqftVal = parseFloat(d.area.replace(/[^\d.]/g, ''));
            const sqydVal = Math.round((sqftVal / 9) * 10) / 10;
            document.getElementById('card-area-sqyd').textContent = sqydVal + " sq.yd";
            document.getElementById('card-area-sqyd').parentElement.style.display = 'flex';
        } else {
            document.getElementById('card-area-sqyd').parentElement.style.display = 'none';
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
        d3.selectAll('.plot').classed('selected', false);
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

        // 2. Render D3 Elements
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
