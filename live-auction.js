// Countdown, bidder allowlist, TikTok LIVE chat connection and bid display.
let auctionSeconds = 60;
let auctionInterval = null;
let liveSocket = null;
let allowedUsers = [];
const bidders = new Map();
const displayNames = new Map();
try {
  const savedNames = JSON.parse(localStorage.getItem('allowedTikTokDisplayNames') || '{}');
  if (savedNames && typeof savedNames === 'object' && !Array.isArray(savedNames)) {
    for (const [user, name] of Object.entries(savedNames)) displayNames.set(user, String(name || ''));
  }
} catch { /* Ignore invalid cached display names. */ }

try {
  allowedUsers = JSON.parse(localStorage.getItem('allowedTikTokUsers') || '[]');
  if (!Array.isArray(allowedUsers)) allowedUsers = [];
} catch {
  allowedUsers = [];
}

const byId = (id) => document.getElementById(id);

function displayTimer() {
  const minutes = String(Math.floor(auctionSeconds / 60)).padStart(2, '0');
  const seconds = String(auctionSeconds % 60).padStart(2, '0');
  byId('timer').textContent = `${minutes}:${seconds}`;
  const progress = Math.max(0, Math.min(1, auctionSeconds / 60));
  const hue = Math.round(progress * 120);
  const lineWidth = `calc(${progress * 100}% - ${24 * progress}px)`;
  byId('timerFill').style.width = lineWidth;
  byId('timerFill').style.backgroundColor = `hsl(${hue} 82% 42%)`;
  byId('timer').style.color = `hsl(${hue} 48% 30%)`;
  byId('timerTrack').style.backgroundColor = `hsl(${hue} 42% 97%)`;
  byId('timerTrack').style.borderColor = `hsl(${hue} 35% 62%)`;
}

function closeAuctionTimer() {
  clearInterval(auctionInterval);
  auctionInterval = null;
  byId('timerButton').textContent = 'بدء المؤقت';
}

function startAuctionTimer() {
  clearInterval(auctionInterval);
  auctionSeconds = 60;
  bidders.clear();
  renderBids();
  displayTimer();
  byId('soldOverlay').style.display = 'none';
  byId('timerButton').textContent = 'إعادة المؤقت';
  byId('timerCaption').textContent = 'وقت المزاد • ينتهي الوقت';
  auctionInterval = setInterval(() => {
    auctionSeconds -= 1;
    displayTimer();
    if (auctionSeconds <= 0) {
      closeAuctionTimer();
      byId('timerCaption').textContent = 'انتهى وقت المزاد';
    }
  }, 1000);
}

byId('timerButton').addEventListener('click', startAuctionTimer);
byId('soldButton').addEventListener('click', () => {
  closeAuctionTimer();
  byId('timerCaption').textContent = 'تم البيع';
});

function renderAllowedUsers() {
  const list = byId('allowedUsersList');
  list.replaceChildren();
  allowedUsers.forEach((user, index) => {
    const row = document.createElement('li');
    const label = document.createElement('span');
    const remove = document.createElement('button');
    label.className = 'allowed-user-label';
    const displayName = document.createElement('strong');
    displayName.className = 'allowed-user-display-name';
    displayName.textContent = displayNames.get(user) || user;
    const username = document.createElement('small');
    username.className = 'allowed-user-username';
    username.textContent = `@${user}`;
    label.append(displayName, username);
    remove.type = 'button';
    remove.className = 'remove-user';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `حذف ${user}`);
    remove.addEventListener('click', () => {
      allowedUsers.splice(index, 1);
      saveAllowedUsers();
    });
    row.append(label, remove);
    list.append(row);
  });
  localStorage.setItem('allowedTikTokUsers', JSON.stringify(allowedUsers));
  localStorage.setItem('allowedTikTokDisplayNames', JSON.stringify(Object.fromEntries(displayNames)));
}

function saveAllowedUsers() {
  allowedUsers = [...new Set(allowedUsers.map((name) => String(name).toLowerCase().replace(/^@/, '')))];
  renderAllowedUsers();
}

function addAllowedUser() {
  const field = byId('allowedUserInput');
  const username = field.value.trim().replace(/^@/, '').toLowerCase();
  if (!username) return;
  if (!/^[a-z0-9._]{2,24}$/.test(username)) {
    setLiveStatus('تحقق من كتابة اليوزر بشكل صحيح', 'error');
    return;
  }
  if (!allowedUsers.includes(username)) {
    allowedUsers.push(username);
    saveAllowedUsers();
  }
  field.value = '';
}

byId('addUserButton').addEventListener('click', addAllowedUser);
byId('allowedUserInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addAllowedUser();
  }
});
renderAllowedUsers();
displayTimer();

function setLiveStatus(message, state = '') {
  const status = byId('liveStatus');
  status.textContent = message;
  status.className = `live-status${state ? ` ${state}` : ''}`;
}

function connectToTikTok() {
  const username = byId('streamerInput').value.trim().replace(/^@/, '');
  if (!/^[a-zA-Z0-9._]{2,24}$/.test(username)) {
    setLiveStatus('أدخل يوزر صاحب البث بشكل صحيح', 'error');
    return;
  }
  if (liveSocket) liveSocket.close();
  setLiveStatus('جارٍ الاتصال بالبث…');
  liveSocket = new WebSocket(`ws://${location.hostname || '127.0.0.1'}:3001`);
  liveSocket.addEventListener('open', () => liveSocket.send(JSON.stringify({ type: 'connect', username })));
  liveSocket.addEventListener('message', (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    if (data.type === 'status') setLiveStatus(data.message, data.state || '');
    if (data.type === 'chat') processLiveComment(data.user, data.comment, data.displayName);
  });
  liveSocket.addEventListener('close', () => {
    if (byId('liveStatus').classList.contains('connected')) setLiveStatus('انقطع الاتصال بالبث', 'error');
  });
  liveSocket.addEventListener('error', () => setLiveStatus('تعذر الاتصال بالخدمة المحلية؛ شغّل الخادم أولًا', 'error'));
}

byId('connectLiveButton').addEventListener('click', connectToTikTok);
byId('streamerInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') connectToTikTok();
});

function parseBid(comment) {
  const normalized = String(comment)
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .trim();
  const isPlainAmount = /^\d+$/.test(normalized);
  const isCommaAmount = /^\d{1,3}(?:[,٬،]\d{2,3})+$/.test(normalized);
  if (!isPlainAmount && !isCommaAmount) return null;
  const amount = Number(normalized.replace(/[,٬،]/g, ''));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function processLiveComment(user, comment, displayName = '') {
  const username = String(user || '').toLowerCase().replace(/^@/, '');
  const cleanDisplayName = String(displayName || '').trim();
  if (username && cleanDisplayName && displayNames.get(username) !== cleanDisplayName) {
    displayNames.set(username, cleanDisplayName);
    localStorage.setItem('allowedTikTokDisplayNames', JSON.stringify(Object.fromEntries(displayNames)));
    if (allowedUsers.includes(username)) renderAllowedUsers();
  }
  const diagnostic = byId('lastChatStatus');
  diagnostic.textContent = `آخر تعليق: @${username || displayName || 'غير معروف'} — ${comment}`;
  diagnostic.title = diagnostic.textContent;
  if (!username) {
    diagnostic.textContent += ' | لم يصل معرّف اليوزر من تيك توك';
    return;
  }
  if (!allowedUsers.includes(username)) {
    diagnostic.textContent += ' | اليوزر غير مضاف للقائمة';
    return;
  }
  if (auctionSeconds <= 0) {
    diagnostic.textContent += ' | ابدأ المؤقت أولًا';
    return;
  }
  const amount = parseBid(comment);
  if (!amount) {
    diagnostic.textContent += ' | اكتب المبلغ فقط مثل 10,000';
    return;
  }
  const currentHighest = Math.max(0, ...[...bidders.values()].map((bid) => bid.amount));
  if (amount <= currentHighest) {
    diagnostic.textContent += ` | المبلغ أقل من أعلى سومه ${currentHighest.toLocaleString('en-US')}`;
    return;
  }
  bidders.set(username, { username, displayName: cleanDisplayName || displayNames.get(username) || username, amount });
  diagnostic.textContent = `تم قبول ${amount.toLocaleString('en-US')} من @${username}`;
  renderBids();
}

function renderBids() {
  const sorted = [...bidders.values()].sort((a, b) => b.amount - a.amount).slice(0, 3);
  const list = byId('bidList');
  list.replaceChildren();
  if (!sorted.length) {
    byId('highestBidAmount').textContent = '—';
    byId('highestBidder').textContent = 'بانتظار المزايدات';
    const empty = document.createElement('li');
    empty.className = 'empty-bids';
    empty.textContent = 'تظهر المزايدات هنا';
    list.append(empty);
    return;
  }
  byId('highestBidAmount').textContent = sorted[0].amount.toLocaleString('en-US');
  byId('highestBidder').textContent = `${sorted[0].displayName || sorted[0].username} (@${sorted[0].username})`;
  sorted.forEach((bid, index) => {
    const row = document.createElement('li');
    const rank = document.createElement('span');
    const name = document.createElement('span');
    const amount = document.createElement('strong');
    rank.className = 'bid-rank';
    rank.textContent = String(index + 1);
    name.className = 'bid-user';
    const display = document.createElement('strong');
    display.className = 'bid-display-name';
    display.textContent = bid.displayName || displayNames.get(bid.username) || bid.username;
    const username = document.createElement('small');
    username.className = 'bid-username';
    username.textContent = `@${bid.username}`;
    name.append(display, username);
    amount.className = 'bid-amount';
    amount.textContent = bid.amount.toLocaleString('en-US');
    row.append(rank, name, amount);
    list.append(row);
  });
}









