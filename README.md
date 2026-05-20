# 안무 대형 플래너

음악 시간에 맞춰 대형 지점으로 이동하는 모습을 재생하고, 출연자 토큰을 드래그해 대형을 편집하는 React/Vite 웹앱입니다.

## 실행

```bash
npm install
npm run dev
```

브라우저에서 표시된 로컬 주소를 엽니다.

## 사용 흐름

1. 공연명, 공연 타입, 남자/여자 수를 입력해 프로젝트를 만듭니다.
2. 출연자 이름은 하단 출연자 표에서 수정합니다.
3. 왼쪽 대형 지점 목록에서 지점을 선택하거나 추가합니다.
4. 중앙 무대에서 토큰을 드래그해 해당 지점의 도착 대형을 만듭니다.
5. 오른쪽에서 도착 시각, 이동 시간, 메모, 파트너를 설정합니다.
6. 음악 파일을 불러오면 로컬 재생과 함께 Supabase Storage에 즉시 업로드됩니다.
7. 공유 링크, PNG, 인쇄/PDF, JSON 저장 중 필요한 방식으로 팀원에게 공유합니다.

## 대형 지점

- `도착 시각`: 이 대형에 도착해야 하는 음악 시간입니다.
- `이동 시간`: 이전 대형에서 이 대형으로 이동하는 데 걸리는 초 단위 시간입니다.
- 예: 도착 시각이 `20초`, 이동 시간이 `5초`면 `15~20초` 동안 이전 대형에서 현재 대형으로 이동합니다.

## Supabase 설정

`.env` 파일을 만들고 아래 값을 채웁니다.

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Supabase SQL editor에서 테이블과 익명 정책을 만듭니다.

```sql
create table choreo_projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  plan jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table choreo_projects enable row level security;

create policy "allow anonymous insert"
on choreo_projects for insert
to anon
with check (true);

create policy "allow anonymous read"
on choreo_projects for select
to anon
using (true);
```

### 음악 Storage 설정

Supabase Storage에서 public bucket `choreo-audio`를 만듭니다. 음악 파일은 이 bucket에 저장되고 프로젝트 JSON에는 public URL만 저장됩니다.

Storage object 정책도 필요합니다.

```sql
create policy "allow anonymous audio upload"
on storage.objects for insert
to anon
with check (bucket_id = 'choreo-audio');

create policy "allow anonymous audio read"
on storage.objects for select
to anon
using (bucket_id = 'choreo-audio');
```

bucket은 public으로 설정해야 공유 링크에서 음악이 바로 재생됩니다. public URL을 아는 사람은 음악에 접근할 수 있으므로 수업/팀 공유용으로만 사용하세요.

## Vercel 배포

1. GitHub에 올린 뒤 Vercel에서 Import합니다.
2. Framework는 Vite로 자동 인식됩니다.
3. Vercel Project Settings > Environment Variables에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`를 추가합니다.
4. 배포 후 앱에서 `공유 링크`를 누르면 `/share/:id` 보기 전용 링크가 생성됩니다.

## 백업 공유

Supabase 설정이 아직 없거나 저장이 실패해도 아래 방식으로 공유할 수 있습니다.

- `현재 PNG`: 선택 대형 지점 이미지 저장
- `전체 PNG`: 모든 대형 지점을 순서대로 이미지 저장
- `인쇄/PDF`: 브라우저 인쇄에서 PDF로 저장
- `JSON 저장`: 프로젝트 데이터를 파일로 저장하고 나중에 `JSON 열기`로 복원

## 제한

- 음악 파일은 Supabase Storage public bucket에 업로드됩니다. 공유 링크를 아는 사람은 음악 파일에도 접근할 수 있습니다.
- 로그인, 자동 박자 분석, 영상 내보내기, 동시 편집은 포함하지 않았습니다.
