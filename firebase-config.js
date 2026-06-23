// ─────────────────────────────────────────────────────────────
// Firebase 프로젝트 설정
//
// 1) https://console.firebase.google.com 에서 프로젝트를 만듭니다.
// 2) "빌드 > Firestore Database"에서 데이터베이스를 생성합니다.
// 3) 프로젝트 설정(⚙️) > "내 앱 > 웹 앱(</>)"을 추가하면 아래와 같은
//    구성 값을 받을 수 있습니다. 그 값으로 아래를 교체하세요.
//
// ⚠️ 여기 있는 apiKey 등은 비밀 키가 아니라 "프로젝트 식별자"입니다.
//    공개되어도 안전하며, 실제 보안은 firestore.rules 로 합니다.
// ─────────────────────────────────────────────────────────────

export const firebaseConfig = {
  apiKey: "AIzaSyBEsA3QUn6KP-kBAlwo5GhuBIdpSOSXMy8",
  authDomain: "group-45a58.firebaseapp.com",
  databaseURL: "https://group-45a58-default-rtdb.firebaseio.com",
  projectId: "group-45a58",
  storageBucket: "group-45a58.firebasestorage.app",
  messagingSenderId: "869842756215",
  appId: "1:869842756215:web:4a58143695cfa1706f9c72",
};
