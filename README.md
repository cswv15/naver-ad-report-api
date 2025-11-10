# 네이버 광고 월간 보고서 자동화 API

네이버 광고 API를 활용하여 월간 보고서 데이터를 자동으로 가져오는 Vercel 서버입니다.

## 배포 방법

### 1. Vercel CLI 설치
```bash
npm install -g vercel
```

### 2. 프로젝트 배포
```bash
cd naver-ad-report-api
vercel login
vercel --prod
```

### 3. 배포 완료 후 URL 확인
배포가 완료되면 다음과 같은 URL을 받습니다:
```
https://your-project-name.vercel.app
```

## API 사용법

### 엔드포인트: `/api/get-campaign-stats`

**요청 방법:** POST

**요청 Body (JSON):**
```json
{
  "customerId": "네이버 광고 고객 ID",
  "secretKey": "네이버 API Secret Key",
  "year": "2024",
  "month": "10"
}
```

**응답 예시:**
```json
{
  "success": true,
  "period": {
    "year": "2024",
    "month": "10",
    "startDate": "2024-10-01",
    "endDate": "2024-10-31"
  },
  "campaigns": [
    {
      "campaignId": "ncc_123456",
      "campaignName": "플레이스광고",
      "cost": 823314,
      "clicks": 1587,
      "impressions": 45000,
      "ctr": 3.52,
      "cpc": 519
    }
  ],
  "totalCost": 1100657,
  "totalClicks": 3071
}
```

## Bubble.io 연동 방법

### 1. API Connector 설정
- Plugins → API Connector → Add Another API
- API Name: `NaverAdReportAPI`

### 2. Call 추가
- Name: `GetCampaignStats`
- Use as: Action
- Data type: JSON
- Method: POST
- URL: `https://your-vercel-url.vercel.app/api/get-campaign-stats`

### 3. Body 설정 (JSON)
```json
{
  "customerId": "<customerId>",
  "secretKey": "<secretKey>",
  "year": "<year>",
  "month": "<month>"
}
```

### 4. Initialize Call
- customerId: 테스트용 고객 ID 입력
- secretKey: 테스트용 Secret Key 입력
- year: 2024
- month: 10

## 주의사항

1. **네이버 광고 API 인증키 관리**
   - Secret Key는 절대 클라이언트에 노출하지 마세요
   - Bubble의 Privacy Rules로 보호하세요

2. **API 호출 제한**
   - 네이버 광고 API는 호출 제한이 있을 수 있습니다
   - 필요시 캐싱 로직 추가를 고려하세요

3. **데이터 검증**
   - API 응답 데이터를 Bubble에서 저장하기 전 검증하세요

## 문제 해결

### API 응답이 없을 때
1. Vercel 로그 확인: `vercel logs`
2. 네이버 광고 API 인증 정보 확인
3. CORS 에러 확인

### 배포 실패 시
1. `package.json` 확인
2. `vercel.json` 설정 확인
3. Node.js 버전 확인 (18.x 권장)
