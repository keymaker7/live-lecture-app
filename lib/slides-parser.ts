export type SlideType = "google" | "canva" | "iframe";

export interface ParsedSlide {
  type: SlideType;
  embedUrl?: string;
  slideUrl?: string;
  designId?: string;
  viewUrl?: string;
}

function parseCanvaFromEmbedHtml(input: string): ParsedSlide | null {
  const designId = input.match(/data-design-id="([A-Za-z0-9_-]+)"/)?.[1];
  if (designId) {
    return { type: "canva", designId, viewUrl: buildCanvaViewUrl(designId) };
  }
  const iframeSrc = input.match(/src="(https:\/\/www\.canva\.com\/[^"]+)"/)?.[1];
  if (iframeSrc) return parseCanvaUrl(iframeSrc);
  return null;
}

function buildCanvaViewUrl(designId: string, viewToken?: string | null) {
  let url = `https://www.canva.com/design/${designId}`;
  if (viewToken && viewToken !== "view" && viewToken !== "edit") url += `/${viewToken}`;
  url += `/view?utm_content=${designId}&utm_campaign=designshare&utm_medium=embeds&utm_source=slides-live`;
  return url;
}

function parseCanvaUrl(url: string): ParsedSlide | null {
  const match = url.match(/canva\.com\/design\/([A-Za-z0-9_-]+)(?:\/([A-Za-z0-9_-]+))?/i);
  if (!match) return null;
  const designId = match[1];
  const segment = match[2];
  const viewToken = segment && !["view", "edit"].includes(segment) ? segment : null;
  return { type: "canva", designId, viewUrl: buildCanvaViewUrl(designId, viewToken) };
}

async function fetchCanvaOembed(viewUrl: string) {
  const endpoints = [
    `https://api.canva.com/_spi/presentation/_oembed?url=${encodeURIComponent(viewUrl)}&format=json`,
    `https://www.canva.com/_oembed?url=${encodeURIComponent(viewUrl)}&format=json`,
  ];
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, { headers: { Accept: "application/json" } });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.html || data.designId) return data;
    } catch {
      /* next */
    }
  }
  return null;
}

function extractDesignIdFromOembed(html?: string) {
  return html?.match(/data-design-id="([A-Za-z0-9_-]+)"/)?.[1] || null;
}

export async function parseSlideInput(input: string): Promise<ParsedSlide | null> {
  const trimmed = (input || "").trim();
  if (!trimmed) return null;

  if (trimmed.includes("data-design-id") || trimmed.includes("<iframe")) {
    const fromHtml = parseCanvaFromEmbedHtml(trimmed);
    if (fromHtml) return fromHtml;
  }

  const googleMatch = trimmed.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/);
  if (googleMatch) {
    return {
      type: "google",
      embedUrl: `https://docs.google.com/presentation/d/${googleMatch[1]}/embed?start=false&loop=false&delayms=3000`,
      slideUrl: trimmed,
    };
  }

  if (/canva\.com/i.test(trimmed)) {
    const canva = parseCanvaUrl(trimmed);
    if (!canva) return null;
    const oembed = await fetchCanvaOembed(canva.viewUrl!);
    if (oembed?.html) {
      const designId = extractDesignIdFromOembed(oembed.html) || canva.designId;
      return { type: "canva", designId, viewUrl: canva.viewUrl };
    }
    return canva;
  }

  if (trimmed.includes("/embed") || trimmed.includes("?embed")) {
    return { type: "iframe", embedUrl: trimmed, slideUrl: trimmed };
  }
  return { type: "iframe", embedUrl: trimmed, slideUrl: trimmed };
}

/**
 * 발표 화면에 캔바를 띄울 iframe 주소 — 공유 열쇠가 들어간 공식 퍼가기 모양
 * `https://www.canva.com/design/{id}/{열쇠}/view?embed`.
 * SDK(data-design-id 만 넘김)는 열쇠 없는 /design/{id}/view?embed 로 열어서 403 + X-Frame-Options 로 안 뜬다.
 * 저장된 보기 주소(canvaViewUrl)나 원래 주소에 열쇠가 없으면 null — 그땐 예전처럼 SDK 로.
 */
export function canvaEmbedSrc(designId: string | null | undefined, ...urls: Array<string | null | undefined>): string | null {
  if (!designId || !/^[A-Za-z0-9_-]+$/.test(designId)) return null;
  for (const u of urls) {
    if (!u) continue;
    const m = u.match(/canva\.com\/design\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)/i);
    if (!m || m[1] !== designId) continue;
    const token = m[2];
    if (["view", "edit", "watch", "present"].includes(token.toLowerCase())) continue;
    return `https://www.canva.com/design/${designId}/${token}/view?embed`;
  }
  return null;
}
