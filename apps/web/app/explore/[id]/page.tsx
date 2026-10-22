import { Introduction } from '../../../components/explore';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Introduction id={id} />;
}
