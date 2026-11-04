// Steadier two-finger gestures for a Leaflet map with leaflet-rotate.
//
// leaflet-rotate applies every tiny change in the angle between the fingers as rotation, so a plain
// pinch-zoom makes the map wobble a few degrees back and forth on every frame ("vibrating"), and it
// applies rotation and zoom in different frames. This replaces its touch handler's start/move with:
//   · a rotation lock — the map only starts turning after a deliberate twist (ROTATE_LOCK_DEG), and
//     then turns from that point on, without a jump;
//   · angle measured with atan2 (no flips when the fingers are side by side);
//   · zoom, centre and bearing applied together once per animation frame.
const ROTATE_LOCK_DEG = 12;
const RAD = 180 / Math.PI;

const angleOf = (p1, p2) => Math.atan2(p1.x - p2.x, p1.y - p2.y) * RAD; // same sense as leaflet-rotate
const wrap = (d) => ((d + 540) % 360) - 180;

export function smoothPinch(L, map) {
    const h = map.touchGestures;
    if (!h) return;
    // the touchstart listener is bound when the handler is enabled: unbind, swap methods, rebind
    const wasEnabled = h.enabled();
    if (wasEnabled) h.disable();

    h._onTouchStart = function (e) {
        if (!e.touches || e.touches.length !== 2 || map._animatingZoom || this._zooming || this._rotating) return;
        const p1 = map.mouseEventToContainerPoint(e.touches[0]);
        const p2 = map.mouseEventToContainerPoint(e.touches[1]);
        this._centerPoint = map.getSize()._divideBy(2);
        this._startLatLng = map.containerPointToLatLng(this._centerPoint);
        this._pinchStartLatLng = map.containerPointToLatLng(p1.add(p2)._divideBy(2));
        this._startDist = p1.distanceTo(p2) || 1;
        this._startZoom = map.getZoom();
        this._zooming = !!this.zoom;
        this._rotating = !!this.rotate;
        this._startAngle = angleOf(p1, p2);
        this._startBearing = map.getBearing();
        this._turning = false; // rotation lock released?
        this._bearing = this._startBearing;
        this._moved = false;
        map._stop();
        L.DomEvent.on(document, 'touchmove', this._onTouchMove, this).on(document, 'touchend touchcancel', this._onTouchEnd, this);
        L.DomEvent.preventDefault(e);
    };

    h._onTouchMove = function (e) {
        if (!e.touches || e.touches.length !== 2 || !(this._zooming || this._rotating)) return;
        const p1 = map.mouseEventToContainerPoint(e.touches[0]);
        const p2 = map.mouseEventToContainerPoint(e.touches[1]);
        const scale = p1.distanceTo(p2) / this._startDist;

        if (this._rotating) {
            const twist = wrap(angleOf(p1, p2) - this._startAngle);
            if (!this._turning && Math.abs(twist) > ROTATE_LOCK_DEG) {
                this._turning = true;
                this._startAngle += Math.sign(twist) * ROTATE_LOCK_DEG; // continue from here, no jump
            }
            if (this._turning) this._bearing = this._startBearing - wrap(angleOf(p1, p2) - this._startAngle);
        }

        let zoom = map.getZoom();
        if (this._zooming) {
            zoom = map.getScaleZoom(scale, this._startZoom);
            if (!map.options.bounceAtZoomLimits && ((zoom < map.getMinZoom() && scale < 1) || (zoom > map.getMaxZoom() && scale > 1))) {
                zoom = map._limitZoom(zoom);
            }
        }
        // keep the point between the fingers under the fingers (in the rotated frame)
        const delta = p1._add(p2)._divideBy(2)._subtract(this._centerPoint);
        const alpha = -this._bearing / RAD;
        const center = map.unproject(map.project(this._pinchStartLatLng, zoom).subtract(delta.rotate(alpha)), zoom);
        this._zoom = zoom;
        this._center = center;

        if (!this._moved) {
            map._moveStart(true, false);
            this._moved = true;
        }
        L.Util.cancelAnimFrame(this._animRequest);
        const bearing = this._bearing;
        const turning = this._turning;
        this._animRequest = L.Util.requestAnimFrame(() => {
            if (turning && Math.abs(wrap(map.getBearing() - bearing)) > 0.05) map.setBearing(bearing);
            map._move(center, zoom, { pinch: true, round: false });
        }, this, true);
        L.DomEvent.preventDefault(e);
    };

    if (wasEnabled) h.enable();
}
