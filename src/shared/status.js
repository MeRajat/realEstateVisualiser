// Unit status vocabulary shared by the customer site and the builder dashboard.
// Server statuses are lowercase; the apps keep the capitalised tokens the plan/3D/map CSS uses.
export const SERVER_TO_TOKEN = { available: 'Available', hold: 'Hold', booked: 'Booked', sold: 'Sold', blocked: 'Reserved' };
export const TOKEN_TO_SERVER = Object.fromEntries(Object.entries(SERVER_TO_TOKEN).map(([k, v]) => [v, k]));

export const STATUS_LABEL = {
    en: { Available: 'Available', Hold: 'On hold', Booked: 'Booked', Sold: 'Sold', Reserved: 'Not for sale' },
    hi: { Available: 'उपलब्ध', Hold: 'होल्ड पर', Booked: 'बुक', Sold: 'बिक चुका', Reserved: 'बिक्री के लिए नहीं' },
};

export const STATUS_COLORS = {
    Available: '#34a853',
    Hold: '#f9ab00',
    Booked: '#e8710a',
    Sold: '#9aa0a6',
    Reserved: '#80868b',
};

// From the static plan file: "Available" | "Sold" | "Reserved" (older files may say "Booked")
export const tokenFromPlan = (s) => (SERVER_TO_TOKEN[String(s || '').toLowerCase()] || (s in STATUS_COLORS ? s : 'Available'));
export const isForSale = (token) => token === 'Available';
