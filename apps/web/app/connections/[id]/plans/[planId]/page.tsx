import { ConnectionPage } from '../../../../../components/connections';
export default async function Page({
  params,
}: {
  params: Promise<{ id: string; planId: string }>;
}) {
  const { id, planId } = await params;
  return <ConnectionPage id={id} planId={planId} />;
}
