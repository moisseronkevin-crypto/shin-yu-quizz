(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const cfg = window.SHINYU_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const SERVER = (params.get('server') || cfg.SERVER_URL || '').replace(/\/$/, '');
  const AVATARS = ['🦊','🐱','🐺','🐲','🦉','🐼','🐸','🦁','🐙','🦄','🐧','🤖'];

  // ---------- profil ----------
  const store = {
    get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} }
  };
  let pid = store.get('shinyu-pid', '');
  if (!pid) {
    pid = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
    store.set('shinyu-pid', pid);
  }
  const me = { avatar: store.get('shinyu-avatar', AVATARS[0]), nickname: store.get('shinyu-nick', '') };

  // ---------- état ----------
  let room = null;        // dernier état de salle
  let round = null;       // manche courante
  let picked = null;
  let timerRaf = 0;
  let clockOffset = 0;

  // ---------- UI de base ----------
  const screens = ['s-home', 's-lobby', 's-game', 's-over'];
  const show = (id) => screens.forEach(s => { $(s).hidden = s !== id; });
  let toastT;
  const toast = (msg) => {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3200);
  };
  const busy = (msg) => { $('loading').hidden = !msg; if (msg) $('loading-text').textContent = msg; };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const hearts = (n) => n > 0 ? '♥'.repeat(n) : '✕';

  // avatars
  const av = $('avatars');
  AVATARS.forEach(a => {
    const b = el('button', '', a);
    b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(a === me.avatar));
    b.setAttribute('aria-label', 'Avatar ' + a);
    b.onclick = () => {
      me.avatar = a; store.set('shinyu-avatar', a);
      av.querySelectorAll('button').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    };
    av.appendChild(b);
  });
  $('nick').value = me.nickname;
  if (params.get('room')) $('code').value = params.get('room').slice(0, 4);

  const profile = () => {
    me.nickname = $('nick').value.trim() || 'Joueur' + Math.floor(Math.random() * 900 + 100);
    $('nick').value = me.nickname; store.set('shinyu-nick', me.nickname);
    return { nickname: me.nickname, avatar: me.avatar };
  };

  // ---------- connexion ----------
  if (!SERVER || SERVER.includes('REMPLACE')) {
    $('conn').textContent = 'Serveur non configuré'; $('conn').className = 'chip chip-off';
    toast('Ouvre config.js et renseigne SERVER_URL.');
    return;
  }
  const socket = io(SERVER, { auth: { pid }, transports: ['websocket', 'polling'], reconnectionDelayMax: 4000 });
  const setConn = (txt, cls) => { $('conn').textContent = txt; $('conn').className = 'chip ' + cls; };

  let slowT = setTimeout(() => toast('Le serveur se réveille, cela peut prendre une minute…'), 4000);
  socket.on('connect', () => { clearTimeout(slowT); setConn('En ligne', 'chip-ok'); busy(null); });
  socket.on('disconnect', () => setConn('Reconnexion…', 'chip-off'));
  socket.on('connect_error', () => setConn('Serveur injoignable', 'chip-off'));

  // ---------- accueil ----------
  $('btn-solo').onclick = () => socket.emit('create_room', { ...profile(), solo: true }) ;
  $('btn-create-toggle').onclick = (e) => {
    const box = $('create-box'); box.hidden = !box.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!box.hidden));
  };
  $('btn-create').onclick = () => socket.emit('create_room', {
    ...profile(), maxPlayers: +$('max-players').value, isPublic: $('is-public').checked
  });
  $('join-form').onsubmit = (e) => {
    e.preventDefault();
    const code = $('code').value.trim();
    if (code.length !== 4) return toast('Le code contient 4 chiffres.');
    socket.emit('join_room', { ...profile(), code });
  };

  let soloPending = false;
  $('btn-solo').addEventListener('click', () => { soloPending = true; });

  socket.on('rooms_list', (list) => {
    const ul = $('rooms'); ul.replaceChildren();
    $('rooms-empty').hidden = list.length > 0;
    list.forEach(r => {
      const li = el('li');
      li.append(el('span', 'grow', `${r.hostName} — salle ${r.code}`), el('span', 'muted', `${r.playersCount}/${r.maxPlayers}`));
      const b = el('button', 'btn', 'Rejoindre');
      b.onclick = () => socket.emit('join_room', { ...profile(), code: r.code });
      li.append(b); ul.appendChild(li);
    });
  });

  socket.on('leaderboard_data', (list) => {
    const ol = $('board'); ol.replaceChildren();
    $('board-empty').hidden = list.length > 0;
    list.forEach((p, i) => {
      const li = el('li');
      li.append(el('span', 'rank-n', String(i + 1)), el('span', 'av', p.avatar || '🦊'),
        el('span', 'grow', p.nickname), el('span', 'score', `${p.wins} vict.`));
      ol.appendChild(li);
    });
  });

  // ---------- salon ----------
  const isHost = () => room && room.hostId === pid;

  function renderLobby() {
    if (!room) return;
    $('lobby-code').textContent = room.code;
    $('lobby-count').textContent = `${room.players.length}/${room.maxPlayers}`;
    const ul = $('lobby-players'); ul.replaceChildren();
    room.players.forEach(p => {
      const li = el('li', p.connected ? '' : 'off');
      li.append(el('span', 'av', p.avatar), el('span', 'grow', p.nickname + (p.id === pid ? ' (toi)' : '')));
      if (p.id === room.hostId) li.append(el('span', 'tag', 'hôte'));
      if (isHost() && p.id !== pid) {
        const k = el('button', 'btn btn-ghost', 'Exclure');
        k.onclick = () => socket.emit('kick_player', { code: room.code, targetId: p.id });
        const t = el('button', 'btn btn-ghost', 'Passer hôte');
        t.onclick = () => socket.emit('transfer_host', { code: room.code, targetId: p.id });
        li.append(t, k);
      }
      ul.appendChild(li);
    });
    const solo = room.maxPlayers === 1;
    $('btn-start').hidden = !isHost();
    $('btn-copy').hidden = solo;
    $('lobby-hint').textContent = isHost()
      ? (solo ? 'Trois vies, quarante questions maximum.' : 'Tu peux lancer dès que tout le monde est là.')
      : "En attente de l'hôte…";
  }

  $('btn-start').onclick = () => { $('btn-start').disabled = true; socket.emit('start_game', room.code); };
  $('btn-leave').onclick = leave;
  $('btn-quit').onclick = leave;
  $('btn-back-lobby').onclick = () => { renderLobby(); show('s-lobby'); };
  $('btn-copy').onclick = async () => {
    const url = `${location.origin}${location.pathname}?room=${room.code}`;
    try { await navigator.clipboard.writeText(url); toast('Lien copié.'); }
    catch { toast('Code de la salle : ' + room.code); }
  };
  function leave() { socket.emit('leave_room'); room = null; round = null; cancelAnimationFrame(timerRaf); show('s-home'); }

  socket.on('room_joined', (d) => {
    room = d; soloPending = false; busy(null); $('btn-start').disabled = false;
    if (d.status === 'PLAYING') { show('s-game'); renderGamePlayers(); }
    else { renderLobby(); show('s-lobby'); }
    if (d.resumed) toast('Tu as retrouvé ta partie.');
  });
  socket.on('room_update', (d) => {
    if (!room) return;
    room = { ...room, ...d };
    if (!$('s-lobby').hidden) renderLobby();
    if (!$('s-game').hidden) renderGamePlayers();
    if (d.status === 'LOBBY') $('btn-start').disabled = false;
  });
  socket.on('kicked', () => { toast("L'hôte t'a exclu de la salle."); room = null; show('s-home'); });
  socket.on('force_disconnect', () => { toast('La salle a été fermée (inactivité).'); room = null; show('s-home'); });
  socket.on('error_msg', (m) => { busy(null); toast(m); });
  socket.on('loading', (m) => busy(m));

  // ---------- jeu ----------
  function renderGamePlayers() {
    if (!room) return;
    const ul = $('game-players'); ul.replaceChildren();
    room.players.forEach(p => {
      const li = el('li', (p.hasAnswered ? 'done ' : '') + (p.isAlive ? '' : 'dead'),
        `${p.avatar} ${p.nickname} · ${p.score}`);
      ul.appendChild(li);
    });
    const mine = room.players.find(p => p.id === pid);
    if (mine) $('lives').textContent = hearts(mine.lives);
  }

  function runTimer() {
    cancelAnimationFrame(timerRaf);
    const total = round.question.duration * 1000;
    const tick = () => {
      const left = Math.max(0, round.endsAt - (Date.now() + clockOffset));
      $('timer-bar').style.transform = `scaleX(${Math.min(1, left / total)})`;
      if (left > 0 && round.live) timerRaf = requestAnimationFrame(tick);
    };
    tick();
  }

  socket.on('new_round', (d) => {
    busy(null);
    clockOffset = d.serverNow - Date.now();
    round = { ...d, live: true }; picked = null;
    if (!room) return;
    room.players = d.players;
    show('s-game');
    $('round-label').textContent = `Question ${d.roundNumber} sur ${d.totalRounds}`;
    const q = d.question;
    const img = $('q-img');
    img.hidden = !q.image; if (q.image) img.src = q.image;
    $('q-sub').hidden = !q.subtext; $('q-sub').textContent = q.subtext || '';
    $('q-text').textContent = q.text;
    $('q-status').textContent = '';
    const box = $('options'); box.replaceChildren();
    q.options.forEach(o => {
      const b = el('button', 'opt', o); b.type = 'button';
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
    if (f.type === 'correct') s.textContent = `Bonne réponse, +${f.points} points`;
    else if (f.type === 'eliminated') s.textContent = 'Mauvaise réponse. Tu es éliminé, mais tu peux suivre la fin.';
    else s.textContent = 'Mauvaise réponse, tu perds une vie.';
    $('lives').textContent = hearts(f.lives);
  });

  socket.on('intermission', (d) => {
    if (round) round.live = false;
    cancelAnimationFrame(timerRaf);
    if (room) room.players = d.players;
    $('options').querySelectorAll('.opt').forEach(b => {
      b.disabled = true;
      if (b.textContent === d.correctAnswer) b.classList.add('correct');
      else if (b.classList.contains('picked')) b.classList.add('wrong');
    });
    const s = $('q-status');
    if (picked === null) s.textContent = 'Temps écoulé. Bonne réponse : ' + d.correctAnswer;
    renderGamePlayers();
  });

  socket.on('game_over', (d) => {
    if (round) round.live = false;
    cancelAnimationFrame(timerRaf);
    const won = d.winnerId === pid;
    $('over-title').textContent = d.players.length === 1 ? `Score final : ${d.players[0].score}` : (won ? 'Tu as gagné !' : 'Partie terminée');
    const ol = $('over-list'); ol.replaceChildren();
    d.players.forEach((p, i) => {
      const li = el('li');
      li.append(el('span', 'rank-n', String(i + 1)), el('span', 'av', p.avatar),
        el('span', 'grow', p.nickname + (p.id === pid ? ' (toi)' : '')), el('span', 'score', p.score + ' pts'));
      ol.appendChild(li);
    });
    show('s-over');
  });

  show('s-home');
})();
