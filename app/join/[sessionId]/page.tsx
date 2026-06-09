import { JoinPage } from "@/components/slides-app/JoinPage";

export default async function JoinRoute({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <JoinPage roomId={sessionId} />;
}
