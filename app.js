(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const cfg = window.SHINYU_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const AVATARS = ['🦊','🐱','🐺','🐲','🦉','🐼','🐸','🦁','🐙','🦄','🐧','🤖'];
  const MODES = {
    GUESS_ANIME: ['Affiches', 'Reconnais l\'anime'],
    GUESS_BLUR: ['Image floue', 'L\'image se précise'],
    GUESS_ZOOM: ['Zoom', 'Le plan s\'élargit'],
    GUESS_CHARACTER: ['Personnages', 'Qui est-ce ?'],
    GUESS_SYNOPSIS: ['Synopsis', 'Quel est cet anime ?'],
    DUEL: ['Duels', 'Note ou date de sortie'],
    BLIND_TEST: ['Blind test', 'Devine l\'opening'],
    TRIVIA: ['Culture manga', 'Questions de culture']
  };
  const ROUND_CHOICES = [10, 20, 40];
  const REACTIONS = ['👏', '😂', '🔥', '😱', '❤️', '👀'];
  const PROTOCOL = 3;
  const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';

  const store = {
    get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* indisponible */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* indisponible */ } }
  };
  const cleanUrl = (u) => String(u || '').trim().replace(/\/+$/, '');
  const isPlaceholder = (u) => !u || /REMPLACE/i.test(u);

  // ---------- profil ----------
  let pid = store.get('shinyu-pid', '');
  if (!pid) { pid = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2); store.set('shinyu-pid', pid); }
  const me = { avatar: store.get('shinyu-avatar', AVATARS[0]), photo: store.get('shinyu-photo', ''), nickname: store.get('shinyu-nick', '') };
  const photos = {};          // pid -> data URL (reçues du serveur)

  // ---------- état ----------
  let room = null, round = null, picked = null, timerRaf = 0, clockOffset = 0, streak = 0, blindOK = true;
  let setup = { solo: true, modes: new Set(Object.keys(MODES)), rounds: 20 };
  let soloPending = false;
  let soundOn = store.get('shinyu-snd', '1') !== '0';

  // ---------- helpers ----------
  const screens = ['s-home', 's-lobby', 's-game', 's-over'];
  const show = (id) => screens.forEach(s => { $(s).hidden = s !== id; });
  let toastT;
  const toast = (msg) => { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3800); };
  const busy = (msg) => { $('loading').hidden = !msg; if (msg) $('loading-text').textContent = msg; };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const hearts = (n) => n > 0 ? '♥'.repeat(n) : '✕';
  const setConn = (txt, cls) => { $('conn').textContent = txt; $('conn').className = 'chip ' + cls; };
  const burst = (text, bad) => { const s = el('span', bad ? 'bad' : '', text); $('fx').appendChild(s); setTimeout(() => s.remove(), 1200); };
  const shake = () => { const g = $('s-game'); g.classList.remove('shake'); void g.offsetWidth; g.classList.add('shake'); };
  const vibrate = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch { /* non supporté */ } };

  function avatarNode(av, id) {
    const url = id && photos[id] ? photos[id] : (typeof av === 'string' && av.startsWith('url:') ? av.slice(4) : '');
    if (url) { const i = el('img', 'avimg'); i.alt = ''; i.referrerPolicy = 'no-referrer'; i.src = url; return i; }
    return el('span', 'avtxt', av || '🦊');
  }

  // ---------- sons ----------
  let actx;
  function sfx(kind) {
    if (!soundOn) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const now = actx.currentTime;
      const seq = { ok: [[660, 0, .09], [880, .09, .14]], combo: [[660, 0, .07], [880, .07, .07], [1175, .14, .16]],
        bad: [[220, 0, .18], [150, .16, .26]], go: [[440, 0, .08], [660, .1, .12]], win: [[523, 0, .12], [659, .12, .12], [784, .24, .12], [1047, .36, .3]] }[kind] || [];
      seq.forEach(([f, t, d]) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = 'square'; o.frequency.value = f;
        g.gain.setValueAtTime(.045, now + t); g.gain.exponentialRampToValueAtTime(.0001, now + t + d);
        o.connect(g); g.connect(actx.destination); o.start(now + t); o.stop(now + t + d + .02);
      });
    } catch { /* audio indisponible */ }
  }
  const player = $('player');
  const paintSound = () => { const b = $('snd'); b.setAttribute('aria-pressed', String(soundOn)); b.textContent = soundOn ? '♪ Son' : '✕ Muet'; b.setAttribute('aria-label', soundOn ? 'Son activé' : 'Son coupé'); player.muted = !soundOn; };
  $('snd').onclick = () => { soundOn = !soundOn; store.set('shinyu-snd', soundOn ? '1' : '0'); paintSound(); };
  paintSound();
  let unlocked = false;
  document.addEventListener('pointerdown', () => {
    if (unlocked) return; unlocked = true;
    try { player.src = SILENT; const p = player.play(); if (p) p.then(() => player.pause()).catch(() => {}); } catch { /* ignore */ }
  }, { once: true });
  player.addEventListener('playing', () => { $('vinyl').classList.add('on'); $('audio-btn').hidden = true; });
  player.addEventListener('pause', () => $('vinyl').classList.remove('on'));
  $('audio-btn').onclick = () => { player.play().catch(() => toast('Le navigateur bloque le son : touche l\'écran puis réessaie.')); };
  const stopAudio = () => { try { player.pause(); } catch { /* ignore */ } };

  // ---------- avatars ----------
  const persistAvatar = () => { store.set('shinyu-avatar', me.avatar); me.photo ? store.set('shinyu-photo', me.photo) : store.del('shinyu-photo'); };
  function paintAvatarUI() {
    const prev = $('av-preview'); prev.replaceChildren();
    if (me.photo) { const i = el('img'); i.alt = ''; i.src = me.photo; prev.appendChild(i); }
    else if (me.avatar.startsWith('url:')) { const i = el('img'); i.alt = ''; i.referrerPolicy = 'no-referrer'; i.src = me.avatar.slice(4); prev.appendChild(i); }
    else prev.textContent = me.avatar;
    $('avatars').querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String(!me.photo && b.dataset.a === me.avatar)));
    $('chars').querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String(!me.photo && b.dataset.a === me.avatar)));
    $('photo-clear').hidden = !me.photo;
  }
  AVATARS.forEach(a => {
    const b = el('button', '', a); b.type = 'button'; b.dataset.a = a;
    b.setAttribute('role', 'radio'); b.setAttribute('aria-label', 'Avatar ' + a);
    b.onclick = () => { me.avatar = a; me.photo = ''; persistAvatar(); paintAvatarUI(); };
    $('avatars').appendChild(b);
  });

  let charsLoaded = false;
  async function loadChars() {
    try { const c = JSON.parse(store.get('shinyu-chars', 'null')); if (c && Date.now() - c.t < 7 * 864e5 && c.v && c.v.length) return c.v; } catch { /* cache illisible */ }
    const r = await fetch('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'query{Page(page:1,perPage:48){characters(sort:FAVOURITES_DESC){id name{userPreferred} image{medium}}}}' }) });
    const j = await r.json();
    const v = j.data.Page.characters.map(c => ({ id: c.id, name: c.name.userPreferred, img: c.image.medium }))
      .filter(c => /^https:\/\/s\d+\.anilist\.co\/file\/anilistcdn\/character\//.test(c.img || ''));
    store.set('shinyu-chars', JSON.stringify({ t: Date.now(), v }));
    return v;
  }
  async function showChars() {
    if (charsLoaded) return; charsLoaded = true;
    const box = $('chars'); box.textContent = 'Chargement des personnages…';
    try {
      const list = await loadChars(); box.replaceChildren();
      list.forEach(c => {
        const b = el('button'); b.type = 'button'; b.dataset.a = 'url:' + c.img; b.setAttribute('role', 'radio'); b.setAttribute('aria-label', c.name);
        const i = el('img'); i.src = c.img; i.alt = ''; i.loading = 'lazy'; i.referrerPolicy = 'no-referrer';
        b.append(i, el('span', 'cn', c.name.split(' ')[0]));
        b.onclick = () => { me.avatar = b.dataset.a; me.photo = ''; persistAvatar(); paintAvatarUI(); };
        box.appendChild(b);
      });
      paintAvatarUI();
    } catch { box.textContent = 'Impossible de charger les personnages pour le moment.'; charsLoaded = false; }
  }
  document.querySelectorAll('.tab').forEach(t => {
    t.onclick = () => {
      document.querySelectorAll('.tab').forEach(x => x.setAttribute('aria-selected', String(x === t)));
      $('avatars').hidden = t.dataset.tab !== 'emoji'; $('chars').hidden = t.dataset.tab !== 'chars'; $('photo-box').hidden = t.dataset.tab !== 'photo';
      if (t.dataset.tab === 'chars') showChars();
    };
  });
  function fileToAvatar(file) {
    return new Promise((res, rej) => {
      if (file.size > 15 * 1024 * 1024) return rej(new Error('Image trop lourde'));
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        for (const [size, q] of [[96, .72], [80, .65], [64, .6]]) {
          const c = document.createElement('canvas'); c.width = c.height = size;
          const m = Math.min(img.width, img.height);
          c.getContext('2d').drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, size, size);
          const d = c.toDataURL('image/jpeg', q);
          if (d.length <= 18000) return res(d);
        }
        rej(new Error('Image trop lourde'));
      };
      img.onerror = () => rej(new Error('Image illisible'));
      img.src = url;
    });
  }
  $('photo-pick').onclick = () => $('photo-file').click();
  $('photo-file').onchange = async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try { me.photo = await fileToAvatar(f); persistAvatar(); paintAvatarUI(); toast('Photo enregistrée.'); }
    catch (err) { toast(err.message || 'Image illisible.'); }
    e.target.value = '';
  };
  $('photo-clear').onclick = () => { me.photo = ''; persistAvatar(); paintAvatarUI(); };

  $('nick').value = me.nickname;
  if (params.get('room')) $('code').value = params.get('room').slice(0, 4);
  const profile = () => {
    me.nickname = $('nick').value.trim() || 'Joueur' + Math.floor(Math.random() * 900 + 100);
    $('nick').value = me.nickname; store.set('shinyu-nick', me.nickname);
    return { nickname: me.nickname, avatar: me.avatar, photo: me.photo || undefined };
  };
  paintAvatarUI();

  // ---------- réglages de partie ----------
  function paintSetup() {
    const mc = $('mode-chips'); mc.replaceChildren(); mc.className = 'toggles mode-grid';
    Object.entries(MODES).forEach(([k, [label, desc]]) => {
      const off = k === 'BLIND_TEST' && !blindOK;
      const b = el('button', 'tg'); b.type = 'button'; b.disabled = off;
      b.setAttribute('aria-pressed', String(!off && setup.modes.has(k)));
      b.append(el('span', '', label), el('small', '', off ? 'préparation…' : desc));
      b.onclick = () => {
        if (setup.modes.has(k) && setup.modes.size === 1) return toast('Garde au moins un type de questions.');
        setup.modes.has(k) ? setup.modes.delete(k) : setup.modes.add(k); paintSetup();
      };
      mc.appendChild(b);
    });
    const rc = $('round-chips'); rc.replaceChildren();
    ROUND_CHOICES.forEach(n => {
      const b = el('button', 'tg', n + ' questions'); b.type = 'button'; b.setAttribute('aria-pressed', String(setup.rounds === n));
      b.onclick = () => { setup.rounds = n; paintSetup(); };
      rc.appendChild(b);
    });
    $('room-opts').hidden = setup.solo;
    $('setup-title').textContent = setup.solo ? 'Réglages du solo' : 'Réglages de la salle';
    $('btn-go').textContent = setup.solo ? 'Lancer le solo' : 'Ouvrir la salle';
  }
  const openSetup = (solo) => { setup.solo = solo; paintSetup(); $('setup').hidden = false; $('setup').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  $('btn-solo').onclick = () => openSetup(true);
  $('btn-create').onclick = () => openSetup(false);
  $('btn-setup-close').onclick = () => { $('setup').hidden = true; };

  // ---------- serveur : réglage + diagnostic ----------
  let SERVER = cleanUrl(params.get('server') || store.get('shinyu-server', '') || cfg.SERVER_URL);
  const log = (txt, cls) => { $('srv-log').appendChild(el('li', cls, txt)); };
  async function testServer(url) {
    $('srv-log').replaceChildren(); url = cleanUrl(url);
    if (!/^https?:\/\//i.test(url)) { log('L\'adresse doit commencer par https://', 'ko'); return false; }
    if (location.protocol === 'https:' && url.startsWith('http:')) { log('Adresse en http:// : le navigateur la bloque depuis une page https. Utilise https://', 'ko'); return false; }
    log('Test de ' + url + '/health …');
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
      const r = await fetch(url + '/health', { signal: ctrl.signal, cache: 'no-store' }); clearTimeout(t);
      if (!r.ok) { log(`Le serveur répond avec l'erreur ${r.status}.` + (r.status === 502 || r.status === 404 ? ' Sur Railway : le service ne tourne pas ou le domaine public n\'est pas lié au bon port. Regarde les Logs.' : ''), 'ko'); return false; }
      const j = await r.json().catch(() => null);
      if (!j || !j.ok) { log('Une page répond, mais ce n\'est pas le serveur du quiz (mauvaise adresse ?).', 'ko'); return false; }
      log(`Serveur joignable, protocole v${j.version || 1}, ${j.rooms} salle(s).`, 'ok');
      if ((j.version || 1) < PROTOCOL) { log('Ce serveur est une ancienne version : redéploie le dossier serveur-github.', 'ko'); return false; }
      return true;
    } catch (e) {
      log(e && e.name === 'AbortError' ? 'Pas de réponse au bout de 20 s (serveur endormi ou arrêté).' : 'Impossible de joindre cette adresse (adresse fausse, service arrêté, ou accès refusé par le navigateur).', 'ko');
      return false;
    }
  }
  const openSrv = () => { $('srv-url').value = isPlaceholder(SERVER) ? '' : SERVER; $('srv-log').replaceChildren(); $('srv').hidden = false; $('srv-url').focus(); };
  $('conn').onclick = openSrv;
  $('srv-close').onclick = () => { $('srv').hidden = true; };
  $('srv-test').onclick = () => testServer($('srv-url').value);
  $('srv-save').onclick = async () => {
    const u = cleanUrl($('srv-url').value);
    const ok = await testServer(u);
    if (!ok && !confirm('Le test a échoué. Enregistrer quand même cette adresse ?')) return;
    store.set('shinyu-server', u); location.reload();
  };
  if (isPlaceholder(SERVER)) { setConn('Serveur à configurer', 'chip-off'); openSrv(); log('Aucune adresse de serveur n\'est renseignée.', 'ko'); return; }

  // ---------- connexion ----------
  const socket = io(SERVER, { auth: { pid }, transports: ['websocket', 'polling'], reconnectionDelayMax: 4000 });
  let helloT, gotHello = false, lastErr = 0;
  const slowT = setTimeout(() => toast('Le serveur se réveille, cela peut prendre une minute…'), 4000);
  socket.on('connect', () => {
    clearTimeout(slowT); setConn('En ligne', 'chip-ok'); busy(null); gotHello = false; clearTimeout(helloT);
    helloT = setTimeout(() => { if (!gotHello) { setConn('Serveur obsolète', 'chip-off'); toast('Le serveur utilise une ancienne version. Redéploie le dossier serveur-github.'); } }, 4000);
  });
  socket.on('hello', (d) => {
    gotHello = true; clearTimeout(helloT);
    if ((d.v || 1) < PROTOCOL) { setConn('Serveur obsolète', 'chip-off'); toast('Le serveur doit être mis à jour (serveur-github).'); }
    const was = blindOK; blindOK = !!d.blind;
    if (!blindOK) setup.modes.delete('BLIND_TEST'); else if (!was) setup.modes.add('BLIND_TEST');
    paintSetup();
  });
  socket.on('disconnect', () => setConn('Reconnexion…', 'chip-off'));
  socket.on('connect_error', (err) => {
    setConn('Serveur injoignable', 'chip-off');
    if (Date.now() - lastErr < 20000) return; lastErr = Date.now();
    toast('Connexion impossible. Touche « Serveur injoignable » en haut pour diagnostiquer.');
    console.warn('[quiz] connect_error vers', SERVER, err);
  });
  socket.on('photos', (d) => { Object.assign(photos, d || {}); if (room) { if (!$('s-lobby').hidden) renderLobby(); if (!$('s-game').hidden) renderGamePlayers(); } });

  // ---------- accueil ----------
  $('btn-go').onclick = () => {
    const base = { ...profile(), modes: [...setup.modes].filter(m => m !== 'BLIND_TEST' || blindOK), rounds: setup.rounds };
    soloPending = setup.solo; sfx('go');
    socket.emit('create_room', setup.solo ? { ...base, solo: true } : { ...base, maxPlayers: +$('max-players').value, isPublic: $('is-public').checked });
    $('setup').hidden = true;
  };
  $('join-form').onsubmit = (e) => {
    e.preventDefault();
    const code = $('code').value.trim();
    if (code.length !== 4) return toast('Le code contient 4 chiffres.');
    socket.emit('join_room', { ...profile(), code });
  };
  socket.on('rooms_list', (list) => {
    const ul = $('rooms'); ul.replaceChildren(); $('rooms-empty').hidden = list.length > 0;
    list.forEach(r => {
      const li = el('li');
      li.append(el('span', 'grow', `${r.hostName} · salle ${r.code}`), el('span', 'muted', `${r.playersCount}/${r.maxPlayers}`));
      const b = el('button', 'btn', 'Rejoindre'); b.type = 'button';
      b.onclick = () => socket.emit('join_room', { ...profile(), code: r.code });
      li.append(b); ul.appendChild(li);
    });
  });
  socket.on('leaderboard_data', (list) => {
    const ol = $('board'); ol.replaceChildren(); $('board-empty').hidden = list.length > 0;
    list.forEach((p, i) => {
      const li = el('li');
      li.append(el('span', 'rank-n', String(i + 1)), avatarNode(p.avatar), el('span', 'grow', p.nickname), el('span', 'score', `${p.wins} vict.`));
      ol.appendChild(li);
    });
  });

  // ---------- salon ----------
  const isHost = () => room && room.hostId === pid;
  function renderLobby() {
    if (!room) return;
    $('lobby-code').textContent = room.code;
    $('lobby-count').textContent = `${room.players.length}/${room.maxPlayers}`;
    const tags = $('lobby-tags'); tags.replaceChildren();
    (room.modes || []).forEach(m => tags.appendChild(el('span', '', (MODES[m] || [m])[0])));
    tags.appendChild(el('span', '', (room.rounds || 20) + ' questions'));
    const ul = $('lobby-players'); ul.replaceChildren();
    room.players.forEach(p => {
      const li = el('li', p.connected ? '' : 'off');
      li.append(avatarNode(p.avatar, p.id), el('span', 'grow', p.nickname + (p.id === pid ? ' (toi)' : '')));
      if (p.id === room.hostId) li.append(el('span', 'tag', 'hôte'));
      if (isHost() && p.id !== pid) {
        const t = el('button', 'btn btn-ghost', 'Passer hôte'); t.type = 'button';
        t.onclick = () => socket.emit('transfer_host', { code: room.code, targetId: p.id });
        const k = el('button', 'btn btn-ghost', 'Exclure'); k.type = 'button';
        k.onclick = () => socket.emit('kick_player', { code: room.code, targetId: p.id });
        li.append(t, k);
      }
      ul.appendChild(li);
    });
    const solo = room.maxPlayers === 1;
    $('btn-start').hidden = !isHost(); $('btn-copy').hidden = solo;
    $('lobby-hint').textContent = isHost() ? (solo ? 'Trois vies. Une mauvaise réponse ou un temps écoulé en coûte une.' : 'Lance la partie dès que tout le monde est là.') : 'En attente de l\'hôte…';
  }
  $('btn-start').onclick = () => { $('btn-start').disabled = true; sfx('go'); socket.emit('start_game', room.code); };
  const leave = () => { socket.emit('leave_room'); room = null; round = null; cancelAnimationFrame(timerRaf); stopAudio(); show('s-home'); };
  $('btn-leave').onclick = leave; $('btn-quit').onclick = leave;
  $('btn-back-lobby').onclick = () => {
    if (room && room.maxPlayers === 1) { soloPending = true; $('btn-start').disabled = true; socket.emit('start_game', room.code); }
    else { renderLobby(); show('s-lobby'); }
  };
  $('btn-copy').onclick = async () => {
    const url = `${location.origin}${location.pathname}?room=${room.code}`;
    try { await navigator.clipboard.writeText(url); toast('Lien copié.'); } catch { toast('Code de la salle : ' + room.code); }
  };
  socket.on('room_joined', (d) => {
    const auto = soloPending && d.maxPlayers === 1 && !d.resumed;
    room = d; busy(null); $('btn-start').disabled = false;
    if (auto) { soloPending = false; socket.emit('start_game', d.code); return; }
    soloPending = false;
    if (d.status === 'PLAYING') { show('s-game'); renderGamePlayers(); } else { renderLobby(); show('s-lobby'); }
    if (d.resumed) toast('Tu as retrouvé ta partie.');
  });
  socket.on('room_update', (d) => {
    if (!room) return; room = { ...room, ...d };
    if (!$('s-lobby').hidden) renderLobby();
    if (!$('s-game').hidden) renderGamePlayers();
    if (d.status === 'LOBBY') $('btn-start').disabled = false;
  });
  socket.on('kicked', () => { toast('L\'hôte t\'a exclu de la salle.'); room = null; stopAudio(); show('s-home'); });
  socket.on('force_disconnect', () => { toast('La salle a été fermée (inactivité).'); room = null; stopAudio(); show('s-home'); });
  socket.on('error_msg', (m) => { busy(null); soloPending = false; $('btn-start').disabled = false; toast(m); });
  socket.on('loading', (m) => busy(m));

  // ---------- réactions ----------
  const rb = $('reacts');
  REACTIONS.forEach(e => { const b = el('button', '', e); b.type = 'button'; b.setAttribute('aria-label', 'Réaction ' + e); b.onclick = () => room && socket.emit('reaction', { code: room.code, emoji: e }); rb.appendChild(b); });
  socket.on('reaction', ({ id, emoji }) => {
    const p = room && room.players.find(x => x.id === id);
    const f = el('div', 'float'); f.style.left = (8 + Math.random() * 78) + '%';
    f.append(el('span', '', emoji), el('small', '', p ? p.nickname : ''));
    document.body.appendChild(f); setTimeout(() => f.remove(), 2100);
  });

  // ---------- jeu ----------
  function renderGamePlayers() {
    if (!room) return;
    const ul = $('game-players'); ul.replaceChildren();
    room.players.forEach(p => {
      const li = el('li', (p.hasAnswered ? 'done ' : '') + (p.isAlive ? '' : 'dead'));
      li.append(avatarNode(p.avatar, p.id), document.createTextNode(` ${p.nickname} · ${p.score} · ${hearts(p.lives)}`));
      ul.appendChild(li);
    });
    const mine = room.players.find(p => p.id === pid);
    if (mine) $('lives').textContent = hearts(mine.lives);
    rb.hidden = room.maxPlayers === 1;
  }
  function clearFx() { const i = $('q-img'); i.style.filter = ''; i.style.transform = ''; }
  function runTimer() {
    cancelAnimationFrame(timerRaf);
    const q = round.question, total = q.duration * 1000, bar = $('timer-bar'), img = $('q-img');
    const tick = () => {
      const left = Math.max(0, round.endsAt - (Date.now() + clockOffset));
      const prog = 1 - Math.min(1, left / total);
      bar.style.transform = `scaleX(${1 - prog})`; bar.classList.toggle('low', left < 5000);
      if (q.fx && q.fx.kind === 'blur') img.style.filter = `blur(${(26 * Math.pow(1 - prog, 1.6)).toFixed(1)}px) saturate(${(.6 + .4 * prog).toFixed(2)})`;
      if (q.fx && q.fx.kind === 'zoom') { img.style.transformOrigin = `${q.fx.ox}% ${q.fx.oy}%`; img.style.transform = `scale(${(1 + 5 * Math.pow(1 - prog, 1.4)).toFixed(2)})`; }
      if (left > 0 && round.live) timerRaf = requestAnimationFrame(tick);
    };
    tick();
  }
  const setCombo = () => { const c = $('combo'); c.hidden = streak < 2; c.textContent = 'COMBO ×' + streak; };

  socket.on('new_round', (d) => {
    busy(null); clockOffset = d.serverNow - Date.now();
    round = { ...d, live: true }; picked = null;
    if (!room) return;
    if (d.roundNumber === 1) { streak = 0; setCombo(); }
    room.players = d.players; show('s-game');
    $('round-label').textContent = `Q ${d.roundNumber}/${d.totalRounds}`;
    const q = d.question;
    clearFx();
    const duel = q.images && q.images.length === 2;
    $('q-frame').hidden = !q.image || duel;
    if (q.image && !duel) { $('q-img').referrerPolicy = 'no-referrer'; $('q-img').src = q.image; }
    $('q-duel').hidden = !duel;
    if (duel) { $('d-img1').referrerPolicy = 'no-referrer'; $('d-img2').referrerPolicy = 'no-referrer'; $('d-img1').src = q.images[0]; $('d-img2').src = q.images[1]; }
    $('q-audio').hidden = !q.audio; stopAudio();
    if (q.audio) {
      player.src = q.audio; player.currentTime = 0; player.muted = !soundOn; $('audio-btn').hidden = false;
      const pr = player.play(); if (pr) pr.catch(() => { $('audio-btn').hidden = false; });
    }
    $('q-sub').hidden = !q.subtext; $('q-sub').textContent = q.subtext || '';
    $('q-text').textContent = q.text; $('q-status').textContent = '';
    const box = $('options'); box.replaceChildren();
    q.options.forEach((o, i) => {
      const b = el('button', 'opt'); b.type = 'button'; b.dataset.v = o;
      b.append(el('span', 'l', 'ABCD'[i] || String(i + 1)), el('span', '', o));
      b.onclick = () => {
        if (picked !== null || !round.live) return;
        picked = o; b.classList.add('picked');
        box.querySelectorAll('.opt').forEach(x => { x.disabled = true; });
        socket.emit('submit_answer', { code: room.code, answer: o });
        $('q-status').textContent = 'Réponse envoyée…';
      };
      box.appendChild(b);
    });
    renderGamePlayers(); runTimer();
  });

  socket.on('feedback', (f) => {
    const s = $('q-status');
    if (f.type === 'correct') {
      streak = f.streak || streak + 1; s.textContent = f.bonus ? `Bien joué ! Bonus de série +${f.bonus}` : 'Bien joué !';
      burst('+' + f.points); sfx(streak >= 3 ? 'combo' : 'ok');
    } else {
      streak = 0; shake(); vibrate(f.type === 'eliminated' ? [60, 40, 120] : 50); sfx('bad');
      burst(f.type === 'eliminated' ? 'K.O.' : 'Raté…', true);
      s.textContent = f.type === 'eliminated' ? 'Tu es éliminé, mais tu peux suivre la fin.' : 'Mauvaise réponse, tu perds une vie.';
    }
    setCombo(); $('lives').textContent = hearts(f.lives);
  });

  socket.on('intermission', (d) => {
    if (round) round.live = false;
    cancelAnimationFrame(timerRaf); clearFx(); stopAudio();
    if (room) room.players = d.players;
    $('options').querySelectorAll('.opt').forEach(b => {
      b.disabled = true;
      if (b.dataset.v === d.correctAnswer) b.classList.add('correct');
      else if (b.classList.contains('picked')) b.classList.add('wrong');
    });
    const s = $('q-status');
    if (picked === null) { streak = 0; setCombo(); s.textContent = 'Temps écoulé. Réponse : ' + d.correctAnswer; shake(); sfx('bad'); }
    if (d.reveal) s.textContent += (s.textContent ? '\n' : '') + d.reveal;
    renderGamePlayers();
  });

  function confetti() {
    const colors = ['#ff3d4a', '#ffd43b', '#5ee0ff', '#7be495', '#f6f0e4'];
    for (let i = 0; i < 45; i++) {
      const c = el('i', 'confetti'); c.style.left = Math.random() * 100 + '%'; c.style.background = colors[i % colors.length];
      c.style.animationDelay = Math.random() * 0.8 + 's'; c.style.animationDuration = 2.4 + Math.random() * 1.6 + 's';
      document.body.appendChild(c); setTimeout(() => c.remove(), 4800);
    }
  }
  socket.on('game_over', (d) => {
    if (round) round.live = false;
    cancelAnimationFrame(timerRaf); stopAudio(); clearFx();
    d.players.forEach(p => { if (p.hasPhoto === false) delete photos[p.id]; });
    const solo = d.players.length === 1, won = d.winnerId === pid;
    $('over-kanji').textContent = solo ? '終' : (won ? '勝' : '終');
    $('over-title').textContent = solo ? `Score final : ${d.players[0].score}` : (won ? 'Victoire !' : 'Partie terminée');
    const ol = $('over-list'); ol.replaceChildren();
    d.players.forEach((p, i) => {
      const li = el('li');
      const name = el('span', 'grow', p.nickname + (p.id === pid ? ' (toi)' : ''));
      const stats = el('span', 'sub', `${p.correct || 0}/${p.answered || 0} bonnes réponses · meilleure série ×${p.bestStreak || 0}`);
      name.appendChild(stats);
      li.append(el('span', 'rank-n', String(i + 1)), avatarNode(p.avatar, p.id), name, el('span', 'score', p.score + ' pts'));
      ol.appendChild(li);
    });
    $('btn-back-lobby').textContent = solo ? 'Rejouer' : 'Retour au salon';
    show('s-over');
    if (won || (solo && d.players[0].score >= 800)) { confetti(); sfx('win'); }
  });

  // ---------- clavier : 1-4 ou A-D pour répondre ----------
  document.addEventListener('keydown', (e) => {
    if ($('s-game').hidden || e.ctrlKey || e.metaKey || e.altKey || /input|textarea|select/i.test(e.target.tagName)) return;
    const k = e.key.toLowerCase(); let i = '1234'.indexOf(k); if (i < 0) i = 'abcd'.indexOf(k);
    const b = i >= 0 && $('options').children[i];
    if (b && !b.disabled) b.click();
  });

  show('s-home');
  paintSetup();
})();
