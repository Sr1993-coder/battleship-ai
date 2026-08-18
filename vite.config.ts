import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // The site is served from https://<user>.github.io/battleship-ai/
  base: process.env.GITHUB_ACTIONS ? '/battleship-ai/' : '/',
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
  },
});
