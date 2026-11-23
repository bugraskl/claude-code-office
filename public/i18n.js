// UI strings. Add a language by copying the `en` block.
export const STRINGS = {
  en: {
    title: 'Claude Code Office',
    window: 'Window', h1: '1 hour', h3: '3 hours', h12: '12 hours', h48: '2 days',
    showDone: 'Finished', language: 'Language',
    sessions: 'Sessions', connection: 'Server connection', unreachable: 'Cannot reach the server: ',
    empty: 'No active sessions in this window.',
    emptyHint: 'Desks fill up as soon as a Claude Code session starts working.',
    demoBadge: 'DEMO DATA',
    status: {
      tool: 'Working', thinking: 'Thinking', waiting: 'Waiting for you',
      blocked: 'Possibly stuck', done: 'Finished', away: 'Away',
    },
    nSessions: (n) => `<b>${n}</b> session${n === 1 ? '' : 's'}`,
    nAgents: (n) => `<b>${n}</b> agent${n === 1 ? '' : 's'}`,
    lead: 'Lead agent', leadRole: 'Main agent (team lead)', subRole: 'Subagent', background: 'background',
    untitled: 'Untitled session',
    team: (n, working) => ` · team ${n}${working ? `, ${working} working` : ''}`,
    act: {
      working: 'working', thinking: 'thinking', notification: 'reading a report',
      started: (ago) => `started ${ago}`, stuck: 'possibly stuck',
      waitingTeam: (n) => `${n} teammate${n === 1 ? '' : 's'} working · waiting for you`,
      waiting: 'waiting for you', done: (ago) => `finished ${ago}`, away: (ago) => `away · ${ago}`,
    },
    ago: { s: (n) => `${n}s ago`, m: (n) => `${n}m ago`, h: (n) => `${n}h ago`, d: (n) => `${n}d ago` },
    agoShort: { s: (n) => `${n}s`, m: (n) => `${n}m`, h: (n) => `${n}h`, d: (n) => `${n}d` },
    board: { tasks: 'Task list', agenda: 'Agenda', more: (n) => `+${n} more` },
    panel: {
      taskList: 'Task list', team: (n) => `Team (${n})`, brief: 'Assignment', lastPrompt: 'Your last request',
      lastText: 'Last message', recent: 'Recent work', noTools: 'No tool calls yet.', info: 'Details',
      model: 'Model', toolCalls: 'Tool calls', errors: (n) => `${n} failed`, outTok: 'Output tokens',
      context: 'Context', started: 'Started', lastSeen: 'Last activity', folder: 'Folder', branch: 'Branch', close: 'Close',
    },
    help: 'Click a person for details · double-click to zoom · Home for overview · Esc closes the panel',
  },
  tr: {
    title: 'Claude Code Ofisi',
    window: 'Pencere', h1: '1 saat', h3: '3 saat', h12: '12 saat', h48: '2 gün',
    showDone: 'Bitenler', language: 'Dil',
    sessions: 'Oturumlar', connection: 'Sunucu bağlantısı', unreachable: 'Sunucuya ulaşılamıyor: ',
    empty: 'Bu pencerede aktif oturum yok.',
    emptyHint: 'Bir Claude Code oturumu çalışmaya başlayınca masalar dolar.',
    demoBadge: 'DEMO VERİSİ',
    status: {
      tool: 'Çalışıyor', thinking: 'Düşünüyor', waiting: 'Seni bekliyor',
      blocked: 'Takılmış olabilir', done: 'Bitirdi', away: 'Boşta',
    },
    nSessions: (n) => `<b>${n}</b> oturum`,
    nAgents: (n) => `<b>${n}</b> ajan`,
    lead: 'Ana ajan', leadRole: 'Ana ajan (yönetici)', subRole: 'Alt ajan', background: 'arka planda',
    untitled: 'Adsız oturum',
    team: (n, working) => ` · ekip ${n}${working ? `, ${working} çalışıyor` : ''}`,
    act: {
      working: 'çalışıyor', thinking: 'düşünüyor', notification: 'rapor okuyor',
      started: (ago) => `${ago} başladı`, stuck: 'takılmış olabilir',
      waitingTeam: (n) => `ekipte ${n} kişi çalışıyor · seni bekliyor`,
      waiting: 'seni bekliyor', done: (ago) => `bitirdi · ${ago}`, away: (ago) => `boşta · ${ago}`,
    },
    ago: { s: (n) => `${n} sn önce`, m: (n) => `${n} dk önce`, h: (n) => `${n} sa önce`, d: (n) => `${n} gün önce` },
    agoShort: { s: (n) => `${n} sn`, m: (n) => `${n} dk`, h: (n) => `${n} sa`, d: (n) => `${n} gün` },
    board: { tasks: 'Görev listesi', agenda: 'Gündem', more: (n) => `+${n} adım daha` },
    panel: {
      taskList: 'Görev listesi', team: (n) => `Ekip (${n})`, brief: 'Verilen görev', lastPrompt: 'Son isteğin',
      lastText: 'Son yazdığı', recent: 'Son işler', noTools: 'Henüz araç kullanımı yok.', info: 'Bilgi',
      model: 'Model', toolCalls: 'Araç çağrısı', errors: (n) => `${n} hata`, outTok: 'Üretilen token',
      context: 'Bağlam', started: 'Başladı', lastSeen: 'Son hareket', folder: 'Klasör', branch: 'Dal', close: 'Kapat',
    },
    help: 'Ayrıntı için bir kişiye tıkla · yakınlaşmak için çift tık · Home genel bakış · Esc paneli kapatır',
  },
};

export function pickLanguage() {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  if (fromUrl && STRINGS[fromUrl]) return fromUrl;
  try { const saved = JSON.parse(localStorage.getItem('cco') || '{}').lang; if (saved && STRINGS[saved]) return saved; } catch { /* ignore */ }
  const nav = (navigator.languages || [navigator.language || 'en']).map((l) => l.slice(0, 2).toLowerCase());
  return nav.find((l) => STRINGS[l]) || 'en';
}
