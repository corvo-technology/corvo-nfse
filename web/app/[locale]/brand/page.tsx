import type { Metadata } from "next";
import { pageMetadata, seoLocale } from "@/lib/seo";

const BRAND_COPY = {
  pt: {
    title: "Identidade visual",
    description: "Marca, cores e tipografia da Corvo: veja as versões do símbolo e como usar a identidade visual em materiais e parcerias.",
  },
  en: {
    title: "Brand guidelines",
    description: "The Corvo mark, colors and typography: see the versions of the symbol and how to use the brand in materials and partnerships.",
  },
} as const;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({ locale, path: "/brand", ...BRAND_COPY[seoLocale(locale)] });
}


const marks = [
  {
    id: "A",
    name: "Profile head",
    description:
      "Angular corvid silhouette: heavy beak, swept nape and two hackle feathers on the throat. The eye is punched out of the body (single path, fill-rule evenodd), so the mark works on any background in a single color.",
  },
  {
    id: "B",
    name: "Angular flight",
    description:
      "Two wedge-shaped wings and a tail. Reads as both a bird and a send arrow.",
  },
  {
    id: "C",
    name: "Perched crow",
    description:
      "Full silhouette with tail and branch. More narrative, less icon.",
  },
];

const markAPath =
  "M16.6 41.6C12.9 32.2 17.1 21.9 27.2 18.4C33.2 16.3 39.2 17.6 41.7 21.3L60.6 25.9L42.9 30.5C43.7 33.7 42.9 36.5 40.7 38.7L45.2 40.5L36.5 41.3L38.5 45.6L31.6 42.7C26.3 45.7 20.1 45.5 16.6 41.6ZM35.2 24.3A2.7 2.7 0 1 1 29.8 24.3A2.7 2.7 0 1 1 35.2 24.3Z";

const markBPaths = [
  "M32 33L7 13C13 27 21 32 32 33Z",
  "M32 33L57 13C51 27 43 32 32 33Z",
  "M32 32.5L36.5 52L27.5 52Z",
];

const markCPath =
  "M19 45C14.5 35 19 25.5 29 23.5C31 17.5 39.5 16.5 42.5 21.5L54 24.5L42.5 27.5C45.5 33.5 43.5 43 35 46.5L47 50.5L20 50.5Z";

function MarkA({ size = 132 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className="text-accent"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d={markAPath}
        fill="currentColor"
      />
      <circle cx="31.5" cy="25.2" r="2.5" fill="#0a0a0a" />
      <circle cx="25.6" cy="30.4" r="1.75" fill="#0a0a0a" />
      <circle cx="34.6" cy="32.4" r="1.75" fill="#0a0a0a" />
    </svg>
  );
}

function MarkB({ size = 132 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className="text-accent"
    >
      <path d={markBPaths[0]} fill="currentColor" />
      <path d={markBPaths[1]} fill="currentColor" fillOpacity="0.62" />
      <path d={markBPaths[2]} fill="currentColor" />
    </svg>
  );
}

function MarkC({ size = 132 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className="text-accent"
    >
      <path d={markCPath} fill="currentColor" />
      <circle cx="33.5" cy="25.5" r="2.4" fill="#0a0a0a" />
      <path
        d="M25 33C31 34.5 36.5 38 39 43"
        stroke="#0a0a0a"
        strokeOpacity="0.26"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MarkInHeader({
  MarkComponent,
}: {
  MarkComponent: React.ComponentType<{ size?: number }>;
}) {
  return (
    <div className="flex items-center gap-3">
      <MarkComponent size={20} />
      <span className="text-base font-semibold tracking-tight">Corvo</span>
    </div>
  );
}

export default function BrandPage() {
  return (
    <div className="min-h-screen bg-bg text-text font-sans p-11 flex flex-col gap-8.5">
      <div className="flex flex-col gap-1.75">
        <span className="font-mono text-[11px] text-accent tracking-[0.12em]">
          CORVO · BRAND MARK
        </span>
        <h1 className="m-0 text-[28px] font-semibold tracking-[-0.028em]">
          Three crow mark explorations
        </h1>
        <p className="m-0 max-w-[660px] text-[15px] leading-relaxed text-text-3 text-pretty">
          Flat vector drawings, handcrafted in SVG — these are explorations, not
          final art. Choose a direction and I will refine; for something more
          elaborate, an illustrator can take it from there.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-5">
        {/* Mark A */}
        <div className="border border-border rounded-xl bg-surface overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-border-soft flex items-center gap-2.5">
            <span className="font-mono text-[11px] text-text-3">MARK A</span>
            <span className="text-sm font-medium">Profile head</span>
          </div>
          <div
            className="p-9 flex justify-center"
            style={{
              background:
                "radial-gradient(90% 70% at 50% 0%, #121816 0%, #0d0d0d 70%)",
            }}
          >
            <MarkA />
          </div>
          <div className="px-5 py-4.5 border-t border-border-soft flex items-center gap-5.5">
            <div className="flex items-center gap-2.5">
              <MarkA size={22} />
              <span className="text-base font-semibold tracking-tight">
                Corvo
              </span>
            </div>
            <div className="flex items-center gap-2.5 ml-auto">
              <div className="w-6.5 h-6.5 rounded-md bg-[#ededec] flex items-center justify-center">
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 64 64"
                  fill="none"
                >
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d={markAPath}
                    fill="#0a0a0a"
                  />
                  <circle cx="31.5" cy="25.2" r="2.5" fill="#0a0a0a" />
                  <circle cx="25.6" cy="30.4" r="1.75" fill="#0a0a0a" />
                  <circle cx="34.6" cy="32.4" r="1.75" fill="#0a0a0a" />
                </svg>
              </div>
              <div className="w-4 h-4 rounded bg-[#1a1a1a] flex items-center justify-center">
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 64 64"
                  fill="none"
                >
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d={markAPath}
                    fill="currentColor"
                    className="text-accent"
                  />
                  <circle cx="31.5" cy="25.2" r="2.5" fill="#0a0a0a" />
                  <circle cx="25.6" cy="30.4" r="1.75" fill="#0a0a0a" />
                  <circle cx="34.6" cy="32.4" r="1.75" fill="#0a0a0a" />
                </svg>
              </div>
            </div>
          </div>
          <div className="px-5 pb-5 text-[13.5px] text-text-3 leading-relaxed">
            {marks[0].description}
          </div>
        </div>

        {/* Mark B */}
        <div className="border border-border rounded-xl bg-surface overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-border-soft flex items-center gap-2.5">
            <span className="font-mono text-[11px] text-text-3">MARK B</span>
            <span className="text-sm font-medium">Angular flight</span>
          </div>
          <div
            className="p-9 flex justify-center"
            style={{
              background:
                "radial-gradient(90% 70% at 50% 0%, #121816 0%, #0d0d0d 70%)",
            }}
          >
            <MarkB />
          </div>
          <div className="px-5 py-4.5 border-t border-border-soft flex items-center gap-5.5">
            <div className="flex items-center gap-2.5">
              <MarkB size={22} />
              <span className="text-base font-semibold tracking-tight">
                Corvo
              </span>
            </div>
            <div className="flex items-center gap-2.5 ml-auto">
              <div className="w-6.5 h-6.5 rounded-md bg-[#ededec] flex items-center justify-center">
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 64 64"
                  fill="none"
                >
                  <path d={markBPaths[0]} fill="#0a0a0a" />
                  <path
                    d={markBPaths[1]}
                    fill="#0a0a0a"
                    fillOpacity="0.62"
                  />
                  <path d={markBPaths[2]} fill="#0a0a0a" />
                </svg>
              </div>
              <div className="w-4 h-4 rounded bg-[#1a1a1a] flex items-center justify-center">
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 64 64"
                  fill="none"
                >
                  <path d={markBPaths[0]} fill="currentColor" className="text-accent" />
                  <path
                    d={markBPaths[1]}
                    fill="currentColor"
                    fillOpacity="0.62"
                    className="text-accent"
                  />
                  <path d={markBPaths[2]} fill="currentColor" className="text-accent" />
                </svg>
              </div>
            </div>
          </div>
          <div className="px-5 pb-5 text-[13.5px] text-text-3 leading-relaxed">
            {marks[1].description}
          </div>
        </div>

        {/* Mark C */}
        <div className="border border-border rounded-xl bg-surface overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-border-soft flex items-center gap-2.5">
            <span className="font-mono text-[11px] text-text-3">MARK C</span>
            <span className="text-sm font-medium">Perched crow</span>
          </div>
          <div
            className="p-9 flex justify-center"
            style={{
              background:
                "radial-gradient(90% 70% at 50% 0%, #121816 0%, #0d0d0d 70%)",
            }}
          >
            <MarkC />
          </div>
          <div className="px-5 py-4.5 border-t border-border-soft flex items-center gap-5.5">
            <div className="flex items-center gap-2.5">
              <MarkC size={22} />
              <span className="text-base font-semibold tracking-tight">
                Corvo
              </span>
            </div>
            <div className="flex items-center gap-2.5 ml-auto">
              <div className="w-6.5 h-6.5 rounded-md bg-[#ededec] flex items-center justify-center">
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 64 64"
                  fill="none"
                >
                  <path d={markCPath} fill="#0a0a0a" />
                </svg>
              </div>
              <div className="w-4 h-4 rounded bg-[#1a1a1a] flex items-center justify-center">
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 64 64"
                  fill="none"
                >
                  <path d={markCPath} fill="currentColor" className="text-accent" />
                </svg>
              </div>
            </div>
          </div>
          <div className="px-5 pb-5 text-[13.5px] text-text-3 leading-relaxed">
            {marks[2].description}
          </div>
        </div>
      </div>

      {/* Header proof */}
      <div className="border border-border rounded-xl bg-surface p-5.5 flex items-center gap-6.5">
        <span className="font-mono text-[11px] text-text-3">NO HEADER</span>
        <div className="flex-1 border border-border-soft rounded-[9px] bg-bg p-3.5 px-5 flex items-center justify-between">
          <div className="flex items-center gap-7.5">
            <MarkInHeader MarkComponent={MarkA} />
            <div className="flex gap-5 text-[13.5px] text-text-3">
              <span>Product</span>
              <span>Docs</span>
              <span>Pricing</span>
            </div>
          </div>
          <span className="bg-[#ededec] text-[#0a0a0a] px-3.5 py-1.75 rounded-[7px] text-[13.5px] font-medium">
            Start free
          </span>
        </div>
      </div>
    </div>
  );
}
