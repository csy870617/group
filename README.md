# ⛪ 교회 소그룹 편성

사회자가 방을 만들면 **4자리 숫자 비밀번호**가 생기고, 참가자들이 그 번호로 입장합니다.
사회자가 "그룹당 몇 명"을 정하면, 입장한 사람들을 **남녀 비율이 최대한 비슷하도록** 랜덤으로 그룹을 나눠 줍니다.

- **정적 사이트(서버 불필요)** + **Firebase Firestore(실시간 DB)** 구성
- **GitHub Pages**로 온라인 배포 가능
- 별도 서버를 운영하지 않아도 여러 사람이 각자 휴대폰/PC로 동시에 접속해 실시간으로 동작합니다
- **여러 교회가 동시에 사용해도 방 번호가 겹치지 않습니다** (트랜잭션으로 코드를 원자적으로 선점)

## 기능

- **사회자**: 방 생성 → 4자리 비밀번호 자동 발급 → 입장 인원/남녀 수 실시간 확인 → 그룹당 인원수 지정 → 랜덤 그룹 편성 (다시 나누기 가능)
- **참가자**: 4자리 비밀번호 + 이름 + 성별 선택으로 입장 → 사회자가 편성하면 내 그룹과 전체 그룹을 실시간 확인
- **남녀 균형 편성**: 남성/여성을 각각 섞은 뒤 라운드로빈으로 배분하여 각 조의 성비와 인원이 고르게 맞춰집니다.

---

## 1. Firebase 설정

이 앱은 데이터 저장과 실시간 동기화를 위해 Firebase Firestore를 사용합니다.

1. [Firebase 콘솔](https://console.firebase.google.com)에서 **프로젝트 생성**
2. **빌드 → Firestore Database → 데이터베이스 만들기** (위치 선택 후 생성)
3. **프로젝트 설정(⚙️) → 내 앱 → 웹 앱(`</>`) 추가** → 표시되는 `firebaseConfig` 값 복사
4. 저장소의 [`firebase-config.js`](./firebase-config.js)를 열어 복사한 값으로 교체:

   ```js
   export const firebaseConfig = {
     apiKey: "...",
     authDomain: "...",
     projectId: "...",
     storageBucket: "...",
     messagingSenderId: "...",
     appId: "...",
   };
   ```

   > `apiKey` 등은 비밀 키가 아니라 공개되어도 안전한 프로젝트 식별자입니다.
   > 실제 보안은 아래 보안 규칙으로 합니다.

5. **보안 규칙 적용**: 콘솔의 **Firestore Database → 규칙** 탭에 이 저장소의
   [`firestore.rules`](./firestore.rules) 내용을 붙여넣고 **게시**합니다.
   (또는 Firebase CLI로 `firebase deploy --only firestore:rules`)

6. (선택) **오래된 방 자동 삭제(TTL)**: 콘솔의 **Firestore Database → TTL**
   에서 컬렉션 그룹 `rooms`, 타임스탬프 필드 `expireAt` 으로 정책을 추가하면,
   생성 후 12시간이 지난 방이 자동 삭제되어 4자리 코드 공간이 재사용됩니다.
   (여러 교회가 장기간 사용해도 코드가 고갈되지 않습니다.)

---

## 2. 로컬에서 실행

정적 파일이라 아무 정적 서버로나 열 수 있습니다 (ES 모듈 때문에 `file://` 직접 열기는 안 됩니다).

```bash
# Python 이 있다면
python3 -m http.server 8000

# 또는 Node 가 있다면
npx serve .
```

브라우저에서 `http://localhost:8000` 접속.

---

## 3. GitHub Pages 배포 (온라인)

이 저장소에는 GitHub Actions 배포 워크플로([`.github/workflows/deploy-pages.yml`](./.github/workflows/deploy-pages.yml))가 포함되어 있습니다.

1. GitHub 저장소 → **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 설정
2. 배포 대상 브랜치(`main` 또는 `claude/epic-carson-1z09cz`)에 푸시하면 자동으로 빌드/배포
3. 완료되면 `https://<사용자명>.github.io/<저장소명>/` 에서 접속 가능

> ⚠️ `firebase-config.js`에 실제 값이 채워진 상태로 푸시해야 배포본이 동작합니다.

---

## 사용 방법

1. 사회자가 **"방 만들기 (사회자)"** 클릭 → 표시된 4자리 비밀번호를 참가자에게 공유
2. 참가자는 같은 주소에서 **"방 입장 (참가자)"** → 비밀번호·이름·성별 입력 후 입장
3. 모두 들어오면 사회자가 **그룹당 인원수**를 정하고 **"랜덤으로 그룹 나누기"** 클릭
4. 참가자 화면에 자동으로 그룹 결과가 표시됩니다

---

## 데이터 구조 (Firestore)

```
rooms/{code}                       // code = 4자리 비밀번호 (트랜잭션으로 고유 선점)
  ├─ code: "1234"
  ├─ perGroup: 4
  ├─ groups: null | [[{id,name,gender}, ...], ...]
  ├─ createdAt: timestamp
  ├─ expireAt: timestamp           // TTL 정책으로 자동 삭제 (코드 재사용)
  └─ participants/{pid}            // 하위 컬렉션
        ├─ name: "홍길동"
        ├─ gender: "male" | "female"
        └─ joinedAt: timestamp
```

## 파일 구조

```
index.html          화면 (시작 / 입장 / 사회자 / 참가자 대기·결과)
style.css           스타일
app.js              앱 로직 + Firestore 실시간 연동 + 그룹 편성 알고리즘
firebase-config.js  Firebase 프로젝트 설정 (본인 값으로 교체)
firestore.rules     Firestore 보안 규칙
.github/workflows/deploy-pages.yml   GitHub Pages 자동 배포
```

## 그룹 편성 알고리즘

`app.js`의 `makeBalancedGroups()`:

1. 전체 인원 ÷ 그룹당 인원으로 그룹 개수를 정합니다.
2. 남성과 여성을 각각 무작위로 섞습니다.
3. 남성을 라운드로빈으로 배정한 뒤, 여성은 남성이 끝난 위치에서 이어 배정해 한 조에 한쪽 성별이 몰리지 않게 합니다.

이렇게 하면 각 조의 인원수와 남녀 비율이 모두 최대한 균등해집니다.
