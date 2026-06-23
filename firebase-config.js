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
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};
