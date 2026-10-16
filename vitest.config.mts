import { defineConfig } from "vitest/config";

// 채점·판정 순수 함수 단위 시험만 (화면·통신 시험은 tests/*.mjs)
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    // exFAT 디스크의 맥 메타 파일(._이름) 제외
    exclude: ["**/node_modules/**", "**/._*"],
    environment: "node",
  },
});
