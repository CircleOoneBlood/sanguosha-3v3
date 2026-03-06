# TESTING / 验收模板

每次版本交付按以下模板输出：

## 1) 验收范围（AC）
- [ ] AC-1:
- [ ] AC-2:
- [ ] AC-3:

## 2) 自动化测试
- Typecheck: `npm run typecheck`
- Smoke: `npm run test:smoke`
- E2E: `npm run test:e2e`

记录：
- typecheck: PASS/FAIL
- smoke: PASS/FAIL
- e2e: PASS/FAIL

## 3) 手动关键路径
- [ ] 建房/加房
- [ ] 开始游戏（正常 6 人）
- [ ] 开发后门（2+人 / 补机器人）
- [ ] 出杀/闪/桃/弃牌
- [ ] 胜负判定

## 4) 风险分级
- P0（阻塞发布）:
- P1（建议修复后发布）:
- P2（可带病发布）:

## 5) 发布结论
- [ ] 可发布
- [ ] 条件可发布（附条件）
- [ ] 不可发布（附原因）
