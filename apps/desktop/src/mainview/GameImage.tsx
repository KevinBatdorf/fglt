import { useEffect, useState } from "react";
import { type SteamImageVariant, steamImg } from "./lib/api";

interface Props {
	appid: number;
	name: string;
	variant: SteamImageVariant;
	/** API-supplied fallback (typically `header_image`) */
	fallback?: string | null;
	className?: string;
	loading?: "lazy" | "eager";
	alt?: string;
}

/**
 * Image with a robust Steam-CDN fallback chain. Broken art was common because
 * not every appid has every variant published — older games and small indies
 * skip `library_600x900.jpg`. Tries the requested variant, then the standard
 * header image, then the API-supplied `header_image`, then a text placeholder.
 */
export function GameImage({
	appid,
	name,
	variant,
	fallback,
	className,
	loading = "lazy",
	alt,
}: Props) {
	const sources = buildSources(appid, variant, fallback ?? null);
	const [idx, setIdx] = useState(0);

	useEffect(() => {
		setIdx(0);
	}, [appid, variant, fallback]);

	if (idx >= sources.length) {
		return (
			<div
				className={`${className ?? ""} bg-zinc-900 flex items-center justify-center text-zinc-600 text-[11px] px-3 text-center leading-snug`}
			>
				{name}
			</div>
		);
	}

	return (
		<img
			src={sources[idx]}
			alt={alt ?? name}
			loading={loading}
			onError={() => setIdx((i) => i + 1)}
			className={className}
		/>
	);
}

function buildSources(
	appid: number,
	variant: SteamImageVariant,
	apiFallback: string | null,
): string[] {
	const out: string[] = [steamImg(appid, variant)];
	// Standard header is the most-likely-to-exist variant; chain it for any
	// other primary variant.
	if (variant !== "header") {
		out.push(steamImg(appid, "header"));
	}
	if (apiFallback && !out.includes(apiFallback)) {
		out.push(apiFallback);
	}
	return out;
}
