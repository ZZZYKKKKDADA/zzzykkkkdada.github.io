import type { APIContext, GetStaticPaths } from "astro";
import { loadSiteRepository } from "../../../../../lib/repository";
import { buildSiteViews } from "../../../../../lib/views";

interface DownloadProps {
  markdown: Uint8Array;
  versionId: string;
}

export const getStaticPaths: GetStaticPaths = async () => {
  const root = process.env.REPORT_SITE_ROOT ?? process.cwd();
  const views = await buildSiteViews(root);
  const repository = await loadSiteRepository(root);
  return views.reports.flatMap((report) => {
    if (!report.downloadRoute) return [];
    const loadedPackage = repository.packages.get(report.versionId);
    if (!loadedPackage) throw new Error("DOWNLOAD_PACKAGE_MISSING");
    return [
      {
        params: {
          ticker: report.tickerSlug,
          analysisDate: report.analysisDate,
          versionId: report.versionId
        },
        props: {
          markdown: loadedPackage.markdown,
          versionId: report.versionId
        } satisfies DownloadProps
      }
    ];
  });
};

export async function GET({ props }: APIContext<DownloadProps>) {
  const bytes = new ArrayBuffer(props.markdown.byteLength);
  new Uint8Array(bytes).set(props.markdown);
  return new Response(bytes, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${props.versionId}-complete_report.md"`,
      "X-Content-Type-Options": "nosniff"
    }
  });
}
