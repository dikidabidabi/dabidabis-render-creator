import { createFileRoute } from "@tanstack/react-router";
import { SketchPage } from "./sketch";

export const Route = createFileRoute("/masterplan")({
  head: () => ({
    meta: [
      { title: "Master Plan — Dabidabi's" },
      {
        name: "description",
        content:
          "Master Plan kawasan berbasis sketsa milimeter block: gambar massa lantai dasar, atur KDB/KLB/KDH, dan jalankan Cluster Generator parametrik berbasis konteks tapak.",
      },
    ],
  }),
  component: MasterPlanPage,
});

function MasterPlanPage() {
  return <SketchPage mode="masterplan" />;
}
