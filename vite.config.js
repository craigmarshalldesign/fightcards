import { defineConfig } from 'vite';

export default defineConfig({
  base: '/fightcards/', // Matches your repository name
  build: {
    outDir: 'dist', // Ensure output goes to 'dist'
  },
});
