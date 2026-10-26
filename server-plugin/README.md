# CrowdLens Server 0.2.0

이 폴더는 SillyTavern의 `plugins/crowdlens/`에 설치합니다. `package.json`, `index.mjs`, `service.mjs`, `storage.mjs`, `model-bridge.mjs`, `runtime/`이 같은 폴더 안에 있어야 합니다. 별도 npm 설치는 필요 없습니다.

`config.yaml`에서 `enableServerPlugins: true`를 설정하고 SillyTavern을 재시작하세요. 화면용 CrowdLens 확장도 0.2.0 이상으로 업데이트해야 합니다. 기본 실행 위치는 SillyTavern 루트입니다. `enableCorsProxy`는 필요 없습니다.

설정·JEV 키·사회적 프로필·피드는 계정별 `data/<account>/crowdlens/`에 저장됩니다. 키는 브라우저로 다시 내려보내지 않습니다. 파일은 비공개 계정 데이터이며 암호화 파일은 아닙니다.

기존 SillyTavern 연결 프로필을 서버의 `settings.json`에서 읽고, 서버의 기존 Chat Completion/Text Completion 생성 경로를 사용합니다. 연결 프로필의 secret ID를 기존 SillyTavern 키 저장소에서 해석하므로 CrowdLens에 모델 키를 다시 넣지 않습니다. Text Completion은 저장된 지시 템플릿의 역할 구분 시퀀스를 사용합니다.

작업은 제출 직후 서버가 실행합니다. 브라우저 폴링은 진행 상태 조회용이며 계산을 진행시키지 않습니다. 탭을 닫거나 다른 화면으로 이동해도 시작된 작업은 계속되고, 같은 계정·캐릭터·채팅·브랜치로 돌아오면 결과를 불러옵니다. SillyTavern 서버를 종료하면 작업도 중단되며, 재시작 후에는 중단 상태로 표시하고 수동 재생성을 안내합니다. 서버 종료 중이던 모델 요청을 자동 재실행해 이중 과금을 발생시키지 않습니다.

JEV 제공자는 TypeSafe 공홈과 NanoGPT만 지원합니다. NanoGPT는 구독 전용 경로와 Subscription only 설정을 확인합니다. 서버가 공급자 API에 직접 연결합니다.

업데이트는 이 폴더 파일을 새 버전으로 교체한 후 서버를 재시작합니다. `data/<account>/crowdlens/` 데이터 폴더는 교체하거나 지우지 마세요.
