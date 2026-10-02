// Plain-language copy for the builder dashboard, in English and Hindi.
// Keep sentences short and everyday — this is read by busy site owners, often on a phone.
const STRINGS = {
    en: {
        title: 'Customer dashboard',
        signInTitle: 'Builder login',
        password: 'Password',
        signIn: 'Sign in',
        wrongPassword: 'Wrong password. Please try again.',
        signOut: 'Sign out',
        refresh: 'Refresh',
        updated: 'Updated {time}',
        viewSite: 'Open website',
        morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening',
        summary: 'In the {period}, <b>{visitors}</b> people looked at your project and <b>{leads}</b> shared their phone number.',
        summaryNone: 'No visitors in the {period} yet. Share your website link on WhatsApp to get started.',
        period7: 'last 7 days', period30: 'last 30 days', period90: 'last 3 months',
        tab7: '7 days', tab30: '30 days', tab90: '3 months',
        prev7: 'than the week before', prev30: 'than the month before', prev90: 'than the 3 months before',
        more: '{n}% more', less: '{n}% less', same: 'Same as before', newUp: 'New',

        callsTitle: 'Calls to make today',
        callsNone: 'No calls pending. Well done!',
        callsHint: 'New customers and people you promised to call back.',
        overdue: 'Was due {n} days ago', overdue1: 'Was due yesterday', dueToday: 'Call today', newLead: 'New — not called yet',
        call: 'Call', whatsapp: 'WhatsApp', done: 'Done', later: 'Tomorrow',
        markedDone: 'Marked as called', movedTomorrow: 'Moved to tomorrow',

        kVisitors: 'People who visited', kLeads: 'Shared phone number', kVisits: 'Site visits', kBooked: 'Plots booked',
        kVisitorsHelp: 'Opened your website', kLeadsHelp: 'Gave name & mobile', kVisitsHelp: 'Customers at site visit stage or later', kBookedHelp: 'Marked as booked',

        dailyTitle: 'Visitors each day', dailyHelp: 'Taller bar = more people that day. Tap a bar to see the number.',
        dailyTip: '{visitors} visitors · {leads} numbers',
        plotsTitle: 'Which plots people like', plotsHelp: 'Darker colour = more people looked at that plot. Tap a plot to see who is interested.',
        popular: 'Most popular plots', views: '{n} looks', enquiries: '{n} enquiries', noViews: 'No plot has been opened yet.',
        legendFew: 'Few looks', legendMany: 'Many looks', legendNone: 'Not seen', legendSold: 'Sold',
        sourcesTitle: 'Where visitors come from', sourcesHelp: 'Spend more on the sources that bring phone numbers.',
        sourceLine: '{visitors} visitors · {leads} number', plural: 's',
        journeyTitle: 'Customer journey', journeyHelp: 'How many people reached each step.',
        jVisited: 'Visited website', jViewed: 'Looked at a plot', jLeads: 'Shared phone number', jSite: 'Came for site visit', jBooked: 'Booked',

        customers: 'All customers', search: 'Search name, mobile or plot', exportExcel: 'Download Excel',
        all: 'All', hot: 'Very interested', noCustomers: 'No customers here yet.',
        showMore: 'Show {n} more',
        noCustomersPlot: 'People looked at {what}, but nobody interested in it has shared a phone number yet.',
        interestedIn: 'Interested in', general: 'General enquiry', lastSeen: 'Last seen {time}', callOn: 'Call on {date}',
        plot: 'Plot {id}', apartment: 'Flat {id}',

        stage: 'Stage', stage_new: 'New', stage_contacted: 'Called', stage_site_visit: 'Site visit',
        stage_negotiation: 'Talking price', stage_booked: 'Booked', stage_lost: 'Not interested',
        callAgain: 'Call again on', today: 'Today', tomorrow: 'Tomorrow', in3: 'In 3 days', nextWeek: 'Next week', noDate: 'No date',
        notes: 'Notes', notesHint: 'Budget, plot size wanted, family details…', save: 'Save', close: 'Close', saved: 'Saved',
        lookedAt: 'What they looked at', history: 'What they did', firstEnquiry: 'First enquiry {date}',
        visitsN: '{n} visits', ev_visit: 'Opened the website', ev_plot_view: 'Looked at {what}', ev_enquire: 'Asked about {what}',
        ev_lead: 'Shared phone number', ev_view_mode: 'Opened the {what} view', copy: 'Copy number', copied: 'Number copied',
        fromSource: 'Came from {source}',

        demoBanner: 'You are seeing <b>sample data</b> so you can try the dashboard.',
        demoRemove: 'Remove sample data', demoConfirm: 'Remove all sample customers and visits? Real customers are not touched.',
        demoEmptyTitle: 'No customers yet', demoEmptyText: 'When people share their mobile number on your website, they will appear here. Want to see how it works?',
        demoLoad: 'Show sample data', demoLoading: 'Adding sample data…', demoAdded: 'Sample data added', demoRemoved: 'Sample data removed',
        failed: 'Something went wrong. Please try again.',
        justNow: 'just now', minAgo: '{n} min ago', hrAgo: '{n} hr ago', dayAgo: '{n} days ago', yesterday: 'yesterday',
        langSwitch: 'हिंदी',
    },
    hi: {
        title: 'ग्राहक डैशबोर्ड',
        signInTitle: 'बिल्डर लॉगिन',
        password: 'पासवर्ड',
        signIn: 'लॉगिन करें',
        wrongPassword: 'पासवर्ड गलत है। फिर से कोशिश करें।',
        signOut: 'लॉग आउट',
        refresh: 'रीफ़्रेश',
        updated: '{time} अपडेट हुआ',
        viewSite: 'वेबसाइट खोलें',
        morning: 'सुप्रभात', afternoon: 'नमस्ते', evening: 'शुभ संध्या',
        summary: 'पिछले {period} में <b>{visitors}</b> लोगों ने आपका प्रोजेक्ट देखा और <b>{leads}</b> लोगों ने अपना मोबाइल नंबर दिया।',
        summaryNone: 'पिछले {period} में अभी कोई नहीं आया। शुरू करने के लिए अपनी वेबसाइट का लिंक WhatsApp पर भेजें।',
        period7: '7 दिनों', period30: '30 दिनों', period90: '3 महीनों',
        tab7: '7 दिन', tab30: '30 दिन', tab90: '3 महीने',
        prev7: 'पिछले हफ़्ते से', prev30: 'पिछले महीने से', prev90: 'पिछले 3 महीनों से',
        more: '{n}% ज़्यादा', less: '{n}% कम', same: 'पहले जितना', newUp: 'नया',

        callsTitle: 'आज के कॉल',
        callsNone: 'कोई कॉल बाकी नहीं। बहुत बढ़िया!',
        callsHint: 'नए ग्राहक और जिन्हें दोबारा कॉल करने का वादा किया था।',
        overdue: '{n} दिन पहले करना था', overdue1: 'कल करना था', dueToday: 'आज कॉल करें', newLead: 'नया — अभी कॉल नहीं हुआ',
        call: 'कॉल', whatsapp: 'WhatsApp', done: 'हो गया', later: 'कल',
        markedDone: 'कॉल हो गया', movedTomorrow: 'कल के लिए रखा',

        kVisitors: 'वेबसाइट देखने वाले', kLeads: 'नंबर देने वाले', kVisits: 'साइट विज़िट', kBooked: 'बुक हुए प्लॉट',
        kVisitorsHelp: 'जिन्होंने वेबसाइट खोली', kLeadsHelp: 'नाम और मोबाइल दिया', kVisitsHelp: 'साइट विज़िट या उससे आगे', kBookedHelp: 'बुक किए गए',

        dailyTitle: 'हर दिन कितने लोग आए', dailyHelp: 'लंबी पट्टी = उस दिन ज़्यादा लोग। संख्या देखने के लिए पट्टी दबाएँ।',
        dailyTip: '{visitors} लोग · {leads} नंबर',
        plotsTitle: 'लोगों को कौन से प्लॉट पसंद हैं', plotsHelp: 'गहरा रंग = ज़्यादा लोगों ने देखा। कौन रुचि रखता है देखने के लिए प्लॉट दबाएँ।',
        popular: 'सबसे पसंदीदा प्लॉट', views: '{n} बार देखा', enquiries: '{n} पूछताछ', noViews: 'अभी तक किसी ने प्लॉट नहीं खोला।',
        legendFew: 'कम देखा', legendMany: 'ज़्यादा देखा', legendNone: 'नहीं देखा', legendSold: 'बिक चुका',
        sourcesTitle: 'लोग कहाँ से आए', sourcesHelp: 'जहाँ से ज़्यादा नंबर मिलते हैं, वहाँ ज़्यादा प्रचार करें।',
        sourceLine: '{visitors} लोग · {leads} नंबर', plural: '',
        journeyTitle: 'ग्राहक का सफ़र', journeyHelp: 'हर कदम तक कितने लोग पहुँचे।',
        jVisited: 'वेबसाइट देखी', jViewed: 'प्लॉट देखा', jLeads: 'नंबर दिया', jSite: 'साइट पर आए', jBooked: 'बुक किया',

        customers: 'सभी ग्राहक', search: 'नाम, मोबाइल या प्लॉट खोजें', exportExcel: 'Excel डाउनलोड करें',
        all: 'सभी', hot: 'बहुत रुचि', noCustomers: 'यहाँ अभी कोई ग्राहक नहीं।',
        showMore: '{n} और दिखाएँ',
        noCustomersPlot: 'लोगों ने {what} देखा, पर इसमें रुचि रखने वाले किसी ने अभी नंबर नहीं दिया।',
        interestedIn: 'रुचि', general: 'सामान्य पूछताछ', lastSeen: 'आखिरी बार {time}', callOn: '{date} को कॉल',
        plot: 'प्लॉट {id}', apartment: 'फ़्लैट {id}',

        stage: 'स्थिति', stage_new: 'नया', stage_contacted: 'बात हुई', stage_site_visit: 'साइट विज़िट',
        stage_negotiation: 'भाव पर बात', stage_booked: 'बुक', stage_lost: 'रुचि नहीं',
        callAgain: 'दोबारा कॉल', today: 'आज', tomorrow: 'कल', in3: '3 दिन बाद', nextWeek: 'अगले हफ़्ते', noDate: 'कोई तारीख नहीं',
        notes: 'नोट्स', notesHint: 'बजट, प्लॉट का साइज़, परिवार की जानकारी…', save: 'सेव करें', close: 'बंद करें', saved: 'सेव हो गया',
        lookedAt: 'क्या देखा', history: 'क्या किया', firstEnquiry: 'पहली पूछताछ {date}',
        visitsN: '{n} बार आए', ev_visit: 'वेबसाइट खोली', ev_plot_view: '{what} देखा', ev_enquire: '{what} के बारे में पूछा',
        ev_lead: 'मोबाइल नंबर दिया', ev_view_mode: '{what} व्यू खोला', copy: 'नंबर कॉपी करें', copied: 'नंबर कॉपी हो गया',
        fromSource: '{source} से आए',

        demoBanner: 'आप <b>नमूना डेटा</b> देख रहे हैं ताकि डैशबोर्ड आज़मा सकें।',
        demoRemove: 'नमूना डेटा हटाएँ', demoConfirm: 'सारे नमूना ग्राहक और विज़िट हटाएँ? असली ग्राहकों को कुछ नहीं होगा।',
        demoEmptyTitle: 'अभी कोई ग्राहक नहीं', demoEmptyText: 'जब लोग आपकी वेबसाइट पर मोबाइल नंबर देंगे, वे यहाँ दिखेंगे। देखना चाहते हैं कि यह कैसे काम करता है?',
        demoLoad: 'नमूना डेटा दिखाएँ', demoLoading: 'नमूना डेटा जोड़ा जा रहा है…', demoAdded: 'नमूना डेटा जुड़ गया', demoRemoved: 'नमूना डेटा हट गया',
        failed: 'कुछ गड़बड़ हुई। फिर से कोशिश करें।',
        justNow: 'अभी', minAgo: '{n} मिनट पहले', hrAgo: '{n} घंटे पहले', dayAgo: '{n} दिन पहले', yesterday: 'कल',
        langSwitch: 'English',
    },
};

const SOURCE_NAMES = {
    google: 'Google', instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp',
    '99acres': '99acres', magicbricks: 'MagicBricks', direct: { en: 'Direct link', hi: 'सीधा लिंक' }, other: { en: 'Other websites', hi: 'अन्य वेबसाइट' },
};

let lang = 'en';
try { lang = localStorage.getItem('admin_lang') === 'hi' ? 'hi' : 'en'; } catch { /* default */ }

export const getLang = () => lang;
export function setLang(next) {
    lang = next === 'hi' ? 'hi' : 'en';
    try { localStorage.setItem('admin_lang', lang); } catch { /* ignore */ }
    document.documentElement.lang = lang === 'hi' ? 'hi' : 'en';
}
document.documentElement.lang = lang === 'hi' ? 'hi' : 'en';

// t('summary', { visitors: 12 }) — values are inserted as given (escape untrusted text before passing)
export function t(key, vars = {}) {
    const s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
    return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}

export function sourceName(id) {
    const v = SOURCE_NAMES[id] ?? SOURCE_NAMES.other;
    return typeof v === 'string' ? v : v[lang];
}

export const locale = () => (lang === 'hi' ? 'hi-IN' : 'en-IN');
