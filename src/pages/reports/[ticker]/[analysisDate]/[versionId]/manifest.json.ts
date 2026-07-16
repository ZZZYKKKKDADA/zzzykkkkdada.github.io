import type { APIContext, GetStaticPaths } from "astro";
import { loadSiteRepository } from "../../../../../lib/repository";
import { buildSiteViews } from "../../../../../lib/views";

interface ManifestProps {
  manifest: Uint8Array;
}

export const getStaticPaths: GetStaticPaths = async () => {
  const root = process.env.REPORT_SITE_ROOT ?? process.cwd();
  const views = await buildSiteViews(root);
  const repository = await loadSiteRepository(root);
  return views.reports.flatMap((report) => {
    if (!report.downloadRoute) return [];
    const loadedPackage = repository.packages.get(report.versionId);
    if (!loadedPackage) throw new Error("MANIFEST_PACKAGE_MISSING");
    return [{
      params: {
        ticker: report.tickerSlug,
        analysisDate: report.analysisDate,
        versionId: report.versionId
      },
      props: { manifest: loadedPackage.manifestBytes } satisfies ManifestProps
    }];
  });
};

export async function GET({ props }: APIContext<ManifestProps>) {
  const bytes = new ArrayBuffer(props.manifest.byteLength);
  new Uint8Array(bytes).set(props.manifest);
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
