// Icons + colours for nearby-place categories (Google palette). Shared by the plot map and the apartments 3D view.
const path = (d) => `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">${d}</svg>`;
const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
export const KINDS = {
    hospital: { color: '#ea4335', label: 'Hospital', icon: path(`<path d="M12 5v14M5 12h14" ${S}/>`) },
    school: { color: '#f9ab00', label: 'School', icon: path(`<path d="m2 9 10-5 10 5-10 5z M6 11v5c3 2 9 2 12 0v-5" ${S}/>`) },
    college: { color: '#a142f4', label: 'College', icon: path(`<path d="M4 5h7a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4zM20 5h-7a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h7z" ${S}/>`) },
    mall: { color: '#e52592', label: 'Shopping', icon: path(`<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2" ${S}/>`) },
    park: { color: '#34a853', label: 'Park', icon: path(`<path d="M12 3 6 13h12zM12 13v8" ${S}/>`) },
    airport: { color: '#4285f4', label: 'Airport', icon: path(`<path d="M10 20l2-6-7-3 1-2 8 1 4-6 2 1-2 7 4 2-1 2-5-1-3 6z" ${S}/>`) },
    railway: { color: '#4285f4', label: 'Railway', icon: path(`<rect x="6" y="3" width="12" height="13" rx="3" ${S}/><path d="M6 11h12M9 20l-2 2M15 20l2 2" ${S}/>`) },
    bus: { color: '#4285f4', label: 'Bus', icon: path(`<rect x="5" y="4" width="14" height="13" rx="2" ${S}/><path d="M5 11h14M8 20v-3M16 20v-3" ${S}/>`) },
};
