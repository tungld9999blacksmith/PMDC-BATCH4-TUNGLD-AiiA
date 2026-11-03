# 07 — Ma trận truy vết (Traceability)

Mỗi user story được nối với chức năng ([02](02-features.md)), use case ([03](03-use-cases.md)), tiêu chí chấp nhận ([06](06-acceptance-criteria.md)), quy tắc nghiệp vụ ([business-rules](requirements/business-rules.md)), trang ([04](04-information-architecture.md)) và operation trong [openapi.yaml](api/openapi.yaml). Dùng ma trận này để kiểm tra không có yêu cầu nào thiếu màn hình, API hoặc tiêu chí kiểm thử.

## 1. Ma trận

| US | Chức năng | UC | AC | BR | Trang | Operation (`operationId`) |
| --- | --- | --- | --- | --- | --- | --- |
| US01 | F1.1 | UC01 | AC01.1–2 | — | P01 | `getMe` |
| US02 | F1.2 | UC02 | AC02.1 | — | P03 | `logout` |
| US03 | F1.3 | UC03 | AC03.1–2 | BR08 | P03 | `getMe`, `listMyGrants` |
| US04 | F2.1 | UC04 | AC04.1–2 | BR01 | P13, P14 | `createSource`, `updateSource`, `testSourceConnection` |
| US05 | F2.2 | UC05 | AC05.1–3 | BR02 | P14 | `uploadSourceFile`, `triggerRun` |
| US06 | F2.5 | UC06 | AC06.1–2 | — | P14 | `setSourceSchedule` |
| US07 | F2.6 | UC07 | AC07.1–2 | BR14 | P15 | `listRuns`, `getRun`, `streamRunLogs`, `rerunRun` |
| US08 | F2.7 | UC08 | AC08.1–2 | — | P14 | `listMappings`, `createMappingVersion`, `previewMapping` |
| US09 | F2.8 | UC09 | AC09.1–2 | BR07, BR10 | P16 | `previewDataset` |
| US10 | F3.1 | UC10 | AC10.1–3 | BR05 | P21 | `listMatchCandidates`, `decideMatchCandidate`, `getMergeHistory`, `unmerge` |
| US11 | F3.3 | UC11 | AC11.1–2 | BR08 | P05 | `searchProfiles` |
| US12 | F3.4, F3.10 | UC12 | AC12.1–2 | BR07, BR10 | P06 | `getProfile`, `getProfileFacet` |
| US13 | F3.5 | UC13 | AC13.1 | BR12 | P06 | `getProfile`, `getProfileFacet` |
| US14 | F3.6, F3.7 | UC14 | AC14.1–2 | BR06, BR10 | P06 | `getProfile`, `getProfileFacet` |
| US15 | F3.8 | UC15 | AC15.1–2 | — | P06 | `getProfileTimeline` |
| US16 | F3.9 | UC16 | AC16.1–2 | BR04 | P06 | `getAttributeProvenance` |
| US17 | F4.1, F4.2 | UC17 | AC17.1–2 | — | P19 | `listDqRules`, `createDqRule`, `updateDqRule`, `dryRunDqRule` |
| US18 | F4.3 | UC18 | AC18.1–2 | BR03 | P15, P20 | `getRun` (thực thi trong Dagster) |
| US19 | F4.4 | UC19 | AC19.1 | — | P20 | `getDqScores` |
| US20 | F4.5 | UC20 | AC20.1–2 | — | P20 | `listDqIssues`, `updateDqIssue`, `addDqIssueComment`, `rerunRun` |
| US21 | F5.1 | UC21 | AC21.1 | — | P17, P18 | `searchDatasets`, `getDataset`, `listGlossaryTerms` |
| US22 | F5.2 | UC22 | AC22.1–2 | BR07 | P17, P18 | `updateDatasetColumn`, `createGlossaryTerm`, `updateGlossaryTerm` |
| US23 | F5.3 | UC23 | AC23.1–4 | BR09 | P24 | `createAccessRequest`, `listAccessRequests`, `decideAccessRequest`, `cancelAccessRequest`, `revokeAccessGrant` |
| US24 | F5.4 | UC24 | AC24.1–2 | BR08 | P25 | `listUsers`, `createUser`, `updateUser`, `setUserRoles`, `listOrgUnits` |
| US25 | F5.5 | UC25 | AC25.1–2 | BR10 | P27 | `listAuditLogs` |
| US26 | F6.1 | UC26 | AC26.1 | — | P07 | `listDashboards`, `favoriteDashboard`, `unfavoriteDashboard` |
| US27 | F6.2, F6.3 | UC27 | AC27.1–3 | BR11, BR12, BR15 | P08 | `getDashboard`, `runSemanticQuery` |
| US28 | F6.4 | UC28 | AC28.1–2 | — | P09 | `createDashboard`, `saveDashboard`, `listMetrics`, `listDimensions` |
| US29 | F6.5 | UC29 | AC29.1–2 | BR13 | P08 | `exportDashboard`, `getExport` |
| US30 | F6.6 | UC30 | AC30.1 | BR11 | P09 | `publishDashboard`, `setDashboardShares` |
| US31 ⭐ | F7.1 | UC31 | AC31.1 | — | P22, P18 | `getLineage` |
| US32 ⭐ | F7.2 | UC32 | AC32.1 | — | P14, P22 | `previewMapping`, `getImpact` |
| US33 ⭐ | F8.1–F8.4 | UC33 | AC33.1–2 | BR08, BR19 | P26 | `listPolicies`, `createPolicy`, `listPolicyVersions`, `createPolicyVersion`, `simulatePolicy` |
| US34 ⭐ | F9.1–F9.3 | UC34 | AC34.1 | BR17 | P23 | `listAlerts` (phát hiện trong Dagster) |
| US35 ⭐ | F9.4 | UC35 | AC35.1–2 | BR17 | P23 | `getAlert`, `transitionAlert` |
| US36 ⭐ | F10.1, F10.2 | UC36 | AC36.1 | BR19 | P10 | `createMetric`, `getMetric`, `updateMetric`, `certifyMetric`, `validateMetric` |
| US37 ⭐ | F10.3 | UC37 | AC37.1 | BR18 | P11 | `listSubscriptions`, `createSubscription`, `updateSubscription`, `deleteSubscription` |
| US38 ⭐ | F10.4 | UC38 | AC38.1–2 | BR18, BR20 | P11 | `listDeliveries` (gửi bởi App Worker) |
| US39 ⭐ | F11.1–F11.7 | UC39 | AC39.1–4 | BR12, BR16, BR20 | P12 | `listConversations`, `createConversation`, `getConversation`, `askAssistant`, `rateAssistantMessage` |
| US40 ⭐ | F11.8 | UC40 | AC40.1–2 | BR10 | P27 | `listAssistantLogs`, `listBlockedTopics`, `createBlockedTopic`, `deleteBlockedTopic` |

⭐ = phạm vi nâng cao.

## 2. Kiểm tra độ phủ

| Kiểm tra | Kết quả |
| --- | --- |
| Mọi US có ít nhất một AC dạng Given–When–Then | 40/40 |
| Mọi US có trang hiển thị | 40/40 |
| Mọi US có operation API hoặc job nền tương ứng | 40/40 (US18, US34, US38 thực thi trong Dagster/App Worker) |
| Mọi BR được ít nhất một US tham chiếu | BR01–BR20 |
| Trang không gắn US nào | P02 (tổng hợp từ nhiều US), P04 (trang hệ thống) |

## 3. Phần đã hiện thực

| Hạng mục | US / chức năng | Mã nguồn | Kiểm chứng |
| --- | --- | --- | --- |
| Nguồn giả lập SIS, HRM, FIN, LMS | F12.7 | [sample-data/mock-source](../sample-data/mock-source) | 9 test pytest |
| Landing → Bronze → DQ → Silver/Gold cho `sis_students` | F12.1–F12.5, một phần US18 | [src/pipelines](../src/pipelines) | Dagster load definitions, `dbt parse` |
| Platform API: health, readiness | Nền cho F1 | [src/backend](../src/backend) | 2 test pytest |
| Khung Angular, trang chủ gọi API | Nền cho P02 | [src/frontend](../src/frontend) | `ng build` production |
| Schema control plane | Toàn bộ | [src/database/aiia.sql](../src/database/aiia.sql) | Chạy trên PostgreSQL 18 (PGlite) |

Các US còn lại mới ở mức thiết kế (OpenAPI, schema, wireframe).
