// Screen areas covered by floating UI, so views can fit/centre content in what's actually visible.
export const isMobile = () => window.matchMedia('(max-width: 767px)').matches;

export function getInsets({ withSheet = false } = {}) {
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const rect = (id) => document.getElementById(id)?.getBoundingClientRect();
    const legend = rect('legend');
    const toolbar = rect('toolbar');
    const bottom = rect('bottombar');
    const insets = {
        top: Math.max(legend?.bottom || 0, toolbar?.bottom || 0) + 8,
        bottom: bottom ? vh - bottom.top + 8 : 16,
        left: 16,
        right: 16,
    };
    if (withSheet) {
        ['sheet', 'nearby-panel'].forEach(id => {
            const panel = document.getElementById(id);
            if (!panel || panel.hidden) return;
            // offset* ignores the slide-in transform, so this is right mid-animation too
            if (isMobile()) insets.bottom = Math.max(insets.bottom, panel.offsetHeight + 8);
            else if (id === 'sheet') insets.right = Math.max(insets.right, vw - panel.offsetLeft + 8);
            else insets.left = Math.max(insets.left, panel.offsetLeft + panel.offsetWidth + 8);
        });
    }
    return insets;
}
