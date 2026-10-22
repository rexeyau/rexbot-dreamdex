import { createFileRoute } from "@tanstack/react-router";
import { MarksideApp } from "@/components/markside-app";
import { listPerps } from "@/lib/markets";

export const Route = createFileRoute("/")({
  loader: () => listPerps(),
  component: Home,
});

function Home() {
  const initial = Route.useLoaderData();
  return <MarksideApp initial={initial} />;
}
