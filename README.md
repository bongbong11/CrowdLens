# CrowdLens 0.3.2

SillyTavern용 독립 커뮤니티 반응 확장입니다. 마법봉 설정과 **가장 최근 RP 응답 아래** 접이식·플랫폼 탭 피드, 두 곳에서 사용합니다. 생성·번역·저장은 전용 서버 플러그인에서 실행하며 화면을 닫아도 제출한 작업은 계속됩니다.

## 설치·업데이트

1. SillyTavern 확장 관리에서 `https://github.com/bongbong11/CrowdLens`를 설치하거나 업데이트합니다.
2. [서버 플러그인 ZIP](https://github.com/bongbong11/CrowdLens/raw/refs/heads/main/downloads/crowdlens-server.zip)을 풀어 `crowdlens` 폴더를 SillyTavern의 `plugins/`에 넣습니다. `plugins/crowdlens/package.json`과 `plugins/crowdlens/prompts/community-reactions.json`이 있어야 합니다.
3. `config.yaml`의 `enableServerPlugins: true`를 켜고 SillyTavern 서버를 재시작합니다. 브라우저도 새로고침합니다. 화면 확장과 서버 플러그인을 함께 업데이트해야 합니다.

SillyTavern 1.18.0 이상을 대상으로 하며 루트 폴더에서 서버를 실행합니다. CORS 프록시나 Scene Reader Hub/Jeved 설치는 필요 없습니다. ZIP에 원본 로어북이 포함되어 있으므로 별도 가져오기가 필요 없습니다. 수동으로 `server-plugin/`만 복사한다면 저장소의 `prompts/community-reactions.json`도 `plugins/crowdlens/prompts/`에 복사해야 합니다.

CMD에서 **SillyTavern 폴더 안에서**, 서버를 끈 뒤 업데이트:

```cmd
curl.exe -fL "https://github.com/bongbong11/CrowdLens/raw/refs/heads/main/downloads/crowdlens-server.zip" -o "%TEMP%\crowdlens-server-update.zip" && powershell -NoProfile -Command "Expand-Archive -LiteralPath (Join-Path $env:TEMP 'crowdlens-server-update.zip') -DestinationPath '.\plugins' -Force"
```

## 생성 방식

마법봉 → CrowdLens 설정 → 사용을 켜고 SillyTavern에 저장한 작성용 연결 프로필을 선택합니다. 선택하지 않으면 서버에 저장된 현재 연결 프로필/연결 설정을 사용합니다. RP 채팅의 연결 설정은 바꾸지 않습니다.

- **직접 체크:** 체크한 커뮤니티만 연결 모델로 작성합니다. **JEV 호출 0회, JEV 키 불필요**입니다. 장면에서 알 수 있는 정보와 반응 집단은 작성 모델이 문맥에 맞춰 판단합니다.
- **자동 선택:** JEV가 장면 공개성·적합한 커뮤니티·반응 가능한 집단을 판정합니다. 가능한 집단의 점수에 가중치를 둔 랜덤 구성으로 반응을 작성합니다. JEV는 공홈 TypeSafe(`jev-latest`)와 NanoGPT(`typesafe/jev-1.14`)만 지원합니다. NanoGPT는 구독 전용 URL을 사용하며 매 판독 전 키의 Billing이 `Subscription only`인지 확인합니다.
- **자동 생성은 없습니다.** 최신 RP 아래의 **이 장면 반응 만들기**를 눌러야 실행합니다. 최신 응답과 앞선 최대 5개 메시지만 사용합니다. 새 RP 응답이 나오면 이전 메시지의 피드는 화면에서 제거하고 최신 응답 아래에 생성 대기 화면을 표시합니다.
- **댓글 양:** 적게 3개 / 중간 6개 / 많이 10개, 커뮤니티당 기준입니다. 선택한 커뮤니티가 많으면 전체 댓글 수와 비용도 늘어납니다.
- **출력 언어:** English 또는 한국어. 한 응답에 영어 초안과 한국어를 두 벌로 출력하지 않습니다. 한국어 모드에서는 플랫폼의 실제 말투·농담·밈·욕설·이모티콘을 보존한 번역체를 지시합니다.
- **영어 피드의 한국어로 번역:** 누른 커뮤니티의 영어 글만 번역합니다. 시트·대화·로어북을 다시 보내지 않습니다. 번역을 저장해 원문/번역을 전환하며 재조회·재접속으로 재번역하지 않습니다. 원문을 새로 생성하면 새 원문에 맞는 번역이 필요합니다.
- **공통 음지 커뮤니티 모드:** 한 번 체크하면 선택한 커뮤니티 전체에 적용합니다. 거친 성격의 비중이 높아지고 가상의 관리자 삭제 표시가 나오지 않습니다. 일반 모드에서는 모델이 드물게 삭제된 댓글을 표현할 수 있습니다. 욕설을 순화하는 사후 치환 필터는 없습니다.

최대 출력은 기본 8,192, 설정 범위는 8,000~32,768입니다. 최대 한도는 실제 사용량이 아닙니다. Gemini 등의 내부 추론도 공급자의 출력 한도에 포함될 수 있습니다. 출력 한도 초과·잘못된 JSON은 오류로 표시하며 유료 요청을 자동으로 반복하지 않습니다. 댓글 양/커뮤니티 수를 줄이거나 한도를 조정할 수 있습니다.

## 원본 로어북·편집·중복 방지

[원본 JSON](prompts/community-reactions.json)은 사용자가 제공한 `커뮤반응모음.json`과 **바이트 단위로 동일**합니다. 원본 파일의 SMS 항목도 삭제하지 않았으며, **실행 시 선택지에서만 SMS를 제외**합니다. 공통 User Archetypes와 Twitch, Reddit, Twitter/X, Discord, YouTube, AO3, Instagram, TikTok, 4chan 9개를 읽습니다.

원본 SHA-256: `14d6b10ab4927d403ecaadd707f609d321dd321372325bf596eb38cd78e7f1a6`

0.3.2 서버는 이전 기본 예시 설정을 `migration/original-prompts-backup.json`에 백업한 후 원본으로 한 번 복구합니다. 이후 사용자가 저장한 편집 내용은 재접속해도 유지합니다. 원본 로어북 파일 자체를 변경하지 않습니다. 원본이 빠진 설치에서는 짧은 예시로 대신 생성하지 않고 설치 오류를 표시합니다.

설정 → **프롬프트**에서 각 커뮤니티의 **플랫폼 프롬프트**와 **공통 프롬프트**를 전부 확인하고 수정할 수 있습니다. 본문을 요약하거나 자르지 않으며 글자 수를 표시합니다. 편집 후 **이 커뮤니티 저장**을 누르면 다음 생성부터 적용됩니다. 여러 JSON을 가져오면 기존 목록에 합치고 같은 플랫폼 ID는 새 파일 내용으로 갱신합니다.

실제 생성 입력에는 원문 텍스트별 `instructions` 목록을 한 번만 만들고, 각 플랫폼은 `promptRef`/`sharedPromptRef`로 참조합니다. 같은 공통 본문이 플랫폼 수만큼 중복 주입되지 않습니다. 원본 9개를 모두 사용할 때 공통 본문 3,655자의 8회 중복, **29,240자**를 방지합니다. 이는 입력 문자 수 비교이며 실제 모델 토큰 절약량을 뜻하지 않습니다.

원문 지침은 그대로 전달하고, 짧은 별도 공통 지시는 JSON 구조·출력 언어·현재 장면·샘플 성격을 지정합니다. 원문의 예시 인물/과거 사건을 현재 RP의 사실로 만들거나 장기 계정 기억으로 사용하지 않습니다. 반응은 텍스트로 렌더링하며 외부 커뮤니티에 실제 게시하지 않습니다.

## 사회적 프로필·성격·브랜치

최초 수동 생성 때 연결 모델이 캐릭터 설명/성격과 유저 페르소나를 읽어 **영어** 사회적 프로필을 작성·저장합니다. 직업·인지도·대외평판·지인 관점·공개정보를 짧게 기록합니다. 기존 한글 프로필은 다음 수동 생성 때 영문으로 다시 판독하며, 시트가 같으면 영문 프로필을 재사용합니다. 시트·페르소나·원본 채팅은 수정하지 않습니다.

시트 읽기 우선순위는 Scene Reader Hub와 같이 `character.data || character`, 페르소나는 현재 문맥 설명 → 현재 아바타 저장 항목 → 전역 설명입니다. 시나리오·노트·예시 대화·로어북을 시트로 임의 추가하지 않습니다.

기본 브랜치 하나에서 시작하고 **＋ 추가**를 누를 때만 이름 입력창을 엽니다. 목록으로 전환하며 캐릭터·페르소나·브랜치별 프로필, 채팅·브랜치별 피드를 분리합니다.

기질 10 × 감정 8 × 말하는 방식 6 × 거친 표현 5 × 버릇 6 = **14,400가지** 성격 조합을 짧은 영어 문장으로 조립합니다. 문화권과 반응 집단은 별도로 정하며 한 플랫폼 안에 미국·유럽·동아시아 맥락의 다양한 개인을 섞습니다. 플랫폼 하나를 특정 지역으로 고정하지 않습니다. 거친 트롤·천박한 드립·악의적인 뒷말 등도 성격 조합에 포함합니다. 닉네임으로 인종을 추정하거나 인종 때문에 성격을 정하지 않습니다.

## 서버 저장·모바일

계정별 `data/<account>/crowdlens/`에 설정, JEV 키, 캐릭터/브랜치 프로필, 채팅/브랜치 피드, 작업 상태를 별도 파일로 저장합니다. 키는 브라우저에 반환하지 않습니다. 파일 변경은 순서대로 임시 파일 기록·동기화·교체를 거치고 오래된 탭의 설정 덮어쓰기를 거부합니다.

작업은 제출 당시 장면 사본으로 서버에서 실행합니다. 화면/탭을 닫아도 완료·저장하고 재접속하면 복원합니다. 제한 시간은 5분이며 명시적 취소 버튼이 있습니다. 서버 자체가 재시작되면 중단 상태로 표시하고 자동 유료 재실행은 하지 않습니다. 중복 생성/번역 제출은 진행 중 작업을 재사용합니다. 장기 여론·계정 기억은 없습니다.

설정에는 세로 스크롤과 구역 바로가기가 있고, 모바일 입력·가로형 버튼·가로로 넘기는 플랫폼 탭을 지원합니다. 화면 탭 ID는 `crypto.randomUUID`에 의존하지 않습니다. Tailscale IP/일반 HTTP 주소에서도 이 보안 컨텍스트 제한 때문에 피드가 사라지는 오류가 발생하지 않도록 했습니다.

## 검수

`npm test` 42개 통과: 원문 본문/공통 문자열 일치, 공통 1회 주입, 직접 체크 JEV 0회·키 없음, TypeSafe/NanoGPT 요청·구독 확인, 영어 프로필 재사용, 분량·언어·공통 음지, 번역 중복/캐시, 저장/이전/격리/취소/재시작, ST 연결 프로필·Vertex 인증·Text Completion 경로를 확인합니다.

별도 브라우저 모의 연동은 실제 임시 HTTP 서버와 네이티브 ST 라우터 모형을 사용했습니다. localhost가 아닌 **비보안 HTTP 원점**에서 `crypto.randomUUID`가 없는 상태, 원문 9개 편집창, JEV 없는 직접 생성, 영어/한국어 전환, 3/6/10개 댓글, 선택 번역과 캐시, 탭 닫기 후 서버 완료·복원, 최신 RP만 표시, 320px/390px 모바일 스크롤·버튼, 여러 파일 가져오기를 확인했습니다. 설치 ZIP을 독립 폴더에 풀어 원본 해시와 서버 수동 생성도 확인했습니다.

실제 Tailscale 네트워크 접속 권한/공유 설정과 실제 유료 공급자 키로 새 모델 응답을 호출하는 시험은 하지 않았습니다. 제공된 Vertex 로그는 출력 한도 도달을 확인하는 근거이며, 수정 후 말투 품질이나 실제 토큰 사용량을 측정한 로그는 아닙니다. 새 유료 실응답을 확인하기 전까지 결과 품질·비용 절감량을 보장하지 않습니다.

대조한 소스: [Scene Reader JEV 모델](https://github.com/bongbong11/Scene_Reader_Hub/blob/main/src/adapters/jev-connection.js), [NanoGPT 구독 경로](https://github.com/bongbong11/Scene_Reader_Hub/blob/main/server-plugin/nanogpt-jev.cjs), [SillyTavern 연결 프로필](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/extensions/connection-manager/index.js), [생성 서버](https://github.com/SillyTavern/SillyTavern/blob/release/src/endpoints/backends/chat-completions.js), [Vertex 인증](https://github.com/SillyTavern/SillyTavern/blob/release/src/endpoints/google.js). 확인일: 2026-10-27.
