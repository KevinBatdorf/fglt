/**
 * Native <select> with `appearance: none` and a custom chevron, so the caret
 * sits at a predictable distance from the right edge instead of hugging it
 * (the OS-default caret on Windows renders too close to the option text).
 */

interface Props {
	value: string;
	onChange: (value: string) => void;
	children: React.ReactNode;
	disabled?: boolean;
	title?: string;
	className?: string;
}

export function Select({
	value,
	onChange,
	children,
	disabled,
	title,
	className,
}: Props) {
	return (
		<div className={`relative inline-block ${className ?? ""}`}>
			<select
				value={value}
				onChange={(e) => onChange(e.target.value)}
				disabled={disabled}
				title={title}
				className="appearance-none bg-zinc-900 border border-zinc-800 rounded-md pl-3 pr-7 py-1.5 text-xs focus:outline-none focus:border-zinc-600 disabled:opacity-50 cursor-pointer"
			>
				{children}
			</select>
			<svg
				viewBox="0 0 12 12"
				aria-hidden="true"
				className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-zinc-500"
			>
				<path
					d="M2 4.5l4 4 4-4"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		</div>
	);
}
