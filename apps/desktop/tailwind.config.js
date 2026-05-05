/** @type {import('tailwindcss').Config} */
export default {
	content: ['./src/mainview/**/*.{html,js,ts,jsx,tsx}'],
	theme: {
		extend: {
			fontFamily: {
				sans: [
					'"Inter Variable"',
					'Inter',
					'-apple-system',
					'BlinkMacSystemFont',
					'Segoe UI',
					'Roboto',
					'Helvetica Neue',
					'Arial',
					'sans-serif',
				],
				display: [
					'"Fraunces Variable"',
					'Fraunces',
					'Georgia',
					'"Times New Roman"',
					'serif',
				],
			},
		},
	},
	plugins: [],
};
