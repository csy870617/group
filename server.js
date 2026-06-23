const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

/**
 * 방 저장소 (메모리 기반)
 * rooms[code] = {
 *   code: '1234',
 *   hostId: <socket.id>,
 *   participants: { <participantId>: { id, name, gender, socketId } },
 *   groups: null | [ [participant, ...], ... ],
 *   createdAt: <ms>
 * }
 */
const rooms = {};

// ---- 유틸 ----

function generateRoomCode() {
  let code;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000)); // 1000~9999, 항상 4자리
  } while (rooms[code]);
  return code;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 참가자를 그룹당 perGroup 명 기준으로 나누되, 각 그룹의 남녀 비율이
 * 최대한 비슷해지도록 분배한다.
 *
 * 방법: 남성/여성을 따로 섞은 뒤 각각 라운드로빈으로 그룹에 배정.
 * 여성은 시작 그룹 인덱스를 어긋나게 하여(offset) 한쪽 그룹에만
 * 몰리지 않도록 한다.
 */
function makeBalancedGroups(participants, perGroup) {
  const total = participants.length;
  if (total === 0) return [];

  const size = Math.max(1, Math.floor(perGroup));
  const numGroups = Math.max(1, Math.round(total / size));

  const groups = Array.from({ length: numGroups }, () => []);

  const males = shuffle(participants.filter((p) => p.gender === 'male'));
  const females = shuffle(participants.filter((p) => p.gender === 'female'));
  const others = shuffle(
    participants.filter((p) => p.gender !== 'male' && p.gender !== 'female')
  );

  // 남성을 라운드로빈으로 배정
  males.forEach((p, i) => {
    groups[i % numGroups].push(p);
  });

  // 여성은 남성이 끝난 지점에서 이어 배정 (그룹 쏠림 방지)
  const femaleOffset = males.length % numGroups;
  females.forEach((p, i) => {
    groups[(femaleOffset + i) % numGroups].push(p);
  });

  // 기타/미선택 인원은 가장 적은 그룹부터 채워 인원 균형 맞추기
  others.forEach((p) => {
    let minIdx = 0;
    for (let g = 1; g < numGroups; g++) {
      if (groups[g].length < groups[minIdx].length) minIdx = g;
    }
    groups[minIdx].push(p);
  });

  return groups;
}

function publicParticipants(room) {
  return Object.values(room.participants).map((p) => ({
    id: p.id,
    name: p.name,
    gender: p.gender,
  }));
}

function genderCounts(room) {
  const counts = { male: 0, female: 0, other: 0 };
  Object.values(room.participants).forEach((p) => {
    if (p.gender === 'male') counts.male++;
    else if (p.gender === 'female') counts.female++;
    else counts.other++;
  });
  return counts;
}

function broadcastRoomState(code) {
  const room = rooms[code];
  if (!room) return;
  io.to('room:' + code).emit('roomState', {
    code: room.code,
    participants: publicParticipants(room),
    counts: genderCounts(room),
    groups: room.groups,
  });
}

// ---- 소켓 처리 ----

io.on('connection', (socket) => {
  // 사회자: 방 생성
  socket.on('createRoom', (_, ack) => {
    const code = generateRoomCode();
    rooms[code] = {
      code,
      hostId: socket.id,
      participants: {},
      groups: null,
      createdAt: Date.now(),
    };
    socket.join('room:' + code);
    socket.data.role = 'host';
    socket.data.roomCode = code;
    if (typeof ack === 'function') ack({ ok: true, code });
    broadcastRoomState(code);
  });

  // 사회자: 새로고침 등으로 재접속 시 기존 방에 다시 연결
  socket.on('rejoinHost', ({ code }, ack) => {
    const room = rooms[code];
    if (!room) {
      if (typeof ack === 'function') ack({ ok: false, error: '존재하지 않는 방입니다.' });
      return;
    }
    room.hostId = socket.id;
    socket.join('room:' + code);
    socket.data.role = 'host';
    socket.data.roomCode = code;
    if (typeof ack === 'function') {
      ack({
        ok: true,
        code,
        participants: publicParticipants(room),
        counts: genderCounts(room),
        groups: room.groups,
      });
    }
  });

  // 참가자: 방 입장
  socket.on('joinRoom', ({ code, name, gender }, ack) => {
    code = String(code || '').trim();
    name = String(name || '').trim();

    if (!/^\d{4}$/.test(code)) {
      return ack && ack({ ok: false, error: '비밀번호는 4자리 숫자여야 합니다.' });
    }
    const room = rooms[code];
    if (!room) {
      return ack && ack({ ok: false, error: '존재하지 않는 방입니다. 비밀번호를 확인해 주세요.' });
    }
    if (!name) {
      return ack && ack({ ok: false, error: '이름을 입력해 주세요.' });
    }
    if (!['male', 'female'].includes(gender)) {
      return ack && ack({ ok: false, error: '성별을 선택해 주세요.' });
    }

    const participantId = socket.id; // 소켓 단위로 참가자 식별
    room.participants[participantId] = {
      id: participantId,
      name,
      gender,
      socketId: socket.id,
    };
    socket.join('room:' + code);
    socket.data.role = 'participant';
    socket.data.roomCode = code;
    socket.data.participantId = participantId;

    if (typeof ack === 'function') {
      ack({ ok: true, code, participantId, groups: room.groups });
    }
    broadcastRoomState(code);
  });

  // 사회자: 그룹 편성
  socket.on('makeGroups', ({ perGroup }, ack) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) {
      return ack && ack({ ok: false, error: '권한이 없습니다.' });
    }
    const n = Number(perGroup);
    if (!Number.isFinite(n) || n < 1) {
      return ack && ack({ ok: false, error: '그룹당 인원수를 올바르게 입력해 주세요.' });
    }
    const list = Object.values(room.participants);
    if (list.length === 0) {
      return ack && ack({ ok: false, error: '입장한 참가자가 없습니다.' });
    }

    const groups = makeBalancedGroups(list, n).map((g) =>
      g.map((p) => ({ id: p.id, name: p.name, gender: p.gender }))
    );
    room.groups = groups;

    if (typeof ack === 'function') ack({ ok: true, groups });
    broadcastRoomState(code);
  });

  // 사회자: 그룹 편성 초기화 (다시 나누기)
  socket.on('resetGroups', (_, ack) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) {
      return ack && ack({ ok: false, error: '권한이 없습니다.' });
    }
    room.groups = null;
    if (typeof ack === 'function') ack({ ok: true });
    broadcastRoomState(code);
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];

    if (socket.data.role === 'participant') {
      delete room.participants[socket.data.participantId];
      broadcastRoomState(code);
    }
    // 사회자가 나가도 방은 유지 (재접속 가능). 빈 방은 주기적으로 정리.
  });
});

// 오래된 빈 방 정리 (3시간)
setInterval(() => {
  const now = Date.now();
  const TTL = 3 * 60 * 60 * 1000;
  for (const [code, room] of Object.entries(rooms)) {
    if (now - room.createdAt > TTL) delete rooms[code];
  }
}, 30 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`교회 소그룹 편성 서버 실행 중: http://localhost:${PORT}`);
});
