import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// ─────────────────────────────────────────────────────────────
// DOM 헬퍼
// ─────────────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// 서브 화면(입장/사회자/대기)에 들어가면 history 항목을 하나 쌓아,
// 브라우저 뒤로 가기 시 페이지가 닫히지 않고 홈으로 돌아오게 한다.
// 새로고침 시에도 브라우저가 유지하는 history.state 를 확인해, 이미
// 서브 화면에 대해 push된 상태라면 다시 push하지 않는다. (그렇지 않으면
// 서브 화면에서 새로고침을 반복할 때마다 history 항목이 계속 쌓여
// 뒤로 가기를 여러 번 눌러야 홈으로 나가지는 문제가 생긴다.)
let navPushed = !!(history.state && history.state.sub);
const SUB_VIEWS = ["view-join", "view-host", "view-waiting"];

function showView(id) {
  $$(".view").forEach((v) => v.classList.remove("active"));
  $("#" + id).classList.add("active");
  if (SUB_VIEWS.includes(id) && !navPushed) {
    history.pushState({ sub: true }, "");
    navPushed = true;
  }
}

const genderLabel = { male: "남", female: "여", other: "기타" };
const genderDotClass = (g) => (g === "male" ? "male" : g === "female" ? "female" : "other");

// ─────────────────────────────────────────────────────────────
// Firebase 초기화 (설정이 비어 있으면 안내 화면)
// ─────────────────────────────────────────────────────────────
let db = null;
if (!firebaseConfig.apiKey || firebaseConfig.apiKey === "YOUR_API_KEY") {
  showView("view-setup");
} else {
  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    showView("view-home");
  } catch (e) {
    // 초기화 실패 시 빈 화면 대신 기존 설정 안내 화면으로 대체
    console.error("Firebase 초기화 실패:", e);
    showView("view-setup");
  }
}

// ─────────────────────────────────────────────────────────────
// 상태 & 리스너 정리
// ─────────────────────────────────────────────────────────────
const state = {
  role: null, // 'host' | 'participant'
  code: null,
  participantId: null,
  participants: [], // [{id, name, gender}]
  groups: null,
};

let unsubRoom = null;
let unsubParticipants = null;

function teardownListeners() {
  if (unsubRoom) unsubRoom();
  if (unsubParticipants) unsubParticipants();
  unsubRoom = null;
  unsubParticipants = null;
}

// ─────────────────────────────────────────────────────────────
// 세션 저장 (새로고침 대비)
// ─────────────────────────────────────────────────────────────
function saveSession() {
  sessionStorage.setItem(
    "cg",
    JSON.stringify({ role: state.role, code: state.code, participantId: state.participantId })
  );
}
function clearSession() {
  sessionStorage.removeItem("cg");
}

// ─────────────────────────────────────────────────────────────
// 그룹 편성 알고리즘 (남녀 비율을 맞춰 랜덤 분배)
// ─────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeBalancedGroups(participants, perGroup) {
  const total = participants.length;
  if (total === 0) return [];

  const size = Math.max(1, Math.floor(perGroup));
  // 그룹당 인원수로 나눈 나머지는 "반올림"으로 처리한다.
  //  - 나머지가 그룹 정원의 절반 이상이면 → 조 하나를 더 만들고
  //  - 절반 미만이면 → 기존 조들에 고르게 나눠 넣는다.
  // 예) 10명·4명/조 → round(2.5)=3개 조(4·3·3),  9명·4명/조 → round(2.25)=2개 조(5·4)
  const numGroups = Math.max(1, Math.round(total / size));
  const groups = Array.from({ length: numGroups }, () => []);

  const males = shuffle(participants.filter((p) => p.gender === "male"));
  const females = shuffle(participants.filter((p) => p.gender === "female"));
  const others = shuffle(
    participants.filter((p) => p.gender !== "male" && p.gender !== "female")
  );

  // 남성을 라운드로빈으로 배정
  males.forEach((p, i) => groups[i % numGroups].push(p));

  // 여성은 남성이 끝난 위치에서 이어 배정 (한쪽 성별 쏠림 방지)
  const femaleOffset = males.length % numGroups;
  females.forEach((p, i) => groups[(femaleOffset + i) % numGroups].push(p));

  // 기타/미선택 인원은 가장 적은 그룹부터 채움
  others.forEach((p) => {
    let minIdx = 0;
    for (let g = 1; g < numGroups; g++) {
      if (groups[g].length < groups[minIdx].length) minIdx = g;
    }
    groups[minIdx].push(p);
  });

  return groups.map((g) => g.map((p) => ({ id: p.id, name: p.name, gender: p.gender })));
}

// Firestore 는 "배열 안의 배열"(중첩 배열)을 지원하지 않으므로, 각 조를
// { members: [...] } 맵으로 감싸 "맵의 배열"로 저장한다. 아래 두 함수로
// 저장용/화면용 형태를 변환한다.
function groupsForStore(groups) {
  return groups.map((members) => ({ members }));
}
function groupsFromStore(raw) {
  if (!raw) return null;
  // 구버전(중첩 배열)과 신버전({members}) 모두 안전하게 처리
  return raw.map((g) => (Array.isArray(g) ? g : g.members || []));
}

// ─────────────────────────────────────────────────────────────
// 공통: 방 구독 시작 (사회자/참가자 공용)
// ─────────────────────────────────────────────────────────────
// 실시간 리스너 오류(권한·네트워크 등) 안내
function showConnectionError(e) {
  console.error("Firestore 리스너 오류:", e);
  const msg = "연결 오류가 발생했습니다. 새로고침 해 주세요.";
  if (state.role === "host") $("#hostError").textContent = msg;
  else if (state.role === "participant") $("#waitMsg").textContent = msg;
}

function subscribeRoom(code) {
  teardownListeners();
  const roomRef = doc(db, "rooms", code);

  unsubRoom = onSnapshot(
    roomRef,
    (snap) => {
      if (!snap.exists()) {
        // 방이 사라짐 (사회자가 종료)
        if (state.role === "participant") {
          alert("방이 종료되었습니다.");
        }
        goHomeNav();
        return;
      }
      const data = snap.data();
      state.groups = groupsFromStore(data.groups);
      // 호스트가 입력칸을 조작 중일 때는 스냅샷이 값을 덮어쓰지 않는다
      const pg = $("#perGroup");
      if (typeof data.perGroup === "number" && document.activeElement !== pg) {
        pg.value = data.perGroup;
      }
      render();
    },
    showConnectionError
  );

  unsubParticipants = onSnapshot(
    collection(db, "rooms", code, "participants"),
    (snap) => {
      const list = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
      // joinedAt 은 serverTimestamp() 라서 서버 확인 전까지 로컬에서는 null.
      // 0 으로 취급하면 방금 입장한 사람이 순간적으로 맨 앞으로 정렬되었다가
      // 서버 확인 후 다시 뒤로 이동하는 깜빡임이 생기므로, 아직 확인되지
      // 않은 값은 "가장 최근"으로 보고 맨 뒤로 정렬한다.
      list.sort((a, b) => (a.joinedAt?.seconds ?? Infinity) - (b.joinedAt?.seconds ?? Infinity));
      state.participants = list;
      render();
    },
    showConnectionError
  );
}

function counts() {
  const c = { male: 0, female: 0, other: 0 };
  state.participants.forEach((p) => {
    if (p.gender === "male") c.male++;
    else if (p.gender === "female") c.female++;
    else c.other++;
  });
  return c;
}

// ─────────────────────────────────────────────────────────────
// 렌더링
// ─────────────────────────────────────────────────────────────
function render() {
  if (state.role === "host") renderHost();
  else if (state.role === "participant") renderWaiting();
}

function renderHost() {
  const c = counts();
  $("#hostCode").textContent = state.code;
  $("#hostTotal").textContent = state.participants.length;
  $("#hostMale").textContent = "남 " + c.male;
  $("#hostFemale").textContent = "여 " + c.female;

  const ul = $("#hostPeople");
  ul.innerHTML = "";
  if (state.participants.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "아직 입장한 사람이 없습니다.";
    ul.appendChild(li);
  } else {
    state.participants.forEach((p) => {
      const li = document.createElement("li");
      const dot = document.createElement("span");
      dot.className = "dot " + genderDotClass(p.gender);
      li.appendChild(dot);
      li.appendChild(document.createTextNode(p.name));
      ul.appendChild(li);
    });
  }

  const groupsEl = $("#hostGroups");
  if (state.groups) {
    renderGroupCards(groupsEl, state.groups, null);
    $("#doMakeGroups").textContent = "다시 그룹 나누기";
  } else {
    groupsEl.innerHTML = "";
    $("#doMakeGroups").textContent = "그룹 나누기";
  }
}

function renderWaiting() {
  const c = counts();
  $("#waitTotal").textContent = state.participants.length + "명";
  $("#waitMale").textContent = "남 " + c.male;
  $("#waitFemale").textContent = "여 " + c.female;

  const myGroupCard = $("#myGroupCard");
  const allGroupsCard = $("#allGroupsCard");
  if (!state.groups) {
    myGroupCard.hidden = true;
    allGroupsCard.hidden = true;
    $("#waitMsg").textContent = "사회자가 그룹을 나눌 때까지 기다려 주세요…";
    return;
  }

  $("#waitMsg").textContent = "그룹이 편성되었습니다!";

  let myGroupIdx = -1;
  state.groups.forEach((g, i) => {
    if (g.some((p) => p.id === state.participantId)) myGroupIdx = i;
  });

  if (myGroupIdx >= 0) {
    myGroupCard.hidden = false;
    renderGroupCards($("#myGroup"), [state.groups[myGroupIdx]], state.participantId, myGroupIdx);
  } else {
    myGroupCard.hidden = true;
  }

  allGroupsCard.hidden = false;
  renderGroupCards($("#allGroups"), state.groups, state.participantId);
}

function renderGroupCards(container, groups, meId, fixedIndexLabel) {
  container.innerHTML = "";
  groups.forEach((g, i) => {
    const idx = fixedIndexLabel != null ? fixedIndexLabel : i;
    const male = g.filter((p) => p.gender === "male").length;
    const female = g.filter((p) => p.gender === "female").length;

    const card = document.createElement("div");
    card.className = "group";

    const h4 = document.createElement("h4");
    h4.innerHTML = `${idx + 1}조 <span class="gcount">${g.length}명 · 남${male} 여${female}</span>`;
    card.appendChild(h4);

    const ul = document.createElement("ul");
    g.forEach((p) => {
      const li = document.createElement("li");
      if (meId && p.id === meId) li.className = "me";
      const dot = document.createElement("span");
      dot.className = "dot " + genderDotClass(p.gender);
      li.appendChild(dot);
      li.appendChild(document.createTextNode(p.name));
      ul.appendChild(li);
    });
    card.appendChild(ul);
    container.appendChild(card);
  });
}

// ─────────────────────────────────────────────────────────────
// 액션
// ─────────────────────────────────────────────────────────────
function goHome() {
  teardownListeners();
  clearSession();
  state.role = null;
  state.code = null;
  state.participantId = null;
  state.participants = [];
  state.groups = null;
  showView("view-home");
}

// 홈으로 이동: 뒤로 가기 history 항목이 쌓여 있으면 history.back()으로
// 소비하여 popstate 핸들러가 처리하게 하고, 없으면 바로 홈으로 간다.
function goHomeNav() {
  if (navPushed) history.back();
  else goHome();
}

// 브라우저 뒤로 가기 → 페이지를 닫지 않고 홈 화면으로
window.addEventListener("popstate", () => {
  if (navPushed) {
    navPushed = false;
    goHome();
  }
});

// 방 유지 시간 (이 시간이 지나면 Firestore TTL 로 자동 삭제되어 코드가 재사용됨)
const ROOM_TTL_HOURS = 12;

async function createRoom() {
  $("#goHost").disabled = true;
  try {
    // 여러 교회가 "동시에" 방을 만들어도 코드가 겹치지 않도록
    // 트랜잭션으로 원자적으로 생성한다. 후보 코드가 이미 있으면
    // 다른 코드로 다시 시도한다.
    let code = null;
    for (let tries = 0; tries < 30; tries++) {
      const candidate = String(Math.floor(1000 + Math.random() * 9000)); // 항상 4자리
      const ref = doc(db, "rooms", candidate);
      try {
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(ref);
          if (snap.exists()) {
            const err = new Error("CODE_TAKEN");
            err.code = "CODE_TAKEN";
            throw err;
          }
          tx.set(ref, {
            code: candidate,
            groups: null,
            perGroup: 4,
            createdAt: serverTimestamp(),
            expireAt: Timestamp.fromMillis(Date.now() + ROOM_TTL_HOURS * 3600 * 1000),
          });
        });
        code = candidate; // 트랜잭션 성공 = 이 코드를 선점함
        break;
      } catch (e) {
        if (e && e.code === "CODE_TAKEN") continue; // 다른 코드로 재시도
        throw e; // 그 외 오류는 그대로 전달
      }
    }
    if (!code) throw new Error("사용 가능한 방 번호를 찾지 못했습니다. 잠시 후 다시 시도해 주세요.");

    // 코드 재사용 시, 이전 모임의 참가자 문서가 하위 컬렉션에 남아 있을 수 있다.
    // (Firestore 는 문서를 지워도 하위 컬렉션을 지우지 않음) → 새 방을 위해 정리한다.
    try {
      const stale = await getDocs(collection(db, "rooms", code, "participants"));
      await Promise.all(stale.docs.map((d) => deleteDoc(d.ref)));
    } catch (e) {
      console.warn("이전 참가자 정리 실패(무시하고 진행):", e);
    }

    state.role = "host";
    state.code = code;
    state.participantId = null;
    saveSession();
    $("#hostCode").textContent = code;
    showView("view-host");
    subscribeRoom(code);
  } catch (e) {
    alert("방 생성 실패: " + (e.message || e));
  } finally {
    $("#goHost").disabled = false;
  }
}

async function joinRoom() {
  const code = $("#joinCode").value.trim();
  const name = $("#joinName").value.trim();
  const genderEl = $('input[name="gender"]:checked');
  const gender = genderEl ? genderEl.value : null;
  const err = $("#joinError");
  err.textContent = "";

  if (!/^\d{4}$/.test(code)) return (err.textContent = "4자리 숫자 비밀번호를 입력해 주세요.");
  if (!name) return (err.textContent = "이름을 입력해 주세요.");
  if (!gender) return (err.textContent = "성별을 선택해 주세요.");

  $("#doJoin").disabled = true;
  try {
    const roomSnap = await getDoc(doc(db, "rooms", code));
    if (!roomSnap.exists()) {
      err.textContent = "존재하지 않는 방입니다. 비밀번호를 확인해 주세요.";
      return;
    }

    const pid =
      (crypto.randomUUID && crypto.randomUUID()) ||
      "p" + Date.now() + Math.random().toString(36).slice(2);

    await setDoc(doc(db, "rooms", code, "participants", pid), {
      name,
      gender,
      joinedAt: serverTimestamp(),
    });

    state.role = "participant";
    state.code = code;
    state.participantId = pid;
    saveSession();
    $("#waitWho").textContent = name + " · " + genderLabel[gender];
    showView("view-waiting");
    subscribeRoom(code);
  } catch (e) {
    err.textContent = "입장 실패: " + (e.message || e);
  } finally {
    $("#doJoin").disabled = false;
  }
}

async function makeGroups() {
  const perGroup = parseInt($("#perGroup").value, 10);
  const err = $("#hostError");
  err.textContent = "";
  if (!Number.isInteger(perGroup) || perGroup < 1) {
    return (err.textContent = "그룹당 인원수를 올바르게 입력해 주세요.");
  }
  if (state.participants.length === 0) {
    return (err.textContent = "입장한 참가자가 없습니다.");
  }

  const btn = $("#doMakeGroups");
  btn.disabled = true;
  try {
    const groups = makeBalancedGroups(state.participants, perGroup);
    await updateDoc(doc(db, "rooms", state.code), { groups: groupsForStore(groups), perGroup });
  } catch (e) {
    err.textContent = "그룹 편성 실패: " + (e.message || e);
  } finally {
    btn.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────
// 이벤트 바인딩
// ─────────────────────────────────────────────────────────────
function leaveToHome() {
  if (db) goHomeNav();
}
$("#homeBtn").addEventListener("click", leaveToHome);
$("#hostClose").addEventListener("click", leaveToHome);
$("#joinClose").addEventListener("click", leaveToHome);
$("#waitClose").addEventListener("click", leaveToHome);
$("#goHost").addEventListener("click", createRoom);
$("#goJoin").addEventListener("click", () => showView("view-join"));

// 그룹당 인원수 증감 스테퍼
function stepPerGroup(delta) {
  const input = $("#perGroup");
  const cur = parseInt(input.value, 10);
  input.value = Math.max(1, (Number.isFinite(cur) ? cur : 1) + delta);
}
$("#perGroupMinus").addEventListener("click", () => stepPerGroup(-1));
$("#perGroupPlus").addEventListener("click", () => stepPerGroup(1));

// 초대하기 — 기기 기본 공유(Web Share API), 미지원 시 링크 복사로 폴백
const INVITE_URL = "https://csy870617.github.io/group/";
async function invite() {
  const text = state.code
    ? `교회 소그룹 편성에 참여하세요!\n방 비밀번호: ${state.code}\n입장하기 후 비밀번호를 입력하세요.`
    : "교회 소그룹 편성에 참여하세요!";
  try {
    if (navigator.share) {
      await navigator.share({ title: "교회 소그룹 편성", text, url: INVITE_URL });
      return;
    }
  } catch (e) {
    if (e && e.name === "AbortError") return; // 사용자가 공유를 취소함
  }
  // 공유 API 미지원 → 클립보드 복사, 그것도 안 되면 새 창으로 링크 열기
  try {
    await navigator.clipboard.writeText(`${text}\n${INVITE_URL}`);
    alert("초대 내용이 복사되었습니다.\n" + INVITE_URL);
  } catch {
    window.open(INVITE_URL, "_blank", "noopener");
  }
}
$("#goInvite").addEventListener("click", invite);
$("#goInviteHost").addEventListener("click", invite);
$("#doJoin").addEventListener("click", joinRoom);
$("#doMakeGroups").addEventListener("click", makeGroups);

$("#joinCode").addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4);
});

// ─────────────────────────────────────────────────────────────
// 새로고침 시 세션 복원
// ─────────────────────────────────────────────────────────────
(async function restore() {
  if (!db) return;
  const raw = sessionStorage.getItem("cg");
  if (!raw) return;
  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    return;
  }
  if (!saved.code) return;

  try {
    const snap = await getDoc(doc(db, "rooms", saved.code));
    if (!snap.exists()) {
      clearSession();
      return;
    }

    if (saved.role === "host") {
      state.role = "host";
      state.code = saved.code;
      $("#hostCode").textContent = saved.code;
      showView("view-host");
      subscribeRoom(saved.code);
    } else if (saved.role === "participant" && saved.participantId) {
      // 참가자 문서가 아직 있는지 확인
      const pSnap = await getDoc(
        doc(db, "rooms", saved.code, "participants", saved.participantId)
      );
      if (!pSnap.exists()) {
        clearSession();
        return;
      }
      const me = pSnap.data();
      state.role = "participant";
      state.code = saved.code;
      state.participantId = saved.participantId;
      $("#waitWho").textContent = me.name + " · " + (genderLabel[me.gender] || "");
      showView("view-waiting");
      subscribeRoom(saved.code);
    } else {
      // 역할/식별자가 불완전한 깨진 세션 → 정리
      clearSession();
    }
  } catch (e) {
    console.error("세션 복원 실패:", e);
  }
})();
