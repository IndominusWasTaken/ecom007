import { ExternalLink, Film, GalleryHorizontal, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export interface MediaInfo {
  /** /media/... URLs for downloaded files (null when not downloaded). */
  video: string | null;
  image: string | null;
  thumbnail: string | null;
  status: "ok" | "pending" | "failed";
  error: string | null;
}

const ICON = { video: Film, carousel: GalleryHorizontal, image: ImageIcon } as const;

/**
 * Playable preview from the local media route: video with poster, else the image, else the
 * thumbnail, else a placeholder linking to the original post.
 */
export function CreativeMedia({ media, format, postUrl, name, className }: { media: MediaInfo; format: string; postUrl: string | null; name: string; className?: string }) {
  const box = (aspect = "aspect-square") => cn("relative w-full overflow-hidden bg-surface-2", aspect, className);
  if (media.video) {
    return (
      <div className={box()}>
        <video controls preload="none" poster={media.thumbnail ?? undefined} src={media.video} className="h-full w-full bg-black object-contain" aria-label={name} />
      </div>
    );
  }
  const still = media.image ?? media.thumbnail;
  const viewPost = postUrl && (
    <a href={postUrl} target="_blank" rel="noreferrer noopener" className="btn btn-sm">
      View post <ExternalLink size={12} />
    </a>
  );
  if (still) {
    return (
      <div className={box()}>
        {/* eslint-disable-next-line @next/next/no-img-element -- local, auth-protected media */}
        <img src={still} alt={name} loading="lazy" className="h-full w-full object-cover" />
        {format === "video" && <div className="absolute right-2 bottom-2">{viewPost}</div>}
      </div>
    );
  }
  const Icon = ICON[format as keyof typeof ICON] ?? ImageIcon;
  return (
    <div className={cn(box("aspect-[16/10]"), "grid place-items-center bg-gradient-to-br from-accent-soft to-surface-2")}>
      <div className="flex flex-col items-center gap-2 px-6 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-2xl border border-line bg-surface text-accent shadow-sm">
          <Icon size={22} strokeWidth={1.75} />
        </span>
        <span className="text-xs font-medium text-muted">{media.status === "pending" ? "Preview downloading…" : "Preview not available"}</span>
        {media.status === "failed" && media.error && <span className="line-clamp-2 text-[11px] text-muted/80" title={media.error}>{media.error}</span>}
        {viewPost}
      </div>
    </div>
  );
}
