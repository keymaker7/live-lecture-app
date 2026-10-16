import { describe, expect, it } from "vitest";
import { canvaEmbedSrc } from "../../lib/slides-parser";

describe("캔바 발표 화면 iframe 주소(공유 열쇠 포함)", () => {
  it("보기 주소의 열쇠로 공식 퍼가기 모양을 만든다", () => {
    expect(canvaEmbedSrc("DAAAA111", "https://www.canva.com/design/DAAAA111/AbC-12_x/view?utm_content=DAAAA111&utm_source=slides-live"))
      .toBe("https://www.canva.com/design/DAAAA111/AbC-12_x/view?embed");
  });
  it("저장된 보기 주소에 없으면 원래 입력 주소에서 찾는다", () => {
    expect(canvaEmbedSrc("DAAAA111", "https://www.canva.com/design/DAAAA111/view", "https://www.canva.com/design/DAAAA111/tok9/edit"))
      .toBe("https://www.canva.com/design/DAAAA111/tok9/view?embed");
  });
  it("열쇠가 없거나(view·edit), 다른 디자인 주소면 null — 예전처럼 SDK", () => {
    expect(canvaEmbedSrc("DAAAA111", "https://www.canva.com/design/DAAAA111/view")).toBeNull();
    expect(canvaEmbedSrc("DAAAA111", "https://www.canva.com/design/DAAAA111/edit?x=1")).toBeNull();
    expect(canvaEmbedSrc("DAAAA111", "https://www.canva.com/design/DBBBB222/tok/view")).toBeNull();
    expect(canvaEmbedSrc(null, "https://www.canva.com/design/DAAAA111/tok/view")).toBeNull();
    expect(canvaEmbedSrc("DA\"><x", "https://www.canva.com/design/DA/tok/view")).toBeNull();
  });
});
