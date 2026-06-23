/* global io */
const socket = io();

// ---- 상태 ----
const state = {
  role: null, // 'host' | 'participant'
  code: null,
  participantId: null,
};

// ---- DOM 헬퍼 ----
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function showView(id) {
  $$('.view').forEach((v) => v.classList.remove('active'));
  $('#' + id).classList.add('active');
}

const genderLabel = { male: '남', female: '여', other: '기타' };
const genderDotClass = (g) => (g === 'male' ? 'male' : g === 'female' ? 'female' : 'other');

// ---- 세션 복원 (새로고침 대비) ----
function saveSession() {
  sessionStorage.setItem('cg', JSON.stringify(state));
}
function clearSession() {
  sessionStorage.removeItem('cg');
}

// ---- 시작 화면 ----
$('#homeBtn').addEventListener('click', () => {
  clearSession();
  state.role = null;
  state.code = null;
  state.participantId = null;
  showView('view-home');
});

$('#goHost').addEventListener('click', () => createRoom());
$('#goJoin').addEventListener('click', () => showView('view-join'));

// ---- 사회자: 방 생성 ----
function createRoom() {
  socket.emit('createRoom', {}, (res) => {
    if (!res || !res.ok) {
      alert('방 생성에 실패했습니다. 다시 시도해 주세요.');
      return;
    }
    state.role = 'host';
    state.code = res.code;
    state.participantId = null;
    saveSession();
    $('#hostCode').textContent = res.code;
    showView('view-host');
  });
}

// ---- 참가자: 입장 ----
$('#joinCode').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
});

$('#doJoin').addEventListener('click', () => {
  const code = $('#joinCode').value.trim();
  const name = $('#joinName').value.trim();
  const genderEl = $('input[name="gender"]:checked');
  const gender = genderEl ? genderEl.value : null;
  const err = $('#joinError');
  err.textContent = '';

  if (!/^\d{4}$/.test(code)) return (err.textContent = '4자리 숫자 비밀번호를 입력해 주세요.');
  if (!name) return (err.textContent = '이름을 입력해 주세요.');
  if (!gender) return (err.textContent = '성별을 선택해 주세요.');

  socket.emit('joinRoom', { code, name, gender }, (res) => {
    if (!res || !res.ok) {
      err.textContent = (res && res.error) || '입장에 실패했습니다.';
      return;
    }
    state.role = 'participant';
    state.code = res.code;
    state.participantId = res.participantId;
    saveSession();
    $('#waitWho').textContent = name + ' · ' + genderLabel[gender];
    showView('view-waiting');
    if (res.groups) renderParticipantGroups(res.groups);
  });
});

// ---- 사회자: 그룹 나누기 ----
$('#doMakeGroups').addEventListener('click', () => {
  const perGroup = Number($('#perGroup').value);
  const err = $('#hostError');
  err.textContent = '';
  socket.emit('makeGroups', { perGroup }, (res) => {
    if (!res || !res.ok) {
      err.textContent = (res && res.error) || '그룹 편성에 실패했습니다.';
      return;
    }
  });
});

$('#doReset').addEventListener('click', () => {
  socket.emit('resetGroups', {}, () => {});
});

// ---- 서버 상태 수신 ----
socket.on('roomState', (data) => {
  if (state.role === 'host') {
    renderHost(data);
  } else if (state.role === 'participant') {
    renderWaiting(data);
  }
});

function renderHost(data) {
  $('#hostCode').textContent = data.code;
  $('#hostTotal').textContent = data.participants.length;
  $('#hostMale').textContent = '남 ' + data.counts.male;
  $('#hostFemale').textContent = '여 ' + data.counts.female;

  const ul = $('#hostPeople');
  ul.innerHTML = '';
  if (data.participants.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '아직 입장한 사람이 없습니다.';
    ul.appendChild(li);
  } else {
    data.participants.forEach((p) => {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'dot ' + genderDotClass(p.gender);
      li.appendChild(dot);
      li.appendChild(document.createTextNode(p.name));
      ul.appendChild(li);
    });
  }

  const groupsEl = $('#hostGroups');
  if (data.groups) {
    renderGroupCards(groupsEl, data.groups, null);
    $('#doReset').hidden = false;
    $('#doMakeGroups').textContent = '다시 랜덤으로 나누기';
  } else {
    groupsEl.innerHTML = '';
    $('#doReset').hidden = true;
    $('#doMakeGroups').textContent = '랜덤으로 그룹 나누기';
  }
}

function renderWaiting(data) {
  $('#waitTotal').textContent = data.participants.length + '명';
  $('#waitMale').textContent = '남 ' + data.counts.male;
  $('#waitFemale').textContent = '여 ' + data.counts.female;
  renderParticipantGroups(data.groups);
}

function renderParticipantGroups(groups) {
  const myGroupCard = $('#myGroupCard');
  const allGroupsCard = $('#allGroupsCard');
  if (!groups) {
    myGroupCard.hidden = true;
    allGroupsCard.hidden = true;
    $('#waitMsg').textContent = '사회자가 그룹을 나눌 때까지 기다려 주세요…';
    return;
  }

  $('#waitMsg').textContent = '그룹이 편성되었습니다!';

  // 내 그룹 찾기
  let myGroupIdx = -1;
  groups.forEach((g, i) => {
    if (g.some((p) => p.id === state.participantId)) myGroupIdx = i;
  });

  if (myGroupIdx >= 0) {
    myGroupCard.hidden = false;
    renderGroupCards($('#myGroup'), [groups[myGroupIdx]], state.participantId, myGroupIdx);
  } else {
    myGroupCard.hidden = true;
  }

  allGroupsCard.hidden = false;
  renderGroupCards($('#allGroups'), groups, state.participantId);
}

function renderGroupCards(container, groups, meId, fixedIndexLabel) {
  container.innerHTML = '';
  groups.forEach((g, i) => {
    const idx = fixedIndexLabel != null ? fixedIndexLabel : i;
    const male = g.filter((p) => p.gender === 'male').length;
    const female = g.filter((p) => p.gender === 'female').length;

    const card = document.createElement('div');
    card.className = 'group';

    const h4 = document.createElement('h4');
    h4.innerHTML =
      `${idx + 1}조 <span class="gcount">${g.length}명 · 남${male} 여${female}</span>`;
    card.appendChild(h4);

    const ul = document.createElement('ul');
    g.forEach((p) => {
      const li = document.createElement('li');
      if (meId && p.id === meId) li.className = 'me';
      const dot = document.createElement('span');
      dot.className = 'dot ' + genderDotClass(p.gender);
      li.appendChild(dot);
      li.appendChild(document.createTextNode(p.name));
      ul.appendChild(li);
    });
    card.appendChild(ul);
    container.appendChild(card);
  });
}

// ---- 새로고침 시 세션 복원 ----
(function restore() {
  const raw = sessionStorage.getItem('cg');
  if (!raw) return;
  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    return;
  }
  if (saved.role === 'host' && saved.code) {
    socket.emit('rejoinHost', { code: saved.code }, (res) => {
      if (res && res.ok) {
        state.role = 'host';
        state.code = res.code;
        $('#hostCode').textContent = res.code;
        showView('view-host');
        renderHost({
          code: res.code,
          participants: res.participants,
          counts: res.counts,
          groups: res.groups,
        });
      } else {
        clearSession();
      }
    });
  }
  // 참가자는 소켓이 끊기면 재입장이 필요하므로 자동 복원하지 않음
})();
