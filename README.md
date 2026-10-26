# CrowdLens

SillyTavern용 독립 커뮤니티 반응 확장. 연결 모델이 캐릭터·페르소나 사회적 프로필과 반응을 작성하고, JEV가 최신 장면의 공개 가능성·플랫폼·참여 집단을 판정합니다. Jeved 설치에 의존하지 않습니다.

## 설치

SillyTavern 1.18.0 이상 → 확장 설치 → `https://github.com/bongbong11/CrowdLens` 입력 → 새로고침.

로컬 설치는 이 폴더 전체를 `public/scripts/extensions/third-party/CrowdLens`에 복사합니다. 빌드나 추가 패키지는 필요 없습니다.

## 사용

1. 마법봉 메뉴 → **CrowdLens 설정**을 엽니다.
2. JEV 공홈(TypeSafe), NanoGPT, OpenRouter 중 제공자를 선택하고 해당 키를 입력합니다. 제공자별 키는 현재 브라우저 탭 메모리에만 따로 보관하며 새로고침 시 다시 입력합니다.
3. 공홈과 NanoGPT는 SillyTavern의 `config.yaml`에서 `enableCorsProxy: true`가 필요합니다. SillyTavern 프록시는 basicAuth와 함께 쓸 수 없습니다. NanoGPT는 씬판독기와 같은 구독 전용 경로를 사용하며 키의 Billing이 `Subscription only`인지 매 요청마다 확인합니다.
4. 프로필·반응 작성용 연결 프로필을 고르거나 현재 SillyTavern 모델 연결을 사용하고 **사용**을 켭니다. 선택한 프로필은 씬판독기와 같은 `ConnectionManagerRequestService`로 요청하며 채팅의 연결 설정을 바꾸지 않습니다. 모델 최대 출력은 기본 **8,192**, 설정 범위는 **8,000~32,768** 토큰입니다. 연결 모델 자체의 지원 범위도 충족해야 합니다.
5. RP 응답 아래 접이식 피드에서 **이 장면 반응 생성**을 누릅니다. **새 RP 응답에서 자동 생성**을 켜면 이후 응답부터 실행합니다. 과거 메시지를 일괄 자동 생성하지 않습니다.

UI 진입점은 마법봉 설정과 RP 메시지 아래 피드 두 곳입니다. 설정 창에는 프로필 확인·다시 판독, 브랜치, 제공자, 토큰 한도, 프롬프트 가져오기, 피드 삭제가 모여 있습니다.

## 프로필과 장면

- 첫 반응 생성 때 연결 모델이 캐릭터 시트의 설명·성격과 현재 유저 페르소나를 읽어 짧은 프로필을 만듭니다. 시트 읽기 순서는 씬판독기의 `importCurrentSheet`와 같습니다. 캐릭터는 `character.data || character`, 페르소나는 문맥의 페르소나 설명 → 현재 아바타의 저장 항목 → 전역 페르소나 설명 순서입니다. 시나리오·노트·예시 대화·로어북은 자동으로 섞지 않습니다. 직업·인지도·대외평판·지인 관점·공개정보를 캐릭터와 유저 각각 저장합니다.
- 저장 위치는 `extension_settings.crowdlens`입니다. 캐릭터 아바타 식별자·브랜치·페르소나별로 분리합니다. 시트나 페르소나가 달라지면 다시 판독합니다. 시트·채팅 파일·캐릭터 카드 확장 필드는 수정하지 않습니다.
- 기본 브랜치는 `main`입니다. 다른 이름을 쓰면 별도 프로필과 피드로 분리되고 기존 브랜치로 돌아갈 수 있습니다. 채팅 분기는 SillyTavern의 채팅 ID로 구별합니다.
- JEV에는 짧은 프로필, 최신 RP 응답, 앞선 최대 5개 메시지를 보냅니다. 최신 장면만 판정하고 과거 메시지는 맥락으로 사용합니다. 비공개 장면에 공인이라는 이유만으로 대중 반응을 붙이지 않습니다.
- 적합한 플랫폼과 가능한 집단을 판정한 후 상황 점수에 가중치를 둔 랜덤으로 플랫폼별 8개 반응의 집단 구성·비율을 정합니다. 일반인은 지인·동료 중심으로 판단하고 실제 근거 없는 팬덤·언론 관심은 만들지 않도록 지시합니다.
- 결과는 최대 최근 80개 장면을 확장 설정에 저장합니다. 채팅·스와이프·응답 수정·브랜치·페르소나·시트·플랫폼 구성별로 구별합니다. 과거 피드는 모델에게 다시 보내지 않습니다. 장기 여론·계정 기억은 없습니다.
- 채팅 전환·수정·스와이프·새 메시지·설정 변경은 진행 결과를 무효화합니다. JEV 요청은 취소되며, 이미 시작한 연결 모델의 `generateRaw` 요청은 완료될 수 있지만 변경된 장면에 저장하지 않습니다. 전체 작업 제한은 5분입니다.

## 포함된 프롬프트

로컬 설치 번들에는 사용자 제공 `커뮤반응모음.json`을 `prompts/community-reactions.json`에 원문 그대로 포함했습니다. 공개 GitHub 저장소에는 원문 공개 승인 전까지 이 파일을 포함하지 않습니다. GitHub로 설치하면 기본 예시 4개가 제공되며 설정의 JSON 가져오기로 원본을 넣을 수 있습니다.

Twitch, Reddit, Twitter/X, Discord, YouTube, AO3, Instagram, TikTok, SMS, 4chan의 10개 프롬프트와 공통 User Archetypes를 읽습니다. 각 플랫폼에 맞는 가벼운 CSS 스타일로 렌더링합니다. 사진·영상·외부 링크를 실제로 생성하거나 소셜 서비스에 게시하지 않습니다. 좋아요·답글 표시는 장식입니다.

원본의 백틱/헤더 규칙은 UI의 JSON 구조와 탭으로 대체하며, 장기 사용자 기억 규칙과 예시 전용 인물·과거 사건은 현재 RP의 사실로 만들지 않도록 생성 지시를 적용합니다. 커뮤니티 말투·성격 다양성은 활용합니다. 가져온 텍스트와 생성 결과는 코드로 실행하지 않으며 결과는 `textContent`로 표시합니다.

설정에서 다른 JSON을 가져올 수 있습니다. SillyTavern 로어북 `entries`, 플랫폼 배열, `{ "platforms": [...] }`, 이름→프롬프트 문자열 객체를 지원합니다. 정규 배열 예시:

```json
{"platforms":[{"id":"forum","name":"커뮤니티","style":"board","prompt":"플랫폼별 말투와 형식 지침"}]}
```

공통 항목은 별도 플랫폼으로 노출하지 않습니다. 제공자 키는 프롬프트에 포함하지 않습니다.

## 검증

`npm test`와 `npm run check`를 실행합니다. 추가 패키지는 필요 없습니다.

로컬 원본 포함 상태에서 18개 자동 테스트로 프롬프트 변환·플랫폼 수·JEV 3개 제공자 요청 형식·NanoGPT 구독 전용 확인·씬판독기와 같은 시트 읽기 순서·연결 프로필 요청·잘못된 응답 차단·비공개 장면·가중 랜덤·프로필 재사용·브랜치/수정 구분·원본 불변·출력 토큰 하한·취소를 확인했습니다. 원본 없는 공개 코드에서는 해당 파일 검증 1개를 건너뜁니다. 별도 브라우저 모의 환경에서 설정·키 분리·피드 생성·탭 키보드 이동·모바일 너비·HTML 이스케이프·수정 시 캐시 무효화를 검증했습니다.

실제 SillyTavern 인스턴스와 유료 모델/API 키를 사용한 실연동 시험은 아직 하지 않았습니다. API의 성공 응답은 코드와 모의 응답으로 검증했으며 실제 서비스 가용성이나 계정 권한을 확인한 것은 아닙니다. 판정 모델의 공개성·집단 추론은 완벽하지 않을 수 있어 수동 모드가 기본입니다. 현재 지원 범위는 1:1 캐릭터 채팅입니다.

## 검증한 API 근거

- [SillyTavern 확장 개발 문서](https://docs.sillytavern.app/for-contributors/writing-extensions/)
- [SillyTavern getContext 구현](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/st-context.js): `extensionSettings`, `generateRaw`, `powerUserSettings`, 이벤트, 팝업 API
- [SillyTavern generateRaw 구현](https://github.com/SillyTavern/SillyTavern/blob/release/public/script.js): 객체 인자, `systemPrompt`, `prompt`, `responseLength`, `trimNames`
- [ST-jeved classifier.js](https://github.com/mossyfield/ST-jeved/blob/fec4a2d7edc3471d6860d438a7e4133b55d47c2d/src/classifier.js): TypeSafe·NanoGPT·OpenRouter 경로와 모델 ID
- [ST-jeved sensor-types.js](https://github.com/mossyfield/ST-jeved/blob/fec4a2d7edc3471d6860d438a7e4133b55d47c2d/src/sensor-types.js): `state`, `questions`, `type: noul`, `instructions`, `answers[id].noul` 형식
- [Scene Reader Hub 시트 가져오기](https://github.com/bongbong11/Scene_Reader_Hub/blob/main/src/ui/forms/bind.js): 캐릭터·페르소나 읽기 우선순위
- [Scene Reader Hub NanoGPT](https://github.com/bongbong11/Scene_Reader_Hub/blob/main/server-plugin/nanogpt-jev.cjs): 구독 전용 확인과 `response_format: questions` 요청
- [Scene Reader Hub 모델 선택](https://github.com/bongbong11/Scene_Reader_Hub/blob/main/src/adapters/jev-connection.js): 공홈 `jev-latest`, NanoGPT `typesafe/jev-1.14`

확인일: 2026-10-26. 독립 구현이며 Jeved·Scene Reader Hub 설치 및 내부 전역에 의존하지 않습니다. CrowdLens 자체 서버 플러그인은 필요 없습니다.
