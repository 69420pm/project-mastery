import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { briefPath } from "@/features/brief";
import { materialChunksPath, materialsPath } from "@/features/courses";
import { ChunkList } from "@/features/ingestion";
import { getMaterialChunks } from "@/features/ingestion/server";
import { getChunkFindings } from "@/features/knowledge-map/server";
import { requireUser } from "@/lib/auth/user";

export const metadata: Metadata = {
  title: "Chunks",
};

/** A parsed Material's chunks with the Findings about them, read-only. */
export default async function MaterialChunksPage({
  params,
}: PageProps<"/courses/[courseId]/materials/[materialId]">) {
  const { courseId, materialId } = await params;
  await requireUser(materialChunksPath(courseId, materialId));
  const material = await getMaterialChunks(materialId);
  if (!material || material.courseId !== courseId) notFound();
  const findings = await getChunkFindings(courseId, materialId);

  return (
    <ChunkList
      material={material}
      backHref={materialsPath(courseId)}
      materialHref={(id) => materialChunksPath(courseId, id)}
      briefHref={briefPath(courseId)}
      findings={findings}
    />
  );
}
