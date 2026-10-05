import { X } from "lucide-react";

/** Markdown images (`![alt](url)`) in a piece of text. */
const IMAGE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

export function imagesIn(text: string | null | undefined): { alt: string; url: string }[] {
  return [...(text ?? "").matchAll(IMAGE)]
    .map((m) => ({ alt: m[1], url: m[2] }))
    .filter((i) => !i.url.startsWith("uploading-"));
}

/** The image references themselves, uploads in flight included. */
export function imageRefs(text: string | null | undefined): string[] {
  return (text ?? "").match(IMAGE) ?? [];
}

/** Text plus image references, the images at the end, each after a blank line. */
export function withImages(text: string, refs: string[]): string {
  return text + refs.map((r) => `\n\n${r}`).join("");
}

/** The words of a text kept by ``withImages``: exactly undoes it, so typing a trailing space
    or newline in front of the images survives. */
export function wordsOf(text: string): string {
  return text.replace(/(\n\n)?!\[[^\]]*\]\([^)\s]+\)/g, "");
}

/** The text without its image references (for plain-text displays that show them as a strip). */
export function withoutImages(text: string): string {
  return text.replace(IMAGE, "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Thumbnails for the images in plain-text fields (description, progress notes); click for full size. */
export default function ImageStrip({
  text,
  className = "",
  onRemove,
}: {
  text: string | null | undefined;
  className?: string;
  /** Shows a remove button on each image. */
  onRemove?: (url: string) => void;
}) {
  const images = imagesIn(text);
  if (!images.length) return null;
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {images.map((img, i) => (
        <div key={`${img.url}-${i}`} className="group/img relative">
        <a
          href={img.url}
          target="_blank"
          rel="noreferrer"
          title={img.alt || "Open full size"}
          className="block overflow-hidden rounded-[8px] border border-edge bg-fg/[0.03] transition-colors hover:border-[color:var(--line)]"
          onClick={(e) => e.stopPropagation()}
        >
          <img src={img.url} alt={img.alt} loading="lazy" className="h-28 max-w-[220px] object-cover" />
        </a>
        {onRemove && (
          <button
            type="button"
            className="btn btn-ghost btn-xs btn-icon absolute right-1 top-1 w-[26px] bg-tile/90 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/img:opacity-100 focus-visible:opacity-100"
            title="Remove image"
            aria-label="Remove image"
            onClick={() => onRemove(img.url)}
          >
            <X size={13} />
          </button>
        )}
        </div>
      ))}
    </div>
  );
}
