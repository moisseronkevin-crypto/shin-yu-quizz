(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const cfg = window.SHINYU_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const AVATARS = ['🦊','🐱','🐺','🐲','🦉','🐼','🐸','🦁','🐙','🦄','🐧','🤖'];
  const MODES = { GUESS_ANIME: 'Affiches', GUESS_CHARACTER: 'Personnages', GUESS_SYNOPSIS: 'Synopsis', TRIVIA: 'Culture manga' };
  const ROUND_CHOICES = [10, 20, 40];
  const PROTOCOL = 2;

  const store = {
    get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* indisponible */ } }
  };
  const cleanUrl = (u) => String(u || '').trim().replace(/\/+$/, '');
  const isPlaceholder = (u) => !u || /REMPLACE/i.test(u);

  // ---------- profil ----------
  let pid = store.get('shinyu-pid', '');
  if (!pid) {
    pid = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
    store.set('shinyu-pid', pid);
  }
  const me = { avatar: store.get('shinyu-avatar', AVATARS[0]), nickname: store.get('shinyu-nick', '') };

  // ---------- état ----------
  let room = null, round = null, picked = null, timerRaf = 0, clockOffset = 0, streak = 0;
  let setup = { solo: true, modes: new Set(Object.keys(MODES)), rounds: 20 };
  let soloPending = false;

  // ---------- helpers UI ----------
  const screens = ['s-home', 's-lobby', 's-game', 's-over'];
  const show = (id) => screens.forEach(s => { $(s).hidden = s !== id; });
  let toastT;
  const toast = (msg) => { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3800); };
  const busy = (msg) => { $('loading').hidden = !msg; if (msg) $('loading-text').textContent = msg; };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const hearts = (n) => n > 0 ? '♥'.repeat(n) : '✕';
  const setConn = (txt, cls) => { $('conn').textContent = txt; $('conn').className = 'chip ' + cls; };
  const burst = (text, bad) => {
    const s = el('span', bad ? 'bad' : '', text); $('fx').appendChild(s);
    setTimeout(() => s.remove(), 1200);
  };
  const shake = () => { const g = $('s-game'); g.classList.remove('shake'); void g.offsetWidth; g.classList.add('shake'); };

  // ---------- avatars / pseudo ----------
  AVATARS.forEach(a => {
    const b = el('button', '', a); b.type = 'button';
    b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(a === me.avatar)); b.setAttribute('aria-label', 'Avatar ' + a);
    b.onclick = () => {
      me.avatar = a; store.set('shinyu-avatar', a);
      $('avatars').querySelectorAll('button').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    };
    $('avatars').appendChild(b);
  });
  $('nick').value = me.nickname;
  if (params.get('room')) $('code').value = params.get('room').slice(0, 4);
  const profile = () => {
    me.nickname = $('nick').value.trim() || 'Joueur' + Math.floor(Math.random() * 900 + 100);
    $('nick').value = me.nickname; store.set('shinyu-nick', me.nickname);
    return { nickname: me.nickname, avatar: me.avatar };
  };

  // ---------- réglages de partie ----------
  function paintSetup() {
    const mc = $('mode-chips'); mc.replaceChildren();
    Object.entries(MODES).forEach(([k, label]) => {
      const b = el('button', 'tg', label); b.type = 'button'; b.setAttribute('aria-pressed', String(setup.modes.has(k)));
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
  const log = (txt, cls) => { const li = el('li', cls, txt); $('srv-log').appendChild(li); };

  async function testServer(url) {
    $('srv-log').replaceChildren();
    url = cleanUrl(url);
    if (!/^https?:\/\//i.test(url)) { log('L\'adresse doit commencer par https://', 'ko'); return false; }
    if (location.protocol === 'https:' && url.startsWith('http:')) { log('Adresse en http:// : le navigateur la bloque depuis une page https. Utilise https://', 'ko'); return false; }
    log('Test de ' + url + '/health …');
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
      const r = await fetch(url + '/health', { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(t);
      if (!r.ok) {
        log(`Le serveur répond avec l'erreur ${r.status}.` + (r.status === 502 || r.status === 404 ? ' Sur Railway, cela veut dire que le service ne tourne pas ou que l\'adresse publique n\'est pas liée au bon port. Regarde les Logs du service.' : ''), 'ko');
        return false;
      }
      const j = await r.json().catch(() => null);
      if (!j || !j.ok) { log('Une page répond, mais ce n\'est pas le serveur du quiz (mauvaise adresse ?).', 'ko'); return false; }
      log(`Serveur joignable, protocole v${j.version || 1}, ${j.rooms} salle(s).`, 'ok');
      if ((j.version || 1) < PROTOCOL) { log('Ce serveur est une ancienne version : redéploie le dossier serveur-github.', 'ko'); return false; }
      return true;
    } catch (e) {
      log(e && e.name === 'AbortError'
        ? 'Pas de réponse au bout de 20 s (serveur endormi ou arrêté).'
        : 'Impossible de joindre cette adresse (adresse fausse, service arrêté, ou accès refusé par le navigateur).', 'ko');
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

  if (isPlaceholder(SERVER)) {
    setConn('Serveur à configurer', 'chip-off');
    openSrv(); log('Aucune adresse de serveur n\'est renseignée.', 'ko');
    return; // le reste n'a de sens qu'avec un serveur
  }

  // ---------- connexion ----------
  const socket = io(SERVER, { auth: { pid }, transports: ['websocket', 'polling'], reconnectionDelayMax: 4000 });
  let helloT, gotHello = false, lastErr = 0;
  const slowT = setTimeout(() => toast('Le serveur se réveille, cela peut prendre une minute…'), 4000);

  socket.on('connect', () => {
    clearTimeout(slowT); setConn('En ligne', 'chip-ok'); busy(null);
    gotHello = false; clearTimeout(helloT);
    helloT = setTimeout(() => {
      if (!gotHello) { setConn('Serveur obsolète', 'chip-off'); toast('Le serveur utilise une ancienne version. Redéploie le dossier serveur-github.'); }
    }, 4000);
  });
  socket.on('hello', (d) => { gotHello = true; clearTimeout(helloT); if ((d.v || 1) < PROTOCOL) setConn('Serveur obsolète', 'chip-off'); });
  socket.on('disconnect', () => setConn('Reconnexion…', 'chip-off'));
  socket.on('connect_error', (err) => {
    setConn('Serveur injoignable', 'chip-off');
    if (Date.now() - lastErr < 20000) return;
    lastErr = Date.now();
    toast('Connexion impossible. Touche « Serveur injoignable » en haut pour diagnostiquer.');
    console.warn('[quiz] connect_error vers', SERVER, err);
  });

  // ---------- accueil ----------
  $('btn-go').onclick = () => {
    const base = { ...profile(), modes: [...setup.modes], rounds: setup.rounds };
    soloPending = setup.solo;
    socket.emit('create_room', setup.solo ? { ...base, solo: true }
      : { ...base, maxPlayers: +$('max-players').value, isPublic: $('is-public').checked });
    $('setup').hidden = true;
  };
  $('join-form').onsubmit = (e) => {
    e.preventDefault();
    const code = $('code').value.trim();
    if (code.length !== 4) return toast('Le code contient 4 chiffres.');
    socket.emit('join_room', { ...profile(), code });
  };

  socket.on('rooms_list', (list) => {
    const ul = $('rooms'); ul.replaceChildren();
    $('rooms-empty').hidden = list.length > 0;
    list.forEach(r => {
      const li = el('li');
      li.append(el('span', 'grow', `${r.hostName} · salle ${r.code}`), el('span', 'muted', `${r.playersCount}/${r.maxPlayers}`));
      const b = el('button', 'btn', 'Rejoindre'); b.type = 'button';
      b.onclick = () => socket.emit('join_room', { ...profile(), code: r.code });
      li.append(b); ul.appendChild(li);
    });
  });
  socket.on('leaderboard_data', (list) => {
    const ol = $('board'); ol.replaceChildren();
    $('board-empty').hidden = list.length > 0;
    list.forEach((p, i) => {
      const li = el('li');
      li.append(el('span', 'rank-n', String(i + 1)), el('span', 'av', p.avatar || '🦊'), el('span', 'grow', p.nickname), el('span', 'score', `${p.wins} vict.`));
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
    (room.modes || []).forEach(m => tags.appendChild(el('span', '', MODES[m] || m)));
    tags.appendChild(el('span', '', (room.rounds || 20) + ' questions'));
    const ul = $('lobby-players'); ul.replaceChildren();
    room.players.forEach(p => {
      const li = el('li', p.connected ? '' : 'off');
      li.append(el('span', 'av', p.avatar), el('span', 'grow', p.nickname + (p.id === pid ? ' (toi)' : '')));
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
  $('btn-start').onclick = () => { $('btn-start').disabled = true; socket.emit('start_game', room.code); };
  const leave = () => { socket.emit('leave_room'); room = null; round = null; cancelAnimationFrame(timerRaf); show('s-home'); };
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
    if (!room) return;
    room = { ...room, ...d };
    if (!$('s-lobby').hidden) renderLobby();
    if (!$('s-game').hidden) renderGamePlayers();
    if (d.status === 'LOBBY') $('btn-start').disabled = false;
  });
  socket.on('kicked', () => { toast('L\'hôte t\'a exclu de la salle.'); room = null; show('s-home'); });
  socket.on('force_disconnect', () => { toast('La salle a été fermée (inactivité).'); room = null; show('s-home'); });
  socket.on('error_msg', (m) => { busy(null); soloPending = false; $('btn-start').disabled = false; toast(m); });
  socket.on('loading', (m) => busy(m));

  // ---------- jeu ----------
  function renderGamePlayers() {
    if (!room) return;
    const ul = $('game-players'); ul.replaceChildren();
    room.players.forEach(p => ul.appendChild(el('li', (p.hasAnswered ? 'done ' : '') + (p.isAlive ? '' : 'dead'), `${p.avatar} ${p.nickname} · ${p.score} · ${hearts(p.lives)}`)));
    const mine = room.players.find(p => p.id === pid);
    if (mine) $('lives').textContent = hearts(mine.lives);
  }
  function runTimer() {
    cancelAnimationFrame(timerRaf);
    const total = round.question.duration * 1000, bar = $('timer-bar');
    const tick = () => {
      const left = Math.max(0, round.endsAt - (Date.now() + clockOffset));
      bar.style.transform = `scaleX(${Math.min(1, left / total)})`;
      bar.classList.toggle('low', left < 5000);
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
    $('q-frame').hidden = !q.image; if (q.image) { $('q-img').referrerPolicy = 'no-referrer'; $('q-img').src = q.image; }
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
    if (f.type === 'correct') { streak++; s.textContent = 'Bien joué !'; burst('+' + f.points); }
    else { streak = 0; shake(); burst(f.type === 'eliminated' ? 'K.O.' : 'Raté…', true); s.textContent = f.type === 'eliminated' ? 'Tu es éliminé, mais tu peux suivre la fin.' : 'Mauvaise réponse, tu perds une vie.'; }
    setCombo(); $('lives').textContent = hearts(f.lives);
  });

  socket.on('intermission', (d) => {
    if (round) round.live = false;
    cancelAnimationFrame(timerRaf);
    if (room) room.players = d.players;
    $('options').querySelectorAll('.opt').forEach(b => {
      b.disabled = true;
      if (b.dataset.v === d.correctAnswer) b.classList.add('correct');
      else if (b.classList.contains('picked')) b.classList.add('wrong');
    });
    if (picked === null) { streak = 0; setCombo(); $('q-status').textContent = 'Temps écoulé. Réponse : ' + d.correctAnswer; shake(); }
    renderGamePlayers();
  });

  socket.on('game_over', (d) => {
    if (round) round.live = false;
    cancelAnimationFrame(timerRaf);
    const solo = d.players.length === 1, won = d.winnerId === pid;
    $('over-kanji').textContent = solo ? '終' : (won ? '勝' : '終');
    $('over-title').textContent = solo ? `Score final : ${d.players[0].score}` : (won ? 'Victoire !' : 'Partie terminée');
    const ol = $('over-list'); ol.replaceChildren();
    d.players.forEach((p, i) => {
      const li = el('li');
      li.append(el('span', 'rank-n', String(i + 1)), el('span', 'av', p.avatar), el('span', 'grow', p.nickname + (p.id === pid ? ' (toi)' : '')), el('span', 'score', p.score + ' pts'));
      ol.appendChild(li);
    });
    $('btn-back-lobby').textContent = solo ? 'Rejouer' : 'Retour au salon';
    show('s-over');
  });

  show('s-home');
  paintSetup();
})();
